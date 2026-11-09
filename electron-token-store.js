/**
 * Auth token store (main process).
 *
 * The login token lives here, not in renderer localStorage. It is kept in
 * memory and persisted only as ciphertext from Electron safeStorage (macOS
 * Keychain, Windows DPAPI, Linux libsecret/kwallet). When safeStorage cannot
 * encrypt (for example Linux without a keyring) the token stays in memory for
 * this session only and nothing is written to disk: never plain text.
 *
 * Renderers reach it through the preload (window.lanaAuthToken) over the
 * synchronous IPC channels registered by registerTokenIpc. The channels are
 * synchronous because dozens of renderer call sites read the token
 * synchronously; a set or clear has finished persisting before the page
 * navigates away.
 *
 * Never log the token or any part of it.
 */

'use strict';

const MAX_TOKEN_LENGTH = 16 * 1024;

const CHANNELS = Object.freeze({
  get: 'auth-token:get',
  set: 'auth-token:set',
  clear: 'auth-token:clear',
  migrate: 'auth-token:migrate'
});

function isValidToken(token) {
  return typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH;
}

/**
 * @param {object} deps
 * @param {object} deps.safeStorage - Electron safeStorage (or a fake in tests).
 * @param {object} deps.persistence - { read(): string|null, write(string), remove() }
 *   holding the base64 ciphertext only.
 */
function createTokenStore({ safeStorage, persistence }) {
  let memory = null;
  let loaded = false;

  function canEncrypt() {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
    } catch (_) {
      return false;
    }
  }

  function removePersisted() {
    try { persistence.remove(); } catch (_) { /* nothing persisted to remove */ }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    let encrypted = null;
    try { encrypted = persistence.read(); } catch (_) { encrypted = null; }
    if (typeof encrypted !== 'string' || !encrypted || !canEncrypt()) return;
    try {
      const token = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      memory = isValidToken(token) ? token : null;
    } catch (_) {
      // Ciphertext from another keychain or a corrupt record: drop it.
      memory = null;
      removePersisted();
    }
  }

  function get() {
    load();
    return memory;
  }

  function clear() {
    loaded = true;
    memory = null;
    removePersisted();
  }

  function set(token) {
    if (!isValidToken(token)) {
      clear();
      return false;
    }
    loaded = true;
    memory = token;
    if (canEncrypt()) {
      try {
        persistence.write(safeStorage.encryptString(token).toString('base64'));
        return true;
      } catch (_) {
        // Fall through to memory only.
      }
    }
    removePersisted();
    return true;
  }

  /**
   * One-time move of a token an older build left in renderer localStorage.
   * A token already held here wins; the caller deletes the legacy copy either way.
   */
  function migrateLegacy(token) {
    if (!isValidToken(token) || get()) return false;
    return set(token);
  }

  return { get, set, clear, migrateLegacy, isPersistent: canEncrypt };
}

/**
 * True when the token is a demo token or a JWT that has not expired. Used to
 * tell screen voice whether someone is signed in without exposing the token.
 */
function hasLiveSession(token, nowMs) {
  if (!isValidToken(token)) return false;
  if (token.indexOf('demo-token-') === 0) return true;
  const payload = jwtPayload(token);
  if (!payload) return false;
  return !payload.exp || payload.exp * 1000 > nowMs;
}

/** The claims of a JWT, or null when it is not one. Never logged. */
function jwtPayload(token) {
  if (!isValidToken(token)) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_) {
    return null;
  }
}

/** When the token stops working (ms since epoch), or null when it does not say. */
function tokenExpiresAt(token) {
  const payload = jwtPayload(token);
  return payload && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
}

// Only the app's own pages (file://) may read or change the token. A remote
// page that ends up in an app window gets nothing.
function isTrustedSender(event) {
  try {
    const frameUrl = (event && event.senderFrame && event.senderFrame.url) || '';
    return new URL(frameUrl).protocol === 'file:';
  } catch (_) {
    return false;
  }
}

/**
 * Wire the synchronous IPC channels the preload uses.
 * @param {object} ipcMain
 * @param {object} tokenStore - from createTokenStore
 * @param {function} [onChange] - called after set/clear/migrate (no arguments,
 *   the token is never passed).
 */
function registerTokenIpc(ipcMain, tokenStore, onChange = () => {}) {
  const notify = () => { try { onChange(); } catch (_) { /* observers must not break auth */ } };

  ipcMain.on(CHANNELS.get, (event) => {
    event.returnValue = isTrustedSender(event) ? tokenStore.get() : null;
  });
  ipcMain.on(CHANNELS.set, (event, token) => {
    if (!isTrustedSender(event)) { event.returnValue = null; return; }
    tokenStore.set(token);
    notify();
    event.returnValue = tokenStore.get();
  });
  ipcMain.on(CHANNELS.clear, (event) => {
    if (!isTrustedSender(event)) { event.returnValue = null; return; }
    tokenStore.clear();
    notify();
    event.returnValue = null;
  });
  ipcMain.on(CHANNELS.migrate, (event, legacyToken) => {
    if (!isTrustedSender(event)) { event.returnValue = null; return; }
    if (tokenStore.migrateLegacy(legacyToken)) notify();
    event.returnValue = tokenStore.get();
  });
}

module.exports = { createTokenStore, registerTokenIpc, isTrustedSender, hasLiveSession, tokenExpiresAt, CHANNELS, MAX_TOKEN_LENGTH };
