#!/usr/bin/env node
'use strict';

/**
 * Places build/pip/vulkan-1.dll, the Khronos Vulkan loader the Windows package ships beside
 * lqe.exe (pip/pip-pin.json vulkanLoader). Build time only; the app never downloads it.
 *
 * Takes the pinned LunarG Vulkan Runtime components archive, refuses it unless its sha256 is the
 * pinned one (the one LunarG publishes at sha256Source), unpacks the pinned member with tar
 * (bsdtar, which reads zip, ships with Windows 10 and later and with macOS), and refuses the file
 * unless its sha256 is the pinned one. Run by scripts/build-pip.sh on Windows; checked again
 * before packing (scripts/local-ai-pins.js checkPip) and after (checkPackaged).
 *
 *   node scripts/fetch-vulkan-loader.js [--archive <a downloaded copy of the archive>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Problems with an archive or file's bytes against the pin, in plain words; empty means it matches. */
function checkBytes(buffer, want, what) {
  if (!want) {return [`pip/pip-pin.json has no sha256 for ${what}.`];}
  const have = sha256(buffer);
  return have === want ? [] : [`${what} has sha256 ${have}, the pin says ${want}.`];
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) {throw new Error(`${url} answered ${response.status}`);}
  return Buffer.from(await response.arrayBuffer());
}

async function main(argv = process.argv.slice(2)) {
  const loader = require('../pip/pip-pin.json').vulkanLoader;
  const at = argv.indexOf('--archive');
  const archive = at >= 0 ? fs.readFileSync(argv[at + 1]) : await download(loader.archive.url);
  const archiveProblems = checkBytes(archive, loader.archive.sha256, `the Vulkan Runtime archive ${loader.version}`);
  if (archiveProblems.length) {throw new Error(archiveProblems.join(' '));}
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vulkan-loader-'));
  try {
    const zip = path.join(work, 'runtime.zip');
    fs.writeFileSync(zip, archive);
    execFileSync('tar', ['-xf', zip, '-C', work, loader.member], { stdio: 'inherit' });
    const dll = fs.readFileSync(path.join(work, loader.member));
    const dllProblems = checkBytes(dll, loader.sha256, `${loader.member}`);
    if (dllProblems.length) {throw new Error(dllProblems.join(' '));}
    fs.mkdirSync(path.join(ROOT, 'build', 'pip'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'build', 'pip', loader.file), dll);
    process.stdout.write(`Placed build/pip/${loader.file}: Vulkan loader ${loader.version}, ${dll.length} bytes, sha256 ${loader.sha256}\n`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`fetch-vulkan-loader: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { checkBytes, sha256, main };
