/**
 * electron-external-url.js
 *
 * Decides which URLs the main process may hand to shell.openExternal. Any
 * renderer (including iframed connector UIs) can ask main to open a URL, and
 * the OS will launch whatever app owns the scheme, so only web, mail and the
 * Brainchild vault deep link are allowed. Everything else is refused.
 *
 * Pure so it can be unit-tested without Electron.
 */

'use strict';

const WEB_PROTOCOLS = new Set(['https:', 'http:']);

function parse(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value.trim());
  } catch (_) {
    return null;
  }
}

/**
 * @param {string} value
 * @returns {boolean} true when the URL may be opened outside the app
 */
function isAllowedExternalUrl(value) {
  const url = parse(value);
  if (!url) return false;
  if (WEB_PROTOCOLS.has(url.protocol)) return Boolean(url.hostname);
  if (url.protocol === 'mailto:') return Boolean(url.pathname);
  // Brainchild notes: brainchild://vault/<path> (see electron-preload openNote).
  if (url.protocol === 'brainchild:') return url.hostname === 'vault';
  return false;
}

// Mail link fields the app never uses and a page must not set: a local file to attach, and
// hidden or extra recipients.
const DROPPED_MAIL_FIELDS = new Set(['attach', 'attachment', 'cc', 'bcc']);

/**
 * The URL to hand to the system, or null when it may not be opened: an allowed URL as is,
 * except that a mailto: link loses its attach, attachment, cc and bcc fields (the other
 * fields stay exactly as written).
 * @param {string} value
 * @returns {string|null}
 */
function sanitizeExternalUrl(value) {
  if (!isAllowedExternalUrl(value)) return null;
  const url = parse(value);
  if (url.protocol !== 'mailto:') return url.href;
  // No line breaks anywhere in a mail link, raw or percent-encoded: they would start new
  // mail headers in the mail app (a hidden Bcc, for example).
  const text = value.trim().replace(/[\r\n]/g, '').replace(/%0[da]/gi, '');
  // Stripping can rebuild an encoded break from nested text (%%0D0D becomes %0D): refuse it.
  if (/%0[da]/i.test(text)) return null;
  const queryAt = text.indexOf('?');
  if (queryAt === -1) return text;
  const kept = text.slice(queryAt + 1).split('&').filter((pair) => {
    const name = pair.split('=')[0];
    let decoded;
    try { decoded = decodeURIComponent(name); } catch (_) { decoded = name; }
    return pair !== '' && !DROPPED_MAIL_FIELDS.has(decoded.trim().toLowerCase());
  });
  return text.slice(0, queryAt) + (kept.length ? `?${kept.join('&')}` : '');
}

module.exports = { isAllowedExternalUrl, sanitizeExternalUrl };
