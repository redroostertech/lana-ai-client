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

  constructor(opts) {
    if (!opts || !opts.userDataRoot) {
      throw new Error('KeychainSecretStore: userDataRoot is required');
    }
    this.#filePath = join(opts.userDataRoot, opts.fileName || 'cloud-auth.enc.json');
    this.#safe = opts.safeStorage || defaultSafeStorage();
    this.#log = opts.logger || noopLogger;

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
    }
  }

  async get(key) {
    return this.#mem.has(key) ? this.#mem.get(key) : null;
  }

  async set(key, value) {
    this.#mem.set(key, value);
    if (this.#encryptionAvailable) this.#persist();
  }

  async delete(key) {
    this.#mem.delete(key);
    if (this.#encryptionAvailable) this.#persist();
  }

  /** True when secrets are persisted encrypted (vs. the in-memory fallback). */
  get persistent() {
    return this.#encryptionAvailable;
  }

  #loadFromDisk() {
    if (!existsSync(this.#filePath)) return;
    let raw;
    try {
      raw = readFileSync(this.#filePath, 'utf8');
    } catch (err) {
      this.#log.error('secret_store.read_failed', { error: errMsg(err) });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.#log.error('secret_store.parse_failed_resetting', { error: errMsg(err) });
      return; // corrupt file: start empty; #persist overwrites it cleanly
    }
    for (const [key, b64] of Object.entries(parsed || {})) {
      try {
        const plain = this.#safe.decryptString(Buffer.from(b64, 'base64'));
        this.#mem.set(key, plain);
      } catch (err) {
        // A value we cannot decrypt (e.g. keychain rotated) is dropped, not fatal.
        this.#log.warn('secret_store.decrypt_failed_dropping_key', { key, error: errMsg(err) });
      }
    }
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

module.exports = { KeychainSecretStore };
