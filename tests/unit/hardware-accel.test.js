'use strict';

const {
  detectAccelBackend,
  parseNvidiaSmi,
  FORCE_ACCEL_BACKEND_ENV,
} = require('../../supervisor/hardware-accel');

// A fake nvidia-smi probe (the injectable seam) so no subprocess ever runs.
const gpuProbe = (...gpus) => () => ({
  present: gpus.length > 0,
  vramGB: gpus.reduce((a, g) => a + g, 0),
  gpus: gpus.map((v, i) => ({ name: `GPU${i}`, vramGB: v })),
});
const noGpu = () => ({ present: false, vramGB: 0, gpus: [] });

// FORCE env must not leak between tests.
const savedForce = process.env[FORCE_ACCEL_BACKEND_ENV];
beforeEach(() => { delete process.env[FORCE_ACCEL_BACKEND_ENV]; });
afterAll(() => {
  if (savedForce === undefined) delete process.env[FORCE_ACCEL_BACKEND_ENV];
  else process.env[FORCE_ACCEL_BACKEND_ENV] = savedForce;
});

describe('detectAccelBackend', () => {
  it('reports Metal on Apple Silicon (darwin + arm64), VRAM null', () => {
    const a = detectAccelBackend({ platform: 'darwin', arch: 'arm64' });
    expect(a.backend).toBe('metal');
    expect(a.vramGB).toBeNull();
    expect(a.source).toBe('darwin_arm64');
  });

  it('reports CPU on Intel macs (no CUDA on darwin)', () => {
    const a = detectAccelBackend({ platform: 'darwin', arch: 'x64' });
    expect(a.backend).toBe('cpu');
    expect(a.source).toBe('darwin_x64');
  });

  it('never probes nvidia-smi on darwin (Metal/CPU only)', () => {
    const probe = jest.fn(noGpu);
    detectAccelBackend({ platform: 'darwin', arch: 'arm64', probeNvidiaSmi: probe });
    detectAccelBackend({ platform: 'darwin', arch: 'x64', probeNvidiaSmi: probe });
    expect(probe).not.toHaveBeenCalled();
  });

  it('reports CUDA on linux with an NVIDIA GPU + VRAM', () => {
    const a = detectAccelBackend({ platform: 'linux', arch: 'x64', probeNvidiaSmi: gpuProbe(24) });
    expect(a.backend).toBe('cuda');
    expect(a.vramGB).toBe(24);
    expect(a.source).toBe('nvidia_smi');
  });

  it('reports CUDA on win32 with an NVIDIA GPU', () => {
    const a = detectAccelBackend({ platform: 'win32', arch: 'x64', probeNvidiaSmi: gpuProbe(16) });
    expect(a.backend).toBe('cuda');
    expect(a.vramGB).toBe(16);
  });

  it('sums VRAM across multiple GPUs (llama.cpp can split a model)', () => {
    const a = detectAccelBackend({ platform: 'linux', arch: 'x64', probeNvidiaSmi: gpuProbe(24, 24) });
    expect(a.backend).toBe('cuda');
    expect(a.vramGB).toBe(48);
    expect(a.gpus).toHaveLength(2);
  });

  it('falls back to CPU on linux/win with no NVIDIA GPU', () => {
    expect(detectAccelBackend({ platform: 'linux', arch: 'x64', probeNvidiaSmi: noGpu }).backend).toBe('cpu');
    expect(detectAccelBackend({ platform: 'win32', arch: 'x64', probeNvidiaSmi: noGpu }).backend).toBe('cpu');
  });

  it('falls back to CPU on unknown platforms', () => {
    expect(detectAccelBackend({ platform: 'freebsd', arch: 'x64', probeNvidiaSmi: noGpu }).backend).toBe('cpu');
  });

  it('honors the LANA_FORCE_ACCEL_BACKEND override', () => {
    const env = { [FORCE_ACCEL_BACKEND_ENV]: 'cpu' };
    // Even a real Apple-Silicon-looking host is forced to CPU.
    expect(detectAccelBackend({ platform: 'darwin', arch: 'arm64', env }).backend).toBe('cpu');
    const env2 = { [FORCE_ACCEL_BACKEND_ENV]: 'metal' };
    expect(detectAccelBackend({ platform: 'linux', arch: 'x64', env: env2 }).backend).toBe('metal');
  });

  it('forced cuda still learns VRAM from the probe', () => {
    const env = { [FORCE_ACCEL_BACKEND_ENV]: 'cuda' };
    const a = detectAccelBackend({ platform: 'linux', arch: 'x64', env, probeNvidiaSmi: gpuProbe(12) });
    expect(a.backend).toBe('cuda');
    expect(a.vramGB).toBe(12);
    expect(a.source).toBe('forced_env');
  });

  it('uses the injected execFileSync default probe (no real subprocess) and yields CPU when it throws', () => {
    const execFileSync = () => { throw new Error('nvidia-smi: not found'); };
    const a = detectAccelBackend({ platform: 'linux', arch: 'x64', execFileSync });
    expect(a.backend).toBe('cpu');
  });
});

describe('parseNvidiaSmi', () => {
  it('parses MiB into GB per GPU and totals them', () => {
    const out = '24576, NVIDIA GeForce RTX 4090\n24576, NVIDIA GeForce RTX 4090\n';
    const r = parseNvidiaSmi(out);
    expect(r.present).toBe(true);
    expect(r.vramGB).toBe(48);
    expect(r.gpus).toHaveLength(2);
    expect(r.gpus[0].vramGB).toBe(24);
    expect(r.gpus[0].name).toBe('NVIDIA GeForce RTX 4090');
  });

  it('ignores blank/garbage lines and reports absent when empty', () => {
    expect(parseNvidiaSmi('').present).toBe(false);
    expect(parseNvidiaSmi('\n  \nnot-a-number, foo\n').present).toBe(false);
  });
});
