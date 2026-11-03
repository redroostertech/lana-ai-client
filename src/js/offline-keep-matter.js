/**
 * "Keep this matter offline" (local AI engine plan, phase 10d, decision O6).
 *
 * A Lex toggle on the matter page header, on the desktop app with the local
 * AI engine only (offline copies live there). The organization's server
 * decides everything: the person's own choice is stored there
 * (/api/v1/offline-copies/matters/:id/keep) and it only keeps the matter in
 * their own copy while they can read it. Offline, the switch shows the
 * copy's state and a change is refused with a labelled message.
 */
(function (global) {
  'use strict';

  var LABEL = 'Keep this matter offline';

  function path(matterId) {
    return '/api/v1/offline-copies/matters/' + encodeURIComponent(matterId) + '/keep';
  }

  function toast(kind, message) {
    var t = global.Lex && global.Lex.Toast;
    if (t && typeof t[kind] === 'function') t[kind](message);
  }

  /**
   * @param {HTMLElement} host - where the switch goes
   * @param {string} matterId
   * @param {Object} client - the API client (get, put, delete)
   */
  function mount(host, matterId, client) {
    if (!host || !matterId || !client || !(global.electronAPI && global.electronAPI.engine)) return null;
    var existing = host.querySelector('lex-toggle.lana-keep-offline');
    if (existing) existing.remove();
    var toggle = global.document.createElement('lex-toggle');
    toggle.className = 'lana-keep-offline';
    toggle.setAttribute('label', LABEL);
    toggle.setAttribute('size', 'sm');
    toggle.setAttribute('label-side', 'left');
    toggle.hidden = true;
    host.appendChild(toggle);

    client.get(path(matterId)).then(function (state) {
      toggle.checked = Boolean(state && state.kept_offline);
      toggle.hidden = false;
    }).catch(function () { /* not available here: leave it hidden */ });

    toggle.addEventListener('lex-change', function (event) {
      var want = Boolean(event.detail && event.detail.value);
      var call = want ? client.put(path(matterId), {}) : client.delete(path(matterId));
      call.then(function () {
        toast('success', want ? 'This matter stays in your offline copy from the next sync.' : 'This matter is no longer kept offline.');
      }).catch(function (error) {
        toggle.checked = !want;
        toast('error', (error && error.message) || 'That could not be changed right now.');
      });
    });
    return toggle;
  }

  var api = { mount: mount, LABEL: LABEL };
  global.LanaOfflineKeep = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
