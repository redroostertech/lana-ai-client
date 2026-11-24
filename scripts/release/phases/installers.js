'use strict';

/**
 * Phase 6, installers, on the installer machine only.
 *
 *   1. A fresh links file: read-only links to the 12 pieces, valid 7 days,
 *      written to a private file (600) and never printed.
 *   2. fetch-client-parts.js fills build/parts from it.
 *   3. build-client.sh for Mac Apple chip, Mac Intel, Windows and Linux in
 *      one session (no --clean; --publish on the last one).
 *   4. Checks on what was built: every installer and blockmap, the Mac apps
 *      signed and notarized and named LANA AI, the data folder name "Lana AI"
 *      inside app.asar, and the parts the build packs itself (the editor,
 *      Briefs speech, the Mac helpers).
 */

const fs = require('fs');
const path = require('path');
const { PARTS_BUCKET, TARGETS, LINK_SECONDS, DESK_SYSTEM } = require('../config');
const { allPieces } = require('../pieces');
const { scrub } = require('../exec');
const { missingMacArchs } = require('../../client-parts');

const BUILDS = Object.freeze([
  { target: 'macos-arm64', args: ['--platform', 'mac', '--arch', 'arm64'] },
  { target: 'macos-x64', args: ['--platform', 'mac', '--arch', 'x64'] },
  { target: 'windows-x64', args: ['--platform', 'windows'] },
  { target: 'linux-x64', args: ['--platform', 'linux'] }
]);

// What each system's build must leave in dist/, by exact name (electron-builder.client.json artifactName).
function EXPECTED_NAMES(version) {
  const base = `LanaAI--genesis--${version}`;
  return {
    'macos-arm64': [`${base}-arm64.dmg`, `${base}-arm64.dmg.blockmap`, `${base}-arm64.zip`, `${base}-arm64.zip.blockmap`],
    'macos-x64': [`${base}-x64.dmg`, `${base}-x64.dmg.blockmap`, `${base}-x64.zip`, `${base}-x64.zip.blockmap`],
    'windows-x64': [`${base}-setup.exe`, `${base}-setup.exe.blockmap`, `${base}.zip`],
    'linux-x64': [`${base}.AppImage`, `${base}.deb`]
  };
}

// Where electron-builder leaves each Mac app (build-client.sh moves only the dmg and zip files).
const MAC_APP_DIRS = Object.freeze({ 'macos-arm64': ['mac-arm64'], 'macos-x64': ['mac', 'mac-x64'] });

function walk(dir, depth = 4, out = []) {
  if (!fs.existsSync(dir) || depth < 0) {return out;}
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory() && !entry.name.endsWith('.app')) {walk(full, depth - 1, out);}
  }
  return out;
}

