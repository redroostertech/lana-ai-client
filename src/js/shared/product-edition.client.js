/* ==========================================================================
   LANA One - Product edition (client-side mirror of src/config/product-edition.js)

   The backend exposes the edition as additive fields on the unauthenticated
   bootstrap endpoint GET /api/v1/system/status:

     { ..., edition: 'lana_one' | 'lana_ai', is_lana_one: boolean }

   This helper fetches that once, caches it (in memory + sessionStorage so the
   other standalone pages do not refetch), and hands the page a normalized
   edition string.

   CRITICAL GUARDRAIL - FORM FACTOR, NOT CAPABILITY. The edition describes the
   DISTRIBUTION only. It may decide WHICH PLANS ARE OFFERED, branding, and the
   "graduate to Business" affordance. It must NEVER gate what a signed-in
   account can DO - capability UI keys off the account entitlement (the org
   tier / plan data the backend returns), so an org that upgrades to a business
   plan on the same binary just unlocks. Never write
   `if (isLanaOne) hideFeature()`.

   FAIL-SAFE DEFAULT: anything missing, malformed, or unreachable resolves to
   'lana_ai' (the base business edition), matching the backend module. Failed
   lookups are NOT persisted, so a transient outage cannot pin the wrong
   edition for the session. Likewise a SUCCESSFUL status response that does
   not carry the edition fields (older backend, demo mode) resolves 'lana_ai'
   for this session only and is NOT persisted.

   PER-BACKEND CACHE: the Electron client can switch backends at runtime (see
   client/src/js/api.js and localStorage 'lana_saved_server'), so the cached
   edition is scoped per server: 'lana.product_edition:<serverUrl>'. With no
   saved server the unscoped global key is the fallback. This keeps one
   backend's edition from leaking to another after a switch.

   No em dashes in user-facing copy. Icons come from the Lex icon set (never
   emoji).
   ========================================================================== */

