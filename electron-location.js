'use strict';

/**
 * Settings > General > Location: the main-process side of the location permission.
 *
 *   isAppPage(pageUrl, appRoot)       true only for the app's own pages (file:// under public_html)
 *   allowGeolocation({ pageUrl, appRoot, allowed })
 *                                     geolocation is allowed only for the app's own pages, and only
 *                                     after the person turned Location on in Settings
 *   installLocationPermissionHandlers(session, { appRoot, isAllowed })
 *                                     session permission handlers; every other permission keeps
 *                                     Electron's default (allowed), as before this module
 *   registerLocationIpc(ipcMain, { persistence })
 *                                     location:get-choice, location:set-choice
 *
 * The position itself is read in the preload (navigator.geolocation) and rounded there
 * (src/js/location-permission.model.js), so the main process never sees it. Nothing here is
 * sent to a server, and no geocoding or IP lookup service is called.
 */

const path = require('path');
const { fileURLToPath } = require('url');

const GEOLOCATION = 'geolocation';

/** The file a file:// page URL points at is inside appRoot (no other origin, no path escape). */
function isAppPage(pageUrl, appRoot) {
  if (!appRoot) return false;
  let filePath;
  try {
    const parsed = new URL(String(pageUrl || ''));
    if (parsed.protocol !== 'file:') return false;
    filePath = fileURLToPath(parsed);
  } catch (_) {
    return false;
  }
  const rel = path.relative(path.resolve(appRoot), path.resolve(filePath));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function allowGeolocation({ pageUrl, appRoot, allowed }) {
  return Boolean(allowed) && isAppPage(pageUrl, appRoot);
}

function pageUrlOf(webContents, details) {
  if (details && details.requestingUrl) return details.requestingUrl;
  try {
    return webContents && typeof webContents.getURL === 'function' ? webContents.getURL() : '';
  } catch (_) {
    return '';
  }
}

/**
 * @param {Electron.Session} session
 * @param {{ appRoot: string, isAllowed: () => boolean }} options
 */
function installLocationPermissionHandlers(session, { appRoot, isAllowed }) {
  const decide = (webContents, details) => allowGeolocation({ pageUrl: pageUrlOf(webContents, details), appRoot, allowed: isAllowed() });
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permission === GEOLOCATION ? decide(webContents, details) : true);
  });
  session.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => (
    permission === GEOLOCATION ? decide(webContents, details) : true
  ));
}

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {{ persistence: { read: () => { allowed: boolean }, write: (changes: Object) => { allowed: boolean } } }} options
 */
function registerLocationIpc(ipcMain, { persistence }) {
  ipcMain.handle('location:get-choice', async () => {
    try {
      return { success: true, allowed: persistence.read().allowed === true };
    } catch (_) {
      return { success: false, error: 'LANA could not read your location setting.' };
    }
  });
  ipcMain.handle('location:set-choice', async (_event, payload) => {
    if (!payload || typeof payload.allowed !== 'boolean') return { success: false, error: 'Invalid location setting.' };
    try {
      return { success: true, allowed: persistence.write({ allowed: payload.allowed }).allowed === true };
    } catch (_) {
      return { success: false, error: 'LANA could not save your location setting.' };
    }
  });
}

module.exports = { GEOLOCATION, isAppPage, allowGeolocation, installLocationPermissionHandlers, registerLocationIpc };
