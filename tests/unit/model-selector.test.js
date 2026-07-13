'use strict';

const {
  selectModelPlan,
  estimateTierFit,
  estimateTierVramFit,
  auxModelsForTier,
  TIER_LADDER,
  RESERVED_OVERHEAD_GB,
  CPU_LOCAL_EXTRA_RESERVE_GB,
  CUDA_MIN_SYSTEM_RAM_GB,
  NON_METAL_ENV_FLAG,
} = require('../../supervisor/model-selector');

const gb = (n) => ({ totalmem: () => n * 1e9 });
const apple = (ramGB) => ({ os: gb(ramGB), platform: 'darwin', arch: 'arm64' });
const intel = (ramGB) => ({ os: gb(ramGB), platform: 'darwin', arch: 'x64' });
// A CUDA box: linux/win + an injected nvidia-smi probe reporting `vramGB` total.
const cuda = (ramGB, vramGB, platform = 'linux') => ({
  os: gb(ramGB), platform, arch: 'x64',
  probeNvidiaSmi: () => ({ present: true, vramGB, gpus: [{ name: 'RTX', vramGB }] }),
});

// The env flag must not leak between tests: default behavior depends on it unset.
const savedFlag = process.env[NON_METAL_ENV_FLAG];
beforeEach(() => { delete process.env[NON_METAL_ENV_FLAG]; });
afterAll(() => {
  if (savedFlag === undefined) delete process.env[NON_METAL_ENV_FLAG];
  else process.env[NON_METAL_ENV_FLAG] = savedFlag;
});

describe('selectModelPlan (default / Apple Silicon)', () => {
  it('picks the largest tier that fits RAM on Apple Silicon', () => {
    expect(selectModelPlan(apple(32)).tier).toBe('edge');       // 24<=32<96
    expect(selectModelPlan(apple(16)).tier).toBe('demo');       // 16<=16<24
    expect(selectModelPlan(apple(128)).tier).toBe('professional');
    expect(selectModelPlan(apple(512)).tier).toBe('enterprise');
  });

  it('enables local chat and names a GGUF + context when a tier fits', () => {
    const plan = selectModelPlan(apple(32));
    expect(plan.localChat).toBe(true);
    expect(plan.chatModelFile).toMatch(/\.gguf$/);
    expect(plan.model).toBe(plan.chatModelFile); // `model` mirrors chatModelFile for the endpoint
    expect(plan.contextWindow).toBeGreaterThanOrEqual(8192);
    expect(plan.reason).toBe('selected_edge_for_32gb');
  });

  it('falls back to relay chat below the smallest tier (reserving redaction headroom)', () => {
    const plan = selectModelPlan(apple(8));
    expect(plan.localChat).toBe(false);
    expect(plan.tier).toBe(null);
    expect(plan.model).toBe(null);
    expect(plan.reason).toBe('insufficient_ram_for_any_tier');
  });

  it('falls back to relay chat on non-Apple-Silicon by default (flag unset)', () => {
    const plan = selectModelPlan(intel(128));
    expect(plan.localChat).toBe(false);
    expect(plan.reason).toBe('no_apple_silicon_metal');
  });

  it('always provides a local embedding model', () => {
    expect(selectModelPlan(apple(8)).embedModelFile).toMatch(/nomic-embed/);
    expect(selectModelPlan(intel(128)).embedModelFile).toMatch(/nomic-embed/);
  });
});

describe('fit computation (weights + KV + redactor reserve)', () => {
  it('just-under a higher tier floor falls to the next lower tier that fits', () => {
    // 95GB clears edge (24) but not professional (96) -> edge, not professional.
    const plan = selectModelPlan(apple(95));
    expect(plan.tier).toBe('edge');
    expect(plan.localChat).toBe(true);
  });

  it('estimateTierFit fails when weights + context KV exceed usable RAM even if the floor is cleared', () => {
    // A synthetic tier whose floor is trivially met but whose weights alone dwarf RAM.
    const greedy = { tier: 'greedy', minMemoryGB: 1, contextWindow: 32768, weightsGb: 900, kvBytesPerToken: 70000 };
    const fit = estimateTierFit(greedy, 32, RESERVED_OVERHEAD_GB);
    expect(fit.fits).toBe(false); // floor cleared, but no room for weights
  });

  it('reports insufficient_context when a floor is cleared but the reserved budget holds no model', () => {
    // CPU path at 16GB: demo floor (16) is cleared, but the higher CPU overhead
    // (RESERVED_OVERHEAD_GB + CPU_LOCAL_EXTRA_RESERVE_GB = 15) leaves ~1GB usable,
    // too little for the demo weights -> no tier fits though a floor was cleared.
    process.env[NON_METAL_ENV_FLAG] = '1';
    const plan = selectModelPlan(intel(16));
    expect(plan.localChat).toBe(false);
    expect(plan.reason).toBe('insufficient_context');
  });
});

