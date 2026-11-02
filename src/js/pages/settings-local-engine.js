/**
 * Settings V2: "Local AI service" card (local-ai-engine plan, phase 6).
 *
 * Shows the main process's engine status (running, port, organization server
 * reachable, data API versions), the "Use local AI engine" setting and a
 * restart button. All state comes from window.electronAPI.engine; the view
 * model is LanaEngineStatus.settingsView (src/js/engine-status.js).
 */
(function () {
  'use strict';

  function boot() {
    var section = document.getElementById('sv2-section-local-engine');
    var engineApi = window.electronAPI && window.electronAPI.engine;
    var status = window.LanaEngineStatus;
    if (!section || !engineApi || !status) return;

    var badge = document.getElementById('sv2-local-engine-badge');
    var message = document.getElementById('sv2-local-engine-message');
    var rows = document.getElementById('sv2-local-engine-rows');
    var toggle = document.getElementById('sv2-local-engine-toggle');
    var restartBtn = document.getElementById('sv2-local-engine-restart');
    var note = document.getElementById('sv2-local-engine-note');
    var busy = false;
    var last = null;

    function notify(kind, text) {
      if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast[kind] === 'function') window.Lex.Toast[kind](text);
    }

    function render(engineStatus) {
      last = engineStatus;
      var view = status.settingsView(engineStatus);
      section.hidden = false;
      section.setAttribute('aria-busy', 'false');

      badge.setAttribute('label', view.statusLabel);
      badge.setAttribute('color', view.tone);

      if (view.message) {
        message.textContent = view.message;
        message.setAttribute('data-tone', view.tone);
        message.hidden = false;
      } else {
        message.textContent = '';
        message.hidden = true;
      }

      while (rows.firstChild) rows.removeChild(rows.firstChild);
      view.rows.forEach(function (row) {
        var kv = document.createElement('lex-kv');
        kv.setAttribute('label', row.label);
        kv.setAttribute('value', row.value);
        kv.setAttribute('direction', 'horizontal');
        rows.appendChild(kv);
      });

      note.textContent = view.note || '';

      var enabled = Boolean(engineStatus && engineStatus.enabled);
      if (enabled) toggle.setAttribute('checked', '');
      else toggle.removeAttribute('checked');
      toggle.checked = enabled;
      var canToggle = Boolean(engineStatus && engineStatus.configured) && !busy;
      if (canToggle) toggle.removeAttribute('disabled');
      else toggle.setAttribute('disabled', '');

      var canRestart = Boolean(engineStatus && engineStatus.inUse) && !busy;
      if (canRestart) restartBtn.removeAttribute('disabled');
      else restartBtn.setAttribute('disabled', '');
    }

    function run(action, failure) {
      busy = true;
      render(last);
      return action().then(function (result) {
        if (!result || result.success !== true) throw new Error(result && result.error ? result.error : failure);
        busy = false;
        render(result.status);
      }).catch(function (error) {
        busy = false;
        render(last);
        notify('error', error.message || failure);
      });
    }

    toggle.addEventListener('lex-change', function (event) {
      var value = Boolean(event.detail && event.detail.value);
      run(function () { return engineApi.setEnabled(value); }, 'The setting could not be saved.').then(function () {
        if (last && last.enabled === value) {
          notify('success', value ? 'LANA now uses the local AI service.' : 'LANA now talks to your organization\'s server directly.');
        }
      });
    });

    restartBtn.addEventListener('click', function () {
      if (restartBtn.hasAttribute('disabled')) return;
      run(function () { return engineApi.restart(); }, 'The local AI service could not be restarted.');
    });

    if (typeof engineApi.onState === 'function') {
      engineApi.onState(function (engineStatus) { if (!busy) render(engineStatus); });
    }
    engineApi.getStatus().then(function (result) {
      if (result && result.success) render(result.status);
    }).catch(function () {
      section.setAttribute('aria-busy', 'false');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
