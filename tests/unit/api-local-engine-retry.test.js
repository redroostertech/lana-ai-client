/**
 * The API client rides through a short local engine restart (src/js/api.js): a read that could
 * not reach this computer's own engine is tried again for about 10 seconds; writes and other
 * servers are never repeated.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadApiClass() {
  const context = {
    console, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, URL,
    FormData: class FormData {}, fetch: jest.fn(),
    localStorage: { getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn() },
    document: { addEventListener: jest.fn(), body: {}, getElementById: jest.fn(() => null) },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' },
    LanaConfig: {}, LanaTime: { nowMs: jest.fn(() => 1000), millisecondsSince: jest.fn(() => 0), MS_PER_MINUTE: 60000 }
  };
  context.window = context;
  context.globalThis = context;
  const apiPath = path.join(__dirname, '../../src/js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8') + '\nwindow.__ApiClient = ApiClient;', context, { filename: apiPath });
  return context.window.__ApiClient;
}

const ApiClient = loadApiClass();
const network = Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });

test('a read to this computer\'s engine that never reached it is retried, up to the limit', () => {
  expect(ApiClient.retriesLocalEngineRestart('GET', 'http://127.0.0.1:55154/api/v1/tasks', network, 0)).toBe(true);
  expect(ApiClient.retriesLocalEngineRestart('HEAD', 'http://localhost:8079/x', network, 5)).toBe(true);
  expect(ApiClient.retriesLocalEngineRestart('GET', 'http://127.0.0.1:55154/x', network, ApiClient.LOCAL_ENGINE_RETRIES)).toBe(false);
  // About 10 seconds in all: longer than an engine restart.
  const totalMs = Array.from({ length: ApiClient.LOCAL_ENGINE_RETRIES }, (_, i) => ApiClient.LOCAL_ENGINE_RETRY_MS * (i + 1)).reduce((a, b) => a + b, 0);
  expect(totalMs).toBeGreaterThanOrEqual(8000);
  expect(totalMs).toBeLessThanOrEqual(15000);
});

test('writes, other servers and other errors are never repeated', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect(ApiClient.retriesLocalEngineRestart(method, 'http://127.0.0.1:55154/x', network, 0)).toBe(false);
  }
  expect(ApiClient.retriesLocalEngineRestart('GET', 'https://chef.example.test/x', network, 0)).toBe(false);
  expect(ApiClient.retriesLocalEngineRestart('GET', 'http://127.0.0.1:55154/x', new Error('boom'), 0)).toBe(false);
  expect(ApiClient.retriesLocalEngineRestart('GET', 'not a url', network, 0)).toBe(false);
});

function loadApiWith(fetchImpl) {
  const context = {
    console: { log() {}, warn() {}, error: jest.fn(), info() {} }, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, URL, Headers,
    FormData: class FormData {}, fetch: fetchImpl,
    localStorage: { getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn() },
    document: { addEventListener: jest.fn(), body: {}, getElementById: jest.fn(() => null) },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' },
    LanaConfig: {}, LanaTime: { nowMs: jest.fn(() => 1000), millisecondsSince: jest.fn(() => 0), MS_PER_MINUTE: 60000 }
  };
  context.window = context;
  context.globalThis = context;
  const apiPath = path.join(__dirname, '../../src/js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
  const api = context.window.api;
  api.baseUrl = 'http://127.0.0.1:55154';
  return { api, context };
}

test('a read during an engine restart succeeds once the engine is back, without an error logged', async () => {
  let calls = 0;
  const { api, context } = loadApiWith(jest.fn(async () => {
    calls += 1;
    if (calls <= 2) {throw Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });}
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: 1 }), text: async () => '{"ok":1}' };
  }));
  await expect(api.request('GET', '/api/v1/tasks')).resolves.toEqual({ ok: 1 });
  expect(calls).toBe(3);
  expect(context.console.error).not.toHaveBeenCalled();
}, 10000);

test('a write that failed is reported at once, not repeated', async () => {
  const fetchImpl = jest.fn(async () => { throw Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }); });
  const { api } = loadApiWith(fetchImpl);
  await expect(api.request('POST', '/api/v1/tasks', { title: 'x' })).rejects.toMatchObject({ status: 0 });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
