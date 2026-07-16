/**
 * Electron Custom Updater Module
 * 
 * Handles application updates with server-controlled update policy
 * Queries the Mac Studio server for allowed version before checking GitHub releases
 */

const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow, ipcMain } = require('electron');
const axios = require('axios');
const path = require('path');
const url = require('url');
const { logInfo, logError, logWarn } = require('./electron-logger');

// Update state
let updateCheckInProgress = false;
let lastUpdateCheck = null;
let currentUpdateInfo = null;

/**
 * Check for updates against server policy
 * @param {string} serverUrl - Server URL (e.g., 'http://192.168.1.100:8080')
 * @param {string} authToken - Authentication token (optional)
 * @param {string} orgId - Organization ID (optional, from saved server connection)
 * @returns {Promise<Object>} Update information
 */
async function checkForUpdates(serverUrl, authToken = null, orgId = null) {
  if (updateCheckInProgress) {
    logWarn('Update check already in progress');
    return { updateAvailable: false, message: 'Check already in progress' };
  }

  updateCheckInProgress = true;
  lastUpdateCheck = new Date();

  try {
    logInfo('Checking for updates...');

    // Step 1: Query server update policy via hosted discovery service
    const policyUrl = 'https://www.redroostertec.com/lana-ai/v1/client/version-check';
    const currentVersion = app.getVersion();

    const requestBody = {
      client_version: currentVersion,
      platform: process.platform,
      arch: process.arch
    };

    // Add organization ID if available
    if (orgId) {
      requestBody.org_id = orgId;
    }

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': `LanaAI-Client/${currentVersion}`
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const policyResponse = await axios.post(policyUrl, requestBody, {
      headers: headers,
      timeout: 10000
    });

    if (policyResponse.status !== 200) {
      throw new Error(`Update policy check failed: ${policyResponse.status}`);
    }

    const policy = policyResponse.data;

    logInfo(`Current version: ${policy.client_version}`);
    logInfo(`Latest version: ${policy.latest_version}`);
    logInfo(`Status: ${policy.status}`);
    logInfo(`Force update: ${policy.force_update}`);

    const updateAvailable = policy.status === 'update_available' || policy.status === 'update_required';
    const updateRequired = policy.force_update || policy.status === 'update_required';

    currentUpdateInfo = {
      currentVersion: policy.client_version,
      availableVersion: policy.latest_version,
      updateAvailable: updateAvailable,
      updateRequired: updateRequired,
      channel: policy.update_channel,
      releaseNotes: policy.release_notes,
      downloadUrl: policy.download_url,
      checksum: policy.checksum_sha256
    };

    // Step 2: If no update available, we're done
    if (!updateAvailable) {
      logInfo('No updates available');
      updateCheckInProgress = false;
      return {
        updateAvailable: false,
        message: policy.message || 'You are running the latest version'
      };
    }

    // Step 3: If update is available, prepare update info
    logInfo(`Update available: ${policy.latest_version}`);

    updateCheckInProgress = false;
    return {
      updateAvailable: true,
      updateRequired: updateRequired,
      version: policy.latest_version,
      currentVersion: policy.client_version,
      releaseNotes: policy.release_notes,
      downloadUrl: policy.download_url,
      channel: policy.update_channel
    };

  } catch (error) {
    logError('Failed to check for updates', error);
    updateCheckInProgress = false;
    return {
      updateAvailable: false,
      error: error.message
    };
  }
}

/**
 * Configure electron-updater for GitHub releases
 * @param {Object} config - Update configuration
 */
