/**
 * Local AI engine supervisor (electron-engine-supervisor.js): spawn command
 * and environment, health polling, restart with capped backoff, stop.
 * Every side effect is a test double; timers are Jest's fake timers.
 */

const path = require('path');
const { EventEmitter } = require('events');
const { createEngineSupervisor, buildEngineEnv, DEFAULTS } = require('../../electron-engine-supervisor');

const ROOT = path.join('/opt', 'lana-engine');
const CHEF = 'https://chef.example.test';

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (!child.ignoreSigterm || signal === 'SIGKILL') {
      Promise.resolve().then(() => { child.exitCode = 0; child.emit('exit', null, signal); });
    }
    return true;
  };
  return child;
}

const READY_HEALTH = {
  status: 'ok',
  role: 'engine',
  data_api: { version: '1.0', min_server: '1.0' },
  chef: { origin: CHEF, status: 'ready', reachable: true, api: '1.0', min_client: '1.0' },
  version: { status: 'ok' }
};

function harness({ healthy = true, env = {}, options = {} } = {}) {
  const children = [];
  const calls = [];
  const states = [];
  const health = { healthy, body: READY_HEALTH };
  const fetchMock = jest.fn(async (url) => {
    if (!health.healthy) {throw new Error('connect ECONNREFUSED');}
    return { ok: true, status: 200, json: async () => health.body, url };
  });
  const supervisor = createEngineSupervisor({
    spawn: jest.fn((command, args, spawnOptions) => {
      calls.push({ command, args, options: spawnOptions });
      const child = fakeChild(1000 + children.length);
      children.push(child);
      return child;
    }),
    fetch: fetchMock,
    pickPort: jest.fn(async (preferred) => preferred || 47011),
    fileExists: (file) => file === path.join(ROOT, 'src', 'engine', 'index.js'),
    onState: (state) => states.push(state),
    baseEnv: {
      PATH: '/usr/bin',
      HOME: '/home/tester',
      DATABASE_URL: 'postgresql://localhost/lana_chef',
      POSTGRES_PASSWORD: 'secret',
      PGHOST: 'db',
      DB_HOST: 'db',
      REDIS_URL: 'redis://localhost',
      JWT_SECRET: 'nope',
      ...env
    },
    cwd: '/tmp/lana-engine-cwd',
    options: { ...options }
  });
  return { supervisor, children, calls, states, health, fetchMock };
}

