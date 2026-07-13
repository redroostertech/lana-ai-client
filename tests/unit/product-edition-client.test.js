/**
 * Unit tests for the client-side product-edition helper and the
 * edition-aware plan offering (tiersForEdition).
 *
 * Guardrail under test: the edition is FORM FACTOR only. It decides which
 * plans are OFFERED (and the graduate affordance); it must fail safe to the
 * base LANA AI edition, where the plan grid is exactly today's list.
 */

const path = require('path');

const edition = require(path.join(
  __dirname,
  '../../src/js/shared/product-edition.client.js'
));

const pricing = require(path.join(
  __dirname,
  '../../src/js/billing/pricing-tiers.js'
));

describe('product-edition.client', () => {
  describe('normalizeEdition', () => {
    test('accepts lana_one in any casing/whitespace', () => {
      expect(edition.normalizeEdition('lana_one')).toBe('lana_one');
      expect(edition.normalizeEdition('  LANA_ONE  ')).toBe('lana_one');
    });

    test('fails safe to lana_ai for everything else', () => {
      expect(edition.normalizeEdition('lana_ai')).toBe('lana_ai');
      expect(edition.normalizeEdition('enterprise')).toBe('lana_ai');
      expect(edition.normalizeEdition('')).toBe('lana_ai');
      expect(edition.normalizeEdition(null)).toBe('lana_ai');
      expect(edition.normalizeEdition(undefined)).toBe('lana_ai');
      expect(edition.normalizeEdition(true)).toBe('lana_ai');
      expect(edition.normalizeEdition(1)).toBe('lana_ai');
    });
  });

  describe('editionFromStatus', () => {
    test('prefers the explicit edition string', () => {
      expect(edition.editionFromStatus({ edition: 'lana_one' })).toBe('lana_one');
      expect(edition.editionFromStatus({ edition: 'lana_ai', is_lana_one: true })).toBe('lana_ai');
    });

    test('falls back to is_lana_one boolean (strict boolean only)', () => {
      expect(edition.editionFromStatus({ is_lana_one: true })).toBe('lana_one');
      expect(edition.editionFromStatus({ is_lana_one: false })).toBe('lana_ai');
    });

    test('returns null when the edition fields are absent or invalid (must not be persisted)', () => {
      expect(edition.editionFromStatus(null)).toBe(null);
      expect(edition.editionFromStatus(undefined)).toBe(null);
      expect(edition.editionFromStatus('lana_one')).toBe(null);
      expect(edition.editionFromStatus({})).toBe(null);
      expect(edition.editionFromStatus({ status: 'ok' })).toBe(null);
      expect(edition.editionFromStatus({ edition: 42 })).toBe(null);
      expect(edition.editionFromStatus({ is_lana_one: 'true' })).toBe(null);
      expect(edition.editionFromStatus({ is_lana_one: 1 })).toBe(null);
    });

    test('an unknown edition string is still a carried field and normalizes fail-safe', () => {
      expect(edition.editionFromStatus({ edition: 'enterprise' })).toBe('lana_ai');
    });
  });

  describe('storageKeyForServer', () => {
    test('scopes the key by server URL', () => {
      expect(edition.storageKeyForServer('https://a.example.com'))
        .toBe(edition.STORAGE_KEY + ':https://a.example.com');
    });

    test('falls back to the global key without a server', () => {
      expect(edition.storageKeyForServer('')).toBe(edition.STORAGE_KEY);
      expect(edition.storageKeyForServer(null)).toBe(edition.STORAGE_KEY);
      expect(edition.storageKeyForServer(undefined)).toBe(edition.STORAGE_KEY);
      expect(edition.storageKeyForServer(42)).toBe(edition.STORAGE_KEY);
    });
  });

  describe('isLanaOne', () => {
    test('true only for the lana_one edition string', () => {
      expect(edition.isLanaOne('lana_one')).toBe(true);
      expect(edition.isLanaOne('lana_ai')).toBe(false);
      expect(edition.isLanaOne(null)).toBe(false);
      expect(edition.isLanaOne('')).toBe(false);
    });
  });

  describe('createEditionResolver', () => {
    function makeStorage(initial) {
      const store = Object.assign({}, initial);
      return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = v; },
        _store: store
      };
    }

    test('resolves from fetchStatus and persists the result', async () => {
      const storage = makeStorage();
      const fetchStatus = jest.fn().mockResolvedValue({ status: 'ok', edition: 'lana_one' });
      const r = edition.createEditionResolver({ fetchStatus, storage });

      await expect(r.getEdition()).resolves.toBe('lana_one');
      expect(storage._store[edition.STORAGE_KEY]).toBe('lana_one');
      expect(r.peekEdition()).toBe('lana_one');
    });

    test('memoizes: fetchStatus is called once across calls', async () => {
      const fetchStatus = jest.fn().mockResolvedValue({ edition: 'lana_ai' });
      const r = edition.createEditionResolver({ fetchStatus, storage: null });

      await Promise.all([r.getEdition(), r.getEdition()]);
      await r.getEdition();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });

    test('uses a valid stored edition without fetching', async () => {
      const storage = makeStorage({ [edition.STORAGE_KEY]: 'lana_one' });
      const fetchStatus = jest.fn();
      const r = edition.createEditionResolver({ fetchStatus, storage });

      await expect(r.getEdition()).resolves.toBe('lana_one');
      expect(fetchStatus).not.toHaveBeenCalled();
    });

    test('ignores garbage in storage and fetches instead', async () => {
      const storage = makeStorage({ [edition.STORAGE_KEY]: 'business' });
      const fetchStatus = jest.fn().mockResolvedValue({ edition: 'lana_ai' });
      const r = edition.createEditionResolver({ fetchStatus, storage });

      await expect(r.getEdition()).resolves.toBe('lana_ai');
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });

    test('fetch failure resolves fail-safe lana_ai and is NOT persisted', async () => {
      const storage = makeStorage();
      const fetchStatus = jest.fn().mockRejectedValue(new Error('offline'));
      const r = edition.createEditionResolver({ fetchStatus, storage });

      await expect(r.getEdition()).resolves.toBe('lana_ai');
      expect(edition.STORAGE_KEY in storage._store).toBe(false);
      expect(r.peekEdition()).toBe(null);

      // Recovers on the next call once the backend is reachable.
      fetchStatus.mockResolvedValue({ edition: 'lana_one' });
      await expect(r.getEdition()).resolves.toBe('lana_one');
    });

    test('missing fetchStatus resolves fail-safe lana_ai', async () => {
      const r = edition.createEditionResolver({ storage: null });
      await expect(r.getEdition()).resolves.toBe('lana_ai');
    });

    test('storage that throws is tolerated', async () => {
      const storage = {
        getItem: () => { throw new Error('denied'); },
        setItem: () => { throw new Error('denied'); }
      };
      const fetchStatus = jest.fn().mockResolvedValue({ edition: 'lana_one' });
      const r = edition.createEditionResolver({ fetchStatus, storage });
      await expect(r.getEdition()).resolves.toBe('lana_one');
    });

    test('success WITHOUT edition fields resolves lana_ai for the session but is NOT persisted', async () => {
      const storage = makeStorage();
      const fetchStatus = jest.fn().mockResolvedValue({ status: 'ok' });
      const r = edition.createEditionResolver({ fetchStatus, storage });

      await expect(r.getEdition()).resolves.toBe('lana_ai');
      expect(Object.keys(storage._store)).toEqual([]);
      // Session memo holds, no refetch within this resolver.
      await expect(r.getEdition()).resolves.toBe('lana_ai');
      expect(fetchStatus).toHaveBeenCalledTimes(1);

      // A fresh resolver (next page load) asks the backend again instead of
      // being pinned to a cached lana_ai.
      const fetchStatus2 = jest.fn().mockResolvedValue({ edition: 'lana_one' });
      const r2 = edition.createEditionResolver({ fetchStatus: fetchStatus2, storage });
      await expect(r2.getEdition()).resolves.toBe('lana_one');
      expect(fetchStatus2).toHaveBeenCalledTimes(1);
    });

    test('backend switch does not reuse the other server\'s cached edition', async () => {
      const storage = makeStorage();
      const keyA = edition.storageKeyForServer('https://a.example.com');
      const keyB = edition.storageKeyForServer('https://b.example.com');

      // Server A resolves and caches lana_one under its own key.
      const fetchA = jest.fn().mockResolvedValue({ edition: 'lana_one' });
      const rA = edition.createEditionResolver({ fetchStatus: fetchA, storage, storageKey: keyA });
      await expect(rA.getEdition()).resolves.toBe('lana_one');
      expect(storage._store[keyA]).toBe('lana_one');

      // Switching to server B must fetch B's edition, not reuse A's cache.
      const fetchB = jest.fn().mockResolvedValue({ edition: 'lana_ai' });
      const rB = edition.createEditionResolver({ fetchStatus: fetchB, storage, storageKey: keyB });
      await expect(rB.getEdition()).resolves.toBe('lana_ai');
      expect(fetchB).toHaveBeenCalledTimes(1);
      expect(storage._store[keyB]).toBe('lana_ai');
      // A's cache stays intact under its own key.
      expect(storage._store[keyA]).toBe('lana_one');
    });

    test('storageKey may be a lazy function; invalid values fall back to the global key', async () => {
      const storage = makeStorage();
      const fetchStatus = jest.fn().mockResolvedValue({ edition: 'lana_one' });
      const r = edition.createEditionResolver({
        fetchStatus,
        storage,
        storageKey: () => edition.storageKeyForServer('https://c.example.com')
      });
      await expect(r.getEdition()).resolves.toBe('lana_one');
      expect(storage._store[edition.storageKeyForServer('https://c.example.com')]).toBe('lana_one');

      const rBad = edition.createEditionResolver({
        fetchStatus: jest.fn().mockResolvedValue({ edition: 'lana_ai' }),
        storage,
        storageKey: () => { throw new Error('no localStorage'); }
      });
      await expect(rBad.getEdition()).resolves.toBe('lana_ai');
      expect(storage._store[edition.STORAGE_KEY]).toBe('lana_ai');
    });
  });
});

