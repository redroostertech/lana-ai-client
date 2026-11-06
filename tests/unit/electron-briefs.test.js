'use strict';

// LANA Briefs in the client's main process (electron-briefs.js): it runs only while
// discovery lists lana-notes and someone is signed in, one start or stop at a time, in a
// folder per person, restores only once a window has loaded, and every window gets its
// events. Each test names the review finding it guards.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { createBriefs, isBriefsEnabled, isClientPage, personKey, sessionSnapshot, registerBriefsSchemes, BRIEFS_AUDIO_SCHEME } = require('../../electron-briefs');
const beforePack = require('../../scripts/briefs-before-pack');

function token(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part(claims)}.sig`;
}
const ALICE = token({ userId: 'u-alice', organizationId: 'org-1', email: 'alice@firm.test' });
const BOB = token({ userId: 'u-bob', organizationId: 'org-1' });

function fakeWindow({ loaded = true } = {}) {
  const contents = new EventEmitter();
  contents.isLoading = () => !loaded;
  contents.getURL = () => (loaded ? 'file:///app/public_html/dashboard.html' : '');
  contents.finishLoad = () => { loaded = true; contents.emit('did-finish-load'); };
  return { webContents: contents, isDestroyed: () => false };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup({ windows = [fakeWindow()], startGate = null, stopGate = null, restoreError = null } = {}) {
  const app = new EventEmitter();
  Object.assign(app, { getPath: (name) => `/tmp/${name}`, isPackaged: false, quit: jest.fn() });
  const state = { token: ALICE, windows };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const hosts = [];
  const module = {
    startBriefsHost: jest.fn(async (options) => {
      if (startGate) await startGate;
      const host = {
        options,
        added: [],
        restored: 0,
        stopped: 0,
        stopDone: false,
        steps: [],
        sessionChanged: jest.fn(() => host.steps.push('sessionChanged')),
        endSession: jest.fn(async () => { host.steps.push('endSession'); }),
        addWebContents: (contents) => host.added.push(contents),
        focused: jest.fn(),
        blurred: jest.fn(),
        restore: async () => {
          host.restored += 1;
          if (restoreError) throw restoreError;
        },
        stop: async () => {
          host.steps.push('stop');
          host.stopped += 1;
          if (stopGate) await stopGate;
          host.stopDone = true;
        }
      };
      hosts.push(host);
      return host;
    })
  };
  const briefs = createBriefs({
    electron: {
      app,
      session: { defaultSession: {} },
      protocol: {}, desktopCapturer: {}, systemPreferences: {}, shell: {}, dialog: {}, safeStorage: {}, nativeTheme: {}
    },
    loadHost: () => module,
    distDir: '/app/briefs/dist',
    engineBase: () => 'http://127.0.0.1:8079',
    apiBase: () => 'http://127.0.0.1:8079',
    getServer: () => ({ orgId: 'org', orgName: 'Harlow Reyes LLP' }),
    getToken: () => state.token,
    getWindows: () => state.windows,
    showWindow: jest.fn(),
    log
  });
  return { briefs, app, state, hosts, module, log };
}

const enabled = { orgId: 'org', enabledApps: [{ id: 'lana-works' }, { id: 'lana-notes', label: 'LANA Briefs' }] };
const without = { orgId: 'org', enabledApps: [{ id: 'lana-works' }] };
const flush = () => new Promise((resolve) => setImmediate(resolve));

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

  test('starts once with LANA\'s runtime, restores after a window has loaded, and stops when discovery drops it', async () => {
    const { briefs, hosts } = setup();
    await briefs.sync(enabled);
    await briefs.sync(enabled);
    expect(hosts).toHaveLength(1);
    const [host] = hosts;
    expect(host.restored).toBe(1);
    expect(host.options.engineBase()).toBe('http://127.0.0.1:8079');
    expect(host.options.session().token).toBe(ALICE);
    expect(host.options.transcriptionWorker).toBe('/app/briefs/dist/briefs-transcription-worker.cjs');
    // One model catalog: Briefs' speech packages come from the client's pinned list.
    expect(host.options.speechPackages.map((pkg) => pkg.id).sort()).toEqual(['embedding', 'kokoro', 'parakeet', 'segmentation', 'vad']);
    expect(briefs.isRunning()).toBe(true);
    await briefs.sync(without);
    expect(host.stopped).toBe(1);
    expect(briefs.isRunning()).toBe(false);
  });

  test('finding: shared computer. Each person has their own folder, and another person signing in stops the previous host first', async () => {
    const { briefs, hosts, state } = setup();
    await briefs.sync(enabled);
    state.token = BOB;
    await briefs.sync(enabled);
    expect(hosts).toHaveLength(2);
    expect(hosts[0].stopDone).toBe(true);
    const [alice, bob] = hosts.map((host) => host.options.directory);
    expect(alice).not.toBe(bob);
    expect(alice).toBe(path.join('/tmp/userData', 'briefs', 'people', personKey(ALICE)));
    expect(alice).not.toContain('u-alice');
    expect(personKey('not-a-jwt')).toBeNull();
    expect(personKey(token({ organizationId: 'org-1' }))).toBeNull();
  });

  test('one session: Briefs reads the client\'s session (token, API base, who), nothing else', () => {
    expect(sessionSnapshot(ALICE, 'http://127.0.0.1:8079', { orgName: 'Harlow Reyes LLP' })).toEqual({
      token: ALICE,
      apiBase: 'http://127.0.0.1:8079',
      user: { id: 'u-alice', organizationID: 'org-1', organizationName: 'Harlow Reyes LLP', email: 'alice@firm.test', firstName: '', lastName: '' }
    });
    expect(sessionSnapshot(null, 'http://127.0.0.1:8079', null)).toBeNull();
    expect(sessionSnapshot('not-a-jwt', 'http://127.0.0.1:8079', null)).toBeNull();
    expect(sessionSnapshot(ALICE, null, null)).toBeNull();
  });

  test('a refreshed token for the same person tells Briefs to read the session again, with no restart', async () => {
    const { briefs, hosts, state } = setup();
    await briefs.sync(enabled);
    state.token = token({ userId: 'u-alice', organizationId: 'org-1', exp: 9999999999 });
    await briefs.sync(enabled);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].sessionChanged).toHaveBeenCalledTimes(1);
    expect(hosts[0].stopped).toBe(0);
  });

  test('signing out ends the person\'s session (phones lose background access) before Briefs stops', async () => {
    const { briefs, hosts, state } = setup();
    await briefs.sync(enabled);
    state.token = null;
    await briefs.sync(null);
    expect(hosts[0].steps).toEqual(['endSession', 'stop']);
  });

  test('another person signing in ends the first person\'s session; turning Briefs off only stops it (control)', async () => {
    const switched = setup();
    await switched.briefs.sync(enabled);
    switched.state.token = BOB;
    await switched.briefs.sync(enabled);
    expect(switched.hosts[0].steps).toEqual(['endSession', 'stop']);

    const disabled = setup();
    await disabled.briefs.sync(enabled);
    await disabled.briefs.sync(without);
    expect(disabled.hosts[0].steps).toEqual(['stop']);
  });

  test('never starts without a session, and stops on sign-out', async () => {
    const signedOut = setup();
    signedOut.state.token = null;
    await signedOut.briefs.sync(enabled);
    expect(signedOut.hosts).toHaveLength(0);
    const { briefs, hosts } = setup();
    await briefs.sync(enabled);
    await briefs.sync(null);
    expect(hosts[0].stopped).toBe(1);
  });

  test('finding: restore before a window. The host waits for a loaded page before it restores', async () => {
    const pending = fakeWindow({ loaded: false });
    const { briefs, hosts } = setup({ windows: [pending] });
    const started = briefs.sync(enabled);
    await flush();
    expect(hosts).toHaveLength(1);
    expect(hosts[0].restored).toBe(0);
    pending.webContents.finishLoad();
    await started;
    expect(hosts[0].restored).toBe(1);
  });

  test('finding: windows. Every window, including ones made later and the login window, gets events, focus and blur', async () => {
    const { briefs, hosts, app } = setup();
    await briefs.sync(enabled);
    const later = fakeWindow();
    app.emit('browser-window-created', {}, later);
    app.emit('browser-window-focus');
    app.emit('browser-window-blur');
    const [host] = hosts;
    expect(host.added).toContain(later.webContents);
    expect(host.focused).toHaveBeenCalledTimes(1);
    expect(host.blurred).toHaveBeenCalledTimes(1);
  });

  test('finding: partial start. A restore that fails stops the host it started, and the next sync starts cleanly', async () => {
    const error = Object.assign(new Error('secret path /Users/x'), { name: 'BriefsHostStartupError' });
    const { briefs, hosts, log } = setup({ restoreError: error });
    await briefs.sync(enabled);
    expect(hosts[0].stopped).toBe(1);
    expect(briefs.isRunning()).toBe(false);
    expect(log.error).toHaveBeenCalledWith('[briefs] did not start: BriefsHostStartupError');
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('/Users/x');
  });

  test('finding: quit during a stop. stop() waits for a stop already in progress', async () => {
    const gate = deferred();
    const { briefs, hosts } = setup({ stopGate: gate.promise });
    await briefs.sync(enabled);
    const signOut = briefs.sync(null);
    let quitDone = false;
    const quit = briefs.stop().then(() => { quitDone = true; });
    await flush();
    expect(quitDone).toBe(false);
    gate.resolve();
    await Promise.all([signOut, quit]);
    expect(hosts[0].stopDone).toBe(true);
    expect(quitDone).toBe(true);
  });

  test('a stop asked for while a start waits for a window ends the wait and stops the host; a token refresh for the same person does not', async () => {
    const pending = fakeWindow({ loaded: false });
    const { briefs, hosts } = setup({ windows: [pending] });
    const start = briefs.sync(enabled);
    await flush();
    const refresh = briefs.sync(enabled);
    await flush();
    expect(hosts[0].stopped).toBe(0);
    pending.webContents.finishLoad();
    await Promise.all([start, refresh]);
    expect(hosts[0].restored).toBe(1);

    const second = setup({ windows: [fakeWindow({ loaded: false })] });
    const waiting = second.briefs.sync(enabled);
    await flush();
    await second.briefs.stop();
    await waiting;
    expect(second.hosts[0].restored).toBe(0);
    expect(second.hosts[0].stopDone).toBe(true);
  });

  test('finding: cost while off. The scheme registers without loading Briefs, and matches the host\'s', () => {
    const registered = [];
    registerBriefsSchemes({ registerSchemesAsPrivileged: (schemes) => registered.push(...schemes) });
    expect(registered.map((scheme) => scheme.scheme)).toEqual([BRIEFS_AUDIO_SCHEME]);
    const source = fs.readFileSync(path.join(__dirname, '../../briefs/packages/host/src/main/services/meetingAudio.ts'), 'utf8');
    expect(source).toContain(`export const AUDIO_SCHEME = "${BRIEFS_AUDIO_SCHEME}";`);
  });
});

describe('packaging: the Briefs speech engine for each target', () => {
  test('finding: cross builds. Each target needs its own sherpa platform package', () => {
    expect(beforePack.requiredPackages('darwin', 3)).toEqual(['sherpa-onnx-darwin-arm64']);
    expect(beforePack.requiredPackages('darwin', 1)).toEqual(['sherpa-onnx-darwin-x64']);
    expect(beforePack.requiredPackages('win32', 1)).toEqual(['sherpa-onnx-win-x64']);
    expect(beforePack.requiredPackages('darwin', 4)).toEqual(['sherpa-onnx-darwin-arm64', 'sherpa-onnx-darwin-x64']);
  });

  test('refuses a build whose platform package is missing; one that is installed passes (control)', async () => {
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'briefs-pack-'));
    try {
      fs.mkdirSync(path.join(root, 'node_modules', 'sherpa-onnx-darwin-arm64'), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', 'sherpa-onnx-darwin-arm64', 'package.json'), '{}');
      expect(beforePack.missingPackages(root, 'darwin', 3)).toEqual([]);
      expect(beforePack.missingPackages(root, 'darwin', 1)).toEqual(['sherpa-onnx-darwin-x64']);
      expect(beforePack.missingPackages(root, 'win32', 1)).toEqual(['sherpa-onnx-win-x64']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    await expect(beforePack({ electronPlatformName: 'win32', arch: 6 })).rejects.toThrow(/speech engine missing/);
  });
});
