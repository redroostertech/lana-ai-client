'use strict';

// auth-guard.js in a page loaded in a same-origin iframe (connector viewer in
// the Data Connectors modal): the preload bridge exists only on the top
// window, so the guard reads the top window's token, and when none is
// reachable it tells the parent instead of navigating the frame to login.

const fs = require('node:fs');
const path = require('node:path');

const GUARD = fs.readFileSync(path.resolve(__dirname, '../../src/js/auth-guard.js'), 'utf8');
const Bridge = require('../../src/js/shared/auth-token-bridge.js');

function runGuard(window) {
  const document = { getElementById: () => ({}), querySelector: () => null, createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} };
  const localStorage = { getItem: () => JSON.stringify({ id: 'u1' }) };
  const setTimeoutNow = (fn) => fn();
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'localStorage', 'setTimeout', 'api', 'Lex', GUARD)(window, document, localStorage, setTimeoutNow, window.api, window.Lex);
}

function frameWindow(top) {
  const viewer = 'file:///app/integrations/connector-viewer.html';
  const win = {
    location: { href: viewer, pathname: '/app/integrations/connector-viewer.html', origin: 'file://' },
    LanaAuthTokenBridge: Bridge,
    api: { request: () => Promise.resolve({}) }
  };
  win.top = top;
  win.parent = top;
  return win;
}

test('framed viewer uses the top window token and stays on the viewer', () => {
  const top = { location: { origin: 'file://' }, lanaAuthToken: { get: () => 'parent-token' }, postMessage: jest.fn() };
  const win = frameWindow(top);
  runGuard(win);
  expect(win.location.href).toBe('file:///app/integrations/connector-viewer.html');
  expect(win.api.token).toBe('parent-token');
});

test('framed viewer with no reachable token posts to the parent and does not navigate', () => {
  const top = { location: { origin: 'file://' }, postMessage: jest.fn() };
  const win = frameWindow(top);
  runGuard(win);
  expect(win.location.href).toBe('file:///app/integrations/connector-viewer.html');
  expect(top.postMessage).toHaveBeenCalledWith({ type: 'lana-auth-required', reason: 'missing' }, '*');
});

test('unframed page with no token still goes to login', () => {
  const win = {
    location: { href: 'file:///app/dashboard.html', pathname: '/app/dashboard.html', origin: 'file://' },
    LanaAuthTokenBridge: Bridge,
    api: { request: () => Promise.resolve({}) }
  };
  win.top = win;
  win.parent = win;
  runGuard(win);
  expect(win.location.href).toBe('login.html');
});

test('host page: a child frame reporting lana-auth-required closes its modal and runs the host check', () => {
  let token = 'top-token';
  const modal = { open: true };
  const child = {};
  const frame = { contentWindow: child, src: 'integrations/connector-viewer.html', closest: (sel) => (sel === 'lex-modal' ? modal : null) };
  let onMessage = null;
  const win = {
    location: { href: 'file:///app/data-connectors.html', pathname: '/app/data-connectors.html', origin: 'file://' },
    LanaAuthTokenBridge: Bridge,
    lanaAuthToken: { get: () => token },
    api: { request: () => Promise.resolve({}) },
    addEventListener: (type, fn) => { if (type === 'message') onMessage = fn; }
  };
  win.top = win;
  win.parent = win;
  win.document = { querySelectorAll: (sel) => (sel === 'iframe' ? [frame] : []) };
  runGuard(win);
  expect(typeof onMessage).toBe('function');

  // A stranger window is ignored.
  onMessage({ source: {}, data: { type: 'lana-auth-required' } });
  expect(modal.open).toBe(true);

  // The host's session is gone too: the modal closes and the host goes to login.
  token = null;
  onMessage({ source: child, data: { type: 'lana-auth-required', reason: 'missing' } });
  expect(modal.open).toBe(false);
  expect(frame.src).toBe('about:blank');
  expect(win.location.href).toBe('login.html');
});
