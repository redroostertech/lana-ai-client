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

module.exports = { isAllowedExternalUrl };