(function () {
  'use strict';

  var EDITION_LANA_ONE = 'lana_one';
  var EDITION_LANA_AI = 'lana_ai';
  var STORAGE_KEY = 'lana.product_edition';

  // Same localStorage key api.js uses for the active backend; the edition
  // cache is scoped by it so switching servers never reuses a stale edition.
  var SAVED_SERVER_KEY = 'lana_saved_server';

  // Normalize any raw value to a valid edition string. Fail-safe: 'lana_ai'.
  function normalizeEdition(raw) {
    if (typeof raw !== 'string') return EDITION_LANA_AI;
    return raw.trim().toLowerCase() === EDITION_LANA_ONE
      ? EDITION_LANA_ONE
      : EDITION_LANA_AI;
  }

  // Extract the edition from a /api/v1/system/status style payload.
  // Prefers the explicit `edition` string; falls back to `is_lana_one`
  // (boolean only). Returns the edition string ONLY when the payload actually
  // carries an edition field of the right type; returns null when the fields
  // are absent or of the wrong type, so callers can fail safe to 'lana_ai'
  // for the session WITHOUT persisting (an older backend or demo mode must
  // not pin 'lana_ai' into the cache).
  function editionFromStatus(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.edition === 'string') return normalizeEdition(payload.edition);
    if (payload.is_lana_one === true) return EDITION_LANA_ONE;
    if (payload.is_lana_one === false) return EDITION_LANA_AI;
    return null;
  }

  // Storage key scoped to a backend server URL. Empty/missing server falls
  // back to the unscoped global key.
  function storageKeyForServer(serverUrl) {
    if (typeof serverUrl !== 'string' || serverUrl === '') return STORAGE_KEY;
    return STORAGE_KEY + ':' + serverUrl;
  }

  function isLanaOne(edition) {
    return normalizeEdition(edition) === EDITION_LANA_ONE;
  }

  // Build a resolver around injectable deps (pure wiring; unit-testable).
  //   deps.fetchStatus : function() -> Promise<statusPayload>
  //   deps.storage     : { getItem(k), setItem(k, v) } or null
  //   deps.storageKey  : string, or function() -> string, naming the cache
  //                      slot (per-backend scoping); default STORAGE_KEY
  function createEditionResolver(deps) {
    var fetchStatus = deps && deps.fetchStatus;
    var storage = (deps && deps.storage) || null;
    var storageKeyOpt = (deps && deps.storageKey) || STORAGE_KEY;
    var memo = null;        // resolved edition string, once known
    var pending = null;     // in-flight promise, to coalesce callers

    // Resolve the cache key lazily so a saved-server change between page
    // interactions is picked up. Anything invalid falls back to the global key.
    function currentStorageKey() {
      try {
        var k = (typeof storageKeyOpt === 'function') ? storageKeyOpt() : storageKeyOpt;
        return (typeof k === 'string' && k !== '') ? k : STORAGE_KEY;
      } catch (e) {
        return STORAGE_KEY;
      }
    }

    function readStored() {
      if (!storage) return null;
      try {
        var v = storage.getItem(currentStorageKey());
        // Only trust exact known values; anything else is ignored.
        return (v === EDITION_LANA_ONE || v === EDITION_LANA_AI) ? v : null;
      } catch (e) {
        return null;
      }
    }

    function writeStored(edition) {
      if (!storage) return;
      try { storage.setItem(currentStorageKey(), edition); } catch (e) { /* best effort */ }
    }

    // Synchronous peek: memo, then sessionStorage, else null (unknown).
    function peekEdition() {
      if (memo) return memo;
      var stored = readStored();
      if (stored) memo = stored;
      return memo;
    }

    // Resolve the edition. Never rejects; failures resolve to 'lana_ai'
    // (fail-safe) without persisting, so the next page load retries.
    function getEdition() {
      var known = peekEdition();
      if (known) return Promise.resolve(known);
      if (pending) return pending;
      if (typeof fetchStatus !== 'function') return Promise.resolve(EDITION_LANA_AI);

      pending = Promise.resolve()
        .then(function () { return fetchStatus(); })
        .then(function (payload) {
          var carried = editionFromStatus(payload);
          // Persist ONLY when the response actually carried an edition field;
          // a success without it resolves 'lana_ai' for this session but is
          // not cached, so the next page load asks again.
          memo = carried || EDITION_LANA_AI;
          if (carried) writeStored(carried);
          pending = null;
          return memo;
        })
        .catch(function () {
          pending = null;
          return EDITION_LANA_AI;
        });
      return pending;
    }

    return {
      getEdition: getEdition,
      peekEdition: peekEdition
    };
  }

  // ── Browser singleton ────────────────────────────────────────────────────
  var api = {
    EDITION_LANA_ONE: EDITION_LANA_ONE,
    EDITION_LANA_AI: EDITION_LANA_AI,
    STORAGE_KEY: STORAGE_KEY,
    SAVED_SERVER_KEY: SAVED_SERVER_KEY,
    normalizeEdition: normalizeEdition,
    editionFromStatus: editionFromStatus,
    storageKeyForServer: storageKeyForServer,
    isLanaOne: isLanaOne,
    createEditionResolver: createEditionResolver
  };

  if (typeof window !== 'undefined') {
    var resolver = createEditionResolver({
      fetchStatus: function () {
        // Unauthenticated bootstrap endpoint; works pre- and post-login.
        return window.api.get('/api/v1/system/status');
      },
      storage: (function () {
        try { return window.sessionStorage || null; } catch (e) { return null; }
      })(),
      // Scope the cache to the active backend, read from the SAME source
      // api.js uses ('lana_saved_server' in localStorage). If that is
      // unavailable or unparseable, fall back to the unscoped global key.
      storageKey: function () {
        try {
          var raw = window.localStorage ? window.localStorage.getItem(SAVED_SERVER_KEY) : null;
          if (raw) {
            var info = JSON.parse(raw);
            if (info && typeof info.url === 'string') {
              return storageKeyForServer(info.url);
            }
          }
        } catch (e) { /* fall through to the global key */ }
        return STORAGE_KEY;
      }
    });
    api.getEdition = resolver.getEdition;
    api.peekEdition = resolver.peekEdition;
    window.LanaProductEdition = api;
  }

  // Export for module usage (unit tests)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

})();
