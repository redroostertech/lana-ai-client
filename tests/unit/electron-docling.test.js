/**
 * Docling on this computer (electron-docling.js): where it comes from, what it is given, when it
 * counts as ready, what the engine is handed, and stopping. Processes, fetch and ports are test
 * doubles; timers are Jest's fake timers.
 */

const path = require('path');
const { EventEmitter } = require('events');
const { createDocling, resolveDoclingCommand, doclingEnv, doclingEndpoints, DOCLING_DEFAULTS } = require('../../electron-docling');

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stdout = { pipe: jest.fn() };
  child.stderr = { pipe: jest.fn() };
  child.kill = () => {
    Promise.resolve().then(() => { child.exitCode = 0; child.emit('exit', null, 'SIGTERM'); });
    return true;
  };
  return child;
}

const COMMAND = { command: '/data/docling/docling-serve/docling-serve', args: (port) => ['run', '--host', '127.0.0.1', '--port', String(port)], cwd: '/data/docling/docling-serve', env: { DOCLING_SERVE_ARTIFACTS_PATH: '/data/docling/models' } };

function harness({ command = COMMAND, health = { status: 'ok' }, status = 200 } = {}) {
  const spawns = [];
  const addresses = [];
  const server = { health, status, up: true };
  const docling = createDocling({
    command,
    spawn: jest.fn((cmd, args, options) => { spawns.push({ cmd, args, options }); return fakeChild(5000 + spawns.length); }),
    fetch: jest.fn(async () => {
      if (!server.up) {throw new Error('connect ECONNREFUSED');}
      return { ok: server.status < 400, status: server.status, json: async () => server.health };
    }),
    pickPort: jest.fn(async () => 51300),
    baseEnv: { PATH: '/usr/bin', HOME: '/home/t', DATABASE_URL: 'postgresql://nope', JWT_SECRET: 'nope' },
    onAddress: (value) => addresses.push(value)
  });
  return { docling, spawns, addresses, server };
}

const settle = (ms = DOCLING_DEFAULTS.healthIntervalStartingMs) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('where Docling is', () => {
  const exists = (...present) => (file) => present.includes(file);
  const listen = ['run', '--host', '127.0.0.1', '--port', '9'];

  test('a docling-serve the developer already runs (LANA_DOCLING_URL) is used as is', () => {
    expect(resolveDoclingCommand({ env: { LANA_DOCLING_URL: 'http://127.0.0.1:8085/' }, fileExists: exists() })).toEqual({ external: 'http://127.0.0.1:8085', source: 'external' });
  });

  test('a developer program (LANA_DOCLING_BIN), with the downloaded models when they are there', () => {
    const models = path.join('/data', 'docling', 'models');
    const found = resolveDoclingCommand({ env: { LANA_DOCLING_BIN: '/b/docling-serve' }, userDataDir: '/data', fileExists: exists('/b/docling-serve', models) });
    expect(found).toMatchObject({ command: '/b/docling-serve', cwd: '/b', env: { DOCLING_SERVE_ARTIFACTS_PATH: models } });
    expect(found.args(9)).toEqual(listen);
    expect(resolveDoclingCommand({ env: { LANA_DOCLING_BIN: '/b/missing' }, fileExists: exists() })).toBeNull();
  });

  test('the runtime first-launch setup installed: its Python runs docling-serve, offline, with its models', () => {
    const dir = path.join('/data', 'docling', 'runtime-1.15.1-1');
    const program = path.join(dir, 'python', 'bin', 'python3');
    const models = path.join('/data', 'docling', 'models');
    const installedRuntime = () => ({ dir, models, program, args: ['-I', '-B', '-u', '-m', 'docling_serve', 'run'] });
    const found = resolveDoclingCommand({ env: {}, userDataDir: '/data', home: '/home/t', platform: 'darwin', fileExists: exists(program, path.join('/home/t', '.venv', 'docling', 'bin', 'docling-serve')), installedRuntime });
    expect(found).toMatchObject({ command: program, cwd: dir, source: 'runtime', env: { DOCLING_SERVE_ARTIFACTS_PATH: models, HF_HUB_OFFLINE: '1' } });
    expect(found.args(9)).toEqual(['-I', '-B', '-u', '-m', 'docling_serve', 'run', '--host', '127.0.0.1', '--port', '9']);
    // Not installed (or its program is gone): the development fallbacks still apply.
    expect(resolveDoclingCommand({ env: {}, userDataDir: '/data', home: '/home/t', platform: 'darwin', fileExists: exists(), installedRuntime })).toBeNull();
    expect(resolveDoclingCommand({ env: {}, userDataDir: '/data', home: '/home/t', platform: 'darwin', fileExists: exists(), installedRuntime: () => null })).toBeNull();
    // A developer program named in the environment comes first.
    expect(resolveDoclingCommand({ env: { LANA_DOCLING_BIN: '/b/docling-serve' }, userDataDir: '/data', fileExists: exists('/b/docling-serve', program), installedRuntime }).source).toBe('bin');
  });

  test('development: a Python environment with docling-serve; none at all means no Docling', () => {
    const venvBin = path.join('/home/t', '.venv', 'docling', 'bin', 'docling-serve');
    expect(resolveDoclingCommand({ env: {}, home: '/home/t', platform: 'darwin', fileExists: exists(venvBin) })).toMatchObject({ command: venvBin });
    expect(resolveDoclingCommand({ env: {}, home: '/home/t', platform: 'darwin', fileExists: exists() })).toBeNull();
  });
});

