/**
 * Pip's speed settings per computer (electron-pip-levers.js): one table per platform with the
 * settings measured on LANA.cpp b7debcdd3410, the old binary that must never get a flag it cannot
 * parse, and the checks after start (the "is off:" warning, startup lines, /health, /props,
 * /metrics, the Metal memory limit).
 */

const levers = require('../../electron-pip-levers');

const GB = 1024 ** 3;
const HELP_D41 = `${Object.values(levers.NEW_FLAGS).join('\n')}`;
const NEW = levers.parseAccepts(HELP_D41);
const PRE_D41 = levers.parseAccepts(Object.entries(levers.NEW_FLAGS).filter(([name]) => name !== 'adaptiveAutoMetal').map(([, flag]) => flag).join('\n'));
const STALE = levers.parseAccepts('usage: lqe serve [-np SLOTS] [-ngl N] [--repack]');

function hw(backend, memoryGb = 36) {
  return { platform: backend === 'metal' ? 'darwin' : 'linux', cores: 12, totalMemoryBytes: memoryGb * GB, accelerator: { backend } };
}

function pick({ backend, slots, memoryGb, modelFile = '/m/Qwen3.5-9B-Q4_K_M.gguf', accepts = NEW, contextTokens = 32768 }) {
  return levers.chatLevers({ hardware: hw(backend, memoryGb), contextTokens, slots, modelFile, accepts });
}

const GPU_ALWAYS = { gpu_layers: 99, gpu_output: true, threads: 4, ubatch: 2048, kv_type: 'f16' };

