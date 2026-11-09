/**
 * Pip on this computer (electron-pip-supervisor.js): the settings written from the plan, which
 * servers run, the health check against the planned model file, restarts with backoff, the
 * addresses handed to the engine, and stopping. Processes, fetch, ports and files are test
 * doubles; timers are Jest's fake timers.
 */

const path = require('path');
const { EventEmitter } = require('events');
const {
  createPip, chatConfig, embeddingConfig, wantedServers, resolvePipBinary, threadsFor, engineEndpoints, DEFAULTS
} = require('../../electron-pip-supervisor');

const MODELS = path.join('/data', 'models');
const BINARY = path.join('/app', 'pip', 'lqe');

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stdout = { pipe: jest.fn() };
  child.stderr = { pipe: jest.fn() };
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

/** A plan result as electron-first-launch.js hands it over. */
function result({ chat = 'local', vision = true, embedding = 'local', platform = 'darwin', backend = 'metal', cores = 12, contextTokens = 32768 } = {}) {
  const entries = new Map([
    ['nomic', { id: 'nomic', filename: 'nomic-embed-text-v1.5.f16.gguf' }],
    ['qwen4b', { id: 'qwen4b', filename: 'Qwen3.5-4B-Q4_K_M.gguf' }],
    ['qwen9b', { id: 'qwen9b', filename: 'Qwen3.5-9B-Q4_K_M.gguf' }],
    ['mm4b', { id: 'mm4b', filename: 'mmproj-Qwen3.5-4B-BF16.gguf' }]
  ]);
  return {
    entries,
    hardware: { platform, cores, accelerator: { backend } },
    plan: {
      embedding: { id: embedding === 'local' ? 'nomic' : null, where: embedding },
      chat: chat === 'local' ? { id: 'qwen4b', where: 'local', contextTokens, parallel: 2 } : { id: null, where: 'cloud' },
      vision: { id: chat === 'local' && vision ? 'mm4b' : null }
    }
  };
}

function harness({ env = {}, binary = BINARY, busyPorts = [] } = {}) {
  const children = [];
  const spawns = [];
  const files = {};
  const addresses = [];
  const serving = {}; // port -> model file name /health reports
  const down = new Set(); // ports that refuse connections
  const logs = [];
  const pip = createPip({
    binary,
    dir: path.join('/user', 'pip'),
    env,
    spawn: jest.fn((command, args) => {
      spawns.push({ command, args });
      const child = fakeChild(2000 + children.length);
      children.push(child);
      return child;
    }),
    fetch: jest.fn(async (url) => {
      const port = Number(new URL(url).port);
      if (down.has(port) || !serving[port]) {throw new Error('connect ECONNREFUSED');}
      return { ok: true, status: 200, json: async () => ({ status: 'ok', model_file: { name: serving[port] } }) };
    }),
    pickPort: jest.fn(async (preferred) => (busyPorts.includes(preferred) ? 50000 + preferred : preferred)),
    fsImpl: {
      mkdirSync: jest.fn(),
      writeFileSync: (file, text) => { files[file] = JSON.parse(text); },
      createWriteStream: jest.fn(() => { const sink = { end: jest.fn() }; logs.push(sink); return sink; })
    },
    onAddresses: (value) => addresses.push(value)
  });
  /** Pretend each started server loaded its settings file's model. */
  const serveFromSettings = () => {
    for (const settings of Object.values(files)) {serving[settings.port] = path.basename(settings.model);}
  };
  return { pip, children, spawns, files, addresses, serving, down, logs, serveFromSettings };
}

