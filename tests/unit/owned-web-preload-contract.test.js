const fs = require('fs');
const path = require('path');

describe('owned-web preload contract', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../../electron-preload.js'), 'utf8');

  test('exposes fixed owned-web methods required by the UI', () => {
    [
      'health',
      'capabilities',
      'search',
      'read',
      'startCrawl',
      'getCrawl',
      'getCrawlResults',
      'cancelCrawl',
      'ingestDocument',
      'openBrowserSession',
      'snapshotBrowserSession',
      'previewBrowserAction',
      'executeBrowserAction',
      'decideApproval',
      'runBrowserTask',
      'chooseUploadFiles',
      'closeBrowserSession'
    ].forEach((method) => {
      expect(preload).toContain(`${method}:`);
    });
  });

  test('owned-web bridge does not expose browser objects, cookies, tokens, or generic owned-web invoke', () => {
    const ownedWebBlock = preload.slice(preload.indexOf('ownedWeb:'), preload.indexOf('/**\n   * Updates'));

    expect(ownedWebBlock).not.toContain('ipcRenderer: ipcRenderer');
    for (const forbidden of ['BrowserWindow', 'webContents', 'Playwright', 'cookie', 'Cookie', 'token', 'Token']) {
      expect(ownedWebBlock).not.toContain(forbidden);
    }
    expect(ownedWebBlock).not.toContain('invoke:');
    expect(ownedWebBlock).not.toContain('send:');
    expect(ownedWebBlock).not.toContain('readFile');
    expect(ownedWebBlock).not.toContain('writeFile');
  });
});
