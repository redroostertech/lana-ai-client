'use strict';

/**
 * The LANA document editor on this computer. Main process.
 *
 * The client ships lana-editor (scripts/fetch-lana-editor.js builds it into build/lana-editor;
 * an installed app has it at <resources>/lana-editor). This module runs its service,
 * packages/redline-service/dist/server.bundle.mjs, with this app's Electron as Node
 * (ELECTRON_RUN_AS_NODE=1). The service serves the editor's browser modules (/kernel, /editor,
 * /embed, /pdfjs, /editor-fonts) and its document API (/v1), so a document opened or edited in
 * the app is read and rendered on this computer and its bytes do not go to the organization's
 * server until the person saves a new version.
 *
 * Each launch it gets a free loopback port and a new 32-byte bearer token. The service listens
 * on 127.0.0.1 only and asks for the token on every /v1 call except /v1/health. The renderer is
 * given only the address (editor-service:base-url-sync); the token stays in this process, which
 * adds it to the app's own requests to /v1 (authorizeEditorRequest, from the session's
 * onBeforeSendHeaders). Restarts keep the port and the token, so pages already open keep
 * working. The signing keys live in <userData>/lana-editor/keys.
 *
 * Ready means /v1/health answers ok for @lana/redline-service and, while starting, an
 * authorized /v1/manifests/public-key call succeeds (the token is accepted and the keys load).
 * Restarts, backoff and stopping are electron-process-keeper.js.
 *
 * Where the service is, in this order:
 *   LANA_EDITOR_BUNDLE   a lana-editor checkout's packages/redline-service/dist/server.bundle.mjs
 *                        (developers, unpackaged runs only)
 *   <resources>/lana-editor/...  in an installed app
 *   build/lana-editor/...        in a development run
 * None: the editor does not start, and documents open read-only.
 */

const path = require('path');
const crypto = require('crypto');
const { createKeptProcess, DEFAULTS } = require('./electron-process-keeper');

const HOST = '127.0.0.1';
const SERVICE_NAME = '@lana/redline-service';
const ENTRY = path.join('packages', 'redline-service', 'dist', 'server.bundle.mjs');

// Only these reach the service from the client's environment.
const INHERITED_ENV = [
  'PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'TZ',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'
];

const EDITOR_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  // A plain Node server; it answers in about a second, longer on a cold disk.
  startTimeoutMs: 30000,
  healthIntervalStartingMs: 250
});

/**
 * The service's script, or null when there is none.
 * @returns {string|null}
 */
function resolveEditorServiceScript({ env = {}, resourcesPath = null, isPackaged = false, appRoot, fileExists }) {
  if (!isPackaged && typeof env.LANA_EDITOR_BUNDLE === 'string' && env.LANA_EDITOR_BUNDLE.trim()) {
    const file = path.resolve(env.LANA_EDITOR_BUNDLE.trim());
    return fileExists(file) ? file : null;
  }
  const root = isPackaged ? (resourcesPath && path.join(resourcesPath, 'lana-editor')) : (appRoot && path.join(appRoot, 'build', 'lana-editor'));
  if (!root) {return null;}
  const file = path.join(root, ENTRY);
  return fileExists(file) ? file : null;
}

/** The service's environment: OS basics and its own settings. Nothing else of the client's. */
function editorServiceEnv(baseEnv, { port, token, keyDir, root }) {
  const out = {};
  for (const name of INHERITED_ENV) {
    if (typeof baseEnv[name] === 'string') {out[name] = baseEnv[name];}
  }
  return {
    ...out,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    LANA_EDITOR_HOST: HOST,
    LANA_EDITOR_PORT: String(port),
    LANA_EDITOR_SERVICE_TOKEN: token,
    LANA_EDITOR_KEY_DIR: keyDir,
    // The service mounts LANA's Lex styles for its demo page when it finds them; it has no
    // demo here, so it is pointed at its own folder, which has none.
    LEX_UI_ROOT: root
  };
}

