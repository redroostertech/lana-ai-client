/*
 * Brainchild surface controller (Slice A).
 *
 * Thin client: presentation + light wiring only. Row normalization is delegated
 * to the shared, pure window.DocumentLibraryMapper module so doc-studio and this
 * page stay on one contract. The Org scope reuses the existing storage +
 * deck-studio endpoints (same query params as doc-studio's loadLibrary, to keep
 * row ordering consistent). The My scope is a stubbed "connect Brainchild" empty
 * state until the loopback vault bridge lands in Slice B.
 */
(function () {
  'use strict';

  var mapper = window.DocumentLibraryMapper || null;

  var state = {
    scope: 'org',
    orgRows: null,
    orgLoading: false,
    myRows: null,
    myLoading: false
  };

  var els = {
    scopeToggle: document.getElementById('bcScopeToggle'),
    orgPanel: document.getElementById('bcOrgPanel'),
    orgTable: document.getElementById('bcOrgTable'),
    myPanel: document.getElementById('bcMyPanel'),
    myEmpty: document.getElementById('bcMyEmpty'),
    myTable: document.getElementById('bcMyTable'),
    status: document.getElementById('bcStatus')
  };

  // ---- Config / fetch wiring (mirrors doc-studio's apiFetch) ----------------
  //
  // FOLLOW-UP (tech debt): this base-URL/token/apiFetch block is duplicated from
  // src/doc-studio/app.js. A shared client API layer already exists at
  // src/js/api.js. Before a third page copies this, extract a single shared
  // helper under src/js/shared/ (or adopt src/js/api.js) and have doc-studio +
  // brainchild both consume it. Kept inline here only to avoid a cross-page
  // refactor inside this Slice A change.

  function savedServerUrl() {
    try {
      var saved = JSON.parse(localStorage.getItem('lana_saved_server') || 'null');
      return saved && typeof saved.url === 'string' ? saved.url.trim() : '';
    } catch (_error) {
      return '';
    }
  }

  function trimTrailingSlashes(value) {
    var out = String(value || '');
    while (out.length && out.charAt(out.length - 1) === '/') {
      out = out.slice(0, -1);
    }
    return out;
  }

  var API_BASE_URL = (function () {
    var configured = window.LanaConfig && typeof window.LanaConfig.API_BASE_URL === 'string'
      ? window.LanaConfig.API_BASE_URL.trim()
      : '';
    if (configured) return trimTrailingSlashes(configured);
    if (window.location.protocol === 'file:') {
      return trimTrailingSlashes(savedServerUrl() || 'http://localhost:8080');
    }
    return '';
  })();

  function apiUrl(path) {
    if (!path) return API_BASE_URL || '';
    if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
    var normalized = path.charAt(0) === '/' ? path : '/' + path;
    return API_BASE_URL + normalized;
  }

  function authToken() {
    try {
      return localStorage.getItem('token') || '';
    } catch (_error) {
      return '';
    }
  }

  function apiFetch(path, options) {
    var opts = options || {};
    var headers = new Headers(opts.headers || {});
    var token = authToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }
    var merged = {};
    for (var key in opts) {
      if (Object.prototype.hasOwnProperty.call(opts, key)) merged[key] = opts[key];
    }
    merged.headers = headers;
    return fetch(apiUrl(path), merged);
  }

  function setStatus(message) {
    if (els.status) els.status.textContent = message || '';
  }

  // ---- Org scope: reuse the Library data layer -----------------------------

  async function loadOrgLibrary() {
    var errors = [];
    var presentations = [];
    var documents = [];

    try {
      var presResponse = await apiFetch('/api/v1/deck-studio/presentations?limit=100');
      if (!presResponse.ok) throw new Error('Request failed with ' + presResponse.status);
      var presPayload = await presResponse.json();
      presentations = Array.isArray(presPayload.presentations) ? presPayload.presentations : [];
    } catch (error) {
      errors.push('Doc Studio files: ' + error.message);
    }

    try {
      var docResponse = await apiFetch('/api/v1/storage/documents?page_size=200&sort_by=updated_at&sort_order=desc');
      if (!docResponse.ok) throw new Error('Request failed with ' + docResponse.status);
      var docPayload = await docResponse.json();
      documents = Array.isArray(docPayload.documents)
        ? docPayload.documents
        : (Array.isArray(docPayload.files) ? docPayload.files : []);
    } catch (error) {
      errors.push('stored documents: ' + error.message);
    }

    var rows = mapper
      ? mapper.normalizeLibraryItems({ documents: documents, presentations: presentations }, 'org')
      : [];

    state.orgRows = rows;

    if (errors.length) {
      setStatus('Library loaded with limited sources (' + errors.join('; ') + ').');
    } else {
      setStatus('');
    }
    return rows;
  }

  function renderOrgTable() {
    if (!els.orgTable || typeof els.orgTable.setData !== 'function') return;
    els.orgTable.setData(Array.isArray(state.orgRows) ? state.orgRows : []);
  }

  async function ensureOrgLoaded() {
    if (state.orgLoading) return;
    if (Array.isArray(state.orgRows)) {
      renderOrgTable();
      return;
    }
    state.orgLoading = true;
    setStatus('Loading organization documents…');
    try {
      await loadOrgLibrary();
      renderOrgTable();
    } finally {
      state.orgLoading = false;
    }
  }

  // ---- My scope: stubbed loopback (Slice B) --------------------------------

  // Slice B will call the local Brainchild loopback API here. For Slice A this
  // returns no notes so the "Connect Brainchild" empty state is shown.
  async function fetchBrainchildNotes(/* scope */) {
    // TODO (Slice B): read the local Brainchild vault over the loopback bridge.
    return [];
  }

  // Drive the My panel through the same mapper contract as Org so the Slice B
  // seam is real: notes are fetched, normalized, and either rendered or fall
  // back to the static "Connect Brainchild" empty state. No business logic —
  // the loopback source of truth lives in the Brainchild app / backend.
  async function ensureMyLoaded() {
    if (state.myLoading) return;
    if (Array.isArray(state.myRows)) {
      renderMyPanel();
      return;
    }
    state.myLoading = true;
    try {
      var notes = await fetchBrainchildNotes('my');
      state.myRows = mapper
        ? mapper.normalizeLibraryItems({ notes: notes }, 'my')
        : [];
      renderMyPanel();
    } finally {
      state.myLoading = false;
    }
  }

  function renderMyPanel() {
    var rows = Array.isArray(state.myRows) ? state.myRows : [];
    var hasRows = rows.length > 0;
    // When the loopback bridge returns notes (Slice B), render them in the
    // table and hide the "Connect Brainchild" prompt. With no notes yet, the
    // table stays hidden and the static empty state offers the connect CTA.
    if (els.myTable && typeof els.myTable.setData === 'function') {
      els.myTable.setData(rows);
    }
    if (els.myTable) els.myTable.classList.toggle('bc-hidden', !hasRows);
    if (els.myEmpty) els.myEmpty.classList.toggle('bc-hidden', hasRows);
  }

  // ---- Scope switching -----------------------------------------------------

  function applyScope(scope) {
    var resolved = scope === 'my' ? 'my' : 'org';
    state.scope = resolved;

    if (els.orgPanel) els.orgPanel.classList.toggle('bc-hidden', resolved !== 'org');
    if (els.myPanel) els.myPanel.classList.toggle('bc-hidden', resolved !== 'my');

    if (resolved === 'org') {
      ensureOrgLoaded();
    } else {
      setStatus('');
      ensureMyLoaded();
    }
  }

  function wireScopeToggle() {
    if (!els.scopeToggle) return;
    els.scopeToggle.addEventListener('lex-change', function (event) {
      var detail = event && event.detail ? event.detail : {};
      applyScope(detail.value);
    });
  }

  // "Launch Brainchild" CTA on the My-scope empty state. Slice B replaces this
  // with the real loopback connect handshake; for now it re-triggers a load so
  // the seam is wired and discoverable. No business logic lives here — the
  // connect/source-of-truth flow belongs to the Brainchild app / bridge.
  function startConnectBrainchild() {
    setStatus('Looking for Brainchild on this device…');
    state.myRows = null;
    ensureMyLoaded();
  }

  function wireConnectAction() {
    if (!els.myEmpty) return;
    els.myEmpty.addEventListener('action', startConnectBrainchild);
  }

  // ---- Init ----------------------------------------------------------------

  function init() {
    wireScopeToggle();
    wireConnectAction();
    var initialScope = (els.scopeToggle && els.scopeToggle.value) || 'org';
    applyScope(initialScope);
  }

  init();

  // Exposed for manual debugging / future Slice B wiring (not business logic).
  window.LanaBrainchild = {
    state: state,
    reloadOrg: function () {
      state.orgRows = null;
      return ensureOrgLoaded();
    },
    reloadMy: function () {
      state.myRows = null;
      return ensureMyLoaded();
    },
    fetchBrainchildNotes: fetchBrainchildNotes,
    startConnectBrainchild: startConnectBrainchild
  };
})();
