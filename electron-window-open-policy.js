'use strict';

/**
 * Decides what happens when any frame in an app window calls window.open
 * (or follows a target=_blank link). Used by both app windows'
 * setWindowOpenHandler in electron-main.js.
 *
 * Why: previews of remote http(s) PDFs run unsandboxed (Chromium's PDF viewer
 * needs that), so a hostile document could try window.open('about:blank'),
 * a blob:, data: or javascript: URL, or a local file. Measured in Electron
 * 44.7.0: popups already get no preload and webSecurity on by default. This
 * policy pins that explicitly so an Electron upgrade cannot regress it, and
 * denies the schemes no app code uses.
 *
 *  - http(s) and mailto: opened by the system browser or mail app (as
 *    before), parsed href only.
 *  - about:blank, '' and blob:: opened isolated (no preload, sandbox and web
 *    security on, no plugins). No app code opens these today; kept for
 *    print or dynamic content.
 *  - the app's own pages (lana-app://app/public_html/..., resolved real path
 *    inside public_html), opened with the same isolated options. file: and
 *    everything else is denied.
 *  - javascript:, data:, about:srcdoc, chrome: and anything unparsable: denied.
 */

const { APP_SCHEME, resolveAppFile } = require('./electron-app-protocol');

const ISOLATED_POPUP_OPTIONS = Object.freeze({
  webPreferences: Object.freeze({
    preload: undefined,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    plugins: false
  })
});

const DENY = Object.freeze({ response: Object.freeze({ action: 'deny' }) });
const ALLOW_ISOLATED = Object.freeze({
  response: Object.freeze({ action: 'allow', overrideBrowserWindowOptions: ISOLATED_POPUP_OPTIONS })
});

// Inside public_html lexically and after symlinks resolve (resolveAppFile),
// so neither '..' nor a symlink can escape.
function isAppPage(parsed, appRoot) {
  return Boolean(appRoot) && resolveAppFile(parsed.href, appRoot) !== null;
}

/**
 * @param {string} url - the URL window.open asked for
 * @param {{ appRoot?: string }} options - appRoot: absolute path of public_html
 * @returns {{ external: string } | { response: object }}
 *   external: open this parsed http(s) href with shell.openExternal and deny;
 *   response: return it from setWindowOpenHandler as is.
 */
function decideWindowOpen(url, options) {
  const appRoot = options && options.appRoot;
  if (url === '' || url === undefined || url === null) return ALLOW_ISOLATED;

  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    return DENY;
  }

  switch (parsed.protocol) {
    case 'http:':
    case 'https:':
      parsed.username = '';
      parsed.password = '';
      return { external: parsed.href };
    case 'mailto:':
      return { external: parsed.href };
    case 'about:':
      return parsed.href === 'about:blank' ? ALLOW_ISOLATED : DENY;
    case 'blob:':
      return ALLOW_ISOLATED;
    case `${APP_SCHEME}:`:
      return isAppPage(parsed, appRoot) ? ALLOW_ISOLATED : DENY;
    default:
      return DENY;
  }
}

module.exports = { decideWindowOpen, ISOLATED_POPUP_OPTIONS };
