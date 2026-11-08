/**
 * Settings > General: facts about this computer and this copy of the LANA client, and its
 * software update status. Main process only; the renderer formats the numbers
 * (src/js/settings-general.model.js).
 *
 *   systemInfo(deps)            the About and Language & region facts
 *   registerSystemInfoIpc(...)  settings:system-info, settings:update-status,
 *                               settings:check-for-updates, settings:install-update
 *
 * Nothing here is sent anywhere. The computer name is shown only on this computer.
 */
'use strict';

const os = require('os');
const fs = require('fs');

/** The computer's name without the network suffix macOS adds ("Michaels-Mac.local"). */
function computerName(hostname) {
  return String(hostname || '').replace(/\.local$/i, '');
}

/** Disk capacity and free space of the volume holding `dir`, or nulls when it cannot be read. */
function storage(dir, statfs = fs.statfsSync) {
  try {
    const stats = statfs(dir);
    return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
  } catch (_) {
    return { totalBytes: null, freeBytes: null };
  }
}

function list(read) {
  try {
    const value = read();
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

/**
 * @param {object} deps
 * @param {Electron.App} deps.app
 * @param {string} deps.displayVersion   the client's own version label ("v4.1.0")
 * @param {NodeJS.Process} [deps.processRef]
 * @param {typeof os} [deps.osRef]
 * @param {Function} [deps.statfs]
 */
function systemInfo({ app, displayVersion, processRef = process, osRef = os, statfs = fs.statfsSync }) {
  const cpus = list(() => osRef.cpus());
  const versions = processRef.versions || {};
  return {
    app: {
      version: app.getVersion(),
      displayVersion: displayVersion || `v${app.getVersion()}`,
      packaged: Boolean(app.isPackaged),
      electron: versions.electron || null,
      chrome: versions.chrome || null,
      node: versions.node || null,
    },
    device: {
      computerName: computerName(osRef.hostname()),
      platform: processRef.platform,
      osVersion: typeof processRef.getSystemVersion === 'function' ? processRef.getSystemVersion() : osRef.release(),
      arch: processRef.arch,
      cpuModel: cpus.length ? String(cpus[0].model || '').trim() : null,
      cpuCores: cpus.length || null,
      memoryBytes: osRef.totalmem(),
    },
    storage: storage(app.getPath('userData'), statfs),
    locale: {
      appLocale: app.getLocale(),
      systemLocale: typeof app.getSystemLocale === 'function' ? app.getSystemLocale() : null,
      preferredLanguages: typeof app.getPreferredSystemLanguages === 'function' ? list(() => app.getPreferredSystemLanguages()) : [],
    },
  };
}

/** The last check's result as Settings shows it; the raw error never leaves main. */
function resultView(info) {
  if (!info) return null;
  return {
    updateAvailable: Boolean(info.updateAvailable),
    updateRequired: Boolean(info.updateRequired),
    version: info.version || null,
    releaseNotes: info.releaseNotes || null,
    message: info.message || null,
    error: info.error ? 'LANA could not reach the update service.' : null,
  };
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {object} deps
 * @param {Electron.App} deps.app
 * @param {() => string} deps.displayVersion
 * @param {(serverUrl: string|null, token: null, orgId: string|null) => Promise<object>} deps.checkForUpdates
 * @param {() => Date|null} deps.lastChecked
 * @param {() => object|null} deps.lastResult   the last finished check's result (any caller)
 * @param {() => ({url?: string, orgId?: string}|null)} deps.savedServer
 * @param {(serverUrl: string|null) => Promise<void>} deps.installUpdate   the existing update dialog flow
 * @param {(...args: unknown[]) => void} deps.logError
 */
function registerSystemInfoIpc(ipcMain, deps) {
  function status() {
    const checked = deps.lastChecked();
    return {
      currentVersion: deps.displayVersion(),
      packaged: Boolean(deps.app.isPackaged),
      lastChecked: checked ? checked.toISOString() : null,
      result: resultView(deps.lastResult()),
    };
  }

  ipcMain.handle('settings:system-info', async () => {
    try {
      return { success: true, info: systemInfo({ app: deps.app, displayVersion: deps.displayVersion() }) };
    } catch (error) {
      deps.logError('[settings] Failed to read system info', error);
      return { success: false, error: 'LANA could not read this computer\'s details.' };
    }
  });

  ipcMain.handle('settings:update-status', async () => ({ success: true, status: status() }));

  ipcMain.handle('settings:check-for-updates', async () => {
    try {
      const server = deps.savedServer();
      await deps.checkForUpdates(server ? server.url || null : null, null, server ? server.orgId || null : null);
      return { success: true, status: status() };
    } catch (error) {
      deps.logError('[settings] Update check failed', error);
      return { success: false, error: 'LANA could not check for updates. Try again.' };
    }
  });

  ipcMain.handle('settings:install-update', async () => {
    const server = deps.savedServer();
    // The existing flow: it checks again, then shows the update window with its progress.
    deps.installUpdate(server ? server.url || null : null).catch((error) => deps.logError('[settings] Update install failed', error));
    return { success: true };
  });
}

module.exports = { systemInfo, registerSystemInfoIpc, computerName, storage };
