#!/usr/bin/env node
'use strict';

/**
 * Places the Khronos Vulkan loader a package ships in pip/vulkan-fallback (pip/pip-pin.json
 * vulkanLoader): build/pip/vulkan-fallback/vulkan-1.dll for Windows, libvulkan.so.1 for Linux.
 * electron-pip-supervisor.js puts the folder on PATH (Windows) or LD_LIBRARY_PATH (Linux) only
 * when lqe cannot find a loader of its own. Build time only; the app never downloads it.
 *
 * Takes the pinned LunarG archive (the Windows Vulkan Runtime components zip, the Linux SDK
 * tarball), refuses it unless its sha256 is the pinned one (the one LunarG publishes at
 * sha256Source), unpacks the pinned member with tar (bsdtar on Windows 10 and later and macOS,
 * GNU tar on Linux; both read the archive types used), and refuses the file unless its sha256 is
 * the pinned one. Run by scripts/build-pip.sh on Windows and Linux; checked again before packing
 * (scripts/local-ai-pins.js checkPip) and after (checkPackaged).
 *
 *   node scripts/fetch-vulkan-loader.js [--platform windows-x64|linux-x64] [--archive <a downloaded copy>]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { platformKey } = require('./local-ai-pins');

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
  const p = argv.indexOf('--platform');
  const key = p >= 0 ? argv[p + 1] : platformKey(process.platform, process.arch);
  const loader = (require('../pip/pip-pin.json').vulkanLoader || {})[key];
  if (!loader || typeof loader !== 'object') {throw new Error(`pip/pip-pin.json has no Vulkan loader for ${key}.`);}
  const at = argv.indexOf('--archive');
  const archive = at >= 0 ? fs.readFileSync(argv[at + 1]) : await download(loader.archive.url);
  const archiveProblems = checkBytes(archive, loader.archive.sha256, `the Vulkan archive ${loader.version} for ${key}`);
  if (archiveProblems.length) {throw new Error(archiveProblems.join(' '));}
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vulkan-loader-'));
  try {
    const packed = path.join(work, path.basename(new URL(loader.archive.url).pathname));
    fs.writeFileSync(packed, archive);
    execFileSync('tar', ['-xf', packed, '-C', work, loader.member], { stdio: 'inherit' });
    const dll = fs.readFileSync(path.join(work, loader.member));
    const dllProblems = checkBytes(dll, loader.sha256, `${loader.member}`);
    if (dllProblems.length) {throw new Error(dllProblems.join(' '));}
    const out = path.join(ROOT, 'build', 'pip', loader.file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, dll);
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
