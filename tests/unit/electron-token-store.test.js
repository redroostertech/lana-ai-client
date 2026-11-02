'use strict';

// The login token lives in the main process, encrypted at rest with Electron
// safeStorage (OS keychain), and never in renderer localStorage. Without a
// keychain it is kept in memory for the session only, never in plain text.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  createTokenStore,
  registerTokenIpc,
  isTrustedSender,
  hasLiveSession,
  CHANNELS
} = require('../../electron-token-store');

const ROOT = path.resolve(__dirname, '../..');
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl';

// A stand-in keychain: reversible, and its output never contains the input.
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from('enc:' + Buffer.from(text).toString('hex')),
    decryptString: (buf) => {
      const raw = buf.toString();
      if (!raw.startsWith('enc:')) throw new Error('not ours');
      return Buffer.from(raw.slice(4), 'hex').toString();
    }
  };
}

function memoryPersistence() {
  let value = null;
  return {
    read: () => value,
    write: (v) => { value = v; },
    remove: () => { value = null; },
    peek: () => value
  };
}

describe('token store', () => {
  test('persists only ciphertext and reads it back after a restart', () => {
    const persistence = memoryPersistence();
    const store = createTokenStore({ safeStorage: fakeSafeStorage(), persistence });
    store.set(TOKEN);
    expect(store.get()).toBe(TOKEN);
    expect(persistence.peek()).toBeTruthy();
    expect(persistence.peek()).not.toContain(TOKEN);
    expect(Buffer.from(persistence.peek(), 'base64').toString()).not.toContain(TOKEN);

    const afterRestart = createTokenStore({ safeStorage: fakeSafeStorage(), persistence });
    expect(afterRestart.get()).toBe(TOKEN);
  });

  test('without a keychain the token is memory only and nothing is written', () => {
    const persistence = memoryPersistence();
    const store = createTokenStore({ safeStorage: fakeSafeStorage(false), persistence });
    store.set(TOKEN);
    expect(store.get()).toBe(TOKEN);
    expect(persistence.peek()).toBeNull();
    expect(store.isPersistent()).toBe(false);

    const afterRestart = createTokenStore({ safeStorage: fakeSafeStorage(false), persistence });
    expect(afterRestart.get()).toBeNull();
  });

  test('a keychain that throws is treated as unavailable, not as plain text', () => {
    const persistence = memoryPersistence();
    const broken = { isEncryptionAvailable: () => { throw new Error('no keyring'); } };
    const store = createTokenStore({ safeStorage: broken, persistence });
    store.set(TOKEN);
    expect(store.get()).toBe(TOKEN);
    expect(persistence.peek()).toBeNull();
  });

  test('clear removes the token from memory and disk', () => {
    const persistence = memoryPersistence();
    const store = createTokenStore({ safeStorage: fakeSafeStorage(), persistence });
    store.set(TOKEN);
    store.clear();
    expect(store.get()).toBeNull();
    expect(persistence.peek()).toBeNull();
  });

  test('unreadable ciphertext is dropped', () => {
    const persistence = memoryPersistence();
    persistence.write(Buffer.from('garbage').toString('base64'));
    const store = createTokenStore({ safeStorage: fakeSafeStorage(), persistence });
    expect(store.get()).toBeNull();
    expect(persistence.peek()).toBeNull();
  });

  test('rejects non-string and oversized tokens', () => {
    const store = createTokenStore({ safeStorage: fakeSafeStorage(), persistence: memoryPersistence() });
    store.set(TOKEN);
    expect(store.set({ token: TOKEN })).toBe(false);
    expect(store.get()).toBeNull();
    expect(store.set('x'.repeat(17 * 1024))).toBe(false);
  });

  test('legacy migration moves a token once and never overwrites a held one', () => {
    const store = createTokenStore({ safeStorage: fakeSafeStorage(), persistence: memoryPersistence() });
    expect(store.migrateLegacy(TOKEN)).toBe(true);
    expect(store.get()).toBe(TOKEN);
    expect(store.migrateLegacy('older-token')).toBe(false);
    expect(store.get()).toBe(TOKEN);
  });
});

