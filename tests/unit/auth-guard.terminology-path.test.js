'use strict';

// auth-guard.js adds the LANA One terminology overlay script to every page it
// guards. Found by the live browser harness: on an admin/ page it asked for
// admin/js/lana-one-terminology.js (404). It now loads it beside itself.

const fs = require('node:fs');
const path = require('node:path');

const GUARD = fs.readFileSync(path.resolve(__dirname, '../../src/js/auth-guard.js'), 'utf8');

// The guard on a page at pageUrl whose <script src> resolved to guardUrl (what the DOM's .src reports).
function overlaySrc(pageUrl, guardUrl) {
  const appended = [];
  const store = { user: JSON.stringify({ id: 'u1', roles: ['org_admin'] }) };
  const document = {
    getElementById: () => null,
    querySelector: (selector) => (selector === 'script[src$="js/auth-guard.js"]' && guardUrl ? { src: guardUrl } : null),
    createElement: () => ({}),
    head: { appendChild: (el) => appended.push(el) },
    addEventListener: () => {}
  };
  const window = { location: new URL(pageUrl), lanaAuthToken: { get: () => 'token' } };
  const localStorage = { getItem: (key) => (key in store ? store[key] : null) };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'localStorage', 'setTimeout', GUARD)(window, document, localStorage, () => {});
  if (window.location.href !== pageUrl) throw new Error('the guard redirected to ' + window.location.href);
  // The URL the browser fetches.
  return new URL(appended[0].src, pageUrl).href;
}

test('an admin/ page loads the overlay from js/, beside the guard', () => {
  expect(overlaySrc('http://localhost/admin/run-controls.html', 'http://localhost/js/auth-guard.js')).toBe('http://localhost/js/lana-one-terminology.js');
});

test('control: a top-level page loads it from js/ as before', () => {
  expect(overlaySrc('http://localhost/workspace-details.html', 'http://localhost/js/auth-guard.js')).toBe('http://localhost/js/lana-one-terminology.js');
  expect(overlaySrc('http://localhost/workspace-details.html', null)).toBe('http://localhost/js/lana-one-terminology.js');
});