describe('per platform (measured on b7debcdd3410)', () => {
  test.each([
    ['Metal, 2 slots (chat plus a background lane): batching under gpu_inexact, pool 65536, no flash attention',
      { backend: 'metal', slots: 2, memoryGb: 36 },
      { ...GPU_ALWAYS, ctx: 32768, parallel: 2, batch_decode: 2, gpu_inexact: true, prefix_share_mb: 512, ctx_pool: 65536, ctx_chunk: 4096 },
      [], ['--batch-decode', '--prefix-share-mb']],
    ['Metal from 64 GB: 1024 MiB of shared prompts',
      { backend: 'metal', slots: 2, memoryGb: 64 },
      { ...GPU_ALWAYS, parallel: 2, batch_decode: 2, gpu_inexact: true, prefix_share_mb: 1024, ctx_pool: 65536 },
      [], ['--batch-decode', '--prefix-share-mb']],
    ['Metal at 16 GB: a pool of 32768',
      { backend: 'metal', slots: 2, memoryGb: 16 },
      { ...GPU_ALWAYS, parallel: 2, batch_decode: 2, gpu_inexact: true, prefix_share_mb: 512, ctx_pool: 32768, ctx_chunk: 4096 },
      [], ['--batch-decode', '--prefix-share-mb']],
    ['Metal, a true single slot: no batching settings, no flash attention',
      { backend: 'metal', slots: 1, memoryGb: 8 },
      { ...GPU_ALWAYS, ctx: 32768, parallel: 1 },
      [], []],
    ['CUDA: the graphics chip, flash attention, no batching',
      { backend: 'cuda', slots: 2 },
      { ...GPU_ALWAYS, parallel: 2, ctx_pool: 65536, fair_chunk: 64 },
      ['--flash-attn'], []],
    ['Vulkan (AMD or Intel, unmeasured): one slot, no pool, never gpu_inexact, flash attention as the server deploy',
      { backend: 'vulkan', slots: 4 },
      { ...GPU_ALWAYS, parallel: 1 },
      ['--flash-attn'], []],
    ['processor only: engine threads, repack, shared prompts, exact batching',
      { backend: 'cpu', slots: 2 },
      { gpu_layers: 0, kv_type: 'f16', ubatch: 512, parallel: 2, prefix_share_mb: 256, batch_decode: 2, fair_chunk: 64 },
      ['--repack'], ['--prefix-share-mb', '--batch-decode']],
    ['processor only, mixture of experts: no batching (it would need gpu_inexact)',
      { backend: 'cpu', slots: 2, modelFile: '/m/Qwen3.5-35B-A3B-Q4_K_M.gguf' },
      { gpu_layers: 0, parallel: 2, prefix_share_mb: 256 },
      ['--repack'], ['--prefix-share-mb']]
  ])('%s', (_label, input, config, args, requested) => {
    const chosen = pick(input);
    expect(chosen.config).toMatchObject(config);
    expect(chosen.args).toEqual(args);
    expect(chosen.requested).toEqual(requested);
    expect(chosen.stale).toBe(false);
  });

  test('never more than two slots (one on Vulkan), and q8_0 never on a new engine', () => {
    for (const backend of ['metal', 'cuda', 'vulkan', 'cpu']) {
      const chosen = pick({ backend, slots: 4 });
      const most = backend === 'vulkan' ? 1 : 2;
      expect(chosen.slots).toBe(most);
      expect(chosen.config.parallel).toBe(most);
      expect(chosen.config.kv_type).toBe('f16');
      expect(chosen.config).not.toHaveProperty(backend === 'vulkan' ? 'ctx_pool' : 'nothing');
      expect(chosen.expect.gpuPlacement).toBe(backend === 'vulkan');
    }
  });

  test('Apple silicon never gets --flash-attn; gpu_inexact only with 2 slots on Metal; nothing batches on CUDA or Vulkan', () => {
    for (const slots of [1, 2]) {expect(pick({ backend: 'metal', slots }).args).not.toContain('--flash-attn');}
    for (const backend of ['metal', 'cuda', 'vulkan', 'cpu']) {
      for (const slots of [1, 2]) {
        const chosen = pick({ backend, slots });
        expect(Boolean(chosen.config.gpu_inexact)).toBe(backend === 'metal' && slots > 1);
        if (backend === 'cuda' || backend === 'vulkan') {
          expect(chosen.config).not.toHaveProperty('batch_decode');
          expect(chosen.config).not.toHaveProperty('prefix_share_mb');
        }
      }
    }
  });

  test('adaptive prefill: not passed on Metal (auto-on since D-41), passed to a pre-D-41 engine that knows it, never elsewhere', () => {
    expect(pick({ backend: 'metal', slots: 2 }).config).not.toHaveProperty('adaptive_prefill');
    expect(pick({ backend: 'metal', slots: 2, accepts: PRE_D41 }).config.adaptive_prefill).toBe(true);
    for (const backend of ['cuda', 'vulkan', 'cpu']) {expect(pick({ backend, slots: 2, accepts: PRE_D41 }).config).not.toHaveProperty('adaptive_prefill');}
    // Either way the running Metal engine must report it on.
    expect(pick({ backend: 'metal', slots: 1 }).expect.adaptivePrefill).toBe(true);
  });

  test('Apple silicon leaves fair_chunk to the engine (D-41: 512); everywhere else, and an older engine, keeps 64', () => {
    for (const slots of [1, 2]) {expect(pick({ backend: 'metal', slots }).config).not.toHaveProperty('fair_chunk');}
    for (const backend of ['cuda', 'vulkan', 'cpu']) {expect(pick({ backend, slots: 2 }).config.fair_chunk).toBe(64);}
    expect(pick({ backend: 'metal', slots: 2, accepts: STALE }).config.fair_chunk).toBe(64);
  });

  test('per-conversation context /props must report: 32768, or 28672 where a 16 GB Mac pool also holds the other slot\'s chunk', () => {
    expect(pick({ backend: 'metal', slots: 2, memoryGb: 36 }).expectedContext).toBe(32768);
    expect(pick({ backend: 'metal', slots: 2, memoryGb: 16 }).expectedContext).toBe(32768 - 4096);
    expect(pick({ backend: 'metal', slots: 1, memoryGb: 16 }).expectedContext).toBe(32768);
    expect(pick({ backend: 'metal', slots: 1 }).config).not.toHaveProperty('ctx_pool');
    expect(pick({ backend: 'cpu', slots: 2 }).config).not.toHaveProperty('threads');
  });
});

