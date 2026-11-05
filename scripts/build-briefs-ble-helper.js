#!/usr/bin/env node
'use strict';

/**
 * Builds LANA Briefs' Bluetooth wake helper (macOS): a small Swift tool the Briefs host
 * starts to let a paired phone know this computer has something for it. It only
 * advertises the service ids the host gives it. Output: build/briefs/LanaBleWake (arm64
 * and x86_64), shipped as an extra resource and signed with the app
 * (electron-builder.client.json).
 *
 * Skipped when the helper is newer than its sources. With --optional (development starts)
 * a failed build only warns: Briefs runs without Bluetooth wake when the helper is missing.
 * Packaging runs it without --optional, so a release never ships without it.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = path.join(root, 'briefs', 'native', 'macos', 'ble-wake-helper');
const outputDir = path.join(root, 'build', 'briefs');
const output = path.join(outputDir, 'LanaBleWake');
const optional = process.argv.includes('--optional');

function newestSource(dir) {
  let newest = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name === '.build') continue;
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    newest = Math.max(newest, stat.isDirectory() ? newestSource(file) : stat.mtimeMs);
  }
  return newest;
}

function fail(message) {
  if (optional) {
    console.warn(`Briefs Bluetooth helper: ${message} LANA starts without Bluetooth wake.`);
    process.exit(0);
  }
  console.error(`Briefs Bluetooth helper: ${message}`);
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.log('Briefs Bluetooth helper: skipped (macOS only).');
  process.exit(0);
}

if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= newestSource(pkg)) {
  console.log('Briefs Bluetooth helper: up to date.');
  process.exit(0);
}

const result = spawnSync('/usr/bin/xcrun', ['swift', 'build', '-c', 'release', '--arch', 'arm64', '--arch', 'x86_64'], { cwd: pkg, stdio: 'inherit' });
if (result.status !== 0) fail('the Swift build failed.');
const built = path.join(pkg, '.build', 'apple', 'Products', 'Release', 'LanaBleWake');
if (!fs.existsSync(built)) fail('the Swift build produced no helper.');
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(built, output);
fs.chmodSync(output, 0o755);
console.log(`Briefs Bluetooth helper: ${output}`);
