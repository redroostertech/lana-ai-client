/**
 * Settings V2: "Offline copy" card and the admin "Offline copies for your
 * organization" card (local AI engine plan, phase 10).
 *
 * The person's card reads the engine's GET /api/engine/v1/offline/status
 * (the API base is the local engine), and only while the engine is in use;
 * otherwise it says an offline copy needs the local AI service and asks
 * nothing (the organization's server has no such route): state, as of, what is on this computer,
 * changes waiting to sync, changes to review (keep mine or use theirs) and
 * changes the organization's server did not accept. The words come from
 * LanaOfflineCopy.settingsView (src/js/offline-copy-status.js).
 *
 * The admin card shows only for organization admins and flips the ops
 * setting offline_copies_enabled; the organization's server enforces who may
 * change it.
 */
(function () {
  'use strict';

  var STATUS_PATH = '/api/engine/v1/offline/status';
  var REFRESH_MS = 30000;

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function boot() {
    var section = document.getElementById('sv2-section-offline-copy');
    var model = window.LanaOfflineCopy;
    var api = window.api;
    if (!section || !model || !api) return;

    var badge = document.getElementById('sv2-offline-copy-badge');
    var message = document.getElementById('sv2-offline-copy-message');
    var rows = document.getElementById('sv2-offline-copy-rows');
    var conflicts = document.getElementById('sv2-offline-copy-conflicts');
    var refused = document.getElementById('sv2-offline-copy-refused');
    var syncBtn = document.getElementById('sv2-offline-copy-sync');
    var adminCard = document.getElementById('sv2-offline-copy-admin');
    var adminToggle = document.getElementById('sv2-offline-copy-admin-toggle');
    var adminDescription = document.getElementById('sv2-offline-copy-admin-description');

    function notify(kind, text) {
      if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast[kind] === 'function') window.Lex.Toast[kind](text);
    }

    function item(list, title, detail, actions) {
      var row = document.createElement('div');
      row.className = 'sv2-offline-copy-item';
      row.setAttribute('role', 'listitem');
      var copy = document.createElement('div');
      copy.className = 'sv2-offline-copy-item-copy';
      var t = document.createElement('span');
      t.className = 'sv2-offline-copy-item-title';
      t.textContent = title;
      var d = document.createElement('span');
      d.className = 'sv2-offline-copy-item-detail';
      d.textContent = detail;
      copy.appendChild(t);
      copy.appendChild(d);
      row.appendChild(copy);
      var buttons = document.createElement('div');
      buttons.className = 'sv2-offline-copy-item-actions';
      actions.forEach(function (action) {
        var btn = document.createElement('lex-btn');
        btn.setAttribute('variant', action.variant || 'ghost');
        btn.setAttribute('size', 'sm');
        btn.textContent = action.label;
        btn.addEventListener('click', action.run);
        buttons.appendChild(btn);
      });
      row.appendChild(buttons);
      list.appendChild(row);
    }

    function render(status) {
      var view = model.settingsView(status);
      model.lastStatus = status;
      section.hidden = false;
      section.setAttribute('aria-busy', 'false');
      badge.setAttribute('label', view.badge);
      badge.setAttribute('color', view.tone);
      message.textContent = view.message;
      message.setAttribute('data-tone', view.tone === 'red' ? 'red' : 'blue');
      message.hidden = !view.message;
      syncBtn.hidden = !view.available;
      clear(rows);
      view.rows.forEach(function (r) {
        var dt = document.createElement('dt');
        dt.textContent = r.label;
        var dd = document.createElement('dd');
        dd.textContent = r.value;
        rows.appendChild(dt);
        rows.appendChild(dd);
      });
      clear(conflicts);
      if (view.conflicts.length) {
        var head = document.createElement('p');
        head.className = 'sv2-offline-copy-list-head';
        head.textContent = 'Changes to review';
        conflicts.appendChild(head);
      }
      view.conflicts.forEach(function (c) {
        item(conflicts, c.title, c.detail + ' Yours: "' + c.mine + '". Server: "' + c.theirs + '".', [
          { label: 'Keep mine', variant: 'primary', run: function () { resolve(c.opId, 'mine'); } },
          { label: 'Use theirs', run: function () { resolve(c.opId, 'theirs'); } }
        ]);
      });
      conflicts.hidden = view.conflicts.length === 0;
      clear(refused);
      if (view.refused.length) {
        var refusedHead = document.createElement('p');
        refusedHead.className = 'sv2-offline-copy-list-head';
        refusedHead.textContent = 'Changes not saved';
        refused.appendChild(refusedHead);
      }
      view.refused.forEach(function (r) {
        item(refused, r.title, r.detail, [{ label: 'Dismiss', run: function () { dismiss(r.opId); } }]);
      });
      refused.hidden = view.refused.length === 0;
    }

    var engineApi = window.electronAPI && window.electronAPI.engine;
    var engineInUse = false;

    function refresh() {
      if (!engineInUse) {
        render(null);
        return Promise.resolve();
      }
      return api.get(STATUS_PATH).then(render).catch(function () { render(null); });
    }

    function resolve(opId, choice) {
      api.post('/api/engine/v1/offline/conflicts/' + encodeURIComponent(opId), { choice: choice }).then(function () {
        notify('success', choice === 'mine' ? 'Your change will be saved at the next sync.' : 'The server\'s version is kept.');
        return refresh();
      }).catch(function () { notify('error', 'The change could not be resolved. Try again.'); });
    }

    function dismiss(opId) {
      api.post('/api/engine/v1/offline/refused/' + encodeURIComponent(opId) + '/dismiss', {}).then(refresh).catch(function () {});
    }

    syncBtn.addEventListener('click', function () {
      badge.setAttribute('label', 'Syncing');
      badge.setAttribute('color', 'blue');
      api.post('/api/engine/v1/offline/sync', {}).then(render).catch(function () {
        notify('error', 'The offline copy could not sync right now.');
        refresh();
      });
    });

    function bootAdmin() {
      var isAdmin = window.Lex && window.Lex.Auth && typeof window.Lex.Auth.isAdmin === 'function' && window.Lex.Auth.isAdmin();
      if (!adminCard || !isAdmin) return;
      api.get('/api/v1/offline-copies').then(function (overview) {
        var view = model.adminView(overview);
        adminCard.hidden = false;
        adminDescription.textContent = view.description;
        if (view.enabled) adminToggle.setAttribute('checked', ''); else adminToggle.removeAttribute('checked');
        adminToggle.checked = view.enabled;
      }).catch(function () { adminCard.hidden = true; });
      adminToggle.addEventListener('lex-change', function (event) {
        var enabled = Boolean(event.detail && event.detail.value);
        api.put('/api/v1/settings/ops/offline_copies_enabled', { settings_value: { enabled: enabled } }).then(function () {
          adminDescription.textContent = model.adminView({ enabled: enabled }).description;
          notify('success', enabled ? 'Offline copies are on for your organization.' : 'Offline copies are off. Computers remove their copies at their next sync.');
        }).catch(function () {
          notify('error', 'The setting could not be saved.');
        });
      });
    }

    if (engineApi && typeof engineApi.onState === 'function') {
      engineApi.onState(function (status) {
        var now = model.engineInUse(status);
        if (now === engineInUse) return;
        engineInUse = now;
        refresh();
      });
    }
    var engineRead = engineApi && typeof engineApi.getStatus === 'function'
      ? engineApi.getStatus().then(function (result) { engineInUse = model.engineInUse(result); }, function () {})
      : Promise.resolve();
    engineRead.then(refresh);
    bootAdmin();
    setInterval(function () { if (!document.hidden && engineInUse) refresh(); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
