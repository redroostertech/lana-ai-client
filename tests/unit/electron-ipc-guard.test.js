'use strict';

/**
 * The one sender check for main-process IPC (electron-ipc-guard.js) and the
 * channel policy it enforces (electron-ipc-policy.js). docs/plans/harden-ipc.md.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const {
  V,
  appPagePath,
  isAppSender,
  refusalFor,
  createGestureTracker,
  createIpcGuard,
  GESTURE_WINDOW_MS
} = require('../../electron-ipc-guard');
const { IPC_POLICY } = require('../../electron-ipc-policy');

const ROOT = path.join(__dirname, '..', '..');
// The app's pages are served from lana-app://app/public_html/ (electron-app-protocol.js).
const pageUrl = (page) => `lana-app://app/public_html/${page}`;

let nextId = 1;
function eventFrom(url, { parent = null, sender } = {}) {
  return { senderFrame: { url, parent }, sender: sender || { id: nextId++ } };
}

function fakeIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle: jest.fn((channel, fn) => handlers.set(channel, fn)),
    on: jest.fn((channel, fn) => listeners.set(channel, fn)),
    removeHandler: jest.fn((channel) => handlers.delete(channel))
  };
}

describe('which senders are app pages', () => {
  test('the top frame of a page on lana-app://app/public_html/ is accepted', () => {
    expect(appPagePath(pageUrl('login.html'))).toBe('login.html');
    expect(appPagePath(pageUrl('admin/updates.html') + '?tab=1#x')).toBe('admin/updates.html');
    expect(appPagePath(pageUrl('screen-voice/overlay/index.html?flavor=lana'))).toBe('screen-voice/overlay/index.html');
    expect(isAppSender(eventFrom(pageUrl('dashboard.html')))).toBe(true);
  });

  test('remote pages, file: pages, other app paths and other hosts are refused', () => {
    expect(isAppSender(eventFrom('https://evil.example/login.html'))).toBe(false);
    expect(isAppSender(eventFrom('http://127.0.0.1:8080/app.html'))).toBe(false);
    expect(isAppSender(eventFrom('data:text/html,<p>x</p>'))).toBe(false);
    expect(isAppSender(eventFrom('about:blank'))).toBe(false);
    // file: pages were the app's before part A; now they are not.
    expect(isAppSender(eventFrom(pathToFileURL(path.join(ROOT, 'public_html', 'login.html')).href))).toBe(false);
    expect(isAppSender(eventFrom('file:///tmp/downloaded.html'))).toBe(false);
    expect(isAppSender(eventFrom('lana-app://app/electron-main.js'))).toBe(false);
    expect(isAppSender(eventFrom('lana-app://app/public_html/'))).toBe(false);
    expect(isAppSender(eventFrom('lana-app://app/public_html/../electron-preload.js'))).toBe(false);
    expect(isAppSender(eventFrom('lana-app://evil/public_html/login.html'))).toBe(false);
    expect(isAppSender(eventFrom('lana-audio://app/public_html/login.html'))).toBe(false);
    expect(isAppSender(eventFrom('not a url'))).toBe(false);
  });

  test('a frame inside a page is refused, even one of our pages', () => {
    const top = { url: pageUrl('app.html'), parent: null };
    expect(isAppSender(eventFrom(pageUrl('integrations/connector-viewer.html'), { parent: top }))).toBe(false);
  });

  test('an event without a frame (destroyed or navigated away) is refused', () => {
    expect(isAppSender({ sender: { id: 1 } })).toBe(false);
    expect(isAppSender({ senderFrame: null })).toBe(false);
    expect(isAppSender(null)).toBe(false);
  });
});

describe('gestures', () => {
  // A window whose top frame is an app page; focusedFrame is where the input went.
  function appContents(id = 7) {
    const listeners = {};
    const mainFrame = { url: pageUrl('app.html'), parent: null };
    const contents = {
      id,
      mainFrame,
      focusedFrame: mainFrame,
      on: (name, fn) => { listeners[name] = fn; },
      once: (name, fn) => { listeners[name] = fn; }
    };
    return { contents, listeners, mainFrame };
  }

  test('a click or key press in the app\'s own frame counts for about 2 seconds', () => {
    let now = 1000;
    const tracker = createGestureTracker({ now: () => now });
    const { contents, listeners } = appContents();
    tracker.watch(contents);
    expect(GESTURE_WINDOW_MS).toBeLessThanOrEqual(2000);
    expect(tracker.recent(contents)).toBe(false);
    listeners['input-event']({}, { type: 'mouseMove' });
    expect(tracker.recent(contents)).toBe(false);
    listeners['input-event']({}, { type: 'mouseUp' });
    expect(tracker.recent(contents)).toBe(true);
    expect(tracker.recent({ id: 8 })).toBe(false);
    now += GESTURE_WINDOW_MS + 1;
    expect(tracker.recent(contents)).toBe(false);
    listeners['input-event']({}, { type: 'keyDown' });
    expect(tracker.recent(contents)).toBe(true);
    listeners.destroyed();
    expect(tracker.recent(contents)).toBe(false);
  });

  test('input that went to a third-party frame inside the page does not count', () => {
    const tracker = createGestureTracker();
    const { contents, listeners, mainFrame } = appContents();
    tracker.watch(contents);
    contents.focusedFrame = { url: 'https://evil.example/frame.html', parent: mainFrame };
    listeners['input-event']({}, { type: 'mouseUp' });
    listeners['input-event']({}, { type: 'keyDown' });
    expect(tracker.recent(contents)).toBe(false);
    // One of the app's own frames (same origin) is the app's input.
    contents.focusedFrame = { url: pageUrl('integrations/connector-viewer.html'), parent: mainFrame };
    listeners['input-event']({}, { type: 'mouseUp' });
    expect(tracker.recent(contents)).toBe(true);
  });

  test('mouse down alone does not count (focus has not moved yet), nor input on a page that is not the app', () => {
    const tracker = createGestureTracker();
    const { contents, listeners, mainFrame } = appContents();
    tracker.watch(contents);
    listeners['input-event']({}, { type: 'mouseDown' });
    expect(tracker.recent(contents)).toBe(false);
    mainFrame.url = 'https://evil.example/';
    listeners['input-event']({}, { type: 'mouseUp' });
    expect(tracker.recent(contents)).toBe(false);
  });

  test('a gesture stops counting once the window shows a page that is not the app', () => {
    const tracker = createGestureTracker();
    const { contents, listeners, mainFrame } = appContents();
    tracker.watch(contents);
    listeners['input-event']({}, { type: 'mouseUp' });
    mainFrame.url = 'https://evil.example/';
    expect(tracker.recent(contents)).toBe(false);
  });

  test('mark (a native dialog the person answered) counts', () => {
    const tracker = createGestureTracker();
    const { contents } = appContents();
    tracker.mark(contents);
    expect(tracker.recent(contents)).toBe(true);
  });
});

describe('the guard around ipcMain', () => {
  const policy = {
    'demo:read': { kind: 'invoke', args: [] },
    'demo:write': { kind: 'invoke', args: [V.string(10)], gesture: true },
    'demo:login-only': { kind: 'invoke', args: [], pages: ['login.html'] },
    'demo:sync': { kind: 'sync', args: [] }
  };

  function setup() {
    const ipcMain = fakeIpcMain();
    const gestures = createGestureTracker();
    const warn = jest.fn();
    const guard = createIpcGuard({ ipcMain, policy, gestures, warn });
    return { ipcMain, gestures, warn, guard };
  }

  test('registering a channel without a policy, or of the wrong kind, throws', () => {
    const { guard } = setup();
    expect(() => guard.handle('vpn-load-keys', () => null)).toThrow(/no policy/);
    expect(() => guard.handle('demo:sync', () => null)).toThrow(/sync channel/);
    expect(() => guard.on('demo:read', () => null)).toThrow(/invoke channel/);
  });

  test('a foreign frame is refused before the handler runs', async () => {
    const { ipcMain, guard, warn } = setup();
    const fn = jest.fn(() => 'ok');
    guard.handle('demo:read', fn);
    const handler = ipcMain.handlers.get('demo:read');
    await expect(Promise.resolve().then(() => handler(eventFrom('https://evil.example/')))).rejects.toThrow('Refused: untrusted_sender');
    expect(fn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[ipc] refused demo:read: untrusted_sender');
    expect(handler(eventFrom(pageUrl('app.html')))).toBe('ok');
  });

  test('bad or extra arguments are refused', () => {
    const { ipcMain, guard, gestures } = setup();
    const fn = jest.fn(() => 'ok');
    guard.handle('demo:write', fn);
    const handler = ipcMain.handlers.get('demo:write');
    const sender = { id: 99 };
    gestures.mark(sender);
    const ev = () => eventFrom(pageUrl('app.html'), { sender });
    expect(() => handler(ev(), 42)).toThrow('bad_arguments');
    expect(() => handler(ev(), 'x'.repeat(11))).toThrow('bad_arguments');
    expect(() => handler(ev(), 'ok', 'extra')).toThrow('bad_arguments');
    expect(handler(ev(), 'fine')).toBe('ok');
  });

  test('a gesture channel needs a recent click in that window', () => {
    const { ipcMain, guard, gestures } = setup();
    guard.handle('demo:write', () => 'ok');
    const handler = ipcMain.handlers.get('demo:write');
    const sender = { id: 100 };
    expect(() => handler(eventFrom(pageUrl('app.html'), { sender }), 'a')).toThrow('needs_user_action');
    gestures.mark({ id: 101 });
    expect(() => handler(eventFrom(pageUrl('app.html'), { sender }), 'a')).toThrow('needs_user_action');
    gestures.mark(sender);
    expect(handler(eventFrom(pageUrl('app.html'), { sender }), 'a')).toBe('ok');
  });

  test('a page-limited channel answers only that page', () => {
    const { ipcMain, guard } = setup();
    guard.handle('demo:login-only', () => 'ok');
    const handler = ipcMain.handlers.get('demo:login-only');
    expect(() => handler(eventFrom(pageUrl('app.html')))).toThrow('wrong_page');
    expect(handler(eventFrom(pageUrl('login.html')))).toBe('ok');
  });

  test('a refused sync call returns null and never runs the handler', () => {
    const { ipcMain, guard } = setup();
    const fn = jest.fn((event) => { event.returnValue = 'secret'; });
    guard.on('demo:sync', fn);
    const listener = ipcMain.listeners.get('demo:sync');
    const foreign = eventFrom('https://evil.example/');
    listener(foreign);
    expect(foreign.returnValue).toBe(null);
    expect(fn).not.toHaveBeenCalled();
    const ours = eventFrom(pageUrl('app.html'));
    listener(ours);
    expect(ours.returnValue).toBe('secret');
  });
});

describe('the sensitive channels refuse bad arguments and the wrong page', () => {
  const app = (page = 'app.html') => eventFrom(pageUrl(page));
  const gestures = { recent: () => true };
  const refusal = (channel, args, event = app()) => refusalFor(event, IPC_POLICY[channel], args, { gestures });

  test('server repoint: only the sign-in and app-link pages, with an object', () => {
    expect(refusal('save-settings', [{ url: 'https://firm.example' }])).toBe('wrong_page');
    expect(refusal('save-settings', [{ url: 'https://firm.example' }], app('login.html'))).toBe(null);
    expect(refusal('save-settings', [{ url: 'https://firm.example' }], app('accept-invite.html'))).toBe(null);
    expect(refusal('save-settings', ['https://firm.example'], app('login.html'))).toBe('bad_arguments');
    expect(refusal('save-settings', [{ blob: 'x'.repeat(300 * 1024) }], app('login.html'))).toBe('bad_arguments');
    expect(refusal('chef-pin:prepare', [{ url: 'https://box.example' }])).toBe('wrong_page');
    expect(refusal('chef-pin:prepare', [[1, 2]], app('login.html'))).toBe('bad_arguments');
  });

  test('updates: the page cannot name the update server', () => {
    expect(refusal('check-updates', [null])).toBe(null);
    expect(refusal('check-updates', ['https://evil.example/updates'])).toBe('bad_arguments');
    expect(refusal('install-update', ['https://evil.example/updates'])).toBe('bad_arguments');
    expect(refusal('settings:install-update', ['x'])).toBe('bad_arguments');
    expect(refusal('update-dialog-response', ['update'], app('update-dialog.html'))).toBe(null);
    expect(refusal('update-dialog-response', ['rm -rf'], app('update-dialog.html'))).toBe('bad_arguments');
    expect(refusal('update-dialog-response', ['update'])).toBe('wrong_page');
  });

  test('token store writes: a string of bounded length, or nothing', () => {
    expect(refusal('auth-token:set', ['a.b.c'])).toBe(null);
    expect(refusal('auth-token:set', [null])).toBe(null);
    expect(refusal('auth-token:set', [{ token: 'a.b.c' }])).toBe('bad_arguments');
    expect(refusal('auth-token:set', ['x'.repeat(1024 * 1024)])).toBe('bad_arguments');
    expect(refusal('auth-token:migrate', [42])).toBe('bad_arguments');
    expect(refusal('auth-token:clear', ['extra'])).toBe('bad_arguments');
  });

  test('shell and file system: strings and objects only, and a gesture', () => {
    expect(refusal('open-external-url', [{ href: 'https://x' }])).toBe('bad_arguments');
    expect(refusal('open-external-url', ['https://x'.repeat(2000)])).toBe('bad_arguments');
    expect(refusal('open-external-url', ['https://lanaai.io'])).toBe(null);
    // Without a click it is not refused here: electron-external-open.js asks in the app's dialog.
    expect(refusalFor(app(), IPC_POLICY['open-external-url'], ['https://lanaai.io'], { gestures: { recent: () => false } })).toBe(null);
    expect(refusal('brainchild:revealNote', ['../../etc/passwd'])).toBe('bad_arguments');
    expect(refusal('brainchild:link', ['/Users/x'])).toBe('bad_arguments');
    expect(refusalFor(app(), IPC_POLICY['brainchild:pickInstall'], [], { gestures: { recent: () => false } })).toBe('needs_user_action');
    expect(refusalFor(app(), IPC_POLICY['location:open-system-settings'], [], { gestures: { recent: () => false } })).toBe('needs_user_action');
  });

  test('bridge consent: objects only, and revoking needs a gesture', () => {
    expect(refusal('companion-bridge:respond-consent', ['cb-1'])).toBe('bad_arguments');
    expect(refusal('companion-bridge:respond-consent', [{ requestId: 'cb-1', allow: true }])).toBe(null);
    expect(refusal('settings:revoke-bridge-consent', ['lana-companion'])).toBe('bad_arguments');
    expect(refusalFor(app(), IPC_POLICY['settings:revoke-bridge-consent'], [{ app: 'x' }], { gestures: { recent: () => false } })).toBe('needs_user_action');
  });

  test('session tracking takes no address or token from the page', () => {
    expect(refusal('session-tracker:initialize', ['https://evil.example', 'a.b.c'])).toBe('bad_arguments');
    expect(refusal('session-tracker:initialize', [])).toBe(null);
  });
});
