'use strict';

/**
 * The IPC allowlist, checked statically (docs/plans/harden-ipc.md):
 *  - the client preload names every channel as a literal, each one in
 *    electron-ipc-policy.js with the same kind, and exposes no generic
 *    invoke or send;
 *  - every renderer use of window.electronAPI is a function the preload exposes;
 *  - every channel the main process registers has a policy, and every policy
 *    is used (no dead channels).
 */

const fs = require('fs');
const path = require('path');
const { IPC_POLICY, EVENT_CHANNELS } = require('../../electron-ipc-policy');
const { createIpcGuard } = require('../../electron-ipc-guard');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const KIND_OF_CALL = { invoke: 'invoke', sendSync: 'sync', send: 'send' };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'vendor', 'tests', 'test'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|html|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Loads electron-preload.js with a recording ipcRenderer and returns what it exposed. */
function loadPreload() {
  const exposed = {};
  const calls = [];
  const record = (method) => jest.fn((channel, ...args) => {
    calls.push({ method, channel, args });
    return method === 'invoke' ? Promise.resolve(null) : null;
  });
  const ipcRenderer = {
    invoke: record('invoke'),
    send: record('send'),
    sendSync: record('sendSync'),
    on: record('on'),
    removeListener: jest.fn()
  };
  jest.resetModules();
  jest.doMock('electron', () => ({ contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer }), { virtual: true });
  const saved = { window: global.window, document: global.document, log: console.log };
  global.window = { localStorage: { getItem: () => null, removeItem: () => {} } };
  global.document = {};
  console.log = () => {};
  try {
    jest.isolateModules(() => require('../../electron-preload.js'));
  } finally {
    global.window = saved.window;
    global.document = saved.document;
    console.log = saved.log;
  }
  return { exposed, calls };
}

/** Calls every function on the exposed API (and its namespaces) with harmless arguments. */
function callEverything(api, calls) {
  const used = [];
  for (const [name, value] of Object.entries(api)) {
    const members = typeof value === 'function' ? [[name, value]] : (value && typeof value === 'object' ? Object.entries(value).map(([k, v]) => [`${name}.${k}`, v]) : []);
    for (const [label, fn] of members) {
      if (typeof fn !== 'function' || label === 'location.getApproximate') continue;
      const before = calls.length;
      try { fn(() => {}, () => {}); } catch (_) { /* a function that needs real input */ }
      for (const call of calls.slice(before)) used.push({ label, ...call });
    }
  }
  return used;
}

