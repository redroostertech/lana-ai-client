'use strict';

/**
 * The client preload runs sandboxed (docs/plans/harden-ipc.md): a sandboxed preload can
 * require only 'electron' and a few built-ins. electron-preload-path.js bundles it into one
 * file; this runs that bundle with a sandbox-like require and checks it exposes the same API.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { clientPreloadPath, bundleDevPreload } = require('../../electron-preload-path');

const ROOT = path.join(__dirname, '..', '..');

function runSandboxed(file, argv) {
  const exposed = {};
  const calls = [];
  const ipcRenderer = {
    invoke: (channel) => { calls.push(channel); return Promise.resolve(null); },
    send: (channel) => calls.push(channel),
    sendSync: (channel) => { calls.push(channel); return null; },
    on: () => {},
    removeListener: () => {}
  };
  const electron = { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer };
  const refused = [];
  // What Electron's sandboxed preload offers: 'electron' and a few built-ins, no local files.
  const sandboxRequire = (name) => {
    if (name === 'electron') return electron;
    if (['events', 'timers', 'url'].includes(name)) return require(name);
    refused.push(name);
    throw new Error(`module not found: ${name}`);
  };
  const context = {
    require: sandboxRequire,
    module: { exports: {} },
    process: { argv, platform: 'darwin', arch: 'arm64', versions: { electron: '44', chrome: '140', node: '24' }, env: {} },
    window: { localStorage: { getItem: () => null, removeItem: () => {} } },
    document: {},
    navigator: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Promise,
    setTimeout,
    clearTimeout
  };
  context.exports = context.module.exports;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { exposed, calls, refused };
}

describe('the bundled client preload under a sandbox', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-preload-'));
  const outfile = path.join(dir, 'electron-preload.js');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('needs nothing but electron, and exposes the same API', () => {
    bundleDevPreload(ROOT, outfile);
    const { exposed, calls, refused } = runSandboxed(outfile, ['electron', '--lana-flavor=lana-one']);
    // Without briefs/dist built (npm run build:briefs), the Briefs bridge is left out, as in
    // the source preload: its require fails inside a try and the client runs without Briefs.
    const briefsBuilt = fs.existsSync(path.join(ROOT, 'briefs', 'dist', 'briefs-preload.cjs'));
    expect(refused).toEqual(briefsBuilt ? [] : ['./briefs/dist/briefs-preload.cjs']);
    expect(exposed.lanaBrand).toMatchObject({ flavor: 'lana-one' });
    expect(Object.keys(exposed.lanaAuthToken).sort()).toEqual(['clear', 'get', 'set']);
    expect(typeof exposed.electronAPI.getSavedServer).toBe('function');
    expect(typeof exposed.electronAPI.location.getApproximate).toBe('function');
    expect(exposed.electronAPI.invoke).toBeUndefined();
    expect(exposed.isElectron).toBe(true);
    expect(calls).toContain('auth-token:get');
  });

  test('the location reading still comes from the shared model', async () => {
    bundleDevPreload(ROOT, outfile);
    const { exposed } = runSandboxed(outfile, ['electron']);
    // Location is off (get-choice answers null here): the model's "not turned on yet" reading.
    await expect(exposed.electronAPI.location.getApproximate()).resolves.toMatchObject({ status: 'prompt', approx: null });
  });
});

describe('clientPreloadPath', () => {
  test('a packaged app uses the bundle at its root; an unpackaged one bundles once per launch', () => {
    expect(clientPreloadPath({ isPackaged: true, rootDir: '/app' })).toBe(path.join('/app', 'electron-preload.js'));
    const bundle = jest.fn();
    const first = clientPreloadPath({ isPackaged: false, rootDir: '/dev-root', bundle });
    expect(first).toBe(path.join('/dev-root', 'electron-dist', 'dev-preload', 'electron-preload.js'));
    clientPreloadPath({ isPackaged: false, rootDir: '/dev-root', bundle });
    expect(bundle).toHaveBeenCalledTimes(1);
    expect(bundle).toHaveBeenCalledWith('/dev-root', first);
  });
});
