/**
 * LANA onboarding state store.
 *
 * Onboarding status is saved on this device only (product decision: it does
 * not need to live in the database). The record is keyed per user so people
 * sharing a computer do not see each other's progress. If storage is blocked,
 * the tour still runs for the session; it just cannot remember the result.
 *
 * The storage object is injected so this module is unit tested without a
 * browser (tests/unit/onboarding-state.test.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LanaOnboardingState = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_PREFIX = 'lana.onboarding.';

  /**
   * @param {Object} deps
   * @param {Storage|null} deps.storage  localStorage, or null when unavailable
   * @param {string} deps.userId
   */
  function createOnboardingStore(deps) {
    const storage = deps.storage || null;
    const key = STORAGE_PREFIX + (deps.userId || 'anonymous');

    return {
      /** Saved state, or null for a user who has never seen the tour on this device. */
      load() {
        if (!storage) return null;
        try {
          const saved = JSON.parse(storage.getItem(key));
          return saved && typeof saved === 'object' ? saved : null;
        } catch (e) {
          return null;
        }
      },

      /** Returns false when storage is unavailable or full. */
      save(state) {
        if (!storage) return false;
        try {
          storage.setItem(key, JSON.stringify(state));
          return true;
        } catch (e) {
          return false;
        }
      },
    };
  }

  return { createOnboardingStore, STORAGE_PREFIX };
});
