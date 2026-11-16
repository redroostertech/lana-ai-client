/**
 * Auth token bridge resolver.
 *
 * The login token lives in the main process (keychain encrypted). The preload
 * exposes it as window.lanaAuthToken, but the preload runs only in the top
 * window, not in subframes. Pages loaded in a same-origin iframe (connector
 * viewer, embedded file viewer, Doc Studio preview) reach the top window's
 * bridge instead. Cross-origin access is never attempted past a failed origin
 * check, and every access is wrapped so a SecurityError yields null.
 *
 * Loaded as a browser global (window.LanaAuthTokenBridge) before api.js, where
 * it also aliases the top bridge into a framed window, and as CommonJS for Jest.
 */
(function (global) {
  'use strict';

  function isFramed(win) {
    try {
      return !!win && !!win.top && win.top !== win;
    } catch (_error) {
      return true;
    }
  }

  function sameOriginTop(win) {
    try {
      var top = win.top;
      if (!top || top === win) return null;
      if (top.location.origin !== win.location.origin) return null;
      return top;
    } catch (_error) {
      return null;
    }
  }

  function resolve(win) {
    if (!win) return null;
    try {
      if (win.lanaAuthToken) return win.lanaAuthToken;
    } catch (_error) { /* fall through */ }
    if (!isFramed(win)) return null;
    var top = sameOriginTop(win);
    if (!top) return null;
    try {
      return top.lanaAuthToken || null;
    } catch (_error) {
      return null;
    }
  }

  function getToken(win) {
    var bridge = resolve(win);
    if (!bridge || typeof bridge.get !== 'function') return null;
    try {
      return bridge.get() || null;
    } catch (_error) {
      return null;
    }
  }

  // Framed pages without their own bridge read and refresh the top window's,
  // so every existing window.lanaAuthToken reader on the page works.
  function install(win) {
    if (!win || !isFramed(win)) return;
    try {
      if (win.lanaAuthToken) return;
    } catch (_error) {
      return;
    }
    var bridge = resolve(win);
    if (bridge) win.lanaAuthToken = bridge;
  }

  var AUTH_REQUIRED = 'lana-auth-required';

  // A framed page with no reachable token tells its parent instead of
  // navigating the frame to login; the parent owns the session. '*' because a
  // file:// origin is opaque and a named targetOrigin would not deliver; the
  // payload carries no secret.
  function notifyAuthRequired(win, reason) {
    if (!isFramed(win)) return false;
    try {
      win.parent.postMessage({ type: AUTH_REQUIRED, reason: reason || 'missing' }, '*');
      return true;
    } catch (_error) {
      return true;
    }
  }

  // Parent side: call onAuthRequired(frame, reason) when one of this window's
  // own iframes posts lana-auth-required. Messages from any other window are
  // ignored (event.source must be one of our iframes' windows).
  function listenForFramedAuthRequired(win, onAuthRequired) {
    if (!win || typeof win.addEventListener !== 'function') return;
    win.addEventListener('message', function (event) {
      var data = event && event.data;
      if (!data || typeof data !== 'object' || data.type !== AUTH_REQUIRED) return;
      if (!event.source) return;
      var frames = win.document ? win.document.querySelectorAll('iframe') : [];
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === event.source) {
          onAuthRequired(frames[i], data.reason || 'missing');
          return;
        }
      }
    });
  }

  // Host side, whole flow: when one of this window's iframes reports
  // lana-auth-required, unload that frame, close the lex-modal holding it and
  // run the page's own check. Without a check (pages that do not load
  // auth-guard.js), go to login only when this window has no token either.
  // Installs once per window and never in a frame.
  function installHostAuthListener(win, runCheck) {
    if (!win || isFramed(win) || win.__lanaFramedAuthListener) return;
    win.__lanaFramedAuthListener = true;
    listenForFramedAuthRequired(win, function (frame, reason) {
      try {
        var modal = frame.closest ? frame.closest('lex-modal') : null;
        frame.src = 'about:blank';
        if (modal) modal.open = false;
      } catch (_error) { /* noop */ }
      if (typeof runCheck === 'function') {
        runCheck(reason);
        return;
      }
      if (!getToken(win)) {
        win.location.href = typeof win.getLoginPath === 'function' ? win.getLoginPath() : 'login.html';
      }
    });
  }

  var api = {
    isFramed: isFramed,
    resolve: resolve,
    getToken: getToken,
    install: install,
    notifyAuthRequired: notifyAuthRequired,
    listenForFramedAuthRequired: listenForFramedAuthRequired,
    installHostAuthListener: installHostAuthListener
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global && typeof global.window !== 'undefined' && global === global.window) {
    global.LanaAuthTokenBridge = api;
    install(global);
  }
})(typeof window !== 'undefined' ? window : this);
