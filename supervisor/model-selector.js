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
 *
 * CROSS-PLATFORM (Phase 1): the local-inference gate is no longer Apple-Silicon-
 * only. The acceleration backend is detected by hardware-accel.js (Metal on
 * Apple-Silicon, CUDA on linux/win32 with an NVIDIA GPU, else CPU) and drives
 * selection: Metal fits against system RAM (unified memory); CUDA fits the model
 * weights + KV against VRAM (a separate budget) while system RAM still hosts the
 * redactor stack; CPU stays behind the LANA_ALLOW_NON_METAL_LOCAL opt-in at the
 * higher RAM bar. Redaction headroom is reserved FIRST on every path.
 */
'use strict';

const { detectAccelBackend } = require('./hardware-accel');

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
 * VRAM held back from a CUDA GPU BEFORE fitting model weights + KV cache: CUDA
 * runtime/context, activation/compute buffers, and the OS/display driver's own
 * allocation. The KV cache itself is accounted separately (kvBytesPerToken), so
 * this is only the fixed non-KV GPU overhead. Tune as CUDA support matures.
 */
const CUDA_VRAM_RESERVE_GB = 2;

/**
 * System-RAM floor a CUDA machine must clear regardless of VRAM: the model lives in
 * VRAM, but the OS + FULL de-id redactor + resident sidecars still run in system
 * RAM (redaction-first, never sacrificed). Equal to RESERVED_OVERHEAD_GB so a CUDA
 * box with plenty of VRAM but too little RAM to host the redactor is (correctly)
 * denied local chat rather than shipping a model at the cost of the moat.
 */
const CUDA_MIN_SYSTEM_RAM_GB = RESERVED_OVERHEAD_GB;

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

/**
 * AUXILIARY (non-chat) models that ride ALONGSIDE the selected chat tier:
 *   - legal:  the SaulLM specialized legal-verifier GGUF (server runs it as the
 *             llamacpp-legal sidecar). Demo/edge share SaulLM-7B; professional/
 *             enterprise use SaulLM-54B.
 *   - vision: the Qwen mmproj projector GGUF (server runs it as llamacpp-vision).
 *             Demo has NO vision projector (matches download-llamacpp-models.sh:
 *             the demo section queues no mmproj); edge+ each carry a per-model
 *             mmproj.
 *
 * Filenames + tier mapping mirror scripts/download-llamacpp-models.sh and
 * infra/lib/storage/models.js TIER_REQUIRED_MODEL_FILES so the three never drift.
 * `catalogKey` resolves the url/sha256/sizeBytes for the download in
 * model-catalog.js (AUX_MODEL_CATALOG) — the CONTRACT boundary with the
 * wiring/download lane.
 *
 * AVAILABILITY CONTRACT: this map is SELECTION INTENT only (what the selected
 * tier wants to run locally). It does NOT assert the files are on disk. LANA One
 * downloads GGUFs on the user's command via the in-app model-setup step
 * (Settings > Local Models). The wiring lane MUST consult that step's
 * downloaded-files state before spawning the legal/vision servers, and fall back
 * (relay verify / no vision) when a file has not been fetched yet. Nothing here
 * pre-fetches anything.
 */
const AUX_MODELS_BY_TIER = Object.freeze({
  demo: Object.freeze([
    Object.freeze({ role: 'legal', catalogKey: 'legal-saullm-7b', model: 'SaulLM-7B-Instruct.Q4_K_M.gguf' }),
  ]),
  edge: Object.freeze([
    Object.freeze({ role: 'legal', catalogKey: 'legal-saullm-7b', model: 'SaulLM-7B-Instruct.Q4_K_M.gguf' }),
    Object.freeze({ role: 'vision', catalogKey: 'vision-qwen35-9b', model: 'mmproj-Qwen3.5-9B-BF16.gguf' }),
  ]),
  professional: Object.freeze([
    Object.freeze({ role: 'legal', catalogKey: 'legal-saullm-54b', model: 'SaulLM-54B-Instruct.Q4_K_M.gguf' }),
    Object.freeze({ role: 'vision', catalogKey: 'vision-qwen35-35b', model: 'mmproj-Qwen3.5-35B-A3B-BF16.gguf' }),
  ]),
  enterprise: Object.freeze([
    Object.freeze({ role: 'legal', catalogKey: 'legal-saullm-54b', model: 'SaulLM-54B-Instruct.Q4_K_M.gguf' }),
    Object.freeze({ role: 'vision', catalogKey: 'vision-qwen35-122b', model: 'mmproj-Qwen3.5-122B-A10B-BF16.gguf' }),
  ]),
});

