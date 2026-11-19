'use strict';

/**
 * The one sender check for every ipcMain handler (docs/plans/harden-ipc.md).
 *
 * A call is answered only when it comes from the top frame of one of the app's
 * own pages: lana-app://app/public_html/... (electron-app-protocol.js, the one
 * app-page check the window-open policy, token store and Briefs use too),
 * never a remote page, a file: page, or a frame inside a page. Each channel has a policy in electron-ipc-policy.js:
 * which arguments it takes (types and sizes), and for the sensitive ones which
 * page may call it and whether the person must have just clicked or typed.
 *
 * Registering a channel that has no policy throws, so a new handler cannot
 * skip the check.
 */

const { pageOf } = require('./electron-app-protocol');

// The person's own input counts as a gesture this briefly: long enough for the
// click that asked, short enough that injected script cannot wait for an unrelated
// click. Calls that wait on the network first, and the most sensitive actions, ask
// in a main-process dialog instead (electron-confirm.js, electron-external-open.js).
const GESTURE_WINDOW_MS = 2000;
// Input after focus has settled: mouse up (mouse down moves focus into the frame it
// hits, so by mouse up the focused frame is the one clicked), keys and taps.
const GESTURE_INPUT_TYPES = new Set(['mouseUp', 'keyDown', 'rawKeyDown', 'char', 'gestureTap']);

/** The page's path inside public_html ('login.html', 'admin/users.html') for an app URL, or null. */
function appPagePath(url) {
  const page = pageOf(url);
  return page ? page : null;
}

function isAppUrl(url) {
  return appPagePath(url) !== null;
}

/** True when the IPC event comes from the top frame of an app page. */
function isAppSender(event) {
  const frame = event && event.senderFrame;
  if (!frame) return false;
  // A frame inside a page (an iframe, even one of ours) never calls main: the
  // preload runs only in the top frame.
  if (frame.parent) return false;
  return isAppUrl(frame.url);
}

/** True when the window's top frame shows an app page. */
function topFrameIsApp(contents) {
  return Boolean(contents && contents.mainFrame && isAppUrl(contents.mainFrame.url));
}

/**
 * Remembers each window's last click or key press in the app's own frames, for the
 * channels that need a gesture. Input that went to a frame of another origin inside
 * the page (a preview, an embed) does not count.
 */
function createGestureTracker({ now = () => Date.now(), windowMs = GESTURE_WINDOW_MS } = {}) {
  const lastInput = new Map();
  return {
    watch(contents) {
      if (!contents || typeof contents.on !== 'function') return;
      const id = contents.id;
      contents.on('input-event', (_event, input) => {
        if (!input || !GESTURE_INPUT_TYPES.has(input.type)) return;
        const frame = contents.focusedFrame || contents.mainFrame;
        if (topFrameIsApp(contents) && frame && isAppUrl(frame.url)) lastInput.set(id, now());
      });
      if (typeof contents.once === 'function') contents.once('destroyed', () => lastInput.delete(id));
    },
    /** A native dialog the person answered for this window counts as a gesture too. */
    mark(contents) {
      if (contents && contents.id !== undefined) lastInput.set(contents.id, now());
    },
    recent(contents) {
      if (!contents || (contents.mainFrame && !topFrameIsApp(contents))) return false;
      const at = lastInput.get(contents.id);
      return at !== undefined && now() - at <= windowMs;
    }
  };
}

/**
 * About how many bytes a value takes over IPC: strings by length, numbers 8, binary data by
 * byteLength, objects and arrays as the sum of their keys and values. Stops at `stopAt` and
 * at 64 levels deep (Infinity), so a huge payload costs little to refuse.
 */
function payloadBytes(value, stopAt = Infinity) {
  let total = 0;
  const visit = (item, depth) => {
    if (total > stopAt) return;
    if (depth > 64) { total = Infinity; return; }
    if (item === null || item === undefined) return;
    if (typeof item === 'string') { total += item.length; return; }
    if (typeof item === 'number' || typeof item === 'bigint') { total += 8; return; }
    if (typeof item === 'boolean') { total += 1; return; }
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) { total += item.byteLength; return; }
    if (typeof item === 'object') {
      for (const key of Object.keys(item)) {
        if (!Array.isArray(item)) total += key.length;
        visit(item[key], depth + 1);
        if (total > stopAt) return;
      }
    }
  };
  visit(value, 0);
  return total;
}

