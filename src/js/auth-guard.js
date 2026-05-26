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
