'use strict';

// An ApiClient in a same-origin iframe borrows the top window's token bridge.
// It must never refresh: the backend rotates the token on refresh, so a frame
// refreshing would invalidate the top window's token. It starts no refresh
// timer or activity listener and reads the token from the bridge per request,
// so a refresh done by the top window is picked up.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const Bridge = require('../../src/js/shared/auth-token-bridge.js');
const API_SOURCE = fs.readFileSync(path.join(__dirname, '../../src/js/api.js'), 'utf8');

function jwt(expSeconds) {
  return 'h.' + Buffer.from(JSON.stringify({ exp: expSeconds, sub: 'u1' })).toString('base64') + '.s';
}

function loadApi({ framed, token }) {
  let topToken = token;
  const topBridge = {
    get: () => topToken,
    set: jest.fn((t) => { topToken = t; return true; }),
    clear: jest.fn(() => { topToken = null; })
  };
  const top = { location: { origin: 'http://client.test' }, lanaAuthToken: topBridge };
  const timers = { setTimeout: jest.fn(() => 1), setInterval: jest.fn(() => 2) };
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    URL, URLSearchParams, AbortController, Headers,
    FormData: class FormData {},
    setTimeout: timers.setTimeout,
    clearTimeout() {},
    setInterval: timers.setInterval,
    clearInterval() {},
    fetch: jest.fn(),
    localStorage: { getItem: jest.fn(() => JSON.stringify({ id: 'u1' })), setItem: jest.fn(), removeItem: jest.fn() },
    document: { addEventListener: jest.fn(), body: {}, getElementById: jest.fn(() => null) },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/integrations/connector-viewer.html' },
    LanaConfig: {},
    LanaTime: {
      nowMs: () => Date.now(), nowIso: () => new Date().toISOString(),
      millisecondsSince: (s) => Date.now() - s, MS_PER_MINUTE: 60000, MS_PER_HOUR: 3600000,
      formatUtcDateOnly: () => '2026-11-16'
    }
  };
  context.window = context;
  context.globalThis = context;
  context.LanaAuthTokenBridge = Bridge;
  if (framed) {
    context.top = top;
    context.parent = top;
  } else {
    context.top = context;
    context.parent = context;
    context.lanaAuthToken = topBridge;
  }
  vm.runInNewContext(API_SOURCE, context, { filename: 'api.js' });
  return { api: context.window.api, context, topBridge, timers, setTopToken: (t) => { topToken = t; } };
}

const soon = () => jwt(Math.floor(Date.now() / 1000) + 600); // near expiry

test('a framed ApiClient starts no refresh timer or activity listener', () => {
  const { context, timers } = loadApi({ framed: true, token: soon() });
  expect(timers.setTimeout).not.toHaveBeenCalled();
  expect(timers.setInterval).not.toHaveBeenCalled();
  expect(context.document.addEventListener).not.toHaveBeenCalled();
});

test('a framed ApiClient never calls the refresh endpoint or rotates the top token', async () => {
  const { api, context, topBridge } = loadApi({ framed: true, token: soon() });
  await api.refreshToken();
  await api.performTokenRefresh();
  expect(context.fetch).not.toHaveBeenCalled();
  expect(topBridge.set).not.toHaveBeenCalled();
});

test('a framed ApiClient picks up a changed top token on the next request', () => {
  const first = soon();
  const { api, setTopToken } = loadApi({ framed: true, token: first });
  expect(api.getHeaders().Authorization).toBe('Bearer ' + first);
  const rotated = jwt(Math.floor(Date.now() / 1000) + 7200);
  setTopToken(rotated);
  expect(api.getHeaders().Authorization).toBe('Bearer ' + rotated);
});

test('control: the top window ApiClient still starts session services', () => {
  const { context, timers } = loadApi({ framed: false, token: soon() });
  expect(timers.setInterval).toHaveBeenCalled();
  expect(context.document.addEventListener).toHaveBeenCalled();
});
