'use strict';

/**
 * OAuth state for connector callbacks (lana-ai://oauth/callback): CSRF protection.
 * A callback is accepted only with a state: one this app issued (once, within
 * STATE_TTL_MS) or the backend's own 64-hex state. A callback without a state is
 * refused, since any website can open the callback link.
 */

const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;
const BACKEND_STATE = /^[a-f0-9]{64}$/i;

function createOAuthStates({ now = () => Date.now(), randomHex = () => crypto.randomBytes(32).toString('hex') } = {}) {
  const pending = new Map();

  function prune() {
    for (const [key, at] of pending) {
      if (now() - at > STATE_TTL_MS) pending.delete(key);
    }
  }

  return {
    generate() {
      const state = randomHex();
      pending.set(state, now());
      prune();
      return state;
    },
    /** True only for a state this app issued (used up here) or the backend's own form. */
    acceptsCallback(state) {
      if (typeof state !== 'string' || !state.trim()) return false;
      if (pending.has(state)) {
        const at = pending.get(state);
        pending.delete(state);
        if (now() - at < STATE_TTL_MS) return true;
      }
      return BACKEND_STATE.test(state);
    }
  };
}

module.exports = { createOAuthStates, STATE_TTL_MS };
