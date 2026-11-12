/**
 * Pip on this computer (electron-pip-supervisor.js): the settings written from the plan, which
 * servers run, the health check against the planned model file, restarts with backoff, the
 * addresses handed to the engine, and stopping. Processes, fetch, ports and files are test
 * doubles; timers are Jest's fake timers.
 */

const path = require('path');
const { EventEmitter } = require('events');
const {
  createPip, chatConfig, embeddingConfig, wantedServers, resolvePipBinary, threadsFor, engineEndpoints, DEFAULTS,
  versionProblem, MISSING_FILE_MESSAGE
} = require('../../electron-pip-supervisor');

const levers = require('../../electron-pip-levers');

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

function harness({ env = {}, binary = BINARY, busyPorts = [], accepts = {}, props = {}, health = {}, metrics = {}, wiredLimitMb = null, options = {}, platform = 'darwin', runVersion = () => ({ status: 0 }) } = {}) {
  const children = [];
  const spawns = [];
  const files = {};
  const addresses = [];
  const serving = {}; // port -> model file name /health reports
  const down = new Set(); // ports that refuse connections
  const logs = [];
  const warnings = [];
  const problems = [];
  const versionRuns = [];
  const pip = createPip({
    binary,
    platform,
    runVersion: (file) => { versionRuns.push(file); return runVersion(file); },
    onProblem: (message) => problems.push(message),
    accepts,
    readWiredLimitMb: () => wiredLimitMb,
    log: { info() {}, warn: (message) => warnings.push(message), error() {} },
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
      const where = new URL(url).pathname;
      if (where === '/props') {return { ok: true, status: 200, json: async () => props[port] || null };}
      if (where === '/metrics') {return { ok: true, status: 200, text: async () => (typeof metrics[port] === 'function' ? metrics[port]() : metrics[port] || '') };}
      return { ok: true, status: 200, json: async () => ({ status: 'ok', model_file: { name: serving[port] }, ...(health[port] || {}) }) };
    }),
    pickPort: jest.fn(async (preferred) => (busyPorts.includes(preferred) ? 50000 + preferred : preferred)),
    fsImpl: {
      mkdirSync: jest.fn(),
      writeFileSync: (file, text) => { files[file] = JSON.parse(text); },
      createWriteStream: jest.fn(() => { const sink = { write: jest.fn(), end: jest.fn() }; logs.push(sink); return sink; })
    },
    onAddresses: (value) => addresses.push(value),
    options
  });
  /** Pretend each started server loaded its settings file's model. */
  const serveFromSettings = () => {
    for (const settings of Object.values(files)) {serving[settings.port] = path.basename(settings.model);}
  };
  return { pip, children, spawns, files, addresses, serving, down, logs, warnings, problems, versionRuns, serveFromSettings };
}

