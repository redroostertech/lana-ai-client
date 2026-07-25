/**
 * PAC Bridge (formerly "Lana Companion Bridge")
 *
 * Localhost HTTP server that lets the sibling PAC Electron app (package name
 * `pac`, was `lana-companion`) piggy-back on this client's signed-in session.
 * The on-the-wire app identifier is still the literal string `lana-companion`
 * for backwards compatibility with consent-store entries already on devices;
 * see KNOWN_APPS below. The bridge exposes a single endpoint:
 *
 *   POST /lana-bridge/companion/request-token
 *
 * Hard rules (do not relax without explicit product approval):
 *   - Bound to 127.0.0.1 ONLY. Never bind to 0.0.0.0 or any LAN interface.
 *   - Refuses any request whose remote address is not loopback (IPv4 or IPv6).
 *   - Refuses Host headers that are not loopback.
 *   - Never logs the bearer token (or any prefix/suffix) to console / log file.
 *   - Never caches the bearer token on this module beyond a single request.
 *
 * UX:
 *   - If the user already chose "Always allow on this device" for a given
 *     companion app + currently signed-in user, requests succeed silently.
 *   - Otherwise we prompt the user. The preferred path is an in-app Lex modal
 *     driven through the renderer (see `requestConsentFromRenderer` in
 *     electron-main.js + src/js/companion-bridge-consent.js). A native
 *     `dialog.showMessageBox` is used as a fallback only when there is no
 *     usable BrowserWindow (e.g., the user closed the window but the app is
 *     still alive on the macOS dock).
 *
 * Storage:
 *   - Always-allow decisions are stored in a dedicated `electron-store`
 *     instance named `bridge-consents`. Shape:
 *
 *       {
 *         "lana-companion": {
 *           mode: "always-allow",
 *           granted_at: "2026-05-15T12:34:56.789Z",
 *           granted_user_id: "<userId from current session>"
 *         }
 *       }
 *
 *     Consent is tied to the granting user — if the current user changes,
 *     the saved consent is treated as stale and we re-prompt.
 *
 * Lifecycle:
 *   - `start(deps)` is called from `app.whenReady()` in electron-main.js.
 *   - `stop()` is called from `before-quit`.
 *   - If port 7890 is already in use we log a warning and skip starting; we
 *     never crash the host app for a bridge failure.
 */

const http = require('node:http');
const https = require('node:https');
const Store = require('electron-store');
const { app, dialog, BrowserWindow } = require('electron');
const { logInfo, logError } = require('./electron-logger');

const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 7890;
const BRIDGE_PATH = '/lana-bridge/companion/request-token';
const MAX_BODY_BYTES = 16 * 1024; // 16 KB is plenty for the request shape
const KNOWN_APPS = new Set(['lana-companion', 'lana-brain', 'lana-extension']);

// The browser extension is a companion too, but it runs in the browser sandbox,
// so it must NOT receive the desktop's raw session token. Instead the bridge
// mints a SCOPED, app-gated, revocable token for it via the backend
// POST /api/v1/oauth/provision (client_id=lana-extension). See
// ai-context-bridge/docs/IDENTITY_AND_ROAMING.md.
const SCOPED_TOKEN_APPS = new Set(['lana-extension']);

// Human-readable requester names for consent prompts — informed consent requires
// naming the ACTUAL app (review MEDIUM), not a hardcoded one.
const APP_LABELS = {
  'lana-companion': 'PAC',
  'lana-brain': 'Lana Brain',
  'lana-extension': 'LANA Chrome extension',
};
function appLabel(appName) { return APP_LABELS[appName] || 'this companion application'; }
// Max time we'll wait for the renderer to answer the in-app consent modal
// before treating the request as denied. The modal should give the user
// enough time to read, but a forgotten/ignored prompt must not pin the HTTP
// response open indefinitely.
const RENDERER_CONSENT_TIMEOUT_MS = 90 * 1000;

// Reasonable allowlist of Host header values that resolve to loopback.
// We accept the literal IPs and `localhost`. Port may or may not be present.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

let server = null;
let consentStore = null;
let deps = null;
// Single in-flight prompt per app, so a flood of requests from a misbehaving
// companion can't stack up multiple native dialogs.
const pendingPrompts = new Map();

