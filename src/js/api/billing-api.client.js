/* ==========================================================================
   LANA One - Billing API client (thin wrapper over window.api)

   READ endpoints below are REAL and exist in the LANA One backend today:
     GET /api/v1/users/me/profile   -> current user + org (profile.routes L23)
     GET /api/v1/storage/usage      -> storage quota (storage-v2.routes L1615)

   WRITE / checkout endpoints (checkout-session, portal) do NOT exist in the
   LOCAL LANA One backend. Purchases live on the ACCOUNT PLANE (the lana-gpt
   web app, one.lanaai.io): under the LANA One edition, startCheckout and
   openPortal open the SYSTEM BROWSER at the account plane's Plan and billing
   page, where the user signs in and completes Stripe checkout / portal in the
   existing web flow. In-app checkout arrives later with the cloud-auth arc.

   EDITION GUARDRAIL (form factor, not capability): the edition only decides
   WHERE the purchase surface lives (LANA One buys on the account plane; the
   base LANA AI edition keeps calling its own backend's billing routes). It
   never gates what a signed-in account can DO. When the edition is unknown
   (not yet resolved), we fail safe to the LANA AI path: the local backend
   404s, and the caller shows the existing "billing not available yet" banner.
   The same banner is the fallback when window.open is blocked - never invent
   success, and never navigate the app itself (no window.location fallback),
   matching the graduate CTA pattern in pages/billing.js.

   Tier resolution: the LANA One profile now returns `effective_tier` (the
   resolved canonical tier, stamped from the cloud plan at adopt) plus the raw
   `plan_tier`. We prefer `effective_tier`, then fall back defensively through
   plan_tier || plan || tier, else 'free'. This mirrors effectiveTier() in
   src/shared/entitlements/plan-gate.js.
   ========================================================================== */

