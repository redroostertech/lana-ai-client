/**
 * Files a page saves (Export PDF and Export CSV on a report, a CSV from a
 * sheet) reach the person through a Save window that opens in Downloads.
 * Without this the app left the download to Electron's default, which showed
 * nothing: pressing Export did nothing at all (Michael, 2026-11-23).
 */
const path = require('path');
const { installDownloadHandler } = require('../../electron-downloads');

function harness({ chosen, pageUrl = 'lana-app://app/public_html/admin/report.html' } = {}) {
  let handler = null;
  const session = { on: (event, fn) => { if (event === 'will-download') { handler = fn; } } };
  const dialogCalls = [];
  const dialog = { showSaveDialogSync: (win, options) => { dialogCalls.push({ win, options }); return chosen; } };
  const window = { id: 1 };
  const BrowserWindow = { fromWebContents: () => window };
  installDownloadHandler(session, { dialog, BrowserWindow, downloadsDir: () => '/Users/test/Downloads', appRoot: '/app/public_html' });
  const item = {
    getFilename: () => 'module-report-2026-11-23.pdf',
    setSavePath: jest.fn(), cancel: jest.fn()
  };
  const contents = { getURL: () => pageUrl };
  return { fire: () => handler({ preventDefault: jest.fn() }, item, contents), item, dialogCalls, window };
}

test('an app page download opens a Save window in Downloads, and saves where the person chose', () => {
  const h = harness({ chosen: '/Users/test/Desktop/report.pdf' });
  h.fire();
  expect(h.dialogCalls).toHaveLength(1);
  expect(h.dialogCalls[0].win).toBe(h.window);
  expect(h.dialogCalls[0].options.defaultPath).toBe(path.join('/Users/test/Downloads', 'module-report-2026-11-23.pdf'));
  expect(h.item.setSavePath).toHaveBeenCalledWith('/Users/test/Desktop/report.pdf');
  expect(h.item.cancel).not.toHaveBeenCalled();
});

test('closing the Save window cancels the download (control: nothing is saved anywhere)', () => {
  const h = harness({ chosen: undefined });
  h.fire();
  expect(h.item.cancel).toHaveBeenCalled();
  expect(h.item.setSavePath).not.toHaveBeenCalled();
});

test('a download a page outside the app starts is refused without asking', () => {
  const h = harness({ chosen: '/x', pageUrl: 'https://example.com/' });
  h.fire();
  expect(h.dialogCalls).toHaveLength(0);
  expect(h.item.cancel).toHaveBeenCalled();
});