function initConsentStore() {
  if (consentStore) return consentStore;
  consentStore = new Store({
    name: 'bridge-consents',
    defaults: {
      // settings UI for revocation can read/write under this key
      consents: {}
    }
  });
  return consentStore;
}

function getConsent(appName) {
  try {
    const all = initConsentStore().get('consents', {});
    return all && all[appName] ? all[appName] : null;
  } catch (error) {
    logError('[electron-bridge] Failed to read consent store', error);
    return null;
  }
}

function setConsent(appName, record) {
  try {
    const store = initConsentStore();
    const all = store.get('consents', {}) || {};
    all[appName] = record;
    store.set('consents', all);
    return true;
  } catch (error) {
    logError('[electron-bridge] Failed to write consent store', error);
    return false;
  }
}

function isLoopbackRemote(remoteAddress) {
  if (!remoteAddress) return false;
  // Node may report IPv4-mapped IPv6 addresses like "::ffff:127.0.0.1"
  if (remoteAddress === '127.0.0.1' || remoteAddress === '::1') return true;
  if (remoteAddress.startsWith('::ffff:127.')) return true;
  return false;
}

function isLoopbackHostHeader(hostHeader) {
  if (!hostHeader) return false;
  // Strip optional port. IPv6 literals are bracketed: "[::1]:7890".
  let host = String(hostHeader).trim();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return false;
    host = host.slice(0, end + 1);
  } else {
    const colon = host.indexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }
  return LOOPBACK_HOSTNAMES.has(host.toLowerCase());
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    // Loopback-only API; explicitly deny browser cross-origin use.
    'Access-Control-Allow-Origin': 'null'
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('payload_too_large');
        err.code = 'PAYLOAD_TOO_LARGE';
        reject(err);
        try { req.destroy(); } catch (_) { /* noop */ }
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_err) {
        const err = new Error('invalid_json');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * Pick a usable BrowserWindow to host the Lex consent modal. Prefers the
 * focused window, then any visible non-destroyed window, then the first
 * window in `getAllWindows()`. Returns null when no window is available
 * (the caller must fall back to the native dialog).
 */
function pickRendererWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;

  const all = BrowserWindow.getAllWindows();
  for (const win of all) {
    if (win && !win.isDestroyed() && win.isVisible()) return win;
  }
  for (const win of all) {
    if (win && !win.isDestroyed()) return win;
  }
  return null;
}

function focusConsentWindow(win) {
  if (!win || win.isDestroyed()) return;
  try {
    if (typeof win.isMinimized === 'function' && win.isMinimized()) {
      win.restore();
    }
    if (typeof win.show === 'function') {
      win.show();
    }
    if (app && typeof app.focus === 'function') {
      app.focus({ steal: true });
    }
    if (typeof win.focus === 'function') {
      win.focus();
    }
  } catch (error) {
    logError('[electron-bridge] Failed to focus consent window', error);
  }
}

/**
 * Show the in-app Lex consent modal via the renderer. Resolves to:
 *   { allow: boolean, alwaysAllow: boolean }
 *
 * Throws if no `requestConsentFromRenderer` callback was supplied via
 * `start(deps)`. Returns `{ allow: false, alwaysAllow: false }` on timeout
 * so the caller can treat a forgotten prompt as a denial without leaving
 * the HTTP response pinned open forever.
 */
