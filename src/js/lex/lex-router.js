/* Lex UI — SPA Router
   Client-side router for the LANA AI platform. Intercepts sidebar link clicks,
   fetches page content, and swaps it into <lex-app>'s content area without a
   full page reload.

   Features:
     - Link interception (same-origin, non-excluded)
     - Content extraction from fetched HTML
     - Page-specific script and stylesheet loading/unloading
     - history.pushState / popstate for back/forward
     - View lifecycle: onEnter / onLeave hooks
     - Page init registry for SPA re-navigation (registerPageInit)
     - lex-page-ready event for legacy DOMContentLoaded compat
     - Content swap transition (opacity fade via design tokens)

   Usage:
     // In app.html bootstrap:
     document.addEventListener('DOMContentLoaded', () => {
       LexRouter.start();
     });

     // In a page entry script (IIFE):
     LexRouter.registerPageInit('my-page.html', init);  // No leading slash
     // The router calls init() on every navigation to this page.

     // Optional view lifecycle hooks:
     LexRouter.registerView({
       onEnter(ctx) { ... },
       onLeave() { ... }
     });

   Depends on: lex-router.pages.js (PAGE_DESCRIPTORS, FULL_RELOAD_PAGES)
*/

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Router State
  // ---------------------------------------------------------------------------

  let _currentPath = null;
  let _currentView = null;       // { onEnter, onLeave } registered by current page
  let _navigating = false;
  let _app = null;               // <lex-app> element reference
  let _started = false;

  // Page init registry — page entry scripts register an init function once
  // (inside their IIFE). The router calls it on every navigation to that page,
  // including the first load and re-navigation from cached scripts.
  var _pageInits = {};

  // Hoisted modals — lex-modal elements moved from lex-content to document.body
  // so they escape the stacking context created by overflow-y: auto.
  var _hoistedModals = [];

  // Capture the real document URL before history.replaceState can change it.
  // Under file:// protocol, replaceState('/index.html') would change the URL
  // to file:///index.html, breaking all relative URL resolution.
  var _appBaseUrl = window.location.href;

  // Disable browser automatic scroll restoration on page refresh.
  // The router handles scroll-to-top explicitly in navigate() Step 11.
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  // ---------------------------------------------------------------------------
  // Path resolution
  // ---------------------------------------------------------------------------

  /**
   * Normalize any href (relative, absolute, file://) to a root-relative path
   * like '/matters.html' or '/admin/dashboard.html'.
   */
  function normalizePath(href) {
    if (!href) return '/index.html';

    // file:// protocol in Electron
    if (href.indexOf('file://') === 0) {
      var idx = href.indexOf('/src/');
      if (idx !== -1) return href.substring(idx + 4); // strip /src prefix
      idx = href.indexOf('/public_html/');
      if (idx !== -1) return href.substring(idx + 12);
      return href;
    }

    // Absolute URL on same origin — take pathname
    if (href.indexOf('http') === 0) {
      try {
        var url = new URL(href);
        if (url.origin === window.location.origin) return url.pathname;
      } catch (e) { /* fallback below */ }
      return null; // external URL
    }

    // Hash-only or javascript: — skip
    if (href.indexOf('#') === 0 || href.indexOf('javascript:') === 0) return null;
    if (href.indexOf('mailto:') === 0) return null;

    // Relative path — resolve against current location
    try {
      var resolved = new URL(href, _appBaseUrl);
      var pathname = resolved.pathname;
      // Under file:// protocol, the resolved pathname includes the full filesystem
      // path (e.g. /Users/.../src/workspaces.html). Strip down to the page-relative
      // path so descriptor lookups work (e.g. /workspaces.html).
      if (window.location.protocol === 'file:') {
        var srcIdx = pathname.indexOf('/src/');
        if (srcIdx !== -1) return pathname.substring(srcIdx + 4);
        var pubIdx = pathname.indexOf('/public_html/');
        if (pubIdx !== -1) return pathname.substring(pubIdx + 12);
      }
      return pathname;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get just the filename from a path: '/admin/dashboard.html' -> 'admin/dashboard.html'
   */
  function pathKey(path) {
    if (!path) return '';
    // Strip query string before descriptor lookup
    var qIdx = path.indexOf('?');
    var clean = qIdx !== -1 ? path.substring(0, qIdx) : path;
    // Strip leading slash for descriptor lookup
    return clean.indexOf('/') === 0 ? clean.substring(1) : clean;
  }

  // ---------------------------------------------------------------------------
  // Page descriptors (set by lex-router.pages.js)
  // ---------------------------------------------------------------------------

  let _pageDescriptors = {};
  let _fullReloadPages = new Set();

  const DEFAULT_DESCRIPTOR = {
    title: 'LANA AI',
    activeNav: '',
    scripts: [],
    stylesheets: []
  };

  function getDescriptor(path) {
    var key = pathKey(path);
    // Try exact match
    if (_pageDescriptors[key]) return _pageDescriptors[key];
    // Try with index.html suffix
    if (key.endsWith('/')) {
      if (_pageDescriptors[key + 'index.html']) return _pageDescriptors[key + 'index.html'];
    }
    return DEFAULT_DESCRIPTOR;
  }

  function isFullReloadPage(path) {
    var key = pathKey(path);
    var filename = key.indexOf('/') !== -1 ? key.substring(key.lastIndexOf('/') + 1) : key;
    return _fullReloadPages.has(filename) || _fullReloadPages.has(key);
  }

  // ---------------------------------------------------------------------------
  // Content extraction from fetched HTML
  // ---------------------------------------------------------------------------

  function extractContent(htmlText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(htmlText, 'text/html');

    // Strategy 1 (migrated pages): #lex-page-content
    var content = doc.getElementById('lex-page-content');
    if (content) return content.innerHTML;

    // Strategy 2: <main> element
    var main = doc.querySelector('main');
    if (main) return main.outerHTML;

    // Strategy 3 (legacy pages): strip shell from #app-content
    var appContent = doc.getElementById('app-content');
    if (appContent) {
      var clone = appContent.cloneNode(true);
      var sidebar = clone.querySelector('#sidebar');
      if (sidebar) sidebar.remove();
      var header = clone.querySelector('header');
      if (header) header.remove();
      var preloader = clone.querySelector('#lana-preloader');
      if (preloader) preloader.remove();
      var notifOverlay = clone.querySelector('#notificationOverlay');
      if (notifOverlay) notifOverlay.remove();
      var notifPanel = clone.querySelector('#notificationPanel');
      if (notifPanel) notifPanel.remove();
      return clone.innerHTML;
    }

    // Strategy 4: entire body
    var body = doc.querySelector('body');
    return body ? body.innerHTML : htmlText;
  }

  // ---------------------------------------------------------------------------
  // Modal hoisting — escape lex-content stacking context
  // ---------------------------------------------------------------------------
  // lex-content uses overflow-y: auto for page scrolling, which creates a new
  // stacking context. position: fixed modals (lex-modal) rendered inside it are
  // clipped to its bounds. We move them to document.body after content injection.

  function _hoistPageModals(contentEl) {
    if (!contentEl) return;

    // Hoist all lex-modal web components
    var modals = contentEl.querySelectorAll('lex-modal');
    for (var i = 0; i < modals.length; i++) {
      document.body.appendChild(modals[i]);
      _hoistedModals.push(modals[i]);
    }

    // Hoist any element marked with data-hoist (plain div modals)
    var extras = contentEl.querySelectorAll('[data-hoist]');
    for (var j = 0; j < extras.length; j++) {
      document.body.appendChild(extras[j]);
      _hoistedModals.push(extras[j]);
    }
  }

  function _unhoistPageModals() {
    for (var i = 0; i < _hoistedModals.length; i++) {
      var m = _hoistedModals[i];
      if (m.parentNode === document.body) {
        document.body.removeChild(m);
      }
    }
    _hoistedModals = [];
  }

  // ---------------------------------------------------------------------------
  // Script loading / unloading
  // ---------------------------------------------------------------------------

  /** Track globally loaded scripts to avoid double-loading */
  var _loadedScripts = new Set();

  function loadScript(src, pagePath) {
    return new Promise(function (resolve, reject) {
      // Normalize src for comparison
      var fullSrc = resolveAssetUrl(src);

      // Already loaded globally (CDN or re-visited page)
      if (_loadedScripts.has(fullSrc)) {
        resolve();
        return;
      }

      var script = document.createElement('script');
      script.src = fullSrc;
      script.dataset.lexPage = pagePath;
      script.onload = function () {
        _loadedScripts.add(fullSrc);
        resolve();
      };
      script.onerror = function () {
        console.warn('[LexRouter] Failed to load script:', fullSrc);
        resolve(); // Don't block navigation on script failure
      };
      document.head.appendChild(script);
    });
  }

  function loadPageScripts(scripts, pagePath) {
    if (!scripts || scripts.length === 0) return Promise.resolve();

    // Load sequentially to preserve execution order
    return scripts.reduce(function (promise, src) {
      return promise.then(function () {
        return loadScript(src, pagePath);
      });
    }, Promise.resolve());
  }

  function unloadPageScripts(pagePath) {
    // Call the view's onLeave lifecycle hook
    if (_currentView && typeof _currentView.onLeave === 'function') {
      try { _currentView.onLeave(); } catch (e) {
        console.warn('[LexRouter] onLeave error:', e);
      }
    }
    _currentView = null;

    // Remove page-specific script tags (does not undo execution).
    // Scripts stay in _loadedScripts so they are NOT re-executed on
    // re-navigation — top-level const/class bindings would throw
    // "Identifier has already been declared". Page entry scripts use
    // registerPageInit() for re-initialization instead.
    var scripts = document.querySelectorAll('script[data-lex-page="' + pagePath + '"]');
    for (var i = 0; i < scripts.length; i++) {
      // Keep CDN scripts in place — they are safe to leave
      if (scripts[i].src.indexOf('cdn.') === -1 && scripts[i].src.indexOf('cdnjs.') === -1) {
        scripts[i].remove();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stylesheet loading / unloading
  // ---------------------------------------------------------------------------

  function loadStylesheet(href, pagePath) {
    var fullHref = resolveAssetUrl(href);
    // Check if already loaded (safe comparison without interpolated querySelector)
    var existing = Array.prototype.some.call(
      document.querySelectorAll('link[rel="stylesheet"]'),
      function (l) { return l.href === fullHref; }
    );
    if (existing) return Promise.resolve();

    return new Promise(function (resolve) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = fullHref;
      link.dataset.lexPage = pagePath;
      link.onload = resolve;
      link.onerror = function () {
        console.warn('[LexRouter] Failed to load stylesheet:', fullHref);
        resolve();
      };
      document.head.appendChild(link);
    });
  }

  function loadPageStylesheets(stylesheets, pagePath) {
    if (!stylesheets || stylesheets.length === 0) return Promise.resolve();

    return Promise.all(stylesheets.map(function (href) {
      return loadStylesheet(href, pagePath);
    }));
  }

  function unloadPageStylesheets(pagePath) {
    var links = document.querySelectorAll('link[data-lex-page="' + pagePath + '"]');
    for (var i = 0; i < links.length; i++) {
      // Keep CDN stylesheets in place
      if (links[i].href.indexOf('cdn.') === -1 && links[i].href.indexOf('cdnjs.') === -1) {
        links[i].remove();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // URL resolution for assets
  // ---------------------------------------------------------------------------

  function resolveAssetUrl(src) {
    // Already absolute (CDN)
    if (src.indexOf('http') === 0 || src.indexOf('//') === 0) return src;
    // Already a full file:// path
    if (src.indexOf('file://') === 0) return src;

    // Resolve against _appBaseUrl (not window.location.href, which may
    // have been changed by history.replaceState under file:// protocol)
    try {
      return new URL(src, _appBaseUrl).href;
    } catch (e) {
      return src;
    }
  }

  /**
   * Resolve a route path into a fetchable URL.
   * Under file:// protocol, root-relative paths like '/index.html' would
   * resolve to file:///index.html (filesystem root). We resolve against
   * _appBaseUrl (captured at module load) since history.replaceState may
   * have already changed window.location.href.
   */
  function resolveFetchUrl(path) {
    if (window.location.protocol === 'file:') {
      var relative = path.indexOf('/') === 0 ? path.substring(1) : path;
      try {
        return new URL(relative, _appBaseUrl).href;
      } catch (e) {
        return relative;
      }
    }
    return path;
  }

  // ---------------------------------------------------------------------------
  // Token refresh + retry navigation
  // ---------------------------------------------------------------------------

  /**
   * Attempt to refresh an expired token, then re-try the navigation.
   * If refresh fails, redirect to login.
   */
  function _attemptRefreshThenNavigate(path, options) {
    if (!window.api || typeof window.api.performTokenRefresh !== 'function') {
      window.location.href = 'login.html';
      return Promise.resolve();
    }

    return window.api.performTokenRefresh()
      .then(function () {
        if (window.api.isAuthenticated() && !window.api.isTokenExpired()) {
          return navigate(path, options);
        }
        window.location.href = 'login.html';
        return Promise.resolve();
      })
      .catch(function () {
        console.warn('[LexRouter] Token refresh failed, redirecting to login');
        window.location.href = 'login.html';
        return Promise.resolve();
      });
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function navigate(path, options) {
    options = options || {};
    var pushState = options.pushState !== false;

    if (_navigating) return Promise.resolve();

    // Same path — skip unless forced
    if (path === _currentPath && !options.force) return Promise.resolve();

    // Full reload page — let browser handle it
    if (isFullReloadPage(path)) {
      window.location.href = path;
      return Promise.resolve();
    }

    _navigating = true;
    var previousPath = _currentPath;
    var descriptor = getDescriptor(path);

    // Step 1: Check if active streaming should block navigation
    var state = (global.Lex && global.Lex.state) ? global.Lex.state : null;
    if (state ? state.isStreaming : (window.api && window.api._streamingActive)) {
      _navigating = false;
      console.warn('[LexRouter] Navigation blocked: AI streaming is active');
      return Promise.resolve();
    }

    // Step 1.5: Auth guard — verify token is still valid before navigating.
    // Catches token expiry between page loads (e.g. laptop wake-from-sleep,
    // long idle where refresh failed). Does NOT duplicate the 401 →
    // showSessionExpiredModal() flow which handles mid-API-call failures.
    if (state) {
      if (!state.isAuthenticated) {
        _navigating = false;
        console.warn('[LexRouter] Navigation blocked: not authenticated');
        window.location.href = 'login.html';
        return Promise.resolve();
      }

      if (state.isTokenExpired) {
        _navigating = false;
        return _attemptRefreshThenNavigate(path, options);
      }
    } else if (window.api) {
      if (!window.api.isAuthenticated()) {
        _navigating = false;
        console.warn('[LexRouter] Navigation blocked: not authenticated');
        window.location.href = 'login.html';
        return Promise.resolve();
      }

      if (window.api.isTokenExpired()) {
        _navigating = false;
        return _attemptRefreshThenNavigate(path, options);
      }
    }

    // Step 2: Tear down previous view
    _unhoistPageModals();
    if (previousPath) {
      unloadPageScripts(previousPath);
      unloadPageStylesheets(previousPath);
    }

    // Step 3: Show content-area loading state (opacity fade).
    // The branded full-screen loader is handled by the app.html bootstrap
    // and dismissed via lex-page-ready — we don't touch it here.
    if (_app) {
      _app.setContentLoading(true);
      _app.clearTopbarActions();
    }

    // Step 4: Fetch and swap content
    return fetch(resolveFetchUrl(path), { headers: { 'X-Requested-With': 'LexRouter' } })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Failed to load page: ' + response.status);
        }
        return response.text();
      })
      .then(function (htmlText) {
        // Step 5: Extract content
        var content = extractContent(htmlText);

        // Step 6: Load page-specific stylesheets BEFORE injecting content
        // so the page renders already-styled (prevents FOUC).
        return loadPageStylesheets(descriptor.stylesheets, path).then(function () {
          // Step 7: Inject into content area after CSS is ready
          var main = _app ? _app.getContentEl() : document.getElementById('lex-main-content');
          if (main) {
            main.innerHTML = content;

            // Step 7b: Hoist lex-modal elements to document.body so they
            // escape lex-content's stacking context (overflow-y: auto).
            _hoistPageModals(main);
          }
        });
      })
      .then(function () {
        // Step 8: Load page-specific scripts (sequential)
        return loadPageScripts(descriptor.scripts, path);
      })
      .then(function () {
        // Step 8b: Update shell state
        _currentPath = path;
        if (_app) {
          _app.setPage({
            title: descriptor.title,
            activeNav: descriptor.activeNav
          });
        }

        // Step 8c: Push to history BEFORE page init so Lex.Nav.getParams()
        // can read the route's query params from history.state.path.
        // NEVER pass the URL (3rd argument) — keep the browser URL at
        // app.html so CMD+SHIFT+R (hard refresh) reloads the SPA shell
        // instead of the page fragment. The route is stored in state.path
        // and read back by app.js on reload.
        if (pushState) {
          history.pushState({ path: path }, descriptor.title);
        } else {
          // Even without pushState (startup, back nav), ensure
          // history.state.path is current so getParams() works.
          history.replaceState({ path: path }, '');
        }

        // Step 8d: Call registered page init (supports SPA re-navigation).
        // On first load the IIFE registers init via registerPageInit();
        // on re-navigation cached scripts skip, but the router calls it.
        var initKey = pathKey(path);
        if (_pageInits[initKey]) {
          try { _pageInits[initKey](); } catch (e) {
            console.warn('[LexRouter] Page init error:', e);
          }
        }

        // Step 11: Scroll to top
        var main = _app ? _app.getContentEl() : document.getElementById('lex-main-content');
        if (main) main.scrollTop = 0;
        window.scrollTo(0, 0);

        // Step 12: Hide content-area loading state
        if (_app) {
          _app.setContentLoading(false);
        }

        // Step 13: Focus content for accessibility
        if (_app) {
          _app.focusContent();
        }

        // Step 14: Dispatch page-ready event (DOMContentLoaded equivalent)
        document.dispatchEvent(new CustomEvent('lex-page-ready', {
          detail: { path: path, title: descriptor.title }
        }));

        // Step 15: Call new view's onEnter if registered
        if (_currentView && typeof _currentView.onEnter === 'function') {
          try {
            _currentView.onEnter({
              path: path,
              contentEl: main,
              descriptor: descriptor
            });
          } catch (e) {
            console.warn('[LexRouter] onEnter error:', e);
          }
        }

        // Step 16: Emit navigation event
        if (_app) {
          _app.emit('lex-app-navigate', {
            from: previousPath,
            to: path,
            title: descriptor.title
          });
        }

        _navigating = false;
      })
      .catch(function (err) {
        console.error('[LexRouter] Navigation failed:', err);
        _navigating = false;

        // Hide content-area loading state
        if (_app) {
          _app.setContentLoading(false);
        }

        // Show error via toast (preserves current page view)
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Page could not be loaded. Please try again.', 'error');
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Link interception
  // ---------------------------------------------------------------------------

  function handleLinkClick(e) {
    // Only handle left-clicks without modifiers
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var anchor = e.target.closest('a[href]');
    if (!anchor) return;

    var href = anchor.getAttribute('href');
    if (!href) return;

    // Skip target=_blank
    if (anchor.target === '_blank') return;

    // Skip data-no-router links
    if (anchor.dataset.noRouter !== undefined) return;

    // Resolve to normalized path
    var path = normalizePath(href);
    if (!path) return; // external, hash, or unparseable

    // Skip full-reload pages
    if (isFullReloadPage(path)) return;

    // Only intercept pages with a known descriptor — unknown .html gets full reload
    var key = pathKey(path);
    if (!_pageDescriptors[key]) return;

    e.preventDefault();

    // Delegate to Lex.Nav if available (single entry point for all navigation)
    if (global.Lex && global.Lex.Nav) {
      global.Lex.Nav.go(href);
    } else {
      navigate(path);
    }
  }

  // ---------------------------------------------------------------------------
  // History (back/forward)
  // ---------------------------------------------------------------------------

  function handlePopState(e) {
    var path = (e.state && e.state.path) || window.location.pathname;
    navigate(path, { pushState: false });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  var LexRouter = {

    /**
     * Start the router. Call once from app.html after DOMContentLoaded.
     * @param {string} [initialPath] - path to load first (defaults to current URL)
     */
    start: function (initialPath) {
      if (_started) return;
      _started = true;

      // Pick up page descriptors if lex-router.pages.js loaded before us
      if (window.Lex && window.Lex._pageDescriptors && !Object.keys(_pageDescriptors).length) {
        _pageDescriptors = window.Lex._pageDescriptors;
      }
      if (window.Lex && window.Lex._fullReloadPages && _fullReloadPages.size === 0) {
        _fullReloadPages = new Set(window.Lex._fullReloadPages);
      }

      _app = document.querySelector('lex-app');

      // Set initial history state.
      // NEVER pass the URL (3rd argument) — keep the browser URL at
      // app.html so CMD+SHIFT+R (hard refresh) reloads the SPA shell
      // instead of the page fragment. The route is stored in state.path.
      var startPath = initialPath || window.location.pathname || '/index.html';
      if (startPath === '/' || startPath === '') startPath = '/index.html';
      history.replaceState({ path: startPath }, '');

      // Wire event listeners
      document.addEventListener('click', handleLinkClick, { capture: true });
      window.addEventListener('popstate', handlePopState);

      // Wire sidebar nav clicks from <lex-app>
      if (_app) {
        _app.addEventListener('lex-app-navigate', function (e) {
          var detail = e.detail || {};
          if (detail.href) {
            var path = normalizePath(detail.href);
            if (path) navigate(path);
          }
        });
      }

      // Load initial page
      navigate(startPath, { pushState: false });
    },

    /**
     * Navigate to a page programmatically.
     * @param {string} path - root-relative path like '/matters.html'
     * @param {object} [options] - { force: bool, pushState: bool }
     */
    navigate: navigate,

    /**
     * Register an init function for a page. Called once by the page's entry
     * script (inside its IIFE). The router calls it on every navigation to
     * that page — both first load and SPA re-navigation.
     *
     * This solves the re-navigation problem: utility scripts with top-level
     * const/class declarations stay cached (avoiding redeclaration errors),
     * while the page's bootstrap logic re-runs via this registered init.
     *
     * @param {string} pagePath - e.g. '/dashboard.html' or 'dashboard.html'
     * @param {Function} initFn - the page's init/bootstrap function
     */
    registerPageInit: function (pagePath, initFn) {
      _pageInits[pathKey(pagePath)] = initFn;
    },

    /**
     * Register a view with lifecycle hooks for the current page.
     * Called by page scripts after they load.
     * @param {{ onEnter?: Function, onLeave?: Function }} view
     */
    registerView: function (view) {
      _currentView = view;

      // Only auto-call onEnter if NOT in the middle of a navigate() sequence.
      // During navigation, the router calls onEnter at Step 15 after scripts
      // and page inits have run — calling it here too would cause double-init.
      if (view.onEnter && _currentPath && !_navigating) {
        var main = _app ? _app.getContentEl() : document.getElementById('lex-main-content');
        try {
          view.onEnter({
            path: _currentPath,
            contentEl: main,
            descriptor: getDescriptor(_currentPath)
          });
        } catch (e) {
          console.warn('[LexRouter] onEnter error:', e);
        }
      }
    },

    /**
     * Set page descriptors. Called by lex-router.pages.js.
     * @param {Object} descriptors - map of path -> { title, activeNav, scripts, stylesheets }
     */
    setPageDescriptors: function (descriptors) {
      _pageDescriptors = descriptors || {};
    },

    /**
     * Set pages that require full browser reload (login, error, etc.)
     * @param {string[]} pages - array of filenames
     */
    setFullReloadPages: function (pages) {
      _fullReloadPages = new Set(pages || []);
    },

    /** Get the current route path */
    getCurrentPath: function () {
      return _currentPath;
    },

    /** Check if a navigation is in progress */
    isNavigating: function () {
      return _navigating;
    },

    /** Refresh the current page (re-fetch and re-render) */
    refresh: function () {
      if (_currentPath) {
        navigate(_currentPath, { force: true });
      }
    },

    /** Expose normalizePath for Lex.Nav integration */
    _normalizePath: normalizePath
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  global.Lex = global.Lex || {};
  global.Lex.Router = LexRouter;
  global.LexRouter = LexRouter; // convenience shorthand

})(typeof window !== 'undefined' ? window : globalThis);
