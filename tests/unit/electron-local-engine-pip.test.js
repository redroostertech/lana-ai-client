/**
 * The local engine and Pip (electron-local-engine.js, first-launch plan phase C): Pip's
 * addresses reach the engine's environment, a running engine restarts when they change, the
 * developer's own addresses win, and an installed app finds the engine inside itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const mockSpawned = [];
jest.mock('child_process', () => ({
  spawn: jest.fn((command, args, options) => {
    const { EventEmitter } = require('events');
    const child = new EventEmitter();
    child.pid = 3000 + mockSpawned.length;
    child.exitCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { Promise.resolve().then(() => { child.exitCode = 0; child.emit('exit', null, 'SIGTERM'); }); return true; };
    mockSpawned.push({ command, args, env: options.env });
    return child;
  })
}));

const { createLocalEngineHost, bundledEngineRoot } = require('../../electron-local-engine');
const { resolveEngineConfig } = require('../../electron-api-base');

const CHEF = 'https://chef.example.test';
const spawned = mockSpawned;
const PIP = { LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:8081', LANA_ENGINE_EMBEDDING_URL: 'http://127.0.0.1:8082' };

let tmp;
let root;
let host;
const realFetch = global.fetch;

function storage() {
  let prefs = { enabled: null, root: null, port: null, backgroundJobs: null, engineId: 'engine-test' };
  return {
    getSavedServer: () => ({ url: CHEF }),
    getLocalEnginePreferences: () => ({ ...prefs }),
    updateLocalEnginePreferences: (changes) => { prefs = { ...prefs, ...changes }; }
  };
}

function makeHost(env, app = { getPath: () => tmp, isPackaged: false }, resourcesPath = null) {
  host = createLocalEngineHost({ ipcMain: { handle() {}, on() {} }, app, storage: storage(), getWindows: () => [], env, log: { info() {}, warn() {}, error() {} }, resourcesPath });
  return host;
}

beforeEach(() => {
  spawned.length = 0;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-engine-pip-'));
  root = path.join(tmp, 'engine');
  fs.mkdirSync(path.join(root, 'src', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'engine', 'index.js'), '');
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok' }) }));
});

afterEach(async () => {
  if (host) {await host.stop();}
  host = null;
  global.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Pip addresses set before the engine starts are in its environment', async () => {
  makeHost({ LANA_ENGINE_ROOT: root });
  await host.setModelEndpoints(PIP);
  await host.sync();
  expect(spawned).toHaveLength(1);
  expect(spawned[0].env).toMatchObject(PIP);
});

test('the engine always gets a level: demo unless the environment names one (it will not start without)', async () => {
  makeHost({ LANA_ENGINE_ROOT: root });
  await host.sync();
  expect(spawned[0].env.LANA_TIER).toBe('demo');
});

test('a running engine restarts with new addresses; the same addresses restart nothing', async () => {
  makeHost({ LANA_ENGINE_ROOT: root });
  await host.sync();
  expect(spawned[0].env.LANA_ENGINE_CHAT_URL).toBeUndefined();
  await host.setModelEndpoints(PIP);
  expect(spawned).toHaveLength(2);
  expect(spawned[1].env).toMatchObject(PIP);
  await host.setModelEndpoints({ ...PIP });
  expect(spawned).toHaveLength(2);
  // Chat moved to the cloud: the chat address is gone from the next start.
  await host.setModelEndpoints({ LANA_ENGINE_EMBEDDING_URL: PIP.LANA_ENGINE_EMBEDDING_URL });
  expect(spawned).toHaveLength(3);
  expect(spawned[2].env.LANA_ENGINE_CHAT_URL).toBeUndefined();
});

test('addresses the environment names win over Pip\'s', async () => {
  makeHost({ LANA_ENGINE_ROOT: root, LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:9999', LANA_TIER: 'professional' });
  await host.setModelEndpoints(PIP);
  await host.sync();
  expect(spawned[0].env).toMatchObject({ LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:9999', LANA_TIER: 'professional', LANA_ENGINE_EMBEDDING_URL: PIP.LANA_ENGINE_EMBEDDING_URL });
});

test('names other than the engine model settings are ignored', async () => {
  makeHost({ LANA_ENGINE_ROOT: root });
  await host.setModelEndpoints({ ...PIP, DATABASE_URL: 'postgresql://nope' });
  await host.sync();
  expect(spawned[0].env.DATABASE_URL).toBeUndefined();
});

describe('the redactor', () => {
  const REDACTOR = { REDACTOR_URL: 'http://127.0.0.1:51234', INTERNAL_SERVICE_SECRET: 'b'.repeat(64) };

  test('its address and secret reach the engine together, and a running engine restarts for them', async () => {
    makeHost({ LANA_ENGINE_ROOT: root });
    await host.sync();
    expect(spawned[0].env.REDACTOR_URL).toBeUndefined();
    await host.setModelEndpoints({ ...PIP, ...REDACTOR });
    expect(spawned).toHaveLength(2);
    expect(spawned[1].env).toMatchObject({ ...PIP, ...REDACTOR });
  });

  test('a redactor the environment names wins, address and secret both; the client\'s secret never pairs with it', async () => {
    makeHost({ LANA_ENGINE_ROOT: root, REDACTOR_URL: 'http://127.0.0.1:9999', INTERNAL_SERVICE_SECRET: 'env-secret' });
    await host.setModelEndpoints(REDACTOR);
    await host.sync();
    expect(spawned[0].env).toMatchObject({ REDACTOR_URL: 'http://127.0.0.1:9999', INTERNAL_SERVICE_SECRET: 'env-secret' });
  });

  test('a secret alone is never passed: without an address there is no redactor', async () => {
    makeHost({ LANA_ENGINE_ROOT: root, INTERNAL_SERVICE_SECRET: 'stray' });
    await host.setModelEndpoints({ INTERNAL_SERVICE_SECRET: 'stray-too' });
    await host.sync();
    expect(spawned[0].env.INTERNAL_SERVICE_SECRET).toBeUndefined();
    expect(spawned[0].env.REDACTOR_URL).toBeUndefined();
  });
});

describe('Docling', () => {
  const DOCLING = { DOCLING_API_URL: 'http://127.0.0.1:51300', DOC_PARSER_TIMEOUT_DOCLING_MS: '240000', DOCLING_TIMEOUT_MS: '240000' };

  test('its address and reading timeouts reach the engine, a running engine restarts for them, and stopping it removes them', async () => {
    makeHost({ LANA_ENGINE_ROOT: root });
    await host.sync();
    expect(spawned[0].env.DOCLING_API_URL).toBeUndefined();
    await host.setModelEndpoints({ ...PIP, ...DOCLING });
    expect(spawned).toHaveLength(2);
    expect(spawned[1].env).toMatchObject({ ...PIP, ...DOCLING });
    await host.setModelEndpoints(PIP);
    expect(spawned).toHaveLength(3);
    expect(spawned[2].env.DOCLING_API_URL).toBeUndefined();
  });

  test('a Docling the environment names wins over the client\'s', async () => {
    makeHost({ LANA_ENGINE_ROOT: root, DOCLING_API_URL: 'http://127.0.0.1:8085' });
    await host.setModelEndpoints(DOCLING);
    await host.sync();
    expect(spawned[0].env.DOCLING_API_URL).toBe('http://127.0.0.1:8085');
  });
});

describe('the engine inside the installed app', () => {
  test('an installed app with <resources>/engine starts that engine with nothing typed', async () => {
    makeHost({}, { getPath: () => tmp, isPackaged: true }, tmp);
    await host.sync();
    expect(spawned).toHaveLength(1);
    expect(spawned[0].args).toEqual([path.join(root, 'src', 'engine', 'index.js')]);
  });

  test('found only in an installed app that has it', () => {
    const exists = (file) => file === path.join(tmp, 'engine', 'src', 'engine', 'index.js');
    expect(bundledEngineRoot({ app: { isPackaged: true }, resourcesPath: tmp, fileExists: exists })).toBe(path.join(tmp, 'engine'));
    expect(bundledEngineRoot({ app: { isPackaged: true }, resourcesPath: '/elsewhere', fileExists: exists })).toBeNull();
    expect(bundledEngineRoot({ app: { isPackaged: false }, resourcesPath: tmp, fileExists: exists })).toBeNull();
  });

  test('a root that is typed or saved wins over the installed one', () => {
    expect(resolveEngineConfig({ LANA_ENGINE_ROOT: '/dev/engine' }, {}, { bundledRoot: '/app/engine' }).root).toBe('/dev/engine');
    expect(resolveEngineConfig({}, { root: '/saved' }, { bundledRoot: '/app/engine' }).root).toBe('/saved');
    expect(resolveEngineConfig({}, {}, { bundledRoot: '/app/engine' })).toMatchObject({ root: '/app/engine', mode: 'spawn', configured: true });
    expect(resolveEngineConfig({}, { enabled: false }, { bundledRoot: '/app/engine' })).toMatchObject({ mode: 'off', reason: 'disabled' });
  });
});
