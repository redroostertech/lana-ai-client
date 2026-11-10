'use strict';

/**
 * Refuses to package an app without the LANA engine folder for its platform, or with one that is
 * not the pinned build (engine/engine-pin.json; built by scripts/build-engine.js on a matching
 * computer). The client runs it from <resources>/engine with Electron as node
 * (electron-local-engine.js); without it an installed app has no engine on the computer.
 * On macOS it also refuses when a native file in the folder is not in mac.binaries.
 */

const path = require('path');
const { Arch } = require('builder-util');
const { checkEngine } = require('./local-ai-pins');

function macBinariesOf(context) {
  const config = context.packager && context.packager.config;
  const mac = config && config.mac ? config.mac : require('../electron-builder.client.json').mac;
  return mac.binaries || [];
}

async function beforePack(context) {
  if (!['darwin', 'mas', 'win32', 'linux'].includes(context.electronPlatformName)) {return;}
  const root = path.resolve(__dirname, '..');
  const problems = checkEngine({
    root,
    platformName: context.electronPlatformName,
    archName: Arch[context.arch],
    pin: require('../engine/engine-pin.json'),
    macBinaries: macBinariesOf(context)
  });
  if (problems.length) {throw new Error(problems.join(' '));}
}

module.exports = beforePack;
module.exports.default = beforePack;
module.exports.macBinariesOf = macBinariesOf;
