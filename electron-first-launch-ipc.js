'use strict';

/**
 * The first-launch screen's calls into the main process (first-launch plan, phase D).
 * The page (src/first-launch.html) sees only the plan view (electron-first-launch.js plan(),
 * which leaves out file entries and addresses) and the download status.
 *
 *   first-launch:plan      the plan view for this computer
 *   first-launch:choose    keep the person's chat choice (null is LANA's default); returns the new plan view
 *   first-launch:find-existing  model files already on this computer that LANA can use (checked)
 *   first-launch:continue  the person pressed Continue ({ useExisting }): downloads start in the background
 *   first-launch:pause     stop after the bytes received are on disk
 *   first-launch:resume    pick up again (also Try again after a failure)
 *   first-launch:status    the download status now
 *   first-launch:status-changed  (push) every status change, to every window
 *
 * Settings > Capabilities (phase E) uses the same plan view and status, plus:
 *
 *   first-launch:capabilities  the plan view and the state of each local server
 *   first-launch:servers       the state of each local server only (cheap, polled while shown)
 *   first-launch:switch-chat   use another chat model from now on: saved at once, then its files
 *                              download in the background and Pip restarts only the chat server
 *
 * A server's state is plain: ready, starting, not_running, or not_installed. No address, port
 * or file path reaches the page.
 */

const CHANNELS = Object.freeze({
  plan: 'first-launch:plan',
  choose: 'first-launch:choose',
  findExisting: 'first-launch:find-existing',
  continue: 'first-launch:continue',
  pause: 'first-launch:pause',
  resume: 'first-launch:resume',
  status: 'first-launch:status',
  statusChanged: 'first-launch:status-changed',
  capabilities: 'first-launch:capabilities',
  servers: 'first-launch:servers',
  switchChat: 'first-launch:switch-chat'
});

function failure(error) {
  return { success: false, error: (error && error.message) || 'Something went wrong.' };
}

/** A kept process's state (electron-process-keeper.js) in plain words for the page. */
function plainServerState(server) {
  if (!server || server.process === 'stopped') {return 'not_running';}
  if (server.process === 'running' && server.healthy) {return 'ready';}
  return 'starting';
}

/**
 * The state of each server on this computer, for Settings > Capabilities.
 * @param {Object} deps
 * @param {{ getState(): Object }} deps.pip - electron-pip-supervisor.js
 * @param {{ getState(): Object }} deps.redactor - electron-redactor.js
 * @param {{ getState(): Object }} deps.docling - electron-docling.js
 * @param {Object} [deps.env] - a role whose address the environment names is that server's
 * @param {(url: string) => Promise<{ state: string }>} [deps.probe] - electron-ai-topology.js pipEndpoint
 * @returns {Promise<{ pipInstalled, chat, embedding, redactor, docling }>}
 */