describe('an older binary never gets a flag it cannot parse', () => {
  const NEWER_KEYS = ['gpu_inexact', 'adaptive_prefill', 'gpu_output', 'batch_decode', 'prefix_share_mb', 'ctx_pool', 'ctx_chunk'];

  test.each(['metal', 'cuda', 'vulkan', 'cpu'])('%s: the old settings, two slots at most, q8_0, nothing newer', (backend) => {
    const stale = pick({ backend, slots: 4, accepts: STALE });
    for (const key of NEWER_KEYS) {expect(stale.config).not.toHaveProperty(key);}
    expect(stale.config).toMatchObject({ parallel: 2, kv_type: 'q8_0', ubatch: 512 });
    expect(stale.args).toEqual([]);
    expect(stale.stale).toBe(true);
    expect(stale.slots).toBe(2);
  });

  test('control: the new binary on the same computer gets them', () => {
    expect(pick({ backend: 'metal', slots: 2, accepts: NEW }).config).toMatchObject({ gpu_inexact: true, gpu_output: true, batch_decode: 2, prefix_share_mb: 512, ctx_pool: 65536 });
  });

  test('each newer flag is gated on its own --help entry', () => {
    const without = (flag) => levers.parseAccepts(Object.values(levers.NEW_FLAGS).filter((f) => f !== flag).join('\n'));
    const noInexact = pick({ backend: 'metal', slots: 2, accepts: without('--gpu-inexact') });
    expect(noInexact.config).not.toHaveProperty('gpu_inexact');
    expect(noInexact.config).not.toHaveProperty('batch_decode');
    expect(noInexact.args).toEqual([]);
    expect(pick({ backend: 'metal', slots: 2, accepts: without('--batch-decode') }).config).not.toHaveProperty('batch_decode');
    expect(pick({ backend: 'cpu', slots: 2, accepts: without('--prefix-share-mb') }).config).not.toHaveProperty('prefix_share_mb');
    expect(pick({ backend: 'cuda', slots: 2, accepts: without('--gpu-output') }).config).not.toHaveProperty('gpu_output');
    const noAdaptive = levers.parseAccepts(Object.entries(levers.NEW_FLAGS).filter(([name]) => !['adaptivePrefill', 'adaptiveAutoMetal'].includes(name)).map(([, f]) => f).join('\n'));
    expect(pick({ backend: 'metal', slots: 2, accepts: noAdaptive }).config).not.toHaveProperty('adaptive_prefill');
  });

  test('readAccepts reads --help, and a binary that cannot be asked gets nothing newer', () => {
    const help = { stdout: 'usage\n  [--gpu-inexact] [--adaptive-prefill auto|on|off] auto = on for CUDA and Metal\n', stderr: '[--ctx-pool N]' };
    expect(levers.readAccepts('/x/lqe', () => help)).toMatchObject({ gpuInexact: true, adaptivePrefill: true, adaptiveAutoMetal: true, ctxPool: true, gpuOutput: false });
    const warn = jest.fn();
    expect(levers.readAccepts('/x/lqe', () => ({ error: new Error('ENOENT') }), { warn })).toEqual(STALE);
    expect(warn).toHaveBeenCalled();
    expect(levers.readAccepts(null, () => help)).toEqual(STALE);
  });
});

