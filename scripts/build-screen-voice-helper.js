#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { missingMacArchs } = require('./client-parts');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native', 'macos', 'LanaScreenVoice.m');
const outputDir = path.join(root, 'build', 'screen-voice');
const output = path.join(outputDir, 'lana-screen-voice');

/** Both Mac processors in one binary, so an arm64 and an x64 build each get a helper that runs. */
function clangArgs(src, out) {
  return [
    'clang', '-fobjc-arc', '-O2', '-arch', 'arm64', '-arch', 'x86_64', src, '-o', out,
    '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'AVFoundation', '-framework', 'Security'
  ];
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Screen voice native helper: skipped (macOS only).');
    process.exit(0);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const result = spawnSync('/usr/bin/xcrun', clangArgs(source, output), { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  const lipo = spawnSync('/usr/bin/xcrun', ['lipo', '-archs', output], { encoding: 'utf8' });
  const missing = lipo.status === 0 ? missingMacArchs(lipo.stdout) : ['arm64', 'x86_64'];
  if (missing.length) {
    console.error(`Screen voice native helper: the build has no ${missing.join(' or ')} slice.`);
    process.exit(1);
  }
  fs.chmodSync(output, 0o755);
  console.log(`Screen voice native helper: ${output}`);
}

if (require.main === module) main();

module.exports = { clangArgs };
