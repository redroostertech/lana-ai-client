'use strict';

/**
 * electron-builder beforePack hook: refuses to package an app that would be missing a part it
 * needs on the person's computer.
 *
 *   briefs-before-pack.js    the LANA Briefs speech engine for this platform
 *   redactor-before-pack.js  the redactor program (scripts/build-redactor.sh). Without it the
 *                            engine cannot send any turn to the cloud.
 *   pip-before-pack.js       Pip (lqe) at its pinned build (scripts/build-pip.sh). Without it chat
 *                            and search embedding cannot run on the computer.
 *   engine-before-pack.js    the LANA engine folder at its pinned build (scripts/build-engine.js).
 *                            Without it the installed app has no engine on the computer.
 *   editor-before-pack.js    the LANA document editor at its pinned build
 *                            (scripts/fetch-lana-editor.js). Without it documents open read-only.
 */

const briefs = require('./briefs-before-pack');
const redactor = require('./redactor-before-pack');
const pip = require('./pip-before-pack');
const engine = require('./engine-before-pack');
const editor = require('./editor-before-pack');

async function beforePack(context) {
  await briefs(context);
  await redactor(context);
  await pip(context);
  await engine(context);
  await editor(context);
}

module.exports = beforePack;
module.exports.default = beforePack;
