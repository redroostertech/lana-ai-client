'use strict';

/**
 * Main-process glue for the local AI engine: one supervisor, the API base
 * every caller uses, the IPC the renderer needs, and state pushes to every
 * window. Electron objects are passed in (ipcMain, app, windows) so this file
 * imports nothing from Electron itself.
 *
 * See electron-engine-supervisor.js (process lifecycle) and
 * electron-api-base.js (the API base rule).
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { createEngineSupervisor, engineEntry, LOOPBACK_HOST } = require('./electron-engine-supervisor');
const { createEngineControlClient } = require('./electron-engine-control');
const { resolveEngineConfig, resolveApiBase, presentServer, toStoredServer, isEngineInUse } = require('./electron-api-base');

const CHANNELS = Object.freeze({
  apiBaseSync: 'engine:api-base-sync',
  status: 'engine:status',
  restart: 'engine:restart',
  setEnabled: 'engine:set-enabled',
  setBackgroundJobs: 'engine:set-background-jobs',
  backgroundJobs: 'engine:background-jobs',
  state: 'engine:state'
});

// Engine settings passed through from the client's environment (phase 8d):
// the tier the engine's chat runtime needs to start, and the local model
// endpoints it may use for background jobs. Nothing else. Phase 8h: the
// embedding model file too (the engine hashes it to verify its identity);
// when the environment names none, the catalog's verified R2 download fills
// the embedding settings (electron-local-models.js).
// The engine reads its embedding identity from its Pip's /health (backend
// src/engine/local-embedding-identity.js), so no model file, id or version is passed.
// LANA_TOKENIZER_GGUF: the chat model file, so the engine counts tokens with its vocabulary.
// LLM_QUEUE_*: the engine's model-call queue sized to Pip's chat slots, background work held to
// one call (electron-pip-supervisor.js engineEndpoints).
const ENGINE_MODEL_ENV = Object.freeze(['LANA_TIER', 'EMBEDDING_MODEL', 'LANA_ENGINE_EMBEDDING_URL', 'LANA_ENGINE_CHAT_URL', 'LANA_FORGE_URL', 'LANA_TOKENIZER_GGUF', 'LLM_QUEUE_CONCURRENCY', 'LLM_QUEUE_MAX_BACKGROUND_CONCURRENCY']);

// The redactor on this computer (electron-redactor.js): its address and the secret it checks on
// every request. They only work together, so they come from one place: the environment when it
// names a redactor, otherwise the client's own.
const REDACTOR_ENV = Object.freeze(['REDACTOR_URL', 'INTERNAL_SERVICE_SECRET']);

// Docling on this computer (electron-docling.js): its address and how long one file may take.
// The engine reads uploaded files with it when the organization's server offers them.
const DOCLING_ENV = Object.freeze(['DOCLING_API_URL', 'DOC_PARSER_TIMEOUT_DOCLING_MS', 'DOCLING_TIMEOUT_MS']);

// The engine will not start without an engine level (LANA_TIER). When neither the environment
// nor anything else names one, the client gives demo: it budgets 8192 tokens, which never
// exceeds a planned Pip slot (8192 at the least) or a cloud model's window, so it is safe for
// every chat model. A level tuned for local models under 9B is a backend decision.
const DEFAULT_ENGINE_TIER = 'demo';

// Changes to this computer's AI servers that arrive within this long of each other share one
// engine restart (electron-local-engine.js setModelEndpoints).
const ENDPOINT_RESTART_DELAY_MS = 3000;

// A sleep or quit waits this long for the engine to hand running jobs off.
const HANDOFF_WAIT_MS = 12000;

/**
 * "Run my background jobs on this computer when possible": the saved choice,
 * or by default on whenever the local engine is on (the server still checks
 * that this computer can run the job's models before offering it).
 */
