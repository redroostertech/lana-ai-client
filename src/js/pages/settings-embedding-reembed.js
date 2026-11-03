/**
 * Settings V2: "Search re-indexing for your organization" card (local AI
 * engine plan, phase 8k). Organization admins only; the organization's
 * server enforces that (GET /api/v1/admin/embedding-reembed is requireAdmin).
 * The words come from LanaEmbeddingReembed.reembedView
 * (src/js/embedding-reembed-status.js).
 */
(function () {
  'use strict';

  var STATUS_PATH = '/api/v1/admin/embedding-reembed';
  var REFRESH_MS = 30000;

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function boot() {
    var section = document.getElementById('sv2-section-reembed');
    var model = window.LanaEmbeddingReembed;
    var api = window.api;
    var isAdmin = window.Lex && window.Lex.Auth && typeof window.Lex.Auth.isAdmin === 'function' && window.Lex.Auth.isAdmin();
    if (!section || !model || !api || !isAdmin) return;

    var badge = document.getElementById('sv2-reembed-badge');
    var bar = document.getElementById('sv2-reembed-bar');
    var rows = document.getElementById('sv2-reembed-rows');
    var excluded = document.getElementById('sv2-reembed-excluded');
    var excludedTitle = document.getElementById('sv2-reembed-excluded-title');
    var excludedReason = document.getElementById('sv2-reembed-excluded-reason');
    var error = document.getElementById('sv2-reembed-error');
    var errorLabel = document.getElementById('sv2-reembed-error-label');
    var errorWhen = document.getElementById('sv2-reembed-error-when');
    var note = document.getElementById('sv2-reembed-note');

    function render(body) {
      var view = model.reembedView(body);
      section.hidden = false;
      section.setAttribute('aria-busy', 'false');
      badge.setAttribute('label', view.badge);
      badge.setAttribute('color', view.tone);
      bar.hidden = view.percent === null;
      if (view.percent !== null) {
        bar.setAttribute('value', String(view.percent));
        bar.setAttribute('color', view.state === 'completed' ? 'success' : 'accent');
      }
      clear(rows);
      view.rows.forEach(function (r) {
        var dt = document.createElement('dt');
        dt.textContent = r.label;
        var dd = document.createElement('dd');
        dd.textContent = r.value;
        rows.appendChild(dt);
        rows.appendChild(dd);
      });
      rows.hidden = view.rows.length === 0;
      excluded.hidden = !view.excluded;
      if (view.excluded) {
        excludedTitle.textContent = view.excluded.title;
        excludedReason.textContent = view.excluded.reason;
      }
      error.hidden = !view.error;
      if (view.error) {
        errorLabel.textContent = view.error.label;
        errorWhen.textContent = view.error.when ? 'Last problem, ' + view.error.when : 'Last problem';
      }
      note.textContent = view.note;
      note.hidden = !view.note;
    }

    function refresh() {
      return api.get(STATUS_PATH).then(render).catch(function () { render(null); });
    }

    refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
