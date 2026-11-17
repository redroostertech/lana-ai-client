/**
 * A one-time in-app prompt asking an organization admin to set the firm time zone, shown while
 * the profile says the firm has none (firm_timezone_set === false). "Set time zone" opens
 * Settings > General, where the Firm time zone card lives; "Not now" hides it.
 *
 * The dismissal is kept on the server in the person's preferences
 * (onboarding.prompts.firm_timezone, PATCH /api/v1/users/me/preferences), so it follows them to
 * another computer. It is marked only when they choose "Not now" and the save succeeds, or when
 * Settings saves the firm zone (markDismissed); opening Settings alone does not count. Not shown
 * to anyone else, when the profile does not say (an older server), or when the preferences
 * cannot be read. Styles: css/firm-timezone-prompt.css.
 */
(function (global) {
  'use strict';

  var PROMPT = 'firm_timezone';
  var SETTINGS_HREF = 'settings-v2.html#general';

  function apiClient() {
    var api = global.api;
    return api && typeof api.getPreferences === 'function' && typeof api.updatePreferences === 'function' ? api : null;
  }

  function preferencesFrom(response) {
    if (!response || typeof response !== 'object') return {};
    var body = response.data && typeof response.data === 'object' ? response.data : response;
    return body.preferences && typeof body.preferences === 'object' ? body.preferences : body;
  }

  /** The person's preferences, or null when they cannot be read. */
  async function loadPreferences() {
    var api = apiClient();
    if (!api) return null;
    try {
      return preferencesFrom(await api.getPreferences());
    } catch (_error) {
      return null;
    }
  }

  /** When the person dismissed the prompt, or null. */
  function dismissedFrom(preferences) {
    var prompts = preferences && preferences.onboarding && preferences.onboarding.prompts;
    return prompts && typeof prompts === 'object' && prompts[PROMPT] ? prompts[PROMPT] : null;
  }

  /**
   * The onboarding group with the prompt marked dismissed, keeping everything else in it.
   * The server replaces a whole preference group on save, so send all of it.
   */
  function withDismissed(preferences, isoTime) {
    var onboarding = preferences && preferences.onboarding && typeof preferences.onboarding === 'object' ? preferences.onboarding : {};
    var next = {};
    Object.keys(onboarding).forEach(function (key) { next[key] = onboarding[key]; });
    var prompts = {};
    var current = onboarding.prompts && typeof onboarding.prompts === 'object' ? onboarding.prompts : {};
    Object.keys(current).forEach(function (key) { prompts[key] = current[key]; });
    prompts[PROMPT] = isoTime;
    next.prompts = prompts;
    return next;
  }

  /** Record the dismissal. Resolves true when the server saved it. */
  async function markDismissed() {
    var api = apiClient();
    if (!api) return false;
    try {
      var preferences = await api.getPreferences().then(preferencesFrom);
      var now = global.LanaTime && typeof global.LanaTime.nowIso === 'function' ? global.LanaTime.nowIso() : new Date().toISOString();
      await api.updatePreferences({ onboarding: withDismissed(preferences, now) });
      return true;
    } catch (_error) {
      // Not saved: the prompt may show once more.
      return false;
    }
  }

  function applies(user, isAdmin) {
    return !!(isAdmin && user && user.id && user.firm_timezone_set === false);
  }

  function button(label, variant, action) {
    var node = document.createElement('lex-btn');
    node.setAttribute('variant', variant);
    node.setAttribute('size', 'sm');
    node.setAttribute('label', label);
    node.setAttribute('data-firm-tz-action', action);
    node.textContent = label;
    return node;
  }

  function defaultNavigate(href) {
    global.location.href = href;
  }

  /**
   * Show the prompt in host when it applies. Resolves whether it is shown.
   * @param {Element} host
   * @param {{ user: object, isAdmin: boolean, navigate?: function(string) }} options
   */
  async function mount(host, options) {
    var o = options || {};
    if (!host) return false;
    var existing = host.querySelector('.firm-tz-prompt');
    if (existing) existing.remove();
    if (!applies(o.user, o.isAdmin)) return false;
    var preferences = await loadPreferences();
    // Unknown (offline, older server): do not interrupt.
    if (!preferences || dismissedFrom(preferences)) return false;
    var navigate = typeof o.navigate === 'function' ? o.navigate : defaultNavigate;

    var card = document.createElement('lex-card');
    card.className = 'firm-tz-prompt';
    card.setAttribute('heading', 'Set your firm time zone');
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Set your firm time zone');

    var copy = document.createElement('p');
    copy.className = 'firm-tz-prompt-text';
    copy.textContent = 'Reports count days and months in UTC until you set your firm time zone. Set it so everyone sees the right days.';
    card.appendChild(copy);

    var actions = document.createElement('div');
    actions.className = 'firm-tz-prompt-actions';
    actions.appendChild(button('Set time zone', 'primary', 'open'));
    actions.appendChild(button('Not now', 'ghost', 'dismiss'));
    card.appendChild(actions);

    card.addEventListener('click', function (event) {
      var target = event.target.closest && event.target.closest('[data-firm-tz-action]');
      if (!target) return;
      card.remove();
      // Opening Settings is not a dismissal: the zone is not saved yet.
      if (target.getAttribute('data-firm-tz-action') === 'open') navigate(SETTINGS_HREF);
      else markDismissed();
    });

    host.appendChild(card);
    return true;
  }

  var api = { mount: mount, markDismissed: markDismissed, dismissedFrom: dismissedFrom, withDismissed: withDismissed, SETTINGS_HREF: SETTINGS_HREF };
  global.LanaFirmTimezonePrompt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
