'use strict';

/**
 * Phase 1, preflight: is everything in place before anything is built?
 *
 * On the parts machine: the production tips, the pins against them, the
 * editor, R2 and Azure access, disk space.
 * On the installer machine, also: signing, notarization, all 12 pieces in R2
 * with their pin entries in the production commit, the version, and a clean
 * checkout at the production commit.
 *
 * Every check runs; the phase fails at the end if any failed, listing them all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PARTS_BUCKET, TARGETS } = require('../config');
const { allPieces } = require('../pieces');

const MIN_FREE_GB = { parts: 60, installer: 40 };

function check(list, name, ok, detail) {
  list.push({ name, ok: Boolean(ok), detail });
}

async function freeGb(run, dir) {
  const result = await run('df', ['-Pk', dir]);
  const line = result.stdout.trim().split('\n').pop() || '';
  const kb = Number(line.split(/\s+/)[3]);
  return Number.isFinite(kb) ? Math.floor(kb / 1024 / 1024) : null;
}

async function commonChecks(ctx, checks) {
  const { git, repos } = ctx;
  await git.fetch(ctx.clientRoot, ['production', 'development']);
  const tips = {
    server: await git.tip(repos.server, 'production'),
    client: await git.tip(repos.client, 'production'),
    editor: await git.tip(repos.editor, 'production')
  };
  check(checks, 'Server production exists', tips.server, tips.server ? `LANA-AI production is ${tips.server.slice(0, 9)}` : 'LANA-AI has no production branch');
  check(checks, 'Client production exists', tips.client, tips.client ? `lana-ai-client production is ${tips.client.slice(0, 9)}` : 'lana-ai-client has no production branch');

  const pins = await ctx.pinsAt('origin/production');
  check(checks, 'Engine pin is the server production commit', pins.engine.commit === tips.server,
    pins.engine.commit === tips.server ? `both ${tips.server.slice(0, 9)}` : `the engine pin says ${String(pins.engine.commit).slice(0, 9)}, LANA-AI production is ${String(tips.server).slice(0, 9)}`);
  const pipTag = await git.tagCommit(repos.pip, pins.pip.tag);
  check(checks, 'Pip pin is its LANA.cpp tag', pipTag && pipTag.startsWith(String(pins.pip.commit).slice(0, 12)),
    `${pins.pip.tag} is ${String(pipTag).slice(0, 12)}, the pin says ${String(pins.pip.commit).slice(0, 12)}`);
  const redactorOk = await git.reachable(repos.redactor, pins.redactor.commit, 'main');
  check(checks, 'Redactor pin is on lana-redactor main', redactorOk, `lana-redactor ${String(pins.redactor.commit).slice(0, 12)}`);

  const serverEditor = JSON.parse(await git.remoteFile(repos.server, 'production', 'release/editor.lock.json'));
  check(checks, 'Editor locks match', serverEditor.commit === pins.editor.commit,
    `client ${String(pins.editor.commit).slice(0, 12)}, server ${String(serverEditor.commit).slice(0, 12)}`);
  const editorOk = await git.reachable(repos.editor, pins.editor.commit, 'production');
  check(checks, 'Editor commit is on lana-editor production', editorOk, `lana-editor ${String(pins.editor.commit).slice(0, 12)}`);

  let listing = [];
  try {
    const r2 = await ctx.r2();
    listing = await r2.list(PARTS_BUCKET, '');
    check(checks, 'R2 access', true, `${PARTS_BUCKET} lists ${listing.length} objects`);
  } catch (error) {
    check(checks, 'R2 access', false, error.message);
  }
  const aws = await ctx.run('aws', ['--version']);
  check(checks, 'aws command installed', aws.code === 0, aws.code === 0 ? 'found' : 'install the AWS CLI v2');
  return { tips, pins, listing };
}

/** azure-verify's own credential file (its service principal, never the operator's az login). */
function azureVerifyCredentials(env, home) {
  const file = env.LANA_AZURE_VERIFY_CREDENTIALS || path.join(home || os.homedir(), '.config', 'lana', 'azure-verify.json');
  if (!fs.existsSync(file)) {return { ok: false, detail: `no ${file}` };}
  const mode = fs.statSync(file).mode & 0o777;
  return mode === 0o600 ? { ok: true, detail: `${file} (600)` } : { ok: false, detail: `${file} must be mode 600` };
}

