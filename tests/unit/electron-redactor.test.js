/**
 * The redactor on this computer (electron-redactor.js): where it comes from, what it is given,
 * when it counts as ready (both health flags and a signed test request), what the engine is
 * handed, restarts that keep the address, and stopping. Processes, fetch and ports are test
 * doubles; timers are Jest's fake timers.
 */

const path = require('path');
const { EventEmitter } = require('events');
const {
  createRedactor, resolveRedactorCommand, redactorEnv, redactorEndpoints, REDACTOR_DEFAULTS, SERVICE_NAME
} = require('../../electron-redactor');

const SECRET = 'a'.repeat(64);

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

const COMMAND = { command: '/app/redactor/lana-redactor', args: (port) => ['--host', '127.0.0.1', '--port', String(port)], cwd: '/app/redactor', env: {} };

function harness({ command = COMMAND, health = { ready: true, analyzer_ready: true }, probeStatus = 200 } = {}) {
  const spawns = [];
  const children = [];
  const addresses = [];
  const calls = [];
  const server = { health, probeStatus, up: true };
  const redactor = createRedactor({
    command,
    spawn: jest.fn((cmd, args, options) => {
      spawns.push({ cmd, args, options });
      const child = fakeChild(4000 + children.length);
      children.push(child);
      return child;
    }),
    fetch: jest.fn(async (url, init = {}) => {
      calls.push({ url, init });
      if (!server.up) {throw new Error('connect ECONNREFUSED');}
      if (url.endsWith('/healthz')) {return { ok: true, status: 200, json: async () => server.health };}
      return { ok: server.probeStatus === 200, status: server.probeStatus };
    }),
    pickPort: jest.fn(async () => 51234),
    baseEnv: { PATH: '/usr/bin', HOME: '/home/t', DATABASE_URL: 'postgresql://nope', REDACTOR_URL: 'http://elsewhere', JWT_SECRET: 'nope' },
    makeSecret: () => SECRET,
    onAddress: (value) => addresses.push(value)
  });
  return { redactor, spawns, children, addresses, calls, server };
}

const settle = (ms = REDACTOR_DEFAULTS.healthIntervalStartingMs) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('where the redactor is', () => {
  const exists = (...present) => (file) => present.includes(file);
  const listen = ['--host', '127.0.0.1', '--port', '9'];

  test('a developer build from LANA_REDACTOR_BIN', () => {
    const found = resolveRedactorCommand({ env: { LANA_REDACTOR_BIN: '/b/lana-redactor' }, fileExists: exists('/b/lana-redactor') });
    expect(found).toMatchObject({ command: '/b/lana-redactor', cwd: '/b' });
    expect(found.args(9)).toEqual(listen);
    expect(resolveRedactorCommand({ env: { LANA_REDACTOR_BIN: '/b/missing' }, fileExists: exists() })).toBeNull();
  });

  test('the installed app\'s own program, with its OCR runtime when it is there', () => {
    const res = '/app/res';
    const bin = path.join(res, 'redactor', 'lana-redactor');
    const tesseract = path.join(res, 'redactor', 'ocr', 'bin', 'tesseract');
    const tessdata = path.join(res, 'redactor', 'ocr', 'tessdata');
    expect(resolveRedactorCommand({ isPackaged: true, resourcesPath: res, platform: 'darwin', fileExists: exists(bin, tesseract, tessdata) }))
      .toMatchObject({ command: bin, env: { LANA_TESSERACT_PATH: tesseract, LANA_TESSDATA_DIR: tessdata } });
    expect(resolveRedactorCommand({ isPackaged: true, resourcesPath: res, platform: 'darwin', fileExists: exists(bin) }).env).toEqual({});
    const win = path.join('C:\\app', 'redactor', 'lana-redactor.exe');
    expect(resolveRedactorCommand({ isPackaged: true, resourcesPath: 'C:\\app', platform: 'win32', fileExists: exists(win) }).command).toBe(win);
    expect(resolveRedactorCommand({ isPackaged: true, resourcesPath: res, fileExists: exists() })).toBeNull();
  });

  test('development: a lana-redactor checkout run with the environment\'s uvicorn, checkout first on PYTHONPATH', () => {
    const uvicorn = path.join('/home/t', '.lananode', 'redactor', 'venv', 'bin', 'uvicorn');
    const main = path.join('/src/lana-redactor', 'redactor', 'main.py');
    const found = resolveRedactorCommand({ env: { LANA_REDACTOR_SRC: '/src/lana-redactor' }, home: '/home/t', platform: 'darwin', fileExists: exists(uvicorn, main) });
    expect(found).toMatchObject({ command: uvicorn, cwd: '/src/lana-redactor', env: { PYTHONPATH: '/src/lana-redactor' } });
    expect(found.args(9)).toEqual(['redactor.main:app', ...listen]);
    // No checkout named, or no environment: none. An installed app never runs a checkout.
    expect(resolveRedactorCommand({ env: {}, home: '/home/t', fileExists: () => true })).toBeNull();
    expect(resolveRedactorCommand({ env: { LANA_REDACTOR_SRC: '/src/lana-redactor' }, home: '/home/t', fileExists: exists(main) })).toBeNull();
    expect(resolveRedactorCommand({ env: { LANA_REDACTOR_SRC: '/src/lana-redactor' }, isPackaged: true, resourcesPath: '/none', home: '/home/t', fileExists: exists(uvicorn, main) })).toBeNull();
  });
});

