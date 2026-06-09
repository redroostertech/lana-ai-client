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
    myLoading: false,
    // Phase B: cached brainchild bridge status (degraded | linked | connected).
    // Refreshed only on explicit user action (link/re-link) or first My load.
    brainchildStatus: null
  };

  var els = {
    scopeToggle: document.getElementById('bcScopeToggle'),
    orgPanel: document.getElementById('bcOrgPanel'),
    orgTable: document.getElementById('bcOrgTable'),
    myPanel: document.getElementById('bcMyPanel'),
    myEmpty: document.getElementById('bcMyEmpty'),
    myTable: document.getElementById('bcMyTable'),
    myBanner: document.getElementById('bcMyBanner'),
    status: document.getElementById('bcStatus')
  };

  // Brainchild MCP bridge handle (exposed by electron-preload). Absent in a
  // plain browser context — every call is guarded so the page still renders.
  var brainchild = (window.electronAPI && window.electronAPI.brainchild) || null;

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

  // ---- My scope: Brainchild MCP bridge (Phase B) ---------------------------
  //
  // The renderer is presentation-only here. All node/spawn/MCP logic lives in
  // Electron main (src/electron-brainchild-manager.js) and is reached through
  // the contextIsolation-safe window.electronAPI.brainchild.* bridge. We fetch
  // notes via list_notes, shape them through the shared mapper, and fall back
  // to the connect/degraded states when the bridge reports it's not linked.

  // Read the user's vault note list over the MCP bridge. Returns the raw note
  // DTOs (path/title/...) — shaping is delegated to the mapper. On any failure
  // we return an empty array so the My panel degrades gently instead of crashing.
  async function fetchBrainchildNotes(/* scope */) {
    if (!brainchild) return [];
    try {
      var result = await brainchild.listNotes({});
      if (!result || result.success === false) return [];
      return Array.isArray(result.notes) ? result.notes : [];
    } catch (_error) {
      return [];
    }
  }

  // Refresh the cached bridge status (degraded | linked | connected). Cheap; does
  // not spawn the MCP server. Cached so renders/scrolls never re-poll the bridge.
  async function refreshBrainchildStatus() {
    if (!brainchild) {
      state.brainchildStatus = { status: 'degraded', reason: 'not_linked' };
      return state.brainchildStatus;
    }
    try {
      var result = await brainchild.status();
      state.brainchildStatus = (result && result.success !== false)
        ? result
        : { status: 'degraded', reason: 'not_linked' };
    } catch (_error) {
      state.brainchildStatus = { status: 'degraded', reason: 'unavailable' };
    }
    return state.brainchildStatus;
  }

  // Drive the My panel through the same mapper contract as Org. Notes are
  // fetched over the bridge, normalized, and either rendered or replaced by the
  // connect/degraded empty state.
  async function ensureMyLoaded() {
    if (state.myLoading) return;
    if (Array.isArray(state.myRows)) {
      renderMyPanel();
      return;
    }
    state.myLoading = true;
    try {
      await refreshBrainchildStatus();
      var linked = state.brainchildStatus && state.brainchildStatus.status !== 'degraded';
      var notes = linked ? await fetchBrainchildNotes('my') : [];
      state.myRows = mapper
        ? mapper.normalizeLibraryItems({ notes: notes }, 'my')
        : [];
      renderMyPanel();
    } finally {
      state.myLoading = false;
    }
  }

  // Map a degraded reason code to user-facing copy. No regex; plain lookup.
  function degradedCopy(reason) {
    if (reason === 'install_not_found') {
      return 'Brainchild was not found on this device. Re-link and choose your install folder.';
    }
    if (reason === 'vault_not_found') {
      return 'Your Brainchild vault could not be read. Re-link and choose the vault folder.';
    }
    if (reason === 'unavailable') {
      return 'The Brainchild bridge is unavailable. Re-link to reconnect.';
    }
    return 'Connect Brainchild to read your personal notes here.';
  }

  function renderMyBanner() {
    if (!els.myBanner) return;
    var status = state.brainchildStatus || {};
    var connected = status.status === 'connected' || status.status === 'linked';
    var hasRows = Array.isArray(state.myRows) && state.myRows.length > 0;

    // Connected + notes present: subtle confirmation banner.
    if (connected && hasRows) {
      els.myBanner.classList.remove('bc-hidden');
      els.myBanner.setAttribute('status', 'connected');
      els.myBanner.setAttribute('heading', 'Connected to Brainchild');
      if (status.vaultPath) {
        els.myBanner.setAttribute('subtitle', status.vaultPath);
      } else {
        els.myBanner.removeAttribute('subtitle');
      }
      return;
    }

    // Degraded after a link attempt: warn + offer re-link via the empty-state CTA.
    if (status.status === 'degraded' && status.reason && status.reason !== 'not_linked') {
      els.myBanner.classList.remove('bc-hidden');
      els.myBanner.setAttribute('status', 'warning');
      els.myBanner.setAttribute('heading', 'Brainchild connection issue');
      els.myBanner.setAttribute('subtitle', degradedCopy(status.reason));
      return;
    }

    els.myBanner.classList.add('bc-hidden');
  }

  function renderMyPanel() {
    var rows = Array.isArray(state.myRows) ? state.myRows : [];
    var hasRows = rows.length > 0;
    if (els.myTable && typeof els.myTable.setData === 'function') {
      els.myTable.setData(rows);
    }
    if (els.myTable) els.myTable.classList.toggle('bc-hidden', !hasRows);
    if (els.myEmpty) els.myEmpty.classList.toggle('bc-hidden', hasRows);
    renderMyBanner();
  }

  // ---- Read-only note preview ----------------------------------------------

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  // Find the source note (with _vaultPath) for a clicked row id.
  function findMyRow(rowId) {
    var rows = Array.isArray(state.myRows) ? state.myRows : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].id === rowId) return rows[i];
    }
    return null;
  }

  function buildPreviewHtml(note, vaultPath) {
    var safeBody = escapeHtml((note && note.body) || '');
    var meta = [];
    var fm = (note && note.frontmatter) || {};
    if (fm.date) meta.push('Date: ' + escapeHtml(fm.date));
    if (fm.type) meta.push('Type: ' + escapeHtml(fm.type));
    var metaLine = meta.length
      ? '<p class="bc-preview-meta">' + meta.join(' · ') + '</p>'
      : '';
    // Actions use the Lex button primitive (lex-btn) rather than raw,
    // bespoke-styled <button>s, per LEX-COMPONENT-RULES.md. lex-btn emits a
    // normal DOM 'click' we wire after the modal body is set.
    //
    // "Open in Brainchild" attempts the brainchild:// deep link, which only
    // works if the Brainchild app has registered the scheme. "Show in Finder"
    // is the always-available fallback (reveals the file in the OS file
    // manager) so the user is never stranded if the deep link no-ops.
    var safePath = escapeHtml(vaultPath);
    return '<div class="bc-preview">' +
      metaLine +
      '<pre class="bc-preview-body">' + safeBody + '</pre>' +
      '<div class="bc-preview-actions">' +
      '<lex-btn class="bc-reveal-note" variant="ghost" size="sm" ' +
      'data-vault-path="' + safePath + '">Show in Finder</lex-btn>' +
      '<lex-btn class="bc-open-brainchild" variant="primary" size="sm" ' +
      'data-vault-path="' + safePath + '">Open in Brainchild</lex-btn>' +
      '</div></div>';
  }

  // Write into the lex-modal's body slot rather than replacing the host element.
  // After Lex.Modal.open() the component has already rendered its chrome
  // (overlay/backdrop/panel/header/close button) into light DOM; reassigning
  // modal.innerHTML would wipe that chrome (and render() will not rebuild it
  // because _rendered is already true). Targeting the body keeps the modal a
  // real modal — positioning, backdrop, scroll-lock, and the close (X) button.
  // Guarded for null because the body may not be present on the first microtask.
  function setModalBody(modal, html) {
    if (!modal) return;
    var body = modal.querySelector('.lex-modal-body slot-content') ||
      modal.querySelector('.lex-modal-body') ||
      modal;
    body.innerHTML = html;
  }

  async function openNotePreview(row) {
    if (!row || !brainchild || !window.Lex || !window.Lex.Modal) return;
    var vaultPath = row._vaultPath || '';
    if (!vaultPath) return;

    var modal = window.Lex.Modal.open({
      heading: row.filename || 'Note',
      content: '<div class="bc-preview"><p class="bc-preview-meta">Loading…</p></div>',
      size: 'lg',
      hideActions: true
    });

    try {
      var result = await brainchild.getNote({ path: vaultPath });
      if (!result || result.success === false) {
        setModalBody(modal, '<div class="bc-preview"><p class="bc-preview-meta">' +
          'This note could not be read.</p></div>');
        return;
      }
      setModalBody(modal, buildPreviewHtml(result.note, vaultPath));
      var openBtn = modal.querySelector('.bc-open-brainchild');
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          if (brainchild.openNote) brainchild.openNote(vaultPath);
        });
      }
      var revealBtn = modal.querySelector('.bc-reveal-note');
      if (revealBtn) {
        revealBtn.addEventListener('click', function () {
          if (brainchild.revealNote) brainchild.revealNote(vaultPath);
        });
      }
    } catch (_error) {
      setModalBody(modal, '<div class="bc-preview"><p class="bc-preview-meta">' +
        'This note could not be read.</p></div>');
    }
  }

  function wireRowClick() {
    if (!els.myTable) return;
    els.myTable.addEventListener('row-click', function (event) {
      var detail = (event && event.detail) || {};
      var row = findMyRow(detail.id);
      if (row) openNotePreview(row);
    });
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

  // Persist a link and load the vault. Shared by the auto-discovery and the
  // manual folder-picker paths. Returns true on success.
  async function applyBrainchildLink(installPath, vaultPath) {
    var linked = await brainchild.link({ installPath: installPath, vaultPath: vaultPath });
    if (!linked || linked.success === false) {
      setStatus('Could not link Brainchild (' + ((linked && linked.error) || 'unknown') + ').');
      await refreshBrainchildStatus();
      renderMyBanner();
      return false;
    }
    setStatus('Connected to Brainchild. Loading your notes…');
    state.myRows = null;
    await ensureMyLoaded();
    setStatus('');
    return true;
  }

  // Manual re-link via native folder pickers (main-mediated). Used when
  // auto-discovery can't find a usable install + vault, so the "Re-link to point
  // at your install / vault folder" copy actually leads somewhere. No node/spawn
  // logic here — pickInstall/pickVault open native dialogs in Electron main.
  async function pickAndLinkBrainchild() {
    if (!brainchild || !brainchild.pickInstall || !brainchild.pickVault) {
      setStatus('Choosing a folder is only available in the desktop app.');
      return false;
    }
    setStatus('Choose your Brainchild install folder…');
    var install = await brainchild.pickInstall();
    if (!install || install.canceled) { setStatus(''); return false; }
    if (install.success === false) {
      setStatus('That folder does not contain Brainchild (bin/brainchild-mcp.js).');
      return false;
    }
    setStatus('Choose your Brainchild vault folder…');
    var vault = await brainchild.pickVault();
    if (!vault || vault.canceled) { setStatus(''); return false; }
    if (vault.success === false) {
      setStatus('Could not read that vault folder.');
      return false;
    }
    return applyBrainchildLink(install.installPath, vault.vaultPath);
  }

  // "Launch Brainchild" / "Re-link" CTA on the My-scope empty state. Runs the
  // one-time link flow: auto-discover install + vault from OS defaults, persist
  // the link in main, then load the vault. If discovery can't find both, fall
  // back to the native folder pickers so the user can point at their install /
  // vault. No node/spawn logic here — it's all in the Electron-main bridge; this
  // is presentation + light wiring only.
  async function startConnectBrainchild() {
    if (!brainchild) {
      setStatus('Brainchild is only available in the desktop app.');
      return;
    }
    setStatus('Looking for Brainchild on this device…');
    try {
      var found = await brainchild.discover();
      if (!found || !found.installPath || !found.vaultPath) {
        // Auto-discovery came up short — let the user point at the folders.
        setStatus('Could not find Brainchild automatically. Choose its folders to connect.');
        await pickAndLinkBrainchild();
        return;
      }
      await applyBrainchildLink(found.installPath, found.vaultPath);
    } catch (error) {
      setStatus('Could not connect to Brainchild: ' + (error && error.message ? error.message : 'unknown error'));
    }
  }

  // Unlink: forget the persisted link and stop the MCP child, then re-render the
  // My panel back to its connect prompt. Exposed for explicit re-link flows.
  async function unlinkBrainchild() {
    if (!brainchild || !brainchild.unlink) return;
    try {
      await brainchild.unlink();
    } catch (_error) { /* best-effort */ }
    state.myRows = null;
    state.brainchildStatus = { status: 'degraded', reason: 'not_linked' };
    renderMyPanel();
    setStatus('');
  }

  function wireConnectAction() {
    if (!els.myEmpty) return;
    els.myEmpty.addEventListener('action', startConnectBrainchild);
  }

  // ---- Init ----------------------------------------------------------------

  function init() {
    wireScopeToggle();
    wireConnectAction();
    wireRowClick();
    var initialScope = (els.scopeToggle && els.scopeToggle.value) || 'org';
    applyScope(initialScope);
  }

  init();

  // Exposed for manual debugging / future wiring (not business logic).
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
    refreshBrainchildStatus: refreshBrainchildStatus,
    startConnectBrainchild: startConnectBrainchild,
    pickAndLinkBrainchild: pickAndLinkBrainchild,
    unlinkBrainchild: unlinkBrainchild
  };
})();
