(function (global) {
  'use strict';

  // Generic host for embedded partner surfaces (docs/EMBEDDED-APPS-SPEC.md).
  //
  // The query string carries ONLY an app id. The URL that gets framed always
  // comes from the same discovery payload the sidebar rendered (localStorage
  // 'lana_saved_server' -> enabledApps), re-run through LanaClientApps
  // normalization — so this page can never be used to frame a caller-chosen
  // URL, and a payload that fails validation (non-https, wrong type) resolves
  // to nothing here exactly as it renders no tile there.

  var LOAD_TIMEOUT_MS = 10000;
  var REFRESH_RETRY_MS = 15000;
  var MIN_REFRESH_DELAY_MS = 5000;
  var MAX_TIMER_DELAY_MS = 2147483647;

  /**
   * Resolve the embedded app entry for this page load.
   * Pure: takes the query string and the raw persisted server payload.
   *
   * @param {string} search - location.search ('?app=<id>')
   * @param {string|null} savedServerRaw - localStorage 'lana_saved_server' JSON
   * @returns {Object|null} normalized app with .embed, or null (fail closed)
   */
  function resolveEmbedApp(search, savedServerRaw) {
    var apps = global.LanaClientApps;
    if (!apps || typeof apps.normalizeAppList !== 'function') return null;

    var id = null;
    try {
      id = new URLSearchParams(search || '').get('app');
    } catch (_) {
      return null;
    }
    if (!id) return null;

    var enabled;
    try {
      var parsed = JSON.parse(savedServerRaw || 'null');
      enabled = parsed && Array.isArray(parsed.enabledApps) ? parsed.enabledApps : [];
    } catch (_) {
      return null;
    }
    if (!enabled.length) return null;

    // Pass [] as the fallback so an unresolvable payload cannot substitute
    // default apps here — this page renders exactly what discovery declared,
    // or nothing.
    var list = apps.normalizeAppList(enabled, []);
    for (var i = 0; i < list.length; i += 1) {
      var app = list[i];
      if (app.id === id
          && app.embed
          && app.embed.type === 'embedded'
          && (typeof apps.isHttpsUrl !== 'function' || apps.isHttpsUrl(app.embed.url))) {
        return app;
      }
    }
    return null;
  }

  function readSavedServer() {
    try {
      return global.localStorage.getItem('lana_saved_server');
    } catch (_) {
      return null;
    }
  }

  /**
   * Seed declarative shell attributes before <lex-app> upgrades. This avoids a
   * first-render race where late property mutations lose to custom-element
   * initialization.
   */
  function primeShell(shell, app) {
    var resolved = app || resolveEmbedApp(global.location.search, readSavedServer());
    if (!shell || !resolved || typeof shell.setAttribute !== 'function') return resolved;
    shell.setAttribute('page-title', resolved.label);
    shell.setAttribute('sidebar-collapsed', '');
    return resolved;
  }

  function buildFallback(app) {
    var box = global.document.createElement('div');
    box.className = 'embed-host-fallback';
    box.style.cssText = 'display:none;padding:48px 24px;text-align:center;';
    var msg = global.document.createElement('p');
    msg.textContent = app.label + ' did not load. It may be temporarily unavailable.';
    var link = global.document.createElement('a');
    // Never interpolate the URL into markup; DOM assignment only.
    link.href = app.embed.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open ' + app.label + ' in your browser';
    link.style.cssText = 'text-decoration:underline;';
    box.appendChild(msg);
    box.appendChild(link);
    return box;
  }

  function dashboardForApp(app) {
    var dashboard = app && app.embed && app.embed.meta && app.embed.meta.dashboard;
    return typeof dashboard === 'string' && dashboard ? dashboard : 'executive';
  }

  /**
   * Validate the backend-minted session before assigning its URL to an iframe.
   * The authenticated API may add a token and dashboard path, but it may never
   * redirect the renderer to an origin other than the discovery-approved app.
   */
  function validateSession(app, value) {
    var session = value && value.session ? value.session : value;
    if (!session || session.app_id !== app.id || typeof session.embed_url !== 'string') {
      return null;
    }

    try {
      var approved = new URL(app.embed.url);
      var target = new URL(session.embed_url);
      if (target.protocol !== 'https:' || target.origin !== approved.origin) return null;
      if (session.partner_origin && session.partner_origin !== approved.origin) return null;
      if (target.pathname.indexOf('/embed/') !== 0 || !target.searchParams.get('token')) return null;
      return Object.assign({}, session, { embed_url: target.toString() });
    } catch (_) {
      return null;
    }
  }

  async function requestSession(app, apiClient) {
    var client = apiClient || global.api;
    if (!client || typeof client.post !== 'function') {
      throw new Error('Authenticated Lana API is unavailable');
    }
    var response = await client.post(
      '/api/v1/partner-embeds/' + encodeURIComponent(app.id) + '/session',
      { dashboard: dashboardForApp(app) }
    );
    var session = validateSession(app, response);
    if (!session) throw new Error('Partner session response failed validation');
    return session;
  }

  function refreshDelay(session, now) {
    var refreshAt = Date.parse(session && session.refresh_after);
    if (!Number.isFinite(refreshAt)) {
      var expiresAt = Date.parse(session && session.expires_at);
      if (!Number.isFinite(expiresAt)) return null;
      refreshAt = expiresAt - 60000;
    }
    return Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(MIN_REFRESH_DELAY_MS, refreshAt - (typeof now === 'number' ? now : LanaTime.nowMs()))
    );
  }

  /**
   * Apply embedded-app identity to the shared shell and give the partner
   * surface maximum working room. Kept separate from iframe mounting so the
   * behavior is directly testable and reusable by future embedded apps.
   */
  function configureShell(shell, app, doc) {
    if (!shell || !app) return;
    var targetDoc = doc || global.document;

    if (typeof shell.setPage === 'function') {
      shell.setPage({ title: app.label });
    } else {
      shell.pageTitle = app.label;
    }
    if (targetDoc) targetDoc.title = app.label + ' - LANA AI';

    shell.sidebarCollapsed = true;

    // LexSidebar exposes `collapsed` as a reflected public property. Use that
    // contract so its own render path updates both width and the shared body
    // offset CSS variable.
    var sidebar = typeof shell.querySelector === 'function'
      ? shell.querySelector('lex-sidebar')
      : null;
    if (sidebar) sidebar.collapsed = true;
  }

  /**
   * Mount the embedded surface into the lex-app shell.
   * @param {HTMLElement} shell - the <lex-app> element
   */
  async function init(shell) {
    var doc = global.document;
    var content = shell && typeof shell.getContentEl === 'function'
      ? shell.getContentEl()
      : doc.getElementById('lex-main-content');
    if (!content) return;

    var app = resolveEmbedApp(global.location.search, readSavedServer());
    if (!app) {
      // Unknown/invalid app id: fail closed to the workspace, mirroring the
      // catalog's drop-what-you-cannot-route rule.
      global.location.replace('dashboard.html');
      return;
    }

    configureShell(shell, app, doc);

    var wrap = doc.createElement('div');
    wrap.style.cssText = 'position:relative;width:100%;height:100%;min-height:70vh;';

    var fallback = buildFallback(app);

    var frame = doc.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.setAttribute('allow', 'clipboard-write; microphone');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', app.label);
    frame.style.cssText = 'border:0;width:100%;height:100%;min-height:70vh;display:block;';

    wrap.appendChild(frame);
    wrap.appendChild(fallback);
    content.appendChild(wrap);

    var loadGeneration = 0;
    var refreshTimer = null;
    var hasMountedSession = false;

    function showFallback() {
      frame.style.display = 'none';
      fallback.style.display = 'block';
    }

    async function mountSession() {
      var generation = ++loadGeneration;
      var loaded = false;

      try {
        var session = await requestSession(app);
        if (generation !== loadGeneration) return;
        frame.addEventListener('load', function () { loaded = true; }, { once: true });
        frame.style.display = 'block';
        fallback.style.display = 'none';
        // The signed JWT exists only in this iframe URL. It is never copied to
        // localStorage, discovery state, logs, or postMessage payloads.
        frame.src = session.embed_url;
        hasMountedSession = true;

        global.setTimeout(function () {
          if (generation === loadGeneration && !loaded) showFallback();
        }, LOAD_TIMEOUT_MS);

        var delay = refreshDelay(session);
        if (delay !== null) {
          if (refreshTimer) global.clearTimeout(refreshTimer);
          refreshTimer = global.setTimeout(mountSession, delay);
        }
      } catch (error) {
        if (generation !== loadGeneration) return;
        if (global.console && typeof global.console.error === 'function') {
          global.console.error('[LanaEmbedHost] Could not create partner session:', error);
        }
        if (!hasMountedSession) {
          showFallback();
        } else {
          // A transient refresh failure must not tear down a session that may
          // still have up to a minute left. Keep it visible and retry without
          // ever persisting the prior token.
          if (refreshTimer) global.clearTimeout(refreshTimer);
          refreshTimer = global.setTimeout(mountSession, REFRESH_RETRY_MS);
        }
      }
    }

    await mountSession();
  }

  global.LanaEmbedHost = {
    resolveEmbedApp: resolveEmbedApp,
    primeShell: primeShell,
    configureShell: configureShell,
    dashboardForApp: dashboardForApp,
    validateSession: validateSession,
    requestSession: requestSession,
    refreshDelay: refreshDelay,
    init: init
  };
})(window);
