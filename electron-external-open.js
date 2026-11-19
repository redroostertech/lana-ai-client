'use strict';

/**
 * The one way the app opens a URL in the system browser (docs/plans/harden-ipc.md):
 * the open-external-url channel, window.open of a web link, and a page navigating to
 * one. A page in an app window can ask, and the app opens the link only when:
 *
 *  - the URL is web, mail or the vault link (src/electron-external-url.js);
 *  - the window shows an app page in its top frame, and the asker is the app: for
 *    window.open the opener (its referrer's origin, or without one the focused frame),
 *    for a frame navigation the frame that started it;
 *  - fewer than MAX_OPENS opens happened from that window in the last WINDOW_MS (asks
 *    that were refused or cancelled do not count);
 *  - a plain http:// address always asks (no silent path);
 *  - the person clicked or typed in the app in the last 2 seconds, or else said yes
 *    in a main-process dialog (electron-confirm.js): one question per window at a
 *    time, and none for CANCEL_COOLDOWN_MS after a no.
 */

const { topFrameIsApp, isAppUrl } = require('./electron-ipc-guard');
const { APP_ORIGIN } = require('./electron-app-protocol');

const MAX_OPENS = 3;
const WINDOW_MS = 10 * 1000;
// After the person says no, that window gets no new question for this long.
const CANCEL_COOLDOWN_MS = 10 * 1000;

/**
 * @param {object} deps
 * @param {{ openExternal: Function }} deps.shell
 * @param {(url: string) => boolean} deps.isAllowed
 * @param {(url: string) => string|null} [deps.sanitize] - src/electron-external-url.js sanitizeExternalUrl
 * @param {{ recent: Function }} deps.gestures - electron-ipc-guard.js createGestureTracker
 * @param {(kind: string, details: object, contents: object) => Promise<boolean>} deps.confirm
 */
function createExternalOpener({ shell, isAllowed, sanitize = (url) => url, gestures, confirm, now = () => Date.now(), log = () => {} }) {
  const recentOpens = new Map();
  const asking = new Set();
  const quietUntil = new Map();

  function opensLeft(id) {
    const since = now() - WINDOW_MS;
    const times = (recentOpens.get(id) || []).filter((t) => t > since);
    recentOpens.set(id, times);
    return MAX_OPENS - times.length;
  }

  // Who asked: a window.open's opener (its referrer's origin; without a referrer, the frame
  // that has focus), a frame navigation's initiating frame, else the window's top frame.
  function askerIsApp(contents, { fromWindowOpen, openerUrl, fromFrame }) {
    if (!topFrameIsApp(contents)) return false;
    if (fromFrame !== undefined) return Boolean(fromFrame && isAppUrl(fromFrame.url));
    if (fromWindowOpen) {
      if (openerUrl) return originOf(openerUrl) === APP_ORIGIN;
      const frame = contents.focusedFrame || contents.mainFrame;
      return Boolean(frame && isAppUrl(frame.url));
    }
    return true;
  }

  return {
    /**
     * @param {string} url
     * @param {{ contents: object, fromWindowOpen?: boolean, openerUrl?: string, fromFrame?: object }} from
     * @returns {Promise<boolean>} true when the link was opened
     */
    async open(requested, { contents, fromWindowOpen = false, openerUrl = '', fromFrame } = {}) {
      if (typeof requested !== 'string' || !isAllowed(requested)) return false;
      // What is opened (and shown in the question): the cleaned link (no mail attachments, cc or bcc).
      const url = sanitize(requested);
      if (typeof url !== 'string' || !url) return false;
      if (!askerIsApp(contents, { fromWindowOpen, openerUrl, fromFrame })) return false;
      const id = contents.id;
      if (opensLeft(id) <= 0) {
        log('[external-open] refused: too many opens from one window');
        return false;
      }
      // A window.open without a referrer could come from any frame (a third-party frame can
      // hide its origin with noreferrer), so it always asks, even right after a click.
      // Plain http:// is never opened without a question, however it was asked for.
      const mustAsk = (fromWindowOpen && !openerUrl) || /^http:/i.test(url);
      if (mustAsk || !gestures.recent(contents)) {
        // One question per window at a time, and none for a while after a no.
        if (asking.has(id) || (quietUntil.get(id) || 0) > now()) return false;
        asking.add(id);
        let yes = false;
        try {
          yes = await confirm('openExternal', { url }, contents);
        } finally {
          asking.delete(id);
        }
        if (!yes) {
          quietUntil.set(id, now() + CANCEL_COOLDOWN_MS);
          return false;
        }
        if (opensLeft(id) <= 0) return false;
      }
      recentOpens.get(id).push(now());
      await shell.openExternal(url);
      return true;
    }
  };
}

// Scheme and host (Node's URL gives 'null' as the origin of a custom scheme like lana-app:).
function originOf(value) {
  try {
    const url = new URL(String(value));
    return url.host ? `${url.protocol}//${url.host}` : null;
  } catch (_) {
    return null;
  }
}

module.exports = { createExternalOpener, MAX_OPENS, WINDOW_MS, CANCEL_COOLDOWN_MS };
