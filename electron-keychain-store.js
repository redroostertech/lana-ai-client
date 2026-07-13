/**
 * electron-keychain-store.js
 *
 * A durable secret store for the LANA One cloud-auth material, backed by
 * Electron's `safeStorage`. Ported from lana-gpt-desktop's keychain-secret-store.ts
 * (TypeScript) to CommonJS, adapted to the lana-ai-client thin-client.
 *
 * Design (mirrors the existing electron-storage.js pattern, but SEPARATE from it):
 *  - Secrets are encrypted per-value with safeStorage.encryptString (OS keychain
 *    on macOS, DPAPI on Windows, libsecret on Linux); the base64 ciphertext is
 *    persisted in a single 0600 JSON file under userData. Plaintext never hits disk.
 *  - If safeStorage is unavailable (headless CI, isEncryptionAvailable() false), we
 *    FALL BACK to an in-memory store so the app still boots, but we do NOT write
 *    plaintext secrets to disk. The fallback is per-process only.
 *
 * The concrete safeStorage is injectable (defaults to Electron's) so this file can
 * be unit-tested without a running Electron and node --check stays clean.
 *
 * ─── P1 DATA-INTEGRITY GUARD (loud-fail on lost encryption keys) ──────────────
 * Some secrets are ENCRYPTION-CLASS: regenerating them permanently orphans the
 * user's at-rest data (FILE_ENCRYPTION_KEY, CONNECTOR_ENCRYPTION_KEY, ...) or
 * silently invalidates sessions (JWT_SECRET). The taxonomy lives in
 * supervisor/secret-manager.js (`ENCRYPTION_CLASS_KEYS`).
 *
 * The old behavior silently DROPPED any value it could not decrypt (keychain
 * rotated, machine migration, safeStorage unavailable). Downstream, SecretManager
 * then regenerated a fresh key — turning a recoverable "we can't read your key"
 * into UNRECOVERABLE data loss, logged only at WARN.
 *
 * This store now treats a set of PROTECTED keys specially. When it finds a
 * protected key on disk that it cannot decrypt (or safeStorage is unavailable so
 * it cannot decrypt anything, yet a protected key is present on disk), it records
 * a BLOCKING FAULT:
 *   - logs at ERROR level: 'secret_store.encryption_key_unavailable'
 *   - exposes it via `store.encryptionFault` / `store.isSealed()`
 *   - and `get(protectedKey)` THROWS a distinct, catchable
 *     KeychainEncryptionUnavailableError (err.code === 'ENCRYPTION_KEY_UNAVAILABLE').
 * It never silently drops a protected key, so SecretManager can never regenerate
 * one behind the user's back.
 *
 * SUPERVISOR / BOOTSTRAP CONTRACT (consumed without editing this file's callers):
 *   1. bootstrap → SecretManager.ensureSecrets() → store.get(PROTECTED_KEY). If the
 *      key is lost, get() throws KeychainEncryptionUnavailableError; ensureSecrets
 *      does NOT catch it, so bootstrap.start() rejects with an error carrying
 *      err.code === 'ENCRYPTION_KEY_UNAVAILABLE' and err.keys (the affected keys).
 *      The supervisor should catch that code and surface a blocking
 *      "encryption key unavailable — your encrypted data cannot be read on this
 *      machine" state (offer recovery via key-recovery.js) instead of booting.
 *   2. Alternatively (before calling bootstrap), a caller can inspect
 *      `store.encryptionFault` — null when healthy, otherwise
 *      `{ keys: string[], reason: 'decrypt_failed' | 'safe_storage_unavailable' }`.
 *   3. Recovery: import a passphrase-wrapped bundle (see key-recovery.js),
 *      `restoreInto(store, ...)` the keys, construct a fresh store (fault clears
 *      once the keys decrypt), then proceed with ensureSecrets().
 *
 * The protected set defaults to the encryption-class keys from secret-manager, so
 * the guard is active for the stack-secrets store WITHOUT any caller change. It is
 * overridable via `opts.protectedKeys` (pass `[]` to opt out, e.g. a store that
 * holds only freely re-obtainable material).
 */

const { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { dirname, join } = require('path');

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Resolve Electron's safeStorage lazily so the module loads outside a running
 * Electron (e.g. node --check / unit tests that inject their own). */
function defaultSafeStorage() {
  try {
    // eslint-disable-next-line global-require
    return require('electron').safeStorage;
  } catch (_) {
    return null;
  }
}

/** The default protected (encryption-class) keys, sourced from secret-manager so
 * there is a single taxonomy. Lazily + defensively required: a load failure must
 * not break the store (it just falls back to "nothing protected"). */
function defaultProtectedKeys() {
  try {
    // eslint-disable-next-line global-require
    return require('./supervisor/secret-manager').ENCRYPTION_CLASS_KEYS || [];
  } catch (_) {
    return [];
  }
}

/**
 * Thrown when a protected (encryption-class) secret exists but cannot be read on
 * this machine. Distinct + catchable so the supervisor can branch on it.
 */
class KeychainEncryptionUnavailableError extends Error {
  constructor(keys, reason) {
    const list = Array.isArray(keys) ? keys : [keys];
    super(
      `encryption key unavailable — your encrypted data cannot be read on this machine `
      + `(keys: ${list.join(', ')}; reason: ${reason}). Restore from a recovery bundle `
      + `or the original machine's keychain; regenerating would orphan encrypted data.`
    );
    this.name = 'KeychainEncryptionUnavailableError';
    this.code = 'ENCRYPTION_KEY_UNAVAILABLE';
    this.keys = list;
    this.reason = reason; // 'decrypt_failed' | 'safe_storage_unavailable'
  }
}

/**
 * safeStorage-backed secret store with an encrypted on-disk file plus a clean
 * in-memory fallback when OS encryption is unavailable. Satisfies the
 * CloudKeychain seam: async get/set/delete.
 */
class KeychainSecretStore {
  #filePath;
  #safe;
  #log;
  #encryptionAvailable;
  #mem = new Map();
  #protectedKeys;
  #fault = null; // { keys: string[], reason: string } | null

  constructor(opts) {
    if (!opts || !opts.userDataRoot) {
      throw new Error('KeychainSecretStore: userDataRoot is required');
    }
    this.#filePath = join(opts.userDataRoot, opts.fileName || 'cloud-auth.enc.json');
    this.#safe = opts.safeStorage || defaultSafeStorage();
    this.#log = opts.logger || noopLogger;
    // opts.protectedKeys === [] opts out; undefined uses the secret-manager default.
    this.#protectedKeys = new Set(opts.protectedKeys || defaultProtectedKeys());

    let available = false;
    try {
      available = !!(this.#safe && this.#safe.isEncryptionAvailable());
    } catch (err) {
      this.#log.warn('secret_store.encryption_probe_failed', { error: errMsg(err) });
    }
    this.#encryptionAvailable = available;

    if (available) {
      this.#loadFromDisk();
    } else {
      this.#log.warn('secret_store.encryption_unavailable_using_memory_fallback', {});
      // The in-memory fallback cannot decrypt anything already on disk. If a
      // protected key is present on disk, proceeding would let SecretManager
      // regenerate it (silent data loss). Detect + fault instead.
      this.#faultOnUnreadableProtectedOnDisk('safe_storage_unavailable');
    }
  }

  async get(key) {
    if (this.#fault && this.#fault.keys.includes(key)) {
      throw new KeychainEncryptionUnavailableError([key], this.#fault.reason);
    }
    return this.#mem.has(key) ? this.#mem.get(key) : null;
  }

  async set(key, value, opts = {}) {
    // Overwriting a faulted key with a fresh value is exactly the silent-regen we
    // guard against; block it so a lost key can only be resolved via recovery.
    //
    // EXCEPTION — explicit restore: key-recovery.restoreInto passes
    // { restore: true } to write the ORIGINAL recovered value back into a sealed
    // key. That is the sanctioned way out of the fault, not a silent regen, so it is
    // allowed to overwrite in place. This closes the delete-then-set crash window
    // (no moment where the key is absent). The default (no opts) is unchanged.
    const restore = opts && opts.restore === true;
    if (!restore && this.#fault && this.#fault.keys.includes(key)) {
      throw new KeychainEncryptionUnavailableError([key], this.#fault.reason);
    }
    this.#mem.set(key, value);
    // An explicit restore clears the fault for this key (its value is now present and
    // will re-encrypt cleanly), in the same persist that writes it — atomic.
    if (restore && this.#fault && this.#fault.keys.includes(key)) {
      this.#fault.keys = this.#fault.keys.filter((k) => k !== key);
      if (this.#fault.keys.length === 0) this.#fault = null;
    }
    if (this.#encryptionAvailable) this.#persist();
  }

  async delete(key) {
    this.#mem.delete(key);
    if (this.#fault) {
      this.#fault.keys = this.#fault.keys.filter((k) => k !== key);
      if (this.#fault.keys.length === 0) this.#fault = null;
    }
    if (this.#encryptionAvailable) this.#persist();
  }

  /** True when secrets are persisted encrypted (vs. the in-memory fallback). */
  get persistent() {
    return this.#encryptionAvailable;
  }

  /**
   * Blocking-fault descriptor or null. When non-null, one or more protected
   * (encryption-class) keys exist on this machine but cannot be read.
   * @returns {{keys: string[], reason: string}|null}
   */
  get encryptionFault() {
    return this.#fault ? { keys: [...this.#fault.keys], reason: this.#fault.reason } : null;
  }

  /** Convenience predicate for the supervisor's blocking-state check. */
  isSealed() {
    return this.#fault !== null;
  }

  /**
   * Throw KeychainEncryptionUnavailableError if this store is sealed. Lets a
   * caller assert readiness up front rather than at first get().
   */
  assertReadable() {
    if (this.#fault) {
      throw new KeychainEncryptionUnavailableError(this.#fault.keys, this.#fault.reason);
    }
  }

  /** Read + parse the on-disk file as raw {key: b64} without decrypting. */
  #readRawFile() {
    if (!existsSync(this.#filePath)) return null;
    let raw;
    try {
      raw = readFileSync(this.#filePath, 'utf8');
    } catch (err) {
      this.#log.error('secret_store.read_failed', { error: errMsg(err) });
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch (err) {
      this.#log.error('secret_store.parse_failed_resetting', { error: errMsg(err) });
      return null; // corrupt file: treated as empty; #persist overwrites it cleanly
    }
  }

  /** Record a blocking fault for the given protected keys (deduped). */
  #raiseFault(keys, reason) {
    const merged = this.#fault ? this.#fault.keys.slice() : [];
    for (const k of keys) if (!merged.includes(k)) merged.push(k);
    this.#fault = { keys: merged, reason };
    // ERROR-level so it is never mistaken for the benign WARN it replaced.
    this.#log.error('secret_store.encryption_key_unavailable', { keys: merged, reason });
  }

  #loadFromDisk() {
    const parsed = this.#readRawFile();
    if (!parsed) return;
    const lostProtected = [];
    for (const [key, b64] of Object.entries(parsed)) {
      try {
        const plain = this.#safe.decryptString(Buffer.from(b64, 'base64'));
        this.#mem.set(key, plain);
      } catch (err) {
        if (this.#protectedKeys.has(key)) {
          // Protected + undecryptable: do NOT drop. This is the P1 fault.
          lostProtected.push(key);
        } else {
          // A non-protected value we cannot decrypt (freely re-obtainable) is
          // dropped, not fatal — matches the original recoverable-credential path.
          this.#log.warn('secret_store.decrypt_failed_dropping_key', { key, error: errMsg(err) });
        }
      }
    }
    if (lostProtected.length > 0) this.#raiseFault(lostProtected, 'decrypt_failed');
  }

  /**
   * When safeStorage is unavailable we cannot decrypt anything, but the on-disk
   * file's key NAMES are plaintext JSON keys. If a protected key is present, its
   * value is unreadable — fault rather than let it be regenerated in memory.
   */
  #faultOnUnreadableProtectedOnDisk(reason) {
    const parsed = this.#readRawFile();
    if (!parsed) return; // fresh machine / headless CI with no prior data: safe.
    const present = Object.keys(parsed).filter((k) => this.#protectedKeys.has(k));
    if (present.length > 0) this.#raiseFault(present, reason);
  }

  #persist() {
    const out = {};
    for (const [key, value] of this.#mem) {
      try {
        out[key] = this.#safe.encryptString(value).toString('base64');
      } catch (err) {
        this.#log.error('secret_store.encrypt_failed', { key, error: errMsg(err) });
        return; // do not write a partial file
      }
    }
    try {
      mkdirSync(dirname(this.#filePath), { recursive: true, mode: 0o700 });
      writeFileSync(this.#filePath, JSON.stringify(out), { mode: 0o600 });
      chmodSync(this.#filePath, 0o600); // enforce even if the file pre-existed
    } catch (err) {
      this.#log.error('secret_store.write_failed', { error: errMsg(err) });
    }
  }
}

module.exports = { KeychainSecretStore, KeychainEncryptionUnavailableError };
