'use strict';

const { selectModelPlan } = require('../../supervisor/model-selector');

const gb = (n) => ({ totalmem: () => n * 1e9 });
const apple = (ramGB) => ({ os: gb(ramGB), platform: 'darwin', arch: 'arm64' });
const intel = (ramGB) => ({ os: gb(ramGB), platform: 'darwin', arch: 'x64' });

describe('selectModelPlan', () => {
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
    expect(plan.contextWindow).toBeGreaterThanOrEqual(8192);
  });

  it('falls back to relay chat below the smallest tier (reserving redaction headroom)', () => {
    const plan = selectModelPlan(apple(8));
    expect(plan.localChat).toBe(false);
    expect(plan.tier).toBe(null);
    expect(plan.reason).toBe('insufficient_ram_for_any_tier');
  });

  it('falls back to relay chat on non-Apple-Silicon regardless of RAM', () => {
    const plan = selectModelPlan(intel(128));
    expect(plan.localChat).toBe(false);
    expect(plan.reason).toBe('no_apple_silicon_metal');
  });

  it('always provides a local embedding model', () => {
    expect(selectModelPlan(apple(8)).embedModelFile).toMatch(/nomic-embed/);
    expect(selectModelPlan(intel(128)).embedModelFile).toMatch(/nomic-embed/);
  });
});