(function () {
  'use strict';

  // Account plane Plan and billing page (lana-gpt web app). /billing is the
  // real Next.js route (apps/web/app/billing/page.tsx): current plan, plan
  // cards with upgrade CTAs (Stripe checkout) and the Manage button (Stripe
  // portal). Logged-out visitors are redirected to the sign-in landing first.
  // The legacy host (gpt.lanaai.io) 308-redirects here preserving the path.
  var ACCOUNT_PLANE_BILLING_URL = 'https://one.lanaai.io/billing';

  function api() {
    return window.api;
  }

  // Is this error the backend telling us "route not built yet"?
  function isNotImplemented(err) {
    if (!err) return false;
    var status = err.status || (err.response && err.response.status) || 0;
    return status === 404 || status === 501 || status === 405;
  }

  // Resolve effective tier from a profile/org object. Prefers the backend's
  // resolved `effective_tier` (stamped from the cloud plan at adopt), then falls
  // back through the raw plan-ish fields. Fails to 'free'.
  function resolveTier(profile) {
    if (!profile || typeof profile !== 'object') return 'free';
    var org = profile.org || profile.organization || profile;
    var candidate = profile.effective_tier ||
                    org.plan_tier || org.plan || org.tier ||
                    profile.plan_tier || profile.plan || profile.tier || null;
    return (candidate && typeof candidate === 'string') ? candidate : 'free';
  }

  // ── Account plane handoff (LANA One edition) ──────────────────────────

  // True when the RESOLVED edition is LANA One. Reads the synchronous peek
  // (memo/sessionStorage) so this never blocks; an unknown/unresolved edition
  // returns false (fail safe: the LANA AI local-backend path).
  function editionIsLanaOne() {
    if (typeof window === 'undefined') return false;
    var E = window.LanaProductEdition;
    if (!E || typeof E.peekEdition !== 'function' ||
        typeof E.isLanaOne !== 'function') return false;
    var peeked = E.peekEdition();
    return !!peeked && E.isLanaOne(peeked);
  }

  // ASYNC edition check for the checkout/portal path decision. The synchronous
  // peek above false-negatives on a COLD first click: before GET /system/status
  // has resolved, peekEdition() is null, so a genuine LANA One install would
  // take the LANA AI local-POST path and 404. Here we AWAIT the async resolver
  // (getEdition) so the path is decided on the RESOLVED edition. getEdition
  // never rejects (it resolves 'lana_ai' on failure), but we still fall back to
  // the synchronous peek when getEdition is absent or the promise rejects, so
  // the guardrail is preserved (unknown edition -> LANA AI local path).
  function resolveEditionIsLanaOne() {
    if (typeof window === 'undefined') return Promise.resolve(false);
    var E = window.LanaProductEdition;
    if (!E || typeof E.isLanaOne !== 'function') return Promise.resolve(false);
    if (typeof E.getEdition !== 'function') {
      return Promise.resolve(editionIsLanaOne());
    }
    return Promise.resolve()
      .then(function () { return E.getEdition(); })
      .then(function (edition) { return !!edition && E.isLanaOne(edition); })
      .catch(function () { return editionIsLanaOne(); });
  }

  // Open the account plane billing page in the system browser. Returns a
  // typed result the caller can branch on: { external: true, opened: boolean,
  // url } - opened=false means nothing opened and the caller should fall back
  // to the fail-closed "billing unavailable" banner.
  //
  // In the Electron shell we go through the preload bridge
  // (window.electronAPI.openExternal -> shell.openExternal): the shell's
  // window-open handler DENIES window.open for http(s) URLs (it still opens
  // the browser but returns null), so window.open would false-negative there.
  // Outside Electron we use the same safe window.open pattern as the graduate
  // CTA (pages/billing.js): new window only, noopener, NO window.location
  // fallback. `opener` is injectable for unit tests.
  function openAccountPlaneBilling(opener) {
    if (!opener && typeof window !== 'undefined' && window.electronAPI &&
        typeof window.electronAPI.openExternal === 'function') {
      var pending = window.electronAPI.openExternal(ACCOUNT_PLANE_BILLING_URL);
      if (pending && typeof pending.catch === 'function') {
        pending.catch(function () {
          console.warn('[Billing] Could not open the system browser:',
                       ACCOUNT_PLANE_BILLING_URL);
        });
      }
      return { external: true, opened: true, url: ACCOUNT_PLANE_BILLING_URL };
    }
    var open = opener;
    if (!open && typeof window !== 'undefined' &&
        typeof window.open === 'function') {
      open = function (u, target, features) {
        return window.open(u, target, features);
      };
    }
    var win = open ? open(ACCOUNT_PLANE_BILLING_URL, '_blank', 'noopener') : null;
    if (!win) {
      console.warn('[Billing] Popup blocked; account plane billing not opened:',
                   ACCOUNT_PLANE_BILLING_URL);
    }
    return { external: true, opened: !!win, url: ACCOUNT_PLANE_BILLING_URL };
  }

  var BillingApi = {

    ACCOUNT_PLANE_BILLING_URL: ACCOUNT_PLANE_BILLING_URL,

    // ── Reads (real endpoints) ──────────────────────────────────────────

    // Current user profile (includes org fields when present).
    getProfile: function () {
      return api().get('/api/v1/users/me/profile');
    },

    // Storage usage/quota. Real endpoint; returns
    // { organization_id, used_bytes, total_bytes, percentage_used,
    //   used_formatted, total_formatted }.
    getStorageUsage: function () {
      return api().get('/api/v1/storage/usage');
    },

    resolveTier: resolveTier,
    isNotImplemented: isNotImplemented,
    editionIsLanaOne: editionIsLanaOne,
    resolveEditionIsLanaOne: resolveEditionIsLanaOne,
    openAccountPlaneBilling: openAccountPlaneBilling,

    // ── Writes (checkout / portal) ──────────────────────────────────────

    // Start an upgrade to `plan`. LANA One edition: hand off to the account
    // plane in the system browser (resolves { external, opened, url }; the
    // plan is chosen again on the account plane's billing page). Otherwise:
    // POST the conventional billing route; on success the backend returns
    // { url } and the caller redirects there. Throws on real errors; the
    // caller should branch on BillingApi.isNotImplemented(err).
    startCheckout: function (plan, seats) {
      return resolveEditionIsLanaOne().then(function (isOne) {
        if (isOne) {
          return openAccountPlaneBilling();
        }
        var body = { plan: plan, seats: Math.max(1, Math.floor(seats || 1)) };
        return api().post('/api/v1/billing/checkout-session', body);
      });
    },

    // Open the billing portal (manage/cancel). LANA One edition: same account
    // plane handoff as startCheckout (the portal lives behind the account
    // plane's Manage button). Otherwise the backend returns { url }.
    openPortal: function () {
      return resolveEditionIsLanaOne().then(function (isOne) {
        if (isOne) {
          return openAccountPlaneBilling();
        }
        return api().post('/api/v1/billing/portal', {});
      });
    }
  };

  if (typeof window !== 'undefined') {
    window.LanaBillingApi = BillingApi;
  }

  // Export for module usage (unit tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillingApi;
  }

})();
