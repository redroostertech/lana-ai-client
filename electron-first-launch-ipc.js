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
 */

const CHANNELS = Object.freeze({
  plan: 'first-launch:plan',
  choose: 'first-launch:choose',
  findExisting: 'first-launch:find-existing',
  continue: 'first-launch:continue',
  pause: 'first-launch:pause',
  resume: 'first-launch:resume',
  status: 'first-launch:status',
  statusChanged: 'first-launch:status-changed'
});

function failure(error) {
  return { success: false, error: (error && error.message) || 'Something went wrong.' };
}

/**
 * @param {Object} deps
 * @param {Object} deps.ipcMain
 * @param {Object} deps.firstLaunch - createFirstLaunch()
 * @param {(error: Error) => void} [deps.log]
 */
function registerFirstLaunchIpc({ ipcMain, firstLaunch, log = () => {} }) {
  ipcMain.handle(CHANNELS.plan, async () => {
    try { return { success: true, plan: await firstLaunch.plan() }; } catch (error) { log(error); return failure(error); }
  });

  ipcMain.handle(CHANNELS.choose, async (_event, payload) => {
    const chatId = payload && payload.chatId;
    if (chatId !== null && typeof chatId !== 'string') {return { success: false, error: 'Choose a chat model from the list.' };}
    try {
      if (chatId !== null) {
        // Only a model this computer can run; a model marked too big is never saved.
        const current = await firstLaunch.plan();
        const choice = current.chatChoices.find((c) => c.id === chatId);
        if (!choice || choice.fit === 'wont_fit') {return { success: false, error: 'That chat model does not fit this computer.' };}
      }
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

module.exports = { CHANNELS, registerFirstLaunchIpc, broadcastFirstLaunchStatus, devHardwareReader };
