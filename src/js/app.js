/* App Bootstrap — authenticate via Lex.state then start the SPA router.
   Loaded last in app.html after all Lex UI and shell scripts are ready. */

(function () {
  'use strict';

  var app = document.querySelector('lex-app');
  if (!app) return;

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
    function onShellReady() {
      // Determine initial page from URL or default to dashboard
      var startPath = window.location.pathname || '/dashboard.html';
      if (startPath === '/' || startPath === '' || startPath.endsWith('/app.html')) {
        startPath = '/dashboard.html';
      }

      LexRouter.start(startPath);

      // Hide the branded loader after the first page renders AND its
      // initial data has loaded. We listen for lex-page-ready (content +
      // scripts injected) then wait for either lex-data-loaded (from
      // LexDataSource) or a 2-second timeout — whichever comes first.
      document.addEventListener('lex-page-ready', function onFirstPage() {
        document.removeEventListener('lex-page-ready', onFirstPage);

        var dismissed = false;
        function dismissLoader() {
          if (dismissed) return;
          dismissed = true;
          if (window.Lex && window.Lex.Loader) {
            window.Lex.Loader.hide();
          }
        }

        // If the page fires lex-data-loaded (LexDataSource fetch complete),
        // dismiss immediately — data is ready.
        document.addEventListener('lex-data-loaded', function onData() {
          document.removeEventListener('lex-data-loaded', onData);
          dismissLoader();
        });

        // Fallback: dismiss after 2 seconds regardless. Handles pages
        // with no LexDataSource, or if the API is slow.
        setTimeout(dismissLoader, 2000);
      });
    }

    // lex-app renders synchronously during HTML parsing, so lex-app-ready
    // fires before this script runs. Check if the shell already rendered;
    // if so, proceed immediately. Otherwise wait for the event.
    if (app._shellRendered) {
      onShellReady();
    } else {
      app.addEventListener('lex-app-ready', onShellReady);
    }
  }

  checkAuthWithRetry();
})();