function configureAutoUpdater(config = {}) {
  const {
    owner = 'redroostertech',
    repo = 'lana-ai-client',
    channel = 'latest'
  } = config;

  // Configure electron-updater
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: owner,
    repo: repo,
    channel: channel
  });

  // Allow downgrade if server specifies older version
  autoUpdater.allowDowngrade = true;

  // Auto-download updates
  autoUpdater.autoDownload = false; // We'll control this manually

  // Force dev update config so checkForUpdates works in unpackaged mode
  autoUpdater.forceDevUpdateConfig = true;

  // Setup event listeners
  autoUpdater.on('checking-for-update', () => {
    logInfo('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    logInfo(`Update available: ${info.version}`);
  });

  autoUpdater.on('update-not-available', (info) => {
    logInfo('Update not available');
  });

  autoUpdater.on('error', (error) => {
    logError('Auto-updater error', error);
  });

  autoUpdater.on('download-progress', (progress) => {
    logInfo(`Download progress: ${progress.percent.toFixed(2)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    logInfo(`Update downloaded: ${info.version}`);
  });
}

/**
 * Download and install update
 * @param {string} serverUrl - Server URL
 * @param {string} authToken - Auth token (optional)
 * @param {string} orgId - Organization ID (optional)
 * @returns {Promise<boolean>} Success status
 */
async function downloadAndInstallUpdate(serverUrl, authToken = null, orgId = null) {
  try {
    // Ensure autoUpdater feed URL is configured before downloading
    configureAutoUpdater();

    // electron-updater requires checkForUpdates() before downloadUpdate()
    logInfo('Checking GitHub releases for update...');
    await autoUpdater.checkForUpdates();

    logInfo('Downloading update...');

    // Download update using electron-updater
    // Progress and completion events are handled by showUpdateDialog listeners
    await autoUpdater.downloadUpdate();

    logInfo('Update downloaded successfully');

    // Short delay so user sees 100% before restart
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Install and restart
    logInfo('Installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);

    return true;
  } catch (error) {
    logError('Failed to download and install update', error);
    // Error event is forwarded to dialog by showUpdateDialog listeners
    return false;
  }
}

// Active update dialog window reference
let updateDialogWindow = null;

/**
 * Create a file:// URL for the update dialog
 * @param {Object} params - Query parameters
 * @returns {string} File URL with query params
 */
function createUpdateDialogUrl(params) {
  const dialogPath = path.join(__dirname, 'public_html', 'update-dialog.html');
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v || '')}`)
    .join('&');

  let normalizedPath = dialogPath;
  if (process.platform === 'win32') {
    normalizedPath = dialogPath.replace(/\\/g, '/');
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
  }

  return url.format({
    pathname: normalizedPath,
    protocol: 'file:',
    slashes: true
  }) + '?' + queryString;
}

/**
 * Show a custom styled update dialog in a BrowserWindow
 * @param {Object} updateInfo - Update information
 * @param {BrowserWindow} parentWindow - Parent window reference
 * @param {string} type - 'optional' or 'forced'
 * @returns {Promise<string>} User choice ('update', 'later', 'skip', 'retry')
 */
function showUpdateDialog(updateInfo, parentWindow, type = 'optional') {
  return new Promise((resolve) => {
    const isForced = type === 'forced';
    const dialogWidth = 480;
    const dialogHeight = isForced ? 480 : 520;

    updateDialogWindow = new BrowserWindow({
      width: dialogWidth,
      height: dialogHeight,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: !isForced,
      frame: false,
      transparent: true,
      modal: true,
      parent: parentWindow || undefined,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'electron-preload.js'),
        sandbox: true,
        webSecurity: true
      }
    });

    const dialogUrl = createUpdateDialogUrl({
      type: type,
      currentVersion: updateInfo.currentVersion,
      version: updateInfo.version,
      releaseNotes: updateInfo.releaseNotes || '',
      platform: process.platform,
      arch: process.arch
    });

    updateDialogWindow.loadURL(dialogUrl);

    updateDialogWindow.once('ready-to-show', () => {
      updateDialogWindow.show();
    });

    // Handle user response from dialog
    // Use ipcMain.on (not .handle) so it can receive multiple messages (e.g. retry)
    const responseChannel = 'update-dialog-response';
    const responseHandler = async (event, choice) => {
      if (!updateDialogWindow || updateDialogWindow.isDestroyed() || event.sender !== updateDialogWindow.webContents) {
        logError('Rejected update dialog response from an untrusted sender');
        return;
      }
      if (!['update', 'retry', 'later', 'skip'].includes(choice)) {
        logError('Rejected invalid update dialog response');
        return;
      }
      logInfo(`Update dialog response: ${choice}`);

      if (choice === 'update') {
        // Don't close dialog — it will show download progress
        resolve('update');
      } else if (choice === 'retry') {
        // Retry download directly without going back through the promise chain
        logInfo('Retrying update download...');
        try {
          // Re-configure feed URL
          configureAutoUpdater();
          // Re-register dialog-forwarding listeners (configureAutoUpdater overwrites them)
          setupDialogListeners();
          await autoUpdater.checkForUpdates();
          await autoUpdater.downloadUpdate();
          logInfo('Retry download succeeded');
          await new Promise(r => setTimeout(r, 1500));
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          logError('Retry download failed', error);
          // Send error to dialog so it shows error state again
          if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
            updateDialogWindow.webContents.send('update-error', {
              message: error?.message || 'Download failed. Please try again.'
            });
          }
        }
      } else {
        // Close dialog for later/skip
        if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
          updateDialogWindow.close();
          updateDialogWindow = null;
        }
        ipcMain.removeListener(responseChannel, responseHandler);
        resolve(choice);
      }
    };

    // Remove any existing listeners before registering
    ipcMain.removeAllListeners(responseChannel);
    ipcMain.on(responseChannel, responseHandler);

    // Handle dialog close (for optional updates only)
    updateDialogWindow.on('closed', () => {
      updateDialogWindow = null;
      ipcMain.removeAllListeners(responseChannel);
      resolve('later');
    });

    // Setup listeners that forward autoUpdater events to the dialog window
    function setupDialogListeners() {
      autoUpdater.removeAllListeners('download-progress');
      autoUpdater.on('download-progress', (progress) => {
        logInfo(`Download progress: ${progress.percent.toFixed(2)}%`);
        if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
          updateDialogWindow.webContents.send('update-progress', progress);
        }
      });

      autoUpdater.removeAllListeners('update-downloaded');
      autoUpdater.on('update-downloaded', (info) => {
        logInfo(`Update downloaded: ${info.version}`);
        if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
          updateDialogWindow.webContents.send('update-downloaded', info);
        }
      });

      autoUpdater.removeAllListeners('error');
      autoUpdater.on('error', (error) => {
        logError('Auto-updater error', error);
        if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
          updateDialogWindow.webContents.send('update-error', {
            message: error?.message || 'Download failed. Please try again.'
          });
        }
      });
    }

    setupDialogListeners();
  });
}