const spawnConfig = { mode: 'spawn', root: ROOT };

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('spawn', () => {
  test('starts node on the engine entry with the engine role, Chef URL and a loopback port', async () => {
    const { supervisor, calls } = harness();
    const state = await supervisor.configure(spawnConfig, CHEF);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('node');
    expect(calls[0].args).toEqual([path.join(ROOT, 'src', 'engine', 'index.js')]);
    expect(calls[0].options.cwd).toBe('/tmp/lana-engine-cwd');
    const env = calls[0].options.env;
    expect(env.LANA_RUNTIME_ROLE).toBe('engine');
    expect(env.LANA_CHEF_URL).toBe(CHEF);
    expect(env.LANA_ENGINE_HOST).toBe('127.0.0.1');
    expect(env.LANA_ENGINE_PORT).toBe('47011');
    expect(state.url).toBe('http://127.0.0.1:47011');
    expect(state.process).toBe('starting');
  });

  test('the engine environment carries no database (or other inherited secret) variables', async () => {
    const { supervisor, calls } = harness();
    await supervisor.configure(spawnConfig, CHEF);
    const env = calls[0].options.env;
    const names = Object.keys(env);
    expect(names.filter((name) => /^(DATABASE|DB_|PG|POSTGRES|REDIS)/.test(name))).toEqual([]);
    expect(env.JWT_SECRET).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/tester');
  });

  test('buildEngineEnv keeps only allowlisted variables plus the extra env of the node binary', () => {
    const env = buildEngineEnv({ DATABASE_URL: 'x', PATH: '/bin' }, { chefUrl: CHEF, port: 1, extra: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  test('reuses the preferred (persisted) port', async () => {
    const { supervisor, calls } = harness();
    await supervisor.configure({ ...spawnConfig, preferredPort: 48123 }, CHEF);
    expect(calls[0].options.env.LANA_ENGINE_PORT).toBe('48123');
  });

  test('does not spawn without a Chef URL or when the engine entry is missing', async () => {
    const a = harness();
    expect((await a.supervisor.configure(spawnConfig, null)).reason).toBe('no_server');
    const b = harness();
    expect((await b.supervisor.configure({ mode: 'spawn', root: '/nowhere' }, CHEF)).reason).toBe('engine_not_found');
    expect(a.calls.length + b.calls.length).toBe(0);
  });

  test('off mode spawns nothing and has no URL', async () => {
    const { supervisor, calls } = harness();
    const state = await supervisor.configure({ mode: 'off', reason: 'disabled' }, CHEF);
    expect(calls).toHaveLength(0);
    expect(state).toMatchObject({ mode: 'off', reason: 'disabled', url: null });
  });
});

describe('control channel secret (phase 8d)', () => {
  test('every engine process gets its own fresh secret in its environment; it never appears in the state shown to renderers', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    const first = h.calls[0].options.env.LANA_ENGINE_CONTROL_SECRET;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(h.supervisor.getControlSecret()).toBe(first);
    expect(JSON.stringify(h.supervisor.getState())).not.toContain(first);
    expect(JSON.stringify(h.states)).not.toContain(first);
    const restarting = h.supervisor.restart();
    await jest.advanceTimersByTimeAsync(0);
    await restarting;
    const second = h.calls[1].options.env.LANA_ENGINE_CONTROL_SECRET;
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(h.supervisor.getControlSecret()).toBe(second);
    await h.supervisor.stop();
    expect(h.supervisor.getControlSecret()).toBeNull();
  });

  test('an engine started elsewhere (attach mode) has no secret from this client', async () => {
    const h = harness();
    await h.supervisor.configure({ mode: 'attach', attachUrl: 'http://127.0.0.1:46180' }, CHEF);
    expect(h.supervisor.getControlSecret()).toBeNull();
  });
});

describe('health', () => {
  test('polls the health endpoint and reports running once it answers', async () => {
    const { supervisor } = harness();
    await supervisor.configure(spawnConfig, CHEF);
    await jest.advanceTimersByTimeAsync(DEFAULTS.healthIntervalStartingMs);
    const state = supervisor.getState();
    expect(state.process).toBe('running');
    expect(state.healthy).toBe(true);
    expect(state.health.chef.status).toBe('ready');
  });

  test('the health URL is the engine health route on the loopback port', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    await jest.advanceTimersByTimeAsync(DEFAULTS.healthIntervalStartingMs);
    expect(h.fetchMock).toHaveBeenCalledWith('http://127.0.0.1:47011/api/engine/v1/health', expect.objectContaining({ method: 'GET' }));
  });

  test('restarts the engine when it stops answering health after being healthy', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    await jest.advanceTimersByTimeAsync(DEFAULTS.healthIntervalStartingMs);
    h.health.healthy = false;
    await jest.advanceTimersByTimeAsync(DEFAULTS.healthIntervalRunningMs * DEFAULTS.maxHealthFailures);
    expect(h.children[0].signals).toContain('SIGTERM');
    await jest.advanceTimersByTimeAsync(0); // the old process exits
    expect(h.supervisor.getState().process).toBe('restarting');
    await jest.advanceTimersByTimeAsync(DEFAULTS.minBackoffMs);
    expect(h.children).toHaveLength(2);
  });

  test('restarts when the engine never becomes healthy within the start timeout', async () => {
    const h = harness({ healthy: false });
    await h.supervisor.configure(spawnConfig, CHEF);
    await jest.advanceTimersByTimeAsync(DEFAULTS.startTimeoutMs);
    expect(h.children[0].signals).toContain('SIGTERM');
    await jest.advanceTimersByTimeAsync(0); // the old process exits
    expect(h.supervisor.getState().process).toBe('restarting');
    await jest.advanceTimersByTimeAsync(DEFAULTS.minBackoffMs);
    expect(h.children).toHaveLength(2);
  });
});

describe('restart on crash', () => {
  test('backs off exponentially and caps the delay', async () => {
    const h = harness({ healthy: false, options: { startTimeoutMs: 10 ** 9 } });
    await h.supervisor.configure(spawnConfig, CHEF);
    const delays = [];
    for (let i = 0; i < 7; i += 1) {
      const child = h.children[h.children.length - 1];
      child.exitCode = 1;
      child.emit('exit', 1, null);
      const state = h.supervisor.getState();
      expect(state.process).toBe('restarting');
      const delay = Date.parse(state.nextRestartAt) - Date.now();
      delays.push(delay);
      await jest.advanceTimersByTimeAsync(delay);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(h.children).toHaveLength(8);
  });

  test('a minute of health resets the backoff', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    h.children[0].exitCode = 1;
    h.children[0].emit('exit', 1, null);
    await jest.advanceTimersByTimeAsync(DEFAULTS.minBackoffMs);
    await jest.advanceTimersByTimeAsync(DEFAULTS.healthIntervalStartingMs);
    expect(h.supervisor.getState().restarts).toBe(1);
    await jest.advanceTimersByTimeAsync(DEFAULTS.stableResetMs);
    expect(h.supervisor.getState().restarts).toBe(0);
  });

  test('a new Chef URL restarts the engine pointed at it', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    const pending = h.supervisor.configure(spawnConfig, 'https://other.example.test');
    await jest.advanceTimersByTimeAsync(0);
    await pending;
    expect(h.children[0].signals).toContain('SIGTERM');
    expect(h.calls[1].options.env.LANA_CHEF_URL).toBe('https://other.example.test');
  });

  test('the same configuration twice does not restart', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    await h.supervisor.configure(spawnConfig, CHEF);
    expect(h.children).toHaveLength(1);
  });
});