function backgroundJobsEnabled(preferences, config) {
  if (typeof preferences.backgroundJobs === 'boolean') {return preferences.backgroundJobs && Boolean(config.enabled);}
  return Boolean(config.enabled);
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(port, LOOPBACK_HOST, () => {
      const chosen = server.address().port;
      server.close(() => resolve(chosen));
    });
  });
}

/** The preferred port when it is free, otherwise any free loopback port. */
async function pickLoopbackPort(preferred) {
  if (preferred) {
    try { return await listenOn(preferred); } catch (_error) { /* taken: pick another */ }
  }
  return listenOn(0);
}

async function fetchWithTimeout(url, { timeoutMs = 3000, ...init } = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** What the renderer is shown: no process details beyond what Settings needs (never the control secret). */
function statusView(state, config, apiBase, backgroundJobs = { enabled: false, setting: null }, localAiProblem = null) {
  const health = state.health || null;
  return {
    // Pip (the local AI models) could not start on this computer (electron-pip-supervisor.js).
    localAiProblem,
    configured: config.configured,
    enabled: config.enabled,
    backgroundJobs,
    mode: state.mode,
    reason: state.reason,
    process: state.process,
    port: state.port,
    url: state.url,
    apiBase,
    inUse: isEngineInUse(state),
    restarts: state.restarts,
    nextRestartAt: state.nextRestartAt,
    healthy: state.healthy,
    health: health ? {
      status: health.status,
      chef: health.chef ? {
        origin: health.chef.origin,
        status: health.chef.status,
        reachable: health.chef.reachable,
        // Phase 10: false when the engine's last request to the server could not connect.
        reachable_now: health.chef.reachable_now !== false,
        api: health.chef.api,
        min_client: health.chef.min_client,
        next_retry_at: health.chef.next_retry_at
      } : null,
      data_api: health.data_api || null,
      version: health.version || null
    } : null
  };
}

/**
 * Phase 10: may the app open while the organization's server cannot be
 * reached? Only when the local engine is on (it holds the offline copy and
 * answers from it), this computer has a keychain for the copy's key, and the
 * person is still signed in. Otherwise the app goes to sign-in as before.
 */
function canOpenOffline({ config, offlineKey, signedIn }) {
  return Boolean(config && config.mode !== 'off' && offlineKey && offlineKey.canEncrypt() && signedIn);
}

/**
 * Phase 10: hand the engine the offline copy key for a signed-in session, or
 * close the copy and remove the key on sign-out.
 * @returns {Promise|null}
 */
function pushOfflineKeyFor({ token, offlineKey, control }) {
  if (!offlineKey || !control || typeof control.setOfflineKey !== 'function') {return null;}
  if (!token) {
    offlineKey.clear();
    return control.setOfflineKey(null);
  }
  const key = offlineKey.get();
  return key ? control.setOfflineKey(key.toString('base64')) : null;
}

/**
 * The engine inside the installed app (<resources>/engine), when it is there. Development
 * builds use LANA_ENGINE_ROOT instead.
 */
function bundledEngineRoot({ app, resourcesPath, fileExists }) {
  if (!app.isPackaged || !resourcesPath) {return null;}
  const root = path.join(resourcesPath, 'engine');
  return fileExists(engineEntry(root)) ? root : null;
}

/**
 * @param {Object} deps
 * @param {Object} deps.ipcMain
 * @param {Object} deps.app - for isPackaged, getPath, execPath
 * @param {Object} deps.storage - { getSavedServer, getLocalEnginePreferences, updateLocalEnginePreferences }
 * @param {Function} deps.getWindows - () => BrowserWindow[]
 * @param {Object} [deps.env]
 * @param {Object} deps.log - { info, warn, error }
 * @param {Function} [deps.getAuthToken] - () => the signed-in person's session token or null
 * @param {Object} [deps.offlineKey] - electron-offline-key.js store (phase 10); none means no offline copy
 */
function createLocalEngineHost({ ipcMain, app, storage, getWindows, env = process.env, log, getAuthToken = () => null, offlineKey = null, resourcesPath = process.resourcesPath, restartDelayMs = ENDPOINT_RESTART_DELAY_MS }) {
  const cwd = path.join(app.getPath('userData'), 'local-engine');
  try { fs.mkdirSync(cwd, { recursive: true }); } catch (_error) { /* spawn reports it */ }
  const bundledRoot = bundledEngineRoot({ app, resourcesPath, fileExists: (file) => fs.existsSync(file) });
  const engineConfig = () => resolveEngineConfig(env, storage.getLocalEnginePreferences(), { bundledRoot });
  // Pip's addresses and the engine level, from electron-pip-supervisor.js. The environment wins.
  let modelEndpoints = {};
  let pendingRestart = null;

  // Packaged builds have no `node` on PATH: run Electron's binary as node.
  const nodePath = env.LANA_ENGINE_NODE || (app.isPackaged ? process.execPath : 'node');
  const nodeEnv = !env.LANA_ENGINE_NODE && app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {};

  let config = engineConfig();
  let osSignals = null;
  let pushedFor = null; // the engine process (pid) and token the session was last pushed for

  function engineId() {
    const saved = storage.getLocalEnginePreferences().engineId;
    if (saved) {return saved;}
    const fresh = `engine-${crypto.randomUUID()}`;
    storage.updateLocalEnginePreferences({ engineId: fresh });
    return fresh;
  }

  function engineEnv() {
    const extra = { LANA_ENGINE_ID: engineId() };
    // Phase 10: the engine's offline copy folder, in this app's own data folder.
    if (offlineKey) {extra.LANA_ENGINE_OFFLINE_DIR = path.join(cwd, 'offline');}
    for (const name of [...ENGINE_MODEL_ENV, ...DOCLING_ENV]) {
      if (typeof env[name] === 'string' && env[name]) {extra[name] = env[name];}
      else if (typeof modelEndpoints[name] === 'string' && modelEndpoints[name]) {extra[name] = modelEndpoints[name];}
    }
    if (!extra.LANA_TIER) {extra.LANA_TIER = DEFAULT_ENGINE_TIER;}
    const redactor = typeof env.REDACTOR_URL === 'string' && env.REDACTOR_URL ? env : modelEndpoints;
    if (redactor.REDACTOR_URL) {
      for (const name of REDACTOR_ENV) {
        if (typeof redactor[name] === 'string' && redactor[name]) {extra[name] = redactor[name];}
      }
    }
    return extra;
  }

  /**
   * Pip's servers or the redactor changed (started, moved port, or stopped). The engine reads
   * these once at start, so a running engine is restarted; one not yet started reads them when
   * it starts. Pass every current value each time: a name left out means none.
   * @param {Object} values - ENGINE_MODEL_ENV and REDACTOR_ENV names to values
   */
  async function setModelEndpoints(values) {
    const next = {};
    for (const name of [...ENGINE_MODEL_ENV, ...REDACTOR_ENV, ...DOCLING_ENV]) {
      if (typeof values[name] === 'string' && values[name]) {next[name] = values[name];}
    }
    if (JSON.stringify(next) === JSON.stringify(modelEndpoints)) {return pendingRestart ? pendingRestart.promise : undefined;}
    modelEndpoints = next;
    const state = supervisor.getState();
    if (!(state.mode === 'spawn' && state.process !== 'stopped')) {return undefined;}
    // Pip, the redactor and Docling usually come up within seconds of each other, and every
    // restart briefly cuts off the app's calls. Changes that arrive close together are folded into
    // one restart, restartDelayMs after the last one, with the newest addresses.
    if (!pendingRestart) {
      let resolve;
      pendingRestart = { timer: null, promise: new Promise((r) => { resolve = r; }), resolve: () => resolve() };
    }
    const pending = pendingRestart;
    if (pending.timer) {clearTimeout(pending.timer);}
    pending.timer = setTimeout(() => {
      pendingRestart = null;
      log.info('[local-engine] the AI servers on this computer changed (Pip, the redactor or Docling); restarting the engine');
      supervisor.restart().catch(() => null).then(pending.resolve);
    }, restartDelayMs);
    return pending.promise;
  }

  let localAiProblem = null;
  /** Pip's start problem in plain words, or null; shown in the engine status. */
  function setLocalAiProblem(message) {
    localAiProblem = message || null;
    broadcast(supervisor.getState());
  }

  function backgroundJobsView() {
    const preferences = storage.getLocalEnginePreferences();
    return { enabled: backgroundJobsEnabled(preferences, config), setting: typeof preferences.backgroundJobs === 'boolean' ? preferences.backgroundJobs : null };
  }

  function broadcast(state) {
    pushControl(state);
    const payload = statusView(state, config, currentApiBase(state), backgroundJobsView(), localAiProblem);
    for (const win of getWindows()) {
      if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send(CHANNELS.state, payload);
      }
    }
  }

  const supervisor = createEngineSupervisor({
    spawn: childProcess.spawn,
    fetch: fetchWithTimeout,
    pickPort: pickLoopbackPort,
    fileExists: (file) => fs.existsSync(file),
    onState: broadcast,
    onPortChosen: (port) => storage.updateLocalEnginePreferences({ port }),
    baseEnv: env,
    nodePath,
    nodeEnv,
    cwd,
    log,
    engineEnv
  });

  const control = createEngineControlClient({
    fetch: fetchWithTimeout,
    getBaseUrl: () => supervisor.getState().url,
    getSecret: () => supervisor.getControlSecret()
  });

  function signalsPayload() {
    return { ...(osSignals ? osSignals.snapshot() : {}), opt_in: backgroundJobsView().enabled };
  }

  /** Give a (re)started engine the person's session and the current signals. */
  function pushControl(state = supervisor.getState()) {
    if (!state.healthy || !supervisor.getControlSecret()) {return;}
    const token = getAuthToken() || null;
    const key = `${state.pid}:${token ? crypto.createHash('sha256').update(token).digest('hex') : 'none'}`;
    if (key === pushedFor) {return;}
    pushedFor = key;
    control.sendSignals(signalsPayload())
      .then(() => control.setSession(token))
      .then((answer) => {
        if (!answer.ok) {pushedFor = null;}
        return pushOfflineKey(token);
      })
      .catch(() => { pushedFor = null; });
  }

  /**
   * Phase 10: the offline copy key follows the session. Signed in: the key from
   * the keychain; signed out: the engine closes (and has wiped) the copy and
   * the key is removed, so nothing left on disk can be opened.
   */
  function pushOfflineKey(token) {
    return pushOfflineKeyFor({ token, offlineKey, control });
  }

  /** Sign-in, sign-out or a user switch in this app. */
  function sessionChanged() {
    pushedFor = null;
    pushControl();
  }

  /**
   * Start passing OS signals (call once the app is ready). Sleep and quit are
   * urgent: the engine hands its running jobs off before answering.
   * @param {Object} signals - createOsSignals(...) without onChange wired
   */
  function attachOsSignals(createSignals) {
    osSignals = createSignals((_snapshot, { urgent }) => {
      control.sendSignals(signalsPayload(), urgent ? { waitMs: HANDOFF_WAIT_MS } : {}).catch(() => {});
    });
    return osSignals;
  }

  /** The app is quitting: hand running jobs off (up to HANDOFF_WAIT_MS), then stop the engine. */
  async function prepareQuit() {
    if (osSignals) {osSignals.markQuitting();}
    await control.sendSignals({ ...signalsPayload(), app_quitting: true }, { waitMs: HANDOFF_WAIT_MS }).catch(() => null);
    if (osSignals) {osSignals.stop();}
    await supervisor.stop();
  }

  function chefUrl() {
    const server = storage.getSavedServer();
    return server && server.url ? server.url : null;
  }

  /** The box Chef's certificate pin (control plane), for the engine's upstream. */
  function chefCertSha256() {
    const server = storage.getSavedServer();
    return server && server.chefCertSha256 ? server.chefCertSha256 : null;
  }

  function currentApiBase(state = supervisor.getState()) {
    return resolveApiBase(chefUrl(), state);
  }

  /** Re-read settings and the saved server; start, restart or stop the engine. */
  async function sync() {
    config = engineConfig();
    await supervisor.configure(config, chefUrl(), chefCertSha256());
    return status();
  }

  /**
   * Wait until the engine answers its health check, or it is off, or timeoutMs passes. The main
   * window waits on this before it loads, so its first calls do not go to an engine that is not
   * listening yet. Never throws; resolves true when the engine is ready.
   */
  async function untilReady({ timeoutMs = 20000, pollMs = 250, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    const end = now() + timeoutMs;
    for (;;) {
      const state = supervisor.getState();
      if (state.mode === 'off') {return false;}
      if (state.healthy) {return true;}
      if (now() >= end) {
        log.warn(`[local-engine] the engine did not answer within ${timeoutMs} ms; opening the window anyway`);
        return false;
      }
      await sleep(pollMs);
    }
  }

  function status() {
    const state = supervisor.getState();
    return statusView(state, config, currentApiBase(state), backgroundJobsView(), localAiProblem);
  }

  function registerIpc() {
    ipcMain.on(CHANNELS.apiBaseSync, (event) => {
      try { event.returnValue = currentApiBase(); } catch (_error) { event.returnValue = null; }
    });
    ipcMain.handle(CHANNELS.status, async () => ({ success: true, status: status() }));
    ipcMain.handle(CHANNELS.restart, async () => {
      if (!isEngineInUse(supervisor.getState())) {return { success: false, error: 'The local AI service is not in use.' };}
      await supervisor.restart();
      return { success: true, status: status() };
    });
    ipcMain.handle(CHANNELS.setEnabled, async (_event, payload) => {
      if (typeof payload?.enabled !== 'boolean') {return { success: false, error: 'Invalid setting.' };}
      if (!config.configured) {return { success: false, error: 'No local AI service is installed on this computer.' };}
      storage.updateLocalEnginePreferences({ enabled: payload.enabled });
      return { success: true, status: await sync() };
    });
    ipcMain.handle(CHANNELS.setBackgroundJobs, async (_event, payload) => {
      if (typeof payload?.enabled !== 'boolean') {return { success: false, error: 'Invalid setting.' };}
      if (!config.configured) {return { success: false, error: 'No local AI service is installed on this computer.' };}
      storage.updateLocalEnginePreferences({ backgroundJobs: payload.enabled });
      await control.sendSignals(signalsPayload()).catch(() => null);
      return { success: true, status: status() };
    });
    ipcMain.handle(CHANNELS.backgroundJobs, async () => {
      const answer = await control.backgroundJobs();
      if (!answer.ok) {return { success: false, error: answer.error };}
      return { success: true, jobs: answer.body };
    });
  }

  return {
    supervisor,
    sync,
    status,
    registerIpc,
    apiBase: () => currentApiBase(),
    present: (server) => presentServer(server, supervisor.getState()),
    toStored: (server) => toStoredServer(server, { engineUrl: supervisor.getState().url, storedUrl: chefUrl() }),
    stop: () => supervisor.stop(),
    setModelEndpoints,
    setLocalAiProblem,
    untilReady,
    prepareQuit,
    attachOsSignals,
    sessionChanged,
    canOpenOffline: () => canOpenOffline({ config, offlineKey, signedIn: Boolean(getAuthToken()) }),
    control
  };
}

module.exports = { createLocalEngineHost, bundledEngineRoot, DEFAULT_ENGINE_TIER, REDACTOR_ENV, DOCLING_ENV, statusView, pickLoopbackPort, backgroundJobsEnabled, CHANNELS, ENGINE_MODEL_ENV, pushOfflineKeyFor, canOpenOffline };