async function promptForConsentViaRenderer(appName) {
  if (!deps || typeof deps.requestConsentFromRenderer !== 'function') {
    const err = new Error('renderer_consent_unavailable');
    err.code = 'RENDERER_CONSENT_UNAVAILABLE';
    throw err;
  }

  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      logInfo(`[electron-bridge] Renderer consent prompt for ${appName} timed out; treating as denied`);
      resolve({ allow: false, alwaysAllow: false, timedOut: true });
    }, RENDERER_CONSENT_TIMEOUT_MS);
  });

  try {
    const decision = await Promise.race([
      Promise.resolve(deps.requestConsentFromRenderer({ app: appName })),
      timeoutPromise
    ]);

    return {
      allow: Boolean(decision && decision.allow),
      alwaysAllow: Boolean(decision && decision.alwaysAllow)
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Show the native macOS/Windows/Linux consent dialog. Used as a FALLBACK
 * only — see `promptForConsent`. Returns:
 *   { allow: boolean, alwaysAllow: boolean }
 */
async function promptForConsentViaNativeDialog(appName, parentWindow) {
  const label = appLabel(appName);
  const dialogOptions = {
    type: 'question',
    title: `${label} is requesting access`,
    message: `${label} is requesting access`,
    detail: `Allow ${label} to connect to your current Lana session on this device?`,
    buttons: ['Allow', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: 'Always allow on this device',
    checkboxChecked: false,
    noLink: true
  };

  let result;
  try {
    if (parentWindow) {
      result = await dialog.showMessageBox(parentWindow, dialogOptions);
    } else {
      result = await dialog.showMessageBox(dialogOptions);
    }
  } catch (error) {
    logError('[electron-bridge] Native consent dialog failed', error);
    return { allow: false, alwaysAllow: false };
  }

  return {
    allow: result.response === 0,
    alwaysAllow: Boolean(result.checkboxChecked)
  };
}

/**
 * Prompt the user for consent. Routes through:
 *   1. The in-app Lex modal in the renderer (preferred).
 *   2. The native `dialog.showMessageBox` if the renderer is unreachable
 *      (no visible BrowserWindow, no callback wired in, or the renderer
 *      throws). This fallback is intentionally rare.
 *
 * Returns: { allow: boolean, alwaysAllow: boolean }
 */
async function promptForConsent(appName) {
  // Coalesce concurrent prompts for the same app to a single dialog.
  if (pendingPrompts.has(appName)) {
    return pendingPrompts.get(appName);
  }

  const promise = (async () => {
    const rendererWindow = pickRendererWindow();
    const canUseRenderer =
      Boolean(rendererWindow) &&
      deps &&
      typeof deps.requestConsentFromRenderer === 'function';

    if (canUseRenderer) {
      try {
        focusConsentWindow(rendererWindow);
        return await promptForConsentViaRenderer(appName);
      } catch (error) {
        // Fall through to native dialog on renderer failure (modal load
        // error, IPC handler missing, etc). We must still ask the user.
        logError('[electron-bridge] Renderer consent prompt failed; falling back to native dialog', error);
      }
    } else {
      logInfo('[electron-bridge] No renderer window available; using native consent dialog fallback');
    }

    if (rendererWindow) focusConsentWindow(rendererWindow);
    return promptForConsentViaNativeDialog(appName, rendererWindow);
  })();

  pendingPrompts.set(appName, promise);
  try {
    return await promise;
  } finally {
    pendingPrompts.delete(appName);
  }
}

function buildServerPayload(savedServer) {
  if (!savedServer) return null;
  return {
    url: savedServer.url || null,
    orgId: savedServer.orgId || null,
    orgName: savedServer.orgName || null,
    version: savedServer.version || null,
    apiVersion: savedServer.apiVersion || null
  };
}

/**
 * Mint a SCOPED extension token via the backend, using the desktop's own session
 * bearer to authenticate. The browser extension never sees the session token —
 * only this app-gated, revocable token. Returns { access_token, refresh_token,
 * token_type, expires_in }. Throws on any non-2xx / transport error.
 *
 * The session bearer is passed only in the Authorization header to the tenant's
 * own backend over its configured (https, or http-loopback in dev) origin.
 */
function provisionScopedToken(serverUrl, sessionToken, clientId) {
  return new Promise((resolve, reject) => {
    let u;
    // Preserve any base path in the tenant URL (e.g. https://host/lana) rather
    // than dropping it with an absolute-path URL (review INFO).
    try { u = new URL(String(serverUrl).replace(/\/+$/, '') + '/api/v1/oauth/provision'); } catch (e) { reject(new Error('bad_server_url')); return; }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHostHeader(u.host))) {
      reject(new Error('insecure_server_url')); return;
    }
    const payload = Buffer.from(JSON.stringify({ client_id: clientId }), 'utf8');
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        Authorization: `Bearer ${sessionToken}`,
      },
      timeout: 15000,
    }, (resp) => {
      const chunks = [];
      let total = 0;
      let aborted = false;
      const MAX_RESP_BYTES = 64 * 1024; // a token response is tiny; cap by bytes + destroy (review LOW)
      resp.on('data', (c) => {
        if (aborted) return;
        total += c.length;
        if (total > MAX_RESP_BYTES) { aborted = true; req.destroy(new Error('provision_response_too_large')); return; }
        chunks.push(c);
      });
      resp.on('end', () => {
        if (aborted) return;
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        if (resp.statusCode >= 200 && resp.statusCode < 300 && body && body.access_token) resolve(body);
        else reject(new Error((body && body.error) ? body.error : `provision_http_${resp.statusCode}`));
      });
    });
    req.on('error', () => reject(new Error('provision_unreachable')));
    req.on('timeout', () => { req.destroy(new Error('provision_timeout')); });
    req.end(payload);
  });
}