describe('after start', () => {
  const metal2 = () => pick({ backend: 'metal', slots: 2 });
  const BATCH = "[lqe INF] serve: batched decode on - up to 2 slots' tokens per forward (D-39) on the GPU (--gpu-inexact: value-equivalent, not bit-identical)";
  const SHARE = '[lqe INF] serve: shared prefixes on - system prompts of 512+ tokens kept in up to 512 MiB (D-40)';
  const IDENTITY = '[lqe INF] serve: computation identity 422dee4d4c530750 (model=/m/x.gguf;fa=0;kv=f16;exec=gpu-inexact:bdec=2:pshare=1)';

  test('an "is off:" line for a lever LANA asked for becomes a warning; others do not', () => {
    const requested = ['--batch-decode', '--prefix-share-mb'];
    expect(levers.offWarning('W serve: --batch-decode 3 is off: on a mixture-of-experts model batched lanes are not bit-identical to solo', requested))
      .toMatch(/turned off --batch-decode, which LANA asked for: on a mixture-of-experts model/);
    expect(levers.offWarning('W serve: --prefix-share-mb is off: on a GPU, reading a prompt in two pieces changes', requested)).toMatch(/--prefix-share-mb/);
    expect(levers.offWarning('W serve: --batch-decode 3 is off: there is only one slot', [])).toBeNull();
    expect(levers.offWarning('I serve: listening on 127.0.0.1:8081', requested)).toBeNull();
  });

  test('lines are found across chunk boundaries', () => {
    const lines = [];
    const scan = levers.lineScanner((line) => lines.push(line));
    scan.write('first li');
    scan.write('ne\nsecond\nthi');
    scan.end();
    expect(lines).toEqual(['first line', 'second', 'thi']);
  });

  test('startup lines: "batched decode on ... on the GPU" and "shared prefixes on" must appear when batching is asked for', () => {
    expect(levers.verifyStartup([BATCH, SHARE], metal2())).toEqual([]);
    expect(levers.verifyStartup([SHARE], metal2()).join(' ')).toMatch(/batched decode on/);
    expect(levers.verifyStartup([BATCH.replace(' on the GPU', ''), SHARE], metal2()).join(' ')).toMatch(/batched decode on/);
    expect(levers.verifyStartup([BATCH], metal2()).join(' ')).toMatch(/shared prefixes on/);
    expect(levers.verifyStartup([], pick({ backend: 'metal', slots: 1 }))).toEqual([]);
  });

  test('/health: the served computation carries ;exec=gpu-inexact:bdec=N:pshare=1 while batching, and adaptive prefill is on on Metal', () => {
    expect(levers.verifyHealth({ computation: '422dee4d4c530750', adaptive_prefill: true }, metal2(), [IDENTITY])).toEqual([]);
    expect(levers.verifyHealth({ computation: '422dee4d4c530750', adaptive_prefill: true }, metal2(), [IDENTITY.replace(';exec=gpu-inexact:bdec=2:pshare=1', '')]).join(' ')).toMatch(/does not include ;exec=gpu-inexact:bdec=2:pshare=1/);
    expect(levers.verifyHealth({ computation: '0000000000000000', adaptive_prefill: true }, metal2(), [IDENTITY]).join(' ')).toMatch(/serves computation 0000000000000000/);
    expect(levers.verifyHealth({ computation: '422dee4d4c530750', adaptive_prefill: false }, metal2(), [IDENTITY]).join(' ')).toMatch(/adaptive prefill off/);
    expect(levers.verifyHealth({ computation: 'x', adaptive_prefill: false }, pick({ backend: 'cuda', slots: 2 }), [])).toEqual([]);
  });

  test('/props must report the slots and context asked for', () => {
    const chosen = metal2();
    expect(levers.verifyProps({ total_slots: 2, default_generation_settings: { n_ctx: 32768 } }, chosen)).toEqual([]);
    expect(levers.verifyProps({ total_slots: 1, default_generation_settings: { n_ctx: 32768 } }, chosen).join(' ')).toMatch(/reports 1 slots, LANA asked for 2/);
    expect(levers.verifyProps({ total_slots: 2, default_generation_settings: { n_ctx: 24576 } }, chosen).join(' ')).toMatch(/24576 tokens/);
    expect(levers.verifyProps(null, chosen)).toHaveLength(1);
  });

  test('/metrics: judged only after real traffic, then batched decode must have taken a step', () => {
    const chosen = metal2();
    const text = (requests, steps) => `lqe_requests_total ${requests}\n${steps === null ? '' : `lqe_batch_decode_steps_total ${steps}\n`}`;
    expect(levers.batchMetricsProblem(text(3, 0), chosen)).toEqual({ ready: false, problem: null });
    expect(levers.batchMetricsProblem(text(levers.BATCH_CHECK_MIN_REQUESTS, 5), chosen)).toEqual({ ready: true, problem: null });
    expect(levers.batchMetricsProblem(text(40, 0), chosen).problem).toMatch(/no step in 40 requests/);
    expect(levers.batchMetricsProblem(text(40, null), chosen).problem).toMatch(/missing/);
    expect(levers.batchMetricsProblem(text(40, 0), pick({ backend: 'metal', slots: 1 }))).toEqual({ ready: true, problem: null });
  });

  test('the Metal memory limit must hold the models plus the pool', () => {
    // 36 GB: the default limit is three quarters above 36 GB, two thirds up to it.
    expect(levers.defaultWiredLimitBytes(36 * GB)).toBe(24 * GB);
    expect(levers.defaultWiredLimitBytes(64 * GB)).toBe(48 * GB);
    expect(levers.wiredLimitProblem({ wiredLimitMb: 0, totalMemoryBytes: 36 * GB, needBytes: 20 * GB })).toBeNull();
    expect(levers.wiredLimitProblem({ wiredLimitMb: 0, totalMemoryBytes: 36 * GB, needBytes: 30 * GB })).toMatch(/may keep 24.0 GB/);
    expect(levers.wiredLimitProblem({ wiredLimitMb: 32768, totalMemoryBytes: 36 * GB, needBytes: 30 * GB })).toBeNull();
  });
});
