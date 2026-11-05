#!/usr/bin/env node
'use strict';

/**
 * Builds LANA Briefs' Bluetooth wake helper (macOS): a small Swift tool the Briefs host
 * starts to let a paired phone know this computer has something for it. It only
 * advertises the service ids the host gives it. Output: build/briefs/LanaBleWake,
 * shipped as an extra resource (electron-builder.client.json).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = path.join(root, 'briefs', 'native', 'macos', 'ble-wake-helper');
const outputDir = path.join(root, 'build', 'briefs');
const output = path.join(outputDir, 'LanaBleWake');

if (process.platform !== 'darwin') {
  console.log('Briefs Bluetooth helper: skipped (macOS only).');
  process.exit(0);
}

const result = spawnSync('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--arch', 'arm64', '--arch', 'x86_64'], { cwd: pkg, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const built = path.join(pkg, '.build', 'apple', 'Products', 'Release', 'LanaBleWake');
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(built, output);
fs.chmodSync(output, 0o755);
console.log(`Briefs Bluetooth helper: ${output}`);
