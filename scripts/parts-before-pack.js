'use strict';

/**
 * electron-builder beforePack hook, run before the part checks: stages this target's parts from
 * build/parts/<target>/ into build/pip, build/redactor and build/engine (scripts/client-parts.js),
 * and on macOS narrows mac.binaries to this processor's engine files so the signer gets only
 * files the app holds. Without build/parts the single-platform folders are used as they are.
 */

const path = require('path');
const { Arch } = require('builder-util');
const { stageParts, macBinariesFor } = require('./client-parts');

// The full mac.binaries list from the config, kept the first time each options object is seen,
// so every target in one run narrows from the full list and not from the last target's.
const fullMacBinaries = new WeakMap();

function narrowMacBinaries(context, archName) {
  const packager = context.packager;
  const targets = [packager && packager.platformSpecificBuildOptions, packager && packager.config && packager.config.mac]
    .filter((options, index, all) => options && Array.isArray(options.binaries) && all.indexOf(options) === index);
  for (const options of targets) {
    if (!fullMacBinaries.has(options)) {fullMacBinaries.set(options, [...options.binaries]);}
    options.binaries = macBinariesFor(fullMacBinaries.get(options), archName);
  }
}

async function beforePack(context, { root = path.resolve(__dirname, '..') } = {}) {
  if (!['darwin', 'mas', 'win32', 'linux'].includes(context.electronPlatformName)) {return;}
  const archName = Arch[context.arch];
  const { staged } = stageParts({ root, platformName: context.electronPlatformName, archName });
  if (staged) {console.log(`Client parts: staged build/parts/${staged} into build/pip, build/redactor and build/engine.`);}
  if (['darwin', 'mas'].includes(context.electronPlatformName)) {narrowMacBinaries(context, archName);}
}

module.exports = beforePack;
module.exports.default = beforePack;
