/* Auth Guard — reusable auth check + loader dismiss for standalone pages.
   Include at the end of <body>, AFTER all other scripts.

   1. Checks localStorage for a valid token (retries for Electron storage race).
   2. Syncs token/user into api + Lex.state.
   3. Redirects to login.html if no token or token expired.
   4. Dismisses the branded loader on lex-data-loaded or after timeout. */

(function () {
  'use strict';

  function checkAuth(retries) {
    var token = localStorage.getItem('token');
    if (!token) {
      if (retries > 0) { setTimeout(function () { checkAuth(retries - 1); }, 100); return; }
      window.location.href = 'login.html';
      return;
    }
    try {
      var user = JSON.parse(localStorage.getItem('user') || 'null');
      if (window.api) { api.token = token; api.user = user; }
      if (window.Lex && window.Lex.state) {
        Lex.state.setAuth(token, user);
        if (Lex.state.isTokenExpired) {
          Lex.state.clearAuth();
          window.location.href = 'login.html';
          return;
        }
      }
    } catch (e) { /* ignore parse errors */ }
  }
  checkAuth(3);

  // Dismiss branded loader
  var dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (window.Lex && window.Lex.Loader) Lex.Loader.hide();
  }
  document.addEventListener('lex-data-loaded', dismiss);
  setTimeout(dismiss, 2000);
  // Safety net
  setTimeout(dismiss, 4000);
})();