/** Argument validators for the policy table. Each returns true when the value is acceptable. */
function jsonSize(value) {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? 0 : text.length;
  } catch (_) {
    return Infinity;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const V = Object.freeze({
  string: (max) => (v) => typeof v === 'string' && v.length <= max,
  bool: () => (v) => typeof v === 'boolean',
  nullish: () => (v) => v === null || v === undefined,
  oneOf: (values) => (v) => values.includes(v),
  object: (maxBytes) => (v) => isPlainObject(v) && jsonSize(v) <= maxBytes,
  /** Any structured-clone value small enough (log details). */
  small: (maxBytes) => (v) => jsonSize(v) <= maxBytes,
  optional: (check) => (v) => v === undefined || v === null || check(v)
});

/**
 * Why this call is refused, or null when it may run.
 * @param {object} event - the ipcMain event
 * @param {object} policy - from electron-ipc-policy.js
 * @param {Array} args - the call's arguments after the event
 */
function refusalFor(event, policy, args, { gestures } = {}) {
  if (!isAppSender(event)) return 'untrusted_sender';
  if (policy.pages) {
    const page = appPagePath(event.senderFrame.url);
    if (!policy.pages.includes(page)) return 'wrong_page';
  }
  const specs = policy.args || [];
  if (args.length > specs.length) return 'bad_arguments';
  for (let i = 0; i < specs.length; i += 1) {
    if (!specs[i](args[i])) return 'bad_arguments';
  }
  if (policy.gesture && !(gestures && gestures.recent(event.sender))) return 'needs_user_action';
  return null;
}

/**
 * Wraps ipcMain so every handler registered through it checks its sender and arguments first.
 * @param {object} options
 * @param {object} options.ipcMain - Electron's ipcMain
 * @param {object} options.policy - channel -> { kind: 'invoke'|'sync'|'send', args?, pages?, gesture? }
 * @param {object} [options.gestures] - from createGestureTracker
 * @param {function} [options.warn]
 */
function createIpcGuard({ ipcMain, policy, gestures = createGestureTracker(), warn = () => {} }) {
  function policyFor(channel, kinds) {
    const entry = Object.prototype.hasOwnProperty.call(policy, channel) ? policy[channel] : null;
    if (!entry) throw new Error(`IPC channel ${channel} has no policy in electron-ipc-policy.js`);
    if (!kinds.includes(entry.kind)) throw new Error(`IPC channel ${channel} is a ${entry.kind} channel, not ${kinds.join(' or ')}`);
    return entry;
  }

  function refuse(channel, reason) {
    warn(`[ipc] refused ${channel}: ${reason}`);
  }

  return {
    gestures,
    isAppSender,
    isAppUrl,
    /** ipcRenderer.invoke channels. A refused call rejects in the page. */
    handle(channel, fn) {
      const entry = policyFor(channel, ['invoke']);
      ipcMain.handle(channel, (event, ...args) => {
        const reason = refusalFor(event, entry, args, { gestures });
        if (reason) {
          refuse(channel, reason);
          throw new Error(`Refused: ${reason}`);
        }
        return fn(event, ...args);
      });
    },
    /** ipcRenderer.sendSync ('sync') and ipcRenderer.send ('send') channels. A refused sync call returns null. */
    on(channel, fn) {
      const entry = policyFor(channel, ['sync', 'send']);
      ipcMain.on(channel, (event, ...args) => {
        const reason = refusalFor(event, entry, args, { gestures });
        if (reason) {
          refuse(channel, reason);
          if (entry.kind === 'sync') event.returnValue = null;
          return;
        }
        fn(event, ...args);
      });
    },
    removeHandler: (channel) => ipcMain.removeHandler(channel)
  };
}

module.exports = {
  GESTURE_WINDOW_MS,
  V,
  appPagePath,
  isAppUrl,
  isAppSender,
  topFrameIsApp,
  payloadBytes,
  refusalFor,
  createGestureTracker,
  createIpcGuard
};
