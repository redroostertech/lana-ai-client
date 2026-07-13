/**
 * Unit tests for the billing API client's account-plane handoff.
 *
 * Under the LANA One edition there is no local checkout backend: startCheckout
 * and openPortal must open the SYSTEM BROWSER at the account plane's Plan and
 * billing page (same safe window.open pattern as the graduate CTA: new window
 * only, noopener, never a window.location fallback). When the popup is
 * blocked, the typed result lets the page fall back to the fail-closed
 * "billing unavailable" banner. Under the base LANA AI edition (or while the
 * edition is unknown) the conventional billing routes are still POSTed, so
 * nothing regresses.
 */

const path = require('path');

const billing = require(path.join(
  __dirname,
  '../../src/js/api/billing-api.client.js'
));

const ACCOUNT_URL = 'https://one.lanaai.io/billing';

function editionStub(peeked) {
  return {
    peekEdition: () => peeked,
    isLanaOne: (e) => e === 'lana_one'
  };
}

afterEach(() => {
  delete global.window;
});

describe('billing-api.client', () => {
  describe('ACCOUNT_PLANE_BILLING_URL', () => {
    test('points at the account plane Plan and billing page', () => {
      expect(billing.ACCOUNT_PLANE_BILLING_URL).toBe(ACCOUNT_URL);
    });
  });

  describe('editionIsLanaOne', () => {
    test('true only for a RESOLVED lana_one edition', () => {
      global.window = { LanaProductEdition: editionStub('lana_one') };
      expect(billing.editionIsLanaOne()).toBe(true);
    });

    test('false for lana_ai, unresolved (null), or a missing helper', () => {
      global.window = { LanaProductEdition: editionStub('lana_ai') };
      expect(billing.editionIsLanaOne()).toBe(false);

      global.window = { LanaProductEdition: editionStub(null) };
      expect(billing.editionIsLanaOne()).toBe(false);

      global.window = {};
      expect(billing.editionIsLanaOne()).toBe(false);

      delete global.window;
      expect(billing.editionIsLanaOne()).toBe(false);
    });
  });

  describe('openAccountPlaneBilling', () => {
    test('opens the account plane URL with the safe pattern (new window, noopener)', () => {
      const opener = jest.fn(() => ({}));
      const res = billing.openAccountPlaneBilling(opener);
      expect(opener).toHaveBeenCalledWith(ACCOUNT_URL, '_blank', 'noopener');
      expect(res).toEqual({ external: true, opened: true, url: ACCOUNT_URL });
    });

    test('reports opened=false when the popup is blocked (no location fallback)', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const opener = jest.fn(() => null);
      const res = billing.openAccountPlaneBilling(opener);
      expect(res).toEqual({ external: true, opened: false, url: ACCOUNT_URL });
      warn.mockRestore();
    });

    test('prefers the Electron preload bridge (shell.openExternal) when present', () => {
      const openExternal = jest.fn(() => Promise.resolve(true));
      const open = jest.fn(() => ({}));
      global.window = { electronAPI: { openExternal }, open };

      const res = billing.openAccountPlaneBilling();

      expect(openExternal).toHaveBeenCalledWith(ACCOUNT_URL);
      // window.open is DENIED by the shell's window-open handler (it returns
      // null even though the browser opens), so it must not be consulted.
      expect(open).not.toHaveBeenCalled();
      expect(res).toEqual({ external: true, opened: true, url: ACCOUNT_URL });
    });
  });

  describe('startCheckout', () => {
    test('LANA One edition: hands off to the browser, never POSTs locally', async () => {
      const post = jest.fn();
      const open = jest.fn(() => ({}));
      global.window = {
        LanaProductEdition: editionStub('lana_one'),
        api: { post },
        open
      };

      const res = await billing.startCheckout('max', 1);

      expect(res).toEqual({ external: true, opened: true, url: ACCOUNT_URL });
      expect(open).toHaveBeenCalledWith(ACCOUNT_URL, '_blank', 'noopener');
      expect(post).not.toHaveBeenCalled();
    });

    test('LANA One edition: blocked popup resolves opened=false (fail closed)', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      global.window = {
        LanaProductEdition: editionStub('lana_one'),
        api: { post: jest.fn() },
        open: jest.fn(() => null)
      };

      const res = await billing.startCheckout('pro', 1);

      expect(res.external).toBe(true);
      expect(res.opened).toBe(false);
      expect(global.window.api.post).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    test('LANA AI edition: POSTs the conventional checkout route unchanged', async () => {
      const post = jest.fn(() => Promise.resolve({ url: 'https://checkout.stripe.com/x' }));
      global.window = {
        LanaProductEdition: editionStub('lana_ai'),
        api: { post }
      };

      const res = await billing.startCheckout('business_plus', 5);

      expect(post).toHaveBeenCalledWith('/api/v1/billing/checkout-session', {
        plan: 'business_plus',
        seats: 5
      });
      expect(res).toEqual({ url: 'https://checkout.stripe.com/x' });
    });

    test('unknown edition fails safe to the local-backend path', async () => {
      const post = jest.fn(() => Promise.resolve({ url: 'u' }));
      global.window = {
        LanaProductEdition: editionStub(null),
        api: { post }
      };

      await billing.startCheckout('pro', 1);

      expect(post).toHaveBeenCalledWith('/api/v1/billing/checkout-session', {
        plan: 'pro',
        seats: 1
      });
    });

    test('COLD START: peek is null but async getEdition resolves lana_one -> handoff, never POSTs', async () => {
      // Regression: a cold first click before /system/status resolves. The sync
      // peek is null, but awaiting getEdition resolves 'lana_one', so the client
      // must take the account-plane handoff, not the LANA AI local-POST 404 path.
      const post = jest.fn();
      const open = jest.fn(() => ({}));
      global.window = {
        LanaProductEdition: {
          peekEdition: () => null, // not resolved yet at click time
          getEdition: () => Promise.resolve('lana_one'),
          isLanaOne: (e) => e === 'lana_one'
        },
        api: { post },
        open
      };

      const res = await billing.startCheckout('max', 1);

      expect(res).toEqual({ external: true, opened: true, url: ACCOUNT_URL });
      expect(open).toHaveBeenCalledWith(ACCOUNT_URL, '_blank', 'noopener');
      expect(post).not.toHaveBeenCalled();
    });

    test('COLD START: async getEdition resolves lana_ai -> POSTs the local route', async () => {
      const post = jest.fn(() => Promise.resolve({ url: 'https://checkout.stripe.com/x' }));
      global.window = {
        LanaProductEdition: {
          peekEdition: () => null,
          getEdition: () => Promise.resolve('lana_ai'),
          isLanaOne: (e) => e === 'lana_one'
        },
        api: { post }
      };

      await billing.startCheckout('pro', 1);

      expect(post).toHaveBeenCalledWith('/api/v1/billing/checkout-session', {
        plan: 'pro',
        seats: 1
      });
    });
  });

  describe('openPortal', () => {
    test('LANA One edition: same account plane handoff as checkout', async () => {
      const post = jest.fn();
      const open = jest.fn(() => ({}));
      global.window = {
        LanaProductEdition: editionStub('lana_one'),
        api: { post },
        open
      };

      const res = await billing.openPortal();

      expect(res).toEqual({ external: true, opened: true, url: ACCOUNT_URL });
      expect(post).not.toHaveBeenCalled();
    });

    test('LANA AI edition: POSTs the conventional portal route unchanged', async () => {
      const post = jest.fn(() => Promise.resolve({ url: 'https://billing.stripe.com/p' }));
      global.window = {
        LanaProductEdition: editionStub('lana_ai'),
        api: { post }
      };

      const res = await billing.openPortal();

      expect(post).toHaveBeenCalledWith('/api/v1/billing/portal', {});
      expect(res).toEqual({ url: 'https://billing.stripe.com/p' });
    });

    test('COLD START: async getEdition resolves lana_one -> account plane handoff, never POSTs', async () => {
      const post = jest.fn();
      const open = jest.fn(() => ({}));
      global.window = {
        LanaProductEdition: {
          peekEdition: () => null,
          getEdition: () => Promise.resolve('lana_one'),
          isLanaOne: (e) => e === 'lana_one'
        },
        api: { post },
        open
      };

      const res = await billing.openPortal();

      expect(res).toEqual({ external: true, opened: true, url: ACCOUNT_URL });
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('existing read helpers keep their contracts', () => {
    test('resolveTier reads plan-ish fields defensively and fails to free', () => {
      expect(billing.resolveTier({ org: { plan_tier: 'max' } })).toBe('max');
      expect(billing.resolveTier({ plan: 'pro' })).toBe('pro');
      expect(billing.resolveTier({})).toBe('free');
      expect(billing.resolveTier(null)).toBe('free');
    });

    test('isNotImplemented detects 404/501/405 shapes only', () => {
      expect(billing.isNotImplemented({ status: 404 })).toBe(true);
      expect(billing.isNotImplemented({ response: { status: 501 } })).toBe(true);
      expect(billing.isNotImplemented({ status: 500 })).toBe(false);
      expect(billing.isNotImplemented(null)).toBe(false);
    });
  });
});
