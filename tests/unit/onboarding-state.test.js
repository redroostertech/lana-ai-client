'use strict';

const { createOnboardingStore } = require('../../src/js/onboarding/onboarding-state');

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

const STATE = { status: 'completed', scene: 'start' };

describe('onboarding state store (device only)', () => {
  it('saves and loads a user\'s state', () => {
    const store = createOnboardingStore({ storage: memoryStorage(), userId: 'u1' });
    expect(store.save(STATE)).toBe(true);
    expect(store.load()).toEqual(STATE);
  });

  it('returns null for a user who has never seen the tour', () => {
    expect(createOnboardingStore({ storage: memoryStorage(), userId: 'u1' }).load()).toBeNull();
  });

  it('keeps each user separate on a shared computer', () => {
    const storage = memoryStorage();
    createOnboardingStore({ storage, userId: 'u1' }).save(STATE);
    expect(createOnboardingStore({ storage, userId: 'u2' }).load()).toBeNull();
  });

  it.each([
    ['corrupt JSON', 'not json'],
    ['a non-object value', '"completed"'],
  ])('treats %s as never seen', (_label, raw) => {
    const storage = memoryStorage();
    storage.setItem('lana.onboarding.u1', raw);
    expect(createOnboardingStore({ storage, userId: 'u1' }).load()).toBeNull();
  });

  it('keeps working when storage is unavailable or full', () => {
    expect(createOnboardingStore({ storage: null, userId: 'u1' }).load()).toBeNull();
    expect(createOnboardingStore({ storage: null, userId: 'u1' }).save(STATE)).toBe(false);
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(createOnboardingStore({ storage: full, userId: 'u1' }).save(STATE)).toBe(false);
  });
});