async function checkEditorService(fetch, url, token, { starting, timeoutMs }) {
  const response = await fetch(`${url}/v1/health`, { method: 'GET', timeoutMs });
  if (!response.ok) {return `health answered ${response.status}`;}
  const body = await response.json();
  if (!body || body.ok !== true || body.service !== SERVICE_NAME) {return `not the editor service (${body && body.service})`;}
  if (!starting) {return null;}
  const probe = await fetch(`${url}/v1/manifests/public-key`, { method: 'GET', timeoutMs, headers: { Authorization: `Bearer ${token}` } });
  return probe.ok ? null : `authorized test request answered ${probe.status}`;
}

/**
 * Headers for one request from the session, with the editor's token added when the request
 * goes to the editor's /v1 API from one of the app's own pages (file://). Any other request,
 * or one from a web page the app shows, is left as it is.
 */
function authorizeEditorRequest({ url, pageUrl, headers }, { baseUrl, token }) {
  if (!baseUrl || !token || typeof url !== 'string' || !url.startsWith(`${baseUrl}/v1/`)) {return headers;}
  if (typeof pageUrl !== 'string' || !pageUrl.startsWith('file:')) {return headers;}
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() !== 'authorization') {out[name] = value;}
  }
  out.Authorization = `Bearer ${token}`;
  return out;
}

/**
 * @param {Object} deps
 * @param {string|null} deps.script - resolveEditorServiceScript()
 * @param {string} deps.execPath - this app's Electron (process.execPath)
 * @param {string} deps.keyDir - where the service keeps its signing keys
 * @param {Function} deps.spawn
 * @param {Function} deps.fetch - (url, { timeoutMs, ... }) => Response
 * @param {Function} deps.pickPort - async (preferred) => a free loopback port
 * @param {Object} [deps.fsImpl] - { mkdirSync }
 * @param {Object} [deps.baseEnv]
 * @param {Function} [deps.openLog]
 * @param {Function} [deps.makeToken]
 */
function createEditorService(deps) {
  const {
    script, execPath, keyDir, spawn, fetch, pickPort,
    fsImpl = require('fs'),
    baseEnv = {},
    openLog = () => null,
    makeToken = () => crypto.randomBytes(32).toString('hex'),
    timers = { setTimeout, clearTimeout },
    now = () => Date.now(),
    log = { info() {}, warn() {}, error() {} },
    options = {}
  } = deps;
  const opts = { ...EDITOR_DEFAULTS, ...options };
  let keeper = null;
  let token = null;

  async function start() {
    if (keeper) {return getState();}
    if (!script) {
      log.warn('[editor] the LANA document editor is not on this computer; documents open read-only');
      return getState();
    }
    const port = await pickPort(null);
    token = makeToken();
    fsImpl.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    const root = path.resolve(path.dirname(script), '..', '..', '..');
    keeper = createKeptProcess({ name: 'editor', label: 'editor', spawn, timers, now, log, openLog, onChange: () => {}, options: opts });
    keeper.start({
      command: execPath,
      args: [script],
      cwd: root,
      env: editorServiceEnv(baseEnv, { port, token, keyDir, root }),
      port,
      check: (url, { starting }) => checkEditorService(fetch, url, token, { starting, timeoutMs: opts.healthTimeoutMs })
    });
    return getState();
  }

  async function stop() {
    const target = keeper;
    keeper = null;
    token = null;
    if (target) {await target.stop();}
  }

  /** The service's address while it is kept running (starting, running or restarting), else ''. */
  function baseUrl() {
    const state = keeper ? keeper.getState() : null;
    return state && state.url ? state.url : '';
  }

  function requestHeaders(request) {
    return authorizeEditorRequest(request, { baseUrl: baseUrl(), token });
  }

  function getState() {
    return { installed: Boolean(script), server: keeper ? keeper.getState() : null };
  }

  return { start, stop, baseUrl, requestHeaders, getState };
}

module.exports = {
  createEditorService,
  resolveEditorServiceScript,
  editorServiceEnv,
  checkEditorService,
  authorizeEditorRequest,
  EDITOR_DEFAULTS,
  SERVICE_NAME
};
