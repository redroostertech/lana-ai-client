'use strict';

/**
 * The Content Security Policy for the app's own pages (docs/plans/harden-web.md).
 *
 * Built for every page the app protocol serves (electron-app-protocol.js), from
 * the live configuration: the saved server (Chef, Forge, burst), the local AI
 * engine, the local editor service, the control plane and the embedded apps the
 * firm's discovery lists. The builder accepts plain http(s) origins only: no
 * '*', no scheme sources, no paths.
 *
 * Pure: no Electron imports.
 */

// The pages that talk to a firm before it is saved here, so its origin cannot be in
// the policy the page loads with (a page's CSP is fixed at load):
//  - login.html: Connect resolves the Organization ID (discovery runs in the main
//    process), then the page checks that server's /api/health/discovery and signs in to
//    it; "Use a custom server" lets the person type any address. Both happen on the
//    page that loaded before the firm was known.
//  - activate.html: an Organization ID typed on the page resolves to a firm, and the
//    activation is posted to it before it is saved.
// They get connect-src https: http: (and no other broad source); they render no firm data.
// Every other page, first-launch.html included (it fetches nothing), gets only the
// configured origins. tests/unit/electron-csp.test.js pins this list.
const SIGN_IN_PAGES = Object.freeze(['login.html', 'activate.html']);

/**
 * Pages whose own scripts build inline event handlers in markup strings
 * (onclick="fn('${id}')"). Their text varies, so no hash can allow them; such a
 * page would need 'unsafe-inline' for script. The list is empty: every page
 * uses js/shared/dom-actions.js instead, and tests/unit/electron-csp-debt.test.js
 * fails if a page needs to come back on it.
 */
const INLINE_HANDLER_DEBT_PAGES = Object.freeze([]);

function originOf(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  // Letters, digits, dots and hyphens only (the parser lets ; ' , and more through,
  // which could end a CSP source list); the port is the parser's, digits only.
  if (!/^[a-z0-9.-]+$/.test(parsed.hostname)) return null;
  return parsed.origin;
}

function uniqueOrigins(values) {
  const out = [];
  for (const value of values || []) {
    const origin = originOf(value);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/** Https origins of the embedded apps a discovery payload lists (js/app-catalog.js shapes). */
function embedOriginsOf(enabledApps) {
  const out = [];
  for (const item of Array.isArray(enabledApps) ? enabledApps : []) {
    if (!item || typeof item !== 'object') continue;
    const route = item.route && typeof item.route === 'object' ? item.route : (item.embed && typeof item.embed === 'object' ? item.embed : null);
    if (!route || route.type !== 'embedded' || typeof route.url !== 'string') continue;
    const origin = originOf(route.url);
    if (origin && origin.startsWith('https:') && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * Origins from configuration.
 * @param {Object} config
 * @param {Object|null} config.savedServer - electron-storage getSavedServer() (url, chefUrl, forgeUrl, burstUrl, enabledApps)
 * @param {string|null} config.engineUrl - the local AI engine's loopback URL, when it runs
 * @param {string|null} config.editorUrl - the local editor service's loopback URL, when it runs
 * @param {string[]} config.controlPlaneUrls - discovery and help endpoints
 * @param {string[]} config.storageOrigins - where Chef's presigned storage links point (Chef discovery)
 * @returns {{ api: string[], editor: string[], embed: string[] }}
 */
function cspOriginsFromConfig({ savedServer = null, engineUrl = null, editorUrl = null, controlPlaneUrls = [], storageOrigins = [] } = {}) {
  const server = savedServer && typeof savedServer === 'object' ? savedServer : {};
  const editor = uniqueOrigins([editorUrl]);
  const api = uniqueOrigins([
    server.url, server.chefUrl, server.forgeUrl, server.burstUrl,
    engineUrl, editorUrl,
    ...(Array.isArray(controlPlaneUrls) ? controlPlaneUrls : []),
    ...(Array.isArray(storageOrigins) ? storageOrigins : [])
  ]);
  return { api, editor, embed: embedOriginsOf(server.enabledApps) };
}

function isDebtPage(page) {
  return INLINE_HANDLER_DEBT_PAGES.includes(String(page || ''));
}

function isSignInPage(page) {
  return SIGN_IN_PAGES.includes(String(page || ''));
}

/**
 * @param {Object} input
 * @param {string|null} input.page - path under public_html ('admin/users.html')
 * @param {string} input.nonce - this response's nonce
 * @param {string[]} input.handlerHashes - "'sha256-...'" of the page's inline handlers
 * @param {{ api: string[], editor: string[], embed: string[] }} input.origins - cspOriginsFromConfig()
 * @returns {string}
 */
function buildContentSecurityPolicy({ page = null, nonce = '', handlerHashes = [], origins = {} } = {}) {
  const api = uniqueOrigins(origins.api);
  const editor = uniqueOrigins(origins.editor);
  const embed = uniqueOrigins(origins.embed).filter((o) => o.startsWith('https:'));
  const hashes = (handlerHashes || []).filter((h) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(h));

  const script = ["'self'"];
  if (isDebtPage(page)) {
    script.push("'unsafe-inline'");
  } else {
    if (nonce && /^[A-Za-z0-9+/=]+$/.test(nonce)) script.push(`'nonce-${nonce}'`);
    if (hashes.length) script.push("'unsafe-hashes'", ...hashes);
  }
  // The LANA editor's modules load from the editor service (file viewer, file editor).
  script.push(...editor);

  const connect = ["'self'", ...api];
  if (isSignInPage(page)) connect.push('https:', 'http:');

  const directives = [
    ["default-src", ["'self'"]],
    ['script-src', script],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...api]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connect],
    ['frame-src', ["'self'", 'blob:', ...api, ...embed]],
    ['worker-src', ["'self'", 'blob:']],
    // lana-audio: LANA Briefs replay (electron-briefs.js BRIEFS_AUDIO_SCHEME).
    ['media-src', ["'self'", 'data:', 'blob:', 'lana-audio:', ...api]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'self'"]]
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

module.exports = {
  SIGN_IN_PAGES,
  INLINE_HANDLER_DEBT_PAGES,
  originOf,
  embedOriginsOf,
  cspOriginsFromConfig,
  buildContentSecurityPolicy,
  isDebtPage
};
