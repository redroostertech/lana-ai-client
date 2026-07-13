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
 *
 * SECRET TAXONOMY (P1 data-integrity)
 * -----------------------------------
 * Not every secret is equal. Two classes, marked on each spec via `class`:
 *
 *  - ENCRYPTION_CLASS: keys that ENCRYPT durable, user-owned data or authenticate
 *    live sessions. Regenerating one is NOT recoverable — it permanently orphans
 *    everything encrypted under the old key (or silently invalidates sessions):
 *      FILE_ENCRYPTION_KEY            (document envelope / at-rest encryption)
 *      CONNECTOR_ENCRYPTION_KEY       (connector OAuth token encryption)
 *      MFA_ENCRYPTION_KEY             (TOTP seed encryption)
 *      WEBHOOK_SECRET_ENCRYPTION_KEY  (webhook signing-secret encryption)
 *      JWT_SECRET                     (session signing — regen logs everyone out)
 *      INTERNAL_SERVICE_SECRET        (backend<->redactor auth)
 *    These MUST NOT be silently regenerated. If the store holds one it cannot
 *    decrypt, boot must FAIL LOUD (see electron-keychain-store.js) so the user can
 *    recover from a backup (see key-recovery.js) rather than lose their data.
 *
 *  - CREDENTIAL_CLASS: datastore credentials. Regenerating these is recoverable
 *    because the datastore is re-keyed to match on the next launch (Postgres ALTER
 *    ROLE, MinIO root creds re-applied):
 *      POSTGRES_PASSWORD, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
 */
'use strict';

const crypto = require('crypto');

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

// Secret classes. The keychain store treats ENCRYPTION_CLASS keys as protected:
// an undecryptable protected key is a blocking fault, never a silent regenerate.
const ENCRYPTION_CLASS = 'encryption';
const CREDENTIAL_CLASS = 'credential';

// key -> { gen, class }. Formats mirror the values the backend already accepts:
// 32-byte hex for the crypto keys; shorter random for pg/minio credentials.
// All are DSN/CLI-safe (hex + a lana prefix), so no escaping is needed downstream.
const SECRET_SPECS = Object.freeze({
  POSTGRES_PASSWORD: { gen: () => hex(16), class: CREDENTIAL_CLASS },               // 32 chars, alphanumeric (DSN-safe)
  MINIO_ACCESS_KEY: { gen: () => 'lana' + hex(8), class: CREDENTIAL_CLASS },        // 20 chars, >= minio's 3-char floor
  MINIO_SECRET_KEY: { gen: () => hex(20), class: CREDENTIAL_CLASS },                // 40 chars, >= minio's 8-char floor
  JWT_SECRET: { gen: () => hex(32), class: ENCRYPTION_CLASS },                      // 64 chars (32 bytes) — session signing
  MFA_ENCRYPTION_KEY: { gen: () => hex(32), class: ENCRYPTION_CLASS },              // 64 chars (32 bytes)
  WEBHOOK_SECRET_ENCRYPTION_KEY: { gen: () => hex(32), class: ENCRYPTION_CLASS },   // 64 chars (32 bytes)
  FILE_ENCRYPTION_KEY: { gen: () => hex(32), class: ENCRYPTION_CLASS },             // 64 chars (32 bytes) — document envelope/at-rest encryption
  CONNECTOR_ENCRYPTION_KEY: { gen: () => hex(32), class: ENCRYPTION_CLASS },        // 64 chars (32 bytes) — connector OAuth token encryption
  INTERNAL_SERVICE_SECRET: { gen: () => hex(32), class: ENCRYPTION_CLASS },         // 64 chars — authenticates the backend->redactor sidecar hop
});

const SECRET_KEYS = Object.freeze(Object.keys(SECRET_SPECS));

// The protected set the keychain store must fail-loud on rather than drop.
const ENCRYPTION_CLASS_KEYS = Object.freeze(
  SECRET_KEYS.filter((k) => SECRET_SPECS[k].class === ENCRYPTION_CLASS)
);
const CREDENTIAL_KEYS = Object.freeze(
  SECRET_KEYS.filter((k) => SECRET_SPECS[k].class === CREDENTIAL_CLASS)
);

/** True for keys whose regeneration is unrecoverable (data/session loss). */
function isEncryptionClassKey(key) {
  return !!SECRET_SPECS[key] && SECRET_SPECS[key].class === ENCRYPTION_CLASS;
}

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
   *
   * LOUD-FAIL CONTRACT: if the store holds an encryption-class key it cannot
   * return (undecryptable / lost keychain), its get(key) THROWS a
   * KeychainEncryptionUnavailableError (err.code === 'ENCRYPTION_KEY_UNAVAILABLE').
   * We deliberately do NOT catch it — regenerating an encryption-class key here
   * would orphan the user's encrypted data. The error propagates out of
   * ensureSecrets() so the supervisor/bootstrap can surface a blocking
   * "encryption key unavailable" state (and offer recovery) instead of re-keying.
   *
   * @returns {Promise<Object<string,string>>}
   */
  async ensureSecrets() {
    const out = {};
    let generated = 0;
    for (const key of SECRET_KEYS) {
      // eslint-disable-next-line no-await-in-loop
      let value = await this._store.get(key); // may throw for a lost protected key
      if (!value) {
        value = SECRET_SPECS[key].gen();
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

module.exports = {
  SecretManager,
  SECRET_KEYS,
  SECRET_SPECS,
  ENCRYPTION_CLASS,
  CREDENTIAL_CLASS,
  ENCRYPTION_CLASS_KEYS,
  CREDENTIAL_KEYS,
  isEncryptionClassKey,
};
