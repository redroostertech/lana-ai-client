/**
 * The LANA document editor on this computer (electron-editor-service.js): where its service
 * comes from, how it is started (Electron as Node, loopback only, a free port, a per-launch
 * token, a user-data key folder), when it counts as ready, restarts that keep the address and
 * token, stopping, and which requests get the token. Processes, fetch and ports are test
 * doubles; timers are Jest's fake timers.
 */

const path = require('path');
const { EventEmitter } = require('events');
const {
  createEditorService, resolveEditorServiceScript, editorServiceEnv, authorizeEditorRequest, EDITOR_DEFAULTS, SERVICE_NAME
} = require('../../electron-editor-service');

const TOKEN = 'b'.repeat(64);
const ROOT = path.join('/app', 'res', 'lana-editor');
const SCRIPT = path.join(ROOT, 'packages', 'redline-service', 'dist', 'server.bundle.mjs');
const KEYS = path.join('/user', 'data', 'lana-editor', 'keys');

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stdout = { pipe: jest.fn() };
  child.stderr = { pipe: jest.fn() };
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    Promise.resolve().then(() => { child.exitCode = 0; child.emit('exit', null, signal); });
    return true;
  };
  return child;
}

function harness({ script = SCRIPT, health = { ok: true, service: SERVICE_NAME }, keyStatus = 200 } = {}) {
  const spawns = [];
  const children = [];
  const calls = [];
  const server = { health, keyStatus, up: true };
  const mkdirSync = jest.fn();
  const service = createEditorService({
    script,
    execPath: '/app/Electron',
    keyDir: KEYS,
    spawn: jest.fn((cmd, args, options) => {
      spawns.push({ cmd, args, options });
      const child = fakeChild(5000 + children.length);
      children.push(child);
      return child;
    }),
    fetch: jest.fn(async (url, init = {}) => {
      calls.push({ url, init });
      if (!server.up) {throw new Error('connect ECONNREFUSED');}
      if (url.endsWith('/v1/health')) {return { ok: true, status: 200, json: async () => server.health };}
      return { ok: server.keyStatus === 200, status: server.keyStatus };
    }),
    pickPort: jest.fn(async () => 53117),
    fsImpl: { mkdirSync },
    baseEnv: { PATH: '/usr/bin', HOME: '/home/t', LANA_EDITOR_HOST: '0.0.0.0', JWT_SECRET: 'nope', DATABASE_URL: 'postgresql://nope' },
    makeToken: () => TOKEN
  });
  return { service, spawns, children, calls, server, mkdirSync };
}

const settle = (ms = EDITOR_DEFAULTS.healthIntervalStartingMs) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('where the editor service is', () => {
  const exists = (...present) => (file) => present.includes(file);

  test('the installed app runs its own copy from <resources>/lana-editor', () => {
    expect(resolveEditorServiceScript({ isPackaged: true, resourcesPath: '/app/res', fileExists: exists(SCRIPT) })).toBe(SCRIPT);
    // A developer bundle is ignored in an installed app.
    expect(resolveEditorServiceScript({ isPackaged: true, resourcesPath: '/app/res', env: { LANA_EDITOR_BUNDLE: '/dev/server.bundle.mjs' }, fileExists: exists(SCRIPT, '/dev/server.bundle.mjs') })).toBe(SCRIPT);
    expect(resolveEditorServiceScript({ isPackaged: true, resourcesPath: '/app/res', fileExists: exists() })).toBeNull();
  });

  test('a development run uses build/lana-editor, or LANA_EDITOR_BUNDLE when it is set', () => {
    const dev = path.join('/repo', 'build', 'lana-editor', 'packages', 'redline-service', 'dist', 'server.bundle.mjs');
    expect(resolveEditorServiceScript({ appRoot: '/repo', fileExists: exists(dev) })).toBe(dev);
    expect(resolveEditorServiceScript({ appRoot: '/repo', env: { LANA_EDITOR_BUNDLE: '/dev/server.bundle.mjs' }, fileExists: exists('/dev/server.bundle.mjs') })).toBe('/dev/server.bundle.mjs');
    expect(resolveEditorServiceScript({ appRoot: '/repo', fileExists: exists() })).toBeNull();
  });
});

