#!/usr/bin/env node
'use strict';

/**
 * Builds build/lana-editor/: the LANA document editor the client ships and runs on the person's
 * computer (electron-editor-service.js), from the lana-editor commit in editor/editor.lock.json.
 *
 * It clones that commit, runs `npm ci` and `npm run build` there, and copies what the editor
 * service needs into build/lana-editor, keeping the repository's own paths, because the bundled
 * server finds its browser folders relative to itself (packages/redline-service/src/server.ts):
 *
 *   packages/redline-service/dist/server.bundle.mjs   the service, self-contained Node ESM
 *   packages/redline-service/dist/THIRD_PARTY_LICENSES.txt
 *   packages/redline-service/dist/vendor/pdfjs/       pdf.js and its support folders, with licences
 *   packages/ooxml-kernel/dist/                       served at /kernel
 *   packages/editor/dist/                             served at /editor
 *   packages/editor/assets/fonts/                     served at /editor-fonts, with LICENSE.md
 *   packages/editor-embed/dist/                       served at /embed
 *   THIRD-PARTY-NOTICES.md
 *   editor-build.json                                 { repo, commit } of this build
 *
 * A folder already built from the pinned commit is left as it is. Run before packaging; the
 * package step refuses to build without it (scripts/editor-before-pack.js).
 *
 *   LANA_EDITOR_SRC       a lana-editor checkout at the pinned commit with no local changes, used
 *                         instead of a fresh clone
 *   LANA_EDITOR_REPO_URL  where to clone from instead of the pin's repo (for example over SSH)
 *   --force               rebuild even when build/lana-editor matches the pin
 *   --optional            on failure, warn and exit 0 (development start)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PIN_FILE = path.join(ROOT, 'editor', 'editor.lock.json');
const BUILD_MANIFEST = 'editor-build.json';
const SERVICE_ENTRY = 'packages/redline-service/dist/server.bundle.mjs';

/** What is copied from a built lana-editor checkout, at the same paths. */
const COPIED = Object.freeze([
  'packages/redline-service/dist/server.bundle.mjs',
  'packages/redline-service/dist/THIRD_PARTY_LICENSES.txt',
  'packages/redline-service/dist/vendor',
  'packages/ooxml-kernel/dist',
  'packages/editor/dist',
  'packages/editor/assets/fonts',
  'packages/editor-embed/dist',
  'THIRD-PARTY-NOTICES.md'
]);

/** Files the client loads by name, and the licences that must travel with the code. */
const REQUIRED_FILES = Object.freeze([
  SERVICE_ENTRY,
  'packages/redline-service/dist/THIRD_PARTY_LICENSES.txt',
  'packages/redline-service/dist/vendor/pdfjs/pdf.min.mjs',
  'packages/redline-service/dist/vendor/pdfjs/pdf.worker.min.mjs',
  'packages/redline-service/dist/vendor/pdfjs/LICENSE',
  'packages/ooxml-kernel/dist/browser.js',
  'packages/editor/dist/index.js',
  'packages/editor/assets/fonts/LICENSE.md',
  'packages/editor-embed/dist/index.js',
  'THIRD-PARTY-NOTICES.md'
]);

function editorDir(root = ROOT) {
  return path.join(root, 'build', 'lana-editor');
}

function readPin(file = PIN_FILE) {
  const pin = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof pin.repo !== 'string' || !pin.repo) {throw new Error(`${file} names no repo.`);}
  if (!/^[0-9a-f]{40}$/.test(String(pin.commit))) {throw new Error(`${file} must pin a full 40-character commit.`);}
  return pin;
}

/**
 * Problems with build/lana-editor against the pin, in plain words; an empty list means it is
 * the pinned build with every required file in place.
 */
