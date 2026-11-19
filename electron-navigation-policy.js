'use strict';

/**
 * What a main-frame navigation in any app window may do (will-navigate and
 * will-redirect in electron-main.js). Window opens are decided separately by
 * electron-window-open-policy.js.
 *
 *  - The app's own pages (lana-app://app/public_html/...): allowed.
 *  - Root-relative app paths (a link to /workspaces.html resolves to
 *    lana-app://app/workspaces.html): rewritten into /public_html/.
 *  - A file:// URL of a page inside public_html (an old link): rewritten to its
 *    app URL. Any other file:// URL: denied.
 *  - http(s) and mailto: opened in the system browser when
 *    src/electron-external-url.js allows the URL; the window stays put.
 *  - Everything else (javascript:, data:, blob:, chrome:, other schemes): denied.
 *
 * Pure: no Electron imports.
 */

const {
  APP_ROOT_PATH,
  isAppUrl,
  appPageUrl,
  appUrlForFileUrl
} = require('./electron-app-protocol');
const { isAllowedExternalUrl } = require('./src/electron-external-url');

const ALLOW = Object.freeze({ action: 'allow' });
const DENY = Object.freeze({ action: 'deny' });

/**
 * @param {string} url
 * @param {{ appRoot: string }} options - absolute path of public_html
 * @returns {{ action: 'allow' } | { action: 'deny' } | { action: 'redirect', url: string } | { action: 'external', url: string }}
 */
function decideNavigation(url, { appRoot } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    return DENY;
  }

  if (isAppUrl(parsed.href)) {
    if (parsed.pathname.startsWith(APP_ROOT_PATH)) return ALLOW;
    const page = parsed.pathname.replace(/^\/+/, '');
    if (!page) return { action: 'redirect', url: appPageUrl('dashboard.html') + parsed.search + parsed.hash };
    return { action: 'redirect', url: appPageUrl(page) + parsed.search + parsed.hash };
  }

  switch (parsed.protocol) {
    case 'file:': {
      const appUrl = appUrlForFileUrl(parsed.href, appRoot);
      return appUrl ? { action: 'redirect', url: appUrl } : DENY;
    }
    case 'http:':
    case 'https:':
    case 'mailto:':
      if (!isAllowedExternalUrl(parsed.href)) return DENY;
      parsed.username = '';
      parsed.password = '';
      return { action: 'external', url: parsed.href };
    default:
      return DENY;
  }
}

// Schemes a frame inside a page may load in place: the app, the web, and the
// in-page ones previews and embeds use.
const FRAME_SCHEMES = new Set(['lana-app:', 'http:', 'https:', 'blob:', 'about:', 'data:']);

/**
 * A subframe navigation (will-frame-navigate in electron-main.js). Web content and app
 * pages load in the frame (the page CSP's frame-src still decides what may). Any other
 * scheme would make Chromium hand the URL to the operating system (foo://, ms-settings:):
 * the frame never goes there, and mail or vault links go through the app's opener
 * (electron-external-open.js) instead.
 * @returns {{ action: 'allow' } | { action: 'deny' } | { action: 'external', url: string }}
 */
function decideFrameNavigation(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    return DENY;
  }
  if (FRAME_SCHEMES.has(parsed.protocol)) return ALLOW;
  if ((parsed.protocol === 'mailto:' || parsed.protocol === 'brainchild:') && isAllowedExternalUrl(parsed.href)) {
    return { action: 'external', url: parsed.href };
  }
  return DENY;
}

module.exports = { decideNavigation, decideFrameNavigation };