describe('stop', () => {
  test('sends SIGTERM, does not restart, and clears the URL', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    const stopping = h.supervisor.stop();
    await jest.advanceTimersByTimeAsync(0);
    await stopping;
    expect(h.children[0].signals).toEqual(['SIGTERM']);
    await jest.advanceTimersByTimeAsync(DEFAULTS.maxBackoffMs * 2);
    expect(h.children).toHaveLength(1);
    expect(h.supervisor.getState()).toMatchObject({ mode: 'off', process: 'stopped', url: null });
  });

  test('SIGKILL after the grace period when SIGTERM is ignored', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    h.children[0].ignoreSigterm = true;
    const stopping = h.supervisor.stop();
    await jest.advanceTimersByTimeAsync(DEFAULTS.stopGraceMs);
    await stopping;
    expect(h.children[0].signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  test('the Settings restart kills and respawns at once with the backoff reset', async () => {
    const h = harness();
    await h.supervisor.configure(spawnConfig, CHEF);
    const restarting = h.supervisor.restart();
    await jest.advanceTimersByTimeAsync(0);
    await restarting;
    expect(h.children).toHaveLength(2);
    expect(h.supervisor.getState().restarts).toBe(0);
  });
});

describe('attach', () => {
  test('watches an engine started elsewhere without spawning or killing it', async () => {
    const h = harness();
    const state = await h.supervisor.configure({ mode: 'attach', attachUrl: 'http://127.0.0.1:46180' }, CHEF);
    expect(state.url).toBe('http://127.0.0.1:46180');
    await jest.advanceTimersByTimeAsync(0);
    expect(h.supervisor.getState()).toMatchObject({ process: 'running', healthy: true });
    await h.supervisor.stop();
    expect(h.calls).toHaveLength(0);
  });
});