/**
 * Show styled optional update dialog
 * @param {Object} updateInfo - Update information
 * @param {BrowserWindow} mainWindow - Main window reference
 * @returns {Promise<string>} User choice ('update', 'later', 'skip')
 */
async function showOptionalUpdateDialog(updateInfo, mainWindow) {
  return showUpdateDialog(updateInfo, mainWindow, 'optional');
}

/**
 * Show styled force update dialog (blocks app usage, not closable)
 * @param {Object} updateInfo - Update information
 * @param {BrowserWindow} mainWindow - Main window reference
 * @returns {Promise<void>}
 */
async function showForceUpdateDialog(updateInfo, mainWindow) {
  await showUpdateDialog(updateInfo, mainWindow, 'forced');
}

/**
 * Get the active update dialog window (for sending progress events)
 * @returns {BrowserWindow|null}
 */
function getUpdateDialogWindow() {
  return updateDialogWindow;
}

/**
 * Close the update dialog window
 */
function closeUpdateDialog() {
  if (updateDialogWindow && !updateDialogWindow.isDestroyed()) {
    updateDialogWindow.close();
    updateDialogWindow = null;
  }
}

/**
 * Get current update info
 * @returns {Object|null} Current update information
 */
function getCurrentUpdateInfo() {
  return currentUpdateInfo;
}

/**
 * Get last update check time
 * @returns {Date|null} Last check time
 */
function getLastUpdateCheck() {
  return lastUpdateCheck;
}

/**
 * Reset update state
 */
function resetUpdateState() {
  updateCheckInProgress = false;
  lastUpdateCheck = null;
  currentUpdateInfo = null;
  logInfo('Update state reset');
}

/**
 * Check if update check is needed (every 24 hours)
 * @returns {boolean} True if check is needed
 */
function shouldCheckForUpdates() {
  if (!lastUpdateCheck) {
    return true;
  }

  const hoursSinceLastCheck = (Date.now() - lastUpdateCheck.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastCheck >= 24;
}

module.exports = {
  checkForUpdates,
  configureAutoUpdater,
  downloadAndInstallUpdate,
  showOptionalUpdateDialog,
  showForceUpdateDialog,
  getUpdateDialogWindow,
  closeUpdateDialog,
  getCurrentUpdateInfo,
  getLastUpdateCheck,
  resetUpdateState,
  shouldCheckForUpdates
};