async function partsChecks(ctx, checks, found) {
  const missing = allPieces({ listing: found.listing, pins: found.pins, targets: ctx.targets }).filter((p) => p.state === 'missing');
  if (missing.some((p) => p.target === 'windows-x64' || p.target === 'linux-x64')) {
    const cred = azureVerifyCredentials(ctx.env, ctx.home);
    check(checks, 'Azure (azure-verify credentials)', cred.ok, cred.detail);
  }
  if (!ctx.serverRepo) {check(checks, 'LANA-AI checkout given', false, 'pass --server-repo <path to a LANA-AI checkout>');}
  // The release folder holds sources, builds and archives, so its disk is the one that counts, and only when something is built.
  const gb = await freeGb(ctx.run, ctx.workDir || ctx.home || process.env.HOME || '/');
  if (missing.length) {
    check(checks, 'Disk space', gb !== null && gb >= MIN_FREE_GB.parts, `${gb} GB free, ${MIN_FREE_GB.parts} GB needed to build ${missing.length} piece(s)${ctx.workDir ? '' : ' (or pass --work-dir on a bigger disk)'}`);
  } else {
    ctx.report.notes.push(`Every piece is in R2; nothing to build here (${gb} GB free).`);
  }
  const version = await ctx.packageVersionAt('origin/production');
  // On the parts machine the version is set in the pins phase; here it is only reported.
  ctx.report.notes.push(version === ctx.version ? `Client production already says ${version}.` : `Client production says ${version}; the pins phase sets ${ctx.version}.`);
  return found;
}

async function installerChecks(ctx, checks, found) {
  const version = await ctx.packageVersionAt('origin/production');
  check(checks, 'Version set', version === ctx.version, `client production says ${version}, this release is ${ctx.version}`);
  const head = await ctx.git.head(ctx.clientRoot);
  check(checks, 'Checkout is client production', head === found.tips.client, `this checkout is ${head.slice(0, 9)}, production is ${String(found.tips.client).slice(0, 9)}`);
  const clean = await ctx.git.clean(ctx.clientRoot);
  check(checks, 'Checkout is clean', clean, clean ? 'no local changes' : 'this checkout has local changes to tracked files');
  const pieces = allPieces({ listing: found.listing, pins: found.pins, targets: TARGETS });
  const notReady = pieces.filter((p) => p.state !== 'ready');
  check(checks, 'All 12 pieces in R2 with pin entries', notReady.length === 0,
    notReady.length ? `not ready: ${notReady.map((p) => `${p.target}/${p.part} (${p.state})`).join(', ')}` : '12 of 12');
  const ids = await ctx.run('security', ['find-identity', '-v', '-p', 'codesigning']);
  check(checks, 'Apple signing identity', /Developer ID Application/.test(ids.stdout), 'a Developer ID Application identity in the keychain');
  const missing = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter((name) => !ctx.env[name]);
  check(checks, 'Notarization settings', missing.length === 0, missing.length ? `not set: ${missing.join(', ')}` : 'set');
  const gb = await freeGb(ctx.run, ctx.clientRoot);
  check(checks, 'Disk space', gb !== null && gb >= MIN_FREE_GB.installer, `${gb} GB free, ${MIN_FREE_GB.installer} GB needed`);
}

async function preflight(ctx) {
  const checks = [];
  const found = await commonChecks(ctx, checks);
  if (ctx.mode === 'installers') {await installerChecks(ctx, checks, found);}
  else {await partsChecks(ctx, checks, found);}

  for (const c of checks) {ctx.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`);}
  const failed = checks.filter((c) => !c.ok);
  if (checks.find((c) => c.name === 'Engine pin is the server production commit' && c.ok)) {ctx.desk('gate.servercode');}
  if (failed.length) {
    const error = new Error(`Preflight: ${failed.length} check(s) failed: ${failed.map((c) => c.name).join('; ')}.`);
    error.checks = checks;
    throw error;
  }
  return { checks, found };
}

module.exports = { preflight, freeGb, azureVerifyCredentials, MIN_FREE_GB };