describe('starting the editor service', () => {
  test('Electron as Node runs the bundle on 127.0.0.1, a free port, a per-launch token and the user-data key folder', async () => {
    const { service, spawns, mkdirSync } = harness();
    await service.start();
    expect(spawns).toHaveLength(1);
    const { cmd, args, options } = spawns[0];
    expect(cmd).toBe('/app/Electron');
    expect(args).toEqual([SCRIPT]);
    expect(options.cwd).toBe(ROOT);
    expect(options.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      LANA_EDITOR_HOST: '127.0.0.1',
      LANA_EDITOR_PORT: '53117',
      LANA_EDITOR_SERVICE_TOKEN: TOKEN,
      LANA_EDITOR_KEY_DIR: KEYS,
      PATH: '/usr/bin',
      HOME: '/home/t'
    });
    // Nothing else of the client's environment reaches it.
    expect(options.env).not.toHaveProperty('JWT_SECRET');
    expect(options.env).not.toHaveProperty('DATABASE_URL');
    expect(mkdirSync).toHaveBeenCalledWith(KEYS, expect.objectContaining({ recursive: true }));
    expect(service.baseUrl()).toBe('http://127.0.0.1:53117');
  });

  test('each launch gets a new random token', () => {
    const a = editorServiceEnv({}, { port: 1, token: 'x', keyDir: KEYS, root: ROOT });
    expect(a.LANA_EDITOR_HOST).toBe('127.0.0.1');
    const service1 = createEditorService({ script: SCRIPT, execPath: 'e', keyDir: KEYS, spawn: () => fakeChild(1), fetch: async () => ({ ok: false, status: 503 }), pickPort: async () => 1, fsImpl: { mkdirSync() {} } });
    const service2 = createEditorService({ script: SCRIPT, execPath: 'e', keyDir: KEYS, spawn: () => fakeChild(2), fetch: async () => ({ ok: false, status: 503 }), pickPort: async () => 1, fsImpl: { mkdirSync() {} } });
    return Promise.all([service1.start(), service2.start()]).then(() => {
      const t1 = service1.requestHeaders({ url: 'http://127.0.0.1:1/v1/redline', pageUrl: 'file:///app/x.html', headers: {} }).Authorization;
      const t2 = service2.requestHeaders({ url: 'http://127.0.0.1:1/v1/redline', pageUrl: 'file:///app/x.html', headers: {} }).Authorization;
      expect(t1).toMatch(/^Bearer [0-9a-f]{64}$/);
      expect(t1).not.toBe(t2);
      return Promise.all([service1.stop(), service2.stop()]);
    });
  });

  test('it is ready once health answers for the editor and an authorized call succeeds', async () => {
    const { service, calls } = harness();
    await service.start();
    await settle();
    expect(service.getState().server).toMatchObject({ process: 'running', healthy: true });
    const probe = calls.find((call) => call.url.endsWith('/v1/manifests/public-key'));
    expect(probe.init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  test('a token the service refuses, or another program on the port, is not ready', async () => {
    const refused = harness({ keyStatus: 401 });
    await refused.service.start();
    await settle();
    expect(refused.service.getState().server).toMatchObject({ process: 'starting', lastHealthError: 'authorized test request answered 401' });

    const other = harness({ health: { ok: true, service: 'something-else' } });
    await other.service.start();
    await settle();
    expect(other.service.getState().server.healthy).toBe(false);
  });

  test('without the editor on this computer nothing starts and there is no address', async () => {
    const { service, spawns } = harness({ script: null });
    await service.start();
    expect(spawns).toHaveLength(0);
    expect(service.baseUrl()).toBe('');
    expect(service.getState()).toEqual({ installed: false, server: null });
  });
});

describe('restarts and stopping', () => {
  test('after a crash it starts again with backoff on the same port and token', async () => {
    const { service, spawns, children } = harness();
    await service.start();
    await settle();
    children[0].exitCode = 1;
    children[0].emit('exit', 1, null);
    expect(service.getState().server.process).toBe('restarting');
    await settle(EDITOR_DEFAULTS.minBackoffMs - 1);
    expect(spawns).toHaveLength(1);
    await settle(1);
    expect(spawns).toHaveLength(2);
    expect(spawns[1].options.env.LANA_EDITOR_PORT).toBe('53117');
    expect(spawns[1].options.env.LANA_EDITOR_SERVICE_TOKEN).toBe(TOKEN);
    expect(service.baseUrl()).toBe('http://127.0.0.1:53117');
    // A second crash waits twice as long.
    await settle();
    children[1].exitCode = 1;
    children[1].emit('exit', 1, null);
    await settle(EDITOR_DEFAULTS.minBackoffMs * 2 - 1);
    expect(spawns).toHaveLength(2);
    await settle(1);
    expect(spawns).toHaveLength(3);
  });

  test('stop ends the process, clears the address and the token, and does not restart it', async () => {
    const { service, spawns, children } = harness();
    await service.start();
    await settle();
    await service.stop();
    expect(children[0].signals).toEqual(['SIGTERM']);
    expect(service.baseUrl()).toBe('');
    expect(service.requestHeaders({ url: 'http://127.0.0.1:53117/v1/redline', pageUrl: 'file:///a.html', headers: {} })).toEqual({});
    await settle(EDITOR_DEFAULTS.maxBackoffMs);
    expect(spawns).toHaveLength(1);
  });
});

describe('which requests get the token', () => {
  const editor = { baseUrl: 'http://127.0.0.1:53117', token: TOKEN };
  const page = 'file:///Applications/LANA.app/Contents/Resources/app.asar/public_html/file-viewer.html';

  test('the app\'s own pages calling the editor\'s /v1 API get it, replacing any they sent', () => {
    expect(authorizeEditorRequest({ url: 'http://127.0.0.1:53117/v1/documents/xml', pageUrl: page, headers: { 'Content-Type': 'application/octet-stream', authorization: 'Bearer chef-jwt' } }, editor))
      .toEqual({ 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${TOKEN}` });
  });

  test('anything else is left alone', () => {
    const headers = { Authorization: 'Bearer chef-jwt' };
    const cases = [
      { url: 'https://chef.example/v1/redline', pageUrl: page },               // another server
      { url: 'http://127.0.0.1:53117/embed/index.js', pageUrl: page },         // static files need none
      { url: 'http://127.0.0.1:531170/v1/redline', pageUrl: page },            // a different port
      { url: 'http://127.0.0.1:53117/v1/redline', pageUrl: 'https://web.example/x' }, // a web page the app shows
      { url: 'http://127.0.0.1:53117/v1/redline', pageUrl: '' }
    ];
    for (const request of cases) {expect(authorizeEditorRequest({ ...request, headers }, editor)).toBe(headers);}
    expect(authorizeEditorRequest({ url: 'http://127.0.0.1:53117/v1/redline', pageUrl: page, headers }, { baseUrl: '', token: null })).toBe(headers);
  });
});
