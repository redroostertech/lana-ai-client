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
const { missingMacArchs } = require('./client-parts');

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

/** Both Mac processors in one binary, so an arm64 and an x64 build each get a helper that runs. */
function swiftBuildArgs() {
  return ['swift', 'build', '-c', 'release', '--arch', 'arm64', '--arch', 'x86_64'];
}

/** The processors the helper at file is missing ([] when it has both), by lipo. */
function missingArchs(file) {
  const lipo = spawnSync('/usr/bin/xcrun', ['lipo', '-archs', file], { encoding: 'utf8' });
  return lipo.status === 0 ? missingMacArchs(lipo.stdout) : ['arm64', 'x86_64'];
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('Briefs Bluetooth helper: skipped (macOS only).');
    process.exit(0);
  }

  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= newestSource(pkg) && missingArchs(output).length === 0) {
    console.log('Briefs Bluetooth helper: up to date.');
    process.exit(0);
  }

  const result = spawnSync('/usr/bin/xcrun', swiftBuildArgs(), { cwd: pkg, stdio: 'inherit' });
  if (result.status !== 0) fail('the Swift build failed.');
  const built = path.join(pkg, '.build', 'apple', 'Products', 'Release', 'LanaBleWake');
  if (!fs.existsSync(built)) fail('the Swift build produced no helper.');
  const missing = missingArchs(built);
  if (missing.length) fail(`the Swift build has no ${missing.join(' or ')} slice.`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(built, output);
  fs.chmodSync(output, 0o755);
  console.log(`Briefs Bluetooth helper: ${output}`);
}

if (require.main === module) main();

module.exports = { swiftBuildArgs, missingArchs };
