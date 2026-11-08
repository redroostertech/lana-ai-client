/**
 * Settings > Profile > Active sessions.
 *
 *   GET    /api/v1/auth/session?status=active   this account's signed-in devices; the server
 *                                              names each one and marks this computer's (is_current)
 *   DELETE /api/v1/auth/session                 signs out every other device
 *   POST   /api/v1/auth/logout (api.logout)     then this computer, back to sign-in
 *
 * Wording and order come from settings-sessions.model.js (window.LanaSettingsSessions).
 */
(function () {
  'use strict';

  var M = window.LanaSettingsSessions;
  var busy = false;

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(text, isError) {
    var status = el('sv2-sessions-status');
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('sv2-sessions-error', Boolean(isError));
  }

  function timeZone() {
    var select = el('sv2-timezone-select');
    return (select && select.value) || undefined;
  }

  function iconMarkup(name) {
    try {
      return window.Lex && window.Lex.Icons ? window.Lex.Icons.get({ name: name, size: 'small' }) : '';
    } catch (_) {
      return '';
    }
  }

  function row(session, now) {
    var item = document.createElement('li');
    item.className = 'sv2-sessions-row';

    var icon = document.createElement('span');
    icon.className = 'sv2-sessions-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconMarkup(M.icon(session));

    var copy = document.createElement('div');
    copy.className = 'sv2-sessions-copy';
    var head = document.createElement('div');
    head.className = 'sv2-sessions-head';
    var name = document.createElement('span');
    name.className = 'sv2-sessions-name';
    name.textContent = M.title(session);
    head.appendChild(name);
    if (session.is_current) {
      var badge = document.createElement('lex-badge');
      badge.setAttribute('label', 'This computer');
      badge.setAttribute('color', 'green');
      badge.setAttribute('size', 'sm');
      head.appendChild(badge);
    }
    var details = document.createElement('span');
    details.className = 'sv2-sessions-details';
    details.textContent = M.details(session, now, timeZone());

    copy.appendChild(head);
    copy.appendChild(details);
    item.appendChild(icon);
    item.appendChild(copy);
    return item;
  }

  function render(sessions) {
    var list = el('sv2-sessions-list');
    if (!list) return;
    var rows = M.sorted(sessions);
    var now = new Date();
    list.innerHTML = '';
    rows.forEach(function (session) { list.appendChild(row(session, now)); });
    setStatus(M.summary(rows.length));
  }

  function load() {
    var api = window.api;
    if (!api || typeof api.get !== 'function') return Promise.resolve();
    return api.get('/api/v1/auth/session?status=active&limit=100&sortBy=last_accessed').then(function (result) {
      var data = result && (result.data || result);
      render(Array.isArray(data) ? data : (data && data.sessions) || []);
    }).catch(function () {
      var list = el('sv2-sessions-list');
      if (list) list.innerHTML = '';
      setStatus('LANA could not load your sessions. Try again later.', true);
    });
  }

  function toast(kind, text) {
    if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast[kind] === 'function') window.Lex.Toast[kind](text);
  }

  async function signOutEverywhere() {
    var api = window.api;
    if (busy || !api) return;
    var modal = window.Lex && window.Lex.Modal;
    var ok = modal && typeof modal.confirmAsync === 'function'
      ? await modal.confirmAsync('Sign out of all devices?', 'Every device signed in to your account is signed out, including this computer. You will need to sign in again on each one.', {
        confirmText: 'Sign out everywhere',
        cancelText: 'Cancel',
        variant: 'danger'
      })
      : false;
    if (!ok) return;

    busy = true;
    var button = el('sv2-sessions-signout-all');
    if (button) button.loading = true;
    try {
      // With no body the server keeps the session making the request; api.logout ends it next.
      await api.delete('/api/v1/auth/session', {});
    } catch (_) {
      busy = false;
      if (button) button.loading = false;
      toast('error', 'LANA could not sign out your other devices. Try again.');
      return;
    }
    var outcome = await api.logout().catch(function () { return { cancelled: false }; });
    if (outcome && outcome.cancelled) {
      // Other devices are already signed out; this computer stays, at the person's choice.
      busy = false;
      if (button) button.loading = false;
      toast('success', 'Your other devices are signed out.');
      load();
      return;
    }
    window.location.href = 'login.html';
  }

  function boot() {
    if (!M || !el('sv2-section-sessions')) return;
    var button = el('sv2-sessions-signout-all');
    if (button) button.addEventListener('click', signOutEverywhere);
    document.addEventListener('lex-refresh', load);
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
