'use strict';

/**
 * Files a page saves (Export PDF and Export CSV on a report, a sheet's CSV,
 * a workspace download) reach the person through a Save window that opens in
 * their Downloads folder, on the window that asked. Without a handler the app
 * left downloads to Electron's default, which showed nothing: pressing Export
 * did nothing at all (2026-11-23).
 *
 * Only the app's own pages may start a download; anything else is refused
 * without asking. Closing the Save window cancels the download, so nothing is
 * written anywhere the person did not choose.
 */

const path = require('path');
const { isAppPage } = require('./electron-location');

/**
 * @param {Electron.Session} session
 * @param {Object} deps
 * @param {{ showSaveDialogSync: Function }} deps.dialog
 * @param {{ fromWebContents: Function }} deps.BrowserWindow
 * @param {function(): string} deps.downloadsDir - app.getPath('downloads')
 * @param {string} deps.appRoot - the app's page folder (public_html)
 */
function installDownloadHandler(session, { dialog, BrowserWindow, downloadsDir, appRoot }) {
  session.on('will-download', (_event, item, contents) => {
    const pageUrl = contents && typeof contents.getURL === 'function' ? contents.getURL() : '';
    if (!isAppPage(pageUrl, appRoot)) {
      item.cancel();
      return;
    }
    const win = contents ? BrowserWindow.fromWebContents(contents) : null;
    // The path has to be set before this handler returns, so the Save window is the synchronous one.
    const chosen = dialog.showSaveDialogSync(win || undefined, {
      defaultPath: path.join(downloadsDir(), item.getFilename())
    });
    if (!chosen) {
      item.cancel();
      return;
    }
    item.setSavePath(chosen);
  });
}

module.exports = { installDownloadHandler };
