'use strict';

/**
 * One-time move of renderer localStorage from the old file:// origin to the
 * app origin (lana-app://app, electron-app-protocol.js).
 *
 * localStorage is kept per origin. Builds before the app protocol ran every
 * page on file://, so the saved user, the remembered organization and the
 * per-page preferences live there. The first start of this build copies them
 * across once, before the first window opens. A key the app origin already has
 * is never overwritten. The login token is not in localStorage (main-process
 * token store), so sign-in does not depend on this.
 *
 * Electron is injected (createPage, the store), so this is unit tested.
 */

const MIGRATED_KEY = 'appOriginStorageMigrated';
const TIMEOUT_MS = 5000;

const READ_SCRIPT = '(() => { try { return JSON.stringify(Object.entries(window.localStorage)); } catch (_) { return "[]"; } })()';

// The old values are outside input, so they reach the page script only as base64
// (A-Z, a-z, 0-9, +, /, =): no value can end the string and run as code.
const WRITE_SCRIPT_START = '(() => { const bytes = Uint8Array.from(atob("';
const WRITE_SCRIPT_END = '"), (c) => c.charCodeAt(0)); const entries = JSON.parse(new TextDecoder().decode(bytes)); let copied = 0;'
  + ' for (const [key, value] of entries) {'
  + ' if (window.localStorage.getItem(key) === null) { window.localStorage.setItem(key, value); copied += 1; } }'
  + ' return copied; })()';

function writeScript(entries) {
  const data = Buffer.from(JSON.stringify(entries), 'utf8').toString('base64');
  return WRITE_SCRIPT_START + data + WRITE_SCRIPT_END;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); })
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {Object} deps
 * @param {{ get: Function, set: Function }} deps.store - electron-store (migration flags)
 * @param {Function} deps.createPage - () => a hidden page: { loadURL, webContents, destroy } (no preload, sandboxed)
 * @param {string} deps.fileOriginUrl - a file:// page with no script (the old origin)
 * @param {string} deps.appOriginUrl - an app origin page with no script
 * @param {Function} [deps.log]
 * @returns {Promise<{ status: 'done'|'migrated'|'failed', copied?: number }>}
 */
async function migrateFileOriginStorage({ store, createPage, fileOriginUrl, appOriginUrl, log = () => {}, timeoutMs = TIMEOUT_MS }) {
  if (store.get(MIGRATED_KEY, false)) return { status: 'done' };

  async function run(url, script) {
    const win = createPage();
    try {
      await withTimeout(win.loadURL(url), timeoutMs);
      return await withTimeout(win.webContents.executeJavaScript(script, true), timeoutMs);
    } finally {
      try { win.destroy(); } catch (_) { /* already gone */ }
    }
  }

  try {
    let entries = JSON.parse(await run(fileOriginUrl, READ_SCRIPT));
    entries = Array.isArray(entries)
      ? entries.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string')
      : [];
    const copied = entries.length ? await run(appOriginUrl, writeScript(entries)) : 0;
    store.set(MIGRATED_KEY, true);
    // Keys only by count: values can be personal data.
    log(`[origin-migration] copied ${Number(copied) || 0} of ${entries.length} localStorage keys to the app origin`);
    return { status: 'migrated', copied: Number(copied) || 0 };
  } catch (error) {
    // Not marked done: the next start tries again. The app works without it.
    log(`[origin-migration] failed: ${error && error.message}`);
    return { status: 'failed' };
  }
}

module.exports = { migrateFileOriginStorage, writeScript, MIGRATED_KEY };
