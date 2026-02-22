/* ==========================================================================
   Lex.Nav — Centralized Navigation Coordinator
   ---------------------------------------------------------------------------
   Single entry point for ALL page navigation in LANA AI client.
   Stores transit context, builds URLs with proper params, and provides
   a deep-link registry so pages declare their URL schemas in one place.

   Public API:
     Lex.Nav.go(path, options?)       — navigate to a page
     Lex.Nav.consume()                — get + clear pending nav context
     Lex.Nav.peek()                   — read context without clearing
     Lex.Nav.getParams()              — current URL query params
     Lex.Nav.updateParams(params)     — update URL params without navigation
     Lex.Nav.hasContext                — boolean getter

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - IIFE pattern consistent with lex.auth.js, lex.state.js
     - No load-time dependencies on LexRouter (checked lazily)
   ========================================================================== */

(function (global) {
  'use strict';

  global.Lex = global.Lex || {};

  // =========================================================================
  // Internal state
  // =========================================================================

  var _context = null;
  var SESSION_KEY = 'lex-nav-context';

  // =========================================================================
  // Deep-link registry
  // ---------------------------------------------------------------------------
  // Declares known URL param schemas per page. Used today for documentation
  // and param validation; in future for resolving lana-ai:// protocol routes.
  // =========================================================================

  var _deepLinks = {
    'chat.html':                              { session: 'string', matter: 'string', openModal: 'string' },
    'chat-v2.html':                            { matter: 'string', session: 'string' },
    'matters.html':                           { matter_id: 'string', open: 'string', tab: 'string', action: 'string' },
    'drive.html':                             { matter_id: 'string', matter_name: 'string', folder_id: 'string', tab: 'string' },
    'storage.html':                           { matter_id: 'string', matter_name: 'string', folder_id: 'string', tab: 'string' },
    'search-conversations.html':               {},
    'search-results.html':                    { q: 'string' },
    'article.html':                           { section: 'string', id: 'string' },
    'help.html':                              { section: 'string' },
    'faq.html':                               { section: 'string' },
    'workflows/builder.html':                 { template: 'string' },
    'workflows/document-generation.html':     { matterId: 'string', temp_doc: 'string', save: 'string' },
    'integrations/integration-config.html':   { id: 'string', connector_id: 'string' },
    'integrations/connector-viewer.html':     { ui: 'string', name: 'string', tab: 'string' },
    'admin/user-details.html':                { userId: 'string' },
    'admin/session-details.html':             { sessionId: 'string' },
    'admin/roles_manager.html':               { id: 'string' },
    'workspace-details.html':                 { id: 'string', tab: 'string' },
    'matters/timeline.html':                  { id: 'string' },
    'password-reset.html':                    { token: 'string' },
    'onboarding.html':                        { token: 'string' },
    'auth_error.html':                        { type: 'string', message: 'string', return: 'string' },
    'session_expired.html':                   { return: 'string' },
    'error.html':                             { message: 'string', code: 'string', ref: 'string' },
    'login.html':                             { return: 'string' },
    'matter-skills.html':                     { matterSkillId: 'string', tab: 'string' },
    'skills-marketplace.html':                { category: 'string' }
  };

  // =========================================================================
  // Path utilities (NO regex — string methods only)
  // =========================================================================

  /**
   * Normalize a path to root-relative form: '/matters.html'
   * Accepts: 'matters.html', '/matters.html', './matters.html', full URLs.
   * Delegates to LexRouter._normalizePath when available for protocol-aware
   * handling (file://, http://).
   * @param {string} path
   * @returns {string|null}
   */
  function normalizePath(path) {
    if (!path) return '/index.html';

    // Skip hash-only, javascript:, mailto: links
    if (path.indexOf('#') === 0) return null;
    if (path.indexOf('javascript:') === 0) return null;
    if (path.indexOf('mailto:') === 0) return null;

    // Delegate protocol-bearing URLs to the router's normalizer if available
    if (path.indexOf('http') === 0 || path.indexOf('file://') === 0) {
      if (global.LexRouter && global.LexRouter._normalizePath) {
        return global.LexRouter._normalizePath(path);
      }
      // Fallback: external URLs pass through as-is
      return null;
    }

    // Already root-relative
    if (path.indexOf('/') === 0) return path;

    // Strip leading ./ prefix
    if (path.indexOf('./') === 0) {
      path = path.substring(2);
    }

    // Prepend /
    return '/' + path;
  }

  /**
   * Split a path into pathname and query string.
   * '/matters.html?action=create' -> { pathname: '/matters.html', search: '?action=create' }
   * @param {string} path
   * @returns {{ pathname: string, search: string }}
   */
  function splitPathAndQuery(path) {
    var qIdx = path.indexOf('?');
    if (qIdx === -1) {
      return { pathname: path, search: '' };
    }
    return {
      pathname: path.substring(0, qIdx),
      search: path.substring(qIdx)
    };
  }

  /**
   * Extract just the filename from a root-relative path.
   * '/admin/dashboard.html' -> 'admin/dashboard.html'
   * '/matters.html' -> 'matters.html'
   * @param {string} pathname
   * @returns {string}
   */
  function extractPageKey(pathname) {
    if (!pathname) return '';
    return pathname.indexOf('/') === 0 ? pathname.substring(1) : pathname;
  }

  /**
   * Build a URL from a pathname, explicit params, and optional existing query string.
   * Explicit params override any same-named keys in the existing query string.
   * @param {string} pathname
   * @param {Object|null} params
   * @param {string} existingSearch - e.g. '?foo=bar'
   * @returns {string}
   */
  function buildUrl(pathname, params, existingSearch) {
    var urlParams;
    if (existingSearch) {
      urlParams = new URLSearchParams(existingSearch);
    } else {
      urlParams = new URLSearchParams();
    }

    if (params) {
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var val = params[key];
        if (val === null || val === undefined || val === '') {
          urlParams.delete(key);
        } else {
          urlParams.set(key, String(val));
        }
      }
    }

    var qs = urlParams.toString();
    return qs ? pathname + '?' + qs : pathname;
  }

  // =========================================================================
  // Context persistence (in-memory + sessionStorage for full-reload safety)
  // =========================================================================

  /**
   * Store navigation context in both in-memory and sessionStorage.
   * @param {Object} ctx
   */
  function storeContext(ctx) {
    _context = ctx;
    if (ctx) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(ctx));
      } catch (e) {
        // sessionStorage may be unavailable in some Electron configs
      }
    }
  }

  /**
   * Read stored context. Checks in-memory first, sessionStorage second.
   * @returns {Object|null}
   */
  function readStoredContext() {
    // In-memory first (SPA transitions)
    if (_context) return _context;

    // sessionStorage fallback (full-reload pages)
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        _context = JSON.parse(raw);
        return _context;
      }
    } catch (e) { /* ignore parse errors */ }

    return null;
  }

  /**
   * Clear stored context from both in-memory and sessionStorage.
   */
  function clearStoredContext() {
    _context = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  // =========================================================================
  // Core navigation
  // =========================================================================

  /**
   * Navigate to a page. THE single entry point for all navigation.
   *
   * @param {string} path        - target path (relative or root-relative)
   * @param {Object} [options]   - navigation options:
   *   @param {Object}  [options.params]   - URL query params (appear in URL bar)
   *   @param {Object}  [options.context]  - arbitrary context for destination page
   *   @param {boolean} [options.force]    - force nav even if same path
   *   @param {boolean} [options.replace]  - replaceState instead of pushState
   *
   * @returns {Promise|undefined}
   *
   * Examples:
   *   Lex.Nav.go('matters.html')
   *   Lex.Nav.go('matters.html', { params: { action: 'create' }, context: { action: 'create' } })
   *   Lex.Nav.go('chat.html', { params: { session: threadId, matter: matterId } })
   */
  function go(path, options) {
    options = options || {};

    // 1. Normalize path and split any inline query params
    var normalized = normalizePath(path);

    // Block dangerous protocol URLs before any fallback navigation.
    // Check the original path (before normalization) because normalizePath()
    // returns null for both external (http/https) and dangerous (javascript:)
    // URLs, and we must not allow the latter to reach window.location.href.
    var lowerPath = path ? path.toLowerCase() : '';
    if (lowerPath.indexOf('javascript:') === 0 || lowerPath.indexOf('data:') === 0) {
      return;
    }

    // External or unparseable URL — fall back to browser navigation
    if (!normalized) {
      window.location.href = path;
      return;
    }

    var parts = splitPathAndQuery(normalized);
    var pathname = parts.pathname;
    var inlineSearch = parts.search;

    // 2. Build final URL with merged params (options.params override inline)
    var finalUrl = buildUrl(pathname, options.params || null, inlineSearch);

    // 3. Store context (or clear if none provided)
    if (options.context) {
      storeContext(options.context);
    } else {
      clearStoredContext();
    }

    // 4. Delegate to LexRouter if available
    if (global.LexRouter && typeof global.LexRouter.navigate === 'function') {
      var routerOpts = {};
      if (options.force) routerOpts.force = true;
      if (options.replace) routerOpts.pushState = false;
      return global.LexRouter.navigate(finalUrl, routerOpts);
    }

    // 5. Fallback: no router available (pre-init or outside SPA shell)
    window.location.href = finalUrl;
  }

  /**
   * Consume the navigation context (one-shot read).
   * Returns the context object and clears it so subsequent calls return null.
   * @returns {Object|null}
   */
  function consume() {
    var ctx = readStoredContext();
    clearStoredContext();
    return ctx;
  }

  /**
   * Peek at the navigation context without consuming it.
   * @returns {Object|null}
   */
  function peek() {
    return readStoredContext();
  }

  /**
   * Get current URL query parameters.
   * Under file:// protocol, falls back to history.state.path for param parsing
   * since the URL bar may not reflect query strings.
   * @returns {URLSearchParams}
   */
  function getParams() {
    // The SPA router stores the canonical route (with query params) in
    // history.state.path — the browser URL bar always shows app.html and
    // its location.search may be stale or only partially updated by
    // updateParams(). Always prefer history.state.path as the source of truth.
    if (global.history && global.history.state && global.history.state.path) {
      var statePath = global.history.state.path;
      var qIdx = statePath.indexOf('?');
      if (qIdx !== -1) {
        return new URLSearchParams(statePath.substring(qIdx));
      }
    }

    // Fallback: read from browser URL (pre-router or non-SPA contexts)
    var search = global.location.search;
    if (search) {
      return new URLSearchParams(search);
    }

    return new URLSearchParams();
  }

  /**
   * Update URL query parameters without triggering navigation.
   * Uses replaceState to avoid polluting browser history.
   * @param {Object} params - key/value pairs; null values remove the key
   */
  function updateParams(params) {
    // Read current params from the canonical route in history.state.path
    // (not location.search, which belongs to the SPA shell URL).
    var currentState = global.history.state || {};
    var statePath = currentState.path || '';
    var qIdx = statePath.indexOf('?');
    var basePath = qIdx !== -1 ? statePath.substring(0, qIdx) : statePath;
    var existingSearch = qIdx !== -1 ? statePath.substring(qIdx) : '';

    var urlParams = new URLSearchParams(existingSearch);
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = params[key];
      if (val === null || val === undefined) {
        urlParams.delete(key);
      } else {
        urlParams.set(key, String(val));
      }
    }

    var qs = urlParams.toString();
    var newStatePath = qs ? basePath + '?' + qs : basePath;

    // Update the canonical route in history.state.path
    var newState = {};
    var stateKeys = Object.keys(currentState);
    for (var si = 0; si < stateKeys.length; si++) {
      newState[stateKeys[si]] = currentState[stateKeys[si]];
    }
    newState.path = newStatePath;

    // replaceState avoids back-button clutter
    global.history.replaceState(newState, '');
  }

  // =========================================================================
  // Public API
  // =========================================================================

  global.Lex.Nav = {
    go:           go,
    consume:      consume,
    peek:         peek,
    getParams:    getParams,
    updateParams: updateParams,

    /**
     * Check if navigation context exists without consuming it.
     * @type {boolean}
     */
    get hasContext() {
      return readStoredContext() !== null;
    },

    /**
     * Get the deep-link registry (read-only copy).
     * Useful for tooling, debugging, and future lana-ai:// resolution.
     * @returns {Object}
     */
    getDeepLinkRegistry: function () {
      // Return a shallow copy so callers cannot mutate the internal map
      var copy = {};
      var keys = Object.keys(_deepLinks);
      for (var i = 0; i < keys.length; i++) {
        copy[keys[i]] = _deepLinks[keys[i]];
      }
      return copy;
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
