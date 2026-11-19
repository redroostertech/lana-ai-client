'use strict';

// The saved firm's presigned storage origin comes from Chef's authenticated
// client-config, asked with the session token (electron-chef-storage.js), and
// joins exactly the CSP directives that load stored files.

const { createChefStorage, storageOriginFromClientConfig, CLIENT_CONFIG_PATH } = require('../../electron-chef-storage');
const { cspOriginsFromConfig, buildContentSecurityPolicy } = require('../../electron-csp');
const discovery = require('../../electron-discovery');

const TOKEN = 'h.p.s';
const ok = (origin) => ({ ok: true, status: 200, json: async () => ({ config: { features: {}, storage_origin: origin } }) });

function setup({ server = { url: 'https://chef.firm.test/' }, token = TOKEN, answer = ok('http://127.0.0.1:9000') } = {}) {
  const state = { server, token, now: 1000 };
  const fetch = jest.fn(async () => (typeof answer === 'function' ? answer() : answer));
  const storage = createChefStorage({ getServer: () => state.server, getToken: () => state.token, fetch, now: () => state.now, refreshMs: 60000, retryMs: 10000 });
  return { state, fetch, storage };
}

test('nothing before sign-in: no token, no request, no origin', async () => {
  const { storage, fetch } = setup({ token: null });
  expect(storage.origins()).toEqual([]);
  await storage.refresh();
  expect(fetch).not.toHaveBeenCalled();
});

test('after sign-in it asks client-config with the session token, then allows the answer', async () => {
  const { storage, fetch } = setup();
  expect(storage.origins()).toEqual([]);
  await storage.refresh();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`https://chef.firm.test${CLIENT_CONFIG_PATH}`);
  expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(storage.origins()).toEqual(['http://127.0.0.1:9000']);
  expect(fetch).toHaveBeenCalledTimes(1); // fresh answer: no second ask
});

test('a new session or firm asks again; signing out forgets it; the background refresh repeats', async () => {
  const { storage, fetch, state } = setup();
  await storage.refresh();
  state.token = 'other.session.token';
  expect(storage.origins()).toEqual([]);
  await storage.refresh();
  expect(fetch).toHaveBeenCalledTimes(2);
  state.now += 60001;
  await storage.refresh();
  expect(fetch).toHaveBeenCalledTimes(3);
  state.token = null;
  expect(storage.origins()).toEqual([]);
});

test('a failed ask is retried only after the retry delay', async () => {
  const { storage, fetch, state } = setup({ answer: { ok: false, status: 401, json: async () => ({}) } });
  await storage.refresh();
  await storage.refresh();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(storage.origins()).toEqual([]);
  state.now += 10001;
  await storage.refresh();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('only a plain http(s) origin is taken', () => {
  expect(storageOriginFromClientConfig({ config: { storage_origin: 'https://storage.firm.test' } })).toBe('https://storage.firm.test');
  [null, {}, { config: {} }, { config: { storage_origin: null } }, { config: { storage_origin: '*' } },
    { config: { storage_origin: 'https://*.firm.test' } }, { config: { storage_origin: 'https://s.test/bucket' } },
    { config: { storage_origin: 'ftp://s.test' } }, { config: { storage_origin: 'https://u:p@s.test' } }]
    .forEach((body) => expect(storageOriginFromClientConfig(body)).toBeNull());
});

test('the unauthenticated discovery check does not carry a storage origin', () => {
  expect(discovery.storageOriginOf).toBeUndefined();
});

test('the storage origin joins connect-src, img-src, frame-src and media-src, and nothing else', () => {
  const origins = cspOriginsFromConfig({ savedServer: { url: 'https://chef.firm.test' }, storageOrigins: ['http://127.0.0.1:9000'] });
  expect(origins.api).toEqual(['https://chef.firm.test', 'http://127.0.0.1:9000']);
  const policy = buildContentSecurityPolicy({ page: 'workspaces.html', nonce: 'Tm9uY2U0', origins });
  const directive = (name) => policy.split('; ').find((d) => d.startsWith(name + ' '));
  ['connect-src', 'img-src', 'frame-src', 'media-src'].forEach((name) => expect(directive(name)).toContain('http://127.0.0.1:9000'));
  expect(directive('script-src')).not.toContain('127.0.0.1:9000');
});
