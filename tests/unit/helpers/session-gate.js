'use strict';

// LanaSessionGate as a page has it: api.js defines it on window. Evaluated in a
// throwaway context so a test can hand the real gate to a stubbed page.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSessionGate() {
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} }, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { addEventListener() {} },
    location: { pathname: '/x.html', protocol: 'http:' },
    LanaConfig: {}, LanaTime: { nowMs: () => 0 }
  };
  context.window = context;
  const file = path.resolve(__dirname, '../../../src/js/api.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.window.LanaSessionGate;
}

module.exports = { loadSessionGate };
