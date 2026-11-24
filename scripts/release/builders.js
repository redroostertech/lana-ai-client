'use strict';

/**
 * Builds the missing pieces for one system with the client's own build
 * scripts, checks them, packs them and uploads them.
 *
 *   Mac, Apple chip   here, natively
 *   Mac, Intel        here, under Rosetta (arch -x86_64), with portable x64
 *                     tools in the release folder: nothing is installed
 *                     system-wide
 *   Windows, Linux    on a throwaway Azure VM, through LANA-AI's
 *                     azure-verify.sh client-parts job
 *
 * Each system builds from its own client checkout (a detached worktree at
 * client production), because build/pip, build/engine and build/redactor
 * hold one system at a time.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PARTS_BUCKET, REPOS } = require('./config');
const { archiveKey } = require('./pieces');
const { githubUrl } = require('./git');
const { scrub } = require('./exec');
const { engineLoadCheck, redactorSmoke, embedMatch } = require('./smoke');
const { checkEngine, treeDigest } = require('../local-ai-pins');

const NODE_X64 = Object.freeze({
  version: '24.21.0',
  file: 'node-v24.21.0-darwin-x64.tar.gz',
  base: 'https://nodejs.org/dist/v24.21.0'
});

// What build-pip.sh and build-engine.js print when the pin has no entry for this system yet.
const PIP_ENTRY = /Record: "([a-z0-9-]+)": (\{[^}]*\})/;
const ENGINE_ENTRY = /\(This build: "([a-z0-9-]+)": (\{[^}]*\})\.\)/;

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** A new pin entry printed by a build script, or null. */
function parseNewEntry(part, output) {
  const match = (part === 'pip' ? PIP_ENTRY : ENGINE_ENTRY).exec(String(output));
  return match ? { target: match[1], entry: JSON.parse(match[2]) } : null;
}

/**
 * A source at exactly one commit, with no remote and no history: git
 * rev-parse HEAD is the real commit, so the build scripts' commit and clean
 * checks run unchanged.
 */
