'use strict';

/**
 * Pip's speed settings for this computer, chosen from its hardware every time the app starts (so
 * again after every app update), with every option the platform is measured for turned on.
 * Main process. Plain CommonJS; reading the binary's usage text and the Metal memory limit is
 * injected, so every platform is tested on any computer.
 *
 * The same rules as the server deploy (LANA-AI infra/lib/config/lqe-args.js at 86d0bc18e), for
 * one person's computer instead of a firm's server:
 *
 *   Apple silicon (Metal), the only platform measured (an M3 Ultra, 35B-A3B, 2026-11-12):
 *     always      gpu_layers 99, gpu_output, 4 threads, f16 KV, ubatch 2048, adaptive prefill on
 *                 (a 1.8k prompt read at 1739 tok/s instead of 538; the engine's default on Metal
 *                 since D-41, 8f1970cdd11e, and still passed for an engine before it), and no
 *                 fair_chunk, so the engine's D-41 busy chunk of 512 rows applies (a 4k prompt
 *                 beside a streaming slot answered first in 10 s instead of 14.8 s); every other
 *                 platform keeps 64
 *     2+ slots    batch_decode N, prefix_share_mb (1024 from 64 GB up, else 512), gpu_inexact,
 *                 no flash attention: batching took 9 users from 47 to 103 tok/s in total and the
 *                 worst first token from 89 s to 1 s, and the batched graph refuses flash attention
 *     1 slot      --flash-attn, no batching
 *   NVIDIA (CUDA, DGX Spark GB10 included): gpu_layers 99, gpu_output, 4 threads, --flash-attn.
 *     No gpu_inexact batching (unmeasured on CUDA); the engine's own prefill choice (adaptive is
 *     already its default there).
 *   Vulkan (Windows without NVIDIA, Linux AMD): as NVIDIA, with one or two slots and never
 *     gpu_inexact.
 *   Processor only: gpu_layers 0, the engine's own thread count (its physical cores), --repack,
 *     prefix_share_mb 256, and batch_decode on dense models (exact on the processor; under repack
 *     the engine keeps 3 lanes at most, so it is asked for no more). A mixture-of-experts model
 *     would need gpu_inexact to batch, so it does not batch here.
 *
 * Slots (how many conversations Pip keeps ready) come from memory in local-ai-fit.model.js
 * (chooseSlots); context is per conversation and every slot shares one pool (D-38) sized so one
 * conversation reaches the full context: pool = context + (slots - 1) x chunk.
 *
 * Safety: a flag newer than the oldest engine an install may hold is passed only when the
 * binary's --help names it. Pip refuses a settings file with a key it does not know and exits, so
 * an old binary handed one would restart forever. A binary without the context pool gets the
 * settings it was priced for before: two slots at most, q8_0 KV, nothing new.
 */

const fit = require('./src/js/local-ai-fit.model');

/** The newer flags, and how --help spells them. */
const NEW_FLAGS = Object.freeze({
  gpuInexact: '--gpu-inexact',
  adaptivePrefill: '--adaptive-prefill',
  gpuOutput: '--gpu-output',
  batchDecode: '--batch-decode',
  prefixShare: '--prefix-share-mb',
  ctxPool: '--ctx-pool'
});

const GPU_THREADS = 4;
const METAL_UBATCH = 2048;
const DEFAULT_UBATCH = 512;
/** Prefill rows per compute-lock hold while another slot decodes, off Apple silicon. */
const FAIR_CHUNK = 64;
/** Under --repack a step of 4 rows would not match solo decode, so the engine caps lanes at 3. */
const REPACK_MAX_LANES = 3;
const VULKAN_MAX_SLOTS = 2;

/** Which flags this binary's usage text names. Nothing is assumed: unknown means off. */
function parseAccepts(helpText) {
  const text = String(helpText || '');
  const out = {};
  for (const [name, flag] of Object.entries(NEW_FLAGS)) {out[name] = text.includes(flag);}
  return out;
}

