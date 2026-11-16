'use strict';

/**
 * Appearance: the one Light / Dark / System setting for the whole app, owned by the main
 * process. Settings > General writes it over IPC; every window, LANA Briefs and the
 * operating system's own drawing (native controls, scrollbars, prefers-color-scheme in
 * every page) follow it through nativeTheme.themeSource.
 *
 *   appearance:get      { preference: 'system'|'light'|'dark', theme: 'light'|'dark' }
 *   appearance:set      save a preference; returns the same shape
 *   appearance:changed  (push) the same shape to every window on each change, including
 *                       the computer switching light or dark while set to System
 *
 * Saved in the client's settings store under appearance.theme (the key Briefs uses in its
 * own store). Briefs is kept in step by electron-briefs.js through subscribe(). Pages keep a
 * localStorage copy only to paint the first frame right (js/lex/lex.theme.js).
 */

const CHANNELS = Object.freeze({
  get: 'appearance:get',
  set: 'appearance:set',
  changed: 'appearance:changed'
});

const PREFERENCES = Object.freeze(['system', 'light', 'dark']);

function normalizePreference(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PREFERENCES.includes(text) ? text : 'system';
}

/**
 * @param {object} deps
 * @param {object} deps.nativeTheme - Electron nativeTheme (themeSource, shouldUseDarkColors, on('updated'))
 * @param {{ read(): string|null, write(value: string): void }} deps.persistence
 * @param {() => Array} [deps.getWindows] - open BrowserWindows, told about each change
 * @param {(error: Error) => void} [deps.log]
 */
function createAppearance({ nativeTheme, persistence, getWindows = () => [], log = () => {} }) {
  const listeners = [];
  let preference = 'system';
  // Whether this computer has a saved choice yet (an upgrade from a build where only
  // Briefs kept one does not: electron-briefs.js seeds it from Briefs' value).
  let saved = false;

  function readSaved() {
    try {
      const value = persistence.read();
      saved = typeof value === 'string' && value.length > 0;
      return normalizePreference(value);
    } catch (error) { log(error); return 'system'; }
  }

  function state() {
    return { preference, theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
  }

  function broadcast() {
    const current = state();
    for (const win of getWindows()) {
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send(CHANNELS.changed, current);
      }
    }
    return current;
  }

  return {
    /** Applies the saved preference. Call once, before the first window opens. */
    start() {
      preference = readSaved();
      nativeTheme.themeSource = preference;
      if (typeof nativeTheme.on === 'function') nativeTheme.on('updated', broadcast);
      return state();
    },
    preference: () => preference,
    /** True once a choice is saved here (at start, or after set). */
    hasSaved: () => saved,
    state,
    /** Saves and applies a preference; unchanged values do nothing. */
    set(value) {
      const next = normalizePreference(value);
      if (next === preference && saved) return state();
      const changed = next !== preference;
      preference = next;
      try { persistence.write(next); saved = true; } catch (error) { log(error); }
      if (!changed) return state();
      nativeTheme.themeSource = next;
      const current = broadcast();
      listeners.slice().forEach((fn) => {
        try { fn(next); } catch (error) { log(error); }
      });
      return current;
    },
    /** fn(preference) after each change made through set(). Returns an unsubscribe. */
    subscribe(fn) {
      listeners.push(fn);
      return () => {
        const at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
  };
}

function registerAppearanceIpc({ ipcMain, appearance }) {
  ipcMain.handle(CHANNELS.get, () => appearance.state());
  ipcMain.handle(CHANNELS.set, (_event, value) => appearance.set(value));
}

module.exports = { CHANNELS, PREFERENCES, normalizePreference, createAppearance, registerAppearanceIpc };
