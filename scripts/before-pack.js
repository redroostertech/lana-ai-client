'use strict';

/**
 * electron-builder beforePack hook: refuses to package an app that would be missing a part it
 * needs on the person's computer.
 *
 *   briefs-before-pack.js    the LANA Briefs speech engine for this platform
 *   redactor-before-pack.js  the redactor program (scripts/build-redactor.sh). Without it the
 *                            engine cannot send any turn to the cloud.
 */

const briefs = require('./briefs-before-pack');
const redactor = require('./redactor-before-pack');

async function beforePack(context) {
  await briefs(context);
  await redactor(context);
}

module.exports = beforePack;
module.exports.default = beforePack;
