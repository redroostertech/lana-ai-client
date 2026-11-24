'use strict';

/**
 * Phase 3, pins and version: one client branch off development that records
 * every new build in the pin files, sets the release version with
 * scripts/generate-version.js, and points the engine pin at the production
 * branch. Then the run stops for review.
 *
 * An entry comes from the build this run made, or, for a piece built earlier
 * (by hand or by another run), from its archive in the bucket: the uploaded
 * archive is the source of truth, because a local Pip build's sha256 differs
 * from one computer to the next.
 */

const fs = require('fs');
const path = require('path');
const { PARTS_BUCKET, TARGETS } = require('../config');
const { allPieces } = require('../pieces');
const { scrub } = require('../exec');
const { treeDigest, platformKey } = require('../../local-ai-pins');
const { platformNameOf, archNameOf } = require('../../client-parts');
const { sha256File } = require('../builders');

// public_html is a tracked symbolic link to src: git stages the real path only.
const VERSION_FILES = ['package.json', 'src/version.js', 'src/js/version.js'];
const PIN_PATHS = { pip: 'pip/pip-pin.json', engine: 'engine/engine-pin.json' };

function branchName(version) {
  return `release/${version}-pins`;
}

/** Unpacks an archive from the bucket and reads the entry the pin needs from it. */
async function entryFromArchive(ctx, { target, part, archive }, pins) {
  const work = path.join(ctx.dir, 'entries', `${target}-${part}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const file = path.join(work, 'part.tar.gz');
  const r2 = await ctx.r2();
  await r2.download(PARTS_BUCKET, archive.key, file);
  const want = (await r2.getText(PARTS_BUCKET, `${archive.key}.sha256`)).split(/\s+/)[0];
  if (sha256File(file) !== want) {throw new Error(`${target}/${part}: ${archive.key} does not match its .sha256.`);}
  const dir = path.join(work, part);
  fs.mkdirSync(dir);
  const tar = await ctx.run('tar', ['-xzf', file, '-C', dir]);
  if (tar.code !== 0) {throw new Error(`${target}/${part}: could not unpack ${archive.key} (${scrub(tar.stderr)}).`);}
  // Either shape: the folder's contents at the root, or one folder named after the part.
  const entries = fs.readdirSync(dir);
  const root = entries.length === 1 && entries[0] === part ? path.join(dir, part) : dir;
  if (part === 'pip') {
    const lqe = path.join(root, target.startsWith('windows') ? 'lqe.exe' : 'lqe');
    if (!fs.existsSync(lqe)) {throw new Error(`${target}/pip: ${archive.key} holds no ${path.basename(lqe)}.`);}
    return { sha256: sha256File(lqe), bytes: fs.statSync(lqe).size, source: `Pip ${pins.pip.version} (${pins.pip.build}) built for ${target}; kept in ${PARTS_BUCKET} at ${archive.key}.` };
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'engine-manifest.json'), 'utf8'));
  if (manifest.commit !== pins.engine.commit) {throw new Error(`${target}/engine: ${archive.key} was built from LANA-AI ${String(manifest.commit).slice(0, 12)}, the pin says ${pins.engine.commit.slice(0, 12)}.`);}
  if (platformKey(manifest.platform, manifest.arch) !== target) {throw new Error(`${target}/engine: ${archive.key} is for ${manifest.platform}-${manifest.arch}.`);}
  const digest = treeDigest(root);
  return { files: digest.files, treeSha256: digest.sha256 };
}

/** The entries the production pins still lack, for pip and engine on every system. */
async function missingEntries(ctx, pins, listing) {
  const found = {};
  const missing = [];
  for (const status of allPieces({ listing, pins, targets: TARGETS }).filter((s) => s.part !== 'redactor')) {
    const name = `${status.target}/${status.part}`;
    if (status.state === 'ready') {continue;}
    if (ctx.state.newEntries[name]) {found[name] = ctx.state.newEntries[name];}
    // A dry run does not download archives; it says where the entry would come from.
    else if (status.state === 'unpinned') {found[name] = ctx.dryRun ? { fromArchive: status.archive.key } : await entryFromArchive(ctx, status, pins);}
    else {missing.push(name);}
  }
  return { found, missing };
}

function applyEntries(pinText, part, entries) {
  const pin = JSON.parse(pinText);
  pin.builds = pin.builds || {};
  for (const [name, entry] of Object.entries(entries)) {
    const [target, which] = name.split('/');
    if (which === part) {pin.builds[target] = entry;}
  }
  // The engine is built from LANA-AI production (branch model, 2026-11-23).
  if (part === 'engine') {pin.branch = 'production';}
  return `${JSON.stringify(pin, null, 2)}\n`;
}

/** True when development already carries every pin entry, the version and the engine branch. */
async function developmentReady(ctx, listing) {
  await ctx.git.fetch(ctx.clientRoot, ['development']);
  const devPins = await ctx.pinsAt('origin/development');
  const devVersion = await ctx.packageVersionAt('origin/development');
  return devVersion === ctx.version && devPins.engine.branch === 'production'
    && allPieces({ listing, pins: devPins, targets: TARGETS }).every((p) => p.state === 'ready');
}

async function pins(ctx) {
  const prodPins = await ctx.pinsAt('origin/production');
  const r2 = await ctx.r2();
  const listing = await r2.list(PARTS_BUCKET, '');
  // A rerun after review: the branch is merged, so the next step is the gate.
  if (await developmentReady(ctx, listing)) {
    ctx.log(`  development already has every pin entry and version ${ctx.version}. Next is the production gate.`);
    ctx.desk('gate.version');
    return {};
  }
  // A rerun before review: the branch is already pushed. Commit nothing more.
  if (ctx.state.pinsBranch) {
    ctx.report.waiting.push(`Review branch ${ctx.state.pinsBranch} (pin entries and version ${ctx.version}), then merge it to development. Then run this command again.`);
    return { stop: true };
  }
  const { found, missing } = await missingEntries(ctx, prodPins, listing);
  if (missing.length) {throw new Error(`Pins: these pieces are not in the bucket yet, so they have no entry: ${missing.join(', ')}. Run the pieces phase first.`);}
  const version = await ctx.packageVersionAt('origin/production');
  const engineBranchOk = prodPins.engine.branch === 'production';
  for (const [name, entry] of Object.entries(found)) {ctx.log(`  new pin entry: ${name}${entry.fromArchive ? ` (read from ${entry.fromArchive})` : ''}`);}
  if (!Object.keys(found).length && version === ctx.version && engineBranchOk) {
    ctx.log('  Production already has every pin entry and the version. Nothing to change.');
    ctx.desk('gate.version');
    return { branch: null };
  }
  if (ctx.dryRun) {
    ctx.log(`  [dry run] would make branch ${branchName(ctx.version)} off development with ${Object.keys(found).length} pin entr${Object.keys(found).length === 1 ? 'y' : 'ies'}${version === ctx.version ? '' : `, the version ${ctx.version} (now ${version})`}${engineBranchOk ? '' : ', and the engine pin\'s branch set to production'}, then stop for review`);
    return { branch: null };
  }

  const branch = branchName(ctx.version);
  const dir = path.join(ctx.dir, 'pins-branch');
  const git = (args, what) => ctx.git.git(['-C', dir, ...args], what);
  if (!fs.existsSync(dir)) {
    await ctx.git.fetch(ctx.clientRoot, ['development']);
    await ctx.git.git(['-C', ctx.clientRoot, 'worktree', 'add', '-b', branch, dir, 'origin/development'], `make branch ${branch}`);
  }
  for (const part of ['pip', 'engine']) {
    const file = path.join(dir, PIN_PATHS[part]);
    fs.writeFileSync(file, applyEntries(fs.readFileSync(file, 'utf8'), part, found));
  }
  const gen = await ctx.run(process.execPath, ['scripts/generate-version.js', ctx.version], { cwd: dir });
  if (gen.code !== 0) {throw new Error(`Pins: generate-version.js failed (${scrub(gen.stderr)}).`);}
  // Only these files. generate-version.js also writes .env, which is never committed.
  const files = [...Object.values(PIN_PATHS), ...VERSION_FILES];
  await git(['add', '--', ...files], 'stage the pin and version files');
  const names = Object.keys(found);
  const message = [
    `release(${ctx.version}): pin entries and version`,
    '',
    names.length ? `New pin entries: ${names.join(', ')}.` : 'No new pin entries.',
    `Version ${ctx.version} set with scripts/generate-version.js. The engine pin follows LANA-AI production.`
  ].join('\n');
  await git(['commit', '--quiet', '-m', message], 'commit the pin entries');
  await git(['push', '--quiet', '-u', 'origin', branch], `push ${branch}`);
  ctx.state.pinsBranch = branch;
  ctx.report.waiting.push(`Review branch ${branch} (pin entries and version ${ctx.version}), then merge it to development. Then run this command again: it goes on to the production gate.`);
  ctx.desk('gate.version');
  return { branch, stop: true };
}

module.exports = { pins, branchName, applyEntries, entryFromArchive, missingEntries, VERSION_FILES, platformNameOf, archNameOf };
