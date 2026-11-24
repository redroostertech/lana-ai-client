'use strict';

/**
 * Phase 5, server release, on the parts machine, with a LANA-AI checkout at
 * server production (--server-repo).
 *
 *   1. Classifiers: release.sh --pins-only (its step 0) is the only check. A
 *      classifier archive missing from the model bucket stops the run.
 *   2. Railway images: build-images.sh on a throwaway Azure Linux VM
 *      (azure-verify.sh railway-images), the OCI archives brought back here,
 *      then push-images.sh to LANA's registry (R2 bucket lana-registry).
 *   3. The signed on-prem update and the portal stamp: release.sh, given the
 *      Railway images instead of the legacy lana-stack image.
 *   4. The control plane: RAILWAY_IMAGE_* and the backend update policy
 *      (RedRoosterTech-Web scripts/set-deployment-update-policy.js).
 *
 * Michael's yes is needed for the VMs, for pushing the images and changing
 * the control plane, and for publishing the server release.
 */

const fs = require('fs');
const path = require('path');
const { HEROKU_APP, REPOS } = require('../config');
const { requireYes } = require('../approvals');
const { scrub } = require('../exec');
const { herokuCommand } = require('../r2');
const { prepareSource } = require('../builders');

const IMAGE_NAMES = ['chef', 'embed', 'redactor', 'minio'];

function needOption(value, flag, what) {
  if (!value) {throw new Error(`Server: pass ${flag} (${what}).`);}
  return value;
}

async function heroku(ctx, args, what) {
  const { command, prefix } = herokuCommand(ctx.env);
  const result = await ctx.run(command, [...prefix, ...args], { env: ctx.env });
  if (result.code !== 0) {throw new Error(`Server: could not ${what} on Heroku (${scrub(result.stderr)}).`);}
  return result.stdout.trim();
}

const REGISTRY_PASSWORD_VAR = 'LANA_REGISTRY_PUSH_PASSWORD';