const settle = async (ms = DEFAULTS.healthIntervalStartingMs) => {
  await jest.advanceTimersByTimeAsync(ms);
};

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('settings from the plan', () => {
  test('chat on an older Pip (no context pool): the planned model, image file, size per slot and slots, on loopback, graphics on Apple', () => {
    const config = chatConfig({ modelPath: '/m/chat.gguf', mmprojPath: '/m/mm.gguf', port: 8081, contextTokens: 16384, parallel: 2, hardware: { platform: 'darwin', cores: 12, accelerator: { backend: 'metal' } }, accepts: { gpuOutput: true } });
    expect(config).toMatchObject({ model: '/m/chat.gguf', mmproj: '/m/mm.gguf', host: '127.0.0.1', port: 8081, ctx: 16384, parallel: 2, kv_type: 'q8_0', gpu_layers: 99, gpu_output: true, threads: 10, metal_residency_keep_alive_s: 86400 });
    // Conversations are never written to disk.
    expect(config).not.toHaveProperty('session_dir');
  });

  test('chat on a computer with no graphics chip runs on the processor; no Apple-only setting elsewhere', () => {
    const config = chatConfig({ modelPath: '/m/c.gguf', port: 8081, contextTokens: 8192, parallel: 2, hardware: { platform: 'linux', cores: 8, accelerator: { backend: 'cpu' } } });
    expect(config).toMatchObject({ gpu_layers: 0, threads: 6 });
    expect(config).not.toHaveProperty('gpu_output');
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

describe('this computer\'s speed settings (electron-pip-levers.js)', () => {
  const NEW = levers.parseAccepts(Object.values(levers.NEW_FLAGS).join(' '));
  const CHAT = path.join('/user', 'pip', 'chat.json');
  const metal = (parallel) => {
    const r = result({ embedding: 'cloud' });
    r.plan.chat.parallel = parallel;
    r.plan.chat.poolTokens = parallel > 1 ? 65536 : null;
    r.hardware.totalMemoryBytes = 36 * 1024 ** 3;
    return r;
  };
  const STARTUP = [
    '[lqe INF] serve: computation identity 422dee4d4c530750 (model=/m/x.gguf;kv=f16;exec=gpu-inexact:bdec=2:pshare=1)',
    '[lqe INF] serve: shared prefixes on - system prompts of 512+ tokens kept in up to 512 MiB (D-40)',
    "[lqe INF] serve: batched decode on - up to 2 slots' tokens per forward (D-39) on the GPU (--gpu-inexact: value-equivalent, not bit-identical)"
  ];
  const GOOD = {
    health: { 8081: { computation: '422dee4d4c530750', adaptive_prefill: true } },
    props: { 8081: { total_slots: 2, default_generation_settings: { n_ctx: 32768 } } }
  };
  /** Start chat on Apple silicon, print `lines`, and let it answer once. */
  async function started(lines, more = {}, parallel = 2) {
    const h = harness({ accepts: NEW, ...GOOD, ...more });
    await h.pip.apply(metal(parallel), MODELS);
    h.children[0].stdout.pipe.mock.calls[0][0].write(`${lines.join('\n')}\n`);
    h.serveFromSettings();
    await settle();
    return h;
  }

  test('a new Pip on Apple silicon with 2 slots: the measured settings in the file, no extra flags', async () => {
    const h = harness({ accepts: NEW });
    await h.pip.apply(metal(2), MODELS);
    expect(h.spawns[0].args).toEqual(['serve', '--config', CHAT]);
    expect(h.files[CHAT]).toMatchObject({ parallel: 2, kv_type: 'f16', gpu_inexact: true, batch_decode: 2, prefix_share_mb: 512, ctx_pool: 65536, ctx_chunk: 4096, ubatch: 2048, threads: 4, gpu_output: true });
    expect(h.files[CHAT]).not.toHaveProperty('adaptive_prefill');
  });

  test('a true single slot: no batching settings and no --flash-attn', async () => {
    const h = harness({ accepts: NEW });
    await h.pip.apply(metal(1), MODELS);
    expect(h.spawns[0].args).toEqual(['serve', '--config', CHAT]);
    for (const key of ['gpu_inexact', 'batch_decode', 'prefix_share_mb', 'ctx_pool']) {expect(h.files[CHAT]).not.toHaveProperty(key);}
  });

  test('control: everything as asked gives no warning', async () => {
    const h = await started(STARTUP);
    expect(h.warnings).toEqual([]);
    expect(h.addresses).toHaveLength(1);
  });

  test('an "is off:" line for a lever LANA asked for is logged as a warning', async () => {
    const h = await started([...STARTUP, '[lqe WRN] serve: --batch-decode 2 is off: there is only one slot']);
    expect(h.warnings.join('\n')).toMatch(/turned off --batch-decode, which LANA asked for: there is only one slot/);
    expect(h.logs[0].write).toHaveBeenCalled();
  });

  test('a missing "batched decode on ... on the GPU" or "shared prefixes on" line is a warning', async () => {
    const h = await started([STARTUP[0], STARTUP[1]]);
    expect(h.warnings.join('\n')).toMatch(/did not log "batched decode on/);
    const share = await started([STARTUP[0], STARTUP[2]]);
    expect(share.warnings.join('\n')).toMatch(/did not log "shared prefixes on"/);
  });

  test('/health: no ;exec=gpu-inexact:bdec=2:pshare=1 in the served computation, or adaptive prefill off, is a warning', async () => {
    const h = await started([STARTUP[0].replace(';exec=gpu-inexact:bdec=2:pshare=1', ''), STARTUP[1], STARTUP[2]]);
    expect(h.warnings.join('\n')).toMatch(/does not include ;exec=gpu-inexact:bdec=2:pshare=1/);
    const off = await started(STARTUP, { health: { 8081: { computation: '422dee4d4c530750', adaptive_prefill: false } } });
    expect(off.warnings.join('\n')).toMatch(/adaptive prefill off/);
  });

  test('/props must report the slots asked for; a mismatch is a warning, the server still serves', async () => {
    const h = await started(STARTUP, { props: { 8081: { total_slots: 1, default_generation_settings: { n_ctx: 32768 } } } });
    expect(h.warnings.join('\n')).toMatch(/reports 1 slots, LANA asked for 2/);
    expect(h.addresses).toHaveLength(1);
  });

  test('/metrics is read lazily after start, and judged once real traffic has run', async () => {
    let text = 'lqe_requests_total 2\nlqe_batch_decode_steps_total 0\n';
    const h = await started(STARTUP, { metrics: { 8081: () => text }, options: { batchMetricsEveryMs: 1000 } });
    expect(h.warnings).toEqual([]);
    await settle(1000);
    expect(h.warnings).toEqual([]); // too little traffic to judge
    text = 'lqe_requests_total 25\nlqe_batch_decode_steps_total 0\n';
    await settle(1000);
    expect(h.warnings.join('\n')).toMatch(/batched decode took no step in 25 requests/);
    const count = h.warnings.length;
    await settle(5000);
    expect(h.warnings).toHaveLength(count); // checked once
  });

  test('control: batching that took steps gives no /metrics warning', async () => {
    const h = await started(STARTUP, { metrics: { 8081: 'lqe_requests_total 25\nlqe_batch_decode_steps_total 9\n' }, options: { batchMetricsEveryMs: 1000 } });
    await settle(3000);
    expect(h.warnings).toEqual([]);
  });

  test('the Metal memory limit is checked against the models plus the pool', async () => {
    const r = metal(2);
    r.entries.set('qwen4b', { id: 'qwen4b', family: 'qwen3.5', sizeBytes: 20 * 1024 ** 3, filename: 'Qwen3.5-4B-Q4_K_M.gguf' });
    const h = harness({ accepts: NEW, wiredLimitMb: 16384 });
    await h.pip.apply(r, MODELS);
    expect(h.warnings.join('\n')).toMatch(/iogpu.wired_limit_mb 16384/);
    const roomy = harness({ accepts: NEW, wiredLimitMb: 32768 });
    await roomy.pip.apply(r, MODELS);
    expect(roomy.warnings).toEqual([]);
  });
});

describe('Windows: lqe.exe is asked for its version before any server starts', () => {
  const DLL = { status: 0xC0000135, stderr: '' };

  test('a missing DLL (0xC0000135): no server starts, the warning names vulkan-1.dll, the status says it plainly', async () => {
    const h = harness({ platform: 'win32', binary: 'C:\\LANA\\resources\\pip\\lqe.exe', runVersion: () => DLL });
    const state = await h.pip.apply(result(), MODELS);
    expect(h.spawns).toEqual([]);
    expect(h.warnings.join('\n')).toMatch(/--version failed.*0xC0000135.*vulkan-1\.dll/);
    expect(h.problems).toEqual([MISSING_FILE_MESSAGE]);
    expect(MISSING_FILE_MESSAGE).toBe('LANA\'s local engine could not start: a required system file is missing.');
    expect(state.problem).toBe(MISSING_FILE_MESSAGE);
    // Never a restart loop: nothing runs, so nothing restarts.
    await settle(60000);
    expect(h.spawns).toEqual([]);
  });

  test('any other failing exit is refused the same way, and names the DLL to look for', () => {
    const found = versionProblem('C:\\app\\pip\\lqe.exe', { status: 1, stderr: 'boom' });
    expect(found.message).toBe(MISSING_FILE_MESSAGE);
    expect(found.warning).toMatch(/exited with code 1: boom.*vulkan-1\.dll/);
    expect(versionProblem('C:\\app\\pip\\lqe.exe', { status: null, error: new Error('spawn UNKNOWN') }).warning).toMatch(/spawn UNKNOWN/);
    expect(versionProblem('C:\\app\\pip\\lqe.exe', { status: -1073741515 }).warning).toMatch(/0xC0000135/);
  });

  test('control: a version that answers starts the servers and clears the status', async () => {
    const h = harness({ platform: 'win32', runVersion: () => ({ status: 0, stdout: 'lqe 3.0.0' }) });
    await h.pip.apply(result(), MODELS);
    expect(h.spawns).toHaveLength(2);
    expect(h.warnings.join('\n')).not.toMatch(/--version failed/);
    expect(h.problems).toEqual([]);
    expect(versionProblem('/x/lqe', { status: 0 })).toBeNull();
  });

  test('control: macOS and Linux do not ask', async () => {
    for (const platform of ['darwin', 'linux']) {
      const h = harness({ platform, runVersion: () => DLL });
      await h.pip.apply(result(), MODELS);
      expect(h.versionRuns).toEqual([]);
      expect(h.spawns).toHaveLength(2);
    }
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
    expect(h.addresses).toEqual([{ chat: 'http://127.0.0.1:8081', embedding: 'http://127.0.0.1:8082', chatModelFile: path.join(MODELS, 'Qwen3.5-4B-Q4_K_M.gguf'), chatSlots: 2 }]);
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
    expect(h.addresses).toEqual([{ chat: null, embedding: 'http://127.0.0.1:8082', chatModelFile: null, chatSlots: null }]);
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
    expect(h.addresses[h.addresses.length - 1]).toEqual({ chat: null, embedding: null, chatModelFile: null, chatSlots: null });
    // Nothing restarts after a stop.
    await settle(DEFAULTS.maxBackoffMs);
    expect(h.spawns).toHaveLength(2);
  });
});

test('what the engine is given: the addresses of the servers that answered, and the chat vocabulary', () => {
  expect(engineEndpoints({ chat: 'http://127.0.0.1:8081', embedding: 'http://127.0.0.1:8082', chatModelFile: '/m/chat.gguf' })).toEqual({ LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:8081', LANA_ENGINE_EMBEDDING_URL: 'http://127.0.0.1:8082', LANA_TOKENIZER_GGUF: '/m/chat.gguf' });
  // The engine's queue runs as many calls as Pip has chat slots, background work at most one.
  expect(engineEndpoints({ chat: 'http://127.0.0.1:8081', embedding: null, chatModelFile: '/m/chat.gguf', chatSlots: 2 })).toMatchObject({ LLM_QUEUE_CONCURRENCY: '2', LLM_QUEUE_MAX_BACKGROUND_CONCURRENCY: '1' });
  expect(engineEndpoints({ chat: null, embedding: 'http://127.0.0.1:8082', chatSlots: 2 })).not.toHaveProperty('LLM_QUEUE_MAX_BACKGROUND_CONCURRENCY');
  expect(engineEndpoints({ chat: null, embedding: 'http://127.0.0.1:8082' })).toEqual({ LANA_ENGINE_EMBEDDING_URL: 'http://127.0.0.1:8082' });
  expect(engineEndpoints({ chat: null, embedding: null })).toEqual({});
});
