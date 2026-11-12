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

/** Problems with the redactor for a platform under root, in plain words; empty when it is there. */
function checkRedactor({ root, platformName }) {
  const file = redactorFile(root, platformName);
  if (file && !fs.existsSync(file)) {
    return [`The redactor program is missing for this build (${platformName}): ${path.relative(root, file)}. Build it on a matching machine with scripts/build-redactor.sh first.`];
  }
  return [];
}

async function beforePack(context) {
  const problems = checkRedactor({ root: path.resolve(__dirname, '..'), platformName: context.electronPlatformName });
  if (problems.length) {throw new Error(problems.join(' '));}
}

module.exports = beforePack;
module.exports.default = beforePack;
module.exports.redactorFile = redactorFile;
module.exports.checkRedactor = checkRedactor;
