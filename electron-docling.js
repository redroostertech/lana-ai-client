'use strict';

/**
 * Docling on this computer (local-first document reading, 2026-11-09). Main process.
 *
 * When a person uploads a file, their organization's server (Chef) offers it to this computer
 * first, and the engine reads it with this Docling (backend src/sandbox-runner/kinds/
 * document-parsing.js). When Docling is not running here, Chef reads the file itself, so
 * nothing stops working: Docling only makes reading better (tables and layout) and keeps it
 * on this computer.
 *
 * Kept running like the redactor (electron-process-keeper.js): a free loopback port, a health
 * check, restarts. Ready when GET /health answers { status: "ok" }. Then onAddress gets the URL,
 * which the engine is given as DOCLING_API_URL (with longer reading timeouts, below). The engine
 * reports Docling ready to Chef only while it answers.
 *
 * Where it is, in this order:
 *   LANA_DOCLING_URL     a docling-serve already running (developers): used as is, nothing started
 *   LANA_DOCLING_BIN     a docling-serve program (developers)
 *   <userData>/docling/docling-serve/docling-serve(.exe)
 *                        the runtime first-launch setup downloads (not published yet; see the
 *                        backend plan local-document-parsing.md, "Docling runtime")
 *   LANA_DOCLING_VENV    a Python environment with docling-serve installed (development; also
 *                        ~/.venv/docling when the variable is unset and that folder holds it)
 * Models: <userData>/docling/models when present (DOCLING_SERVE_ARTIFACTS_PATH), else docling's
 * own download on first use (developers only).
 * None: Docling is not started, and Chef reads every file itself.
 */

const path = require('path');
const { createKeptProcess, DEFAULTS } = require('./electron-process-keeper');

const HOST = '127.0.0.1';

// Only these reach docling-serve from the client's environment.
const INHERITED_ENV = [
  'PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'TZ',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'
];

// Set aside when sizing this computer. Measured: 1,047 MB peak converting a 393 KB PDF
// (36 seconds, Apple M4 Pro, docling-serve with the pinned models).
const DOCLING_MEMORY_BYTES = 1024 ** 3;

// How long the engine lets one file take. Chef waits 300 seconds for this computer before it
// reads the file itself, so a file has to finish well inside that (backend
// LANA_LOCAL_PARSE_MAX_WAIT_SECONDS). The backend defaults (45 s and 120 s) are for a server.
const READ_TIMEOUT_MS = '240000';

const DOCLING_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  // docling-serve imports torch and its models before /health answers.
  startTimeoutMs: 180000,
  healthIntervalStartingMs: 500
});

function programName(platform) {
  return platform === 'win32' ? 'docling-serve.exe' : 'docling-serve';
}

/**
 * How to start Docling on this computer, an external address, or null when there is none.
 * @returns {{ external: string }|{ command: string, args: Function, cwd: string, env: Object }|null}
 */
function resolveDoclingCommand({ env = {}, userDataDir = null, platform = process.platform, home, fileExists }) {
  if (typeof env.LANA_DOCLING_URL === 'string' && env.LANA_DOCLING_URL.trim()) {
    return { external: env.LANA_DOCLING_URL.trim().replace(/\/+$/, '') };
  }
  const listen = (port) => ['run', '--host', HOST, '--port', String(port)];
  const models = userDataDir ? path.join(userDataDir, 'docling', 'models') : null;
  const modelEnv = models && fileExists(models) ? { DOCLING_SERVE_ARTIFACTS_PATH: models } : {};
  if (typeof env.LANA_DOCLING_BIN === 'string' && env.LANA_DOCLING_BIN.trim()) {
    const file = path.resolve(env.LANA_DOCLING_BIN.trim());
    return fileExists(file) ? { command: file, args: listen, cwd: path.dirname(file), env: modelEnv } : null;
  }
  if (userDataDir) {
    const root = path.join(userDataDir, 'docling', 'docling-serve');
    const file = path.join(root, programName(platform));
    if (fileExists(file)) {return { command: file, args: listen, cwd: root, env: modelEnv };}
  }
  const venv = env.LANA_DOCLING_VENV ? path.resolve(env.LANA_DOCLING_VENV) : (home ? path.join(home, '.venv', 'docling') : null);
  if (!venv) {return null;}
  const file = platform === 'win32' ? path.join(venv, 'Scripts', programName(platform)) : path.join(venv, 'bin', programName(platform));
  return fileExists(file) ? { command: file, args: listen, cwd: venv, env: modelEnv } : null;
}