describe('token IPC', () => {
  function fakeIpcMain() {
    const handlers = {};
    return {
      on: (channel, fn) => { handlers[channel] = fn; },
      send(channel, url, ...args) {
        const event = { senderFrame: { url } };
        handlers[channel](event, ...args);
        return event.returnValue;
      }
    };
  }

  test('app pages can get, set and clear; remote pages get nothing', () => {
    const ipc = fakeIpcMain();
    const store = createTokenStore({ safeStorage: fakeSafeStorage(), persistence: memoryPersistence() });
    const onChange = jest.fn();
    registerTokenIpc(ipc, store, onChange);

    const appPage = 'file:///Applications/LANA.app/public_html/index.html';
    expect(ipc.send(CHANNELS.set, appPage, TOKEN)).toBe(TOKEN);
    expect(ipc.send(CHANNELS.get, appPage)).toBe(TOKEN);
    expect(onChange).toHaveBeenCalledWith();

    expect(ipc.send(CHANNELS.get, 'https://evil.example/')).toBeNull();
    expect(ipc.send(CHANNELS.set, 'https://evil.example/', 'attacker')).toBeNull();
    expect(ipc.send(CHANNELS.clear, 'https://evil.example/')).toBeNull();
    expect(store.get()).toBe(TOKEN);

    ipc.send(CHANNELS.clear, appPage);
    expect(store.get()).toBeNull();
  });

  test('isTrustedSender accepts only file: frames', () => {
    expect(isTrustedSender({ senderFrame: { url: 'file:///x/index.html' } })).toBe(true);
    expect(isTrustedSender({ senderFrame: { url: 'http://127.0.0.1:8080/' } })).toBe(false);
    expect(isTrustedSender({})).toBe(false);
  });
});

test('hasLiveSession: demo and unexpired JWTs are live, expired and junk are not', () => {
  const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
  expect(hasLiveSession('demo-token-1', 0)).toBe(true);
  expect(hasLiveSession(jwt(2000), 1000 * 1000)).toBe(true);
  expect(hasLiveSession(jwt(500), 1000 * 1000)).toBe(false);
  expect(hasLiveSession('not-a-jwt', 0)).toBe(false);
  expect(hasLiveSession(null, 0)).toBe(false);
});

describe('preload', () => {
  function loadPreload(legacyToken, mainToken) {
    jest.resetModules();
    const items = legacyToken ? { token: legacyToken, user: '{"id":"u1"}' } : { user: '{"id":"u1"}' };
    const exposed = {};
    const sendSync = jest.fn((channel, arg) => {
      if (channel === CHANNELS.migrate) return mainToken || arg;
      if (channel === CHANNELS.get) return mainToken || null;
      if (channel === CHANNELS.set) return arg;
      return null;
    });
    jest.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (key, api) => { exposed[key] = api; } },
      ipcRenderer: { sendSync, invoke: jest.fn(), send: jest.fn(), on: jest.fn(), removeListener: jest.fn() }
    }), { virtual: true });
    global.window = {
      localStorage: {
        getItem: (k) => (k in items ? items[k] : null),
        removeItem: (k) => { delete items[k]; }
      }
    };
    global.document = {};
    jest.isolateModules(() => { require('../../electron-preload'); });
    return { exposed, sendSync, items };
  }

  afterEach(() => {
    delete global.window;
    delete global.document;
    jest.dontMock('electron');
  });

  test('moves a legacy localStorage token to the main process once and deletes it', () => {
    const { exposed, sendSync, items } = loadPreload('legacy-token');
    expect(sendSync).toHaveBeenCalledWith(CHANNELS.migrate, 'legacy-token');
    expect(items.token).toBeUndefined();
    expect(items.user).toBe('{"id":"u1"}');
    expect(exposed.lanaAuthToken.get()).toBe('legacy-token');
  });

  test('control: with nothing to migrate it reads the main-process token', () => {
    const { exposed, sendSync } = loadPreload(null, 'main-token');
    expect(sendSync).toHaveBeenCalledWith(CHANNELS.get);
    expect(sendSync).not.toHaveBeenCalledWith(CHANNELS.migrate, expect.anything());
    expect(exposed.lanaAuthToken.get()).toBe('main-token');
    exposed.lanaAuthToken.set('next-token');
    expect(sendSync).toHaveBeenCalledWith(CHANNELS.set, 'next-token');
    expect(exposed.lanaAuthToken.get()).toBe('next-token');
    exposed.lanaAuthToken.clear();
    expect(sendSync).toHaveBeenCalledWith(CHANNELS.clear);
    expect(exposed.lanaAuthToken.get()).toBeNull();
  });
});

test('no app code keeps the login token in localStorage or reads it from a renderer', () => {
  const files = execFileSync('git', ['ls-files', 'src', 'electron-*.js'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(js|html)$/.test(f) && !f.includes('/vendor/') && !f.includes('tiptap-bundle'));
  const tokenKey = /localStorage\s*\.\s*(getItem|setItem|removeItem)\(\s*['"](token|authToken|auth_token|lana_token|lana_auth_token|access_token|lana_automation_token)['"]/;
  // The preload is the one place that reads it: to migrate it out, once.
  const offenders = files.filter((f) => f !== 'electron-preload.js')
    .filter((f) => tokenKey.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  expect(offenders).toEqual([]);

  const main = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');
  expect(main).not.toMatch(/executeJavaScript\([^)]*getItem\('token'\)/s);
  expect(main).toMatch(/getToken: async \(\) => authTokenStore\.get\(\)/);
});