describe('pricing-tiers tiersForEdition (edition-aware plan offering)', () => {
  test('LANA AI edition returns the full list unchanged (zero-change rule)', () => {
    const out = pricing.tiersForEdition('lana_ai');
    expect(out.map((t) => t.key)).toEqual(pricing.TIERS.map((t) => t.key));
  });

  test('unknown/missing edition behaves like LANA AI (fail-safe)', () => {
    expect(pricing.tiersForEdition(null).length).toBe(pricing.TIERS.length);
    expect(pricing.tiersForEdition(undefined).length).toBe(pricing.TIERS.length);
    expect(pricing.tiersForEdition('weird').length).toBe(pricing.TIERS.length);
  });

  test('LANA One edition offers only the Free/Pro/Max ladder', () => {
    const out = pricing.tiersForEdition('lana_one');
    expect(out.map((t) => t.key)).toEqual(['free', 'pro', 'max']);
  });

  test('LANA One edition filters out business/org tiers added later', () => {
    const withBusiness = pricing.TIERS.concat([
      { key: 'business_plus', name: 'Business Plus' },
      { key: 'enterprise', name: 'Enterprise' }
    ]);

    const one = pricing.tiersForEdition('lana_one', withBusiness);
    expect(one.map((t) => t.key)).toEqual(['free', 'pro', 'max']);

    // ...while LANA AI would offer them.
    const ai = pricing.tiersForEdition('lana_ai', withBusiness);
    expect(ai.map((t) => t.key)).toContain('business_plus');
    expect(ai.map((t) => t.key)).toContain('enterprise');
  });

  test('edition casing/whitespace is tolerated', () => {
    expect(pricing.tiersForEdition(' LANA_ONE ').map((t) => t.key)).toEqual(['free', 'pro', 'max']);
  });

  test('returns a copy, never the TIERS array itself', () => {
    expect(pricing.tiersForEdition('lana_ai')).not.toBe(pricing.TIERS);
  });

  test('graduate CTA destination is exported for the billing page', () => {
    expect(typeof pricing.GRADUATE_TO_BUSINESS_URL).toBe('string');
    expect(pricing.GRADUATE_TO_BUSINESS_URL.length).toBeGreaterThan(0);
  });
});
