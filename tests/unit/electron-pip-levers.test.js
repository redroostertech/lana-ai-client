/**
 * Pip's speed settings per computer (electron-pip-levers.js): one table per platform, the old
 * binary that must never get a flag it cannot parse, the "is off:" warning, the /props check and
 * the Metal memory limit.
 */

const levers = require('../../electron-pip-levers');

const GB = 1024 ** 3;
const NEW = levers.parseAccepts(Object.values(levers.NEW_FLAGS).join('\n'));
const STALE = levers.parseAccepts('usage: lqe serve [-np SLOTS] [-ngl N] [--repack]');

function hw(backend, memoryGb = 36) {
  return { platform: backend === 'metal' ? 'darwin' : 'linux', cores: 12, totalMemoryBytes: memoryGb * GB, accelerator: { backend } };
}

function pick({ backend, slots, memoryGb, modelFile = '/m/Qwen3.5-9B-Q4_K_M.gguf', accepts = NEW, contextTokens = 32768 }) {
  return levers.chatLevers({ hardware: hw(backend, memoryGb), contextTokens, slots, modelFile, accepts });
}

describe('per platform', () => {
  test.each([
    ['Metal, several slots: batching under gpu_inexact, shared prompts, no flash attention',
      { backend: 'metal', slots: 3, memoryGb: 36 },
      { gpu_layers: 99, gpu_output: true, threads: 4, kv_type: 'f16', ubatch: 2048, adaptive_prefill: true, parallel: 3, batch_decode: 3, gpu_inexact: true, prefix_share_mb: 512, ctx_pool: 32768 + 2 * 4096, ctx_chunk: 4096 },
      [], ['--batch-decode', '--prefix-share-mb']],
    ['Metal from 64 GB: 1024 MiB of shared prompts',
      { backend: 'metal', slots: 4, memoryGb: 64 },
      { gpu_inexact: true, batch_decode: 4, prefix_share_mb: 1024 },
      [], ['--batch-decode', '--prefix-share-mb']],
    ['Metal, one slot: flash attention, no batching',
      { backend: 'metal', slots: 1, memoryGb: 8 },
      { gpu_layers: 99, gpu_output: true, threads: 4, kv_type: 'f16', ubatch: 2048, adaptive_prefill: true, parallel: 1 },
      ['--flash-attn'], []],
    ['CUDA: graphics chip, flash attention, no inexact batching',
      { backend: 'cuda', slots: 2 },
      { gpu_layers: 99, gpu_output: true, threads: 4, kv_type: 'f16', ubatch: 512, parallel: 2 },
      ['--flash-attn'], []],
    ['Vulkan: at most two slots, never gpu_inexact',
      { backend: 'vulkan', slots: 4 },
      { gpu_layers: 99, gpu_output: true, threads: 4, kv_type: 'f16', parallel: 2 },
      ['--flash-attn'], []],
    ['processor only: no graphics, engine threads, repack, shared prompts, exact batching (3 lanes under repack)',
      { backend: 'cpu', slots: 4 },
      { gpu_layers: 0, kv_type: 'f16', ubatch: 512, parallel: 4, prefix_share_mb: 256, batch_decode: 3 },
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

  test('flash attention and batching never go together, and gpu_inexact appears only on Metal with 2+ slots', () => {
    for (const backend of ['metal', 'cuda', 'vulkan', 'cpu']) {
      for (const slots of [1, 2, 4]) {
        const chosen = pick({ backend, slots });
        if (chosen.args.includes('--flash-attn')) {expect(chosen.config).not.toHaveProperty('batch_decode');}
        expect(Boolean(chosen.config.gpu_inexact)).toBe(backend === 'metal' && slots > 1);
      }
    }
  });

  test('Apple silicon leaves fair_chunk to the engine (D-41: 512); everywhere else, and an older engine, keeps 64', () => {
    for (const slots of [1, 3]) {expect(pick({ backend: 'metal', slots }).config).not.toHaveProperty('fair_chunk');}
    for (const backend of ['cuda', 'vulkan', 'cpu']) {expect(pick({ backend, slots: 2 }).config.fair_chunk).toBe(64);}
    expect(pick({ backend: 'metal', slots: 3, accepts: STALE }).config.fair_chunk).toBe(64);
  });

  test('NVIDIA, Vulkan and the processor keep the engine\'s own prefill choice; one slot has no pool', () => {
    for (const backend of ['cuda', 'vulkan', 'cpu']) {expect(pick({ backend, slots: 2 }).config).not.toHaveProperty('adaptive_prefill');}
    expect(pick({ backend: 'cpu', slots: 2 }).config).not.toHaveProperty('threads');
    expect(pick({ backend: 'metal', slots: 1 }).config).not.toHaveProperty('ctx_pool');
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
    expect(pick({ backend: 'metal', slots: 4, accepts: NEW }).config).toMatchObject({ gpu_inexact: true, adaptive_prefill: true, gpu_output: true, batch_decode: 4, ctx_pool: 32768 + 3 * 4096 });
  });

  test('each newer flag is gated on its own --help entry', () => {
    const without = (flag) => levers.parseAccepts(Object.values(levers.NEW_FLAGS).filter((f) => f !== flag).join('\n'));
    expect(pick({ backend: 'metal', slots: 3, accepts: without('--gpu-inexact') })).toMatchObject({ args: ['--flash-attn'] });
    expect(pick({ backend: 'metal', slots: 3, accepts: without('--gpu-inexact') }).config).not.toHaveProperty('gpu_inexact');
    expect(pick({ backend: 'metal', slots: 3, accepts: without('--adaptive-prefill') }).config).not.toHaveProperty('adaptive_prefill');
    expect(pick({ backend: 'cuda', slots: 2, accepts: without('--gpu-output') }).config).not.toHaveProperty('gpu_output');
  });

  test('readAccepts reads --help, and a binary that cannot be asked gets nothing newer', () => {
    const help = { stdout: 'usage\n  [--gpu-inexact] [--adaptive-prefill auto|on|off]\n', stderr: '[--ctx-pool N]' };
    expect(levers.readAccepts('/x/lqe', () => help)).toMatchObject({ gpuInexact: true, adaptivePrefill: true, ctxPool: true, gpuOutput: false });
    const warn = jest.fn();
    expect(levers.readAccepts('/x/lqe', () => ({ error: new Error('ENOENT') }), { warn })).toEqual(STALE);
    expect(warn).toHaveBeenCalled();
    expect(levers.readAccepts(null, () => help)).toEqual(STALE);
  });
});

describe('after start', () => {
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

  test('/props must report the slots and context asked for', () => {
    const chosen = pick({ backend: 'metal', slots: 3 });
    expect(levers.verifyProps({ total_slots: 3, default_generation_settings: { n_ctx: 32768 } }, chosen)).toEqual([]);
    expect(levers.verifyProps({ total_slots: 1, default_generation_settings: { n_ctx: 32768 } }, chosen).join(' ')).toMatch(/reports 1 slots, LANA asked for 3/);
    expect(levers.verifyProps({ total_slots: 3, default_generation_settings: { n_ctx: 24576 } }, chosen).join(' ')).toMatch(/24576 tokens/);
    expect(levers.verifyProps(null, chosen)).toHaveLength(1);
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