describe('the client preload', () => {
  const source = read('electron-preload.js');

  test('every ipcRenderer call names a literal channel (none comes from page data)', () => {
    const dynamic = source.match(/ipcRenderer\.(invoke|send|sendSync|on|removeListener)\(\s*[^'"\s]/g) || [];
    expect(dynamic).toEqual([]);
  });

  test('every literal channel is in the policy with the same kind, and events are listed', () => {
    const problems = [];
    for (const [, method, channel] of source.matchAll(/ipcRenderer\.(invoke|sendSync|send)\(\s*'([^']+)'/g)) {
      const policy = IPC_POLICY[channel];
      if (!policy) problems.push(`${channel}: no policy`);
      else if (policy.kind !== KIND_OF_CALL[method]) problems.push(`${channel}: ${method} but policy is ${policy.kind}`);
    }
    for (const [, channel] of source.matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g)) {
      if (!EVENT_CHANNELS.includes(channel)) problems.push(`${channel}: not an event channel`);
    }
    expect(problems).toEqual([]);
  });

  test('there is no generic invoke, send or on, and unknown functions do not exist', () => {
    const { exposed } = loadPreload();
    const api = exposed.electronAPI;
    expect(api).toBeTruthy();
    expect(api.invoke).toBeUndefined();
    expect(api.send).toBeUndefined();
    expect(api.on).toBeUndefined();
    expect(api.vpn).toBeUndefined();
    expect(() => api.invoke('vpn-load-keys')).toThrow(TypeError);
    expect(() => api.send('update-dialog-response', 'update')).toThrow(TypeError);
  });

  test('every exposed function reaches only allowed channels', () => {
    const { exposed, calls } = loadPreload();
    const used = callEverything(exposed.electronAPI, calls);
    expect(used.length).toBeGreaterThan(40);
    const bad = used.filter((c) => (c.method === 'on' ? !EVENT_CHANNELS.includes(c.channel) : !IPC_POLICY[c.channel] || IPC_POLICY[c.channel].kind !== KIND_OF_CALL[c.method]));
    expect(bad).toEqual([]);
  });

  test('the login token bridge exposes get, set and clear only', () => {
    const { exposed } = loadPreload();
    expect(Object.keys(exposed.lanaAuthToken).sort()).toEqual(['clear', 'get', 'set']);
  });
});

describe('renderer callers', () => {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'js')), ...walk(path.join(ROOT, 'briefs', 'packages'))]
    .filter((f) => !/[\\/]src[\\/]electron-|electron-screen-voice\.js$/.test(f));

  test('the scan found the renderer', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  test('no page calls a generic electronAPI.invoke or send', () => {
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      if (/electronAPI\??\.(invoke|send|sendSync)\s*\(/.test(text)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  test('every electronAPI member a page uses exists in the preload', () => {
    const api = loadPreload().exposed.electronAPI;
    const missing = new Set();
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, top, sub] of text.matchAll(/electronAPI\??\.([A-Za-z_$][\w$]*)(?:\??\.([A-Za-z_$][\w$]*))?/g)) {
        const where = path.relative(ROOT, file);
        if (!(top in api)) { missing.add(`${where}: electronAPI.${top}`); continue; }
        const value = api[top];
        if (sub && value && typeof value === 'object' && !(sub in value)) missing.add(`${where}: electronAPI.${top}.${sub}`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  test('no page reads, keeps or sends the firm\'s service keys', () => {
    const offenders = files
      // Comment lines may name them; code may not.
      .filter((file) => /burstApiKey|forgeApiKey|burst_api_key|forge_api_key/.test(fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  test('no page fetches hosted discovery itself (main asks: discovery:resolve)', () => {
    const offenders = files
      .filter((file) => /lana-ai\/v1\/discovery|DISCOVERY_URL/.test(fs.readFileSync(file, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  test('the overlay preload channels are all registered by the screen voice host', () => {
    const preload = read('screen-voice-preload.js');
    const host = read('src/screen-voice/electron-screen-voice.js');
    expect(preload).not.toMatch(/ipcRenderer\.(invoke|send)\(\s*[^'"\s]/);
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]);
    expect(invoked.length).toBeGreaterThan(10);
    const registered = new Set([...host.matchAll(/handle\('([^']+)'/g)].map((m) => m[1]));
    expect(invoked.filter((c) => !registered.has(c))).toEqual([]);
  });
});

describe('main process registrations', () => {
  function guardedFake() {
    const channels = [];
    const ipcMain = { handle: (c) => channels.push(c), on: (c) => channels.push(c), removeHandler: () => {} };
    return { channels, ipc: createIpcGuard({ ipcMain, policy: IPC_POLICY }) };
  }

  test('electron-main.js registers only through the guard, and only channels with a policy', () => {
    const main = read('electron-main.js');
    expect(main.match(/ipcMain\.(handle|on|once|handleOnce)\(/g)).toBeNull();
    const registered = [...main.matchAll(/ipc\.(handle|on)\(\s*'([^']+)'/g)].map((m) => m[2]);
    expect(registered.length).toBeGreaterThan(30);
    expect(registered.filter((c) => !IPC_POLICY[c])).toEqual([]);
  });

  test('the modules main passes the guard to register only channels with a policy', () => {
    const { channels, ipc } = guardedFake();
    const noop = () => {};
    require('../../electron-token-store').registerTokenIpc(ipc, { get: noop, set: noop, clear: noop, migrateLegacy: noop });
    require('../../electron-app-links').registerAppLinkIpc(ipc, { loginContext: noop, takePending: noop });
    require('../../electron-system-info').registerSystemInfoIpc(ipc, { app: {}, displayVersion: noop, checkForUpdates: noop, lastChecked: noop, lastResult: noop, savedServer: noop, installUpdate: noop, logError: noop });
    require('../../electron-ai-topology').registerAiTopologyIpc(ipc, {});
    require('../../electron-location').registerLocationIpc(ipc, { persistence: { read: noop, write: noop } });
    require('../../electron-appearance').registerAppearanceIpc({ ipcMain: ipc, appearance: {} });
    require('../../electron-first-launch-ipc').registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch: {} });
    for (const channel of Object.values(require('../../electron-local-engine').CHANNELS)) {
      if (channel !== 'engine:state') (IPC_POLICY[channel].kind === 'sync' ? ipc.on : ipc.handle)(channel, noop);
    }
    expect(channels.length).toBeGreaterThan(25);
  });

  test('session tracking and Briefs register channels with a policy', () => {
    const tracker = read('js/session/session-tracker.js');
    const channels = [...tracker.matchAll(/handle\('([^']+)'/g)].map((m) => m[1]);
    expect(channels).toEqual(['session-tracker:start']);
    const { RUNNING_CHANNEL } = require('../../electron-briefs');
    expect(IPC_POLICY[RUNNING_CHANNEL]).toBeTruthy();
  });

  test('every policy channel is used by a preload (no dead channels)', () => {
    const preloads = read('electron-preload.js') + read('briefs/packages/host/src/preload/bridge.ts');
    const unused = Object.keys(IPC_POLICY).filter((c) => !preloads.includes(`'${c}'`) && !preloads.includes(`"${c}"`));
    expect(unused).toEqual([]);
  });
});
