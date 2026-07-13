/**
 * hardware-accel.js
 *
 * "What acceleration backend can THIS machine run local GGUF inference on?" —
 * the cross-platform successor to the Apple-Silicon-only gate model-selector used
 * to carry. Detection only: it reports the backend + (for discrete GPUs) the VRAM
 * budget; the FIT MATH (which tier that budget can host, reserving redaction
 * headroom first) stays in model-selector.js, and the LAUNCH knobs (--n-gpu-layers)
 * stay in service-topology.js. This module is the single seam that knows about the
 * hardware itself.
 *
 * Backends:
 *   - 'metal': Apple-Silicon macs (darwin + arm64). Unified memory, Metal llama.cpp
 *     backend; VRAM is not a separate budget (system RAM governs), so vramGB is null.
 *   - 'cuda':  linux/win32 with an NVIDIA GPU (probed via nvidia-smi). vramGB is the
 *     TOTAL VRAM across visible GPUs (llama.cpp can split a model across them).
 *   - 'cpu':   everything else (Intel macs, GPU-less linux/win, unknown platforms).
 *
 * All external inputs (platform, arch, env, the nvidia-smi probe) are injectable so
 * selection is unit-testable on any host without real hardware or a subprocess.
 * LANA_FORCE_ACCEL_BACKEND=metal|cuda|cpu is an ops/testing override.
 */
'use strict';

const MIB_PER_GIB = 1024;

// Ops/testing override: force the detected backend regardless of the real machine.
const FORCE_ENV = 'LANA_FORCE_ACCEL_BACKEND';

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Parse `nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits`.
 * memory.total is reported in MiB. Returns TOTAL VRAM across all listed GPUs (the
 * budget a split model sees) plus a per-GPU breakdown.
 *
 * @returns {{ present: boolean, vramGB: number, gpus: Array<{name:string, vramGB:number}> }}
 */
function parseNvidiaSmi(out) {
  const gpus = [];
  let totalMiB = 0;
  for (const line of String(out || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(',');
    const miB = parseFloat(String(parts[0]).trim());
    if (!Number.isFinite(miB) || miB <= 0) continue;
    totalMiB += miB;
    gpus.push({ name: (parts.slice(1).join(',') || '').trim(), vramGB: round1(miB / MIB_PER_GIB) });
  }
  return { present: gpus.length > 0 && totalMiB > 0, vramGB: round1(totalMiB / MIB_PER_GIB), gpus };
}

/**
 * Default nvidia-smi probe. Returns a zero-arg fn (so it matches the injectable
 * `probeNvidiaSmi` shape). execFileSync is injectable for tests; a missing binary
 * / non-NVIDIA host throws, which we swallow into "no GPU" rather than surface.
 */
function defaultNvidiaProbe(io = {}) {
  return () => {
    const execFileSync = io.execFileSync || require('child_process').execFileSync;
    try {
      const out = execFileSync(
        'nvidia-smi',
        ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits'],
        { timeout: io.timeoutMs || 4000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
      );
      return parseNvidiaSmi(out);
    } catch (_e) {
      return { present: false, vramGB: 0, gpus: [] };
    }
  };
}

/**
 * Detect the acceleration backend available on this machine.
 *
 * @param {object} [io]
 * @param {string} [io.platform]  - defaults to process.platform
 * @param {string} [io.arch]      - defaults to process.arch
 * @param {object} [io.env]       - defaults to process.env (read for LANA_FORCE_ACCEL_BACKEND)
 * @param {Function} [io.probeNvidiaSmi] - injectable () => { present, vramGB, gpus }
 * @param {Function} [io.execFileSync]   - injectable, used only by the default probe
 * @returns {{ backend:'metal'|'cuda'|'cpu', vramGB:number|null,
 *             gpus:Array<{name:string,vramGB:number}>, source:string }}
 */
function detectAccelBackend(io = {}) {
  const platform = io.platform || process.platform;
  const arch = io.arch || process.arch;
  const env = io.env || process.env;

  // Explicit override wins (ops escape hatch + deterministic test harness).
  const forced = String((env && env[FORCE_ENV]) || '').trim().toLowerCase();
  if (forced === 'metal' || forced === 'cpu') {
    return { backend: forced, vramGB: forced === 'metal' ? null : 0, gpus: [], source: 'forced_env' };
  }
  if (forced === 'cuda') {
    // Still learn VRAM so the fit check has a budget to work with.
    const info = (io.probeNvidiaSmi || defaultNvidiaProbe(io))() || {};
    return { backend: 'cuda', vramGB: info.vramGB || 0, gpus: info.gpus || [], source: 'forced_env' };
  }

  if (platform === 'darwin') {
    // Apple Silicon -> Metal (unified memory; RAM governs, no separate VRAM budget).
    if (arch === 'arm64') return { backend: 'metal', vramGB: null, gpus: [], source: 'darwin_arm64' };
    // Intel mac: our GGUF build targets Metal (arm64) or CUDA, neither applies -> CPU.
    return { backend: 'cpu', vramGB: 0, gpus: [], source: 'darwin_x64' };
  }

  if (platform === 'linux' || platform === 'win32') {
    const info = (io.probeNvidiaSmi || defaultNvidiaProbe(io))() || {};
    if (info.present && (info.vramGB || 0) > 0) {
      return { backend: 'cuda', vramGB: info.vramGB, gpus: info.gpus || [], source: 'nvidia_smi' };
    }
    return { backend: 'cpu', vramGB: 0, gpus: [], source: 'no_nvidia_gpu' };
  }

  return { backend: 'cpu', vramGB: 0, gpus: [], source: 'unknown_platform' };
}

module.exports = {
  detectAccelBackend,
  parseNvidiaSmi,
  defaultNvidiaProbe,
  FORCE_ACCEL_BACKEND_ENV: FORCE_ENV,
};