test('its environment: OS basics, the secret, strict mode; nothing else of the client\'s', () => {
  const env = redactorEnv({ PATH: '/usr/bin', DATABASE_URL: 'postgresql://nope', JWT_SECRET: 'x' }, { secret: SECRET, extra: { PYTHONPATH: '/src' } });
  expect(env).toEqual({ PATH: '/usr/bin', PYTHONPATH: '/src', INTERNAL_SERVICE_SECRET: SECRET, REDACTOR_STRICT: '1', PYTHONUNBUFFERED: '1' });
});

describe('running it', () => {
  test('ready only after both health flags and a signed test request; then the engine gets the address and secret', async () => {
    const h = harness({ health: { ready: true, analyzer_ready: false } });
    await h.redactor.start();
    expect(h.spawns[0]).toMatchObject({ cmd: COMMAND.command, args: ['--host', '127.0.0.1', '--port', '51234'] });
    expect(h.spawns[0].options.env).toMatchObject({ INTERNAL_SERVICE_SECRET: SECRET, REDACTOR_STRICT: '1' });
    expect(h.spawns[0].options.env.DATABASE_URL).toBeUndefined();
    expect(h.spawns[0].options.env.REDACTOR_URL).toBeUndefined();
    await settle(2000);
    // The names layer is not loaded: not ready, and no test request yet.
    expect(h.addresses).toEqual([]);
    expect(h.calls.some((c) => c.url.endsWith('/redact'))).toBe(false);

    h.server.health = { ready: true, analyzer_ready: true };
    await settle();
    const probe = h.calls.find((c) => c.url.endsWith('/redact'));
    expect(probe.init.headers).toMatchObject({ 'X-Lana-Service': SERVICE_NAME, 'X-Lana-Service-Secret': SECRET });
    expect(JSON.parse(probe.init.body).text).toBe('LANA redactor readiness check.');
    expect(h.addresses).toEqual([{ url: 'http://127.0.0.1:51234', secret: SECRET }]);
  });

  test('ready: false (strict mode without its secret) is not ready', async () => {
    const h = harness({ health: { ready: false, analyzer_ready: true } });
    await h.redactor.start();
    await settle(2000);
    expect(h.addresses).toEqual([]);
    expect(h.redactor.getState().server.lastHealthError).toBe('not ready (ready false, analyzer_ready true)');
  });

  test('a test request that is refused is not ready', async () => {
    const h = harness({ probeStatus: 401 });
    await h.redactor.start();
    await settle(2000);
    expect(h.addresses).toEqual([]);
    expect(h.redactor.getState().server.lastHealthError).toBe('signed test request answered 401');
  });

  test('a crash restarts it on the same port with the same secret, so the engine is not told again', async () => {
    const h = harness();
    await h.redactor.start();
    await settle();
    h.children[0].exitCode = 1;
    h.children[0].emit('exit', 1, null);
    await settle(REDACTOR_DEFAULTS.minBackoffMs);
    expect(h.spawns).toHaveLength(2);
    expect(h.spawns[1].args).toEqual(h.spawns[0].args);
    expect(h.spawns[1].options.env.INTERNAL_SERVICE_SECRET).toBe(SECRET);
    await settle();
    expect(h.addresses).toHaveLength(1);
  });

  test('stop ends it and the engine is told there is no redactor', async () => {
    const h = harness();
    await h.redactor.start();
    await settle();
    await h.redactor.stop();
    expect(h.children[0].signals).toEqual(['SIGTERM']);
    expect(h.addresses[h.addresses.length - 1]).toBeNull();
  });

  test('no redactor on this computer: nothing starts', async () => {
    const h = harness({ command: null });
    expect(await h.redactor.start()).toEqual({ installed: false, server: null });
    expect(h.spawns).toEqual([]);
  });
});

test('what the engine is given: address and secret together, or neither', () => {
  expect(redactorEndpoints({ url: 'http://127.0.0.1:5', secret: SECRET })).toEqual({ REDACTOR_URL: 'http://127.0.0.1:5', INTERNAL_SERVICE_SECRET: SECRET });
  expect(redactorEndpoints(null)).toEqual({});
});

describe('packaging', () => {
  const fs = require('fs');
  const beforePack = require('../../scripts/redactor-before-pack');
  const config = require('../../electron-builder.client.json');

  test('the package step refuses a build without the redactor program for its platform', async () => {
    const root = path.resolve(__dirname, '../..');
    expect(beforePack.redactorFile(root, 'win32')).toBe(path.join(root, 'build', 'redactor', 'lana-redactor.exe'));
    expect(beforePack.redactorFile(root, 'darwin')).toBe(path.join(root, 'build', 'redactor', 'lana-redactor'));
    const exists = jest.spyOn(fs, 'existsSync');
    exists.mockReturnValue(false);
    await expect(beforePack({ electronPlatformName: 'darwin' })).rejects.toThrow(/redactor program is missing/);
    exists.mockReturnValue(true);
    await expect(beforePack({ electronPlatformName: 'darwin' })).resolves.toBeUndefined();
    exists.mockRestore();
  });

  test('every installer puts it where the app looks, and the Mac build signs it', () => {
    const placed = (section) => (config[section].extraResources || []).map((entry) => entry.to);
    expect(placed('mac')).toContain('redactor/lana-redactor');
    expect(placed('linux')).toContain('redactor/lana-redactor');
    expect(placed('win')).toContain('redactor/lana-redactor.exe');
    expect(config.mac.binaries).toContain('Contents/Resources/redactor/lana-redactor');
    expect(config.beforePack).toBe('scripts/before-pack.js');
  });

  test('the pin names a full commit and the names model on our bucket', () => {
    const pin = require('../../redactor/redactor-pin.json');
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.spacyModel.url).toMatch(/^https:\/\/models\.lanaai\.io\/redactor\//);
  });
});