async function handleRequestToken(req, res) {
  // 1. Origin / IP guard.
  const remote = req.socket && req.socket.remoteAddress;
  if (!isLoopbackRemote(remote)) {
    // Don't disclose anything useful to a non-loopback caller.
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
    return;
  }

  if (!isLoopbackHostHeader(req.headers && req.headers.host)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad host');
    return;
  }

  // 2. Parse + validate body.
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err && err.code === 'PAYLOAD_TOO_LARGE') {
      writeJson(res, 413, { error: 'payload_too_large' });
    } else {
      writeJson(res, 400, { error: 'invalid_body' });
    }
    return;
  }

  const appName = body && typeof body.app === 'string' ? body.app : null;
  if (!appName || !KNOWN_APPS.has(appName)) {
    writeJson(res, 400, { error: 'unknown_app' });
    return;
  }

  // 3. Sign-in check (token + user).
  let token = null;
  let currentUserId = null;
  try {
    token = await deps.getToken();
  } catch (error) {
    logError('[electron-bridge] getToken failed', error);
    token = null;
  }
  try {
    currentUserId = await deps.getCurrentUserId();
  } catch (error) {
    logError('[electron-bridge] getCurrentUserId failed', error);
    currentUserId = null;
  }

  if (!token) {
    writeJson(res, 401, { error: 'not_signed_in' });
    return;
  }

  // 4. Consent check — honor "always allow" if it matches the current user.
  let savedConsent = getConsent(appName);
  let alreadyAllowed = false;
  if (
    savedConsent &&
    savedConsent.mode === 'always-allow' &&
    savedConsent.granted_user_id &&
    currentUserId &&
    String(savedConsent.granted_user_id) === String(currentUserId)
  ) {
    alreadyAllowed = true;
  } else if (savedConsent) {
    // Stale (different user, or missing user id, or unknown mode). Discard.
    logInfo(`[electron-bridge] Discarding stale consent for ${appName} (user changed)`);
  }

  if (!alreadyAllowed) {
    const decision = await promptForConsent(appName);
    if (!decision.allow) {
      writeJson(res, 403, { error: 'denied' });
      return;
    }
    if (decision.alwaysAllow && currentUserId) {
      setConsent(appName, {
        mode: 'always-allow',
        granted_at: new Date().toISOString(),
        granted_user_id: currentUserId
      });
      logInfo(`[electron-bridge] Stored always-allow consent for ${appName}`);
    }
  }

  // 5. Resolve server info and respond.
  let savedServer = null;
  try {
    savedServer = await deps.getSavedServer();
  } catch (error) {
    logError('[electron-bridge] getSavedServer failed', error);
  }

  const serverPayload = buildServerPayload(savedServer);
  if (!serverPayload || !serverPayload.url) {
    // We have a token but no server info — treat as not-ready.
    writeJson(res, 401, { error: 'not_signed_in' });
    return;
  }

  // Browser extension: hand back a SCOPED token (minted server-side), never the
  // raw desktop session token. PAC/desktop siblings keep the session-share path.
  if (SCOPED_TOKEN_APPS.has(appName)) {
    let scoped;
    try {
      scoped = await provisionScopedToken(serverPayload.url, token, appName);
    } catch (error) {
      logError('[electron-bridge] scoped token provisioning failed', error);
      writeJson(res, 502, { error: error && error.message === 'insecure_server_url' ? 'insecure_server_url' : 'provision_failed' });
      return;
    }
    writeJson(res, 200, {
      account: {
        instanceUrl: serverPayload.url,
        accessToken: scoped.access_token,
        refreshToken: scoped.refresh_token || null,
        tokenType: scoped.token_type || 'Bearer',
        expiresIn: scoped.expires_in || null,
      },
    });
    return;
  }

  writeJson(res, 200, {
    token,
    server: serverPayload
  });
}