/** The registry push password from Heroku, in a private (600) file. Never printed. */
async function registryPasswordFile(ctx) {
  const name = ctx.env.LANA_REGISTRY_PASSWORD_VAR || REGISTRY_PASSWORD_VAR;
  const value = await heroku(ctx, ['config:get', name, '-a', HEROKU_APP], `read ${name}`);
  if (!value) {throw new Error(`Server: Heroku app ${HEROKU_APP} has no ${name}. Add the lana-push password there.`);}
  fs.mkdirSync(ctx.dir, { recursive: true, mode: 0o700 });
  const file = path.join(ctx.dir, `.registry-push-${process.pid}`);
  fs.writeFileSync(file, value, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

/** RAILWAY_IMAGE_<NAME>=<registry>/lana-<name>@sha256:<digest> lines from build-images.sh's railway-images.env. */
function readImageVars(file) {
  const vars = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^(RAILWAY_IMAGE_[A-Z]+)=(\S+@sha256:[0-9a-f]{64})$/.exec(line.trim());
    if (match) {vars[match[1]] = match[2];}
  }
  const missing = IMAGE_NAMES.map((n) => `RAILWAY_IMAGE_${n.toUpperCase()}`).filter((name) => !vars[name]);
  if (missing.length) {throw new Error(`Server: ${file} lacks ${missing.join(', ')}.`);}
  return vars;
}

async function server(ctx, options = {}) {
  const repo = needOption(ctx.serverRepo, '--server-repo', 'a LANA-AI checkout at server production');
  const serverVersion = needOption(ctx.serverVersion, '--server-version', 'the server release number, for example 3.1.0');
  const commit = await ctx.git.tip(REPOS.server, 'production');
  const head = await ctx.git.head(repo);
  if (head !== commit) {throw new Error(`Server: ${repo} is at ${head.slice(0, 9)}; server production is ${commit.slice(0, 9)}. Check out production there.`);}
  if (!(await ctx.git.clean(repo))) {throw new Error(`Server: ${repo} has local changes.`);}
  const release = path.join(repo, 'scripts', 'release', 'release.sh');
  const redactorCommit = needOption(options.railwayRedactorCommit, '--railway-redactor-commit', 'the lana-redactor commit with the dual-stack bind (REDACTOR_BIND_HOST=all)');
  const out = path.join(ctx.dir, 'railway-images', commit.slice(0, 12));
  const envFile = path.join(out, 'railway-images.env');
  // A dry run reads only: it runs nothing and writes nothing.
  if (ctx.dryRun) {
    ctx.log(`  [dry run] would check the classifier pins (release.sh --pins-only), build the four Railway images from ${commit.slice(0, 9)} (lana-redactor ${redactorCommit.slice(0, 12)}) on an Azure Linux VM, push them, publish server ${serverVersion} with release.sh, and set the control plane`);
    return {};
  }
  const logFile = path.join(ctx.dir, 'logs', 'server.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  // 1. Classifiers.
  const pinsCheck = await ctx.run('bash', [release, serverVersion, 'stable', '--pins-only'], { cwd: repo, env: ctx.env, logFile });
  if (pinsCheck.code !== 0) {
    ctx.report.waiting.push(`release.sh step 0 says a classifier archive is not in the model bucket: publish it first (see logs/server.log), then run the server phase again.`);
    throw new Error('Server: release.sh step 0 (classifier pins) failed.');
  }
  ctx.desk('server.classifiers');

  // 2. Railway images.
  if (!fs.existsSync(envFile)) {
    requireYes(ctx, 'azure-vms', 'one Linux VM for the Railway images');
    const redactorSource = await prepareSource(ctx, 'redactor', redactorCommit, 'railway');
    const built = await ctx.run('bash', [path.join(repo, 'scripts', 'release', 'azure-verify.sh'), 'railway-images',
      '--commit', commit, '--redactor', redactorSource, '--out', out], { cwd: repo, env: ctx.env, logFile });
    if (built.code !== 0) {throw new Error(`Server: the Railway image build failed (exit ${built.code}; see logs/server.log). Its resource group is deleted.`);}
  }
  const vars = readImageVars(envFile);
  ctx.desk('server.image');

  requireYes(ctx, 'railway-images', `the four images from ${commit.slice(0, 9)}`);
  if (!ctx.state.imagesPushed) {
    // The lana-push password comes from Heroku (Michael, 2026-11-23) into a private file that is removed after the push.
    const password = options.registryPasswordFile || await registryPasswordFile(ctx);
    let pushed;
    try {
      pushed = await ctx.run('bash', [path.join(repo, 'deploy', 'railway', 'push-images.sh'), '--out', out, '--password-file', password], { cwd: repo, env: ctx.env, logFile });
    } finally {
      if (!options.registryPasswordFile) {fs.rmSync(password, { force: true });}
    }
    if (pushed.code !== 0) {throw new Error(`Server: push-images.sh failed (exit ${pushed.code}; see logs/server.log).`);}
    ctx.state.imagesPushed = { at: new Date().toISOString(), vars };
    ctx.report.uploaded.push('four Railway images to LANA\'s registry');
  }

  // 3. Signed on-prem update and the portal stamp.
  requireYes(ctx, 'server-release', `server ${serverVersion} from ${commit.slice(0, 9)}`);
  const signingKey = needOption(options.signingKeyFile, '--signing-key-file', 'the release signing key file');
  // release.sh stopped earlier for an attestation, which is finished by hand. Never run it again from the top.
  if (ctx.state.serverStaged && !ctx.state.serverReleased) {
    if (!options.serverPublished) {
      ctx.report.waiting.push(`Server ${ctx.state.serverStaged.version} is staged and waiting for its attestation. Finish it with release.sh --verify-only and --publish-only (scripts/release/README.md), then run the server phase again with --server-published.`);
      throw new Error(`Server: release ${ctx.state.serverStaged.version} is waiting for its attestation; it is not run again.`);
    }
    ctx.state.serverReleased = { ...ctx.state.serverStaged, finishedByHand: true, at: new Date().toISOString() };
  }
  if (!ctx.state.serverReleased) {
    const token = await heroku(ctx, ['config:get', 'RELEASE_PUBLISH_TOKEN', '-a', HEROKU_APP], 'read the publish token');
    const env = { ...ctx.env, RELEASE_PUBLISH_TOKEN: token, RELEASE_SIGNING_KEY_FILE: signingKey, RELEASE_SIGNING_KEY_ID: options.signingKeyId || 'lana-release-prod', LANA_RELEASE_RAILWAY_IMAGES: path.join(out, 'images.json') };
    const published = await ctx.run('bash', [release, serverVersion, 'stable'], { cwd: repo, env, logFile });
    if (published.code === 3) {
      ctx.state.serverStaged = { version: serverVersion, commit, at: new Date().toISOString() };
      ctx.report.waiting.push('release.sh staged the candidate and needs a tested attestation (exit 3). Test it, then rerun release.sh with --verify-only and --publish-only as its README says.');
      throw new Error('Server: release.sh is waiting for an attestation.');
    }
    if (published.code !== 0) {throw new Error(`Server: release.sh failed (exit ${published.code}; see logs/server.log).`);}
    ctx.state.serverReleased = { version: serverVersion, commit, at: new Date().toISOString() };
    ctx.report.uploaded.push(`server ${serverVersion} (signed on-prem update)`);
  }
  ctx.desk('server.tarball', 'server.stamp');

  // 4. The control plane points at the new images.
  if (!ctx.state.controlPlaneSet) {
    await heroku(ctx, ['config:set', ...Object.entries(vars).map(([k, v]) => `${k}=${v}`), '-a', HEROKU_APP], 'set the Railway image variables');
    await heroku(ctx, ['run', '--exit-code', '-a', HEROKU_APP, '--', 'node', 'scripts/set-deployment-update-policy.js',
      '--version', serverVersion, '--image', vars.RAILWAY_IMAGE_CHEF], 'set the backend update policy');
    ctx.state.controlPlaneSet = { at: new Date().toISOString() };
  }
  ctx.state.serverVersion = serverVersion;
  return { vars };
}

module.exports = { server, readImageVars, registryPasswordFile, IMAGE_NAMES, REGISTRY_PASSWORD_VAR };
