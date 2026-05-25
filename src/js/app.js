/* App Bootstrap — authenticate via Lex.state then start the SPA router.
   Loaded last in app.html after all Lex UI and shell scripts are ready. */

(function () {
  'use strict';

  var app = document.querySelector('lex-app');
  if (!app) return;

  // Global safety net: dismiss the branded loader after 6 seconds regardless
  // of what happens (auth failure, navigation failure, script error, Electron
  // font crash, etc.). Lex.Loader.hide() is idempotent — calling it after the
  // loader was already dismissed is a no-op.
  setTimeout(function () {
    if (window.Lex && window.Lex.Loader) window.Lex.Loader.hide();
  }, 4000);

  /**
   * Auth guard — verify the user has a valid (non-expired) token before
   * launching the SPA. Retries up to 3 times (300ms total) to handle the
   * race where Electron storage hasn't flushed to localStorage yet.
   *
   * Uses Lex.state as centralized auth state. On failure → redirect to
   * login.html (full reload, not routed).
   */
  function checkAuthWithRetry(retries) {
    if (retries === undefined) retries = 3;

    // Re-read from localStorage in case it wasn't ready when api.js loaded
    var token = localStorage.getItem('token');
    if (token && api) {
      api.token = token;
      api.user = JSON.parse(localStorage.getItem('user') || 'null');
      // Sync into Lex.state so all consumers see updated auth
      if (Lex.state) {
        Lex.state.setAuth(token, api.user);
      }
    }

    // Check 1: token must exist
    if (!Lex.state || !Lex.state.isAuthenticated) {
      if (retries > 0) {
        setTimeout(function () { checkAuthWithRetry(retries - 1); }, 100);
        return;
      }
      window.location.href = 'login.html';
      return;
    }

    // Check 2: token must not be expired
    if (Lex.state.isTokenExpired) {
      Lex.state.clearAuth();
      window.location.href = 'login.html';
      return;
    }

    // Auth is valid — proceed to start the app
    startApp();
  }

  function startApp() {
    var loaderDismissed = false;
    function dismissLoader() {
      if (loaderDismissed) return;
      loaderDismissed = true;
      if (window.Lex && window.Lex.Loader) {
        window.Lex.Loader.hide();
      }
    }

    function onShellReady() {
      // Determine initial page: check history.state first (preserves route
      // across refresh — under file:// protocol the URL bar always shows
      // app.html so window.location.pathname is useless for routing).
      // Fall back to sessionStorage when history.state is cleared on reload.
      var hasPendingGlobalSearch = false;
      try {
        hasPendingGlobalSearch = !!sessionStorage.getItem('lana-open-global-search')
          || !!sessionStorage.getItem('lana-pending-global-search');
      } catch (e) {
        hasPendingGlobalSearch = false;
      }
      if (!hasPendingGlobalSearch && window.name) {
        hasPendingGlobalSearch = window.name === 'lana-open-global-search'
          || window.name.indexOf('lana-pending-global-search:') === 0;
      }

      var startPath = (history.state && history.state.path)
        || (function () {
            try {
              return sessionStorage.getItem('_lex_last_path');
            } catch (e) { return null; }
          }())
        || window.location.pathname
        || '/dashboard.html';
      if (startPath === '/'
        || startPath === ''
        || startPath.endsWith('/app.html')
        || startPath.endsWith('/search-results.html')
        || startPath.endsWith('/global-search.html')) {
        startPath = '/dashboard.html';
      }

      LexRouter.start(startPath);

      if (hasPendingGlobalSearch && window.UnifiedSearchModal && typeof window.UnifiedSearchModal.openPending === 'function') {
        setTimeout(function () {
          window.UnifiedSearchModal.openPending({ openEmpty: true, force: true });
        }, 100);
      }

      // Hide the branded loader when lex-page-ready fires (content injected)
      // or after 2s timeout — whichever comes first.
      function onFirstPage() {
        document.removeEventListener('lex-page-ready', onFirstPage);

        // If the page fires lex-data-loaded, dismiss immediately
        document.addEventListener('lex-data-loaded', function onData() {
          document.removeEventListener('lex-data-loaded', onData);
          dismissLoader();
        });

        // Fallback: dismiss after 2 seconds regardless
        setTimeout(dismissLoader, 2000);
      }

      document.addEventListener('lex-page-ready', onFirstPage);

      // Belt-and-suspenders: always dismiss loader after 2.5s in case
      // lex-page-ready never fires (e.g. nav error before dispatch)
      setTimeout(dismissLoader, 2500);
    }

    // lex-app renders during HTML parsing; lex-app-ready may fire before
    // this script runs. Check _shellRendered first; also use a short timeout
    // fallback in case the event never fires.
    var shellStarted = false;
    function runShellReady() {
      if (shellStarted) return;
      shellStarted = true;
      onShellReady();
    }
    if (app._shellRendered) {
      runShellReady();
    } else {
      app.addEventListener('lex-app-ready', runShellReady);
      setTimeout(runShellReady, 1500);
    }
  }

  checkAuthWithRetry();
})();