async function prepareSource(ctx, repoKey, commit) {
  const dir = path.join(ctx.dir, 'src', `${repoKey}-${commit.slice(0, 12)}`);
  if (fs.existsSync(path.join(dir, '.git'))) {
    const head = (await ctx.run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
    if (head === commit) {return dir;}
    throw new Error(`${dir} is at ${head.slice(0, 12)}, not ${commit.slice(0, 12)}. Remove it and run again.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const args of [['init', '--quiet'], ['fetch', '--quiet', '--depth', '1', githubUrl(REPOS[repoKey]), commit], ['checkout', '--quiet', '--detach', 'FETCH_HEAD']]) {
    // eslint-disable-next-line no-await-in-loop -- in order
    const result = await ctx.run('git', ['-C', dir, ...args]);
    if (result.code !== 0) {throw new Error(`Could not get ${REPOS[repoKey]} at ${commit.slice(0, 12)} (${scrub(result.stderr)}).`);}
  }
  return dir;
}

/** A client checkout for one system, at client production. */
async function clientCheckout(ctx, target) {
  const dir = path.join(ctx.dir, 'client', target);
  if (!fs.existsSync(dir)) {
    const result = await ctx.run('git', ['-C', ctx.clientRoot, 'worktree', 'add', '--detach', dir, 'origin/production']);
    if (result.code !== 0) {throw new Error(`Could not make the ${target} client checkout (${scrub(result.stderr)}).`);}
  }
  return dir;
}

/**
 * Portable x64 tools for the Intel Mac build, in the release folder: the
 * official Node tarball checked against SHASUMS256, CPython 3.11 x86_64 from
 * uv, and a venv with cmake, ninja and pyinstaller. Returns the environment
 * the Intel build runs with.
 */
async function intelToolchain(ctx) {
  const tools = path.join(ctx.dir, 'tools-x64');
  const nodeDir = path.join(tools, `node-v${NODE_X64.version}-darwin-x64`);
  fs.mkdirSync(tools, { recursive: true });
  const step = async (command, args, what) => {
    const result = await ctx.run(command, args, { cwd: tools });
    if (result.code !== 0) {throw new Error(`Intel tools: could not ${what} (${scrub(result.stderr)}).`);}
    return result.stdout;
  };
  if (!fs.existsSync(path.join(nodeDir, 'bin', 'node'))) {
    await step('curl', ['-fsSLO', `${NODE_X64.base}/${NODE_X64.file}`], 'download Node');
    const sums = await step('curl', ['-fsSL', `${NODE_X64.base}/SHASUMS256.txt`], 'download Node checksums');
    const want = (sums.split('\n').find((line) => line.endsWith(`  ${NODE_X64.file}`)) || '').split(/\s+/)[0];
    const have = sha256File(path.join(tools, NODE_X64.file));
    if (!want || want !== have) {throw new Error(`Intel tools: ${NODE_X64.file} does not match nodejs.org's SHASUMS256.`);}
    await step('tar', ['-xzf', NODE_X64.file], 'unpack Node');
  }
  await step('uv', ['python', 'install', 'cpython-3.11-macos-x86_64-none'], 'install x86_64 Python 3.11');
  const python = (await step('uv', ['python', 'find', 'cpython-3.11-macos-x86_64-none'], 'find x86_64 Python 3.11')).trim();
  const venv = path.join(tools, 'venv');
  if (!fs.existsSync(path.join(venv, 'bin', 'python'))) {
    await step('arch', ['-x86_64', python, '-m', 'venv', venv], 'make the x64 venv');
    await step('arch', ['-x86_64', path.join(venv, 'bin', 'python'), '-m', 'pip', 'install', '--quiet', 'cmake', 'ninja', 'pyinstaller'], 'install cmake, ninja and pyinstaller');
  }
  return {
    ...ctx.env,
    PATH: [path.join(nodeDir, 'bin'), path.join(venv, 'bin'), ctx.env.PATH].join(':'),
    // npm ci under Rosetta still picks the arm64 Electron unless told.
    npm_config_arch: 'x64'
  };
}

/** Runs a build step for a Mac system, under Rosetta for Intel. Output goes to the system's log. */
function macRunner(ctx, target, env) {
  const logFile = path.join(ctx.dir, 'logs', `${target}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  return async (command, args, cwd, extraEnv = {}) => {
    const full = target === 'macos-x64' ? ['arch', ['-x86_64', command, ...args]] : [command, args];
    return ctx.run(full[0], full[1], { cwd, env: { ...env, ...extraEnv }, logFile });
  };
}

/** The 12-character id of a built piece: Pip's sha256, the engine's tree sha256, the redactor's commit. */
function builtId({ part, root, platform, redactorCommit }) {
  if (part === 'pip') {return sha256File(path.join(root, 'build', 'pip', platform === 'win32' ? 'lqe.exe' : 'lqe')).slice(0, 12);}
  if (part === 'engine') {return treeDigest(path.join(root, 'build', 'engine')).sha256.slice(0, 12);}
  return redactorCommit.slice(0, 12);
}

/**
 * Packs build/<part> in the agreed shape (Pip and engine: the folder's
 * contents at the root; redactor: the redactor folder itself), writes its
 * .sha256 in shasum format, and uploads both. COPYFILE_DISABLE keeps macOS
 * ._ files out.
 */
async function packAndUpload(ctx, { target, part, root, id }) {
  const out = path.join(ctx.dir, 'archives', target);
  fs.mkdirSync(out, { recursive: true });
  const name = `${part}-${id}.tar.gz`;
  const file = path.join(out, name);
  const tarArgs = part === 'redactor' ? ['-czf', file, '-C', path.join(root, 'build'), 'redactor'] : ['-czf', file, '-C', path.join(root, 'build', part), '.'];
  const tar = await ctx.run('tar', tarArgs, { env: { ...ctx.env, COPYFILE_DISABLE: '1' } });
  if (tar.code !== 0) {throw new Error(`${target}/${part}: could not pack it (${scrub(tar.stderr)}).`);}
  fs.writeFileSync(`${file}.sha256`, `${sha256File(file)}  ${name}\n`);
  const r2 = await ctx.r2();
  const key = archiveKey(target, part, id);
  await r2.upload(file, PARTS_BUCKET, key, 'application/gzip');
  await r2.upload(`${file}.sha256`, PARTS_BUCKET, `${key}.sha256`, 'text/plain');
  ctx.report.uploaded.push(`${PARTS_BUCKET}/${key}`);
  return key;
}

/**
 * The Python the redactor builds with, for one Mac system: a venv from uv's
 * CPython 3.11 for that processor, with lana-redactor, pyinstaller and the
 * spaCy model installed, as build-redactor.sh asks.
 */
async function redactorPython(ctx, target, source, step) {
  const venv = path.join(ctx.dir, 'redactor-venv', target);
  const python = path.join(venv, 'bin', 'python');
  if (fs.existsSync(path.join(venv, '.ready'))) {return python;}
  const spec = target === 'macos-x64' ? 'cpython-3.11-macos-x86_64-none' : 'cpython-3.11-macos-aarch64-none';
  const run = async (command, args, what, extra = {}) => {
    const result = await step(command, args, source, extra);
    if (result.code !== 0) {throw new Error(`${target}: could not ${what} for the redactor (exit ${result.code}; see logs/${target}.log).`);}
    return result;
  };
  await run('uv', ['python', 'install', spec], 'install Python 3.11');
  const found = await ctx.run('uv', ['python', 'find', spec]);
  await run(found.stdout.trim(), ['-m', 'venv', venv], 'make its venv');
  await run(python, ['-m', 'pip', 'install', '--quiet', source, 'pyinstaller'], 'install lana-redactor and pyinstaller');
  await run('bash', [path.join(source, 'install-models.sh')], 'install the spaCy model', { PYTHON: python });
  fs.writeFileSync(path.join(venv, '.ready'), `built for ${path.basename(source)}\n`);
  return python;
}

/** Fetches the pinned embedding model once into the release folder, checked by sha256. */
async function embedModel(ctx) {
  const pin = JSON.parse(fs.readFileSync(path.join(ctx.serverRepo, 'deploy', 'railway', 'embed', 'embed-pin.json'), 'utf8'));
  const file = path.join(ctx.dir, 'models', pin.model.file);
  if (!fs.existsSync(file) || sha256File(file) !== pin.model.sha256) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const result = await ctx.run('curl', ['-fsSL', '-o', file, pin.model.url]);
    if (result.code !== 0 || sha256File(file) !== pin.model.sha256) {throw new Error(`Could not get the embedding model ${pin.model.file} with its pinned sha256.`);}
  }
  return { file, sha256: pin.model.sha256, pin };
}

/**
 * Builds the given pieces for a Mac system. Returns
 * [{ part, key, newEntry, checks }] for what it uploaded.
 */
async function buildMac(ctx, target, parts, pins) {
  const root = await clientCheckout(ctx, target);
  const env = target === 'macos-x64' ? await intelToolchain(ctx) : { ...ctx.env };
  const step = macRunner(ctx, target, env);
  const must = async (promise, what) => {
    const result = await promise;
    if (result.code !== 0) {throw new Error(`${target}: ${what} failed (exit ${result.code}; see logs/${target}.log).`);}
    return result;
  };
  await must(step('npm', ['ci', '--no-audit', '--no-fund'], root), 'npm ci');
  const done = [];
  for (const part of parts) {
    const checks = [];
    let newEntry = null;
    if (part === 'pip') {
      const source = await prepareSource(ctx, 'pip', pins.pip.commit);
      const result = await step('bash', ['scripts/build-pip.sh'], root, { LANA_PIP_SRC: source });
      newEntry = result.code === 0 ? null : parseNewEntry('pip', result.stderr);
      if (result.code !== 0 && !newEntry) {throw new Error(`${target}: build-pip.sh failed (exit ${result.code}; see logs/${target}.log).`);}
      const model = await embedModel(ctx);
      const lqe = path.join(root, 'build', 'pip', 'lqe');
      for (const gpuLayers of target === 'macos-arm64' ? [0, 99] : [0]) {
        // eslint-disable-next-line no-await-in-loop
        checks.push(...await embedMatch({ run: ctx.run, serverRepo: ctx.serverRepo, lqe, modelPath: model.file, modelSha: model.sha256, gpuLayers }));
      }
      const verified = (model.pin.pip.verified_builds || []).some((b) => b.build === pins.pip.build);
      if (!verified) {ctx.report.waiting.push(`Add Pip build ${pins.pip.build} to LANA-AI deploy/railway/embed/embed-pin.json verified_builds (its match check passed on ${target}).`);}
    } else if (part === 'engine') {
      const source = await prepareSource(ctx, 'server', pins.engine.commit);
      await must(step('npm', ['ci', '--no-audit', '--no-fund'], source), 'npm ci in LANA-AI');
      const result = await step(process.execPath, ['scripts/build-engine.js'], root, { LANA_ENGINE_SRC: source });
      newEntry = result.code === 0 ? null : parseNewEntry('engine', result.stderr);
      if (result.code !== 0 && !newEntry) {throw new Error(`${target}: build-engine.js failed (exit ${result.code}; see logs/${target}.log).`);}
      if (newEntry) {
        // build-engine.js stops before its load check when the pin has no entry: run it here.
        const electron = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
        checks.push(...await engineLoadCheck({ run: ctx.run, electron, engineDir: path.join(root, 'build', 'engine'), env }));
        const withEntry = { ...pins.engine, builds: { ...pins.engine.builds, [target]: newEntry.entry } };
        checks.push(...checkEngine({ root, platformName: 'darwin', archName: target.split('-')[1], pin: withEntry }));
      }
    } else {
      const source = await prepareSource(ctx, 'redactor', pins.redactor.commit);
      const python = await redactorPython(ctx, target, source, step);
      await must(step('bash', ['scripts/build-redactor.sh'], root, { LANA_REDACTOR_SRC: source, LANA_REDACTOR_PYTHON: python }), 'build-redactor.sh');
      checks.push(...await redactorSmoke({ binary: path.join(root, 'build', 'redactor', 'lana-redactor', 'lana-redactor') }));
    }
    if (checks.length) {throw new Error(`${target}/${part}: ${checks.join('; ')}. Not uploaded.`);}
    const id = builtId({ part, root, platform: 'darwin', redactorCommit: pins.redactor.commit });
    const key = await packAndUpload(ctx, { target, part, root, id });
    done.push({ part, key, newEntry: newEntry && newEntry.entry });
  }
  return done;
}

/**
 * Builds the given pieces for Windows or Linux on a throwaway Azure VM with
 * LANA-AI's azure-verify.sh client-parts job. The job makes its own resource
 * group, deletes it on any exit, builds with the client's scripts, runs the
 * same checks (engine load, redactor smoke, the embedding match on the CPU)
 * and brings back one folder per piece: <part>.tar.gz, its .sha256 and
 * result.json ({ id, newEntry, checks }).
 */
async function buildAzure(ctx, target, parts, pins) {
  const out = path.join(ctx.dir, 'azure', target);
  fs.mkdirSync(out, { recursive: true });
  const clientCommit = (await ctx.git.tip(REPOS.client, 'production'));
  const logFile = path.join(ctx.dir, 'logs', `${target}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const result = await ctx.run('bash', [
    path.join(ctx.serverRepo, 'scripts', 'release', 'azure-verify.sh'), 'client-parts',
    '--target', target, '--parts', parts.join(','), '--client-commit', clientCommit,
    '--pip-commit', pins.pip.commit, '--engine-commit', pins.engine.commit, '--redactor-commit', pins.redactor.commit,
    '--out', out
  ], { cwd: ctx.serverRepo, env: ctx.env, logFile });
  if (result.code !== 0) {throw new Error(`${target}: the Azure build failed (exit ${result.code}; see logs/${target}.log). Its resource group is deleted.`);}
  const done = [];
  for (const part of parts) {
    const folder = path.join(out, part);
    const outcome = JSON.parse(fs.readFileSync(path.join(folder, 'result.json'), 'utf8'));
    if (outcome.checks && outcome.checks.length) {throw new Error(`${target}/${part}: ${outcome.checks.join('; ')}. Not uploaded.`);}
    const archive = path.join(folder, `${part}.tar.gz`);
    const want = fs.readFileSync(`${archive}.sha256`, 'utf8').split(/\s+/)[0];
    if (sha256File(archive) !== want) {throw new Error(`${target}/${part}: the archive from the VM does not match its .sha256. Not uploaded.`);}
    const r2 = await ctx.r2();
    const key = archiveKey(target, part, outcome.id);
    const name = path.basename(key);
    fs.writeFileSync(`${archive}.sha256`, `${want}  ${name}\n`);
    await r2.upload(archive, PARTS_BUCKET, key, 'application/gzip');
    await r2.upload(`${archive}.sha256`, PARTS_BUCKET, `${key}.sha256`, 'text/plain');
    ctx.report.uploaded.push(`${PARTS_BUCKET}/${key}`);
    done.push({ part, key, newEntry: outcome.newEntry || null });
  }
  return done;
}

module.exports = {
  NODE_X64, parseNewEntry, prepareSource, clientCheckout, intelToolchain, builtId, packAndUpload, embedModel, buildMac, buildAzure, sha256File
};
