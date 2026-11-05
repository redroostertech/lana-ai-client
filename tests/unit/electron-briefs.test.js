'use strict';

// LANA Briefs runs only while discovery lists lana-notes and someone is signed in
// (electron-briefs.js): the host starts and stops with the saved server, never twice,
// and stops on sign-out.

const { createBriefs, isBriefsEnabled, isClientPage } = require('../../electron-briefs');

function fakeWindow() {
  const handlers = {};
  return { webContents: { id: Math.random() }, isDestroyed: () => false, on: (name, fn) => { handlers[name] = fn; }, handlers };
}

function setup({ token = 'tok' } = {}) {
  const calls = { started: 0, stopped: 0, added: 0, options: null };
  let release = null;
  const host = {
    addWebContents: () => { calls.added += 1; },
    focused: jest.fn(),
    blurred: jest.fn(),
    restore: async () => {},
    stop: async () => { calls.stopped += 1; }
  };
  const module = {
    startBriefsHost: jest.fn(async (options) => {
      calls.started += 1;
      calls.options = options;
      if (release) await release;
      return host;
    })
  };
  const state = { token };
  const briefs = createBriefs({
    electron: {
      app: { getPath: (name) => `/tmp/${name}`, isPackaged: false, quit: jest.fn() },
      session: { defaultSession: {} },
      protocol: {}, desktopCapturer: {}, systemPreferences: {}, shell: {}, dialog: {}, safeStorage: {}, nativeTheme: {}
    },
    loadHost: () => module,
    distDir: '/app/briefs/dist',
    engineBase: () => 'http://127.0.0.1:8079',
    getToken: () => state.token,
    getWindows: () => [fakeWindow()],
    showWindow: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  });
  return { briefs, calls, host, module, state, hold: (promise) => { release = promise; } };
}

const enabled = { orgId: 'org', enabledApps: [{ id: 'lana-works' }, { id: 'lana-notes', label: 'LANA Briefs' }] };
const without = { orgId: 'org', enabledApps: [{ id: 'lana-works' }] };

describe('LANA Briefs in the client', () => {
  test('reads lana-notes from discovery as an object or a plain id; anything else is off (control)', () => {
    expect(isBriefsEnabled(enabled)).toBe(true);
    expect(isBriefsEnabled({ enabledApps: ['lana-notes'] })).toBe(true);
    expect(isBriefsEnabled(without)).toBe(false);
    expect(isBriefsEnabled({ enabledApps: 'lana-notes' })).toBe(false);
    expect(isBriefsEnabled(null)).toBe(false);
  });

  test('trusts only the client\'s own file:// pages', () => {
    expect(isClientPage('file:///Applications/LANA.app/Contents/Resources/app.asar/public_html/dashboard.html')).toBe(true);
    expect(isClientPage('https://evil.test/')).toBe(false);
    expect(isClientPage('')).toBe(false);
  });

  test('starts once when enabled, with Briefs\' own folder and LANA\'s runtime; stops when discovery drops it', async () => {
    const { briefs, calls } = setup();
    await briefs.sync(enabled);
    await briefs.sync(enabled);
    expect(calls.started).toBe(1);
    expect(calls.added).toBe(1);
    expect(calls.options.directory).toBe('/tmp/userData/briefs');
    expect(calls.options.lanaRuntime.engineBase()).toBe('http://127.0.0.1:8079');
    expect(calls.options.lanaRuntime.token()).toBe('tok');
    expect(calls.options.transcriptionWorker).toBe('/app/briefs/dist/briefs-transcription-worker.cjs');
    expect(briefs.isRunning()).toBe(true);
    await briefs.sync(without);
    expect(calls.stopped).toBe(1);
    expect(briefs.isRunning()).toBe(false);
  });

  test('never starts without a session, and stops on sign-out', async () => {
    const signedOut = setup({ token: null });
    await signedOut.briefs.sync(enabled);
    expect(signedOut.calls.started).toBe(0);
    const { briefs, calls } = setup();
    await briefs.sync(enabled);
    await briefs.sync(null);
    expect(calls.stopped).toBe(1);
  });

  test('a stop asked for while it is starting stops it once the start finishes', async () => {
    const { briefs, calls, hold } = setup();
    let release;
    hold(new Promise((resolve) => { release = resolve; }));
    const first = briefs.sync(enabled);
    const second = briefs.sync(without);
    release();
    await Promise.all([first, second]);
    expect(calls.started).toBe(1);
    expect(calls.stopped).toBe(1);
    expect(briefs.isRunning()).toBe(false);
  });

  test('a start that fails leaves Briefs off and logs only the error name', async () => {
    const { briefs, module } = setup();
    module.startBriefsHost.mockRejectedValueOnce(Object.assign(new Error('secret path /Users/x'), { name: 'BriefsHostStartupError' }));
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const failing = createBriefs({
      electron: { app: { getPath: () => '/tmp', isPackaged: false }, session: { defaultSession: {} } },
      loadHost: () => module, distDir: '/d', engineBase: () => null, getToken: () => 't', getWindows: () => [], showWindow: () => {}, log
    });
    await failing.sync(enabled);
    expect(failing.isRunning()).toBe(false);
    expect(log.error).toHaveBeenCalledWith('[briefs] did not start: BriefsHostStartupError');
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('/Users/x');
    expect(briefs.isRunning()).toBe(false);
  });

  test('windows get Briefs events while it runs and tell it about focus and blur', async () => {
    const { briefs, host } = setup();
    await briefs.sync(enabled);
    const window = fakeWindow();
    briefs.addWindow(window);
    window.handlers.focus();
    window.handlers.blur();
    expect(host.focused).toHaveBeenCalledTimes(1);
    expect(host.blurred).toHaveBeenCalledTimes(1);
  });
});
