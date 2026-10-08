#!/usr/bin/env node
/**
 * One run of `npm run electron:dev:watch`: rebuild the TipTap bundle and the
 * Tailwind CSS, then start Electron in development mode.
 *
 * `node --watch-path=...` restarts this script when a watched file changes
 * (see package.json). The rebuilt outputs live inside watched folders
 * (src/css, and src/js through the public_html symlink), so they are only
 * written when their bytes change. Otherwise every start would rewrite them
 * and trigger another restart, forever.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const electronPath = require('electron');
const { baseConfig, OUTFILES } = require('./build-tiptap');

const ROOT = path.join(__dirname, '..');
const CSS_INPUT = 'src/css/tailwind-input.css';
const CSS_OUTPUT = 'src/css/tailwind-output.css';

// node --watch stops this process with SIGTERM before restarting it. Take the
// running child (the CSS build or Electron) down too, so a restart never
// leaves an orphaned build or a second app behind.
let current = null;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (current) current.kill('SIGTERM');
    process.exit(0);
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    current = spawn(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
    current.on('error', reject);
    current.on('exit', (code, signal) => {
      current = null;
      resolve(code === null ? (signal ? 1 : 0) : code);
    });
  });
}

function writeIfChanged(file, contents) {
  try {
    if (Buffer.compare(fs.readFileSync(file), Buffer.from(contents)) === 0) return;
  } catch {
    // Missing output: write it.
  }
  fs.writeFileSync(file, contents);
}

async function buildTiptap() {
  // public_html is a symlink to src, so both outfiles are the same file.
  // Build each real file once; two builds would alternate its source map.
  const seen = new Set();
  for (const outfile of OUTFILES) {
    const real = path.join(fs.realpathSync(path.dirname(outfile)), path.basename(outfile));
    if (seen.has(real)) continue;
    seen.add(real);
    const result = await esbuild.build({ ...baseConfig, outfile, write: false });
    for (const file of result.outputFiles) writeIfChanged(file.path, file.contents);
  }
}

async function buildCss() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-css-'));
  try {
    const tmpOutput = path.join(dir, path.basename(CSS_OUTPUT));
    const postcssCli = require.resolve('postcss-cli/index.js');
    const code = await run(process.execPath, [postcssCli, CSS_INPUT, '-o', tmpOutput]);
    if (code !== 0) throw new Error('Tailwind CSS build failed');
    writeIfChanged(path.join(ROOT, CSS_OUTPUT), fs.readFileSync(tmpOutput));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  process.chdir(ROOT);
  await buildTiptap();
  await buildCss();
  const code = await run(electronPath, ['electron-main.js', '--disable-gpu-driver-bug-workarounds'], {
    env: { ...process.env, NODE_ENV: 'development' },
  });
  process.exit(code);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
