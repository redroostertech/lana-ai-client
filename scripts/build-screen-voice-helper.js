#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native', 'macos', 'LanaScreenVoice.m');
const outputDir = path.join(root, 'build', 'screen-voice');
const output = path.join(outputDir, 'lana-screen-voice');

if (process.platform !== 'darwin') {
  console.log('Screen voice native helper: skipped (macOS only).');
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });
const result = spawnSync('/usr/bin/xcrun', [
  'clang', '-fobjc-arc', '-O2', '-arch', 'arm64', '-arch', 'x86_64', source, '-o', output,
  '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'AVFoundation', '-framework', 'Security'
], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
fs.chmodSync(output, 0o755);
console.log(`Screen voice native helper: ${output}`);
