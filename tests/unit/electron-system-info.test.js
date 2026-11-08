'use strict';

/** Settings > General facts and update status from the main process (electron-system-info.js). */
jest.mock('electron', () => ({}), { virtual: true });
const { systemInfo, registerSystemInfoIpc, computerName, storage } = require('../../electron-system-info');

const fakeApp = {
  isPackaged: true,
  getVersion: () => '4.1.0',
  getPath: () => '/Users/test/Library/Application Support/Lana AI',
  getLocale: () => 'en-US',
  getSystemLocale: () => 'en-US',
  getPreferredSystemLanguages: () => ['en-US', 'es-MX'],
};
const fakeOs = {
  hostname: () => 'Studio.local',
  cpus: () => [{ model: 'Apple M3 Max ' }, { model: 'Apple M3 Max' }],
  totalmem: () => 64 * 1024 ** 3,
  release: () => '25.3.0',
};
const fakeProcess = { platform: 'darwin', arch: 'arm64', versions: { electron: '44.9.1', chrome: '146.0', node: '24.11.0' }, getSystemVersion: () => '26.3.0' };

describe('systemInfo', () => {
  test('reports the app, the computer, its storage and locale', () => {
    const info = systemInfo({ app: fakeApp, displayVersion: 'v4.1.0', processRef: fakeProcess, osRef: fakeOs, statfs: () => ({ blocks: 1000, bsize: 4096, bavail: 250 }) });
    expect(info).toEqual({
      app: { version: '4.1.0', displayVersion: 'v4.1.0', packaged: true, electron: '44.9.1', chrome: '146.0', node: '24.11.0' },
      device: { computerName: 'Studio', platform: 'darwin', osVersion: '26.3.0', arch: 'arm64', cpuModel: 'Apple M3 Max', cpuCores: 2, memoryBytes: 64 * 1024 ** 3 },
      storage: { totalBytes: 4096000, freeBytes: 1024000 },
      locale: { appLocale: 'en-US', systemLocale: 'en-US', preferredLanguages: ['en-US', 'es-MX'] },
    });
  });

  test('a disk it cannot read gives nulls, not an error', () => {
    expect(storage('/nowhere', () => { throw new Error('ENOENT'); })).toEqual({ totalBytes: null, freeBytes: null });
  });

  test('the .local suffix is dropped from the computer name', () => {
    expect(computerName('Michaels-Mac.local')).toBe('Michaels-Mac');
    expect(computerName('DESKTOP-1234')).toBe('DESKTOP-1234');
  });
});

describe('update IPC', () => {
  function setup(checkResult) {
    const handlers = {};
    const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
    const installUpdate = jest.fn(() => Promise.resolve());
    const checkForUpdates = jest.fn(() => Promise.resolve(checkResult));
    let checked = null;
    let result = null;
    registerSystemInfoIpc(ipcMain, {
      app: fakeApp,
      displayVersion: () => 'v4.1.0',
      checkForUpdates: (...args) => { checked = new Date('2026-11-08T18:42:00.000Z'); result = checkResult; return checkForUpdates(...args); },
      lastChecked: () => checked,
      lastResult: () => result,
      savedServer: () => ({ url: 'http://server:8080', orgId: 'org_1' }),
      installUpdate,
      logError: () => {},
    });
    return { handlers, installUpdate, checkForUpdates };
  }

  test('before a check: the version and no result', async () => {
    const { handlers } = setup({ updateAvailable: false });
    expect(await handlers['settings:update-status']()).toEqual({ success: true, status: { currentVersion: 'v4.1.0', packaged: true, lastChecked: null, result: null } });
  });

  test('a check passes the saved server and keeps the result', async () => {
    const { handlers, checkForUpdates } = setup({ updateAvailable: true, version: '4.2.0', releaseNotes: 'Faster search.' });
    const answer = await handlers['settings:check-for-updates']();
    expect(checkForUpdates).toHaveBeenCalledWith('http://server:8080', null, 'org_1');
    expect(answer.status.lastChecked).toBe('2026-11-08T18:42:00.000Z');
    expect(answer.status.result).toMatchObject({ updateAvailable: true, version: '4.2.0', releaseNotes: 'Faster search.', error: null });
  });

  test('a failed check is a plain line, never the raw error', async () => {
    const { handlers } = setup({ updateAvailable: false, error: 'getaddrinfo ENOTFOUND www.redroostertec.com' });
    const answer = await handlers['settings:check-for-updates']();
    expect(answer.status.result.error).toBe('LANA could not reach the update service.');
  });

  test('install hands off to the existing update flow with the saved server', async () => {
    const { handlers, installUpdate } = setup({});
    expect(await handlers['settings:install-update']()).toEqual({ success: true });
    expect(installUpdate).toHaveBeenCalledWith('http://server:8080');
  });
});
