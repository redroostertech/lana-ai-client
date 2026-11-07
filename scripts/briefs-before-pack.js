'use strict';

/**
 * electron-builder beforePack hook: refuses to package an app whose LANA Briefs speech
 * engine would be missing. sherpa-onnx-node loads a native binary from a platform package
 * (sherpa-onnx-darwin-arm64, sherpa-onnx-win-x64, ...) that npm installs only for the
 * machine running npm install. A build for another architecture or OS would succeed and
 * ship without it, and transcription and Talk would fail on those computers. Build each
 * target on a matching machine, or install that platform's package before building.
 */

const fs = require('fs');
const path = require('path');

// electron-builder's Arch enum (builder-util): ia32, x64, armv7l, arm64, universal.
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
const PLATFORM = { darwin: 'darwin', mas: 'darwin', win32: 'win', linux: 'linux' };

function requiredPackages(platformName, arch) {
  const platform = PLATFORM[platformName];
  const name = ARCH[arch] || String(arch);
  if (!platform) return [];
  if (name === 'universal') return [`sherpa-onnx-${platform}-arm64`, `sherpa-onnx-${platform}-x64`];
  return [`sherpa-onnx-${platform}-${name}`];
}

function missingPackages(root, platformName, arch) {
  return requiredPackages(platformName, arch).filter((name) => !fs.existsSync(path.join(root, 'node_modules', name, 'package.json')));
}

async function beforePack(context) {
  const root = path.resolve(__dirname, '..');
  const missing = missingPackages(root, context.electronPlatformName, context.arch);
  if (missing.length > 0) {
    throw new Error(`LANA Briefs speech engine missing for this build (${context.electronPlatformName} ${ARCH[context.arch] || context.arch}): ${missing.join(', ')} is not installed. Build on a matching machine or install it first.`);
  }
}

module.exports = beforePack;
module.exports.default = beforePack;
module.exports.requiredPackages = requiredPackages;
module.exports.missingPackages = missingPackages;
