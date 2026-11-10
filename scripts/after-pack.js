'use strict';

/**
 * electron-builder afterPack hook: checks the packed app's Pip and engine against their pins
 * (scripts/local-ai-pins.js checkPackaged) before any installer is made or anything is signed.
 */

const { Arch } = require('builder-util');
const { checkPackaged } = require('./local-ai-pins');

async function afterPack(context) {
  if (!['darwin', 'mas', 'win32', 'linux'].includes(context.electronPlatformName)) {return;}
  const problems = checkPackaged({
    resourcesDir: context.packager.getResourcesDir(context.appOutDir),
    platformName: context.electronPlatformName,
    archName: Arch[context.arch],
    pipPin: require('../pip/pip-pin.json'),
    enginePin: require('../engine/engine-pin.json')
  });
  if (problems.length) {throw new Error(problems.join(' '));}
}

module.exports = afterPack;
module.exports.default = afterPack;
