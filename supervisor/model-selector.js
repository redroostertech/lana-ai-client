/**
 * model-selector.js
 *
 * The runtime "what can this machine run" decision the packaging plan calls out as
 * the missing piece: probe hardware -> pick the LARGEST local chat model this Mac
 * can host (reserving headroom for the on-device redactor) -> else fall back to the
 * Forge relay for chat. The embedding model (nomic, 274MB) always runs locally.
 *
 * The routing/relay/redaction machinery already exists in the backend
 * (hybrid-router, local-availability, relay-settings); this only chooses whether a
 * local chat llama-server should be started and which GGUF it needs. The tier ladder
 * mirrors LANA-AI infra/lib/config/tier.config.js (the file lana-one imports).
 *
 * REDACTION-FIRST invariant: full on-device redaction is reserved FIRST (it is the
 * product) and is never shrunk to fit a larger model. A machine that cannot hold a
 * viable model in the RAM that REMAINS after full redaction gets relay chat + full
 * on-device redaction (redaction is never sacrificed for a model).
 *
 * FIT MATH (ported from lana-gpt-desktop apps/desktop/src/capability/hardware.ts:
 * estimateContextWindow / selectRunnableModel / recommendLocalModel / canRunLlamaCpp
 * and the REDACTOR_RESERVE_GB constant): a tier "fits" only when, after reserving
 * OS + full redactor + the rest of the sovereign stack, the RAM that remains can
 * hold the model weights PLUS the KV cache for that tier's context window. This
 * replaces the old naive "totalRamGB >= minMemoryGB" gate, which ignored both the
 * KV-cache cost of the context window and the explicit redactor reserve. The
 * per-tier minMemoryGB is kept as a comfort floor gated ALONGSIDE the fit test.
 *
 * os/arch are injected so selection is unit-testable on any host.
 */
'use strict';

const BYTES_PER_GB = 2 ** 30;

/**
 * Non-model RAM overhead, reserved BEFORE any local-model budget (ported from
 * hardware.ts). The local model gets only what is left, so full redaction is
 * guaranteed on every machine that runs a model at all.
 *   OS_RESERVE_GB (3) + REDACTOR_RESERVE_GB (4) + APP_RESERVE_GB (2) = 9.
 * REDACTOR_RESERVE_GB covers the FULL de-id redactor (Presidio + spaCy + the de-id
 * transformer) and is reserved first; APP_RESERVE_GB covers the other resident
 * sidecars (postgres, redis, api, gateway) + Electron.
 */
const OS_RESERVE_GB = 3;
const REDACTOR_RESERVE_GB = 4;
const APP_RESERVE_GB = 2;
const RESERVED_OVERHEAD_GB = OS_RESERVE_GB + REDACTOR_RESERVE_GB + APP_RESERVE_GB;

/**
 * Minimum LOCAL context window (tokens) worth running locally (hardware.ts
 * MIN_LOCAL_CONTEXT_TOKENS). Below this we route to the hosted Forge API instead.
 */
const MIN_LOCAL_CONTEXT_TOKENS = 8192;

/**
 * Extra RAM headroom required before allowing CPU-only (non-Metal) local inference.
 * CPU inference is slower and less memory-efficient than Metal, so the non-Apple-
 * Silicon path (opt-in via LANA_ALLOW_NON_METAL_LOCAL) uses a strictly higher bar:
 * RESERVED_OVERHEAD_GB + this. This constant is new to lana-one (the reference is
 * Metal-only, canRunLlamaCpp === appleSilicon); tune it as CPU support matures.
 */
const CPU_LOCAL_EXTRA_RESERVE_GB = 6;

/**
 * Env flag that opens the CPU-only (non-Metal) local path. DEFAULT (unset/empty) =
 * CURRENT behavior: Apple-Silicon Metal required, else localChat:false with reason
 * 'no_apple_silicon_metal'. So default boot behavior is byte-identical. When set,
 * a non-Apple-Silicon machine may still select a local model, under the higher
 * CPU_LOCAL_EXTRA_RESERVE_GB fit bar.
 */
const NON_METAL_ENV_FLAG = 'LANA_ALLOW_NON_METAL_LOCAL';