describe('tiers[] ladder annotation', () => {
  it('annotates every ladder entry with a boolean fit for this machine', () => {
    const plan = selectModelPlan(apple(32));
    expect(Array.isArray(plan.tiers)).toBe(true);
    expect(plan.tiers).toHaveLength(TIER_LADDER.length);
    for (const t of plan.tiers) {
      expect(typeof t.tier).toBe('string');
      expect(typeof t.minMemoryGB).toBe('number');
      expect(t.model).toMatch(/\.gguf$/);
      expect(typeof t.contextWindow).toBe('number');
      expect(typeof t.fits).toBe('boolean');
    }
  });

  it('fits annotations match the selected tier and RAM floors on a 32GB Mac', () => {
    const byTier = Object.fromEntries(selectModelPlan(apple(32)).tiers.map((t) => [t.tier, t.fits]));
    expect(byTier.demo).toBe(true);        // 16<=32, fits
    expect(byTier.edge).toBe(true);        // 24<=32, fits (selected)
    expect(byTier.professional).toBe(false); // 96>32
    expect(byTier.enterprise).toBe(false);   // 256>32
  });

  it('a sub-threshold machine reports all tiers as not-fitting', () => {
    const plan = selectModelPlan(apple(8));
    expect(plan.tiers.every((t) => t.fits === false)).toBe(true);
  });
});

describe('auxModels contract (legal + vision selection intent)', () => {
  const rolesOf = (plan) => plan.auxModels.map((m) => m.role);
  const byRole = (plan, role) => plan.auxModels.find((m) => m.role === role);

  it('is always an array on the plan (even when relay chat is selected)', () => {
    expect(Array.isArray(selectModelPlan(apple(8)).auxModels)).toBe(true);
    expect(Array.isArray(selectModelPlan(intel(128)).auxModels)).toBe(true);
  });

  it('is empty when there is no local chat tier (relay path)', () => {
    expect(selectModelPlan(apple(8)).auxModels).toEqual([]);         // below smallest tier
    expect(selectModelPlan(intel(128)).auxModels).toEqual([]);       // non-Metal default -> relay
  });

  it('demo selects a legal verifier but NO vision projector', () => {
    const plan = selectModelPlan(apple(16));
    expect(plan.tier).toBe('demo');
    expect(rolesOf(plan)).toEqual(['legal']);
    expect(byRole(plan, 'legal').model).toBe('SaulLM-7B-Instruct.Q4_K_M.gguf');
    expect(byRole(plan, 'vision')).toBeUndefined();
  });

  it('edge selects both a legal verifier and a vision projector', () => {
    const plan = selectModelPlan(apple(32));
    expect(plan.tier).toBe('edge');
    expect(rolesOf(plan).sort()).toEqual(['legal', 'vision']);
    expect(byRole(plan, 'legal').model).toBe('SaulLM-7B-Instruct.Q4_K_M.gguf');
    expect(byRole(plan, 'vision').model).toBe('mmproj-Qwen3.5-9B-BF16.gguf');
  });

  it('professional selects the larger SaulLM-54B verifier + its mmproj', () => {
    const plan = selectModelPlan(apple(128));
    expect(plan.tier).toBe('professional');
    expect(byRole(plan, 'legal').model).toBe('SaulLM-54B-Instruct.Q4_K_M.gguf');
    expect(byRole(plan, 'vision').model).toBe('mmproj-Qwen3.5-35B-A3B-BF16.gguf');
  });

  it('every aux entry carries a role, a catalogKey, and a .gguf model filename', () => {
    for (const t of TIER_LADDER) {
      for (const m of auxModelsForTier(t.tier)) {
        expect(['legal', 'vision']).toContain(m.role);
        expect(typeof m.catalogKey).toBe('string');
        expect(m.catalogKey.length).toBeGreaterThan(0);
        expect(m.model).toMatch(/\.gguf$/);
      }
    }
  });

  it('auxModelsForTier returns fresh, mutable copies (caller cannot corrupt source)', () => {
    const a = auxModelsForTier('edge');
    a[0].model = 'MUTATED';
    expect(auxModelsForTier('edge')[0].model).toBe('SaulLM-7B-Instruct.Q4_K_M.gguf');
  });
});

