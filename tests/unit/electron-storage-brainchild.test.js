/**
 * Unit test for the brainchildLink persistence helpers in electron-storage.js.
 *
 * electron-storage.js requires 'electron' (for app.getPath) and 'electron-store'
 * (encrypted persistence). Both are mocked here so the test runs under plain
 * jest without an Electron runtime — we exercise the pure save/get/clear logic
 * against an in-memory store.
 */

const path = require('path');

// In-memory electron-store double. The real Store is a class; we mirror the
// subset electron-storage.js uses: get(key, default), set, delete, clear, store.
jest.mock('electron-store', () => {
  return class MockStore {
    constructor() {
      this._data = {};
    }
    get(key, def) {
      return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : def;
    }
    set(key, value) { this._data[key] = value; }
    delete(key) { delete this._data[key]; }
    clear() { this._data = {}; }
    get store() { return this._data; }
  };
});

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp/lana-test-userdata' }
}), { virtual: true });

const storage = require(path.join(__dirname, '../../electron-storage.js'));

describe('electron-storage brainchildLink persistence', () => {
  afterEach(() => {
    storage.clearBrainchildLink();
  });

  test('getBrainchildLink returns null before any link is saved', () => {
    expect(storage.getBrainchildLink()).toBeNull();
  });

  test('saveBrainchildLink persists install + vault paths and stamps linkedAt', () => {
    const ok = storage.saveBrainchildLink({
      installPath: '/Applications/Brainchild.app/Contents/Resources',
      vaultPath: '/Users/tester/vault',
      verified: true
    });
    expect(ok).toBe(true);

    const link = storage.getBrainchildLink();
    expect(link.installPath).toBe('/Applications/Brainchild.app/Contents/Resources');
    expect(link.vaultPath).toBe('/Users/tester/vault');
    expect(link.verified).toBe(true);
    expect(typeof link.linkedAt).toBe('string');
    expect(link.linkedAt.length).toBeGreaterThan(0);
  });

  test('verified defaults to false when omitted', () => {
    storage.saveBrainchildLink({ installPath: '/a', vaultPath: '/b' });
    expect(storage.getBrainchildLink().verified).toBe(false);
  });

  test('clearBrainchildLink removes the persisted link', () => {
    storage.saveBrainchildLink({ installPath: '/a', vaultPath: '/b', verified: true });
    expect(storage.getBrainchildLink()).not.toBeNull();

    expect(storage.clearBrainchildLink()).toBe(true);
    expect(storage.getBrainchildLink()).toBeNull();
  });

  test('does NOT cache any auth token (vault is local, token-free)', () => {
    storage.saveBrainchildLink({ installPath: '/a', vaultPath: '/b', verified: true, token: 'secret' });
    const link = storage.getBrainchildLink();
    expect(link).not.toHaveProperty('token');
  });
});