/** docling-serve's environment: OS basics and its model folder. Nothing else of the client's. */
function doclingEnv(baseEnv, extra = {}) {
  const out = {};
  for (const name of INHERITED_ENV) {
    if (typeof baseEnv[name] === 'string') {out[name] = baseEnv[name];}
  }
  return { ...out, ...extra, PYTHONUNBUFFERED: '1' };
}

/** Ready means /health answers { status: "ok" }; anything else names why not. */
async function checkDocling(fetch, url, { timeoutMs }) {
  const response = await fetch(`${url}/health`, { method: 'GET', timeoutMs });
  if (!response.ok) {return `health answered ${response.status}`;}
  const body = await response.json().catch(() => null);
  return body && body.status === 'ok' ? null : 'health did not say ok';
}

/**
 * @param {Object} deps
 * @param {Object|null} deps.command - resolveDoclingCommand()
 * @param {Function} deps.spawn
 * @param {Function} deps.fetch - (url, { timeoutMs, ... }) => Response
 * @param {Function} deps.pickPort - async (preferred) => a free loopback port
 * @param {Object} [deps.baseEnv]
 * @param {Function} [deps.onAddress] - (url | null) => void
 */
function createDocling(deps) {
  const {
    command, spawn, fetch, pickPort,
    baseEnv = {},
    onAddress = () => {},
    openLog = () => null,
    timers = { setTimeout, clearTimeout },
    now = () => Date.now(),
    log = { info() {}, warn() {}, error() {} },
    options = {}
  } = deps;
  const opts = { ...DOCLING_DEFAULTS, ...options };
  let keeper = null;
  let announced = null;

  function announce(next) {
    if (next === announced) {return;}
    announced = next;
    try { onAddress(next); } catch (_error) { /* listener errors are not ours */ }
  }

  async function start() {
    if (keeper) {return getState();}
    if (!command) {
      log.info('[docling] no Docling on this computer; the organization\'s server reads uploaded files itself');
      return getState();
    }
    if (command.external) {
      // A docling-serve the developer runs: the engine checks its health itself before offering to read.
      announce(command.external);
      return getState();
    }
    const port = await pickPort(null);
    keeper = createKeptProcess({ name: 'docling', label: 'docling', spawn, timers, now, log, openLog, onChange: (state) => announce(state.answeredOnce ? state.url : null), options: opts });
    keeper.start({
      command: command.command,
      args: command.args(port),
      cwd: command.cwd,
      env: doclingEnv(baseEnv, command.env),
      port,
      check: (url) => checkDocling(fetch, url, { timeoutMs: opts.healthTimeoutMs })
    });
    return getState();
  }

  async function stop() {
    const target = keeper;
    keeper = null;
    if (target) {await target.stop();}
    announce(null);
  }

  function getState() {
    return { installed: Boolean(command), external: Boolean(command && command.external), server: keeper ? keeper.getState() : null };
  }

  return { start, stop, getState };
}

/** What the engine is given for Docling: its address and the reading timeouts, or nothing. */
function doclingEndpoints(url) {
  return url ? { DOCLING_API_URL: url, DOC_PARSER_TIMEOUT_DOCLING_MS: READ_TIMEOUT_MS, DOCLING_TIMEOUT_MS: READ_TIMEOUT_MS } : {};
}

module.exports = { createDocling, resolveDoclingCommand, doclingEnv, checkDocling, doclingEndpoints, DOCLING_MEMORY_BYTES, DOCLING_DEFAULTS };
