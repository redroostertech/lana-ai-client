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
const childProcess = require('child_process');
const { createEngineSupervisor, LOOPBACK_HOST } = require('./electron-engine-supervisor');
const { resolveEngineConfig, resolveApiBase, presentServer, toStoredServer, isEngineInUse } = require('./electron-api-base');

const CHANNELS = Object.freeze({
  apiBaseSync: 'engine:api-base-sync',
  status: 'engine:status',
  restart: 'engine:restart',
  setEnabled: 'engine:set-enabled',
  state: 'engine:state'
});

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

/** What the renderer is shown: no process details beyond what Settings needs. */
function statusView(state, config, apiBase) {
  const health = state.health || null;
  return {
    configured: config.configured,
    enabled: config.enabled,
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
 * @param {Object} deps
 * @param {Object} deps.ipcMain
 * @param {Object} deps.app - for isPackaged, getPath, execPath
 * @param {Object} deps.storage - { getSavedServer, getLocalEnginePreferences, updateLocalEnginePreferences }
 * @param {Function} deps.getWindows - () => BrowserWindow[]
 * @param {Object} [deps.env]
 * @param {Object} deps.log - { info, warn, error }
 */
function createLocalEngineHost({ ipcMain, app, storage, getWindows, env = process.env, log }) {
  const cwd = path.join(app.getPath('userData'), 'local-engine');
  try { fs.mkdirSync(cwd, { recursive: true }); } catch (_error) { /* spawn reports it */ }

  // Packaged builds have no `node` on PATH: run Electron's binary as node.
  const nodePath = env.LANA_ENGINE_NODE || (app.isPackaged ? process.execPath : 'node');
  const nodeEnv = !env.LANA_ENGINE_NODE && app.isPackaged ? { ELECTRON_RUN_AS_NODE: '1' } : {};

  let config = resolveEngineConfig(env, storage.getLocalEnginePreferences());

  function broadcast(state) {
    const payload = statusView(state, config, currentApiBase(state));
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
    log
  });

  function chefUrl() {
    const server = storage.getSavedServer();
    return server && server.url ? server.url : null;
  }

  function currentApiBase(state = supervisor.getState()) {
    return resolveApiBase(chefUrl(), state);
  }

  /** Re-read settings and the saved server; start, restart or stop the engine. */
  async function sync() {
    config = resolveEngineConfig(env, storage.getLocalEnginePreferences());
    await supervisor.configure(config, chefUrl());
    return status();
  }

  function status() {
    const state = supervisor.getState();
    return statusView(state, config, currentApiBase(state));
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
  }

  return {
    supervisor,
    sync,
    status,
    registerIpc,
    apiBase: () => currentApiBase(),
    present: (server) => presentServer(server, supervisor.getState()),
    toStored: (server) => toStoredServer(server, { engineUrl: supervisor.getState().url, storedUrl: chefUrl() }),
    stop: () => supervisor.stop()
  };
}

module.exports = { createLocalEngineHost, statusView, pickLoopbackPort, CHANNELS };
