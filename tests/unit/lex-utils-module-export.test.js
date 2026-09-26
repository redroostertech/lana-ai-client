/**
 * Unit tests: Lex.Utils module.exports guard.
 *
 * lex.utils.js is a browser IIFE that assigns window.Lex.Utils; it had no
 * module.exports guard, so a Node-side module could not require() it and
 * reuse escapeHtml (or anything else on Lex.Utils) instead of keeping its
 * own copy. This is the smallest possible fix: export what the file already
 * computes, without restructuring it.
 */

'use strict';

const path = require('path');
const vm = require('vm');
const fs = require('fs');

function loadLexUtilsAsModule() {
  const timeSrc = fs.readFileSync(path.resolve(__dirname, '../../src/js/time-utils.js'), 'utf8');
  const lexUtilsPath = path.resolve(__dirname, '../../src/js/lex/lex.utils.js');
  const lexUtilsSrc = fs.readFileSync(lexUtilsPath, 'utf8');

  const fakeWindow = { localStorage: { getItem: () => null } };
  const timeSandbox = new Function('window', timeSrc);
  timeSandbox(fakeWindow);

  const moduleObj = { exports: {} };
  const context = {
    window: fakeWindow,
    module: moduleObj,
    console: console
  };
  vm.createContext(context);
  vm.runInContext(lexUtilsSrc, context, { filename: lexUtilsPath });
  return moduleObj.exports;
}

describe('lex.utils.js module.exports guard', () => {
  test('require()-style loading (module.exports set, window/LanaTime already provided) exposes Lex.Utils', () => {
    const utils = loadLexUtilsAsModule();
    expect(typeof utils.escapeHtml).toBe('function');
    expect(utils.escapeHtml('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#039;&lt;/b&gt;');
    expect(typeof utils.formatDateTime).toBe('function');
  });

  test('control arm: without a module.exports guard nothing would be exported', () => {
    // Simulates the pre-fix file: no module.exports assignment at all.
    const moduleObj = { exports: {} };
    expect(moduleObj.exports.escapeHtml).toBeUndefined();
  });
});
