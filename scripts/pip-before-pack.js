'use strict';

/**
 * Refuses to package an app without Pip (lqe, the LANA.cpp engine) for its platform, or with
 * one that is not the pinned build (pip/pip-pin.json; built by scripts/build-pip.sh on a matching
 * computer). The client starts Pip from <resources>/pip (electron-pip-supervisor.js); without it
 * an installed app sends every chat to the cloud.
 */

const path = require('path');
const { Arch } = require('builder-util');
const { checkPip } = require('./local-ai-pins');

async function beforePack(context) {
  if (!['darwin', 'mas', 'win32', 'linux'].includes(context.electronPlatformName)) {return;}
  const root = path.resolve(__dirname, '..');
  const problems = checkPip({ root, platformName: context.electronPlatformName, archName: Arch[context.arch], pin: require('../pip/pip-pin.json') });
  if (problems.length) {throw new Error(problems.join(' '));}
}

module.exports = beforePack;
module.exports.default = beforePack;
