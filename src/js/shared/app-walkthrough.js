/**
 * app-walkthrough.js
 * Runs an app's walkthrough (Agents, Automate, Insights) in <lex-walkthrough>, the
 * same tour Briefs uses, and remembers per person that it was finished. That record
 * lives on the server in the person's preferences (onboarding.walkthroughs.<app>),
 * so it follows them to another computer. Briefs keeps its own record in the
 * Briefs host.
 *
 * Each app registers its pages (see js/walkthroughs/*.js):
 *   LanaAppWalkthrough.register('agents', {
 *     brand: 'AGENTS.', pages: (icon) => [...], onAction: (id) => { ... }
 *   });
 * and its home page calls:
 *   LanaAppWalkthrough.showFirstRun('agents');   // only if not finished before
 *   LanaAppWalkthrough.show('agents');           // the hero's "Take the walkthrough"
 *
 * Public API (window.LanaAppWalkthrough, or module.exports in Node):
 *   register(app, definition), show(app), showFirstRun(app),
 *   seenFrom(preferences, app), withSeen(preferences, app, isoTime)
 */
(function (global) {
  'use strict';

  var registry = {};

  function icon(name) {
    var Icons = global.Lex && global.Lex.Icons;
    return Icons && Icons.has && Icons.has(name) ? String(Icons[name].small) : '';
  }

  function preferencesFrom(response) {
    if (!response || typeof response !== 'object') return {};
    var body = response.data && typeof response.data === 'object' ? response.data : response;
    return body.preferences && typeof body.preferences === 'object' ? body.preferences : body;
  }

  /** When the person finished this app's walkthrough, or null. */
  function seenFrom(preferences, app) {
    var walkthroughs = preferences && preferences.onboarding && preferences.onboarding.walkthroughs;
    return walkthroughs && typeof walkthroughs === 'object' && walkthroughs[app] ? walkthroughs[app] : null;
  }

  /**
   * The onboarding group with this app marked seen, keeping the other apps.
   * The server replaces a whole preference group on save, so send all of it.
   */
  function withSeen(preferences, app, isoTime) {
    var onboarding = preferences && preferences.onboarding && typeof preferences.onboarding === 'object' ? preferences.onboarding : {};
    var walkthroughs = onboarding.walkthroughs && typeof onboarding.walkthroughs === 'object' ? onboarding.walkthroughs : {};
    var next = {};
    Object.keys(walkthroughs).forEach(function (key) { next[key] = walkthroughs[key]; });
    next[app] = isoTime;
    return { walkthroughs: next };
  }

  function apiClient() {
    var api = global.api;
    return api && typeof api.getPreferences === 'function' && typeof api.updatePreferences === 'function' ? api : null;
  }

  async function loadPreferences() {
    var api = apiClient();
    if (!api) return null;
    try {
      return preferencesFrom(await api.getPreferences());
    } catch (_error) {
      return null;
    }
  }

  async function markSeen(app) {
    var api = apiClient();
    if (!api) return;
    try {
      var preferences = (await loadPreferences()) || {};
      var now = global.LanaTime && typeof global.LanaTime.nowIso === 'function' ? global.LanaTime.nowIso() : new Date().toISOString();
      await api.updatePreferences({ onboarding: withSeen(preferences, app, now) });
    } catch (_error) {
      // Not saving only means the walkthrough may show once more.
    }
  }

  function register(app, definition) {
    registry[app] = definition;
  }

  function show(app) {
    var definition = registry[app];
    if (!definition || typeof document === 'undefined' || document.querySelector('lex-walkthrough')) return null;
    var tour = document.createElement('lex-walkthrough');
    tour.className = 'app-tour app-tour--' + app;
    tour.brand = definition.brand || '';
    tour.pages = definition.pages(icon);
    tour.addEventListener('lex-walkthrough-done', function (event) {
      markSeen(app);
      var action = event.detail && event.detail.action;
      if (action && action !== 'skip' && typeof definition.onAction === 'function') definition.onAction(action);
    });
    document.body.appendChild(tour);
    return tour;
  }

  /** Shows the walkthrough the first time this person opens the app. */
  async function showFirstRun(app) {
    if (!registry[app]) return false;
    var preferences = await loadPreferences();
    // Unknown (offline, not signed in): do not interrupt.
    if (!preferences || seenFrom(preferences, app)) return false;
    return Boolean(show(app));
  }

  var api = { register: register, show: show, showFirstRun: showFirstRun, seenFrom: seenFrom, withSeen: withSeen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaAppWalkthrough = api;
})(typeof window !== 'undefined' ? window : globalThis);
