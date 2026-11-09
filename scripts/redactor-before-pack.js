'use strict';

/**
 * Refuses to package an app without the redactor program for its platform
 * (build/redactor/lana-redactor/lana-redactor, lana-redactor.exe on Windows; built by scripts/build-redactor.sh
 * on a matching machine). The engine redacts every turn it sends to the cloud on the person's
 * computer and refuses to send one it cannot redact, so an app shipped without it could never
 * use the cloud.
 */

const fs = require('fs');
const path = require('path');

function redactorFile(root, platformName) {
  if (!['darwin', 'mas', 'win32', 'linux'].includes(platformName)) {return null;}
  return path.join(root, 'build', 'redactor', 'lana-redactor', platformName === 'win32' ? 'lana-redactor.exe' : 'lana-redactor');
}

async function beforePack(context) {
  const root = path.resolve(__dirname, '..');
  const file = redactorFile(root, context.electronPlatformName);
  if (file && !fs.existsSync(file)) {
    throw new Error(`The redactor program is missing for this build (${context.electronPlatformName}): ${path.relative(root, file)}. Build it on a matching machine with scripts/build-redactor.sh first.`);
  }
}

module.exports = beforePack;
module.exports.default = beforePack;
module.exports.redactorFile = redactorFile;
