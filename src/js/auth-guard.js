/* Auth Guard — reusable auth check + loader dismiss for standalone pages.
   Include at the end of <body>, AFTER all other scripts.

   1. Checks localStorage for a valid token (retries for Electron storage race).
   2. Syncs token/user into api + Lex.state.
   3. Redirects to login.html if no token or token expired.
   4. Dismisses the branded loader on lex-data-loaded or after timeout. */

(function () {
  'use strict';

  function loginPath() {
    return (typeof getLoginPath === 'function') ? getLoginPath() : 'login.html';
  }

  function accessDeniedPath() {
    if (typeof getPagePath === 'function') return getPagePath('auth_error.html');
    var path = (window.location.pathname || '').toLowerCase();
    return path.indexOf('/admin/') !== -1 ? '../auth_error.html' : 'auth_error.html';
  }

  function getRoleName(role) {
    if (typeof role === 'string') return role.toLowerCase();
    if (role && typeof role === 'object' && role.name) return String(role.name).toLowerCase();
    return '';
  }

  function hasAdminPageRole(user) {
    if (!user) return false;

    var roles = user.roles || user.role_names || [];
    for (var i = 0; i < roles.length; i++) {
      var roleName = getRoleName(roles[i]);
      if (roleName === 'system_admin' || roleName === 'org_admin') return true;
    }

    var directRole = getRoleName(user.role_name || user.role);
    return directRole === 'system_admin' || directRole === 'org_admin';
  }

  function isRestrictedPath() {
    var path = (window.location.pathname || '').toLowerCase();
    return path.indexOf('/admin/') !== -1;
  }

  function checkAuth(retries) {
    var token = localStorage.getItem('token');
    if (!token) {
      if (retries > 0) { setTimeout(function () { checkAuth(retries - 1); }, 100); return; }
      window.location.href = loginPath();
      return;
    }
    try {
      var user = JSON.parse(localStorage.getItem('user') || 'null');
      if (window.api) { api.token = token; api.user = user; }
      if (window.Lex && window.Lex.state) {
        Lex.state.setAuth(token, user);
        if (Lex.state.isTokenExpired) {
          Lex.state.clearAuth();
          window.location.href = loginPath();
          return;
        }
      }

      if (isRestrictedPath() && !hasAdminPageRole(user)) {
        window.location.href = accessDeniedPath();
        return;
      }
    } catch (e) {
      if (isRestrictedPath()) {
        window.location.href = accessDeniedPath();
      }
    }
  }
  checkAuth(3);

  // Forced password change (belt-and-suspenders): a user who already has a
  // stored token from a prior session — or who refreshes straight into a
  // protected page — never passes back through login.html's flag check. While
  // the account requires a password change, the server 403s every data endpoint
  // with code PASSWORD_CHANGE_REQUIRED. Intercept that at the single API chokepoint
  // (api.request) and route to the mandatory change-password screen. We re-throw
  // so existing per-call error handling is unaffected. This only fires on a real
  // server 403 signal, never on an absent/false flag.
  function changePasswordPath() {
    return (typeof getPagePath === 'function') ? getPagePath('change-password.html') : 'change-password.html';
  }
  function isPasswordChangeRequired(err) {
    if (!err) return false;
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') return true;
    return err.status === 403 && err.data && err.data.code === 'PASSWORD_CHANGE_REQUIRED';
  }
  (function installPasswordChangeGuard() {
    if (!window.api || typeof api.request !== 'function' || api.__pwChangeGuardInstalled) return;
    var originalRequest = api.request.bind(api);
    var redirecting = false;
    api.request = function () {
      return originalRequest.apply(api, arguments).catch(function (err) {
        if (isPasswordChangeRequired(err) && !redirecting) {
          var path = (window.location.pathname || '').toLowerCase();
          if (path.indexOf('change-password') === -1 && path.indexOf('login') === -1) {
            redirecting = true;
            window.location.href = changePasswordPath();
          }
        }
        throw err;
      });
    };
    api.__pwChangeGuardInstalled = true;
  })();

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

  // LANA One: load the edition-gated matters->workspaces terminology overlay on
  // every authenticated app page (auth-guard.js is the shared, end-of-body include).
  // The overlay self-gates on the LANA One edition, so this is inert in the org build.
  try {
    if (!document.getElementById('lana-one-terminology-loader')) {
      var _termScript = document.createElement('script');
      _termScript.id = 'lana-one-terminology-loader';
      _termScript.src = 'js/lana-one-terminology.js';
      _termScript.defer = true;
      (document.head || document.documentElement).appendChild(_termScript);
    }
  } catch (_e) { /* noop */ }
})();
