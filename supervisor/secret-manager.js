/**
 * secret-manager.js
 *
 * Generates and persists the per-install secrets the LANA One sovereign stack
 * needs to boot. The Node backend fails closed (process.exit(1)) unless these are
 * set to non-default values; the same values must be shared consistently across
 * Postgres, MinIO, and the backend. They are generated ONCE on first launch and
 * reused every launch after (a stable JWT_SECRET is essential — a fresh one would
 * invalidate the user's existing local session).
 *
 * Backed by any async { get, set } store; in the app that's KeychainSecretStore
 * (OS-keychain-encrypted, 0600, in-memory fallback). The store is injected so this
 * module is unit-testable without Electron.
 */
'use strict';

const crypto = require('crypto');

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

// key -> generator. Formats mirror the values the backend already accepts:
// 32-byte hex for the crypto keys; shorter random for pg/minio credentials.
// All are DSN/CLI-safe (hex + a lana prefix), so no escaping is needed downstream.
const SECRET_SPECS = Object.freeze({
  POSTGRES_PASSWORD: () => hex(16),               // 32 chars, alphanumeric (DSN-safe)
  MINIO_ACCESS_KEY: () => 'lana' + hex(8),        // 20 chars, >= minio's 3-char floor
  MINIO_SECRET_KEY: () => hex(20),                // 40 chars, >= minio's 8-char floor
  JWT_SECRET: () => hex(32),                       // 64 chars (32 bytes)
  MFA_ENCRYPTION_KEY: () => hex(32),               // 64 chars (32 bytes)
  WEBHOOK_SECRET_ENCRYPTION_KEY: () => hex(32),    // 64 chars (32 bytes)
  FILE_ENCRYPTION_KEY: () => hex(32),              // 64 chars (32 bytes) — document envelope/at-rest encryption
  CONNECTOR_ENCRYPTION_KEY: () => hex(32),         // 64 chars (32 bytes) — connector OAuth token encryption
  INTERNAL_SERVICE_SECRET: () => hex(32),          // 64 chars — authenticates the backend->redactor sidecar hop
});

const SECRET_KEYS = Object.freeze(Object.keys(SECRET_SPECS));

class SecretManager {
  /**
   * @param {object} deps
   * @param {{get: function, set: function}} deps.store - async get(key)/set(key,value)
   * @param {object} [deps.logger]
   */
  constructor({ store, logger } = {}) {
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
      throw new Error('SecretManager requires a store with async get/set');
    }
    this._store = store;
    this._log = logger || { info() {}, warn() {}, error() {} };
  }

  /**
   * Return the full secret set, generating+persisting any that don't exist yet.
   * Idempotent and stable: existing values are never regenerated.
   * @returns {Promise<Object<string,string>>}
   */
  async ensureSecrets() {
    const out = {};
    let generated = 0;
    for (const key of SECRET_KEYS) {
      // eslint-disable-next-line no-await-in-loop
      let value = await this._store.get(key);
      if (!value) {
        value = SECRET_SPECS[key]();
        // eslint-disable-next-line no-await-in-loop
        await this._store.set(key, value);
        generated += 1;
      }
      out[key] = value;
    }
    if (generated > 0) {
      this._log.info(`[secrets] generated ${generated} new per-install secret(s)`);
    }
    return out;
  }
}

module.exports = { SecretManager, SECRET_KEYS };