describe('non-Apple-Silicon CPU path (LANA_ALLOW_NON_METAL_LOCAL)', () => {
  it('is disabled by default and steers to the relay', () => {
    expect(selectModelPlan(intel(128)).localChat).toBe(false);
    expect(selectModelPlan(intel(128)).reason).toBe('no_apple_silicon_metal');
  });

  it('enables CPU-only local selection when the flag is set, under the higher fit bar', () => {
    process.env[NON_METAL_ENV_FLAG] = '1';
    const plan = selectModelPlan(intel(128));
    expect(plan.localChat).toBe(true);
    expect(plan.tier).toBe('professional');   // 96<=128<256
    expect(plan.reason).toMatch(/_cpu$/);     // posture-tagged reason
    expect(plan.model).toMatch(/\.gguf$/);
  });

  it('applies a strictly higher RAM/fit bar on the CPU path than on Metal', () => {
    process.env[NON_METAL_ENV_FLAG] = '1';
    expect(CPU_LOCAL_EXTRA_RESERVE_GB).toBeGreaterThan(0);
    // At 16GB, Metal fits demo but the higher CPU overhead does not -> the CPU bar
    // is strictly higher (same RAM, no local selection).
    expect(selectModelPlan(apple(16)).tier).toBe('demo');
    expect(selectModelPlan(intel(16)).localChat).toBe(false);
    // Give the CPU path plenty of headroom and it selects, posture-tagged.
    expect(selectModelPlan(intel(64)).tier).toBe('edge');
    expect(selectModelPlan(intel(64)).reason).toMatch(/_cpu$/);
  });

  it('accepts common truthy spellings of the flag', () => {
    for (const v of ['true', 'YES', 'on', '1']) {
      process.env[NON_METAL_ENV_FLAG] = v;
      expect(selectModelPlan(intel(128)).localChat).toBe(true);
    }
    for (const v of ['', '0', 'false', 'no']) {
      process.env[NON_METAL_ENV_FLAG] = v;
      expect(selectModelPlan(intel(128)).localChat).toBe(false);
    }
  });
});

describe('NVIDIA CUDA path (linux/win + nvidia-smi)', () => {
  it('enables local chat on a CUDA GPU WITHOUT the non-metal flag (GPU is first-class)', () => {
    // Flag intentionally left unset (beforeEach clears it).
    const plan = selectModelPlan(cuda(64, 24));
    expect(plan.hardware.accel.backend).toBe('cuda');
    expect(plan.hardware.accel.vramGB).toBe(24);
    expect(plan.localChat).toBe(true);
    expect(plan.reason).toMatch(/_cuda$/);
    expect(plan.model).toMatch(/\.gguf$/);
  });

  it('picks the largest tier whose weights + KV fit in VRAM (24GB -> edge)', () => {
    // 24GB VRAM holds edge (weights 5.63 + KV) but not professional (weights 22 + KV).
    expect(selectModelPlan(cuda(64, 24)).tier).toBe('edge');
  });

  it('a bigger card hosts a bigger tier (80GB -> professional)', () => {
    expect(selectModelPlan(cuda(128, 80)).tier).toBe('professional');
  });

  it('names VRAM (not system RAM) in the CUDA reason string', () => {
    expect(selectModelPlan(cuda(64, 24)).reason).toBe('selected_edge_for_24gb_cuda');
  });

  it('works identically on Windows (win32)', () => {
    const plan = selectModelPlan(cuda(64, 24, 'win32'));
    expect(plan.hardware.accel.backend).toBe('cuda');
    expect(plan.localChat).toBe(true);
    expect(plan.tier).toBe('edge');
  });

  it('reports insufficient_vram when RAM is ample but no tier fits the card', () => {
    // 2GB VRAM: after the CUDA reserve there is no room for even the demo weights.
    const plan = selectModelPlan(cuda(64, 2));
    expect(plan.localChat).toBe(false);
    expect(plan.reason).toBe('insufficient_vram');
  });

  it('reports insufficient_ram_for_any_tier when the box cannot host the redactor stack', () => {
    // Plenty of VRAM but < CUDA_MIN_SYSTEM_RAM_GB system RAM -> redaction-first denies local.
    const plan = selectModelPlan(cuda(4, 48));
    expect(CUDA_MIN_SYSTEM_RAM_GB).toBeGreaterThan(4);
    expect(plan.localChat).toBe(false);
    expect(plan.reason).toBe('insufficient_ram_for_any_tier');
  });

  it('selects legal + vision aux models on the CUDA path too', () => {
    const roles = selectModelPlan(cuda(64, 24)).auxModels.map((m) => m.role).sort();
    expect(roles).toEqual(['legal', 'vision']);
  });

  it('annotates tiers[] by VRAM fit on a CUDA box', () => {
    const byTier = Object.fromEntries(selectModelPlan(cuda(64, 24)).tiers.map((t) => [t.tier, t.fits]));
    expect(byTier.demo).toBe(true);
    expect(byTier.edge).toBe(true);
    expect(byTier.professional).toBe(false); // 24GB VRAM can't hold the 22GB weights + KV
    expect(byTier.enterprise).toBe(false);
  });
});

describe('estimateTierVramFit (VRAM weights + KV math)', () => {
  const edge = TIER_LADDER.find((t) => t.tier === 'edge');

  it('fits when VRAM comfortably holds weights + full-context KV', () => {
    expect(estimateTierVramFit(edge, 32, 24).fits).toBe(true);
  });

  it('fails when the card is too small for weights + KV, even with huge system RAM', () => {
    expect(estimateTierVramFit(edge, 512, 6).fits).toBe(false);
  });

  it('fails when system RAM cannot host the redactor stack, even with a huge card', () => {
    expect(estimateTierVramFit(edge, 2, 80).fits).toBe(false);
  });
});
