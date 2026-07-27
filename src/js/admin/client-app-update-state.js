/**
 * Client App Update — pure view-state mapper (no DOM, no IPC).
 *
 * Derives what the admin Updates page should show for the CLIENT app
 * (Electron self-update) from the result of electronAPI.checkUpdates().
 * Kept as a plain module so it is unit-testable without Electron.
 *
 * IPC contract (electron-main.js 'check-updates' handler):
 *   { success: true, updateInfo: { updateAvailable, updateRequired, version,
 *     releaseNotes, downloadUrl, channel } }
 *   | { success: false, error }
 */
(function () {
  'use strict';

  /**
   * @param {Object} input
   * @param {boolean} input.supported   - running inside Electron with the updates IPC
   * @param {string}  [input.currentVersion] - running app version
   * @param {Object}  [input.result]    - raw IPC result from checkUpdates()
   * @returns {{ visible, checked, statusLabel, badgeColor, latestVersion,
   *             releaseNotes, canInstall, mandatory, hint }}
   */
  function fromCheckResult(input) {
    var supported = !!(input && input.supported);
    var currentVersion = (input && input.currentVersion) || null;

    if (!supported) {
      return {
        visible: false,
        checked: false,
        statusLabel: 'Unavailable',
        badgeColor: 'gray',
        latestVersion: null,
        releaseNotes: null,
        canInstall: false,
        mandatory: false,
        hint: 'App updates are managed from the desktop app.'
      };
    }

    var result = input && input.result;
    if (!result) {
      return {
        visible: true,
        checked: false,
        statusLabel: 'Not checked',
        badgeColor: 'gray',
        latestVersion: null,
        releaseNotes: null,
        canInstall: false,
        mandatory: false,
        hint: 'Check for updates to see if a newer app version is available.'
      };
    }

    if (!result.success) {
      return {
        visible: true,
        checked: true,
        statusLabel: 'Check failed',
        badgeColor: 'red',
        latestVersion: null,
        releaseNotes: null,
        canInstall: false,
        mandatory: false,
        hint: result.error || 'Could not reach the update service. Try again later.'
      };
    }

    var info = result.updateInfo || {};
    if (!info.updateAvailable) {
      return {
        visible: true,
        checked: true,
        statusLabel: 'Up to date',
        badgeColor: 'green',
        latestVersion: currentVersion,
        releaseNotes: null,
        canInstall: false,
        mandatory: false,
        hint: 'This computer is running the latest app version.'
      };
    }

    var mandatory = !!info.updateRequired;
    return {
      visible: true,
      checked: true,
      statusLabel: mandatory ? 'Update required' : 'Update available',
      badgeColor: mandatory ? 'red' : 'yellow',
      latestVersion: info.version || null,
      releaseNotes: info.releaseNotes || null,
      canInstall: true,
      mandatory: mandatory,
      hint: mandatory
        ? 'This update is required. The app will restart to install it.'
        : 'The app will download the update, then restart to install it.'
    };
  }

  var api = { fromCheckResult: fromCheckResult };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ClientAppUpdateState = api;
})();
