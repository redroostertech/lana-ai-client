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

  // A framed page reads the top window's token (the preload runs only there)
  // and never navigates itself to login: the parent owns the session and its
  // own guard handles sign-in, so the frame only tells the parent.
  var Bridge = window.LanaAuthTokenBridge || null;
  function readToken() {
    if (Bridge) return Bridge.getToken(window);
    return window.lanaAuthToken?.get() || null;
  }
  function isFramed() {
    if (Bridge) return Bridge.isFramed(window);
    try { return window.top !== window; } catch (_e) { return true; }
  }
  function requireLogin(reason) {
    if (isFramed()) {
      if (Bridge) Bridge.notifyAuthRequired(window, reason);
      return;
    }
    window.location.href = loginPath();
  }

  function checkAuth(retries) {
    var token = readToken();
    if (!token) {
      if (retries > 0) { setTimeout(function () { checkAuth(retries - 1); }, 100); return; }
      requireLogin('missing');
      return;
    }
    try {
      var user = JSON.parse(localStorage.getItem('user') || 'null');
      if (window.api) { api.token = token; api.user = user; }
      if (window.Lex && window.Lex.state) {
        Lex.state.setAuth(token, user);
        if (Lex.state.isTokenExpired) {
          // A frame must not clear the parent's session.
          if (isFramed()) { requireLogin('expired'); return; }
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

  // Host side: a page that loads app pages in iframes (connector modal, chat
  // citation viewer, Doc Studio preview) hears lana-auth-required from its
  // own child frames only, closes that frame's modal and runs its own check,
  // which handles sign-in normally.
  function onFramedAuthRequired(frame) {
    try {
      var modal = frame.closest ? frame.closest('lex-modal') : null;
      frame.src = 'about:blank';
      if (modal) modal.open = false;
    } catch (_e) { /* noop */ }
    checkAuth(0);
  }
  function installFramedAuthListener() {
    if (!Bridge || isFramed() || window.__lanaFramedAuthListener) return;
    window.__lanaFramedAuthListener = true;
    Bridge.listenForFramedAuthRequired(window, onFramedAuthRequired);
  }

  // Session policy redirects (belt-and-suspenders): a user who already has a
  // stored token from a prior session, or who refreshes straight into a
  // protected page, never passes back through login.html's checks. While the
  // account must change its password or enroll in MFA, the server 403s every
  // data endpoint with PASSWORD_CHANGE_REQUIRED or MFA_ENROLLMENT_REQUIRED.
  // Intercept that at the single API chokepoint (api.request) and route to the
  // matching screen. 403 IP_NOT_ALLOWED gets one plain message. We re-throw so
  // existing per-call error handling is unaffected. This only fires on a real
  // server signal, never on an absent/false flag. Codes: LanaSessionGate (api.js).
  function pagePath(name) {
    return (typeof getPagePath === 'function') ? getPagePath(name) : name;
  }
  var REDIRECTS = {
    password_change_required: 'change-password.html',
    mfa_enrollment_required: 'mfa-setup.html'
  };
  // Pages that are themselves the way out: never redirect away from them.
  var EXEMPT_PAGES = ['change-password', 'mfa-setup', 'login'];
  function refusalKind(err) {
    if (!err) return null;
    if (window.LanaSessionGate) return LanaSessionGate.refusalKind(err);
    return err.code === 'PASSWORD_CHANGE_REQUIRED' ? 'password_change_required' : null;
  }
  function showPlainMessage(text) {
    if (window.Lex && window.Lex.Toast && typeof Lex.Toast.error === 'function') Lex.Toast.error(text);
    else if (window.Toast && typeof Toast.error === 'function') Toast.error(text);
  }
  (function installSessionPolicyGuard() {
    if (!window.api || typeof api.request !== 'function' || api.__pwChangeGuardInstalled) return;
    var originalRequest = api.request.bind(api);
    var redirecting = false;
    var ipNoticeShown = false;
    api.request = function () {
      return originalRequest.apply(api, arguments).catch(function (err) {
        var kind = refusalKind(err);
        var target = kind && REDIRECTS[kind];
        if (target && !redirecting) {
          var path = (window.location.pathname || '').toLowerCase();
          var exempt = EXEMPT_PAGES.some(function (page) { return path.indexOf(page) !== -1; });
          if (!exempt) {
            redirecting = true;
            window.location.href = pagePath(target);
          }
        } else if (kind === 'ip_not_allowed' && !ipNoticeShown && window.LanaSessionGate) {
          ipNoticeShown = true;
          showPlainMessage(LanaSessionGate.message('ip_not_allowed'));
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
      // Beside this script, so a page in a subfolder (admin/) loads it from js/ too.
      var _guard = document.querySelector('script[src$="js/auth-guard.js"]');
      _termScript.src = _guard ? _guard.src.replace(/auth-guard\.js$/, 'lana-one-terminology.js') : 'js/lana-one-terminology.js';
      _termScript.defer = true;
      (document.head || document.documentElement).appendChild(_termScript);
    }
  } catch (_e) { /* noop */ }

  // Host listener for lana-auth-required (see onFramedAuthRequired above).
  if (Bridge) {
    installFramedAuthListener();
  } else {
    // Most host pages do not load the bridge; load it beside this script.
    try {
      var _guardEl = document.querySelector('script[src$="js/auth-guard.js"]');
      if (_guardEl) {
        var _bridgeScript = document.createElement('script');
        _bridgeScript.src = _guardEl.src.replace(/auth-guard\.js$/, 'shared/auth-token-bridge.js');
        _bridgeScript.onload = function () {
          Bridge = window.LanaAuthTokenBridge || null;
          installFramedAuthListener();
        };
        (document.head || document.documentElement).appendChild(_bridgeScript);
      }
    } catch (_e) { /* noop */ }
  }
})();
