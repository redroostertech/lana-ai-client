/**
 * Settings V2: "Local AI service" card (local-ai-engine plan, phase 6).
 *
 * Shows the main process's engine status (running, port, organization server
 * reachable, data API versions), the "Use local AI engine" setting and a
 * restart button. All state comes from window.electronAPI.engine; the view
 * model is LanaEngineStatus.settingsView (src/js/engine-status.js).
 *
 * Phase 8d: "Run my background jobs on this computer when possible" and the
 * "Background jobs" status (running here, moved to the cloud, recent history
 * from the organization's server); view model LanaEngineBackgroundJobs
 * (src/js/engine-background-jobs.js).
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
    var bgToggle = document.getElementById('sv2-local-engine-bg-toggle');
    var jobsBadge = document.getElementById('sv2-local-engine-jobs-badge');
    var jobsList = document.getElementById('sv2-local-engine-jobs-list');
    var jobsEmpty = document.getElementById('sv2-local-engine-jobs-empty');
    var jobs = window.LanaEngineBackgroundJobs;
    var busy = false;
    var last = null;
    var lastJobs = null;
    var jobsTimer = null;

    function renderJobs(data) {
      if (!jobs || !jobsList) return;
      lastJobs = data;
      var view = jobs.jobsView(data, last);
      jobsBadge.setAttribute('label', view.summary);
      jobsBadge.setAttribute('color', view.tone);
      while (jobsList.firstChild) jobsList.removeChild(jobsList.firstChild);
      view.rows.forEach(function (row) {
        var item = document.createElement('div');
        item.className = 'sv2-local-engine-job';
        item.setAttribute('role', 'listitem');
        item.setAttribute('data-moved', row.movedToCloud ? 'true' : 'false');
        item.setAttribute('data-parked', row.parked ? 'true' : 'false');
        var copy = document.createElement('div');
        copy.className = 'sv2-local-engine-job-copy';
        var title = document.createElement('span');
        title.className = 'sv2-local-engine-job-title';
        title.textContent = row.title;
        var detail = document.createElement('span');
        detail.className = 'sv2-local-engine-job-detail';
        detail.textContent = row.detail;
        copy.appendChild(title);
        copy.appendChild(detail);
        if (row.link) {
          var link = document.createElement('a');
          link.className = 'sv2-local-engine-job-link';
          link.href = row.link.href;
          link.textContent = row.link.label;
          copy.appendChild(link);
        }
        var badgeEl = document.createElement('lex-badge');
        badgeEl.setAttribute('label', row.badge);
        badgeEl.setAttribute('color', row.tone);
        item.appendChild(copy);
        item.appendChild(badgeEl);
        jobsList.appendChild(item);
      });
      jobsEmpty.textContent = view.empty || '';
      jobsEmpty.hidden = !view.empty;
    }

    function refreshJobs() {
      if (!jobs || typeof engineApi.getBackgroundJobs !== 'function') return;
      if (!last || !last.inUse) { renderJobs(null); return; }
      engineApi.getBackgroundJobs().then(function (result) {
        renderJobs(result && result.success ? result.jobs : null);
      }).catch(function () { renderJobs(null); });
    }

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

      if (jobs && bgToggle) {
        var bg = jobs.toggleView(engineStatus);
        if (bg.checked) bgToggle.setAttribute('checked', '');
        else bgToggle.removeAttribute('checked');
        bgToggle.checked = bg.checked;
        if (bg.disabled || busy) bgToggle.setAttribute('disabled', '');
        else bgToggle.removeAttribute('disabled');
        renderJobs(lastJobs);
      }
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

    if (bgToggle && typeof engineApi.setBackgroundJobs === 'function') {
      bgToggle.addEventListener('lex-change', function (event) {
        var value = Boolean(event.detail && event.detail.value);
        run(function () { return engineApi.setBackgroundJobs(value); }, 'The setting could not be saved.').then(function () {
          if (last && last.backgroundJobs && last.backgroundJobs.enabled === value) {
            notify('success', value ? 'Your background jobs run on this computer when possible.' : 'Your background jobs run in your organization\'s cloud.');
          }
          refreshJobs();
        });
      });
    }

    restartBtn.addEventListener('click', function () {
      if (restartBtn.hasAttribute('disabled')) return;
      run(function () { return engineApi.restart(); }, 'The local AI service could not be restarted.');
    });

    if (typeof engineApi.onState === 'function') {
      engineApi.onState(function (engineStatus) { if (!busy) render(engineStatus); });
    }
    engineApi.getStatus().then(function (result) {
      if (result && result.success) render(result.status);
      refreshJobs();
      if (!jobsTimer) jobsTimer = setInterval(refreshJobs, 15000);
    }).catch(function () {
      section.setAttribute('aria-busy', 'false');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
