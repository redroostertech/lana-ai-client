/**
 * Unit tests for resolvePlanGridState (billing page plan grid).
 *
 * Guardrail under test: whether the grid may offer plan changes keys on GRID
 * MEMBERSHIP of the account's CURRENT tier (exact card key, after enumerated
 * alias normalization), never on rank and never on the edition. A tier with
 * no card in the offered grid (e.g. a business_plus org signed into a LANA
 * One binary) must lock the grid: no card marked current, no live checkout
 * CTAs that could downgrade or double-subscribe the org.
 */

const path = require('path');

const pricing = require(path.join(
  __dirname,
  '../../src/js/billing/pricing-tiers.js'
));

const LANA_ONE_GRID = pricing.tiersForEdition('lana_one');

describe('pricing.resolvePlanGridState', () => {
  describe('current tier present in the grid (unlocked)', () => {
    test.each(['free', 'pro', 'max'])('exact key %s is current, not locked', (key) => {
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, key))
        .toEqual({ currentKey: key, locked: false });
    });

    test('enumerated aliases map to their card key (plus/edge -> pro, solo/demo -> free)', () => {
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'plus'))
        .toEqual({ currentKey: 'pro', locked: false });
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'edge'))
        .toEqual({ currentKey: 'pro', locked: false });
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'solo'))
        .toEqual({ currentKey: 'free', locked: false });
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'demo'))
        .toEqual({ currentKey: 'free', locked: false });
    });

    test('casing and whitespace are tolerated', () => {
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, '  PRO  '))
        .toEqual({ currentKey: 'pro', locked: false });
    });

    test('the LANA-AI/business org tier "professional" locks the grid, not masked to free', () => {
      // A LANA One individual's tier is now authoritative via the profile's
      // effective_tier (Free/Pro/Max, stamped from the cloud plan at adopt), so
      // we no longer mask "professional" -> free. A genuine business/org tier
      // must LOCK the grid ("Managed on LANA AI") rather than show the individual
      // ladder and risk a downgrade/double-subscribe.
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'professional'))
        .toEqual({ currentKey: null, locked: true });
    });
  });

  describe('current tier absent from the grid (locked)', () => {
    test('business_plus locks the grid instead of collapsing to free by rank', () => {
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'business_plus'))
        .toEqual({ currentKey: null, locked: true });
    });

    test('any tier without a card locks, protecting future absent tiers', () => {
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'enterprise'))
        .toEqual({ currentKey: null, locked: true });
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'pro_5x'))
        .toEqual({ currentKey: null, locked: true });
      // spark ranks between free and pro but has no card, so it locks too:
      // grid membership only, never rank.
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 'spark'))
        .toEqual({ currentKey: null, locked: true });
    });

    test('locking is edition-independent: same tier locks the full LANA AI grid too', () => {
      const fullGrid = pricing.tiersForEdition('lana_ai');
      expect(pricing.resolvePlanGridState(fullGrid, 'business_plus'))
        .toEqual({ currentKey: null, locked: true });
    });

    test('a grid that DOES carry the tier unlocks it, regardless of edition semantics', () => {
      const withBusiness = pricing.TIERS.concat([{ key: 'business_plus', name: 'Business Plus' }]);
      expect(pricing.resolvePlanGridState(withBusiness, 'business_plus'))
        .toEqual({ currentKey: 'business_plus', locked: false });
    });
  });

  describe('malformed inputs fail closed', () => {
    test('missing/invalid current tier locks (never a false current card)', () => {
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, null))
        .toEqual({ currentKey: null, locked: true });
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, undefined))
        .toEqual({ currentKey: null, locked: true });
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, 42))
        .toEqual({ currentKey: null, locked: true });
      expect(pricing.resolvePlanGridState(LANA_ONE_GRID, ''))
        .toEqual({ currentKey: null, locked: true });
    });

    test('missing/invalid offered list locks', () => {
      expect(pricing.resolvePlanGridState(null, 'pro'))
        .toEqual({ currentKey: null, locked: true });
      expect(pricing.resolvePlanGridState([null, undefined], 'pro'))
        .toEqual({ currentKey: null, locked: true });
    });
  });
});

describe('pricing.canonicalTierKey', () => {
  test('normalizes enumerated aliases only', () => {
    expect(pricing.canonicalTierKey('plus')).toBe('pro');
    expect(pricing.canonicalTierKey('edge')).toBe('pro');
    expect(pricing.canonicalTierKey('solo')).toBe('free');
    expect(pricing.canonicalTierKey('demo')).toBe('free');
    // "professional" is no longer masked to free: a real business/org tier stays
    // unmapped so the grid locks (individual tier now flows via effective_tier).
    expect(pricing.canonicalTierKey('professional')).toBe('professional');
  });

  test('unknown tiers pass through unchanged (no rank collapse)', () => {
    expect(pricing.canonicalTierKey('business_plus')).toBe('business_plus');
    expect(pricing.canonicalTierKey('max')).toBe('max');
    // enterprise is intentionally NOT aliased -> stays unknown -> grid locks.
    expect(pricing.canonicalTierKey('enterprise')).toBe('enterprise');
  });

  test('non-strings become the empty string', () => {
    expect(pricing.canonicalTierKey(null)).toBe('');
    expect(pricing.canonicalTierKey(7)).toBe('');
  });
});
