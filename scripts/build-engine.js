#!/usr/bin/env node
'use strict';

/**
 * Builds build/engine/: the LANA engine folder the installer carries at <resources>/engine,
 * from the LANA-AI commit pinned in engine/engine-pin.json, using the backend's own build
 * (scripts/release/build-engine-bundle.js). Then checks it against the pin (commit, platform,
 * file count and tree sha256) and loads its native packages with this client's Electron run as
 * node, the way the installed app runs the engine (ELECTRON_RUN_AS_NODE=1).
 * Run it on each target system and processor before packaging; the package step refuses to build
 * without it or with a different folder (scripts/engine-before-pack.js).
 *
 *   LANA_ENGINE_SRC  a LANA-AI checkout at the pinned commit, with no local changes and its
 *                    node_modules installed (npm ci)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pins = require('./local-ai-pins');

const ROOT = path.resolve(__dirname, '..');

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function electronBinary() {
  return require(path.join(ROOT, 'node_modules', 'electron'));
}

function main() {
  const pin = require('../engine/engine-pin.json');
  const source = process.env.LANA_ENGINE_SRC;
  if (!source) {throw new Error('Set LANA_ENGINE_SRC to a LANA-AI checkout.');}
  const have = git(source, ['rev-parse', 'HEAD']);
  if (have !== pin.commit) {throw new Error(`LANA-AI is at ${have}, the client pins ${pin.commit}. Check out the pinned commit.`);}
  if (git(source, ['status', '--porcelain', '--untracked-files=no'])) {throw new Error('LANA-AI has local changes. Build from a clean checkout.');}

  const out = pins.engineDir(ROOT);
  execFileSync(process.execPath, [path.join(source, 'scripts', 'release', 'build-engine-bundle.js'), '--out', out], { cwd: source, stdio: 'inherit' });

  const problems = pins.checkEngine({ root: ROOT, platformName: process.platform, archName: process.arch, pin });
  const key = pins.platformKey(process.platform, process.arch);
  if (problems.length) {
    const digest = pins.treeDigest(out);
    throw new Error(`${problems.join(' ')} (This build: "${key}": { "files": ${digest.files}, "treeSha256": "${digest.sha256}" }.)`);
  }

  // The native packages load under this client's Electron, as they will in the installed app.
  const manifest = JSON.parse(fs.readFileSync(path.join(out, pins.ENGINE_MANIFEST), 'utf8'));
  const script = manifest.externals.map((name) => `require(${JSON.stringify(path.join(out, 'node_modules', name))});`).join('');
  execFileSync(electronBinary(), ['-e', script], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.stdout.write(`build/engine matches the pin for ${key} (LANA-AI ${pin.commit.slice(0, 9)}, ${manifest.files} files); ${manifest.externals.join(', ')} load under Electron.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`build-engine: ${error.message}\n`);
    process.exit(1);
  }
}
