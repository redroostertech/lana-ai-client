/* Document Library Templates — unified template list/picker controller (C3).

   Renders the unified read model that lists templates across the three engines
   (fill / compose / render) from a single endpoint. Read-only for v1.

   Rules:
     - NO regex anywhere — string methods only (LEX-COMPONENT-RULES section 11)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - IIFE wrapper to keep scope clean
     - Thin: query building + DTO->view-model mapping live in the pure mapper
       module (document-studio-templates-mapper.js); backend rules stay server-side.

   @requires api.js                              — window.api
   @requires document-studio-api.js              — window.DocumentStudioAPI
   @requires document-studio-templates-mapper.js — window.DocumentStudioTemplatesMapper
   @requires lex.utils.js                        — Lex.Utils.escapeHtml / timeAgo
   @requires lex-toast.js                        — Lex.Toast
   @requires lex-pagination / lex-segmented / lex-drawer components
*/

(function () {
  'use strict';

  // ===========================================================================
  // Lex aliases
  // ===========================================================================

  var escHtml = Lex.Utils.escapeHtml;
  var timeAgo = Lex.Utils.timeAgo;

  var DocStudioAPI = window.DocumentStudioAPI;
  var mapper = window.DocumentStudioTemplatesMapper;

  // ===========================================================================
  // Shared helpers
  // ===========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    try {
      return timeAgo(value);
    } catch (e) {
      return String(value);
    }
  }

  function _showAccessDenied() {
    var message = 'You do not have access to this template.';
    if (window.Lex && Lex.Modal && typeof Lex.Modal.alert === 'function') {
      Lex.Modal.alert('Access denied', message, {
        confirmText: 'Close'
      });
      return;
    }
    if (window.Lex && Lex.Toast && typeof Lex.Toast.error === 'function') {
      Lex.Toast.error(message);
    }
  }

  // ===========================================================================
  // Renderers (string-built, escaped)
  // ===========================================================================

  /**
   * Kind badge HTML string.
   * @param {string} kind — fill | compose | render
   * @param {string} label
   * @returns {string}
   */
  function kindBadge(kind, label) {
    var k = String(kind || '').toLowerCase();
    return '<span class="dst-kind dst-kind-' + escHtml(k) + '">' + escHtml(label || k) + '</span>';
  }

  // The list mirrors the Document Library's table styling exactly (same CSS
  // classes from document-library.css, same icon hydration convention), so the
  // two library pages read as one product surface.

  function icon(name) {
    if (window.Lex && Lex.Icons && typeof Lex.Icons.get === 'function') {
      return Lex.Icons.get({ name: name, size: 'small' });
    }
    return '';
  }

  function hydrateIcons(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-document-library-icon]');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].innerHTML = icon(nodes[i].getAttribute('data-document-library-icon'));
    }
  }

  function relativeTime(value) {
    if (!value) return '';
    if (window.LanaTime && typeof LanaTime.timeAgo === 'function') {
      return LanaTime.timeAgo(value, { style: 'words' });
    }
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function absoluteTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function extensionFromName(name) {
    var value = String(name || '');
    var lastDot = value.lastIndexOf('.');
    return lastDot > 0 && lastDot < value.length - 1 ? value.slice(lastDot + 1).toLowerCase() : '';
  }

  /** Icon tile + tone per row, matching Document Library's file presentation. */
  function templatePresentation(row) {
    if (row.kind === 'fill') {
      var mime = String(row.contentType || '').toLowerCase();
      var ext = extensionFromName(row.name);
      if (mime.indexOf('pdf') !== -1 || ext === 'pdf') {
        return { icon: 'file-text', tone: 'pdf', label: 'PDF' };
      }
      return { icon: 'file-text', tone: 'document', label: ext ? ext.toUpperCase() : 'Document' };
    }
    if (row.kind === 'compose') {
      return { icon: 'file', tone: 'file', label: 'Document set' };
    }
    return { icon: 'monitor', tone: 'slides', label: 'Layout' };
  }

  function workspaceCellHtml(row) {
    if (row.scope === 'org') {
      return '<span class="document-library-file-workspace">' +
          '<span class="document-library-mobile-label">Workspace</span>' +
          '<span>Organization</span>' +
        '</span>';
    }
    var label = row.matterName || '—';
    if (row.matterId && row.matterName) {
      return '<button class="document-library-file-workspace document-library-workspace-link" type="button" data-workspace-id="' + escHtml(row.matterId) + '" title="Open ' + escHtml(label) + ' workspace">' +
          '<span class="document-library-mobile-label">Workspace</span>' +
          '<span>' + escHtml(label) + '</span>' +
        '</button>';
    }
    return '<span class="document-library-file-workspace">' +
        '<span class="document-library-mobile-label">Workspace</span>' +
        '<span>' + escHtml(label) + '</span>' +
      '</span>';
  }

  function renderRow(row) {
    var presentation = templatePresentation(row);
    var metaParts = [
      row.kindLabel,
      row.documentTypeLabel || row.documentType || row.category,
      row.variableCount !== null ? row.variableCount + ' variables' : '',
      row.documentCount !== null ? row.documentCount + ' docs' : ''
    ];
    var meta = metaParts.filter(Boolean).join(' · ');
    var edited = row.updatedAt || row.createdAt || '';
    var editedLabel = relativeTime(edited);
    var timeText = editedLabel ? 'Edited ' + editedLabel : 'Edit time unavailable';

    return (
      '<div class="document-library-file" data-kind="' + escHtml(row.kind) + '" data-id="' + escHtml(row.id) + '"' +
        ' role="link" tabindex="0" aria-label="Open ' + escHtml(row.name) + '">' +
        '<span class="document-library-file-icon document-library-file-icon--' + escHtml(presentation.tone) + '" data-document-library-icon="' + escHtml(presentation.icon) + '" aria-hidden="true"></span>' +
        '<span class="document-library-file-primary">' +
          '<span class="document-library-file-name" title="' + escHtml(row.name) + '">' + escHtml(row.name) + '</span>' +
          '<span class="document-library-file-type">' + escHtml(meta) + '</span>' +
        '</span>' +
        workspaceCellHtml(row) +
        '<time class="document-library-file-time" datetime="' + escHtml(edited) + '" title="' + escHtml(absoluteTime(edited)) + '">' +
          '<span class="document-library-mobile-label">Last edited</span>' + escHtml(timeText) +
        '</time>' +
        '<span class="document-library-file-arrow" data-document-library-icon="chevron-right" aria-hidden="true"></span>' +
      '</div>'
    );
  }

  // ===========================================================================
  // Page state
  // ===========================================================================

  var _state = {
    currentPage: 1,
    // 12 per page, matching the Document Library's list rhythm exactly.
    pageSize: 12,
    kindFilter: '',
    includeOrgWide: true,
    matterId: '',
    searchTerm: '',
    searchDebounce: null,
    totalItems: 0,
    rowsByKey: {}
  };

  function _rowKey(kind, id) {
    return String(kind) + ':' + String(id);
  }

  // ===========================================================================
  // Data access (thin — delegates query building + mapping)
  // ===========================================================================

  function _currentFilters() {
    return {
      kind: _state.kindFilter,
      matterId: _state.matterId,
      q: _state.searchTerm,
      includeOrgWide: _state.includeOrgWide,
      limit: _state.pageSize,
      offset: (_state.currentPage - 1) * _state.pageSize
    };
  }

  function _setColumnsVisible(visible) {
    var columns = el('dstColumns');
    if (columns) columns.hidden = !visible;
  }

  function _setCount(text) {
    var count = el('dstTotalCount');
    if (count) count.textContent = text;
  }

  function _updatePagination(view) {
    var pag = el('dstPagination');
    if (!pag) return;
    if (!view) {
      pag.hidden = true;
      return;
    }
    var totalPages = Math.max(1, Math.ceil(view.total / _state.pageSize));
    pag.setAttribute('page', String(_state.currentPage));
    pag.setAttribute('total-pages', String(totalPages));
    pag.setAttribute('total', String(view.total));
    pag.setAttribute('limit', String(_state.pageSize));
    pag.hidden = totalPages <= 1;
  }

  function _renderLoading() {
    var list = el('dstList');
    if (!list) return;
    _setCount('');
    _setColumnsVisible(false);
    _updatePagination(null);
    list.setAttribute('aria-busy', 'true');
    list.innerHTML =
      '<div class="document-library-skeleton" aria-hidden="true"></div>' +
      '<div class="document-library-skeleton" aria-hidden="true"></div>' +
      '<div class="document-library-skeleton" aria-hidden="true"></div>' +
      '<div class="document-library-skeleton" aria-hidden="true"></div>';
  }

  function _renderEmpty() {
    var list = el('dstList');
    if (!list) return;
    _setCount('0 templates');
    _setColumnsVisible(false);
    _updatePagination(null);
    list.setAttribute('aria-busy', 'false');
    list.innerHTML =
      '<div class="document-library-empty">' +
        '<span class="document-library-empty-icon" data-document-library-icon="file-plus" aria-hidden="true"></span>' +
        '<h3>No templates yet</h3>' +
        '<p>Create an organization template to reuse it from every workspace.</p>' +
        '<lex-btn variant="secondary" leading-icon="file-plus" data-action="new-template">New Template</lex-btn>' +
      '</div>';
    hydrateIcons(list);
  }

  function _renderError(message) {
    var list = el('dstList');
    if (!list) return;
    _setCount('');
    _setColumnsVisible(false);
    _updatePagination(null);
    list.setAttribute('aria-busy', 'false');
    list.innerHTML =
      '<div class="document-library-empty document-library-error" role="alert">' +
        '<span class="document-library-empty-icon" data-document-library-icon="alert-circle" aria-hidden="true"></span>' +
        '<h3>Templates could not be loaded</h3>' +
        '<p>' + escHtml(message || 'Check your connection and try again.') + '</p>' +
        '<lex-btn variant="secondary" data-action="retry">Try again</lex-btn>' +
      '</div>';
    hydrateIcons(list);
  }

  function _fetchTemplates() {
    _renderLoading();

    DocStudioAPI.listTemplates(_currentFilters()).then(function (res) {
      var view = mapper.mapTemplates(res);

      _state.totalItems = view.total;

      // Index rows so the detail drawer can show list data immediately.
      _state.rowsByKey = {};
      for (var i = 0; i < view.rows.length; i++) {
        _state.rowsByKey[_rowKey(view.rows[i].kind, view.rows[i].id)] = view.rows[i];
      }

      if (!view.rows.length) {
        _renderEmpty();
        return;
      }

      _renderList(view.rows);
      _setCount(view.total + (view.total === 1 ? ' template' : ' templates'));
      _setColumnsVisible(true);
      _updatePagination(view);
    }).catch(function (err) {
      _renderError(err && err.message ? err.message : '');
    });
  }

  // ===========================================================================
  // List rendering + selection
  // ===========================================================================

  function _renderList(rows) {
    var list = el('dstList');
    if (!list) return;

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += renderRow(rows[i]);
    }
    list.setAttribute('aria-busy', 'false');
    list.innerHTML = html;
    hydrateIcons(list);
  }

  // ===========================================================================
  // Detail drawer (read-only v1)
  // ===========================================================================

  function _openDetail(kind, id) {
    var drawer = el('dstDetailDrawer');
    var body = el('dstDetailBody');
    if (!drawer || !body) return;

    var seed = _state.rowsByKey[_rowKey(kind, id)];
    drawer.setAttribute('heading', seed ? seed.name : 'Template');
    body.innerHTML = '<div class="dst-detail-loading"><lex-spinner></lex-spinner></div>';
    drawer.open = true;

    DocStudioAPI.getTemplate(kind, id).then(function (dto) {
      body.innerHTML = _renderDetail(dto);
      _bindDetailActions(body, dto);
    }).catch(function (err) {
      if (err && (err.status === 403 || err.status === 404)) {
        drawer.open = false;
        _showAccessDenied();
        return;
      }
      body.innerHTML = '<div class="dst-detail-error">Failed to load template: ' +
        escHtml(err && err.message ? err.message : 'Unknown error') + '</div>';
    });
  }

  function _detailRow(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return '<div class="dst-detail-row">' +
      '<span class="dst-detail-label">' + escHtml(label) + '</span>' +
      '<span class="dst-detail-value">' + escHtml(String(value)) + '</span>' +
      '</div>';
  }

  /**
   * Render a kind-specific section (title + field rows) from the pure
   * mapTemplateDetail view-model. Skips sections that have no fields.
   * @param {{title:string, fields:Array<{label:string,value:string}>}} section
   * @returns {string}
   */
  function _renderDetailSection(section) {
    if (!section || !section.fields || !section.fields.length) return '';

    var rows = '';
    for (var i = 0; i < section.fields.length; i++) {
      rows += _detailRow(section.fields[i].label, section.fields[i].value);
    }
    if (!rows) return '';

    return '<div class="dst-detail-section">' +
      '<div class="dst-detail-section-title">' + escHtml(section.title) + '</div>' +
      rows +
      '</div>';
  }

  /**
   * Editable DOCX templates (fill rows are documents) open in the File
   * Editor. sourceMatterId always carries the hosting workspace key, even for
   * org-wide templates whose visible scope hides it.
   */
  function _canOpenInFileEditor(base) {
    return !!(base && base.kind === 'fill' && base.sourceMatterId &&
      String(base.contentType || '').indexOf('wordprocessingml') !== -1);
  }

  function _renderDetail(dto) {
    // Pure view-model: shared base fields + kind-specific sections. The get-one
    // endpoint returns the UnifiedTemplate shape only (no raw HTML body, no
    // document/variable lists), so detail surfaces the real per-kind fields.
    var detail = mapper.mapTemplateDetail(dto && dto.kind, dto);
    var row = detail.base;

    var html = '<div class="dst-detail">';
    html += '<div class="dst-detail-head">' + kindBadge(detail.kind, detail.kindLabel) +
      '<span class="dst-detail-name">' + escHtml(row.name) + '</span></div>';

    if (row.description) {
      html += '<p class="dst-detail-desc">' + escHtml(row.description) + '</p>';
    }

    // Shared overview fields (common across all kinds).
    html += '<div class="dst-detail-section">';
    html += _detailRow('Scope', row.scopeLabel);
    html += _detailRow('Created', formatTimestamp(row.createdAt));
    html += _detailRow('Updated', formatTimestamp(row.updatedAt));
    html += '</div>';

    // Kind-specific section(s).
    for (var i = 0; i < detail.sections.length; i++) {
      html += _renderDetailSection(detail.sections[i]);
    }

    if (_canOpenInFileEditor(detail.base)) {
      html += '<div class="dst-detail-actions">' +
        '<lex-btn id="dstOpenInEditor" variant="primary" size="sm">Open in File Editor</lex-btn>' +
        '</div>';
    }

    html += '</div>';
    return html;
  }

  /** Wire the drawer's File Editor action after its HTML lands. */
  function _bindDetailActions(body, dto) {
    var btn = body.querySelector('#dstOpenInEditor');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var base = mapper.mapTemplateRow(dto);
      if (!_canOpenInFileEditor(base)) return;
      if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
        Lex.Nav.go('file-editor.html', {
          params: { id: base.id, matter_id: base.sourceMatterId },
          context: { matterId: base.sourceMatterId, documentId: base.id }
        });
      } else {
        window.location.href = 'file-editor.html?' +
          new URLSearchParams({ id: base.id, matter_id: base.sourceMatterId }).toString();
      }
    });
  }

  // ===========================================================================
  // Event wiring
  // ===========================================================================

  function _openNewTemplate() {
    if (window.LanaDocumentCreate && typeof window.LanaDocumentCreate.open === 'function') {
      window.LanaDocumentCreate.open({
        source: 'template_library',
        presetType: 'template',
        presetScope: 'organization'
      });
    } else {
      Lex.Toast.error('Template creation is unavailable on this page.');
    }
  }

  function _openWorkspace(workspaceId) {
    if (!workspaceId) return;
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go('workspace-details.html', {
        params: { id: workspaceId },
        context: { referrer: 'document-library-templates.html' }
      });
      return;
    }
    window.location.href = 'workspace-details.html?id=' + encodeURIComponent(workspaceId);
  }

  /**
   * One delegated binding on the page root covers the banner CTA, the
   * empty-state CTA, retry, workspace links, and template rows (same pattern
   * as the Document Library page, whose styling this page mirrors).
   */
  function _bindRootEvents() {
    var root = document.getElementById('templateLibrary');
    if (!root || root.getAttribute('data-dst-bound') === 'true') return;
    root.setAttribute('data-dst-bound', 'true');

    root.addEventListener('click', function (event) {
      var workspaceTarget = event.target && event.target.closest ? event.target.closest('[data-workspace-id]') : null;
      if (workspaceTarget) {
        _openWorkspace(workspaceTarget.getAttribute('data-workspace-id'));
        return;
      }
      var actionTarget = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (actionTarget && actionTarget.getAttribute('data-action') === 'new-template') {
        _openNewTemplate();
        return;
      }
      if (actionTarget && actionTarget.getAttribute('data-action') === 'retry') {
        _fetchTemplates();
        return;
      }
      var rowTarget = event.target && event.target.closest ? event.target.closest('[data-kind][data-id]') : null;
      if (rowTarget) _openDetail(rowTarget.getAttribute('data-kind'), rowTarget.getAttribute('data-id'));
    });

    root.addEventListener('keydown', function (event) {
      var rowTarget = event.target && event.target.closest ? event.target.closest('[data-kind][data-id]') : null;
      if (!rowTarget || event.target !== rowTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      _openDetail(rowTarget.getAttribute('data-kind'), rowTarget.getAttribute('data-id'));
    });
  }

  function _bindEvents() {
    _bindRootEvents();

    var kindFilter = el('dstKindFilter');
    if (kindFilter) {
      kindFilter.addEventListener('lex-change', function (e) {
        _state.kindFilter = (e.detail && e.detail.value) || '';
        _state.currentPage = 1;
        _fetchTemplates();
      });
    }

    var orgWide = el('dstOrgWideToggle');
    if (orgWide) {
      orgWide.addEventListener('change', function () {
        _state.includeOrgWide = !!orgWide.checked;
        _state.currentPage = 1;
        _fetchTemplates();
      });
    }

    var searchInput = el('dstSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(_state.searchDebounce);
        _state.searchDebounce = setTimeout(function () {
          _state.searchTerm = searchInput.value.trim();
          _state.currentPage = 1;
          _fetchTemplates();
        }, 350);
      });
    }

    var pag = el('dstPagination');
    if (pag) {
      pag.addEventListener('page-change', function (e) {
        _state.currentPage = (e.detail && e.detail.page) || 1;
        _fetchTemplates();
      });
    }
  }

  // ===========================================================================
  // Init
  // ===========================================================================

  function init() {
    // Optional matter scope from the URL (?matter_id=...) — "what can I use here".
    _state.matterId = getQueryParam('matter_id');
    _bindEvents();
    _fetchTemplates();
  }

  if (window.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('document-library-templates.html', init);
  }
  init();
})();
