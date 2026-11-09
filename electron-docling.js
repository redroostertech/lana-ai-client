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
 *   <userData>/docling/runtime-<version>/
 *                        the runtime first-launch setup downloads and unpacks, started as
 *                        python -I -m docling_serve (electron-docling-install.js). Used only when
 *                        it and every model are in place and match the pin.
 *   LANA_DOCLING_VENV    a Python environment with docling-serve installed (development; also
 *                        ~/.venv/docling when the variable is unset and that folder holds it)
 * Models: <userData>/docling/models when present (DOCLING_SERVE_ARTIFACTS_PATH), else docling's
 * own download on first use (developers only). The downloaded runtime never reaches the network
 * for models: it runs with HF_HUB_OFFLINE and its byte code is never rewritten.
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
 * `source` says which: 'external', 'bin', 'runtime' (the downloaded one) or 'venv'.
 * @param {Function} [installedRuntime] - () => electron-docling-install.js installedEntry() result or null
 * @returns {{ external: string, source: string }|{ command: string, args: Function, cwd: string, env: Object, source: string }|null}
 */
function resolveDoclingCommand({ env = {}, userDataDir = null, platform = process.platform, home, fileExists, installedRuntime = () => null }) {
  if (typeof env.LANA_DOCLING_URL === 'string' && env.LANA_DOCLING_URL.trim()) {
    return { external: env.LANA_DOCLING_URL.trim().replace(/\/+$/, ''), source: 'external' };
  }
  const listen = (port) => ['run', '--host', HOST, '--port', String(port)];
  const models = userDataDir ? path.join(userDataDir, 'docling', 'models') : null;
  const modelEnv = models && fileExists(models) ? { DOCLING_SERVE_ARTIFACTS_PATH: models } : {};
  if (typeof env.LANA_DOCLING_BIN === 'string' && env.LANA_DOCLING_BIN.trim()) {
    const file = path.resolve(env.LANA_DOCLING_BIN.trim());
    return fileExists(file) ? { command: file, args: listen, cwd: path.dirname(file), env: modelEnv, source: 'bin' } : null;
  }
  const runtime = installedRuntime();
  if (runtime && fileExists(runtime.program)) {
    // The entry already ends in "run": add only where to listen.
    return {
      command: runtime.program,
      args: (port) => [...runtime.args, ...listen(port).slice(1)],
      cwd: runtime.dir,
      env: { DOCLING_SERVE_ARTIFACTS_PATH: runtime.models, HF_HUB_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' },
      source: 'runtime'
    };
  }
  const venv = env.LANA_DOCLING_VENV ? path.resolve(env.LANA_DOCLING_VENV) : (home ? path.join(home, '.venv', 'docling') : null);
  if (!venv) {return null;}
  const file = platform === 'win32' ? path.join(venv, 'Scripts', programName(platform)) : path.join(venv, 'bin', programName(platform));
  return fileExists(file) ? { command: file, args: listen, cwd: venv, env: modelEnv, source: 'venv' } : null;
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
 * @param {Object|Function|null} deps.command - resolveDoclingCommand(), or a function returning it
 * @param {Function} deps.spawn
 * @param {Function} deps.fetch - (url, { timeoutMs, ... }) => Response
 * @param {Function} deps.pickPort - async (preferred) => a free loopback port
 * @param {Object} [deps.baseEnv]
 * @param {Function} [deps.onAddress] - (url | null) => void
 */
function createDocling(deps) {
  const {
    spawn, fetch, pickPort,
    baseEnv = {},
    onAddress = () => {},
    openLog = () => null,
    timers = { setTimeout, clearTimeout },
    now = () => Date.now(),
    log = { info() {}, warn() {}, error() {} },
    options = {}
  } = deps;
  const opts = { ...DOCLING_DEFAULTS, ...options };
  // A function is asked again on every start(), so a Docling first-launch setup installed while
  // the app runs is found without a restart.
  const currentCommand = () => (typeof deps.command === 'function' ? deps.command() : deps.command || null);
  let keeper = null;
  let announced = null;

  function announce(next) {
    if (next === announced) {return;}
    announced = next;
    try { onAddress(next); } catch (_error) { /* listener errors are not ours */ }
  }

  async function start() {
    if (keeper) {return getState();}
    const command = currentCommand();
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
    const command = currentCommand();
    return { installed: Boolean(command), external: Boolean(command && command.external), server: keeper ? keeper.getState() : null };
  }

  return { start, stop, getState };
}

/** What the engine is given for Docling: its address and the reading timeouts, or nothing. */
function doclingEndpoints(url) {
  return url ? { DOCLING_API_URL: url, DOC_PARSER_TIMEOUT_DOCLING_MS: READ_TIMEOUT_MS, DOCLING_TIMEOUT_MS: READ_TIMEOUT_MS } : {};
}

module.exports = { createDocling, resolveDoclingCommand, doclingEnv, checkDocling, doclingEndpoints, DOCLING_MEMORY_BYTES, DOCLING_DEFAULTS };
