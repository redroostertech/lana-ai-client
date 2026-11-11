'use strict';

/**
 * Refuses to package an app without the LANA document editor, or with one that is not the
 * pinned build (editor/editor.lock.json; built by scripts/fetch-lana-editor.js). The client runs
 * it from <resources>/lana-editor with Electron as Node (electron-editor-service.js); without it
 * an installed app cannot open documents for editing.
 */

const path = require('path');
const { checkEditorBuild, readPin } = require('./fetch-lana-editor');

async function beforePack() {
  const problems = checkEditorBuild({ root: path.resolve(__dirname, '..'), pin: readPin() });
  if (problems.length) {throw new Error(problems.join(' '));}
}

module.exports = beforePack;
module.exports.default = beforePack;