function checkEditorBuild({ root = ROOT, pin }) {
  const dir = editorDir(root);
  const rel = path.relative(root, dir);
  const manifestFile = path.join(dir, BUILD_MANIFEST);
  if (!fs.existsSync(manifestFile)) {
    return [`The LANA editor is missing: ${rel}. Build it with node scripts/fetch-lana-editor.js first.`];
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_error) { manifest = {}; }
  if (manifest.commit !== pin.commit) {
    return [`${rel} is lana-editor ${manifest.commit || 'of no known commit'}, the client pins ${pin.commit}. Rebuild it with node scripts/fetch-lana-editor.js --force.`];
  }
  const missing = REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(dir, file)));
  return missing.length ? [`${rel} is missing ${missing.join(', ')}. Rebuild it with node scripts/fetch-lana-editor.js --force.`] : [];
}

/** The git commands that fetch exactly the pinned commit into an empty folder. */
function cloneCommands(pin, dir, repoUrl = pin.repo) {
  return [
    ['git', ['init', '-q', dir]],
    ['git', ['-C', dir, 'remote', 'add', 'origin', repoUrl]],
    ['git', ['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', pin.commit]],
    ['git', ['-C', dir, 'checkout', '-q', '--detach', pin.commit]]
  ];
}

// --include=dev: build-client.sh exports NODE_ENV=production before build:win, and a plain
// `npm ci` then drops the devDependencies the editor's build needs (tsc, @types/node).
function buildCommands() {
  return [
    ['npm', ['ci', '--include=dev', '--no-audit', '--no-fund']],
    ['npm', ['run', 'build']]
  ];
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function sourceCheckout(pin, work) {
  const given = process.env.LANA_EDITOR_SRC;
  if (given) {
    const have = git(given, ['rev-parse', 'HEAD']);
    if (have !== pin.commit) {throw new Error(`lana-editor is at ${have}, the client pins ${pin.commit}. Check out the pinned commit.`);}
    if (git(given, ['status', '--porcelain', '--untracked-files=no'])) {throw new Error('lana-editor has local changes. Build from a clean checkout.');}
    return given;
  }
  const dir = path.join(work, 'lana-editor');
  for (const [command, args] of cloneCommands(pin, dir, process.env.LANA_EDITOR_REPO_URL || pin.repo)) {run(command, args, work);}
  if (git(dir, ['rev-parse', 'HEAD']) !== pin.commit) {throw new Error('The clone is not at the pinned commit.');}
  return dir;
}

function build({ force = false } = {}) {
  const pin = readPin();
  const out = editorDir();
  if (!force && checkEditorBuild({ pin }).length === 0) {
    process.stdout.write(`build/lana-editor is already lana-editor ${pin.commit.slice(0, 9)}.\n`);
    return;
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-editor-'));
  try {
    const source = sourceCheckout(pin, work);
    for (const [command, args] of buildCommands()) {run(command, args, source);}

    const staging = `${out}.partial`;
    fs.rmSync(staging, { recursive: true, force: true });
    for (const rel of COPIED) {
      const from = path.join(source, rel);
      if (!fs.existsSync(from)) {throw new Error(`The lana-editor build has no ${rel}.`);}
      fs.mkdirSync(path.dirname(path.join(staging, rel)), { recursive: true });
      fs.cpSync(from, path.join(staging, rel), { recursive: true, dereference: true });
    }
    fs.writeFileSync(path.join(staging, BUILD_MANIFEST), `${JSON.stringify({ repo: pin.repo, commit: pin.commit }, null, 2)}\n`);
    fs.rmSync(out, { recursive: true, force: true });
    fs.renameSync(staging, out);

    const problems = checkEditorBuild({ pin });
    if (problems.length) {throw new Error(problems.join(' '));}
    process.stdout.write(`build/lana-editor is lana-editor ${pin.commit.slice(0, 9)}.\n`);
  } finally {
    if (!process.env.LANA_EDITOR_SRC) {fs.rmSync(work, { recursive: true, force: true });}
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    build({ force: args.includes('--force') });
  } catch (error) {
    process.stderr.write(`fetch-lana-editor: ${error.message}\n`);
    if (args.includes('--optional')) {
      process.stderr.write('fetch-lana-editor: continuing without the editor; documents open read-only.\n');
    } else {
      process.exit(1);
    }
  }
}

module.exports = { readPin, checkEditorBuild, cloneCommands, buildCommands, editorDir, REQUIRED_FILES, COPIED, SERVICE_ENTRY, PIN_FILE, BUILD_MANIFEST };