function createRequestHandler() {
  return async (req, res) => {
    try {
      // Health/ping path responds 204 to loopback only — handy for the
      // companion to test "is the bridge here?" without triggering a dialog.
      if (req.method === 'GET' && (req.url === '/lana-bridge/health' || req.url === '/lana-bridge/health/')) {
        const remote = req.socket && req.socket.remoteAddress;
        if (!isLoopbackRemote(remote)) {
          res.writeHead(403); res.end(); return;
        }
        if (!isLoopbackHostHeader(req.headers && req.headers.host)) {
          res.writeHead(400); res.end(); return;
        }
        res.writeHead(204); res.end();
        return;
      }

      if (req.method !== 'POST' || req.url !== BRIDGE_PATH) {
        writeJson(res, 404, { error: 'not_found' });
        return;
      }

      await handleRequestToken(req, res);
    } catch (error) {
      logError('[electron-bridge] Unhandled request error', error);
      try {
        writeJson(res, 500, { error: 'internal_error' });
      } catch (_) { /* socket may already be closed */ }
    }
  };
}

/**
 * Start the bridge server.
 * @param {Object} dependencies
 * @param {() => (string|null|Promise<string|null>)} dependencies.getToken
 *        Returns the current bearer token (or null/undefined when unsigned).
 *        MUST NOT cache; called per-request.
 * @param {() => (Object|null|Promise<Object|null>)} dependencies.getSavedServer
 *        Returns the saved server descriptor (url, orgId, orgName, version, apiVersion).
 * @param {() => (string|null|Promise<string|null>)} dependencies.getCurrentUserId
 *        Returns the currently signed-in user id (used to scope consent).
 * @param {(payload: { app: string }) => Promise<{ allow: boolean, alwaysAllow: boolean }>} [dependencies.requestConsentFromRenderer]
 *        Optional. Asks the renderer to display the in-app Lex consent modal
 *        and resolves with the user's decision. When omitted, or when no
 *        BrowserWindow is available, the bridge falls back to the native
 *        `dialog.showMessageBox` flow. The renderer side lives in
 *        `src/js/companion-bridge-consent.js`.
 * @param {Function} [dependencies.getSettings] reserved for future use.
 * @param {Function} [dependencies.setSettings] reserved for future use.
 */
function start(dependencies) {
  if (server) {
    logInfo('[electron-bridge] start() called but server is already running');
    return;
  }
  if (
    !dependencies ||
    typeof dependencies.getToken !== 'function' ||
    typeof dependencies.getSavedServer !== 'function' ||
    typeof dependencies.getCurrentUserId !== 'function'
  ) {
    logError('[electron-bridge] start() missing required dependencies; bridge will not start');
    return;
  }

  deps = dependencies;
  initConsentStore();

  const handler = createRequestHandler();
  server = http.createServer(handler);

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      logInfo(`[electron-bridge] Port ${BRIDGE_PORT} already in use, skipping bridge startup`);
      try { server.close(); } catch (_) { /* noop */ }
      server = null;
      return;
    }
    logError('[electron-bridge] HTTP server error', error);
  });

  server.on('clientError', (err, socket) => {
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } catch (_) { /* noop */ }
  });

  try {
    server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      logInfo(`[electron-bridge] Listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}${BRIDGE_PATH}`);
    });
  } catch (error) {
    logError('[electron-bridge] Failed to start listening', error);
    server = null;
  }
}

function stop() {
  if (!server) return;
  const closing = server;
  server = null;
  try {
    closing.close((err) => {
      if (err) logError('[electron-bridge] Error closing server', err);
      else logInfo('[electron-bridge] Server stopped');
    });
  } catch (error) {
    logError('[electron-bridge] stop() threw', error);
  }
}

module.exports = {
  start,
  stop,
  // Exported for tests / debug only — not for normal callers.
  _internals: {
    appLabel,
    focusConsentWindow,
    isLoopbackRemote,
    isLoopbackHostHeader,
    BRIDGE_HOST,
    BRIDGE_PORT,
    BRIDGE_PATH
  }
};
