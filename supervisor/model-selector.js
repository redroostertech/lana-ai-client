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
 * REDACTION-FIRST invariant: the per-tier minMemoryGB thresholds bake in OS +
 * redactor + stack overhead, so requiring totalRamGB >= minMemoryGB reserves the
 * redactor's footprint before any model is chosen. A machine that fits no tier gets
 * relay chat + full on-device redaction (redaction is never sacrificed for a model).
 *
 * os/arch are injected so selection is unit-testable on any host.
 */
'use strict';

// Largest-first. contextWindow >= 8192 floor (MIN_LOCAL_CONTEXT_TOKENS). GGUF names
// mirror LANA-AI storage/models.js TIER_REQUIRED_MODEL_FILES.
const TIER_LADDER = Object.freeze([
  { tier: 'enterprise', minMemoryGB: 256, chatModelFile: 'Qwen3.5-122B-A10B-Q4_K_M.gguf', contextWindow: 65536 },
  { tier: 'professional', minMemoryGB: 96, chatModelFile: 'Qwen3.5-35B-A3B-Q4_K_M.gguf', contextWindow: 32768 },
  { tier: 'edge', minMemoryGB: 24, chatModelFile: 'Qwen3.5-9B-Q4_K_M.gguf', contextWindow: 32768 },
  { tier: 'demo', minMemoryGB: 16, chatModelFile: 'Qwen3-1.7B-Q4_K_M.gguf', contextWindow: 8192 },
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
 * @returns {{ localChat: boolean, tier: string|null, chatModelFile: string|null,
 *             contextWindow: number|null, embedModelFile: string, reason: string,
 *             hardware: object }}
 */
function selectModelPlan(io = {}) {
  const hardware = detectHardware(io);
  const base = { embedModelFile: EMBED_MODEL_FILE, hardware };

  // Local GGUF inference needs Apple-Silicon Metal; otherwise chat goes to the relay.
  if (!hardware.isAppleSilicon) {
    return { ...base, localChat: false, tier: null, chatModelFile: null, contextWindow: null, reason: 'no_apple_silicon_metal' };
  }
  const fit = TIER_LADDER.find((t) => hardware.totalRamGB >= t.minMemoryGB);
  if (!fit) {
    return { ...base, localChat: false, tier: null, chatModelFile: null, contextWindow: null, reason: 'insufficient_ram_for_any_tier' };
  }
  return {
    ...base,
    localChat: true,
    tier: fit.tier,
    chatModelFile: fit.chatModelFile,
    contextWindow: fit.contextWindow,
    reason: `selected_${fit.tier}_for_${hardware.totalRamGB}gb`,
  };
}

module.exports = { selectModelPlan, detectHardware, TIER_LADDER, EMBED_MODEL_FILE };
