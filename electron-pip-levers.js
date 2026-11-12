'use strict';

/**
 * Pip's speed settings for this computer, chosen from its hardware every time the app starts (so
 * again after every app update), with every option the platform is measured for turned on.
 * Main process. Plain CommonJS; reading the binary's usage text and the Metal memory limit is
 * injected, so every platform is tested on any computer.
 *
 * The settings measured on LANA.cpp b7debcdd3410 (Norton's M3 Ultra session, 2026-11-12), for
 * one person's computer; the server deploy's rules are LANA-AI infra/lib/config/lqe-args.js.
 *
 *   Every graphics chip: gpu_layers 99, gpu_output, 4 threads, ubatch 2048, f16 KV (q8_0 decoded
 *     slower; it is kept only for an engine without the context pool, below).
 *   Apple silicon (Metal), the measured platform:
 *     2 slots     chat plus one background lane: batch_decode 2, gpu_inexact, prefix_share_mb
 *                 (1024 from 64 GB up, else 512), ctx_pool 65536 (32768 on a Mac with 16 GB or
 *                 less), ctx_chunk 4096, no flash attention. Two streams decode 95 tok/s together
 *                 against 76 for one.
 *     1 slot      only when two do not fit: no batching settings and no flash attention.
 *     adaptive prefill is not passed: it is the engine's Metal default since D-41 (8f1970cdd11e),
 *     and passed only to an engine that knows the flag but predates that default. No fair_chunk,
 *     so the engine's D-41 busy chunk of 512 rows applies.
 *   NVIDIA (CUDA, DGX Spark GB10 included): --flash-attn as the server deploy runs it; batching
 *     stays off (unmeasured on CUDA), and prefill is the engine's own choice.
 *   Vulkan (AMD and Intel graphics on Windows and Linux, electron-gpu.js): as NVIDIA but one
 *     slot, never gpu_inexact or batching, no adaptive prefill (unmeasured). Only when the plan
 *     fits the model and its pool on the chip (local-ai-fit.model.js); otherwise processor only.
 *     After start the model must be placed on the GPU (gpuUnused), or the supervisor restarts
 *     chat once with the processor-only settings.
 *   Processor only: gpu_layers 0, the engine's own thread count (its physical cores), ubatch 512,
 *     --repack, prefix_share_mb 256, and batch_decode on dense models (exact on the processor). A
 *     mixture-of-experts model would need gpu_inexact to batch, so it does not batch here.
 *
 * Slots come from memory in local-ai-fit.model.js (chooseSlots): two, or one when two do not fit.
 * After start the supervisor checks the startup lines, /health, /props and, once real traffic has
 * run, /metrics against what was asked (verifyStartup, verifyHealth, verifyProps,
 * batchMetricsProblem); each mismatch is a warning, never a restart.
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
  ctxPool: '--ctx-pool',
  // Not a flag: the D-41 usage text, which says adaptive prefill is already on for Metal.
  adaptiveAutoMetal: 'on for CUDA and Metal'
});

const GPU_THREADS = 4;
const GPU_UBATCH = 2048;
const DEFAULT_UBATCH = 512;
/** Prefill rows per compute-lock hold while another slot decodes, off Apple silicon. */
const FAIR_CHUNK = 64;
/** Under --repack a step of 4 rows would not match solo decode, so the engine caps lanes at 3. */
const REPACK_MAX_LANES = 3;
const VULKAN_MAX_SLOTS = 1;

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
 * @param {number} [input.poolTokens] - the plan's shared pool for 2+ slots (chooseSlots)
 * @param {string} input.modelFile
 * @param {Object} input.accepts - parseAccepts() of the binary that will run
 * @returns {{ config: Object, args: string[], slots: number, expectedContext: number,
 *   requested: string[], backend: string, stale: boolean, expect: Object }}
 *   expect: what the running engine must show (startup lines, /health, /metrics).
 *   config: settings-file keys; args: flags that have no settings-file key (--flash-attn,
 *   --repack); requested: the levers whose "is off:" line means LANA did not get what it asked.
 */
function chatLevers({ hardware = {}, contextTokens, slots, poolTokens = null, modelFile, accepts = {} }) {
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
    return { config, args, slots: n, expectedContext: contextTokens, requested, backend, stale: true, expect: { startupLines: [], execTag: null, adaptivePrefill: false, batching: false, gpuPlacement: false } };
  }

  const memory = hardware.totalMemoryBytes || 0;
  let n = Math.max(1, Math.min(Math.floor(slots) || 1, fit.MAX_SLOTS));
  if (backend === 'vulkan') {n = Math.min(n, VULKAN_MAX_SLOTS);}
  Object.assign(config, { ctx: contextTokens, parallel: n, kv_type: 'f16', gpu_layers: gpu ? 99 : 0 });
  const pool = n > 1 ? (poolTokens || fit.poolTokens(contextTokens, n, backend, memory)) : null;
  if (pool) {Object.assign(config, { ctx_pool: pool, ctx_chunk: Math.min(fit.CTX_CHUNK, contextTokens) });}
  config.ubatch = gpu ? GPU_UBATCH : DEFAULT_UBATCH;
  // A set fair_chunk always wins over the engine's backend default, so Metal leaves it unset.
  if (backend !== 'metal') {config.fair_chunk = FAIR_CHUNK;}
  if (gpu) {
    config.threads = GPU_THREADS;
    if (accepts.gpuOutput) {config.gpu_output = true;}
  }

  const expect = { startupLines: [], execTag: null, adaptivePrefill: false, batching: false, gpuPlacement: backend === 'vulkan' };
  if (backend === 'metal') {
    if (accepts.adaptivePrefill && !accepts.adaptiveAutoMetal) {config.adaptive_prefill = true;}
    expect.adaptivePrefill = Boolean(accepts.adaptivePrefill);
    if (n > 1 && accepts.gpuInexact && accepts.batchDecode && accepts.prefixShare) {
      Object.assign(config, { gpu_inexact: true, batch_decode: n, prefix_share_mb: fit.prefixShareMb('metal', n, memory) });
      requested.push('--batch-decode', '--prefix-share-mb');
      expect.startupLines.push('batched decode on - up to [0-9]+ slots.* on the GPU', 'shared prefixes on');
      expect.execTag = `;exec=gpu-inexact:bdec=${n}:pshare=1`;
      expect.batching = true;
    }
  } else if (gpu) {
    args.push('--flash-attn');
  } else {
    args.push('--repack');
    if (accepts.prefixShare) {
      config.prefix_share_mb = fit.prefixShareMb('cpu', n, memory);
      requested.push('--prefix-share-mb');
      expect.startupLines.push('shared prefixes on');
    }
    if (n > 1 && !isMoe(modelFile) && accepts.batchDecode) {
      config.batch_decode = Math.min(n, REPACK_MAX_LANES);
      requested.push('--batch-decode');
      expect.startupLines.push('batched decode on');
      expect.batching = true;
    }
  }
  const expectedContext = fit.perConversationTokens(contextTokens, n, backend, memory, pool);
  return { config, args, slots: n, expectedContext, requested, backend, stale: false, expect };
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

