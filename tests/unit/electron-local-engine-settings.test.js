/**
 * "Use local AI engine" persistence (electron-storage.js localEngine) and the
 * main-process host (electron-local-engine.js): the setting is saved, the API
 * base follows it, and the sync IPC answers the renderer.
 */

const path = require('path');
const os = require('os');

jest.mock('electron-store', () => class MockStore {
  constructor() { this._data = {}; }
  get(key, def) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : def; }
  set(key, value) { this._data[key] = value; }
  delete(key) { delete this._data[key]; }
  clear() { this._data = {}; }
  get store() { return this._data; }
});

jest.mock('electron', () => ({ app: { getPath: () => '/tmp/lana-test-userdata' } }), { virtual: true });

const storage = require(path.join(__dirname, '../../electron-storage.js'));
const { createLocalEngineHost, CHANNELS } = require('../../electron-local-engine');

const CHEF = 'https://chef.example.test';
const ENGINE = 'http://127.0.0.1:46180';

function fakeIpc() {
  const handlers = {};
  const listeners = {};
  return {
    handle: (channel, fn) => { handlers[channel] = fn; },
    on: (channel, fn) => { listeners[channel] = fn; },
    invoke: (channel, payload) => handlers[channel]({}, payload),
    sendSync: (channel) => { const event = {}; listeners[channel](event); return event.returnValue; }
  };
}

describe('electron-storage localEngine settings', () => {
  beforeEach(() => storage.clearAllData());

  test('defaults: enabled unset (on when configured), no root, no port', () => {
    expect(storage.getLocalEnginePreferences()).toEqual({ enabled: null, root: null, port: null });
  });

  test('saves and reads back the setting, root and port', () => {
    storage.updateLocalEnginePreferences({ enabled: false });
    storage.updateLocalEnginePreferences({ root: ' /opt/engine ', port: 48123 });
    expect(storage.getLocalEnginePreferences()).toEqual({ enabled: false, root: '/opt/engine', port: 48123 });
  });

  test('invalid values are not stored', () => {
    storage.updateLocalEnginePreferences({ enabled: 'yes', root: '', port: 99999 });
    expect(storage.getLocalEnginePreferences()).toEqual({ enabled: null, root: null, port: null });
  });

  test('logging out (clearing the saved server) keeps the setting', () => {
    storage.updateLocalEnginePreferences({ enabled: false });
    storage.saveServerConnection({ url: CHEF, orgId: 'org-1' });
    storage.clearSavedServer();
    expect(storage.getLocalEnginePreferences().enabled).toBe(false);
  });
});

describe('local engine host', () => {
  let ipc;
  let host;
  const realFetch = global.fetch;

  beforeEach(() => {
    storage.clearAllData();
    storage.saveServerConnection({ url: CHEF, orgId: 'org-1', orgName: 'Example' });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', chef: { status: 'ready', reachable: true } }) }));
    ipc = fakeIpc();
    host = createLocalEngineHost({
      ipcMain: ipc,
      app: { getPath: () => os.tmpdir(), isPackaged: false },
      storage,
      getWindows: () => [],
      env: { LANA_ENGINE_URL: ENGINE },
      log: { info() {}, warn() {}, error() {} }
    });
    host.registerIpc();
  });

  afterEach(async () => {
    await host.stop();
    global.fetch = realFetch;
  });

  test('engine on by default: the API base and the saved server url are the engine', async () => {
    await host.sync();
    expect(ipc.sendSync(CHANNELS.apiBaseSync)).toBe(ENGINE);
    expect(host.present(storage.getSavedServer())).toMatchObject({ url: ENGINE, chefUrl: CHEF });
    expect(storage.getSavedServer().url).toBe(CHEF);
  });

  test('turning the setting off persists it and the API base goes back to Chef', async () => {
    await host.sync();
    const result = await ipc.invoke(CHANNELS.setEnabled, { enabled: false });
    expect(result.success).toBe(true);
    expect(result.status).toMatchObject({ enabled: false, inUse: false, apiBase: CHEF });
    expect(storage.getLocalEnginePreferences().enabled).toBe(false);
    expect(ipc.sendSync(CHANNELS.apiBaseSync)).toBe(CHEF);
  });

  test('turning it back on uses the engine again', async () => {
    storage.updateLocalEnginePreferences({ enabled: false });
    await host.sync();
    const result = await ipc.invoke(CHANNELS.setEnabled, { enabled: true });
    expect(result.status).toMatchObject({ enabled: true, inUse: true, apiBase: ENGINE });
  });

  test('a non-boolean setting is refused', async () => {
    expect((await ipc.invoke(CHANNELS.setEnabled, { enabled: 'off' })).success).toBe(false);
  });
});
