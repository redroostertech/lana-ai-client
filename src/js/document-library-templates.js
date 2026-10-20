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
   @requires lex-table / lex-empty / lex-segmented / lex-drawer components
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
          '<span>Organization</span>' +
        '</span>';
    }
    var label = row.matterName || '—';
    if (row.matterId && row.matterName) {
      return '<button class="document-library-file-workspace document-library-workspace-link" type="button" data-workspace-id="' + escHtml(row.matterId) + '" title="Open ' + escHtml(label) + ' workspace">' +
          '<span>' + escHtml(label) + '</span>' +
        '</button>';
    }
    return '<span class="document-library-file-workspace">' +
        '<span>' + escHtml(label) + '</span>' +
      '</span>';
  }

  function nameCellHtml(row) {
    var presentation = templatePresentation(row);
    var metaParts = [
      row.kindLabel,
      row.documentTypeLabel || row.documentType || row.category,
      row.variableCount !== null ? row.variableCount + ' variables' : '',
      row.documentCount !== null ? row.documentCount + ' docs' : ''
    ];
    var meta = metaParts.filter(Boolean).join(' · ');
    return '<span class="document-library-file-cell">' +
        '<span class="document-library-file-icon document-library-file-icon--' + escHtml(presentation.tone) + '" aria-hidden="true">' + icon(presentation.icon) + '</span>' +
        '<span class="document-library-file-primary">' +
          '<span class="document-library-file-name" title="' + escHtml(row.name) + '">' + escHtml(row.name) + '</span>' +
          '<span class="document-library-file-type">' + escHtml(meta) + '</span>' +
        '</span>' +
      '</span>';
  }

  function timeCellHtml(row) {
    var edited = row.updatedAt || row.createdAt || '';
    var editedLabel = relativeTime(edited);
    return '<time class="document-library-file-time" datetime="' + escHtml(edited) + '" title="' + escHtml(absoluteTime(edited)) + '">' +
        escHtml(editedLabel ? 'Edited ' + editedLabel : 'Edit time unavailable') +
      '</time>';
  }

  // lex-table cells read the mapped template kept on each table row.
  function cellRenderers() {
    return {
      name: function (val, tableRow) { return nameCellHtml(tableRow._row); },
      workspace: function (val, tableRow) { return workspaceCellHtml(tableRow._row); },
      updated_at: function (val, tableRow) { return timeCellHtml(tableRow._row); }
    };
  }

  // ===========================================================================
  // Page state
  // ===========================================================================

  var TABLE_ID = 'dstTable';
  // Template column filter values (the server's template kinds).
  var KIND_OPTIONS = [
    { value: 'fill', label: 'Documents' },
    { value: 'compose', label: 'Document Sets' },
    { value: 'render', label: 'Layouts' }
  ];
  var ORGANIZATION_OPTION = { value: 'organization', label: 'Organization' };

  var _state = {
    includeOrgWide: true,
    matterId: '',
    searchTerm: '',
    searchDebounce: null,
    loadSequence: 0,
    rowsByKey: {}
  };

  function _rowKey(kind, id) {
    return String(kind) + ':' + String(id);
  }

  // ===========================================================================
  // Data access (thin — delegates query building + mapping)
  // ===========================================================================

  // Values a column filter selected: lex-table sends { operator: 'in', value: [...] }.
  function _filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
  }

  function _currentFilters(query) {
    var limit = query.limit || 20;
    var filters = query.filters || {};
    var shared = window.LanaLibraryColumnFilters;
    var range = shared ? shared.editedRangeBounds(_filterValues(filters.updated_at)[0]) : { after: '', before: '' };
    return {
      kind: _filterValues(filters.name),
      workspaces: _filterValues(filters.workspace),
      updatedAfter: range.after,
      updatedBefore: range.before,
      matterId: _state.matterId,
      q: _state.searchTerm,
      includeOrgWide: _state.includeOrgWide,
      limit: limit,
      offset: ((query.page || 1) - 1) * limit,
      sortBy: query.sortBy || 'updated_at',
      sortOrder: query.sortDir || 'desc'
    };
  }

  function _table() {
    return el(TABLE_ID);
  }

  // The count shows in the toolbar and the section header, as on the Library.
  function _setCount(text) {
    ['dstToolbarCount', 'dstTotalCount'].forEach(function (id) {
      var count = el(id);
      if (count) count.textContent = text;
    });
  }

  function _sortOrder() {
    var button = el('dstSortOrder');
    return button && button.dataset.order === 'asc' ? 'asc' : 'desc';
  }

  // Toolbar sort drives the table, which asks the server for page 1.
  function _applySort(column, direction) {
    var table = _table();
    if (!table || !table.dataSource) return;
    table.sortBy = column;
    table.sortDir = direction;
    table.dataSource.setSort(column, direction);
  }

  // A header click sorted the table: mirror it in the toolbar.
  function _syncToolbarSort(column, direction) {
    var select = el('dstSort');
    var button = el('dstSortOrder');
    if (select && select.value !== column) select.value = column;
    if (button) button.dataset.order = direction === 'asc' ? 'asc' : 'desc';
  }

  // Empty copy depends on the filters outside the table: a filtered-empty
  // state offers no create button.
  function _syncEmptyState(table, filters) {
    var filtered = Boolean(_state.searchTerm || Object.keys(filters || {}).length);
    table.emptyText = filtered
      ? 'No matching templates. Try a different search or template type.'
      : 'No templates yet. Create an organization template to reuse it from every workspace.';
    table.emptyActionLabel = filtered ? '' : 'New Template';
  }

  /** Answers the table's lex-query-change with one page of templates. */
  function _fetchTemplates(query) {
    var table = _table();
    if (!table) return;
    var sequence = ++_state.loadSequence;
    query = query || table.serverQuery;

    DocStudioAPI.listTemplates(_currentFilters(query)).then(function (res) {
      if (sequence !== _state.loadSequence) return;
      var view = mapper.mapTemplates(res);

      // Index rows so the detail drawer can show list data immediately.
      _state.rowsByKey = {};
      var tableRows = view.rows.map(function (row) {
        var key = _rowKey(row.kind, row.id);
        _state.rowsByKey[key] = row;
        return { key: key, name: row.name, workspace: row.matterName || '', updated_at: row.updatedAt || row.createdAt || '', _row: row };
      });

      _syncEmptyState(table, query.filters);
      _setCount(view.total + (view.total === 1 ? ' template' : ' templates'));
      table.setServerData(tableRows, {
        page: query.page || 1,
        limit: query.limit || 20,
        total: view.total
      });
    }).catch(function (err) {
      if (sequence !== _state.loadSequence) return;
      _setCount('');
      table.setServerError('Templates could not be loaded. ' + (err && err.message ? err.message : 'Check your connection and try again.'));
    });
  }

  // Outside filters changed: back to page 1 through the table.
  function _reloadFromFirstPage() {
    var table = _table();
    if (table && typeof table.requestServerQuery === 'function') {
      table.requestServerQuery({ resetPage: true });
    }
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
   * Editable DOCX templates (fill rows are documents) can create a separate
   * regular document or open the template itself in File Editor.
   * sourceMatterId always carries the hosting workspace key, even for org-wide
   * templates whose visible scope hides it.
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
        '<lex-btn id="dstUseTemplate" variant="primary" size="sm" leading-icon="file-plus">Use Template</lex-btn>' +
        '<lex-btn id="dstOpenInEditor" variant="secondary" size="sm">Edit Template</lex-btn>' +
        '</div>';
    }

    html += '</div>';
    return html;
  }

  /** Wire the drawer's File Editor action after its HTML lands. */
  function _bindDetailActions(body, dto) {
    var base = mapper.mapTemplateRow(dto);
    if (!_canOpenInFileEditor(base)) return;

    var useBtn = body.querySelector('#dstUseTemplate');
    if (useBtn) useBtn.addEventListener('click', function () {
      if (!window.LanaDocumentCreate || typeof window.LanaDocumentCreate.open !== 'function') {
        Lex.Toast.error('Document creation is unavailable on this page.');
        return;
      }
      window.LanaDocumentCreate.open({
        source: 'template_library_use',
        sourceTemplate: {
          id: base.id,
          name: base.name,
          sourceMatterId: base.sourceMatterId,
          version: base.version
        }
      });
    });

    var editBtn = body.querySelector('#dstOpenInEditor');
    if (!editBtn) return;
    editBtn.addEventListener('click', function () {
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
      }
    });

    // lex-table events bubble from #dstTable.
    root.addEventListener('lex-query-change', function (event) {
      if (!event.target || event.target.id !== TABLE_ID) return;
      _fetchTemplates(event.detail);
    });
    root.addEventListener('row-click', function (event) {
      if (!event.target || event.target.id !== TABLE_ID) return;
      var row = event.detail && event.detail.row && event.detail.row._row;
      if (row) _openDetail(row.kind, row.id);
    });
    root.addEventListener('empty-action', function (event) {
      if (!event.target || event.target.id !== TABLE_ID) return;
      _openNewTemplate();
    });
    root.addEventListener('sort-change', function (event) {
      if (!event.target || event.target.id !== TABLE_ID || !event.detail) return;
      _syncToolbarSort(event.detail.sortBy, event.detail.sortDir);
    });
  }

  function _bindEvents() {
    _bindRootEvents();

    var kindFilter = el('dstKindFilter');
    if (kindFilter) {
      kindFilter.addEventListener('lex-change', function (e) {
        // Same state as the Template column filter, as My Tasks' Status select does.
        var kind = (e.detail && e.detail.value) || '';
        var table = _table();
        if (!table) return;
        if (kind && kind !== 'all') table.addFilter('name', 'in', [kind]);
        else table.removeFilter('name');
      });
    }

    var sortSelect = el('dstSort');
    if (sortSelect) {
      sortSelect.addEventListener('lex-change', function (e) {
        _applySort((e.detail && e.detail.value) || 'updated_at', _sortOrder());
      });
    }

    var sortOrderBtn = el('dstSortOrder');
    if (sortOrderBtn) {
      sortOrderBtn.addEventListener('click', function () {
        sortOrderBtn.dataset.order = _sortOrder() === 'asc' ? 'desc' : 'asc';
        _applySort(sortSelect ? sortSelect.value : 'updated_at', _sortOrder());
      });
    }

    var orgWide = el('dstOrgWideToggle');
    if (orgWide) {
      orgWide.addEventListener('change', function () {
        _state.includeOrgWide = !!orgWide.checked;
        _reloadFromFirstPage();
      });
    }

    // lex-input emits lex-input while typing and lex-change on clear.
    var searchInput = el('dstSearch');
    if (searchInput) {
      var onSearch = function (e) {
        var value = String((e.detail && e.detail.value) || '').trim();
        clearTimeout(_state.searchDebounce);
        _state.searchDebounce = setTimeout(function () {
          if (value === _state.searchTerm) return;
          _state.searchTerm = value;
          _reloadFromFirstPage();
        }, 350);
      };
      searchInput.addEventListener('lex-input', onSearch);
      searchInput.addEventListener('lex-change', onSearch);
    }
  }

  // ===========================================================================
  // Init
  // ===========================================================================

  function init() {
    // Optional matter scope from the URL (?matter_id=...) — "what can I use here".
    _state.matterId = getQueryParam('matter_id');
    _bindEvents();
    var ready = window.customElements && typeof window.customElements.whenDefined === 'function'
      ? window.customElements.whenDefined('lex-table')
      : Promise.resolve();
    ready.then(function () {
      var table = _table();
      if (!table) return;
      // Renderers must be registered before the first page lands.
      table.setCellRenderers(cellRenderers());
      _applyColumnFilterOptions(table, []);
      _reloadFromFirstPage();
      if (window.LanaLibraryColumnFilters) {
        window.LanaLibraryColumnFilters.loadWorkspaceOptions(window.api).then(function (options) {
          if (_table() === table) _applyColumnFilterOptions(table, options);
        });
      }
    });
  }

  function _applyColumnFilterOptions(table, workspaceOptions) {
    var shared = window.LanaLibraryColumnFilters;
    var map = {
      name: { options: KIND_OPTIONS },
      // Org-wide templates have no workspace; "Organization" selects them.
      workspace: { options: [ORGANIZATION_OPTION].concat(workspaceOptions || []) }
    };
    if (shared) map.updated_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    table.setColumnFilterOptions(map);
  }

  if (window.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('document-library-templates.html', init);
  }
  init();
})();