test('its environment: OS basics and its models; nothing else of the client\'s', () => {
  expect(doclingEnv({ PATH: '/usr/bin', DATABASE_URL: 'postgresql://nope', JWT_SECRET: 'x' }, { DOCLING_SERVE_ARTIFACTS_PATH: '/m' }))
    .toEqual({ PATH: '/usr/bin', DOCLING_SERVE_ARTIFACTS_PATH: '/m', PYTHONUNBUFFERED: '1' });
});

test('the engine gets the address with longer reading timeouts, or nothing', () => {
  expect(doclingEndpoints('http://127.0.0.1:51300')).toEqual({ DOCLING_API_URL: 'http://127.0.0.1:51300', DOC_PARSER_TIMEOUT_DOCLING_MS: '240000', DOCLING_TIMEOUT_MS: '240000' });
  expect(doclingEndpoints(null)).toEqual({});
});

describe('running it', () => {
  test('ready only when /health says ok; then the engine gets the address, and stopping takes it away', async () => {
    const h = harness({ health: { status: 'starting' } });
    await h.docling.start();
    expect(h.spawns[0]).toMatchObject({ cmd: COMMAND.command, args: ['run', '--host', '127.0.0.1', '--port', '51300'] });
    expect(h.spawns[0].options.env.DATABASE_URL).toBeUndefined();
    expect(h.spawns[0].options.env.DOCLING_SERVE_ARTIFACTS_PATH).toBe('/data/docling/models');
    await settle(2000);
    expect(h.addresses).toEqual([]);
    h.server.health = { status: 'ok' };
    await settle();
    expect(h.addresses).toEqual(['http://127.0.0.1:51300']);
    await h.docling.stop();
    expect(h.addresses).toEqual(['http://127.0.0.1:51300', null]);
  });

  test('a health answer that is not 200 is not ready', async () => {
    const h = harness({ status: 503 });
    await h.docling.start();
    await settle(2000);
    expect(h.addresses).toEqual([]);
    expect(h.docling.getState().server.lastHealthError).toBe('health answered 503');
  });

  test('no Docling here: nothing starts and the engine gets no address', async () => {
    const h = harness({ command: null });
    await h.docling.start();
    expect(h.spawns).toEqual([]);
    expect(h.addresses).toEqual([]);
    expect(h.docling.getState()).toEqual({ installed: false, external: false, server: null });
  });

  test('installed while the app runs: start() asks again and starts it, without a restart', async () => {
    let current = null;
    const h = harness({ command: () => current });
    await h.docling.start();
    expect(h.spawns).toEqual([]);
    current = COMMAND;
    await h.docling.start();
    expect(h.spawns).toHaveLength(1);
    expect(h.spawns[0].cmd).toBe(COMMAND.command);
    expect(h.docling.getState().installed).toBe(true);
    await h.docling.stop();
  });

  test('a developer\'s running docling-serve is handed over without starting anything', async () => {
    const h = harness({ command: { external: 'http://127.0.0.1:8085' } });
    await h.docling.start();
    expect(h.spawns).toEqual([]);
    expect(h.addresses).toEqual(['http://127.0.0.1:8085']);
  });
});