function isFlagOn(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

// Largest-first. contextWindow >= 8192 floor (MIN_LOCAL_CONTEXT_TOKENS). GGUF names
// mirror LANA-AI storage/models.js TIER_REQUIRED_MODEL_FILES. weightsGb (in-memory
// Q4_K_M weights) and kvBytesPerToken (K+V per token, from the model architecture)
// are the fit tuning knobs, ported per-model from hardware.ts MODEL_TIERS.
const TIER_LADDER = Object.freeze([
  { tier: 'enterprise', minMemoryGB: 256, chatModelFile: 'Qwen3.5-122B-A10B-Q4_K_M.gguf', contextWindow: 65536, weightsGb: 74.2, kvBytesPerToken: 90000 },
  { tier: 'professional', minMemoryGB: 96, chatModelFile: 'Qwen3.5-35B-A3B-Q4_K_M.gguf', contextWindow: 32768, weightsGb: 22, kvBytesPerToken: 70000 },
  { tier: 'edge', minMemoryGB: 24, chatModelFile: 'Qwen3.5-9B-Q4_K_M.gguf', contextWindow: 32768, weightsGb: 5.63, kvBytesPerToken: 54000 },
  { tier: 'demo', minMemoryGB: 16, chatModelFile: 'Qwen3-1.7B-Q4_K_M.gguf', contextWindow: 8192, weightsGb: 1.1, kvBytesPerToken: 20000 },
]);

const EMBED_MODEL_FILE = 'nomic-embed-text-v1.5.f16.gguf';

function detectHardware(io = {}) {
  const os = io.os || require('os');
  const arch = io.arch || process.arch;
  const platform = io.platform || process.platform;
  const totalRamGB = Math.round(os.totalmem() / 1e9);
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
  return { totalRamGB, isAppleSilicon, platform, arch };
}

/**
 * Fit test for a single tier on this machine (pure RAM/fit math, independent of the
 * Metal/flag gate). Reserve overheadGb (OS + full redactor + app), subtract the
 * model weights, and check the remaining KV-cache budget can hold this tier's
 * context window. `fits` requires ALL of: the comfort floor (minMemoryGB), enough
 * usable RAM for weights + KV at the full context window, and an effective context
 * at or above MIN_LOCAL_CONTEXT_TOKENS.
 *
 * @returns {{ usableGb:number, requiredGb:number, ramMaxContextTokens:number,
 *             effectiveContextTokens:number, fits:boolean }}
 */
function estimateTierFit(tier, totalRamGB, overheadGb) {
  const usableGb = Math.max(0, totalRamGB - overheadGb);
  const kvBudgetBytes = Math.max(0, (usableGb - tier.weightsGb) * BYTES_PER_GB);
  const ramMaxContextTokens = Math.floor(kvBudgetBytes / tier.kvBytesPerToken);
  const effectiveContextTokens = Math.min(ramMaxContextTokens, tier.contextWindow);
  const requiredGb = tier.weightsGb + (tier.contextWindow * tier.kvBytesPerToken) / BYTES_PER_GB;
  const fits = totalRamGB >= tier.minMemoryGB
    && usableGb >= requiredGb
    && effectiveContextTokens >= MIN_LOCAL_CONTEXT_TOKENS;
  return { usableGb, requiredGb, ramMaxContextTokens, effectiveContextTokens, fits };
}

/**
 * @returns {{ localChat: boolean, tier: string|null, model: string|null,
 *             chatModelFile: string|null, contextWindow: number|null,
 *             embedModelFile: string, reason: string, hardware: object,
 *             tiers: Array<{tier:string, minMemoryGB:number, model:string,
 *               contextWindow:number, fits:boolean, effectiveContextTokens:number}> }}
 *
 * Field-name contract (consumed downstream by bootstrap.js and the capability
 * endpoint): localChat, reason, tier, model, chatModelFile, contextWindow, and the
 * tiers[] ladder annotation are stable. `model` mirrors `chatModelFile` for the
 * endpoint; bootstrap.js still reads `chatModelFile` + `contextWindow` + `tier`.
 */
function selectModelPlan(io = {}) {
  const hardware = detectHardware(io);
  const base = { embedModelFile: EMBED_MODEL_FILE, hardware };

  const allowNonMetal = isFlagOn(process.env[NON_METAL_ENV_FLAG]);
  // Metal path uses the base reserve; the opt-in CPU path uses a strictly higher
  // bar. tiers[] annotation reflects the machine-appropriate posture so the
  // endpoint can show what this machine could actually host.
  const overheadGb = hardware.isAppleSilicon
    ? RESERVED_OVERHEAD_GB
    : RESERVED_OVERHEAD_GB + CPU_LOCAL_EXTRA_RESERVE_GB;

  const tiers = TIER_LADDER.map((t) => {
    const f = estimateTierFit(t, hardware.totalRamGB, overheadGb);
    return {
      tier: t.tier,
      minMemoryGB: t.minMemoryGB,
      model: t.chatModelFile,
      contextWindow: t.contextWindow,
      fits: f.fits,
      effectiveContextTokens: f.effectiveContextTokens,
    };
  });

  const noLocal = (reason) => ({
    ...base, localChat: false, tier: null, model: null,
    chatModelFile: null, contextWindow: null, reason, tiers,
  });

  // Local GGUF inference needs Apple-Silicon Metal unless the operator opts into
  // the CPU-only path. Default (flag unset) is byte-identical to prior behavior.
  if (!hardware.isAppleSilicon && !allowNonMetal) {
    return noLocal('no_apple_silicon_metal');
  }

  // Largest-first ladder -> the first tier that fits is the largest that fits.
  const chosen = tiers.find((t) => t.fits);
  if (!chosen) {
    // Distinguish "no tier even clears its RAM floor" from "a floor is cleared but
    // the redactor-reserved budget cannot hold weights + KV at the context window".
    const anyFloorCleared = TIER_LADDER.some((t) => hardware.totalRamGB >= t.minMemoryGB);
    return noLocal(anyFloorCleared ? 'insufficient_context' : 'insufficient_ram_for_any_tier');
  }

  const spec = TIER_LADDER.find((t) => t.tier === chosen.tier);
  const posture = hardware.isAppleSilicon ? '' : '_cpu';
  return {
    ...base,
    localChat: true,
    tier: spec.tier,
    model: spec.chatModelFile,
    chatModelFile: spec.chatModelFile,
    contextWindow: spec.contextWindow,
    reason: `selected_${spec.tier}_for_${hardware.totalRamGB}gb${posture}`,
    tiers,
  };
}

module.exports = {
  selectModelPlan,
  detectHardware,
  estimateTierFit,
  TIER_LADDER,
  EMBED_MODEL_FILE,
  RESERVED_OVERHEAD_GB,
  REDACTOR_RESERVE_GB,
  MIN_LOCAL_CONTEXT_TOKENS,
  CPU_LOCAL_EXTRA_RESERVE_GB,
  NON_METAL_ENV_FLAG,
};