/** The links file text. One line per piece, plus its .sha256 link. */
async function makeLinksFile(ctx, statuses) {
  const r2 = await ctx.r2();
  const expires = new Date(Date.now() + LINK_SECONDS * 1000).toISOString();
  const lines = [`# LANA AI ${ctx.version} parts links. Read-only, private. Expires ${expires}. Never paste these links anywhere.`];
  for (const s of statuses) {
    // eslint-disable-next-line no-await-in-loop
    lines.push(`${s.target}/${s.part} ${await r2.presign(PARTS_BUCKET, s.archive.key, LINK_SECONDS)}`);
    // eslint-disable-next-line no-await-in-loop
    lines.push(`${s.target}/${s.part}.sha256 ${await r2.presign(PARTS_BUCKET, `${s.archive.key}.sha256`, LINK_SECONDS)}`);
  }
  const file = path.join(ctx.dir, 'parts-links.txt');
  fs.mkdirSync(ctx.dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  ctx.state.linksFile = { expires, made: new Date().toISOString() };
  return { file, expires };
}

/** Problems with one Mac app: signature, notarization, names, packed parts. */
async function checkMacApp(ctx, target, app) {
  const problems = [];
  if (path.basename(app) !== 'LANA AI.app') {problems.push(`${target}: the app is named ${path.basename(app)}, not LANA AI.app`);}
  const sign = await ctx.run('codesign', ['--verify', '--deep', '--strict', app]);
  if (sign.code !== 0) {problems.push(`${target}: codesign --verify failed (${scrub(sign.stderr)})`);}
  const gate = await ctx.run('spctl', ['-a', '-vv', '-t', 'exec', app]);
  if (!/Notarized Developer ID/.test(`${gate.stdout}${gate.stderr}`)) {problems.push(`${target}: spctl does not say Notarized Developer ID`);}
  const resources = path.join(app, 'Contents', 'Resources');
  for (const helper of ['screen-voice/lana-screen-voice', 'briefs/LanaBleWake']) {
    const file = path.join(resources, helper);
    if (!fs.existsSync(file)) {problems.push(`${target}: Mac helper ${helper} is not packed`);continue;}
    // eslint-disable-next-line no-await-in-loop
    const lipo = await ctx.run('lipo', ['-archs', file]);
    const missing = missingMacArchs(lipo.stdout);
    if (missing.length) {problems.push(`${target}: Mac helper ${helper} lacks ${missing.join(', ')}`);}
  }
  return problems.concat(checkResources(target, resources));
}

/** The editor, Briefs speech and the data folder name, in an unpacked app's resources folder. */
function checkResources(target, resources, deps = {}) {
  const problems = [];
  if (!fs.existsSync(path.join(resources, 'lana-editor'))) {problems.push(`${target}: the document editor is not packed`);}
  const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules');
  const speech = fs.existsSync(unpacked) ? fs.readdirSync(unpacked).filter((name) => name.startsWith('sherpa-onnx-') && name !== 'sherpa-onnx-node') : [];
  if (!speech.length) {problems.push(`${target}: Briefs speech (sherpa-onnx for this system) is not packed`);}
  const asar = deps.asar || require('@electron/asar');
  try {
    const pkg = JSON.parse(asar.extractFile(path.join(resources, 'app.asar'), 'package.json').toString('utf8'));
    if (pkg.productName !== 'Lana AI') {problems.push(`${target}: app.asar says productName "${pkg.productName}"; it must stay "Lana AI" so people keep their data`);}
  } catch (error) {
    problems.push(`${target}: could not read package.json in app.asar (${error.message})`);
  }
  return problems;
}

async function checkBuilds(ctx, dist) {
  const files = walk(dist);
  const problems = [];
  const names = new Set(files.map((file) => path.basename(file)));
  const expected = EXPECTED_NAMES(ctx.version);
  for (const target of TARGETS) {
    for (const name of expected[target]) {
      if (!names.has(name)) {problems.push(`${target}: no ${name} in dist`);}
    }
  }
  for (const target of ['macos-arm64', 'macos-x64']) {
    const app = MAC_APP_DIRS[target].map((dir) => walk(path.join(dist, dir), 1).find((file) => file.endsWith('.app'))).find(Boolean);
    if (!app) {problems.push(`${target}: no .app in dist/${MAC_APP_DIRS[target].join(' or dist/')}`);continue;}
    // eslint-disable-next-line no-await-in-loop
    problems.push(...await checkMacApp(ctx, target, app));
  }
  for (const [target, folder] of [['windows-x64', 'win-unpacked'], ['linux-x64', 'linux-unpacked']]) {
    const dir = files.find((file) => path.basename(file) === folder);
    if (!dir) {problems.push(`${target}: no ${folder} in dist to check`);continue;}
    problems.push(...checkResources(target, path.join(dir, 'resources')));
  }
  return problems;
}

async function installers(ctx) {
  const r2 = await ctx.r2();
  const pins = await ctx.pinsAt('origin/production');
  const statuses = allPieces({ listing: await r2.list(PARTS_BUCKET, ''), pins, targets: TARGETS });
  const notReady = statuses.filter((s) => s.state !== 'ready');
  if (notReady.length) {throw new Error(`Installers: not every piece is ready: ${notReady.map((s) => `${s.target}/${s.part}`).join(', ')}. Nothing was built.`);}
  if (!fs.existsSync(path.join(ctx.clientRoot, 'node_modules'))) {throw new Error('Installers: run npm ci in this checkout first.');}
  if (ctx.dryRun) {
    ctx.log('  [dry run] would make a fresh 7-day links file for the 12 pieces, fetch them, then build:');
    BUILDS.forEach((b, i) => ctx.log(`    build-client.sh --auto-discovery ${b.args.join(' ')} --skip-install${i === BUILDS.length - 1 ? ' --publish' : ''}`));
    return {};
  }
  const links = await makeLinksFile(ctx, statuses);
  ctx.desk('gate.linksfile');
  ctx.log(`  Links file made (private, expires ${links.expires}).`);
  const env = { ...ctx.env, LANA_CLIENT_PARTS_URLS: links.file };
  const logFile = path.join(ctx.dir, 'logs', 'installers.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fetched = await ctx.run(process.execPath, ['scripts/fetch-client-parts.js'], { cwd: ctx.clientRoot, env, logFile });
  if (fetched.code !== 0) {throw new Error(`Installers: fetch-client-parts.js failed (${scrub(fetched.stderr)}).`);}
  for (const [index, b] of BUILDS.entries()) {
    const args = ['scripts/build-client.sh', '--auto-discovery', ...b.args, '--skip-install', ...(index === BUILDS.length - 1 ? ['--publish'] : [])];
    ctx.log(`  Building ${b.target}...`);
    // eslint-disable-next-line no-await-in-loop
    const result = await ctx.run('bash', args, { cwd: ctx.clientRoot, env, logFile });
    if (result.code !== 0) {throw new Error(`Installers: build-client.sh for ${b.target} failed (exit ${result.code}; see logs/installers.log).`);}
  }
  const problems = await checkBuilds(ctx, path.join(ctx.clientRoot, 'dist'));
  if (problems.length) {throw new Error(`Installers: ${problems.length} check(s) failed: ${problems.join('; ')}.`);}
  ctx.desk('day.allready', 'day.built', 'day.notarized', 'day.datafolder', 'inst.blockmaps',
    'inst.mac_arm64.dmg', 'inst.mac_x64.dmg', 'inst.windows.exe', 'inst.linux.appimage',
    ...TARGETS.flatMap((t) => ['editor', 'speech'].map((c) => `${DESK_SYSTEM[t]}.${c}`)), 'mac_arm64.machelpers', 'mac_x64.machelpers');
  ctx.report.built.push('installers for all four systems');
  return {};
}

module.exports = { installers, makeLinksFile, checkBuilds, checkResources, checkMacApp, BUILDS, EXPECTED_NAMES, MAC_APP_DIRS };
