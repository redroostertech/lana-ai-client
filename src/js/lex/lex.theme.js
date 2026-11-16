/* ==========================================================================
   Lex UI: Theme (light or dark)
   The one place every page and component learns whether to draw light or dark.

   The person's setting wins (Light, Dark or System). System, and no setting at
   all, follows the computer: prefers-color-scheme, which in the desktop app is
   Electron's nativeTheme. It is never dark by default, and it changes live when
   the computer or the setting changes.

   In the desktop app the setting is owned by the main process
   (electron-appearance.js, window.electronAPI.appearance): setPreference saves it
   there, and changes from any window or from LANA Briefs come back here. The
   localStorage copy under SETTING_KEY only paints the first frame right; main
   keeps it in step. In a plain browser localStorage is the setting.

   Load it in <head>, before any stylesheet that reads data-lex-theme, so the
   first paint is already right:
     <html lang="en" data-lex-theme="auto">
     <script src="js/lex/lex.theme.js"></script>

   A page that is themed light and dark says so with data-lex-theme="auto" on
   <html>; this script then keeps <html data-lex-theme> at "light" or "dark".
   Pages without it keep <html> as it is, and components (lex-sidebar) still
   follow the theme through window.LexTheme.

   window.LexTheme:
     current()             "light" | "dark"
     preference()          "system" | "light" | "dark"
     setPreference(value)  saves the setting; every open page follows
     subscribe(fn)         fn(theme, preference) on each change; returns unsubscribe
     setRootThemed(on)     lex-router: theme <html> while a themed: true fragment shows
     rootThemed()          whether <html> follows the theme now
     SETTING_KEY, resolveTheme, normalizePreference, createThemeController
   document also gets a "lex-theme-change" event, detail { theme, preference }, on every
   change, including a preference-only change (System to Light on a light computer).
   ========================================================================== */

(function (global) {
  'use strict';

  var SETTING_KEY = 'lana:appearance.theme';
  var PREFERENCES = ['system', 'light', 'dark'];
  var QUERY = '(prefers-color-scheme: dark)';

  function normalizePreference(value) {
    var text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return PREFERENCES.indexOf(text) >= 0 ? text : 'system';
  }

  /** The theme to draw: the setting when it is Light or Dark, else the computer's. */
  function resolveTheme(preference, osPrefersDark) {
    var choice = normalizePreference(preference);
    if (choice === 'system') return osPrefersDark ? 'dark' : 'light';
    return choice;
  }

  function readSetting(storage) {
    try { return storage ? storage.getItem(SETTING_KEY) : null; } catch (_) { return null; }
  }

  /**
   * A live theme from a setting store and the computer's media query.
   * options.storage: { getItem, setItem }   options.media: a MediaQueryList
   * options.remote:  the main process owner, { get(), set(preference), onChange(fn) }
   */
  function createThemeController(options) {
    var storage = options && options.storage;
    var media = options && options.media;
    var remote = options && options.remote;
    var listeners = [];
    // The choice made on this page, for when storage cannot be written (blocked).
    var chosen = null;
    function setting() {
      var saved = readSetting(storage);
      return saved === null || saved === undefined ? chosen : saved;
    }
    var preference = normalizePreference(setting());
    var theme = resolveTheme(preference, Boolean(media && media.matches));

    // Listeners hear every change: the theme, or only the preference (System to Light on
    // a light computer), so a Settings control stays in step.
    function update() {
      var nextPreference = normalizePreference(setting());
      var nextTheme = resolveTheme(nextPreference, Boolean(media && media.matches));
      if (nextPreference === preference && nextTheme === theme) return;
      preference = nextPreference;
      theme = nextTheme;
      listeners.slice().forEach(function (fn) {
        try { fn(theme, preference); } catch (error) { if (global.console) global.console.error('[lex-theme]', error); }
      });
    }

    if (media) {
      if (typeof media.addEventListener === 'function') media.addEventListener('change', update);
      else if (typeof media.addListener === 'function') media.addListener(update);
    }

    /** Use a preference here and keep the first-paint copy in step. */
    function adopt(choice) {
      chosen = choice;
      try { if (storage) storage.setItem(SETTING_KEY, choice); } catch (_) { /* blocked: this page still uses it */ }
      update();
    }

    /** The main process said what the setting is (its answer, or a change elsewhere). */
    function fromRemote(state) {
      if (state && typeof state.preference === 'string') adopt(normalizePreference(state.preference));
    }

    if (remote) {
      if (typeof remote.onChange === 'function') remote.onChange(fromRemote);
      if (typeof remote.get === 'function') Promise.resolve(remote.get()).then(fromRemote, function () { /* keep the copy */ });
    }

    return {
      current: function () { return theme; },
      preference: function () { return preference; },
      setPreference: function (value) {
        var choice = normalizePreference(value);
        adopt(choice);
        if (remote && typeof remote.set === 'function') {
          Promise.resolve(remote.set(choice)).then(fromRemote, function () { /* main did not answer: this page still uses it */ });
        }
      },
      subscribe: function (fn) {
        listeners.push(fn);
        return function () {
          var at = listeners.indexOf(fn);
          if (at >= 0) listeners.splice(at, 1);
        };
      },
      refresh: update
    };
  }

  var api = {
    SETTING_KEY: SETTING_KEY,
    resolveTheme: resolveTheme,
    normalizePreference: normalizePreference,
    createThemeController: createThemeController
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  // ---- In the page ---------------------------------------------------------------------

  // Loaded twice (a page and a component both include it): keep the first.
  if (global.LexTheme) return;

  var storage = null;
  try { storage = global.localStorage; } catch (_) { storage = null; }
  var media = typeof global.matchMedia === 'function' ? global.matchMedia(QUERY) : null;
  var remote = global.electronAPI && global.electronAPI.appearance ? global.electronAPI.appearance : null;
  var controller = createThemeController({ storage: storage, media: media, remote: remote });
  var doc = global.document;
  var root = doc && doc.documentElement;
  var themesRoot = Boolean(root && root.getAttribute('data-lex-theme') === 'auto');

  function applyRoot(theme) {
    if (themesRoot) root.setAttribute('data-lex-theme', theme);
  }

  /**
   * SPA fragments share their host document's <html>: lex-router turns the root theme on
   * for a fragment whose descriptor says themed: true and off (light) for the others.
   */
  function setRootThemed(on) {
    if (!root) return;
    themesRoot = Boolean(on);
    if (themesRoot) root.setAttribute('data-lex-theme', controller.current());
    else root.removeAttribute('data-lex-theme');
  }

  applyRoot(controller.current());
  controller.subscribe(function (theme, preference) {
    applyRoot(theme);
    if (doc && typeof global.CustomEvent === 'function') {
      doc.dispatchEvent(new global.CustomEvent('lex-theme-change', { detail: { theme: theme, preference: preference } }));
    }
  });

  // Another window saved the setting.
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', function (event) {
      if (!event || event.key === SETTING_KEY || event.key === null) controller.refresh();
    });
  }

  global.LexTheme = Object.assign({}, api, controller, {
    setRootThemed: setRootThemed,
    rootThemed: function () { return themesRoot; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