/** Startup lines LANA expects to see (batched decode and shared prefixes) that did not appear. */
function verifyStartup(lines, levers) {
  const text = (lines || []).join('\n');
  const problems = levers.expect.startupLines
    .filter((pattern) => !new RegExp(`serve: ${pattern}`).test(text))
    .map((pattern) => `Pip did not log "${pattern.replace(/ - up to \[0-9\]\+ slots\.\*/, ' ...')}", which LANA asked for`);
  if (levers.expect.gpuPlacement && !/model: placement /.test(text)) {problems.push('Pip did not log where it placed the model, so the graphics chip could not be confirmed');}
  return problems;
}

/**
 * Whether Pip on Vulkan left the model off the graphics chip, from its startup lines: lqe logs
 * "no GPU backend available; running on CPU" when Vulkan finds no device, and "model: placement
 * X MiB GPU + ..." when the model is on the chip ("model: placement X MiB CPU-mapped" when not).
 * Returns the reason, or null when the chip is used, nothing was asked of it, or no placement line
 * was seen (verifyStartup warns about that; it is not proof the chip went unused).
 */
function gpuUnused(lines, levers) {
  if (!levers.expect.gpuPlacement) {return null;}
  const text = (lines || []).join('\n');
  if (/no GPU backend available/.test(text)) {return 'Pip found no Vulkan device ("no GPU backend available")';}
  if (/model: placement [0-9.]+ MiB GPU/.test(text)) {return null;}
  if (/model: placement /.test(text)) {return 'Pip placed the model on the processor, not the graphics chip';}
  return null;
}

/**
 * /health against what was asked: adaptive prefill on Metal, and, while GPU batching is asked for,
 * the computation it serves must be the one whose startup identity line carries
 * ";exec=gpu-inexact:bdec=N:pshare=1". /health gives only the identity's hash; the description
 * with the exec tail is in the "serve: computation identity <hash> (...)" line.
 */
function verifyHealth(health, levers, lines = []) {
  if (!health) {return ['/health answered nothing'];}
  const problems = [];
  if (levers.expect.execTag) {
    const identity = (lines || []).map((line) => /serve: computation identity ([0-9a-f]+) \((.*)\)\s*$/.exec(line)).find(Boolean);
    if (!identity || !identity[2].includes(levers.expect.execTag)) {
      problems.push(`Pip's computation does not include ${levers.expect.execTag}, so GPU batching is not running`);
    } else if (String(health.computation) !== identity[1]) {
      problems.push(`/health serves computation ${health.computation}, not the ${identity[1]} that carries ${levers.expect.execTag}`);
    }
  }
  if (levers.expect.adaptivePrefill && health.adaptive_prefill !== true) {
    problems.push('Pip reports adaptive prefill off on Apple silicon');
  }
  return problems;
}

/** Traffic that should have overlapped at least once on two slots before batching is judged. */
const BATCH_CHECK_MIN_REQUESTS = 20;

function metric(text, name) {
  const match = new RegExp(`^${name} ([0-9.]+)$`, 'm').exec(String(text || ''));
  return match ? Number(match[1]) : null;
}

/**
 * Once real traffic has run, batched decode should have taken at least one step.
 * Returns { ready: false } while there is too little traffic to judge, else { ready: true,
 * problem } with problem null when batching ran.
 */
function batchMetricsProblem(text, levers) {
  if (!levers.expect.batching) {return { ready: true, problem: null };}
  const requests = metric(text, 'lqe_requests_total');
  if (requests === null || requests < BATCH_CHECK_MIN_REQUESTS) {return { ready: false, problem: null };}
  const steps = metric(text, 'lqe_batch_decode_steps_total');
  if (steps === null) {return { ready: true, problem: 'Pip reports no batched decode at all (lqe_batch_decode_steps_total is missing)' };}
  if (steps > 0) {return { ready: true, problem: null };}
  return { ready: true, problem: `batched decode took no step in ${requests} requests (lqe_batch_decode_steps_total 0); two calls may never have overlapped` };
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
  verifyStartup,
  gpuUnused,
  verifyHealth,
  batchMetricsProblem,
  BATCH_CHECK_MIN_REQUESTS,
  verifyProps,
  defaultWiredLimitBytes,
  wiredLimitProblem
};
