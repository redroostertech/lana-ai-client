/**
 * Electron Custom Updater Module
 * 
 * Handles application updates with server-controlled update policy
 * Queries the Mac Studio server for allowed version before checking GitHub releases
 */

const { autoUpdater } = require('electron-updater');
const { app, dialog } = require('electron');
const axios = require('axios');
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
    owner = 'your-org',
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
    // First check if update is available
    const updateInfo = await checkForUpdates(serverUrl, authToken, orgId);

    if (!updateInfo.updateAvailable) {
      return false;
    }

    logInfo('Downloading update...');

    // Download update using electron-updater
    await autoUpdater.downloadUpdate();

    logInfo('Update downloaded successfully');
    
    // Install and restart
    logInfo('Installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);

    return true;
  } catch (error) {
    logError('Failed to download and install update', error);
    return false;
  }
}

/**
 * Show update dialog to user (optional update)
 * @param {Object} updateInfo - Update information
 * @param {BrowserWindow} mainWindow - Main window reference
 * @returns {Promise<string>} User choice ('update', 'later', 'skip')
 */
async function showOptionalUpdateDialog(updateInfo, mainWindow) {
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `A new version of Lana AI is available (v${updateInfo.version})`,
    detail: updateInfo.releaseNotes || 'Would you like to update now?',
    buttons: ['Update Now', 'Remind Me Later', 'Skip This Version'],
    defaultId: 0,
    cancelId: 1
  });

  const choices = ['update', 'later', 'skip'];
  return choices[response.response];
}

/**
 * Show force update dialog (blocks app usage)
 * @param {Object} updateInfo - Update information
 * @param {BrowserWindow} mainWindow - Main window reference
 * @returns {Promise<void>}
 */
async function showForceUpdateDialog(updateInfo, mainWindow) {
  await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Update Required',
    message: `A required update is available (v${updateInfo.version})`,
    detail: 'This update must be installed before you can continue using Lana AI.\n\n' +
            (updateInfo.releaseNotes || 'Please update to continue.'),
    buttons: ['Update Now'],
    defaultId: 0
  });
}

/**
 * Show update progress dialog
 * @param {BrowserWindow} progressWindow - Progress window reference
 * @param {number} percent - Progress percentage
 */
function updateProgressDialog(progressWindow, percent) {
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.webContents.send('update-progress', {
      percent: percent
    });
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
  updateProgressDialog,
  getCurrentUpdateInfo,
  getLastUpdateCheck,
  resetUpdateState,
  shouldCheckForUpdates
};
