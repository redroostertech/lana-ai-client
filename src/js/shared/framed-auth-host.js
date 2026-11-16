/**
 * Host listener for pages that load app pages in iframes but do not load
 * auth-guard.js (index.html, matters.html, which run their own sign-in
 * checks). A child frame that cannot reach the login token posts
 * lana-auth-required; this closes its modal and goes to login only when this
 * window has no token either. Load after shared/auth-token-bridge.js.
 *
 * WARNING: never load this on a page that also loads auth-guard.js. The
 * listener installs once per window and the first install wins, so this
 * default check would replace auth-guard's own checkAuth.
 */
(function (global) {
  'use strict';
  if (global.LanaAuthTokenBridge) global.LanaAuthTokenBridge.installHostAuthListener(global);
})(window);
