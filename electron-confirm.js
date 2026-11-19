'use strict';

/**
 * Main-process confirmation dialogs for the actions a page must not take on its own,
 * even right after a click (docs/plans/harden-ipc.md): installing an update, letting
 * a companion app sign in without asking again, showing a vault file in its folder,
 * and opening a link in the browser without a recent click. The dialog belongs to the
 * app, not the page, so script in a page cannot answer it. Cancel is the default.
 */

const path = require('path');

// Names shown for the apps the PAC bridge knows; anything else is "this app".
const APP_LABELS = Object.freeze({ 'lana-companion': 'your LANA companion app' });

function linkForDisplay(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    return url.href.length > 300 ? url.href.slice(0, 300) + '...' : url.href;
  } catch (_) {
    return '';
  }
}

const CONFIRMATIONS = Object.freeze({
  installUpdate: ({ version }) => ({
    // The version from the update check, shown only when it is a plain version string.
    message: typeof version === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(version)
      ? `Install LANA ${version} now?`
      : 'Install the LANA update now?',
    detail: 'LANA will download the update, quit and restart. Save your work first.',
    ok: 'Install and restart'
  }),
  alwaysAllowCompanion: ({ app }) => ({
    message: `Always let ${Object.prototype.hasOwnProperty.call(APP_LABELS, app) ? APP_LABELS[app] : 'this app'} use your LANA sign-in?`,
    detail: 'It will not ask again on this computer. You can turn this off in Settings > Connected Apps.',
    ok: 'Always allow'
  }),
  revealNote: ({ file }) => ({
    message: 'Show this note in its folder?',
    detail: path.basename(String(file || '')),
    ok: 'Show'
  }),
  openExternal: ({ url }) => ({
    message: 'Open this link in your browser?',
    detail: linkForDisplay(url),
    ok: 'Open'
  })
});

// Every open question, so quitting never waits on one: cancelAllPrompts() closes them all
// (showMessageBox's AbortSignal answers as Cancel) on before-quit and SIGTERM.
const pendingPrompts = new Set();

// The LANA icon for every question (electron-app-icon.js), set by electron-main.js. In a dev run
// the default would be Electron's.
let dialogIcon = null;
function setDialogIcon(getter) {
  dialogIcon = typeof getter === 'function' ? getter : null;
}
function currentDialogIcon() {
  try {
    return dialogIcon ? dialogIcon() : undefined;
  } catch (_error) {
    return undefined;
  }
}

/**
 * dialog.showMessageBox, tracked: it closes as Cancel when the app quits.
 * @param {object} dialog - Electron's dialog
 * @param {object|undefined|null} parentWindow
 * @param {object} options - showMessageBox options (cancelId is what an abort answers)
 */
async function trackedMessageBox(dialog, parentWindow, options) {
  const controller = new AbortController();
  pendingPrompts.add(controller);
  try {
    const withSignal = { ...options, signal: controller.signal };
    // The caller's own icon wins; without one, the LANA icon when there is one.
    if (withSignal.icon === undefined) {
      const icon = currentDialogIcon();
      if (icon) withSignal.icon = icon;
    }
    return parentWindow ? await dialog.showMessageBox(parentWindow, withSignal) : await dialog.showMessageBox(withSignal);
  } finally {
    pendingPrompts.delete(controller);
  }
}

/** Close every open question as Cancel. Returns how many there were. */
function cancelAllPrompts() {
  const count = pendingPrompts.size;
  for (const controller of pendingPrompts) controller.abort();
  pendingPrompts.clear();
  return count;
}

function pendingPromptCount() {
  return pendingPrompts.size;
}

/**
 * @param {object} dialog - Electron's dialog
 * @param {object|null} parentWindow - the BrowserWindow that asked, or null
 * @param {string} kind - a key of CONFIRMATIONS
 * @param {object} details
 * @returns {Promise<boolean>} true only when the person chose the action
 */
async function confirmAction(dialog, parentWindow, kind, details) {
  const build = Object.prototype.hasOwnProperty.call(CONFIRMATIONS, kind) ? CONFIRMATIONS[kind] : null;
  if (!build) return false;
  const copy = build(details || {});
  const options = {
    type: 'question',
    buttons: [copy.ok, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: copy.message,
    detail: copy.detail
  };
  try {
    const result = await trackedMessageBox(dialog, parentWindow, options);
    return Boolean(result && result.response === 0);
  } catch (_) {
    return false;
  }
}

module.exports = { CONFIRMATIONS, confirmAction, trackedMessageBox, cancelAllPrompts, pendingPromptCount, setDialogIcon };
