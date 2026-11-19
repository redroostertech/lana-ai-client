/**
 * External links on the app's own pages (docs/plans/harden-ipc.md).
 *
 * A link with target="_blank" to a web or mail address would go through window.open, where the
 * main process cannot tell which frame asked (Electron gives no opener, and a lana-app:// page
 * sends no referrer), so it would always ask "Open this link in your browser?". This script
 * runs only in the app's own pages and same-origin app frames (third-party frames cannot load
 * it), takes the person's real click on such a link, and opens it through the guarded
 * openExternal channel instead: the main process checks the sender and the click, so the link
 * opens without a question (plain http:// still asks). Clicks made by script (isTrusted false)
 * are left alone, as is everything outside the app.
 *
 * Loaded on every app page (tests/unit/external-links.test.js checks); pages routed into the
 * app shell get it from app.html.
 */
(function (global) {
  'use strict';

  var EXTERNAL = /^(https?:|mailto:)/i;

  /** The preload's API: this page's, or for a same-origin app frame, the top page's. */
  function bridge(win) {
    try {
      if (win.electronAPI && typeof win.electronAPI.openExternal === 'function') return win.electronAPI;
    } catch (_e) { /* no access */ }
    try {
      var parent = win.parent;
      if (parent && parent !== win && parent.electronAPI && typeof parent.electronAPI.openExternal === 'function') {
        return parent.electronAPI;
      }
    } catch (_e) { /* a cross-origin parent: not ours */ }
    return null;
  }

  /** The target="_blank" link a click landed on, or null. */
  function blankLinkOf(target) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest('a[target="_blank"][href]');
  }

  /**
   * @param {MouseEvent} event
   * @param {Window} win
   * @returns {boolean} true when the link was handed to openExternal
   */
  function handleClick(event, win) {
    if (!event || event.isTrusted !== true || event.defaultPrevented) return false;
    var link = blankLinkOf(event.target);
    if (!link) return false;
    var href = String(link.href || '');
    if (!EXTERNAL.test(href)) return false;
    var api = bridge(win);
    if (!api) return false;
    event.preventDefault();
    var result = api.openExternal(href);
    if (result && typeof result.catch === 'function') result.catch(function () { /* refused: nothing opens */ });
    return true;
  }

  var exported = { handleClick: handleClick };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  if (global && global.document && !global.LanaExternalLinks) {
    global.LanaExternalLinks = exported;
    global.document.addEventListener('click', function (event) { handleClick(event, global); }, true);
  }
})(typeof window !== 'undefined' ? window : this);
