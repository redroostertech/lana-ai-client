/**
 * The offline copy key (main process, local AI engine plan phase 10).
 *
 * The engine keeps the signed-in person's offline copy encrypted with a 32
 * byte key. The key lives here: generated once, persisted only as Electron
 * safeStorage ciphertext (macOS Keychain, Windows DPAPI, Linux
 * libsecret/kwallet), and handed to the engine over its loopback control
 * channel. When safeStorage cannot encrypt, no key is made and the computer
 * keeps no offline copy: never a key in plain text.
 *
 * Sign-out clears the key (the engine wipes the copy too), so a copy left on
 * disk could not be opened by anyone afterwards.
 *
 * Never log the key or any part of it.
 */

'use strict';

const crypto = require('crypto');

const KEY_BYTES = 32;

/**
 * @param {object} deps
 * @param {object} deps.safeStorage - Electron safeStorage (or a fake in tests)
 * @param {object} deps.persistence - { read(): string|null, write(string), remove() } holding base64 ciphertext only
 * @param {Function} [deps.randomBytes]
 */
function createOfflineKeyStore({ safeStorage, persistence, randomBytes = crypto.randomBytes }) {
  let memory = null;

  function canEncrypt() {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
    } catch (_) {
      return false;
    }
  }

  function remove() {
    try { persistence.remove(); } catch (_) { /* nothing persisted */ }
  }

  /** @returns {Buffer|null} the key, made on first use; null without a keychain */
  function get() {
    if (memory) return memory;
    if (!canEncrypt()) return null;
    let stored = null;
    try { stored = persistence.read(); } catch (_) { stored = null; }
    if (typeof stored === 'string' && stored) {
      try {
        const key = Buffer.from(safeStorage.decryptString(Buffer.from(stored, 'base64')), 'base64');
        if (key.length === KEY_BYTES) {
          memory = key;
          return memory;
        }
      } catch (_) { /* another keychain or a damaged record: make a new key */ }
    }
    const fresh = randomBytes(KEY_BYTES);
    try {
      persistence.write(safeStorage.encryptString(fresh.toString('base64')).toString('base64'));
    } catch (_) {
      return null;
    }
    memory = fresh;
    return memory;
  }

  function clear() {
    memory = null;
    remove();
  }

  return { get, clear, canEncrypt };
}

module.exports = { createOfflineKeyStore, KEY_BYTES };
