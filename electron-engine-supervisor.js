'use strict';

/**
 * Local AI engine supervisor (local-ai-engine plan, phase 6).
 *
 * The engine (LANA-AI `src/engine/index.js`, role `engine`) is a gateway: it
 * serves the AI routes itself and forwards every other request to the
 * organization's server (Chef) unchanged. The desktop client therefore talks
 * only to the engine, and this module keeps that engine running:
 *
 * - spawn mode: start `node <root>/src/engine/index.js` on a loopback port
 *   with an allowlisted environment (no database variables can reach it),
 *   watch /api/engine/v1/health, restart with capped backoff when it exits
 *   or stops answering, stop it on quit;
 * - attach mode: an engine started elsewhere (LANA_ENGINE_URL); only health
 *   is watched, nothing is spawned or stopped;
 * - off: no engine; the client talks to Chef directly, as before.
 *
 * Plain CommonJS with every side effect injected (spawn, fetch, port probe,
 * timers, file checks) so it runs under Jest without Electron.
 */

const path = require('path');
const { generateControlSecret } = require('./electron-engine-control');

const HEALTH_PATH = '/api/engine/v1/health';
const LOOPBACK_HOST = '127.0.0.1';
const ENTRY = path.join('src', 'engine', 'index.js');

const DEFAULTS = Object.freeze({
  minBackoffMs: 1000,
  maxBackoffMs: 30000,
  stableResetMs: 60000,
  startTimeoutMs: 30000,
  healthIntervalStartingMs: 500,
  healthIntervalRunningMs: 5000,
  healthTimeoutMs: 3000,
  maxHealthFailures: 3,
  stopGraceMs: 5000
});

// Only these are inherited from the client's environment. Everything else,
// database settings included, stays out of the engine process.
const INHERITED_ENV = [
  'PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TMPDIR', 'TEMP', 'TMP', 'TZ',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS'
];

/**
 * The engine's environment: allowlisted OS basics plus the engine settings.
 * @param {Object} baseEnv - the client's process.env
 * @param {{ chefUrl: string, chefCertSha256?: string|null, port: number, extra?: Object }} options
 *   chefCertSha256: a hardware box Chef's certificate pin (64 hex, from the
 *   control plane); the engine trusts that certificate, and only it, for
 *   LANA_CHEF_URL's host and port. Absent for a cloud Chef (public TLS).
 */
function buildEngineEnv(baseEnv, { chefUrl, chefCertSha256 = null, port, extra = {} }) {
  const env = {};
  for (const name of INHERITED_ENV) {
    if (typeof baseEnv[name] === 'string') {env[name] = baseEnv[name];}
  }
  return {
    ...env,
    ...extra,
    NODE_ENV: 'production',
    LANA_RUNTIME_ROLE: 'engine',
    LANA_CHEF_URL: chefUrl,
    ...(chefCertSha256 ? { LANA_CHEF_CERT_SHA256: chefCertSha256 } : {}),
    LANA_ENGINE_HOST: LOOPBACK_HOST,
    LANA_ENGINE_PORT: String(port)
  };
}

function engineEntry(root) {
  return path.join(root, ENTRY);
}

/**
 * @param {Object} deps
 * @param {Function} deps.spawn - child_process.spawn shape
 * @param {Function} deps.fetch - WHATWG fetch shape (health)
 * @param {Function} deps.pickPort - async (preferredPort|null) => free loopback port
 * @param {Function} [deps.fileExists] - (path) => boolean
 * @param {Function} [deps.onState] - called with getState() on every change
 * @param {Function} [deps.onPortChosen] - called with the port the engine was given (persist it)
 * @param {Object} [deps.baseEnv] - inherited environment (filtered)
 * @param {string} [deps.nodePath] - node binary
 * @param {Object} [deps.nodeEnv] - extra env for the node binary (ELECTRON_RUN_AS_NODE)
 * @param {string} [deps.cwd] - working directory for the engine (no .env there)
 * @param {Object} [deps.timers] - { setTimeout, clearTimeout }
 * @param {Function} [deps.now]
 * @param {Object} [deps.log] - { info, warn, error }
 * @param {Object} [deps.options] - overrides for DEFAULTS
 * @param {Function} [deps.makeSecret] - () => a fresh control secret (one per engine process)
 * @param {Function} [deps.engineEnv] - () => extra engine settings (engine id, local model endpoints)
 */