async function localServerStates({ pip, redactor, docling, env = {}, probe = null }) {
  const pipState = pip.getState();
  const named = async (role, variable) => {
    if (!env[variable] || !probe) {return plainServerState(pipState.servers[role]);}
    const found = await probe(env[variable]);
    return found && found.state === 'running' ? 'ready' : 'not_running';
  };
  const redactorState = redactor.getState();
  const doclingState = docling.getState();
  return {
    pipInstalled: Boolean(pipState.installed),
    chat: await named('chat', 'LANA_ENGINE_CHAT_URL'),
    embedding: await named('embedding', 'LANA_ENGINE_EMBEDDING_URL'),
    redactor: env.REDACTOR_URL ? 'ready' : redactorState.installed ? plainServerState(redactorState.server) : 'not_installed',
    // A Docling the developer runs is checked by the engine itself before each use.
    docling: doclingState.external ? 'ready' : doclingState.installed ? plainServerState(doclingState.server) : 'not_installed'
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.ipcMain
 * @param {Object} deps.firstLaunch - createFirstLaunch()
 * @param {() => Promise<Object>} [deps.servers] - localServerStates() bound to this app's servers
 * @param {(error: Error) => void} [deps.log]
 */
function registerFirstLaunchIpc({ ipcMain, firstLaunch, servers = async () => null, log = () => {} }) {
  /** Only a model this computer can run; a model marked too big is never saved. */
  async function fitsHere(chatId) {
    const current = await firstLaunch.plan();
    const choice = current.chatChoices.find((c) => c.id === chatId);
    return Boolean(choice && choice.fit !== 'wont_fit');
  }

  ipcMain.handle(CHANNELS.plan, async () => {
    try { return { success: true, plan: await firstLaunch.plan() }; } catch (error) { log(error); return failure(error); }
  });

  ipcMain.handle(CHANNELS.choose, async (_event, payload) => {
    const chatId = payload && payload.chatId;
    if (chatId !== null && typeof chatId !== 'string') {return { success: false, error: 'Choose a chat model from the list.' };}
    try {
      if (chatId !== null && !(await fitsHere(chatId))) {return { success: false, error: 'That chat model does not fit this computer.' };}
      firstLaunch.choose(chatId);
      return { success: true, plan: await firstLaunch.plan() };
    } catch (error) { log(error); return failure(error); }
  });

  ipcMain.handle(CHANNELS.findExisting, async () => {
    try { return { success: true, found: await firstLaunch.findExisting() }; } catch (error) { log(error); return failure(error); }
  });

  ipcMain.handle(CHANNELS.continue, async (_event, payload) => {
    // Downloads run in the background; the page follows them through status-changed.
    void firstLaunch.accept({ useExisting: Boolean(payload && payload.useExisting === true) });
    return { success: true, status: firstLaunch.status() };
  });

  ipcMain.handle(CHANNELS.pause, async () => {
    await firstLaunch.pause();
    return { success: true, status: firstLaunch.status() };
  });

  ipcMain.handle(CHANNELS.resume, async () => {
    void firstLaunch.start();
    return { success: true, status: firstLaunch.status() };
  });

  ipcMain.handle(CHANNELS.status, async () => ({ success: true, status: firstLaunch.status() }));

  ipcMain.handle(CHANNELS.capabilities, async () => {
    try {
      const [plan, states] = await Promise.all([firstLaunch.plan(), servers()]);
      return { success: true, plan, servers: states };
    } catch (error) { log(error); return failure(error); }
  });

  ipcMain.handle(CHANNELS.servers, async () => {
    try { return { success: true, servers: await servers() }; } catch (error) { log(error); return failure(error); }
  });

  ipcMain.handle(CHANNELS.switchChat, async (_event, payload) => {
    const chatId = payload && payload.chatId;
    if (chatId !== null && typeof chatId !== 'string') {return { success: false, error: 'Choose a chat model from the list.' };}
    try {
      if (chatId !== null && !(await fitsHere(chatId))) {return { success: false, error: 'That chat model does not fit this computer.' };}
      // The choice is saved at once; the downloads and the restart follow through status-changed.
      void firstLaunch.switchChat(chatId);
      return { success: true, plan: await firstLaunch.plan(), status: firstLaunch.status() };
    } catch (error) { log(error); return failure(error); }
  });
}

/** Send a status change to every open window. */
function broadcastFirstLaunchStatus(windows, status) {
  for (const win of windows) {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(CHANNELS.statusChanged, status);
    }
  }
}

/**
 * Development only: pretend this computer is smaller (or bigger) to see the screen's other
 * states, for example the cloud state. Honored only when NODE_ENV=development and the app is
 * not packaged. LANA_DEV_HARDWARE is JSON: { memoryGb, backend: 'metal'|'cuda'|'cpu', vramGb, freeDiskGb, chip }.
 * @returns {Function|null} a hardware reader wrapping the real one, or null when not in use
 */
function devHardwareReader({ env, isPackaged, read }) {
  if (isPackaged || env.NODE_ENV !== 'development' || !env.LANA_DEV_HARDWARE) {return null;}
  let fake;
  try { fake = JSON.parse(env.LANA_DEV_HARDWARE); } catch (_) { return null; }
  if (!fake || typeof fake !== 'object') {return null;}
  const GB = 1024 ** 3;
  return (options) => {
    const real = read(options);
    const backend = fake.backend || (real.accelerator && real.accelerator.backend) || 'cpu';
    return {
      ...real,
      totalMemoryBytes: fake.memoryGb ? fake.memoryGb * GB : real.totalMemoryBytes,
      freeDiskBytes: fake.freeDiskGb != null ? fake.freeDiskGb * GB : real.freeDiskBytes,
      chip: fake.chip || real.chip,
      accelerator: { ...(real.accelerator || {}), backend, vramBytes: fake.vramGb ? fake.vramGb * GB : ((real.accelerator || {}).vramBytes || null) }
    };
  };
}

module.exports = { CHANNELS, registerFirstLaunchIpc, broadcastFirstLaunchStatus, devHardwareReader, plainServerState, localServerStates };