/**
 * The auxiliary (legal + vision) models the given tier wants alongside its chat
 * model, as fresh mutable copies (so callers can annotate them, e.g. with an
 * on-disk availability flag, without mutating the frozen source of truth).
 *
 * @param {string|null} tier
 * @returns {Array<{role: 'legal'|'vision', catalogKey: string, model: string}>}
 */
function auxModelsForTier(tier) {
  const list = AUX_MODELS_BY_TIER[tier] || [];
  return list.map((m) => ({ role: m.role, catalogKey: m.catalogKey, model: m.model }));
}

function detectHardware(io = {}) {
  const os = io.os || require('os');
  const arch = io.arch || process.arch;
  const platform = io.platform || process.platform;
  const totalRamGB = Math.round(os.totalmem() / 1e9);
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
  // Acceleration backend (metal | cuda | cpu) + VRAM budget. Probes are injectable
  // via io (probeNvidiaSmi / execFileSync / env) so this stays hermetic in tests.
  const accel = detectAccelBackend({
    platform,
    arch,
    env: io.env,
    probeNvidiaSmi: io.probeNvidiaSmi,
    execFileSync: io.execFileSync,
  });
  return { totalRamGB, isAppleSilicon, platform, arch, accel };
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
 * CUDA fit test for a single tier: the model weights + KV cache at the full context
 * window must fit in VRAM (after CUDA_VRAM_RESERVE_GB), AND system RAM must clear
 * CUDA_MIN_SYSTEM_RAM_GB so the FULL redactor stack still runs (redaction-first).
 *
 * Unlike the Metal/CPU path, the per-tier `minMemoryGB` comfort floor is NOT applied
 * to system RAM here — on a discrete-GPU box the deciding budget is VRAM, so a
 * 32GB-RAM machine with 48GB of VRAM can legitimately host a tier whose unified-
 * memory floor is 96GB. The VRAM math is the exact analogue of estimateTierFit.
 *
 * @returns {{ usableVramGb:number, requiredVramGb:number, vramMaxContextTokens:number,
 *             effectiveContextTokens:number, fits:boolean }}
 */
function estimateTierVramFit(tier, totalRamGB, vramGB, opts = {}) {
  const vramReserveGb = typeof opts.vramReserveGb === 'number' ? opts.vramReserveGb : CUDA_VRAM_RESERVE_GB;
  const usableVramGb = Math.max(0, (vramGB || 0) - vramReserveGb);
  const kvBudgetBytes = Math.max(0, (usableVramGb - tier.weightsGb) * BYTES_PER_GB);
  const vramMaxContextTokens = Math.floor(kvBudgetBytes / tier.kvBytesPerToken);
  const effectiveContextTokens = Math.min(vramMaxContextTokens, tier.contextWindow);
  const requiredVramGb = tier.weightsGb + (tier.contextWindow * tier.kvBytesPerToken) / BYTES_PER_GB;
  const fits = totalRamGB >= CUDA_MIN_SYSTEM_RAM_GB
    && usableVramGb >= requiredVramGb
    && effectiveContextTokens >= MIN_LOCAL_CONTEXT_TOKENS;
  return { usableVramGb, requiredVramGb, vramMaxContextTokens, effectiveContextTokens, fits };
}

/**
 * @returns {{ localChat: boolean, tier: string|null, model: string|null,
 *             chatModelFile: string|null, contextWindow: number|null,
 *             embedModelFile: string, reason: string, hardware: object,
 *             auxModels: Array<{role:'legal'|'vision', catalogKey:string, model:string}>,
 *             tiers: Array<{tier:string, minMemoryGB:number, model:string,
 *               contextWindow:number, fits:boolean, effectiveContextTokens:number}> }}
 *
 * Field-name contract (consumed downstream by bootstrap.js and the capability
 * endpoint): localChat, reason, tier, model, chatModelFile, contextWindow, the
 * auxModels[] intent list, and the tiers[] ladder annotation are stable. `model`
 * mirrors `chatModelFile` for the endpoint; bootstrap.js still reads
 * `chatModelFile` + `contextWindow` + `tier`. auxModels is [] whenever localChat
 * is false (relay chat runs no local legal/vision sidecars).
 */
function selectModelPlan(io = {}) {
  const hardware = detectHardware(io);
  // auxModels defaults to [] (relay chat runs no local legal/vision sidecars);
  // a selected local tier overrides it below with that tier's intent list.
  const base = { embedModelFile: EMBED_MODEL_FILE, hardware, auxModels: [] };

  const allowNonMetal = isFlagOn(process.env[NON_METAL_ENV_FLAG]);
  const backend = (hardware.accel && hardware.accel.backend) || 'cpu';
  const vramGB = (hardware.accel && hardware.accel.vramGB) || 0;

  // Per-backend fit posture:
  //   metal -> RAM-fit at the base reserve (unified memory hosts weights + KV).
  //   cuda  -> VRAM-fit (weights + KV in VRAM) + a system-RAM floor for the redactor.
  //   cpu   -> RAM-fit at the strictly higher CPU bar (opt-in only, below).
  // tiers[] reflects the machine-appropriate posture so the endpoint shows what
  // this machine could actually host.
  const cpuOverheadGb = RESERVED_OVERHEAD_GB + CPU_LOCAL_EXTRA_RESERVE_GB;
  const tiers = TIER_LADDER.map((t) => {
    const f = backend === 'cuda'
      ? estimateTierVramFit(t, hardware.totalRamGB, vramGB)
      : estimateTierFit(t, hardware.totalRamGB, backend === 'metal' ? RESERVED_OVERHEAD_GB : cpuOverheadGb);
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

  // Local GGUF inference runs on a GPU backend (Metal or CUDA) out of the box; the
  // CPU-only path stays behind the LANA_ALLOW_NON_METAL_LOCAL opt-in. Default (flag
  // unset) on a non-GPU machine is byte-identical to prior behavior, including the
  // 'no_apple_silicon_metal' reason string that downstream/UI consumers key on.
  if (backend === 'cpu' && !allowNonMetal) {
    return noLocal('no_apple_silicon_metal');
  }

  // Largest-first ladder -> the first tier that fits is the largest that fits.
  const chosen = tiers.find((t) => t.fits);
  if (!chosen) {
    if (backend === 'cuda') {
      // Distinguish "system RAM too small for the redactor stack" from "RAM is fine
      // but no tier's weights + KV fit in VRAM".
      return noLocal(hardware.totalRamGB >= CUDA_MIN_SYSTEM_RAM_GB
        ? 'insufficient_vram' : 'insufficient_ram_for_any_tier');
    }
    // Metal/CPU: distinguish "no tier even clears its RAM floor" from "a floor is
    // cleared but the redactor-reserved budget cannot hold weights + KV at ctx".
    const anyFloorCleared = TIER_LADDER.some((t) => hardware.totalRamGB >= t.minMemoryGB);
    return noLocal(anyFloorCleared ? 'insufficient_context' : 'insufficient_ram_for_any_tier');
  }

  const spec = TIER_LADDER.find((t) => t.tier === chosen.tier);
  // posture tags the reason; the "size" that qualified the machine is VRAM on CUDA,
  // system RAM on Metal/CPU.
  const posture = backend === 'metal' ? '' : `_${backend}`;
  const sizeGb = backend === 'cuda' ? vramGB : hardware.totalRamGB;
  return {
    ...base,
    localChat: true,
    tier: spec.tier,
    model: spec.chatModelFile,
    chatModelFile: spec.chatModelFile,
    contextWindow: spec.contextWindow,
    // CONTRACT (auxModels): the legal + vision GGUFs this tier wants running
    // alongside local chat. Each entry is { role, catalogKey, model }; catalogKey
    // resolves url/sha in model-catalog.js. This is SELECTION INTENT — the wiring
    // lane checks the user's model-setup download state for actual on-disk
    // availability before spawning llamacpp-legal / llamacpp-vision.
    auxModels: auxModelsForTier(spec.tier),
    reason: `selected_${spec.tier}_for_${sizeGb}gb${posture}`,
    tiers,
  };
}

module.exports = {
  selectModelPlan,
  detectHardware,
  estimateTierFit,
  estimateTierVramFit,
  auxModelsForTier,
  AUX_MODELS_BY_TIER,
  TIER_LADDER,
  EMBED_MODEL_FILE,
  RESERVED_OVERHEAD_GB,
  REDACTOR_RESERVE_GB,
  MIN_LOCAL_CONTEXT_TOKENS,
  CPU_LOCAL_EXTRA_RESERVE_GB,
  CUDA_VRAM_RESERVE_GB,
  CUDA_MIN_SYSTEM_RAM_GB,
  NON_METAL_ENV_FLAG,
};
