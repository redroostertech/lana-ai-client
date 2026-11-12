'use strict';

/** Settings > General > Location: the main-process permission handlers and IPC (electron-location.js). */
const path = require('path');
const { pathToFileURL } = require('url');
const { isAppPage, allowGeolocation, installLocationPermissionHandlers, registerLocationIpc, systemSettingsUrl } = require('../../electron-location');

const appRoot = path.join(path.sep, 'Applications', 'Lana AI.app', 'Contents', 'Resources', 'app.asar', 'public_html');
const appPage = pathToFileURL(path.join(appRoot, 'settings-v2.html')).toString() + '?section=general';

describe('isAppPage', () => {
  test('a page under public_html is the app', () => {
    expect(isAppPage(appPage, appRoot)).toBe(true);
    expect(isAppPage(pathToFileURL(path.join(appRoot, 'briefs', 'capture.html')).toString(), appRoot)).toBe(true);
  });

  test('other origins, other files and path escapes are not', () => {
    expect(isAppPage('https://evil.example/settings-v2.html', appRoot)).toBe(false);
    expect(isAppPage('http://127.0.0.1:8080/settings-v2.html', appRoot)).toBe(false);
    expect(isAppPage(pathToFileURL(path.join(path.sep, 'tmp', 'page.html')).toString(), appRoot)).toBe(false);
    expect(isAppPage(pathToFileURL(appRoot + '-evil' + path.sep + 'page.html').toString(), appRoot)).toBe(false);
    expect(isAppPage(pathToFileURL(appRoot).toString() + '/../../secret.html', appRoot)).toBe(false);
    expect(isAppPage('', appRoot)).toBe(false);
    expect(isAppPage('not a url', appRoot)).toBe(false);
    expect(isAppPage(appPage, '')).toBe(false);
  });
});

describe('allowGeolocation', () => {
  test('needs both the app page and the person\'s Allow', () => {
    expect(allowGeolocation({ pageUrl: appPage, appRoot, allowed: true })).toBe(true);
    expect(allowGeolocation({ pageUrl: appPage, appRoot, allowed: false })).toBe(false);
    expect(allowGeolocation({ pageUrl: 'https://evil.example/', appRoot, allowed: true })).toBe(false);
  });
});

describe('installLocationPermissionHandlers', () => {
  function install(allowed) {
    const session = {};
    session.setPermissionRequestHandler = jest.fn((fn) => { session.request = fn; });
    session.setPermissionCheckHandler = jest.fn((fn) => { session.check = fn; });
    installLocationPermissionHandlers(session, { appRoot, isAllowed: () => allowed });
    return session;
  }
  const request = (session, permission, url, webContents = {}) => {
    const callback = jest.fn();
    session.request(webContents, permission, callback, url === undefined ? {} : { requestingUrl: url });
    return callback.mock.calls[0][0];
  };

  test('geolocation is granted only to the app\'s own pages after Allow', () => {
    const session = install(true);
    expect(request(session, 'geolocation', appPage)).toBe(true);
    expect(request(session, 'geolocation', 'https://evil.example/')).toBe(false);
    expect(session.check({}, 'geolocation', 'file:///', { requestingUrl: appPage })).toBe(true);
    expect(session.check({}, 'geolocation', 'https://evil.example', { requestingUrl: 'https://evil.example/' })).toBe(false);
  });

  test('geolocation is refused everywhere before Allow', () => {
    const session = install(false);
    expect(request(session, 'geolocation', appPage)).toBe(false);
    expect(session.check({}, 'geolocation', 'file:///', { requestingUrl: appPage })).toBe(false);
  });

  test('without a requesting url the frame\'s own url is used', () => {
    const session = install(true);
    expect(request(session, 'geolocation', undefined, { getURL: () => appPage })).toBe(true);
    expect(request(session, 'geolocation', undefined, { getURL: () => 'https://evil.example/' })).toBe(false);
  });

  test('every other permission keeps Electron\'s default (allowed)', () => {
    const session = install(false);
    ['media', 'notifications', 'clipboard-read', 'fullscreen'].forEach((permission) => {
      expect(request(session, permission, 'https://evil.example/')).toBe(true);
      expect(session.check({}, permission, 'https://evil.example', {})).toBe(true);
    });
  });
});

describe('registerLocationIpc', () => {
  function setup(initial = { allowed: false }) {
    const handlers = {};
    let saved = initial;
    const persistence = {
      read: jest.fn(() => saved),
      write: jest.fn((changes) => { saved = { allowed: changes.allowed === true }; return saved; }),
    };
    registerLocationIpc({ handle: (channel, fn) => { handlers[channel] = fn; } }, { persistence });
    return { handlers, persistence };
  }

  test('reads and saves only the choice', async () => {
    const { handlers, persistence } = setup();
    expect(await handlers['location:get-choice']()).toEqual({ success: true, allowed: false });
    expect(await handlers['location:set-choice']({}, { allowed: true })).toEqual({ success: true, allowed: true });
    expect(persistence.write).toHaveBeenCalledWith({ allowed: true });
    expect(await handlers['location:get-choice']()).toEqual({ success: true, allowed: true });
  });

  test('refuses anything that is not true or false', async () => {
    const { handlers, persistence } = setup();
    expect((await handlers['location:set-choice']({}, { allowed: 'yes' })).success).toBe(false);
    expect((await handlers['location:set-choice']({}, null)).success).toBe(false);
    expect(persistence.write).not.toHaveBeenCalled();
  });
});

// "Open Settings" goes to the computer's own location privacy page. The address is fixed in
// the main process per platform; a page cannot choose it (the external-URL allowlist keeps
// x-apple.systempreferences closed to pages).
describe('the computer\'s location settings', () => {
  test('a fixed page per platform, none elsewhere', () => {
    expect(systemSettingsUrl('darwin')).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices');
    expect(systemSettingsUrl('win32')).toBe('ms-settings:privacy-location');
    expect(systemSettingsUrl('linux')).toBeNull();
    expect(systemSettingsUrl(undefined)).toBeNull();
  });

  function setup({ platform, isPackaged = true }) {
    const handlers = {};
    const shell = { openExternal: jest.fn(async () => {}) };
    const persistence = { read: () => ({ allowed: true }), write: (c) => c };
    registerLocationIpc({ handle: (channel, fn) => { handlers[channel] = fn; } }, { persistence, shell, platform, isPackaged });
    return { handlers, shell };
  }

  test('opens the page for this platform and ignores anything the page sends', async () => {
    const { handlers, shell } = setup({ platform: 'darwin' });
    expect(await handlers['location:open-system-settings']({}, { url: 'smb://attacker/share' })).toEqual({ success: true });
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices');
    const windows = setup({ platform: 'win32' });
    await windows.handlers['location:open-system-settings']();
    expect(windows.shell.openExternal).toHaveBeenCalledWith('ms-settings:privacy-location');
  });

  test('control: a platform with no such page opens nothing', async () => {
    const { handlers, shell } = setup({ platform: 'linux' });
    expect((await handlers['location:open-system-settings']()).success).toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('tells the page whether the button can work and whether this is a development build', async () => {
    expect(await setup({ platform: 'darwin' }).handlers['location:system']()).toEqual({ success: true, settingsAvailable: true, devBuild: false });
    expect(await setup({ platform: 'darwin', isPackaged: false }).handlers['location:system']()).toEqual({ success: true, settingsAvailable: true, devBuild: true });
    expect(await setup({ platform: 'linux' }).handlers['location:system']()).toEqual({ success: true, settingsAvailable: false, devBuild: false });
  });
});