function createEngineSupervisor(deps) {
  const {
    spawn,
    fetch,
    pickPort,
    fileExists = () => true,
    onState = () => {},
    onPortChosen = () => {},
    baseEnv = {},
    nodePath = 'node',
    nodeEnv = {},
    cwd,
    timers = { setTimeout, clearTimeout },
    now = () => Date.now(),
    log = { info() {}, warn() {}, error() {} },
    makeSecret = generateControlSecret,
    engineEnv = () => ({})
  } = deps;
  const opts = { ...DEFAULTS, ...(deps.options || {}) };

  const state = {
    mode: 'off',
    reason: 'not_configured',
    root: null,
    chefUrl: null,
    chefCertSha256: null,
    port: null,
    url: null,
    process: 'stopped', // stopped | starting | running | restarting
    pid: null,
    restarts: 0,
    nextRestartAt: null,
    lastExit: null,
    health: null,
    healthy: false,
    lastHealthError: null
  };

  let child = null;
  let healthTimer = null;
  let restartTimer = null;
  let startTimer = null;
  let stableTimer = null;
  let healthFailures = 0;
  let wasHealthy = false;
  let wanted = false; // should an engine be running now
  let generation = 0; // bumps on every configure/stop so stale callbacks are ignored
  let preferredPort = null;
  // The control channel secret of the running engine process (phase 8d). Never
  // part of getState(), which is broadcast to renderers.
  let controlSecret = null;

  function emit() {
    try { onState(getState()); } catch (_error) { /* listener errors are not ours */ }
  }

  function clear(timer) {
    if (timer) {timers.clearTimeout(timer);}
    return null;
  }

  function clearAllTimers() {
    healthTimer = clear(healthTimer);
    restartTimer = clear(restartTimer);
    startTimer = clear(startTimer);
    stableTimer = clear(stableTimer);
  }

  function getState() {
    return { ...state, health: state.health ? JSON.parse(JSON.stringify(state.health)) : null };
  }

  // ── Health ──────────────────────────────────────────────────────────────

  function scheduleHealth(gen, delay) {
    healthTimer = clear(healthTimer);
    healthTimer = timers.setTimeout(() => { checkHealth(gen); }, delay);
  }

  async function checkHealth(gen) {
    healthTimer = null;
    if (gen !== generation || !state.url) {return;}
    let body = null;
    let error = null;
    try {
      const response = await fetch(`${state.url}${HEALTH_PATH}`, { method: 'GET', timeoutMs: opts.healthTimeoutMs });
      if (!response.ok) {throw new Error(`health answered ${response.status}`);}
      body = await response.json();
    } catch (caught) {
      error = caught;
    }
    if (gen !== generation) {return;}

    if (body) {
      healthFailures = 0;
      state.health = body;
      state.healthy = true;
      state.lastHealthError = null;
      if (state.mode === 'spawn' && state.process === 'starting') {
        state.process = 'running';
        startTimer = clear(startTimer);
        stableTimer = clear(stableTimer);
        stableTimer = timers.setTimeout(() => { state.restarts = 0; emit(); }, opts.stableResetMs);
      }
      if (state.mode === 'attach') {state.process = 'running';}
      wasHealthy = true;
      emit();
      scheduleHealth(gen, opts.healthIntervalRunningMs);
      return;
    }

    healthFailures += 1;
    state.healthy = false;
    state.lastHealthError = error ? error.message : 'unknown';
    if (state.mode === 'spawn' && state.process === 'running' && wasHealthy && healthFailures >= opts.maxHealthFailures) {
      log.warn(`[engine-supervisor] engine stopped answering health (${healthFailures} checks); restarting`);
      emit();
      restartChild(gen, 'unhealthy');
      return;
    }
    if (state.mode === 'attach' && wasHealthy) {state.process = 'restarting';}
    emit();
    const interval = state.process === 'starting' ? opts.healthIntervalStartingMs : opts.healthIntervalRunningMs;
    scheduleHealth(gen, interval);
  }

  // ── Process ─────────────────────────────────────────────────────────────

  function backoffDelay() {
    return Math.min(opts.maxBackoffMs, opts.minBackoffMs * 2 ** Math.max(0, state.restarts - 1));
  }

  function killChild(target) {
    if (!target || target.exitCode !== null && target.exitCode !== undefined) {return Promise.resolve();}
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; timers.clearTimeout(killTimer); resolve(); } };
      target.once('exit', finish);
      try { target.kill('SIGTERM'); } catch (_error) { finish(); return; }
      const killTimer = timers.setTimeout(() => {
        try { target.kill('SIGKILL'); } catch (_error) { /* already gone */ }
        finish();
      }, opts.stopGraceMs);
    });
  }

  function scheduleRestart(gen) {
    state.restarts += 1;
    const delay = backoffDelay();
    state.process = 'restarting';
    state.nextRestartAt = new Date(now() + delay).toISOString();
    emit();
    log.warn(`[engine-supervisor] restarting the engine in ${delay} ms (restart ${state.restarts})`);
    restartTimer = clear(restartTimer);
    restartTimer = timers.setTimeout(() => {
      restartTimer = null;
      if (gen === generation && wanted) {spawnChild(gen);}
    }, delay);
  }

  function restartChild(gen, why) {
    const target = child;
    child = null;
    healthTimer = clear(healthTimer);
    startTimer = clear(startTimer);
    stableTimer = clear(stableTimer);
    state.healthy = false;
    state.lastExit = { reason: why, at: new Date(now()).toISOString() };
    killChild(target).then(() => {
      if (gen === generation && wanted) {scheduleRestart(gen);}
    });
  }

  function spawnChild(gen) {
    state.process = 'starting';
    state.nextRestartAt = null;
    state.healthy = false;
    healthFailures = 0;
    wasHealthy = false;
    controlSecret = makeSecret();
    const env = buildEngineEnv(baseEnv, { chefUrl: state.chefUrl, chefCertSha256: state.chefCertSha256, port: state.port, extra: { ...nodeEnv, ...engineEnv(), LANA_ENGINE_CONTROL_SECRET: controlSecret } });
    let spawned;
    try {
      spawned = spawn(nodePath, [engineEntry(state.root)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      log.error(`[engine-supervisor] could not start the engine: ${error.message}`);
      state.lastExit = { reason: 'spawn_failed', message: error.message, at: new Date(now()).toISOString() };
      scheduleRestart(gen);
      return;
    }
    child = spawned;
    state.pid = spawned.pid || null;
    log.info(`[engine-supervisor] engine started (pid ${state.pid}) on ${state.url}, forwarding to ${state.chefUrl}`);
    if (spawned.stdout) {spawned.stdout.on('data', (chunk) => log.info(`[engine] ${String(chunk).trimEnd()}`));}
    if (spawned.stderr) {spawned.stderr.on('data', (chunk) => log.warn(`[engine] ${String(chunk).trimEnd()}`));}
    spawned.on('error', (error) => {
      log.error(`[engine-supervisor] engine process error: ${error.message}`);
    });
    spawned.on('exit', (code, signal) => {
      if (child !== spawned) {return;} // stopped or replaced on purpose
      child = null;
      state.pid = null;
      state.healthy = false;
      state.lastExit = { reason: 'exited', code, signal, at: new Date(now()).toISOString() };
      healthTimer = clear(healthTimer);
      startTimer = clear(startTimer);
      stableTimer = clear(stableTimer);
      log.warn(`[engine-supervisor] engine exited (code ${code}, signal ${signal})`);
      if (gen === generation && wanted) {scheduleRestart(gen);} else {
        state.process = 'stopped';
        emit();
      }
    });
    startTimer = timers.setTimeout(() => {
      startTimer = null;
      if (gen === generation && child === spawned && state.process === 'starting') {
        log.warn(`[engine-supervisor] engine did not become healthy in ${opts.startTimeoutMs} ms; restarting`);
        restartChild(gen, 'start_timeout');
      }
    }, opts.startTimeoutMs);
    emit();
    scheduleHealth(gen, opts.healthIntervalStartingMs);
  }

  // ── Public ──────────────────────────────────────────────────────────────

  /**
   * Apply a configuration (from resolveEngineConfig) and the Chef address.
   * Restarts the engine when the root, mode or Chef address changed.
   *
   * @param {{ mode: 'off'|'spawn'|'attach', reason?: string, root?: string, attachUrl?: string, preferredPort?: number|null }} config
   * @param {string|null} chefUrl
   * @param {string|null} [chefCertSha256] - the box Chef's certificate pin, when there is one
   */
  async function configure(config, chefUrl, chefCertSha256 = null) {
    const next = { mode: config.mode, root: config.root || null, attachUrl: config.attachUrl || null, chefUrl: chefUrl || null, chefCertSha256: chefCertSha256 || null };
    if (next.mode === 'spawn' && !chefUrl) {
      next.mode = 'off';
      config = { ...config, reason: 'no_server' };
    }
    if (next.mode === 'spawn' && !fileExists(engineEntry(next.root))) {
      next.mode = 'off';
      config = { ...config, reason: 'engine_not_found' };
    }
    const same = wanted
      && state.mode === next.mode
      && state.root === next.root
      && state.chefUrl === next.chefUrl
      && state.chefCertSha256 === next.chefCertSha256
      && (next.mode !== 'attach' || state.url === next.attachUrl);
    if (same) {return getState();}

    await stop({ keepConfig: true });
    generation += 1;
    const gen = generation;
    if (config.preferredPort) {preferredPort = config.preferredPort;}
    Object.assign(state, {
      mode: next.mode,
      reason: next.mode === 'off' ? (config.reason || 'not_configured') : null,
      root: next.root,
      chefUrl: next.chefUrl,
      chefCertSha256: next.chefCertSha256,
      restarts: 0,
      nextRestartAt: null,
      lastExit: null,
      health: null,
      healthy: false,
      lastHealthError: null
    });

    if (next.mode === 'off') {
      Object.assign(state, { port: null, url: null, process: 'stopped' });
      emit();
      return getState();
    }

    wanted = true;
    if (next.mode === 'attach') {
      const url = new URL(next.attachUrl);
      Object.assign(state, { url: url.origin, port: Number(url.port) || null, process: 'starting' });
      emit();
      scheduleHealth(gen, 0);
      return getState();
    }

    const port = await pickPort(preferredPort);
    if (gen !== generation) {return getState();}
    preferredPort = port;
    try { onPortChosen(port); } catch (_error) { /* persistence is best effort */ }
    Object.assign(state, { port, url: `http://${LOOPBACK_HOST}:${port}` });
    spawnChild(gen);
    return getState();
  }

  /** Restart now (Settings button). Resets the backoff. */
  async function restart() {
    if (!wanted || state.mode === 'off') {return getState();}
    const gen = generation;
    if (state.mode === 'attach') {
      scheduleHealth(gen, 0);
      return getState();
    }
    restartTimer = clear(restartTimer);
    const target = child;
    child = null;
    healthTimer = clear(healthTimer);
    startTimer = clear(startTimer);
    stableTimer = clear(stableTimer);
    state.process = 'restarting';
    state.healthy = false;
    emit();
    await killChild(target);
    if (gen === generation && wanted) {
      state.restarts = 0;
      spawnChild(gen);
    }
    return getState();
  }

  /** Stop the engine (quit, logout, setting off). */
  async function stop({ keepConfig = false } = {}) {
    wanted = false;
    generation += 1;
    clearAllTimers();
    const target = child;
    child = null;
    await killChild(target);
    Object.assign(state, { process: 'stopped', pid: null, healthy: false, nextRestartAt: null });
    if (!keepConfig) {
      Object.assign(state, { mode: 'off', reason: 'stopped', url: null, port: null, health: null });
      emit();
    }
  }

  /** The secret of the engine process this supervisor started (null when none, or in attach mode). */
  function getControlSecret() {
    return state.mode === 'spawn' && child ? controlSecret : null;
  }

  return { configure, restart, stop, getState, getControlSecret };
}

module.exports = {
  createEngineSupervisor,
  buildEngineEnv,
  engineEntry,
  HEALTH_PATH,
  LOOPBACK_HOST,
  DEFAULTS
};
