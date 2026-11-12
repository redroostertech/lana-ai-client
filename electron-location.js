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
 *   systemSettingsUrl(platform)       the computer's own location privacy page, or null
 *   registerLocationIpc(ipcMain, { persistence, shell, platform, isPackaged })
 *                                     location:get-choice, location:set-choice,
 *                                     location:system, location:open-system-settings
 *
 * The position itself is read in the preload (navigator.geolocation) and rounded there
 * (src/js/location-permission.model.js), so the main process never sees it. Nothing here is
 * sent to a server, and no geocoding or IP lookup service is called.
 */

const path = require('path');
const { fileURLToPath } = require('url');

const GEOLOCATION = 'geolocation';

// "Open Settings" in Settings > General > Location. The address is fixed here per platform and
// never comes from a page: the external-URL allowlist keeps these schemes closed to pages.
const SYSTEM_SETTINGS_URLS = Object.freeze({
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices',
  win32: 'ms-settings:privacy-location'
});

function systemSettingsUrl(platform) {
  return Object.prototype.hasOwnProperty.call(SYSTEM_SETTINGS_URLS, platform) ? SYSTEM_SETTINGS_URLS[platform] : null;
}

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
 * @param {{ persistence: { read: () => { allowed: boolean }, write: (changes: Object) => { allowed: boolean } },
 *   shell?: { openExternal: (url: string) => Promise<void> }, platform?: string, isPackaged?: boolean }} options
 *   isPackaged false is a development build: the stock Electron app, with no location usage
 *   text, which the computer does not share its location with (2026-11-12).
 */
function registerLocationIpc(ipcMain, { persistence, shell = null, platform = process.platform, isPackaged = true }) {
  const settingsUrl = shell ? systemSettingsUrl(platform) : null;
  ipcMain.handle('location:system', async () => ({ success: true, settingsAvailable: Boolean(settingsUrl), devBuild: isPackaged === false }));
  // Takes nothing from the page: it opens this platform's page or nothing.
  ipcMain.handle('location:open-system-settings', async () => {
    if (!settingsUrl) return { success: false, error: 'LANA cannot open location settings on this computer.' };
    try {
      await shell.openExternal(settingsUrl);
      return { success: true };
    } catch (_) {
      return { success: false, error: 'LANA could not open your computer\'s location settings.' };
    }
  });
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

module.exports = { GEOLOCATION, isAppPage, allowGeolocation, installLocationPermissionHandlers, registerLocationIpc, systemSettingsUrl };