const settle = async (ms = DEFAULTS.healthIntervalStartingMs) => {
  await jest.advanceTimersByTimeAsync(ms);
};

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('settings from the plan', () => {
  test('chat: the planned model, image file, size per slot and slots, on loopback, graphics on Apple', () => {
    const config = chatConfig({ modelPath: '/m/chat.gguf', mmprojPath: '/m/mm.gguf', port: 8081, contextTokens: 16384, parallel: 2, hardware: { platform: 'darwin', cores: 12, accelerator: { backend: 'metal' } } });
    expect(config).toMatchObject({ model: '/m/chat.gguf', mmproj: '/m/mm.gguf', host: '127.0.0.1', port: 8081, ctx: 16384, parallel: 2, kv_type: 'q8_0', gpu_layers: 99, gpu_output: true, threads: 10, metal_residency_keep_alive_s: 86400 });
    // Conversations are never written to disk.
    expect(config).not.toHaveProperty('session_dir');
  });

  test('chat on a computer with no graphics chip runs on the processor; no Apple-only setting elsewhere', () => {
    const config = chatConfig({ modelPath: '/m/c.gguf', port: 8081, contextTokens: 8192, parallel: 2, hardware: { platform: 'linux', cores: 8, accelerator: { backend: 'cpu' } } });
    expect(config).toMatchObject({ gpu_layers: 0, gpu_output: false, threads: 6 });
    expect(config).not.toHaveProperty('mmproj');
    expect(config).not.toHaveProperty('metal_residency_keep_alive_s');
    expect(chatConfig({ modelPath: '/m/c.gguf', port: 1, contextTokens: 8192, parallel: 2, hardware: { platform: 'win32', accelerator: { backend: 'cuda' } } }).gpu_layers).toBe(99);
  });

  test('embedding keeps the settings the server uses for nomic', () => {
    expect(embeddingConfig({ modelPath: '/m/e.gguf', port: 8082, hardware: { cores: 12 } })).toEqual({
      model: '/m/e.gguf', role: 'embed', alias: 'nomic-embed-text', host: '127.0.0.1', port: 8082, ctx: 2048, ubatch: 2048, parallel: 1,
      threads: 4, queue_timeout: 20, embed_prefix_policy: 'none', embed_empty_input: 'refuse', embed_max_batch: 256
    });
  });

  test('threads leave two for the computer, between 1 and 10', () => {
    expect([threadsFor(2), threadsFor(4), threadsFor(12), threadsFor(64), threadsFor(undefined)]).toEqual([1, 2, 10, 10, 2]);
  });

  test('which servers run: chat only when the plan keeps it here, none for a role the environment names', () => {
    expect(Object.keys(wantedServers({ result: result(), modelsDir: MODELS })).filter((k) => wantedServers({ result: result(), modelsDir: MODELS })[k])).toEqual(['chat', 'embedding']);
    const cloud = wantedServers({ result: result({ chat: 'cloud' }), modelsDir: MODELS });
    expect(cloud.chat).toBeNull();
    expect(cloud.embedding.expectFile).toBe('nomic-embed-text-v1.5.f16.gguf');
    const dev = wantedServers({ result: result(), modelsDir: MODELS, env: { LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:9999' } });
    expect(dev.chat).toBeNull();
    expect(dev.embedding).not.toBeNull();
    expect(wantedServers({ result: result({ chat: 'cloud', embedding: 'cloud' }), modelsDir: MODELS })).toEqual({ chat: null, embedding: null });
  });
});

describe('where Pip is', () => {
  const exists = (...present) => (file) => present.includes(file);
  test('a developer build from LANA_PIP_BINARY; the installed app from its resources; otherwise none', () => {
    expect(resolvePipBinary({ env: { LANA_PIP_BINARY: '/src/lqe' }, fileExists: exists('/src/lqe') })).toBe('/src/lqe');
    expect(resolvePipBinary({ env: { LANA_PIP_BINARY: '/src/missing' }, fileExists: exists() })).toBeNull();
    expect(resolvePipBinary({ isPackaged: true, resourcesPath: '/app/res', platform: 'darwin', fileExists: exists(path.join('/app/res', 'pip', 'lqe')) })).toBe(path.join('/app/res', 'pip', 'lqe'));
    expect(resolvePipBinary({ isPackaged: true, resourcesPath: 'C:\\app', platform: 'win32', fileExists: exists(path.join('C:\\app', 'pip', 'lqe.exe')) })).toBe(path.join('C:\\app', 'pip', 'lqe.exe'));
    expect(resolvePipBinary({ isPackaged: false, resourcesPath: '/app/res', fileExists: () => true })).toBeNull();
  });
});

describe('running the servers', () => {
  test('starts chat and embedding with their settings files; addresses go out once both answer', async () => {
    const h = harness();
    await h.pip.apply(result(), MODELS);
    expect(h.spawns.map((s) => s.args)).toEqual([
      ['serve', '--config', path.join('/user', 'pip', 'chat.json')],
      ['serve', '--config', path.join('/user', 'pip', 'embedding.json')]
    ]);
    expect(h.spawns[0].command).toBe(BINARY);
    expect(h.files[path.join('/user', 'pip', 'chat.json')]).toMatchObject({ model: path.join(MODELS, 'Qwen3.5-4B-Q4_K_M.gguf'), mmproj: path.join(MODELS, 'mmproj-Qwen3.5-4B-BF16.gguf'), port: 8081, ctx: 32768 });
    expect(h.files[path.join('/user', 'pip', 'embedding.json')]).toMatchObject({ port: 8082, role: 'embed' });

    // Only embedding answers: no addresses yet.
    h.serving[8082] = 'nomic-embed-text-v1.5.f16.gguf';
    await settle();
    expect(h.addresses).toEqual([]);
    h.serving[8081] = 'Qwen3.5-4B-Q4_K_M.gguf';
    await settle();
    expect(h.addresses).toEqual([{ chat: 'http://127.0.0.1:8081', embedding: 'http://127.0.0.1:8082', chatModelFile: path.join(MODELS, 'Qwen3.5-4B-Q4_K_M.gguf') }]);
    expect(h.pip.getState().servers.chat).toMatchObject({ process: 'running', healthy: true });
  });

  test('a taken port moves the server to a free one, and that address is the one handed on', async () => {
    const h = harness({ busyPorts: [8081] });
    await h.pip.apply(result(), MODELS);
    h.serveFromSettings();
    await settle();
    expect(h.addresses[0].chat).toBe('http://127.0.0.1:58081');
  });

  test('a server answering with a different model file is not taken as ready', async () => {
    const h = harness();
    await h.pip.apply(result({ embedding: 'cloud' }), MODELS);
    h.serving[8081] = 'Someone-Else.gguf';
    await settle(2000);
    expect(h.addresses).toEqual([]);
    expect(h.pip.getState().servers.chat).toMatchObject({ healthy: false, lastHealthError: 'serving Someone-Else.gguf, expected Qwen3.5-4B-Q4_K_M.gguf' });
  });

  test('chat in the cloud: only embedding runs and only its address goes out', async () => {
    const h = harness();
    await h.pip.apply(result({ chat: 'cloud' }), MODELS);
    expect(h.spawns).toHaveLength(1);
    h.serveFromSettings();
    await settle();
    expect(h.addresses).toEqual([{ chat: null, embedding: 'http://127.0.0.1:8082', chatModelFile: null }]);
  });

  test('no Pip installed: nothing starts', async () => {
    const h = harness({ binary: null });
    const state = await h.pip.apply(result(), MODELS);
    expect(h.spawns).toEqual([]);
    expect(state.installed).toBe(false);
  });

  test('a server that exits is restarted, waiting longer each time, up to 60 seconds', async () => {
    const h = harness();
    await h.pip.apply(result({ embedding: 'cloud' }), MODELS);
    const delays = [];
    for (let i = 0; i < 8; i += 1) {
      const child = h.children[h.children.length - 1];
      child.exitCode = 1;
      child.emit('exit', 1, null);
      const before = h.spawns.length;
      let waited = 0;
      while (h.spawns.length === before) { await jest.advanceTimersByTimeAsync(1000); waited += 1000; }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    // Each run's log is closed when its process ends, so restarts do not leave files open.
    expect(h.logs).toHaveLength(9);
    expect(h.logs.slice(0, 8).every((sink) => sink.end.mock.calls.length === 1)).toBe(true);
  });

  test('a running server that stops answering is stopped and started again', async () => {
    const h = harness();
    await h.pip.apply(result({ embedding: 'cloud' }), MODELS);
    h.serveFromSettings();
    await settle();
    h.down.add(8081);
    await settle(DEFAULTS.healthIntervalRunningMs * DEFAULTS.maxHealthFailures);
    expect(h.children[0].signals).toContain('SIGTERM');
    await settle(DEFAULTS.minBackoffMs);
    expect(h.spawns).toHaveLength(2);
  });

  test('a server that never answers is restarted after the start timeout', async () => {
    const h = harness();
    await h.pip.apply(result({ embedding: 'cloud' }), MODELS);
    await settle(DEFAULTS.startTimeoutMs);
    expect(h.children[0].signals).toContain('SIGTERM');
    await settle(DEFAULTS.minBackoffMs);
    expect(h.spawns).toHaveLength(2);
  });

  test('a new chat model restarts only the chat server; the same plan restarts nothing', async () => {
    const h = harness();
    await h.pip.apply(result(), MODELS);
    h.serveFromSettings();
    await settle();
    await h.pip.apply(result(), MODELS);
    expect(h.spawns).toHaveLength(2);

    const bigger = result();
    bigger.plan.chat.id = 'qwen9b';
    bigger.plan.vision.id = null;
    await h.pip.apply(bigger, MODELS);
    expect(h.children[0].signals).toEqual(['SIGTERM']);
    expect(h.children[1].signals).toEqual([]);
    expect(h.spawns).toHaveLength(3);
    expect(h.files[path.join('/user', 'pip', 'chat.json')].model).toBe(path.join(MODELS, 'Qwen3.5-9B-Q4_K_M.gguf'));
  });

  test('stop ends both servers (SIGKILL after the grace period) and says there are no addresses', async () => {
    const h = harness();
    await h.pip.apply(result(), MODELS);
    h.serveFromSettings();
    await settle();
    h.children[0].ignoreSigterm = true;
    const stopping = h.pip.stop();
    await settle(DEFAULTS.stopGraceMs);
    await stopping;
    expect(h.children[0].signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(h.children[1].signals).toEqual(['SIGTERM']);
    expect(h.addresses[h.addresses.length - 1]).toEqual({ chat: null, embedding: null, chatModelFile: null });
    // Nothing restarts after a stop.
    await settle(DEFAULTS.maxBackoffMs);
    expect(h.spawns).toHaveLength(2);
  });
});

test('what the engine is given: the addresses of the servers that answered, and the chat vocabulary', () => {
  expect(engineEndpoints({ chat: 'http://127.0.0.1:8081', embedding: 'http://127.0.0.1:8082', chatModelFile: '/m/chat.gguf' })).toEqual({ LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:8081', LANA_ENGINE_EMBEDDING_URL: 'http://127.0.0.1:8082', LANA_TOKENIZER_GGUF: '/m/chat.gguf' });
  expect(engineEndpoints({ chat: null, embedding: 'http://127.0.0.1:8082' })).toEqual({ LANA_ENGINE_EMBEDDING_URL: 'http://127.0.0.1:8082' });
  expect(engineEndpoints({ chat: null, embedding: null })).toEqual({});
});