/**
 * Ask the binary once (lqe --help). A binary that cannot be asked gets none of the newer flags:
 * the old settings start it, and the warning says why it is slower.
 */
function readAccepts(binary, spawnSync, log = { warn() {} }) {
  if (!binary) {return parseAccepts('');}
  try {
    const result = spawnSync(binary, ['--help'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (result.error) {throw result.error;}
    return parseAccepts(`${result.stdout || ''}\n${result.stderr || ''}`);
  } catch (error) {
    log.warn(`[pip] could not read ${binary} --help (${error.message}); starting it without its newer speed settings`);
    return parseAccepts('');
  }
}

/** How Pip computes here: metal, cuda, vulkan or cpu (electron-hardware.js accelerator). */
function engineBackend(hardware) {
  const backend = hardware && hardware.accelerator && hardware.accelerator.backend;
  return ['metal', 'cuda', 'vulkan'].includes(backend) ? backend : 'cpu';
}

/** A mixture-of-experts file (35B-A3B, 122B-A10B): batched decode on it needs gpu_inexact. */
function isMoe(modelFile) {
  return /-A\d+B[-.]/i.test(String(modelFile || ''));
}

/**
 * The chat server's speed settings.
 *
 * @param {Object} input
 * @param {Object} input.hardware - electron-hardware.js readHardware()
 * @param {number} input.contextTokens - per conversation, from the plan
 * @param {number} input.slots - from the plan (chooseSlots)
 * @param {string} input.modelFile
 * @param {Object} input.accepts - parseAccepts() of the binary that will run
 * @returns {{ config: Object, args: string[], slots: number, expectedContext: number,
 *   requested: string[], backend: string, stale: boolean }}
 *   config: settings-file keys; args: flags that have no settings-file key (--flash-attn,
 *   --repack); requested: the levers whose "is off:" line means LANA did not get what it asked.
 */
function chatLevers({ hardware = {}, contextTokens, slots, modelFile, accepts = {} }) {
  const backend = engineBackend(hardware);
  const gpu = backend !== 'cpu';
  const config = {};
  const args = [];
  const requested = [];

  // An engine without the shared pool: the settings it was priced for before this module.
  if (!accepts.ctxPool) {
    const n = Math.max(1, Math.min(slots || 2, 2));
    Object.assign(config, { ctx: contextTokens, parallel: n, kv_type: 'q8_0', gpu_layers: gpu ? 99 : 0, ubatch: DEFAULT_UBATCH, fair_chunk: FAIR_CHUNK });
    if (gpu && accepts.gpuOutput) {config.gpu_output = true;}
    return { config, args, slots: n, expectedContext: contextTokens, requested, backend, stale: true };
  }

  let n = Math.max(1, Math.floor(slots) || 1);
  if (backend === 'vulkan') {n = Math.min(n, VULKAN_MAX_SLOTS);}
  Object.assign(config, { ctx: contextTokens, parallel: n, kv_type: 'f16', gpu_layers: gpu ? 99 : 0 });
  if (n > 1) {Object.assign(config, { ctx_pool: fit.poolTokens(contextTokens, n), ctx_chunk: Math.min(fit.CTX_CHUNK, contextTokens) });}
  config.ubatch = backend === 'metal' ? METAL_UBATCH : DEFAULT_UBATCH;
  // A set fair_chunk always wins over the engine's backend default, so Metal leaves it unset.
  if (backend !== 'metal') {config.fair_chunk = FAIR_CHUNK;}
  if (gpu) {
    config.threads = GPU_THREADS;
    if (accepts.gpuOutput) {config.gpu_output = true;}
  }

  if (backend === 'metal') {
    if (accepts.adaptivePrefill) {config.adaptive_prefill = true;}
    const batching = n > 1 && accepts.gpuInexact && accepts.batchDecode && accepts.prefixShare;
    if (batching) {
      Object.assign(config, { gpu_inexact: true, batch_decode: n, prefix_share_mb: fit.prefixShareMb('metal', n, hardware.totalMemoryBytes || 0) });
      requested.push('--batch-decode', '--prefix-share-mb');
    } else {
      args.push('--flash-attn');
    }
  } else if (gpu) {
    args.push('--flash-attn');
  } else {
    args.push('--repack');
    if (accepts.prefixShare) {
      config.prefix_share_mb = fit.prefixShareMb('cpu', n, hardware.totalMemoryBytes || 0);
      requested.push('--prefix-share-mb');
    }
    if (n > 1 && !isMoe(modelFile) && accepts.batchDecode) {
      config.batch_decode = Math.min(n, REPACK_MAX_LANES);
      requested.push('--batch-decode');
    }
  }
  return { config, args, slots: n, expectedContext: contextTokens, requested, backend, stale: false };
}

/**
 * A startup line that turns off a lever LANA asked for ("serve: --batch-decode 2 is off: ..."),
 * as the warning to log; null for every other line.
 */
function offWarning(line, requested) {
  const match = /serve: (--[a-z-]+)(?: \d+)? is off: (.*)$/.exec(String(line || '').trim());
  if (!match || !requested.includes(match[1])) {return null;}
  return `[pip] chat: Pip turned off ${match[1]}, which LANA asked for: ${match[2]}`;
}

/** Splits a process's output into lines for offWarning; returns { write(chunk), end() }. */
function lineScanner(onLine) {
  let rest = '';
  return {
    write(chunk) {
      rest += String(chunk);
      const lines = rest.split('\n');
      rest = lines.pop();
      for (const line of lines) {onLine(line);}
    },
    end() {
      if (rest) {onLine(rest);}
      rest = '';
    }
  };
}

/** What the running engine says against what it was asked for (GET /props). */
function verifyProps(props, levers) {
  if (!props) {return ['/props answered nothing, so the slot count could not be checked'];}
  const problems = [];
  if (Number(props.total_slots) !== levers.slots) {
    problems.push(`Pip reports ${props.total_slots} slots, LANA asked for ${levers.slots}`);
  }
  const nCtx = props.default_generation_settings && props.default_generation_settings.n_ctx;
  if (nCtx && Number(nCtx) !== levers.expectedContext) {
    problems.push(`Pip holds ${nCtx} tokens per conversation, LANA asked for ${levers.expectedContext}`);
  }
  return problems;
}

/**
 * macOS lets the graphics chip keep this share of memory unless iogpu.wired_limit_mb says
 * otherwise (0 means the default): about two thirds up to 36 GB, three quarters above.
 */
function defaultWiredLimitBytes(totalMemoryBytes) {
  const gib = 1024 ** 3;
  return Math.floor(totalMemoryBytes * (totalMemoryBytes > 36 * gib ? 0.75 : 2 / 3));
}

/** A warning when the Metal memory limit leaves no room for the models plus the pool; else null. */
function wiredLimitProblem({ wiredLimitMb, totalMemoryBytes, needBytes }) {
  const mib = 1024 * 1024;
  const limit = Number(wiredLimitMb) > 0 ? Number(wiredLimitMb) * mib : defaultWiredLimitBytes(totalMemoryBytes);
  if (!(needBytes > limit)) {return null;}
  const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1);
  return `[pip] the graphics chip may keep ${gb(limit)} GB (iogpu.wired_limit_mb ${Number(wiredLimitMb) || 0}), `
    + `and Pip's models and conversation pool need about ${gb(needBytes)} GB, so macOS may page them out`;
}

module.exports = {
  NEW_FLAGS,
  parseAccepts,
  readAccepts,
  engineBackend,
  isMoe,
  chatLevers,
  offWarning,
  lineScanner,
  verifyProps,
  defaultWiredLimitBytes,
  wiredLimitProblem
};
