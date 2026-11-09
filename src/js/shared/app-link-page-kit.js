/* app-link-page-kit.js - the browser glue the app-link pages share
   (accept-invite.html, activate.html, shared-link.html).

   Light or dark as the computer is set, the firm this app is connected to,
   a POST to that firm's public auth endpoints, and the password rules list.
   The words and decisions live in app-link-pages.model.js.

   Rules (LEX-COMPONENT-RULES.md): IIFE, text through textContent and
   attributes only. */

(function (global) {
  'use strict';

  var dark = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function theme() { return dark && dark.matches ? 'dark' : 'light'; }

  function applyTheme() {
    document.documentElement.setAttribute('data-lex-theme', theme());
    document.querySelectorAll('lex-brand-mark').forEach(function (mark) {
      if (mark.variant !== theme()) mark.variant = theme();
    });
  }

  function watchTheme() {
    applyTheme();
    if (dark && dark.addEventListener) dark.addEventListener('change', applyTheme);
  }

  /** The firm this app is connected to, or null. url is the API base. */
  function savedServer() {
    if (!global.electronAPI || typeof global.electronAPI.getSavedServer !== 'function') {
      return Promise.resolve(null);
    }
    return global.electronAPI.getSavedServer().then(function (result) {
      return result && result.success && result.server && result.server.url ? result.server : null;
    }).catch(function () { return null; });
  }

  /**
   * POST JSON and read JSON or problem+json back. Rejects with
   * { status, data } on any failure (status 0 when the firm is unreachable).
   */
  function postJson(url, body, headers) {
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json, application/problem+json' }, headers || {}),
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : {}; } catch (_e) { data = null; }
        if (!response.ok) throw { status: response.status, data: data };
        return data || {};
      });
    }, function () {
      throw { status: 0, data: null };
    });
  }

  /**
   * POST to one of the firm's public auth endpoints. Not through api.js: a
   * refused code is not a signed-out session, so it must not open the
   * session-expired dialog.
   */
  function postPublic(server, path, body) {
    if (!server || !server.url) return Promise.reject({ status: 0, data: null });
    return postJson(server.url + path, body);
  }

  /** A new <lex-text> carrying text (children are read when it upgrades). */
  function lexText(attrs, text) {
    var line = document.createElement('lex-text');
    Object.keys(attrs).forEach(function (name) { line.setAttribute(name, attrs[name]); });
    line.textContent = text;
    return line;
  }

  /** Replace a container's content with one Lex text line. */
  function textInto(id, attrs, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    if (text) el.appendChild(lexText(attrs, text));
  }

  /** Render the password rules as Lex text lines with a met / not met icon. */
  function renderRules(id, rules) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = '';
    rules.forEach(function (rule) {
      el.appendChild(lexText({
        tag: 'div',
        size: 'body-sm',
        variant: rule.met ? 'success' : 'secondary',
        icon: rule.met ? 'check-circle' : 'circle'
      }, rule.label));
    });
  }

  function fieldValue(id) {
    var el = document.getElementById(id);
    return el && el.value != null ? String(el.value) : '';
  }

  function show(id, visible) {
    var el = document.getElementById(id);
    if (el) el.hidden = !visible;
  }

  /** A plain error line under a form, or nothing. */
  function showError(id, message) {
    textInto(id, { tag: 'div', size: 'body-sm', variant: 'danger', icon: 'alert-circle' }, message || '');
    show(id, Boolean(message));
  }

  function setBusy(id, busy) {
    var el = document.getElementById(id);
    if (el) el.loading = Boolean(busy);
  }

  global.AppLinkPageKit = {
    watchTheme: watchTheme,
    savedServer: savedServer,
    postJson: postJson,
    postPublic: postPublic,
    lexText: lexText,
    textInto: textInto,
    renderRules: renderRules,
    fieldValue: fieldValue,
    show: show,
    showError: showError,
    setBusy: setBusy
  };
})(window);
