/**
 * Workspace Data — Connected data visualization for a specific workspace/matter.
 *
 * Displays paginated connector data assigned to a workspace with
 * filtering, search, and an embedded Ask LANA chat panel.
 *
 * @requires api.js          - window.api
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-toast.js    - Lex.Toast.error
 * @requires lex-table.js    - table.setData()
 * @requires lex-chat.js     - lex-chat component
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // Lex aliases
  // ═══════════════════════════════════════════════════════════════

  var fmtDateTime = Lex.Utils.formatDateTime;
  var WsTable = window.LanaWorkspaceDataTable;
  var TABLE_ID = 'wsDataTable';

  // ═══════════════════════════════════════════════════════════════
  // Module-level state
  // ═══════════════════════════════════════════════════════════════

  var _gen         = 0;
  var _matterId    = '';
  var _matterName  = '';
  var _searchTerm  = '';
  var _searchDebounce = null;
  // Deep-link state (?entity_type=&connector_id=&search=&page=) applied to the
  // table before its first query.
  var _initialQuery = { entityType: '', connectorId: '', search: '', page: 1 };
  // Column filter values seen in the API's facets (it narrows them by the
  // active filters, so they are merged rather than replaced).
  var _entityOptions = [];
  var _connectorOptions = [];
  var _matterUuid  = '';  // actual UUID from DB (for backend APIs)
  // _chatEl / _threadsEl removed — managed by lex-lana-panel

  var _importWizard = {
    step: 'upload',
    file: null,
    job: null,
    mapping: null,
    preview: null,
    validation: null,
    promotion: null,
    rows: [],
    selectedRowIds: {},
    customFieldApproved: false,
    importPlanConfirmation: '',
    busy: false
  };
  var _importHistory = {
    rows: [],
    byId: {},
    busy: false,
    loaded: false,
    error: ''
  };
  var _importRollup = {
    data: null,
    busy: false,
    loaded: false,
    error: '',
    source: ''
  };

  var _importEntityOptions = [
    { value: 'lead', label: 'Lead' },
    { value: 'contact', label: 'Contact' },
    { value: 'account', label: 'Account' },
    { value: 'opportunity', label: 'Opportunity' },
    { value: 'campaign', label: 'Campaign' },
    { value: 'task', label: 'Task' }
  ];

  var _importFieldOptions = {
    account: ['name', 'account_number', 'company_name', 'type', 'status', 'phone', 'email', 'website', 'annual_revenue', 'description', 'external_id'],
    contact: ['display_name', 'first_name', 'last_name', 'email', 'phone', 'phone_work', 'phone_mobile', 'mobile', 'company', 'title', 'contact_type', 'description', 'external_id'],
    lead: ['name', 'first_name', 'last_name', 'email', 'phone', 'company', 'title', 'lead_source', 'lead_score', 'status', 'description', 'external_id'],
    opportunity: ['name', 'amount', 'status', 'stage', 'probability', 'expected_close_date', 'actual_close_date', 'company', 'contact_id', 'account_id', 'description', 'external_id'],
    campaign: ['name', 'type', 'status', 'start_date', 'end_date', 'spend', 'conversions', 'description', 'external_id'],
    task: ['title', 'description', 'status', 'task_type', 'due_date', 'assigned_to_name', 'assigned_to_user_id', 'external_id']
  };

  // Bulk selection state
  var _selectedRowIds   = {};   // { [rowId]: true }
  var _bulkBarVisible   = false;

  // Annotation type icons (no emoji — Unicode arrows/symbols only)
  var _annotationIcons = {
    note:       'N',
    tag:        'T',
    status:     'S',
    correction: 'C',
    flag:       'F'
  };

  var _annotationColors = {
    note:       '#2563eb',
    tag:        '#7c3aed',
    status:     '#059669',
    correction: '#d97706',
    flag:       '#dc2626'
  };

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function el(id) { return document.getElementById(id); }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  function _shouldAutoOpenImportWizard() {
    var requested = String(getQueryParam('import') || getQueryParam('openImport') || '').trim().toLowerCase();
    return requested === 'csv' || requested === 'true' || requested === '1';
  }

  // ═══════════════════════════════════════════════════════════════
  // Entry point
  // ═══════════════════════════════════════════════════════════════

  function init() {
    _matterId = getQueryParam('id');
    if (!_matterId) {
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.error('No workspace ID provided');
      }
      return;
    }
    _hydrateFiltersFromQuery();

    _fetchMatterDetails();
  }

  function _hydrateFiltersFromQuery() {
    _initialQuery = WsTable.readQueryState(window.location.search);
    _searchTerm = _initialQuery.search;

    var searchInput = el('wsDataSearch');
    if (searchInput && _searchTerm) {
      searchInput.setAttribute('value', _searchTerm);
      searchInput.value = _searchTerm;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Fetch matter details for breadcrumb/title
  // ═══════════════════════════════════════════════════════════════

  function _fetchMatterDetails() {
    api.get('/api/v1/matters/' + encodeURIComponent(_matterId))
      .then(function (result) {
        var matter = (result && result.data) || result || {};
        _matterName = matter.matter_name || matter.name || _matterId;
        _matterUuid = matter.id || _matterId; // UUID for backend APIs

        // Update breadcrumb
        var breadcrumb = el('wsDataBreadcrumb');
        if (breadcrumb) {
          breadcrumb.setAttribute('items', JSON.stringify([
            { label: 'Workspaces', href: 'workspaces.html' },
            { label: _matterName, href: 'workspace-details.html?id=' + encodeURIComponent(_matterId) },
            { label: 'Connected Data' }
          ]));
        }

        // Update banner subtitle
        var banner = el('wsDataBanner');
        if (banner) {
          banner.setAttribute('subtitle', 'Data connected to ' + _matterName);
        }

        // Wire everything and load data
        _wireSearch();
        _wireFilters();
        _wireImportWizard();
        _initLanaPanel();
        _whenTableReady(_wireTable);
        _loadImportRollup(true);
        _loadImportHistory(true);
        if (_shouldAutoOpenImportWizard()) {
          _openImportWizard();
        }
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Failed to fetch matter:', err);
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          Lex.Toast.error('Failed to load workspace details');
        }
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Toolbar: search, sort, entity type filter
  // ═══════════════════════════════════════════════════════════════

  function _table() { return el(TABLE_ID); }

  function _whenTableReady(fn) {
    var ready = window.customElements && typeof window.customElements.whenDefined === 'function'
      ? window.customElements.whenDefined('lex-table')
      : Promise.resolve();
    ready.then(fn);
  }

  // lex-input emits lex-input while typing and lex-change on clear.
  function _wireSearch() {
    var input = el('wsDataSearch');
    if (!input || input._wired) return;
    input._wired = true;
    ['lex-input', 'lex-change'].forEach(function (name) {
      input.addEventListener(name, function (e) {
        var value = String((e.detail && e.detail.value) || '').trim();
        clearTimeout(_searchDebounce);
        _searchDebounce = setTimeout(function () {
          if (value === _searchTerm) return;
          _searchTerm = value;
          var table = _table();
          if (table) table.requestServerQuery({ resetPage: true });
        }, 350);
      });
    });
  }

  function _sortOrder() {
    var button = el('wsDataSortOrder');
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
    var select = el('wsDataSort');
    var button = el('wsDataSortOrder');
    if (select && select.value !== column) select.value = column;
    if (button) button.dataset.order = direction === 'asc' ? 'asc' : 'desc';
  }

  function _wireFilters() {
    var entitySelect = el('wsDataEntityFilter');
    if (entitySelect && !entitySelect._wired) {
      entitySelect._wired = true;
      // Held in the table's own filter state (the Entity type column), so
      // the table's Clear filters resets it too.
      entitySelect.addEventListener('lex-change', function (e) {
        var table = _table();
        if (!table) return;
        var value = String((e.detail && e.detail.value) || '');
        if (value && value !== 'all') table.addFilter('entity_type', 'in', [value]);
        else table.removeFilter('entity_type');
      });
    }

    var sortSelect = el('wsDataSort');
    if (sortSelect && !sortSelect._wired) {
      sortSelect._wired = true;
      sortSelect.addEventListener('lex-change', function (e) {
        _applySort(String((e.detail && e.detail.value) || 'synced_at'), _sortOrder());
      });
    }

    var orderButton = el('wsDataSortOrder');
    if (orderButton && !orderButton._wired) {
      orderButton._wired = true;
      orderButton.addEventListener('click', function () {
        orderButton.dataset.order = _sortOrder() === 'asc' ? 'desc' : 'asc';
        var select = el('wsDataSort');
        _applySort(select && select.value ? select.value : 'synced_at', _sortOrder());
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Table: server paging, renderers, row selection
  // ═══════════════════════════════════════════════════════════════

  function _wireTable() {
    var table = _table();
    if (!table || table._wsWired) return;
    table._wsWired = true;

    // Renderers must be registered before the first page lands.
    table.setCellRenderers(WsTable.cellRenderers({
      isSelected: function (id) { return !!_selectedRowIds[id]; }
    }));
    _applyColumnFilterOptions();

    table.addEventListener('lex-query-change', function (e) {
      if (e.target !== table) return;
      _loadPage(e.detail);
    });
    table.addEventListener('sort-change', function (e) {
      if (e.target !== table || !e.detail) return;
      _syncToolbarSort(e.detail.sortBy, e.detail.sortDir);
    });
    // Bulk-annotate checkboxes live in the ID cell; lex-table's row-click
    // ignores clicks on inputs.
    table.addEventListener('change', function (e) {
      var cb = e.target && e.target.closest ? e.target.closest('[data-ws-select]') : null;
      if (!cb) return;
      var rowId = cb.getAttribute('data-ws-select');
      if (cb.checked) _selectedRowIds[rowId] = true;
      else delete _selectedRowIds[rowId];
      _syncBulkBar();
    });
    _wireRowClick();
    table.addEventListener('empty-action', function (e) {
      if (e.target === table) _openImportWizard();
    });

    // Deep link: filters and page before the first query.
    // (Set on the data source directly: addFilter would query page 1 at once.)
    void table.serverQuery; // creates the server-mode data source
    var source = table.dataSource;
    if (_initialQuery.entityType) source._filters.set('entity_type', { operator: 'in', value: [_initialQuery.entityType] });
    if (_initialQuery.connectorId) source._filters.set('connector_id', { operator: 'in', value: [_initialQuery.connectorId] });
    if (_initialQuery.page > 1) source._pagination.page = _initialQuery.page;
    _syncEntitySelect(table.serverQuery.filters);
    table.requestServerQuery();
  }

  function _setCount(total) {
    var text = total === '' ? '' : total + (total === 1 ? ' record' : ' records');
    ['wsDataCount', 'wsDataSectionCount'].forEach(function (id) {
      var node = el(id);
      if (node) node.textContent = text;
    });
  }

  /**
   * Attach a connector_data row to the chat as context, then open the panel.
   * Shows a badge capsule in the composer and injects data on next send.
   */
  function _sendRowToChat(rowId) {
    var fullRow = _rowDataMap[rowId];
    if (!fullRow) return;

    // Open panel if hidden
    var panel = document.getElementById('wsDataLana');
    if (panel) panel.show();

    var rowData = _getRowData(fullRow.data);
    var entityType = fullRow.entity_type || 'record';

    // Build a short label for the badge
    var badgeLabel = entityType;
    var rowKeys = Object.keys(rowData);
    if (rowKeys.length > 0) {
      var firstVal = String(rowData[rowKeys[0]] || '').trim();
      if (firstVal.length > 0) {
        badgeLabel = firstVal.length > 24 ? firstVal.substring(0, 21) + '...' : firstVal;
      }
    }

    // Store the pending attachment so the next send() includes it
    _pendingDataAttachment = {
      connector_data_id: fullRow.id,
      external_id: fullRow.external_id,
      entity_type: fullRow.entity_type,
      connector_id: fullRow.connector_id || fullRow.connector_name,
      data: rowData
    };

    // Render badge capsule in the composer's doc-badges area
    _renderDataBadge(badgeLabel, rowId);
  }

  /** Pending data attachment cleared after send */
  var _pendingDataAttachment = null;

  var DATA_ICON_SVG = '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">'
    + '<ellipse cx="12" cy="5" rx="9" ry="3"/>'
    + '<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>'
    + '<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';

  var CLOSE_ICON_SVG = '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24">'
    + '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  /**
   * Render a badge capsule in the composer showing the attached data record.
   * Reuses the lex-cmp-doc-badge styling from the composer component.
   */
  function _renderDataBadge(label, rowId) {
    var panel = document.getElementById('wsDataLana');
    var chatEl = panel && panel.getChatElement ? panel.getChatElement() : null;
    if (!chatEl) return;
    var composer = chatEl.querySelector('lex-chat-composer');
    if (!composer) return;

    var container = composer.querySelector('[data-doc-badges]');
    if (!container) return;

    // Remove any existing data badge (only one at a time)
    var existing = container.querySelector('[data-connector-badge]');
    if (existing) existing.remove();

    var escLabel = Lex.Utils.escapeHtml(label);

    var badge = document.createElement('div');
    badge.className = 'lex-cmp-doc-badge';
    badge.setAttribute('data-connector-badge', rowId);
    badge.innerHTML = DATA_ICON_SVG +
      '<span>' + escLabel + '</span>' +
      '<button class="lex-cmp-doc-badge-x" data-dismiss-connector-badge title="Remove record">' + CLOSE_ICON_SVG + '</button>';

    // Wire dismiss
    badge.querySelector('[data-dismiss-connector-badge]').addEventListener('click', function (e) {
      e.stopPropagation();
      _pendingDataAttachment = null;
      badge.remove();
    });

    container.appendChild(badge);
  }

  /**
   * Clear the data badge after a message is sent.
   * Called from the send wrapper.
   */
  function _clearDataBadge() {
    var panel = document.getElementById('wsDataLana');
    var chatEl = panel && panel.getChatElement ? panel.getChatElement() : null;
    if (!chatEl) return;
    var composer = chatEl.querySelector('lex-chat-composer');
    if (!composer) return;
    var badge = composer.querySelector('[data-connector-badge]');
    if (badge) badge.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  // Bulk selection & bulk annotate action bar
  // ═══════════════════════════════════════════════════════════════

  /**
   * Show or hide the bulk annotate action bar based on current selection.
   */
  function _syncBulkBar() {
    var count = Object.keys(_selectedRowIds).length;

    // Ensure bar exists
    var bar = el('wsDataBulkBar');
    if (!bar) {
      bar = _createBulkBar();
    }

    if (count > 0) {
      bar.style.display = 'flex';
      var label = bar.querySelector('#wsDataBulkCount');
      if (label) label.textContent = count + ' selected';
      _bulkBarVisible = true;
    } else {
      bar.style.display = 'none';
      _bulkBarVisible = false;
    }
  }

  /**
   * Build the bulk annotate action bar and append it to the page.
   * @returns {HTMLElement}
   */
  function _createBulkBar() {
    var bar = document.createElement('div');
    bar.id = 'wsDataBulkBar';
    bar.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;z-index:8888;' +
      'background:#1e293b;color:#f8fafc;' +
      'display:none;align-items:center;gap:1rem;' +
      'padding:0.75rem 1.5rem;box-shadow:0 -4px 16px rgba(0,0,0,0.2);';

    bar.innerHTML =
      '<span id="wsDataBulkCount" style="font-size:13px;font-weight:500;"></span>' +
      '<lex-select id="wsDataBulkType" size="sm" value="note" style="width:140px;" ' +
        'options=\'[{"value":"note","label":"Note"},{"value":"tag","label":"Tag"},{"value":"status","label":"Status"},{"value":"correction","label":"Correction"},{"value":"flag","label":"Flag"}]\'>' +
      '</lex-select>' +
      '<input id="wsDataBulkValue" type="text" placeholder="Annotation text..." ' +
        'style="flex:1;padding:4px 10px;border-radius:6px;border:1px solid #475569;background:#334155;color:#f8fafc;font-size:13px;" />' +
      '<button id="wsDataBulkApply" style="padding:4px 16px;border-radius:6px;background:#2563eb;color:#fff;border:none;cursor:pointer;font-size:13px;font-weight:500;">Apply</button>' +
      '<button id="wsDataBulkClear" style="padding:4px 12px;border-radius:6px;background:#475569;color:#f8fafc;border:none;cursor:pointer;font-size:13px;">Clear</button>';

    document.body.appendChild(bar);

    bar.querySelector('#wsDataBulkApply').addEventListener('click', function () {
      _executeBulkAnnotate();
    });

    bar.querySelector('#wsDataBulkClear').addEventListener('click', function () {
      _selectedRowIds = {};
      _syncBulkBar();
      // Uncheck all checkboxes
      var checkboxes = document.querySelectorAll('.ws-row-checkbox');
      for (var i = 0; i < checkboxes.length; i++) {
        checkboxes[i].checked = false;
      }
    });

    return bar;
  }

  /**
   * POST the bulk annotation to the backend for all selected rows.
   * When more than 5 rows are selected, prompts the user for confirmation
   * before proceeding.
   */
  function _executeBulkAnnotate() {
    var dataIds = Object.keys(_selectedRowIds);
    if (!dataIds.length) return;

    var typeEl  = el('wsDataBulkType');
    var valueEl = el('wsDataBulkValue');
    if (!typeEl || !valueEl) return;

    var annotationType = typeEl.value || 'note';
    var text           = (valueEl.value || '').trim();
    if (!text) {
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.error('Please enter annotation text');
      }
      return;
    }

    // Confirm when applying to a large selection to prevent accidental bulk operations
    if (dataIds.length > 5) {
      var confirmed = window.confirm(
        'You are about to apply a "' + annotationType + '" annotation to ' +
        dataIds.length + ' records. Continue?'
      );
      if (!confirmed) return;
    }

    var url = '/api/v1/matters/' + encodeURIComponent(_matterId) +
              '/connected-data/annotations/bulk';

    api.post(url, {
      data_ids:        dataIds,
      annotation_type: annotationType,
      value:           { text: text }
    }).then(function (result) {
      var data = (result && result.data) || {};
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.success(
          'Applied annotation to ' + (data.inserted || 0) + ' record' +
          ((data.inserted || 0) === 1 ? '' : 's') +
          (data.skipped ? ' (' + data.skipped + ' skipped)' : '')
        );
      }
      // Clear selection and refresh
      _selectedRowIds = {};
      _syncBulkBar();
      valueEl.value = '';
      _loadData();
    }).catch(function (err) {
      console.error('[WorkspaceData] Bulk annotate failed:', err);
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.error('Bulk annotation failed');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Annotation API helpers
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fetch all annotations for a connector_data record.
   *
   * @param {string} dataId
   * @param {string} matterId
   * @returns {Promise<Array>}
   */
  function _loadAnnotations(dataId, matterId) {
    var url = '/api/v1/matters/' + encodeURIComponent(matterId) +
              '/connected-data/' + encodeURIComponent(dataId) +
              '/annotations?limit=100&sort_dir=asc';
    return api.get(url).then(function (result) {
      // Return both data and pagination so callers can show truncation warnings
      return {
        annotations: (result && result.data) || [],
        pagination: (result && result.pagination) || null
      };
    });
  }

  /**
   * Create a new annotation.
   *
   * @param {string} dataId
   * @param {string} matterId
   * @param {Object} body - { annotation_type, field_key?, value }
   * @returns {Promise<Object>}
   */
  function _createAnnotation(dataId, matterId, body) {
    var url = '/api/v1/matters/' + encodeURIComponent(matterId) +
              '/connected-data/' + encodeURIComponent(dataId) +
              '/annotations';
    return api.post(url, body).then(function (result) {
      return (result && result.data) || result;
    });
  }

  /**
   * Update an annotation's value.
   *
   * @param {string} dataId
   * @param {string} matterId
   * @param {string} annotationId
   * @param {Object} body - { value }
   * @returns {Promise<Object>}
   */
  function _updateAnnotation(dataId, matterId, annotationId, body) {
    var url = '/api/v1/matters/' + encodeURIComponent(matterId) +
              '/connected-data/' + encodeURIComponent(dataId) +
              '/annotations/' + encodeURIComponent(annotationId);
    return api.put(url, body).then(function (result) {
      return (result && result.data) || result;
    });
  }

  /**
   * Delete an annotation.
   *
   * @param {string} dataId
   * @param {string} matterId
   * @param {string} annotationId
   * @returns {Promise<void>}
   */
  function _deleteAnnotation(dataId, matterId, annotationId) {
    var url = '/api/v1/matters/' + encodeURIComponent(matterId) +
              '/connected-data/' + encodeURIComponent(dataId) +
              '/annotations/' + encodeURIComponent(annotationId);
    return api.delete(url);
  }

  // ═══════════════════════════════════════════════════════════════
  // Annotation tab content rendering
  // ═══════════════════════════════════════════════════════════════

  /**
   * Render the annotations tab body inside a given container element.
   * Shows existing annotations + an inline create form.
   *
   * @param {HTMLElement} container - The tab body element to render into.
   * @param {string}      dataId    - connector_data UUID.
   * @param {string}      matterId
   */
  function _renderAnnotationsTab(container, dataId, matterId) {
    var escHtml = Lex.Utils.escapeHtml;

    container.innerHTML = '<p style="font-size:12px;color:#9ca3af;text-align:center;padding:1rem;">Loading annotations...</p>';

    _loadAnnotations(dataId, matterId).then(function (result) {
      var annotations = result.annotations;
      var pagination  = result.pagination;
      var listHtml = '';

      if (!annotations.length) {
        listHtml = '<p style="font-size:12px;color:#9ca3af;margin:0 0 1rem;">No annotations yet.</p>';
      } else {
        listHtml = '<div id="wsAnnotationList" style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1rem;">';
        for (var i = 0; i < annotations.length; i++) {
          var ann    = annotations[i];
          var color  = _annotationColors[ann.annotation_type] || '#6b7280';
          var icon   = _annotationIcons[ann.annotation_type]  || '?';
          var text   = (ann.value && (ann.value.text || JSON.stringify(ann.value))) || '';
          var when   = (ann.created_at && fmtDateTime ? fmtDateTime(ann.created_at) : '') || ann.created_at || '';
          var who    = ann.user_display_name || ann.user_email || 'User';
          listHtml +=
            '<div class="ws-ann-row" data-ann-id="' + escHtml(ann.id) + '" ' +
              'style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid #f3f4f6;">' +
              '<span style="flex-shrink:0;width:20px;height:20px;border-radius:4px;background:' + color + ';' +
                'color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">' +
                escHtml(icon) +
              '</span>' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:12px;color:#374151;word-break:break-word;">' + escHtml(text) + '</div>' +
                (ann.field_key
                  ? '<div style="font-size:10px;color:#9ca3af;margin-top:2px;">Field: ' + escHtml(ann.field_key) + '</div>'
                  : '') +
                '<div style="font-size:10px;color:#9ca3af;margin-top:2px;">' +
                  escHtml(who) + (when ? ' &middot; ' + escHtml(when) : '') +
                '</div>' +
              '</div>' +
              '<button class="ws-ann-edit-btn" data-ann-id="' + escHtml(ann.id) + '" ' +
                'data-current-text="' + escHtml(text) + '" ' +
                'style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:11px;flex-shrink:0;" ' +
                'title="Edit">Edit</button>' +
              '<button class="ws-ann-del-btn" data-ann-id="' + escHtml(ann.id) + '" ' +
                'style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:11px;flex-shrink:0;" ' +
                'title="Delete">Del</button>' +
            '</div>';
        }
        listHtml += '</div>';

        // Show a note when the result is truncated (total > 100)
        if (pagination && pagination.total && pagination.total > annotations.length) {
          listHtml +=
            '<p style="font-size:11px;color:#9ca3af;text-align:center;padding:0.5rem;">' +
              'Showing first ' + annotations.length + ' of ' + pagination.total + ' annotations' +
            '</p>';
        }
      }

      // Create form
      var formHtml =
        '<div id="wsAnnotationForm" style="border-top:1px solid #e5e7eb;padding-top:0.75rem;">' +
          '<p style="margin:0 0 0.5rem;font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.05em;">Add Annotation</p>' +
          '<div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">' +
            '<lex-select id="wsAnnNewType" size="sm" value="note" style="width:140px;" ' +
              'options=\'[{"value":"note","label":"Note"},{"value":"tag","label":"Tag"},{"value":"status","label":"Status"},{"value":"correction","label":"Correction"},{"value":"flag","label":"Flag"}]\'>' +
            '</lex-select>' +
            '<input id="wsAnnNewField" type="text" placeholder="Field (optional)" ' +
              'style="width:110px;padding:4px 8px;border-radius:6px;border:1px solid #d1d5db;font-size:12px;" />' +
          '</div>' +
          '<textarea id="wsAnnNewText" placeholder="Annotation text..." rows="2" ' +
            'style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #d1d5db;font-size:12px;resize:vertical;"></textarea>' +
          '<button id="wsAnnNewSubmit" ' +
            'style="margin-top:0.5rem;padding:5px 14px;border-radius:6px;background:#2563eb;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:500;">' +
            'Save' +
          '</button>' +
        '</div>';

      container.innerHTML = listHtml + formHtml;

      // Wire the create form
      var submitBtn = container.querySelector('#wsAnnNewSubmit');
      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          var typeEl  = container.querySelector('#wsAnnNewType');
          var fieldEl = container.querySelector('#wsAnnNewField');
          var textEl  = container.querySelector('#wsAnnNewText');
          var text    = (textEl && textEl.value.trim()) || '';
          if (!text) return;

          var body = {
            annotation_type: (typeEl && typeEl.value) || 'note',
            value: { text: text }
          };
          if (fieldEl && fieldEl.value.trim()) {
            body.field_key = fieldEl.value.trim();
          }

          _createAnnotation(dataId, matterId, body).then(function () {
            if (textEl) textEl.value = '';
            _renderAnnotationsTab(container, dataId, matterId);
            // Refresh in-memory count
            if (_rowDataMap[dataId]) {
              _rowDataMap[dataId].annotation_count = (_rowDataMap[dataId].annotation_count || 0) + 1;
            }
            _refreshAnnotationStatCard();
          }).catch(function (err) {
            console.error('[WorkspaceData] Create annotation failed:', err);
            if (typeof Lex !== 'undefined' && Lex.Toast) {
              Lex.Toast.error('Failed to save annotation');
            }
          });
        });
      }

      // Wire delete buttons
      var delBtns = container.querySelectorAll('.ws-ann-del-btn');
      for (var d = 0; d < delBtns.length; d++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            var annId = btn.getAttribute('data-ann-id');
            if (!annId) return;
            _deleteAnnotation(dataId, matterId, annId).then(function () {
              _renderAnnotationsTab(container, dataId, matterId);
              if (_rowDataMap[dataId] && _rowDataMap[dataId].annotation_count > 0) {
                _rowDataMap[dataId].annotation_count--;
              }
              _refreshAnnotationStatCard();
            }).catch(function (err) {
              console.error('[WorkspaceData] Delete annotation failed:', err);
              if (typeof Lex !== 'undefined' && Lex.Toast) {
                Lex.Toast.error('Failed to delete annotation');
              }
            });
          });
        })(delBtns[d]);
      }

      // Wire edit buttons — inline replace textarea
      var editBtns = container.querySelectorAll('.ws-ann-edit-btn');
      for (var e2 = 0; e2 < editBtns.length; e2++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            var annId   = btn.getAttribute('data-ann-id');
            var curText = btn.getAttribute('data-current-text') || '';
            var row     = btn.closest('.ws-ann-row');
            if (!row) return;

            // Replace row with inline edit
            var editArea = document.createElement('div');
            editArea.style.cssText = 'display:flex;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid #f3f4f6;align-items:center;';
            editArea.innerHTML =
              '<textarea style="flex:1;padding:4px 8px;border-radius:6px;border:1px solid #d1d5db;font-size:12px;resize:none;" rows="2">' +
                (curText || '') +
              '</textarea>' +
              '<button class="ws-ann-save" style="padding:4px 10px;border-radius:6px;background:#2563eb;color:#fff;border:none;cursor:pointer;font-size:12px;">Save</button>' +
              '<button class="ws-ann-cancel" style="padding:4px 10px;border-radius:6px;background:#e5e7eb;color:#374151;border:none;cursor:pointer;font-size:12px;">Cancel</button>';

            row.replaceWith(editArea);

            editArea.querySelector('.ws-ann-save').addEventListener('click', function () {
              var newText = editArea.querySelector('textarea').value.trim();
              if (!newText) return;
              _updateAnnotation(dataId, matterId, annId, { value: { text: newText } }).then(function () {
                _renderAnnotationsTab(container, dataId, matterId);
              }).catch(function (err) {
                console.error('[WorkspaceData] Update annotation failed:', err);
                if (typeof Lex !== 'undefined' && Lex.Toast) {
                  Lex.Toast.error('Failed to update annotation');
                }
              });
            });

            editArea.querySelector('.ws-ann-cancel').addEventListener('click', function () {
              _renderAnnotationsTab(container, dataId, matterId);
            });
          });
        })(editBtns[e2]);
      }
    }).catch(function (err) {
      console.error('[WorkspaceData] Load annotations failed:', err);
      container.innerHTML = '<p style="font-size:12px;color:#ef4444;padding:1rem;">Failed to load annotations.</p>';
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Changes Timeline
  // ═══════════════════════════════════════════════════════════════

  /** Change type badge colors */
  var _changeTypeColors = {
    created:  '#16a34a',  // green
    updated:  '#2563eb',  // blue
    deleted:  '#dc2626',  // red
    restored: '#d97706'   // yellow/amber
  };

  /**
   * Fetch change history for a connector_data record.
   *
   * @param {string} dataId   - connector_data UUID
   * @param {string} matterId - matter ID string
   * @returns {Promise<Array>}
   */
  function _loadChanges(dataId, matterId) {
    var url = '/api/v1/matters/' + encodeURIComponent(matterId) +
              '/connected-data/' + encodeURIComponent(dataId) +
              '/changes?limit=50';
    return api.get(url).then(function (result) {
      return (result && result.data) || [];
    });
  }

  /**
   * Render a vertical change timeline into the given container element.
   *
   * @param {HTMLElement} container - Element to render into
   * @param {Array}       changes   - Array of change records from the API
   */
  function _renderChangeTimeline(container, changes) {
    var escHtml = Lex.Utils.escapeHtml;

    if (!changes || !changes.length) {
      container.innerHTML =
        '<div style="padding:1.5rem;text-align:center;">' +
          '<p style="margin:0;font-size:13px;color:#9ca3af;font-style:italic;">No changes recorded</p>' +
          '<p style="margin:0.5rem 0 0;font-size:11px;color:#d1d5db;">Changes are tracked after each sync</p>' +
        '</div>';
      return;
    }

    var html = '<div style="position:relative;padding-left:20px;">';

    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var color = _changeTypeColors[change.change_type] || '#6b7280';
      var changeLabel = change.change_type
        ? change.change_type.charAt(0).toUpperCase() + change.change_type.substring(1)
        : 'Unknown';
      var when = (change.created_at && fmtDateTime) ? fmtDateTime(change.created_at) : (change.created_at || '');
      var connector = change.connector_id || '';
      var entityType = change.entity_type || '';

      // Timeline line
      var isLast = (i === changes.length - 1);
      html +=
        '<div style="position:relative;padding-bottom:' + (isLast ? '0.5rem' : '1rem') + ';">' +
          // Vertical line
          (!isLast
            ? '<div style="position:absolute;left:-13px;top:20px;width:2px;bottom:-4px;background:#e5e7eb;"></div>'
            : '') +
          // Dot
          '<div style="position:absolute;left:-18px;top:4px;width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;"></div>' +
          // Content
          '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:0.625rem 0.75rem;">' +
            '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.25rem;">' +
              // Badge
              '<span style="display:inline-block;padding:1px 8px;border-radius:99px;background:' + color + ';' +
                'color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">' +
                escHtml(changeLabel) +
              '</span>' +
              (connector
                ? '<span style="font-size:11px;color:#6b7280;">' + escHtml(connector) + '</span>'
                : '') +
              (entityType
                ? '<span style="font-size:11px;color:#9ca3af;">' + escHtml(entityType) + '</span>'
                : '') +
            '</div>' +
            '<div style="font-size:11px;color:#9ca3af;">' + escHtml(when) + '</div>';

      // Field-level diff (only for 'updated' changes with changed_fields)
      if (change.change_type === 'updated' && change.changed_fields && change.changed_fields.length) {
        html += '<div style="margin-top:0.5rem;border-top:1px solid #e5e7eb;padding-top:0.5rem;">';
        html += '<p style="margin:0 0 0.25rem;font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;">Changed Fields</p>';
        html += '<div style="display:flex;flex-direction:column;gap:0.25rem;">';

        var maxFields = 10;
        var fieldsToShow = change.changed_fields.slice(0, maxFields);
        for (var f = 0; f < fieldsToShow.length; f++) {
          var fieldChange = fieldsToShow[f];
          var oldVal = fieldChange.old_value !== null && fieldChange.old_value !== undefined
            ? String(fieldChange.old_value) : '(empty)';
          var newVal = fieldChange.new_value !== null && fieldChange.new_value !== undefined
            ? String(fieldChange.new_value) : '(empty)';
          if (oldVal.length > 60) oldVal = oldVal.substring(0, 57) + '...';
          if (newVal.length > 60) newVal = newVal.substring(0, 57) + '...';

          html +=
            '<div style="font-size:11px;">' +
              '<span style="font-weight:500;color:#374151;">' + escHtml(fieldChange.field) + '</span>' +
              '<span style="color:#9ca3af;margin:0 4px;">&#8594;</span>' +
              '<span style="color:#dc2626;text-decoration:line-through;margin-right:4px;">' + escHtml(oldVal) + '</span>' +
              '<span style="color:#16a34a;">' + escHtml(newVal) + '</span>' +
            '</div>';
        }

        if (change.changed_fields.length > maxFields) {
          html += '<div style="font-size:10px;color:#9ca3af;">... and ' +
            (change.changed_fields.length - maxFields) + ' more field(s)</div>';
        }

        html += '</div></div>';
      }

      html += '</div></div>'; // end content + timeline item
    }

    html += '</div>';
    container.innerHTML = html;
  }

  /**
   * Render the changes tab body inside a given container element.
   *
   * @param {HTMLElement} container - The tab body element
   * @param {string}      dataId    - connector_data UUID
   * @param {string}      matterId
   */
  function _renderChangesTab(container, dataId, matterId) {
    container.innerHTML =
      '<p style="font-size:12px;color:#9ca3af;text-align:center;padding:1rem;">Loading changes...</p>';

    _loadChanges(dataId, matterId).then(function (changes) {
      _renderChangeTimeline(container, changes);
    }).catch(function (err) {
      console.error('[WorkspaceData] Load changes failed:', err);
      container.innerHTML =
        '<p style="font-size:12px;color:#ef4444;padding:1rem;">Failed to load change history.</p>';
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Ask LANA panel integration (lex-lana-panel)
  // ═══════════════════════════════════════════════════════════════

  function _initLanaPanel() {
    var panel = document.getElementById('wsDataLana');
    if (!panel) return;

    // Set matter scope once we have it
    if (_matterUuid) {
      panel.setAttribute('matter-id', _matterUuid);
      panel.threadTitle = 'Workspace Data - ' + _matterName;
    }

    // Inject workspace context + pending row attachment on every send
    panel.addEventListener('lex-lana-before-send', function (e) {
      var opts = e.detail.opts;
      opts.attachments = opts.attachments || {};
      opts.attachments.workspace = {
        matter_id: _matterUuid,
        matter_name: _matterName,
        context: 'workspace_connected_data'
      };
      if (_pendingDataAttachment) {
        opts.attachments.connector_data = _pendingDataAttachment;
        _pendingDataAttachment = null;
        _clearDataBadge();
      }
    });

    // Listen for tool switches to update context-type
    panel.addEventListener('lex-lana-tool-select', function (e) {
      var toolId = e.detail && e.detail.toolId;
      if (toolId === 'skills_chat') {
        panel.setContextType('automations_chat');
      } else if (toolId === 'insights_chat') {
        panel.setContextType('insights_chat');
      }
    });
    panel.addEventListener('lex-lana-tool-dismiss', function () {
      panel.setContextType('full_chat');
    });

    // AI action button in table rows — send row data to chat
    document.addEventListener('click', function (e) {
      var aiBtn = e.target.closest('[data-ai-row]');
      if (aiBtn) {
        e.stopPropagation();
        _sendRowToChat(aiBtn.getAttribute('data-ai-row'));
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // CSV import wizard
  // ═══════════════════════════════════════════════════════════════

  function _wireImportWizard() {
    var openBtn = el('wsDataImportBtn');
    if (openBtn && !openBtn._wired) {
      openBtn._wired = true;
      openBtn.addEventListener('click', function () {
        _openImportWizard();
      });
    }

    var fileInput = el('wsImportFile');
    if (fileInput && !fileInput._wired) {
      fileInput._wired = true;
      fileInput.addEventListener('change', function () {
        _importWizard.file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        _syncImportFileUi();
      });
    }

    _wireImportButton('wsImportCancelUpload', function () { _closeImportWizard(); });
    _wireImportButton('wsImportCloseDone', function () { _closeImportWizard(); });
    _wireImportButton('wsImportBackToUpload', function () { _setImportStep('upload'); });
    _wireImportButton('wsImportBackToMapping', function () { _setImportStep('mapping'); });
    _wireImportButton('wsImportUploadAction', function () { _uploadCsvImport(); });
    _wireImportButton('wsImportSaveMapping', function () { _saveImportMapping(false); });
    _wireImportButton('wsImportValidateAction', function () { _validateCsvImport(); });
    _wireImportButton('wsImportRefreshRows', function () { _loadImportRows(); });
    var promoteReviewBtn = el('wsImportPromoteAction');
    if (promoteReviewBtn) promoteReviewBtn.textContent = 'Review Promotion';
    _wireImportButton('wsImportPromoteAction', function () { _reviewCsvImportPromotion(); });
    _wireImportRowSelection();
    _wireCustomFieldApproval();
    _wireImportSpotCheckConfirmation();
    _wireImportPlanConfirmation();
    _wireImportPromotionActions();
    _wireImportHistory();
    _wireImportButton('wsImportReloadData', function () {
      _closeImportWizard();
      _loadData();
      _loadImportRollup(true);
      _loadImportHistory();
    });
  }

  function _wireImportButton(id, handler) {
    var btn = el(id);
    if (!btn || btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      if (btn.disabled || btn.getAttribute('disabled') === 'true' || _importWizard.busy) return;
      handler();
    });
  }

  function _wireImportRowSelection() {
    var rowsEl = el('wsImportValidationRows');
    if (!rowsEl || rowsEl._wiredImportSelection) return;
    rowsEl._wiredImportSelection = true;

    var handleChange = function (event) {
      var control = event.target && event.target.closest
        ? event.target.closest('[data-import-row-selector="true"]')
        : null;
      if (!control) return;
      var rowId = control.getAttribute('data-import-row-id') || '';
      if (!rowId) return;
      var checked = event.detail && event.detail.value !== undefined
        ? !!event.detail.value
        : !!control.checked;
      _setImportRowSelected(rowId, checked);
      _importWizard.spotCheckConfirmed = false;
      _importWizard.importPlanConfirmation = '';
      _renderImportWizard();
    };

    rowsEl.addEventListener('lex-change', handleChange);
    rowsEl.addEventListener('change', handleChange);
  }

  function _wireCustomFieldApproval() {
    var control = el('wsImportCustomFieldApproved');
    if (!control || control._wiredCustomFieldApproval) return;
    control._wiredCustomFieldApproval = true;

    var applyApproved = function (checked) {
      _importWizard.customFieldApproved = !!checked;
      _syncImportCustomFieldApproval();
      _syncImportMappingActionButtons();
    };

    var handleChange = function (event) {
      var checked = event.detail && event.detail.value !== undefined
        ? !!event.detail.value
        : !!control.checked;
      applyApproved(checked);
    };

    control.addEventListener('lex-change', handleChange);
    control.addEventListener('change', handleChange);
    control.addEventListener('click', function (event) {
      if (control.disabled || event.target !== control) return;
      applyApproved(!control.checked);
    });
  }

  function _wireImportSpotCheckConfirmation() {
    var control = el('wsImportSpotCheckConfirmed');
    if (!control || control._wiredImportSpotCheck) return;
    control._wiredImportSpotCheck = true;

    var applyConfirmed = function (checked) {
      _importWizard.spotCheckConfirmed = !!checked;
      _syncImportPromoteButton();
    };

    var handleChange = function (event) {
      var checked = event.detail && event.detail.value !== undefined
        ? !!event.detail.value
        : !!control.checked;
      applyConfirmed(checked);
    };

    control.addEventListener('lex-change', handleChange);
    control.addEventListener('change', handleChange);
    control.addEventListener('click', function (event) {
      if (control.disabled || event.target !== control) return;
      applyConfirmed(!control.checked);
    });
  }

  function _wireImportPlanConfirmation() {
    var container = el('wsImportPlan');
    if (!container || container._wiredImportPlanConfirmation) return;
    container._wiredImportPlanConfirmation = true;

    container.addEventListener('input', function (event) {
      var input = event.target && event.target.closest
        ? event.target.closest('#wsImportPlanConfirmation')
        : null;
      if (!input) return;
      _importWizard.importPlanConfirmation = input.value || '';
      _syncImportPromoteButton();
    });
  }

  function _wireImportPromotionActions() {
    var container = el('wsImportPromotionRows');
    if (!container || container._wiredImportPromotionActions) return;
    container._wiredImportPromotionActions = true;

    container.addEventListener('click', function (event) {
      var target = event.target && event.target.closest
        ? event.target.closest('[data-import-run-promotion], [data-import-back-validation]')
        : null;
      if (!target) return;
      event.preventDefault();
      if (target.hasAttribute('data-import-back-validation')) {
        _setImportStep('validation');
        return;
      }
      _promoteCsvImport();
    });
  }

  function _openImportWizard() {
    var modal = el('wsDataImportModal');
    if (!modal) return;
    if (!_importWizard.job) {
      _resetImportWizard();
    }
    _renderImportWizard();
    modal.open = true;
  }

  function _closeImportWizard() {
    var modal = el('wsDataImportModal');
    if (modal) modal.open = false;
  }

  function _resetImportWizard() {
    _importWizard = {
      step: 'upload',
      file: null,
      job: null,
      mapping: null,
      preview: null,
      validation: null,
      promotion: null,
      rows: [],
      selectedRowIds: {},
      customFieldApproved: false,
      spotCheckConfirmed: false,
      importPlanConfirmation: '',
      busy: false
    };
    var fileInput = el('wsImportFile');
    if (fileInput) fileInput.value = '';
    var sourceInput = el('wsImportSourceName');
    if (sourceInput) sourceInput.value = '';
    _syncImportFileUi();
  }

  function _setImportStep(step) {
    _importWizard.step = step || 'upload';
    _renderImportWizard();
  }

  function _setImportBusy(isBusy) {
    _importWizard.busy = !!isBusy;
    var ids = [
      'wsImportUploadAction',
      'wsImportSaveMapping',
      'wsImportValidateAction',
      'wsImportRefreshRows',
      'wsImportPromoteAction',
      'wsImportReloadData'
    ];
    for (var i = 0; i < ids.length; i++) {
      var btn = el(ids[i]);
      if (btn) btn.disabled = _importWizard.busy;
    }
    _syncImportPromoteButton();
    _syncImportCustomFieldApproval();
    _syncImportMappingActionButtons();
  }

  function _syncImportFileUi() {
    var nameEl = el('wsImportFileName');
    var metaEl = el('wsImportFileMeta');
    var sourceEl = el('wsImportSourceName');
    var file = _importWizard.file;
    if (!nameEl || !metaEl) return;

    if (!file) {
      nameEl.textContent = 'Choose a CSV file';
      metaEl.textContent = 'Up to the backend CSV upload limit';
      return;
    }

    nameEl.textContent = file.name;
    metaEl.textContent = _formatBytes(file.size) + ' selected';
    if (sourceEl && !sourceEl.value.trim()) {
      sourceEl.value = file.name.replace(/\.csv$/i, '');
    }
  }

  function _renderImportWizard() {
    _renderImportSteps();
    _renderImportBadges();
    _renderImportPreviewSummary();
    _renderImportEntitySelect();
    _renderImportMappingRows();
    _syncImportCustomFieldApproval();
    _renderImportValidation();
    _renderImportPlan();
    _renderImportPromotion();
  }

  function _renderImportSteps() {
    var order = ['upload', 'mapping', 'validation', 'promotion'];
    var activeIdx = order.indexOf(_importWizard.step);
    if (activeIdx < 0) activeIdx = 0;

    for (var i = 0; i < order.length; i++) {
      var step = order[i];
      var marker = document.querySelector('[data-step-marker="' + step + '"]');
      var pane = document.querySelector('[data-step-pane="' + step + '"]');
      if (marker) {
        marker.classList.toggle('is-active', i === activeIdx);
        marker.classList.toggle('is-complete', i < activeIdx);
      }
      if (pane) {
        pane.classList.toggle('is-active', i === activeIdx);
      }
    }
  }

  function _renderImportBadges() {
    var job = _importWizard.job || {};
    var status = job.status || (_importWizard.preview ? 'mapping' : 'ready');
    _setBadge('wsImportUploadBadge', _importWizard.preview ? 'Uploaded' : 'Ready', _importWizard.preview ? 'blue' : 'gray');
    _setBadge('wsImportMappingBadge', _importWizard.mapping ? _formatStatusLabel(status) : 'Not uploaded', _importWizard.mapping ? 'blue' : 'gray');

    var validationSummary = _getImportValidationSummary();
    var validationLabel = validationSummary
      ? validationSummary.validRows + ' valid / ' + validationSummary.invalidRows + ' invalid' +
        (validationSummary.duplicateRows ? ' / ' + validationSummary.duplicateRows + ' duplicate' : '')
      : 'Not validated';
    _setBadge('wsImportValidationBadge', validationLabel, validationSummary && validationSummary.invalidRows > 0 ? 'yellow' : (validationSummary ? 'green' : 'gray'));

    var promotionSummary = _getImportPromotionSummary();
    var promotionLabel = promotionSummary
      ? _promotionReadyCount(promotionSummary) + ' ready'
      : 'Not imported';
    _setBadge('wsImportPromotionBadge', promotionLabel, promotionSummary && promotionSummary.failedRows > 0 ? 'red' : (promotionSummary ? 'green' : 'gray'));
  }

  function _setBadge(id, label, color) {
    var badge = el(id);
    if (!badge) return;
    badge.setAttribute('label', label);
    badge.setAttribute('color', color || 'gray');
  }

  function _renderImportPreviewSummary() {
    var container = el('wsImportPreviewSummary');
    if (!container) return;
    var preview = _importWizard.preview || {};
    var job = _importWizard.job || {};
    if (!_importWizard.preview) {
      container.innerHTML = _emptyImportMessage('Upload a CSV to review inferred columns.');
      return;
    }

    container.innerHTML =
      _metricHtml('Source', job.source_name || job.sourceName || _fileSourceName()) +
      _metricHtml('Rows', preview.total_rows || preview.totalRows || 0) +
      _metricHtml('Columns', preview.column_count || preview.columnCount || _getImportHeaders().length) +
      _metricHtml('Delimiter', preview.detected_delimiter || preview.detectedDelimiter || ',');
  }

  function _renderImportEntitySelect() {
    var select = el('wsImportEntityType');
    if (!select) return;
    var current = (_importWizard.mapping && (_importWizard.mapping.entityType || _importWizard.mapping.entity_type)) ||
      (_importWizard.job && (_importWizard.job.target_entity_type || _importWizard.job.targetEntityType)) ||
      'lead';
    var html = '';
    for (var i = 0; i < _importEntityOptions.length; i++) {
      var opt = _importEntityOptions[i];
      html += '<option value="' + _escAttr(opt.value) + '"' + (opt.value === current ? ' selected' : '') + '>' + _escHtml(opt.label) + '</option>';
    }
    select.innerHTML = html;
    if (!select._wired) {
      select._wired = true;
      select.addEventListener('change', function () {
        if (!_importWizard.mapping) return;
        _importWizard.mapping.entityType = select.value;
        _importWizard.customFieldApproved = false;
        _importWizard.spotCheckConfirmed = false;
        _importWizard.importPlanConfirmation = '';
        _renderImportMappingRows();
        _syncImportCustomFieldApproval();
        _syncImportMappingActionButtons();
        _renderImportPlan();
        _syncImportPromoteButton();
      });
    }
  }

  function _renderImportMappingRows() {
    var body = el('wsImportMappingRows');
    if (!body) return;
    var mapping = _getImportMapping();
    var headers = _getImportHeaders();
    if (!mapping || !headers.length) {
      body.innerHTML = '<tr><td colspan="4">' + _emptyImportMessage('No CSV columns available yet.') + '</td></tr>';
      return;
    }

    var rowsBySource = {};
    var rows = _normalizeImportMappings(mapping);
    for (var r = 0; r < rows.length; r++) {
      rowsBySource[rows[r].sourceColumn] = rows[r];
    }

    var html = '';
    for (var i = 0; i < headers.length; i++) {
      var source = headers[i];
      var row = rowsBySource[source] || {
        sourceColumn: source,
        targetField: null,
        customFieldKey: _toCustomFieldKey(source),
        status: 'custom_field',
        confidence: 0
      };
      html += _mappingRowHtml(row, i);
    }
    body.innerHTML = html;
    _wireMappingRowControls();
  }

  function _mappingRowHtml(row, index) {
    var entityType = (_importWizard.mapping && _importWizard.mapping.entityType) || 'lead';
    var fields = _importFieldOptions[entityType] || _importFieldOptions.lead;
    var targetField = row.targetField || row.target_field || '';
    var status = row.status || (targetField ? 'mapped' : 'unmapped');
    var isCustomField = _isImportCustomFieldMapping(row);
    var mode = isCustomField ? 'custom' : (status === 'unmapped' ? 'unmapped' : 'field:' + targetField);
    var customKey = _customFieldKeyFromMapping(row);
    var confidence = _formatConfidence(row.confidence);
    var sample = _sampleValuesForColumn(row.sourceColumn);
    var guidance = _mappingGuidanceText(row);
    var fieldOptions = fields.slice();
    if (targetField && targetField !== 'custom_fields' && fieldOptions.indexOf(targetField) === -1) {
      fieldOptions.unshift(targetField);
    }

    var readableCustomLabel = _formatFieldLabel(customKey || row.sourceColumn);
    var customPath = 'custom_fields.' + (customKey || _toCustomFieldKey(row.sourceColumn));
    var customPreviewHidden = mode === 'custom' ? '' : ' hidden';
    var guidanceHtml = guidance
      ? '<div class="ws-import-mapping-guidance" data-testid="workspace-csv-mapping-guidance">' + _escHtml(guidance) + '</div>'
      : '';

    var selectHtml =
      '<select class="ws-import-map-mode" data-map-index="' + index + '" data-testid="workspace-csv-mapping-target">' +
        '<option value="unmapped"' + (mode === 'unmapped' ? ' selected' : '') + '>Do not import</option>' +
        '<option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Custom field</option>';
    for (var i = 0; i < fieldOptions.length; i++) {
      var value = fieldOptions[i];
      selectHtml += '<option value="field:' + _escAttr(value) + '"' + (mode === 'field:' + value ? ' selected' : '') + '>' + _escHtml(_formatFieldLabel(value)) + '</option>';
    }
    selectHtml += '</select>';

    return '<tr class="ws-import-map-row' + (mode === 'custom' ? ' is-custom-field' : '') + '" data-source-column="' + _escAttr(row.sourceColumn) + '">' +
      '<td><div class="ws-import-column-name">' + _escHtml(row.sourceColumn) + '</div></td>' +
      '<td><div class="ws-import-column-mode">' +
        selectHtml +
        '<input class="ws-import-custom-key" type="text" value="' + _escAttr(customKey) + '" placeholder="custom_field_key"' + (mode === 'custom' ? '' : ' hidden') + '>' +
        '<div class="ws-import-custom-preview" data-custom-preview' + customPreviewHidden + '>' +
          '<strong>Custom field:</strong> ' + _escHtml(readableCustomLabel) +
          '<span>' + _escHtml(customPath) + '</span>' +
        '</div>' +
        guidanceHtml +
      '</div></td>' +
      '<td><div class="ws-import-samples">' + _escHtml(sample || '-') + '</div></td>' +
      '<td>' + _escHtml(confidence) + '</td>' +
    '</tr>';
  }

  function _wireMappingRowControls() {
    var controls = document.querySelectorAll('.ws-import-map-mode');
    for (var i = 0; i < controls.length; i++) {
      if (controls[i]._wired) continue;
      controls[i]._wired = true;
      controls[i].addEventListener('change', function () {
        var row = this.closest('.ws-import-map-row');
        var customInput = row ? row.querySelector('.ws-import-custom-key') : null;
        var customPreview = row ? row.querySelector('[data-custom-preview]') : null;
        var isCustom = this.value === 'custom';
        if (customInput) customInput.hidden = !isCustom;
        if (customPreview) customPreview.hidden = !isCustom;
        if (row) row.classList.toggle('is-custom-field', isCustom);
        _importWizard.customFieldApproved = false;
        _updateMappingCustomPreview(row);
        _syncImportCustomFieldApproval();
        _syncImportMappingActionButtons();
      });
    }

    var customInputs = document.querySelectorAll('.ws-import-custom-key');
    for (var j = 0; j < customInputs.length; j++) {
      if (customInputs[j]._wiredCustomKey) continue;
      customInputs[j]._wiredCustomKey = true;
      customInputs[j].addEventListener('input', function () {
        _importWizard.customFieldApproved = false;
        _updateMappingCustomPreview(this.closest('.ws-import-map-row'));
        _syncImportCustomFieldApproval();
        _syncImportMappingActionButtons();
      });
    }
  }

  function _updateMappingCustomPreview(row) {
    if (!row) return;
    var preview = row.querySelector('[data-custom-preview]');
    if (!preview) return;
    var source = row.getAttribute('data-source-column') || '';
    var keyEl = row.querySelector('.ws-import-custom-key');
    var key = (keyEl && keyEl.value.trim()) || _toCustomFieldKey(source);
    preview.innerHTML =
      '<strong>Custom field:</strong> ' + _escHtml(_formatFieldLabel(key || source)) +
      '<span>' + _escHtml('custom_fields.' + key) + '</span>';
  }

  function _currentImportMappingForApproval() {
    if (document.querySelector('.ws-import-map-row')) {
      return _collectImportMappingFromDom();
    }
    return _getImportMapping();
  }

  function _syncImportCustomFieldApproval() {
    var container = el('wsImportCustomFieldApproval');
    var list = el('wsImportCustomFieldList');
    var control = el('wsImportCustomFieldApproved');
    if (!container || !list || !control) return;

    var policy = _getCustomFieldApprovalPolicy(_currentImportMappingForApproval());
    var rows = policy.custom_fields || [];
    if (!rows.length) {
      container.hidden = true;
      list.innerHTML = '';
      _importWizard.customFieldApproved = false;
      control.checked = false;
      control.removeAttribute('checked');
      return;
    }

    container.hidden = false;
    list.innerHTML = rows.map(function (row) {
      return '<li><span>' + _escHtml(row.source_column) + '</span><strong>' +
        _escHtml(row.label) + '</strong><code>' + _escHtml(row.target_path) + '</code></li>';
    }).join('');

    control.disabled = !!_importWizard.busy;
    control.checked = !!_importWizard.customFieldApproved;
    if (_importWizard.customFieldApproved) {
      control.setAttribute('checked', 'true');
    } else {
      control.removeAttribute('checked');
    }
  }

  function _syncImportMappingActionButtons() {
    var mapping = _currentImportMappingForApproval();
    var blocked = _isImportCustomFieldApprovalBlocked(mapping);
    var saveBtn = el('wsImportSaveMapping');
    var validateBtn = el('wsImportValidateAction');
    if (saveBtn) saveBtn.disabled = !!_importWizard.busy || blocked;
    if (validateBtn) validateBtn.disabled = !!_importWizard.busy || blocked;
  }

  function _isImportCustomFieldApprovalBlocked(mapping) {
    var policy = _getCustomFieldApprovalPolicy(mapping);
    return !!(policy.required && !policy.approved);
  }

  function _getCustomFieldApprovalPolicy(mapping) {
    var rows = _normalizeImportMappings(mapping).filter(function (row) {
      return _isImportCustomFieldMapping(row);
    }).map(function (row) {
      var key = _customFieldKeyFromMapping(row);
      return {
        source_column: row.sourceColumn,
        custom_field_key: key,
        target_path: 'custom_fields.' + key,
        label: _formatFieldLabel(key)
      };
    });
    return {
      mode: rows.length ? 'explicit_user_approval' : 'no_custom_fields',
      required: rows.length > 0,
      approved: rows.length === 0 || !!_importWizard.customFieldApproved,
      approvedKeys: rows.map(function (row) { return row.custom_field_key; }),
      approved_keys: rows.map(function (row) { return row.custom_field_key; }),
      allow_unapproved_custom_fields: false,
      custom_field_count: rows.length,
      custom_fields: rows
    };
  }

  function _adoptCustomFieldApprovalFromMapping(mapping) {
    var policy = mapping && (mapping.customFieldPolicy || mapping.custom_field_policy ||
      mapping.customFieldApprovalPolicy || mapping.custom_field_approval_policy);
    _importWizard.customFieldApproved = !!(policy && policy.required && policy.approved);
  }

  function _mergeCustomFieldPolicy(mapping, policy) {
    if (!mapping || !policy || !policy.required || !policy.approved) return mapping;
    if (mapping.customFieldPolicy || mapping.custom_field_policy ||
        mapping.customFieldApprovalPolicy || mapping.custom_field_approval_policy) {
      return mapping;
    }
    return Object.assign({}, mapping, {
      customFieldPolicy: policy,
      custom_field_policy: policy,
      customFieldApprovalPolicy: policy,
      custom_field_approval_policy: policy
    });
  }

  function _renderImportValidation() {
    var summaryEl = el('wsImportValidationSummary');
    var rowsEl = el('wsImportValidationRows');
    if (!summaryEl || !rowsEl) return;

    var summary = _getImportValidationSummary();
    if (!summary) {
      summaryEl.innerHTML = _emptyImportMessage('Validation will show row quality after the mapping is saved.');
      rowsEl.innerHTML = '<tr><td colspan="5">' + _emptyImportMessage('No validation rows yet.') + '</td></tr>';
      _syncImportSpotCheckControl(0);
      _syncImportPromoteButton(0);
      return;
    }

    var rows = _normalizeImportRows(_importWizard.rows.length ? _importWizard.rows : ((_importWizard.validation && _importWizard.validation.outcomes) || []));
    _syncImportRowSelection(rows);
    var selection = _getImportSelectionCounts(rows, summary);

    summaryEl.innerHTML =
      _metricHtml('Total rows', summary.totalRows) +
      _metricHtml('Valid', summary.validRows) +
      _metricHtml('Selected', selection.selectedRows) +
      _metricHtml('Importable', selection.importableRows) +
      (selection.duplicateRows || summary.duplicateRows ? _metricHtml('Duplicates', selection.duplicateRows || summary.duplicateRows) : '') +
      _metricHtml('Invalid', summary.invalidRows) +
      '<div class="ws-import-selection-summary" data-testid="workspace-csv-import-selection-summary">' +
        _escHtml(_importSelectionSummaryText(selection)) +
      '</div>';
    _syncImportSpotCheckControl(selection.selectedRows);
    _syncImportPromoteButton(selection.selectedRows);

    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="5">' + _emptyImportMessage('No row details returned.') + '</td></tr>';
      return;
    }

    var html = '';
    for (var i = 0; i < rows.length && i < 100; i++) {
      html += _validationRowHtml(rows[i]);
    }
    rowsEl.innerHTML = html;
  }

  function _renderImportPlan() {
    var container = el('wsImportPlan');
    if (!container) return;

    var plan = _getImportPlan();
    if (!plan) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    container.hidden = false;
    var riskHtml = plan.riskReasons.length
      ? '<ul class="ws-import-plan-risks">' + plan.riskReasons.map(function (reason) {
          return '<li>' + _escHtml(reason) + '</li>';
        }).join('') + '</ul>'
      : '<div class="ws-import-plan-empty">No elevated risk reasons detected.</div>';

    var confirmationHtml = plan.requiresTypedConfirmation
      ? '<label class="ws-import-plan-confirmation">' +
          '<span>Type IMPORT to enable promotion</span>' +
          '<input id="wsImportPlanConfirmation" data-testid="workspace-csv-import-plan-confirmation" type="text" autocomplete="off" value="' +
            _escAttr(_importWizard.importPlanConfirmation || '') + '">' +
        '</label>'
      : '<div class="ws-import-plan-confirmed" data-testid="workspace-csv-import-plan-confirmed">Plan confirmation will be recorded when promoted.</div>';

    container.innerHTML =
      '<div class="ws-import-plan-head">' +
        '<div>' +
          '<h4>Import Plan</h4>' +
          '<p>Review the import scope before promoting validated rows.</p>' +
        '</div>' +
        '<lex-badge label="' + _escAttr(plan.requiresTypedConfirmation ? 'Review required' : 'Standard plan') + '" color="' +
          (plan.requiresTypedConfirmation ? 'yellow' : 'green') + '" size="sm"></lex-badge>' +
      '</div>' +
      '<div class="ws-import-plan-grid">' +
        _planItemHtml('Target entity', plan.targetEntityLabel) +
        _planItemHtml('Selected rows', plan.selectedRows + ' of ' + plan.importableRows + ' importable') +
        _planItemHtml('Mapped columns', plan.mappedColumnCount + ' of ' + plan.totalColumnCount) +
        _planItemHtml('Skipped rows', String(plan.skippedRows)) +
        _planItemHtml('Invalid rows', String(plan.invalidRows)) +
      '</div>' +
      '<div class="ws-import-plan-risk-block">' +
        '<strong>Risk reasons</strong>' +
        riskHtml +
      '</div>' +
      confirmationHtml;
  }

  function _planItemHtml(label, value) {
    return '<div class="ws-import-plan-item"><span>' + _escHtml(label) + '</span><strong>' + _escHtml(value) + '</strong></div>';
  }

  function _syncImportSpotCheckControl(selectedRows) {
    var control = el('wsImportSpotCheckConfirmed');
    if (!control) return;
    var hasRows = Number(selectedRows || 0) > 0;
    control.disabled = !!_importWizard.busy || !hasRows;
    control.checked = hasRows && !!_importWizard.spotCheckConfirmed;
    if (hasRows && _importWizard.spotCheckConfirmed) {
      control.setAttribute('checked', 'true');
    } else {
      control.removeAttribute('checked');
    }
  }

  function _validationRowHtml(row) {
    var status = row.status || row.validation_status || 'pending';
    var duplicateInfo = _duplicateInfo(row);
    var rowId = _importRowId(row);
    var selectable = _isImportRowSelectable(row);
    var selected = selectable && _isImportRowSelected(row);
    var rowNumber = row.rowNumber || row.row_number || (row.rowIndex !== undefined ? row.rowIndex + 1 : '-');
    var mapped = row.mappedEntity || row.mapped_data || row.normalized_data || {};
    var errors = row.errors || row.validation_errors || [];
    var issueText = _rowIssueText(row, errors, duplicateInfo);
    var rowClass = [];
    if (!selected && selectable) rowClass.push('is-skipped-by-user');
    if (duplicateInfo.isDuplicateLike) rowClass.push('is-duplicate-review');
    return '<tr' + (rowClass.length ? ' class="' + _escAttr(rowClass.join(' ')) + '"' : '') + '>' +
      '<td>' + _importRowSelectorHtml(row, rowId, selectable, selected) + '</td>' +
      '<td>' + _escHtml(String(rowNumber)) + '</td>' +
      '<td>' + _rowStatusHtml(status, duplicateInfo) + '</td>' +
      '<td>' + _mappedDataHtml(mapped) + '</td>' +
      '<td><div class="ws-import-samples">' + _escHtml(issueText || '-') + '</div></td>' +
    '</tr>';
  }

  function _rowStatusHtml(status, duplicateInfo) {
    var normalized = _normalizeImportStatus(status);
    var classStatus = duplicateInfo && duplicateInfo.isDuplicateLike
      ? (duplicateInfo.status || normalized)
      : normalized;
    var label = duplicateInfo && duplicateInfo.isDuplicateLike
      ? (duplicateInfo.label || _formatStatusLabel(normalized))
      : _formatStatusLabel(normalized);
    var html = '<span class="ws-import-row-status is-' + _escAttr(classStatus) + '">' + _escHtml(label) + '</span>';
    if (duplicateInfo && duplicateInfo.matchLabel) {
      html += '<small class="ws-import-duplicate-match">' + _escHtml(duplicateInfo.matchLabel) + '</small>';
    }
    return html;
  }

  function _importRowSelectorHtml(row, rowId, selectable, selected) {
    var rowNumber = row.rowNumber || row.row_number || (row.rowIndex !== undefined ? row.rowIndex + 1 : '');
    var disabled = !selectable || !rowId;
    return '<lex-checkbox class="ws-import-row-selector" data-import-row-selector="true"' +
      ' data-import-row-id="' + _escAttr(rowId) + '"' +
      ' data-testid="workspace-csv-import-row-selector"' +
      ' label="Import row ' + _escAttr(String(rowNumber || rowId || '')) + '"' +
      (selected ? ' checked="true"' : '') +
      (disabled ? ' disabled="true"' : '') +
    '></lex-checkbox>';
  }

  function _mappedDataHtml(mapped) {
    if (!mapped || typeof mapped !== 'object' || Array.isArray(mapped)) {
      return '<div class="ws-import-empty-value">-</div>';
    }
    var entries = Object.keys(mapped).filter(function (key) {
      var value = mapped[key];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
    if (!entries.length) {
      return '<div class="ws-import-empty-value">-</div>';
    }
    return '<dl class="ws-import-field-list">' + entries.map(function (key) {
      return '<div class="ws-import-field-row">' +
        '<dt>' + _escHtml(_formatFieldLabel(key)) + '</dt>' +
        '<dd>' + _escHtml(_formatMappedValue(mapped[key])) + '</dd>' +
      '</div>';
    }).join('') + '</dl>';
  }

  function _formatMappedValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    if (Array.isArray(value)) {
      return value.map(_formatMappedValue).filter(function (item) {
        return item && item !== '-';
      }).join(', ') || '-';
    }
    if (typeof value === 'object') {
      return Object.keys(value).map(function (key) {
        return _formatFieldLabel(key) + ': ' + _formatMappedValue(value[key]);
      }).join('; ') || '-';
    }
    return String(value);
  }

  function _renderImportPromotion() {
    var summaryEl = el('wsImportPromotionSummary');
    var rowsEl = el('wsImportPromotionRows');
    if (!summaryEl || !rowsEl) return;

    var summary = _getImportPromotionSummary();
    if (!summary) {
      var plan = _getImportPlan();
      var previewRows = _normalizeImportRows(_importWizard.rows.length ? _importWizard.rows : ((_importWizard.validation && _importWizard.validation.outcomes) || []));
      if (!plan || !previewRows.length) {
        var reloadBtn = el('wsImportReloadData');
        if (reloadBtn) reloadBtn.hidden = true;
        summaryEl.innerHTML = _emptyImportMessage('Validate rows before reviewing the promotion plan.');
        rowsEl.innerHTML = '';
        return;
      }
      var hiddenReloadBtn = el('wsImportReloadData');
      if (hiddenReloadBtn) hiddenReloadBtn.hidden = true;
      var previewGroups = _getPromotionPreviewGroups(previewRows);

      summaryEl.innerHTML =
        _promotionPreviewReadinessHtml(plan) +
        _metricHtml('Selected', plan.selectedRows) +
        _metricHtml('Will create', previewGroups.create.length) +
        _metricHtml('Will update', previewGroups.update.length) +
        _metricHtml('Will skip', previewGroups.skip.length);
      rowsEl.innerHTML = _promotionPreviewHtml(previewRows, plan, previewGroups);
      return;
    }
    var reloadDataBtn = el('wsImportReloadData');
    if (reloadDataBtn) reloadDataBtn.hidden = false;

    summaryEl.innerHTML =
      _automationReadinessHtml(summary) +
      _metricHtml('Total rows', summary.totalRows) +
      _metricHtml('Imported', summary.promotedRows) +
      _metricHtml('Created', summary.createdRows) +
      _metricHtml('Updated', summary.updatedRows) +
      _metricHtml('Failed', summary.failedRows) +
      _metricHtml('Skipped', summary.skippedRows);

    var rows = _normalizeImportRows(_getImportPromotionRows());
    rowsEl.innerHTML = _promotionResultsHtml(rows) ||
      '<div class="ws-import-result-row"><span>No row-level promotion results returned.</span></div>';
  }

  function _promotionPreviewHtml(rows, plan, groups) {
    groups = groups || _getPromotionPreviewGroups(rows);
    return '<div class="ws-import-promotion-preview" data-testid="workspace-csv-import-promotion-preview">' +
      '<div class="ws-import-promotion-preview-head">' +
        '<div>' +
          '<h4>Promotion Preview</h4>' +
          '<p>Review the records the backend will be asked to create, update, or skip.</p>' +
        '</div>' +
        '<lex-badge label="' + _escAttr(plan.targetEntityLabel) + '" color="blue" size="sm"></lex-badge>' +
      '</div>' +
      '<div class="ws-import-promotion-groups">' +
        _promotionGroupHtml({
          title: 'Create',
          badge: groups.create.length + (groups.create.length === 1 ? ' record' : ' records'),
          rows: groups.create,
          groupClass: 'is-create',
          rowRenderer: function (row, index) {
            return _promotionPreviewRowHtml(row, index, plan.targetEntity, 'create');
          },
          emptyText: 'No new records will be created.'
        }) +
        _promotionGroupHtml({
          title: 'Update',
          badge: groups.update.length + (groups.update.length === 1 ? ' record' : ' records'),
          rows: groups.update,
          groupClass: 'is-update',
          rowRenderer: function (row, index) {
            return _promotionPreviewRowHtml(row, index, plan.targetEntity, 'update');
          },
          emptyText: 'No existing records will be updated.'
        }) +
        _promotionGroupHtml({
          title: 'Skip',
          badge: groups.skip.length + (groups.skip.length === 1 ? ' record' : ' records'),
          rows: groups.skip,
          groupClass: 'is-skip',
          rowRenderer: function (row, index) {
            return _promotionPreviewRowHtml(row, index, plan.targetEntity, 'skip');
          },
          emptyText: 'No records will be skipped.'
        }) +
      '</div>' +
      '<div class="ws-import-promotion-actions">' +
        '<lex-btn variant="secondary" size="sm" data-import-back-validation="true">Back to Validation</lex-btn>' +
        '<lex-btn id="wsImportRunPromotion" data-testid="workspace-csv-import-run-promotion" variant="primary" size="sm" leading-icon="upload" data-import-run-promotion="true"' +
          (_importWizard.busy ? ' disabled="true"' : '') + '>Promote Import</lex-btn>' +
      '</div>' +
    '</div>';
  }

  function _promotionResultsHtml(rows) {
    if (!rows.length) return '';
    var groups = {};
    var order = [];
    for (var i = 0; i < rows.length && i < 100; i++) {
      var row = rows[i];
      var status = _normalizePromotionStatus(row);
      var entity = row.entity || {};
      var entityType = String(entity.entityType || entity.entity_type || row.entityType || row.entity_type || 'record').toLowerCase();
      var key = entityType + ':' + status;
      if (!groups[key]) {
        groups[key] = {
          title: _formatEntityType(entityType) + ' - ' + _formatStatusLabel(status),
          badge: '0 rows',
          rows: []
        };
        order.push(key);
      }
      groups[key].rows.push(row);
    }

    return '<div class="ws-import-promotion-groups" data-testid="workspace-csv-import-promotion-results">' +
      order.map(function (key) {
        var group = groups[key];
        group.badge = group.rows.length + (group.rows.length === 1 ? ' row' : ' rows');
        return _promotionGroupHtml({
          title: group.title,
          badge: group.badge,
          rows: group.rows,
          rowRenderer: _promotionResultRowHtml,
          emptyText: ''
        });
      }).join('') +
    '</div>';
  }

  function _promotionGroupHtml(options) {
    var rows = options.rows || [];
    var body = rows.length
      ? rows.map(options.rowRenderer).join('')
      : '<div class="ws-import-result-row"><span>' + _escHtml(options.emptyText || 'No records.') + '</span></div>';
    return '<section class="ws-import-promotion-group ' + _escAttr(options.groupClass || '') + '">' +
      '<div class="ws-import-promotion-group-head">' +
        '<strong>' + _escHtml(options.title || 'Records') + '</strong>' +
        '<span>' + _escHtml(options.badge || String(rows.length)) + '</span>' +
      '</div>' +
      '<div class="ws-import-result-list">' + body + '</div>' +
    '</section>';
  }

  function _promotionPreviewRowHtml(row, index, entityType, action) {
    var rowNumber = row.rowNumber || (row.rowIndex !== undefined ? row.rowIndex + 1 : index + 1);
    var mapped = row.mappedEntity || row.mapped_data || row.normalized_data || {};
    var title = _promotionPreviewTitle(mapped, entityType);
    var skipped = action === 'skip';
    var issueText = skipped
      ? (_promotionPreviewSkipReason(row) || 'Not selected or not importable')
      : _mappedDataSummaryText(mapped);
    return '<div class="ws-import-result-row" data-testid="workspace-csv-import-promotion-preview-row">' +
      '<div class="ws-import-result-main">' +
        '<strong>Row ' + _escHtml(String(rowNumber)) + '</strong>' +
        '<span>' + _escHtml(title) + '</span>' +
        (issueText ? '<small>' + _escHtml(issueText) + '</small>' : '') +
      '</div>' +
      '<span class="ws-import-row-status is-' + _escAttr(action === 'create' ? 'created' : (action === 'update' ? 'updated' : 'skipped')) + '">' +
        _escHtml(action === 'create' ? 'Create' : (action === 'update' ? 'Update' : 'Skip')) +
      '</span>' +
    '</div>';
  }

  function _promotionPreviewReadinessHtml(plan) {
    var ready = plan && plan.selectedRows > 0 && _importWizard.spotCheckConfirmed && _isImportPlanConfirmed(plan);
    var detail = ready
      ? 'Promotion will run from this step using the reviewed row selection.'
      : _getImportPromotionBlockedMessage(_normalizeImportRows(_importWizard.rows || []));
    return '<div class="ws-import-readiness ' + (ready ? 'is-ready' : 'is-pending') + '" data-testid="workspace-csv-import-promotion-preview-readiness">' +
      '<strong>' + _escHtml(ready ? 'Ready to promote' : 'Promotion review incomplete') + '</strong>' +
      '<span>' + _escHtml(detail) + '</span>' +
    '</div>';
  }

  function _getPromotionPreviewGroups(rows) {
    var groups = { create: [], update: [], skip: [] };
    rows = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < rows.length; i++) {
      groups[_promotionPreviewAction(rows[i])].push(rows[i]);
    }
    return groups;
  }

  function _promotionPreviewAction(row) {
    var rowId = _importRowId(row);
    var selected = rowId && _isImportRowSelectable(row) && _importWizard.selectedRowIds[rowId] === true;
    if (!selected) return 'skip';

    var status = _normalizePromotionStatus({
      promotionStatus: row.promotionStatus,
      action: row.promotionAction || row.action,
      status: row.promotionStatus || row.status,
      entity: row.entity
    });
    if (status === 'updated') return 'update';
    if (status === 'skipped' || status === 'failed') return 'skip';
    return 'create';
  }

  function _promotionPreviewSkipReason(row) {
    if (!_isImportRowSelectable(row)) {
      var duplicateInfo = _duplicateInfo(row);
      if (duplicateInfo.isDuplicateLike) return duplicateInfo.reason || 'Duplicate review required';
      return row.reason || 'Not importable';
    }
    if (!_isImportRowSelected(row)) return 'Not selected for import';
    return row.reason || 'Backend preview marks this row to skip';
  }

  function _promotionPreviewTitle(mapped, entityType) {
    mapped = mapped || {};
    return mapped.name || mapped.title || mapped.email || mapped.company || mapped.company_name ||
      _formatEntityType(entityType || 'record');
  }

  function _mappedDataSummaryText(mapped) {
    mapped = mapped || {};
    var keys = Object.keys(mapped).filter(function (key) {
      return key !== 'metadata' && key !== 'custom_fields' &&
        mapped[key] !== undefined && mapped[key] !== null && String(mapped[key]).trim() !== '';
    });
    if (!keys.length && mapped.custom_fields && typeof mapped.custom_fields === 'object') {
      keys = Object.keys(mapped.custom_fields).map(function (key) { return 'custom_fields.' + key; });
    }
    return keys.slice(0, 4).map(function (key) {
      var value = key.indexOf('custom_fields.') === 0
        ? mapped.custom_fields[key.slice('custom_fields.'.length)]
        : mapped[key];
      return _formatFieldLabel(key) + ': ' + _formatMappedValue(value);
    }).join(' | ');
  }

  function _automationReadinessHtml(summary) {
    var readyCount = _promotionReadyCount(summary);
    var isReady = readyCount > 0;
    var title = isReady ? 'Automation ready' : 'Automation pending';
    var detail = isReady
      ? readyCount + ' canonical ' + (readyCount === 1 ? 'entity' : 'entities') + ' available.'
      : 'No created or updated canonical entities were returned.';
    return '<div class="ws-import-readiness ' + (isReady ? 'is-ready' : 'is-pending') + '" data-testid="workspace-csv-import-readiness">' +
      '<strong>' + _escHtml(title) + '</strong>' +
      '<span>' + _escHtml(detail) + '</span>' +
    '</div>';
  }

  function _promotionResultRowHtml(row, index) {
    var status = _normalizePromotionStatus(row);
    var entity = row.entity || {};
    var entityType = entity.entityType || entity.entity_type || row.entityType || row.entity_type || '';
    var entityId = entity.entityId || entity.entity_id || row.entityId || row.entity_id || '';
    var entityLabel = entity.displayName || entity.display_name || entity.label || entity.name || entity.title || '';
    var href = _canonicalEntityHref(entity, row);
    var rowNumber = row.rowNumber || (row.rowIndex !== undefined ? row.rowIndex + 1 : index + 1);
    var summary = _formatEntityType(entityType || 'record') + (entityId ? ' ' + entityId : '');
    var label = entityLabel || summary;
    var reason = row.reason || row.skipReason || row.skip_reason || row.error || row.message || '';
    var entityHtml = href
      ? '<a class="ws-import-entity-link" href="' + _escAttr(href) + '">' + _escHtml(label) + '</a>'
      : '<span class="ws-import-entity-label">' + _escHtml(label || '-') + '</span>';

    return '<div class="ws-import-result-row" data-testid="workspace-csv-import-result-row">' +
      '<div class="ws-import-result-main">' +
        '<strong>Row ' + _escHtml(String(rowNumber)) + '</strong>' +
        '<span>' + entityHtml + '</span>' +
        (reason ? '<small>' + _escHtml(reason) + '</small>' : '') +
      '</div>' +
      '<span class="ws-import-row-status is-' + _escAttr(status) + '">' + _escHtml(status) + '</span>' +
    '</div>';
  }

  function _uploadCsvImport() {
    if (_importWizard.busy) return;
    var file = _importWizard.file;
    if (!file) {
      _toastError('Choose a CSV file first');
      return;
    }

    var form = new FormData();
    form.append('file', file);
    form.append('source_name', (el('wsImportSourceName') && el('wsImportSourceName').value.trim()) || _fileSourceName());
    form.append('import_intent', (el('wsImportIntent') && el('wsImportIntent').value) || 'mixed');
    form.append('duplicate_policy', (el('wsImportDuplicatePolicy') && el('wsImportDuplicatePolicy').value) || 'skip_likely_duplicates');
    form.append('import_policy', 'stage_only');
    form.append('timezone', (el('wsImportTimezone') && el('wsImportTimezone').value.trim()) || _browserTimezone());

    _setImportBusy(true);
    api.post(_importPath('/csv'), form)
      .then(function (result) {
        var payload = _unwrapData(result);
        _importWizard.job = payload.import_session || payload.importSession || payload;
        _importWizard.mapping = payload.mapping || _importWizard.job.mapping_state || _importWizard.job.mappingState || null;
        _adoptCustomFieldApprovalFromMapping(_importWizard.mapping);
        _importWizard.preview = payload.preview || _previewFromJob(_importWizard.job);
        _importWizard.validation = null;
        _importWizard.promotion = null;
        _importWizard.rows = [];
        _importWizard.selectedRowIds = {};
        _importWizard.spotCheckConfirmed = false;
        _importWizard.importPlanConfirmation = '';
        _loadImportRollup(true);
        _loadImportHistory();
        _updateImportStrip();
        _setImportStep('mapping');
        _toastSuccess('CSV uploaded and mapping inferred');
      })
      .catch(function (err) {
        console.error('[WorkspaceData] CSV upload failed:', err);
        _toastError(_apiErrorMessage(err, 'CSV upload failed'));
      })
      .finally(function () {
        _setImportBusy(false);
      });
  }

  function _saveImportMapping(stayOnStep) {
    if (_importWizard.busy) return Promise.resolve(null);
    var jobId = _getImportJobId();
    if (!jobId) {
      _toastError('Upload a CSV before saving mapping');
      return Promise.resolve(null);
    }

    var mapping = _collectImportMappingFromDom();
    var approvedCustomFieldPolicy = mapping.customFieldPolicy;
    if (_isImportCustomFieldApprovalBlocked(mapping)) {
      _toastError('Approve the custom field mapping before saving or validating');
      _syncImportCustomFieldApproval();
      _syncImportMappingActionButtons();
      return Promise.resolve(null);
    }
    _importWizard.mapping = mapping;
    _setImportBusy(true);

    return api.post(_importPath('/' + encodeURIComponent(jobId) + '/mapping'), {
      mapping: mapping,
      customFieldPolicy: approvedCustomFieldPolicy,
      custom_field_policy: approvedCustomFieldPolicy,
      customFieldApprovalPolicy: approvedCustomFieldPolicy,
      custom_field_approval_policy: approvedCustomFieldPolicy
    })
      .then(function (result) {
        _importWizard.job = _unwrapData(result);
        _importWizard.mapping = _mergeCustomFieldPolicy(
          _importWizard.job.mapping_state || _importWizard.job.mappingState || mapping,
          approvedCustomFieldPolicy
        );
        _adoptCustomFieldApprovalFromMapping(_importWizard.mapping);
        _updateImportStrip();
        _loadImportRollup(true);
        _loadImportHistory(true);
        if (!stayOnStep) _toastSuccess('Mapping saved');
        _renderImportWizard();
        return _importWizard.job;
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Save mapping failed:', err);
        _toastError(_apiErrorMessage(err, 'Failed to save mapping'));
        throw err;
      })
      .finally(function () {
        _setImportBusy(false);
      });
  }

  function _validateCsvImport() {
    if (_importWizard.busy) return;
    var jobId = _getImportJobId();
    if (!jobId) {
      _toastError('Upload a CSV before validation');
      return;
    }

    _saveImportMapping(true).then(function (savedJob) {
      if (!savedJob) return null;
      _setImportBusy(true);
      return api.post(_importPath('/' + encodeURIComponent(jobId) + '/validate'), {
        customFieldPolicy: _getCustomFieldApprovalPolicy(_getImportMapping()),
        custom_field_policy: _getCustomFieldApprovalPolicy(_getImportMapping()),
        customFieldApprovalPolicy: _getCustomFieldApprovalPolicy(_getImportMapping()),
        custom_field_approval_policy: _getCustomFieldApprovalPolicy(_getImportMapping())
      });
    }).then(function (result) {
      if (!result) return null;
      var payload = _unwrapData(result);
      _importWizard.validation = payload;
      _importWizard.job = payload.import_session || payload.importSession || _importWizard.job;
      _importWizard.rows = payload.outcomes || [];
      _importWizard.selectedRowIds = {};
      _importWizard.spotCheckConfirmed = false;
      _importWizard.importPlanConfirmation = '';
      _syncImportRowSelection(_normalizeImportRows(_importWizard.rows));
      _loadImportRollup(true);
      _loadImportHistory(true);
      _updateImportStrip();
      _setImportStep('validation');
      _toastSuccess('CSV rows validated');
      return _loadImportRows(true);
    }).catch(function (err) {
      console.error('[WorkspaceData] Validate import failed:', err);
      _toastError(_apiErrorMessage(err, 'CSV validation failed'));
    }).finally(function () {
      _setImportBusy(false);
    });
  }

  function _loadImportRows(silent) {
    var jobId = _getImportJobId();
    if (!jobId) return Promise.resolve([]);
    _setImportBusy(true);
    return api.get(_importPath('/' + encodeURIComponent(jobId) + '/rows') + '?limit=100&offset=0&sortBy=row_number&sortOrder=asc')
      .then(function (result) {
        var page = _unwrapData(result);
        _importWizard.rows = _mergeImportRowsWithExistingReviewData(page.data || page.rows || [], _importWizard.rows);
        if (_stepForImportJob(_importWizard.job || {}) === 'promotion') {
          if (!_importWizard.promotion) _importWizard.promotion = { import_session: _importWizard.job || {}, summary: _getImportPromotionSummary() || _countsFromJob(_importWizard.job || {}) };
          _importWizard.promotion.rows = _importWizard.rows;
        }
        _importWizard.spotCheckConfirmed = false;
        _importWizard.importPlanConfirmation = '';
        _syncImportRowSelection(_normalizeImportRows(_importWizard.rows));
        _renderImportWizard();
        if (!silent) _toastSuccess('Import rows refreshed');
        return _importWizard.rows;
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Load import rows failed:', err);
        if (!silent) _toastError(_apiErrorMessage(err, 'Failed to load import rows'));
        return [];
      })
      .finally(function () {
        _setImportBusy(false);
      });
  }

  function _reviewCsvImportPromotion() {
    if (_importWizard.busy) return;
    var rows = _normalizeImportRows(_importWizard.rows.length ? _importWizard.rows : ((_importWizard.validation && _importWizard.validation.outcomes) || []));
    var promotionPayload = _getImportPromotionPayload(rows);
    if (!promotionPayload) {
      _toastError(_getImportPromotionBlockedMessage(rows));
      _syncImportPromoteButton(0);
      return;
    }
    _setImportStep('promotion');
  }

  function _promoteCsvImport() {
    if (_importWizard.busy) return;
    var jobId = _getImportJobId();
    if (!jobId) {
      _toastError('Validate the CSV before importing rows');
      return;
    }

    var summary = _getImportValidationSummary();
    if (summary && summary.invalidRows > 0) {
      var confirmed = window.confirm(
        'This import has ' + summary.invalidRows + ' invalid row' + (summary.invalidRows === 1 ? '' : 's') +
        '. Only valid rows will be imported. Continue?'
      );
      if (!confirmed) return;
    }

    var rows = _normalizeImportRows(_importWizard.rows.length ? _importWizard.rows : ((_importWizard.validation && _importWizard.validation.outcomes) || []));
    var promotionPayload = _getImportPromotionPayload(rows);
    if (!promotionPayload) {
      _toastError(_getImportPromotionBlockedMessage(rows));
      _syncImportPromoteButton(0);
      return;
    }

    _setImportBusy(true);
    api.post(_importPath('/' + encodeURIComponent(jobId) + '/promote'), promotionPayload)
      .then(function (result) {
      var payload = _unwrapData(result);
        _importWizard.promotion = payload;
        _importWizard.job = payload.import_session || payload.importSession || _importWizard.job;
        _importWizard.spotCheckConfirmed = false;
        _importWizard.importPlanConfirmation = '';
        _loadImportRollup(true);
        _loadImportHistory(true);
        _updateImportStrip();
        _setImportStep('promotion');
        _toastSuccess('CSV rows imported');
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Promote import failed:', err);
        _toastError(_apiErrorMessage(err, 'CSV import failed'));
      })
      .finally(function () {
        _setImportBusy(false);
      });
  }

  function _updateImportStrip() {
    var strip = el('wsDataImportStrip');
    if (!strip) return;
    var job = _importWizard.job;
    if (!job || !job.id) {
      strip.hidden = true;
      strip.innerHTML = '';
      return;
    }

    var promotionCounts = _getImportPromotionSummary();
    var counts = promotionCounts || _getImportValidationSummary() || _countsFromJob(job);
    strip.hidden = false;
    strip.innerHTML =
      '<div><strong>Latest import:</strong> ' + _escHtml(_importSourceLabel(job)) +
      ' <span>(' + _escHtml(_formatStatusLabel(job.status || 'mapping')) + ')</span></div>' +
        '<div>' +
        _escHtml(String(counts.totalRows || 0)) + ' rows' +
        (!promotionCounts && counts.validRows !== undefined ? ' / ' + _escHtml(String(counts.validRows)) + ' valid' : '') +
        (promotionCounts ? ' / ' + _escHtml(String(counts.createdRows)) + ' created' : '') +
        (promotionCounts ? ' / ' + _escHtml(String(counts.updatedRows)) + ' updated' : '') +
        (promotionCounts ? ' / ' + _escHtml(String(counts.skippedRows)) + ' skipped' : '') +
      '</div>';
  }

  function _wireImportHistory() {
    var container = el('wsDataImportHistory');
    if (!container || container._wiredImportHistory) return;
    container._wiredImportHistory = true;
    container.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest
        ? event.target.closest('[data-import-open-id]')
        : null;
      if (!btn) return;
      event.preventDefault();
      _openImportFromHistory(btn.getAttribute('data-import-open-id'));
    });
  }

  function _loadImportHistory(silent) {
    var container = el('wsDataImportHistory');
    if (!container || !_matterId || _importHistory.busy) return Promise.resolve([]);
    _importHistory.busy = true;
    _renderImportHistory();

    return api.get(_importPath('') + '?limit=5&offset=0&sortBy=updated_at&sortOrder=desc')
      .then(function (result) {
        var payload = _unwrapData(result);
        var page = payload && payload.data !== undefined ? payload.data : payload;
        var rows = Array.isArray(page) ? page : ((page && (page.data || page.rows || page.imports)) || []);
        _importHistory.rows = rows;
        _importHistory.byId = {};
        for (var i = 0; i < rows.length; i++) {
          var id = _getImportJobIdFrom(rows[i]);
          if (id) _importHistory.byId[id] = rows[i];
        }
        _importHistory.loaded = true;
        _importHistory.error = '';
        _renderImportHistory();
        return rows;
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Load import history failed:', err);
        _importHistory.rows = [];
        _importHistory.byId = {};
        _importHistory.loaded = true;
        _importHistory.error = 'Recent imports could not be loaded.';
        _renderImportHistory(_importHistory.error);
        if (!silent) _toastError(_apiErrorMessage(err, 'Failed to load recent imports'));
        return [];
      })
      .finally(function () {
        _importHistory.busy = false;
        _renderImportHistory(_importHistory.error);
      });
  }

  function _loadImportRollup(silent) {
    if (!_matterId || _importRollup.busy) return Promise.resolve(null);
    _importRollup.busy = true;
    var growthRollupPath = '/api/v1/matters/' + encodeURIComponent(_matterId) +
      '/growth-engine/rollup?recentLimit=5&promotedLimit=10&signalLimit=5';
    return api.get(growthRollupPath)
      .then(function (result) {
        var normalized = _normalizeImportRollup(_unwrapData(result));
        if (normalized) return normalized;
        return api.get(_importPath('/insights')).then(function (insightsResult) {
          return _normalizeImportRollup(_unwrapData(insightsResult));
        });
      })
      .catch(function () {
        return api.get(_importPath('/insights')).then(function (insightsResult) {
          return _normalizeImportRollup(_unwrapData(insightsResult));
        });
      })
      .then(function (normalized) {
        _importRollup.data = normalized || null;
        _importRollup.loaded = true;
        _importRollup.error = '';
        _importRollup.source = _importRollup.data ? 'rollup' : '';
        _renderImportHistory();
        return _importRollup.data;
      })
      .catch(function (err) {
        _importRollup.data = null;
        _importRollup.loaded = true;
        _importRollup.error = 'Import summary could not be loaded.';
        _importRollup.source = '';
        _renderImportHistory();
        if (!silent) {
          console.error('[WorkspaceData] Load import rollup failed:', err);
        }
        return null;
      })
      .finally(function () {
        _importRollup.busy = false;
        _renderImportHistory(_importHistory.error);
      });
  }

  function _renderImportHistory(errorMessage) {
    var container = el('wsDataImportHistory');
    if (!container) return;
    var rollup = _importRollup.data || _fallbackImportRollupFromHistory(_importHistory.rows);
    if (_importHistory.busy && !_importHistory.loaded) {
      container.hidden = false;
      container.innerHTML =
        _importGrowthSummaryHtml(rollup) +
        '<div class="ws-import-history-head">' +
          '<strong>Recent imports</strong>' +
          '<span>Loading import activity...</span>' +
        '</div>';
      return;
    }
    if (errorMessage) {
      container.hidden = false;
      container.innerHTML =
        _importGrowthSummaryHtml(rollup) +
        '<div class="ws-import-history-head">' +
          '<strong>Recent imports</strong>' +
          '<span>' + _escHtml(errorMessage) + '</span>' +
        '</div>';
      return;
    }
    if (!_importHistory.rows.length && !rollup) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    var html = _importGrowthSummaryHtml(rollup) +
      '<div class="ws-import-history-head">' +
        '<strong>Recent imports</strong>' +
        '<span>' + _escHtml(String(_importHistory.rows.length)) + ' recent import' + (_importHistory.rows.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<div class="ws-import-history-list">';
    for (var i = 0; i < _importHistory.rows.length; i++) {
      html += _importHistoryItemHtml(_importHistory.rows[i]);
    }
    html += '</div>';
    container.hidden = false;
    container.innerHTML = html;
  }

  function _importGrowthSummaryHtml(rollup) {
    if (!rollup) return '';
    var sourceNote = rollup.source === 'rollup' ? 'Workspace rollup' : 'From recent import history';
    var topSources = rollup.sources.slice(0, 3);
    var sourceRows = topSources.length
      ? '<div class="ws-import-growth-sources">' + topSources.map(function (source) {
          return '<div class="ws-import-growth-source">' +
            '<span>' + _escHtml(source.label) + '</span>' +
            '<strong>' + _escHtml(String(source.records || 0)) + ' records</strong>' +
          '</div>';
        }).join('') + '</div>'
      : '';
    return '<section class="ws-import-growth" data-testid="workspace-import-growth-summary" data-rollup-source="' + _escAttr(rollup.source || 'history') + '">' +
      '<div class="ws-import-growth-head">' +
        '<div>' +
          '<strong>Growth intake summary</strong>' +
          '<span>' + _escHtml(sourceNote) + (rollup.lastUpdated ? ' · Updated ' + _escHtml(_formatImportDate(rollup.lastUpdated)) : '') + '</span>' +
        '</div>' +
        (rollup.lastSource ? '<span class="ws-import-growth-latest">' + _escHtml(rollup.lastSource) + '</span>' : '') +
      '</div>' +
      '<div class="ws-import-growth-metrics">' +
        _growthMetricHtml('Sources', rollup.sourceCount) +
        _growthMetricHtml('Records', rollup.totalRows) +
        _growthMetricHtml('Ready', rollup.readyRows) +
        _growthMetricHtml('Needs review', rollup.reviewRows) +
      '</div>' +
      sourceRows +
    '</section>';
  }

  function _growthMetricHtml(label, value) {
    return '<div class="ws-import-growth-metric"><span>' + _escHtml(label) + '</span><strong>' + _escHtml(String(value || 0)) + '</strong></div>';
  }

  function _importHistoryItemHtml(job) {
    job = job || {};
    var jobId = _getImportJobIdFrom(job);
    var counts = _importHistoryCounts(job);
    var when = job.updated_at || job.updatedAt || job.completed_at || job.completedAt || job.created_at || job.createdAt || '';
    return '<div class="ws-import-history-item" data-testid="workspace-csv-import-history-item">' +
      '<div class="ws-import-history-main">' +
        '<strong>' + _escHtml(_importSourceLabel(job)) + '</strong>' +
        '<span>' + _escHtml(_formatStatusLabel(job.status || 'uploaded')) +
          (when ? ' · Updated ' + _escHtml(_formatImportDate(when)) : '') + '</span>' +
      '</div>' +
      '<div class="ws-import-history-counts">' +
        '<span>' + _escHtml(String(counts.totalRows || 0)) + ' rows</span>' +
        (counts.validRows ? '<span>' + _escHtml(String(counts.validRows)) + ' valid</span>' : '') +
        (counts.promotedRows ? '<span>' + _escHtml(String(counts.promotedRows)) + ' imported</span>' : '') +
        (counts.skippedRows ? '<span>' + _escHtml(String(counts.skippedRows)) + ' skipped</span>' : '') +
      '</div>' +
      '<lex-btn size="sm" variant="secondary" leading-icon="rotate-ccw" data-testid="workspace-csv-import-history-open" data-import-open-id="' + _escAttr(jobId) + '"' +
        (jobId ? '' : ' disabled="true"') + '>Reopen</lex-btn>' +
    '</div>';
  }

  function _openImportFromHistory(importJobId) {
    if (!importJobId || _importWizard.busy) return;
    _resetImportWizard();
    _setImportBusy(true);

    api.get(_importPath('/' + encodeURIComponent(importJobId)))
      .then(function (result) {
        var job = _unwrapData(result);
        _importWizard.job = job;
        _importWizard.mapping = job.mapping_state || job.mappingState || null;
        _adoptCustomFieldApprovalFromMapping(_importWizard.mapping);
        _importWizard.preview = _previewFromJob(job);
        _importWizard.validation = _validationFromJob(job);
        _importWizard.promotion = _promotionFromJob(job);
        _importWizard.rows = [];
        _importWizard.selectedRowIds = {};
        _importWizard.spotCheckConfirmed = false;
        _importWizard.importPlanConfirmation = '';
        _setImportStep(_stepForImportJob(job));
        var modal = el('wsDataImportModal');
        if (modal) modal.open = true;
        _updateImportStrip();
        if (_shouldLoadRowsForJob(job)) {
          return _loadImportRows(true);
        }
        return [];
      })
      .then(function () {
        _toastSuccess('CSV import reopened');
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Reopen import failed:', err);
        _toastError(_apiErrorMessage(err, 'Failed to reopen CSV import'));
      })
      .finally(function () {
        _setImportBusy(false);
      });
  }

  function _validationFromJob(job) {
    var meta = (job && job.metadata) || {};
    var summary = meta.validation_summary || meta.validationSummary || null;
    return summary ? { summary: summary, outcomes: [] } : null;
  }

  function _promotionFromJob(job) {
    var meta = (job && job.metadata) || {};
    var summary = meta.promotion_summary || meta.promotionSummary || null;
    return summary ? { summary: summary, results: [] } : null;
  }

  function _stepForImportJob(job) {
    var status = String((job && job.status) || '').toLowerCase();
    if (status === 'completed' || status === 'failed' || status === 'promoting') return 'promotion';
    if (status === 'validated' || status === 'validating') return 'validation';
    if (status === 'mapping' || status === 'staged') return 'mapping';
    return 'upload';
  }

  function _shouldLoadRowsForJob(job) {
    var status = String((job && job.status) || '').toLowerCase();
    return ['validating', 'validated', 'promoting', 'completed', 'failed'].indexOf(status) !== -1;
  }

  function _importHistoryCounts(job) {
    var meta = (job && job.metadata) || {};
    return _normalizeImportSummary(meta.promotion_summary || meta.promotionSummary ||
      meta.validation_summary || meta.validationSummary || job || {});
  }

  function _normalizeImportRollup(payload) {
    payload = payload || {};
    var rollup = payload.rollup || payload.import_rollup || payload.importRollup || payload;
    var counts = rollup.counts || {};
    var importCounts = counts.imports || {};
    var recent = rollup.recent || {};
    var summary = importCounts.summary || rollup.summary || rollup.metrics || counts || rollup;
    var sources = _normalizeImportRollupSources(recent.imports || rollup.sources || rollup.source_summaries ||
      rollup.sourceSummaries || rollup.recent_sources || rollup.recentSources || rollup.recent_imports ||
      rollup.recentImports || rollup.recent_sessions || rollup.recentSessions || []);
    var totalRows = _numberFrom(summary, [
      'totalRows',
      'total_rows',
      'recordCount',
      'record_count',
      'records',
      'processedRows',
      'processed_rows',
      'rowCount',
      'row_count'
    ]);
    var readyRows = _numberFrom(summary, [
      'readyRows',
      'ready_rows',
      'automationReadyRows',
      'automation_ready_rows',
      'promotedRows',
      'promoted_rows',
      'importedRows',
      'imported_rows'
    ]);
    var reviewRows = _numberFrom(summary, [
      'reviewRows',
      'review_rows',
      'needsReviewRows',
      'needs_review_rows'
    ]);
    if (!readyRows) {
      readyRows = _numberFrom(summary, ['createdRows', 'created_rows']) + _numberFrom(summary, ['updatedRows', 'updated_rows']);
    }
    if (!reviewRows) {
      reviewRows = _numberFrom(summary, ['duplicateRows', 'duplicate_rows']) +
        _numberFrom(summary, ['invalidRows', 'invalid_rows']) +
        _numberFrom(summary, ['failedRows', 'failed_rows']);
    }
    if (!totalRows && sources.length) {
      totalRows = sources.reduce(function (sum, source) { return sum + Number(source.records || 0); }, 0);
    }
    var importCount = _numberFrom(summary, ['importCount', 'import_count', 'totalImports', 'total_imports', 'sessionCount', 'session_count', 'imports', 'sourceRuns', 'source_runs']);
    var sourceCount = _numberFrom(summary, ['sourceCount', 'source_count', 'sources']);
    if (!sourceCount && importCount) sourceCount = importCount;
    if (!sourceCount && sources.length) sourceCount = sources.length;
    var lastSource = rollup.last_source_label || rollup.lastSourceLabel || rollup.latest_source_name || rollup.latestSourceName ||
      rollup.last_source_name || rollup.lastSourceName || (sources[0] && sources[0].label) || '';
    var lastUpdated = rollup.generated_at || rollup.generatedAt || rollup.updated_at || rollup.updatedAt ||
      rollup.last_imported_at || rollup.lastImportedAt ||
      rollup.latest_import_at || rollup.latestImportAt || (sources[0] && sources[0].updatedAt) || '';

    if (!totalRows && !readyRows && !reviewRows && !sourceCount && !importCount && !sources.length && !lastSource) {
      return null;
    }

    return {
      source: 'rollup',
      totalRows: totalRows,
      readyRows: readyRows,
      reviewRows: reviewRows,
      importCount: importCount,
      sourceCount: sourceCount || importCount,
      lastSource: lastSource,
      lastUpdated: lastUpdated,
      sources: sources
    };
  }

  function _normalizeImportRollupSources(sources) {
    if (!Array.isArray(sources)) return [];
    return sources.map(function (source) {
      source = source || {};
      return {
        label: source.label || source.source_label || source.sourceLabel || source.source_name || source.sourceName ||
          source.name || source.connector_name || source.connectorName || source.type || 'Import source',
        records: _numberFrom(source, ['records', 'recordCount', 'record_count', 'totalRows', 'total_rows', 'importedRows', 'imported_rows', 'rows']),
        updatedAt: source.updated_at || source.updatedAt || source.last_imported_at || source.lastImportedAt || source.completed_at || source.completedAt || ''
      };
    }).filter(function (source) {
      return source.label || source.records;
    });
  }

  function _fallbackImportRollupFromHistory(rows) {
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) return null;
    var totalRows = 0;
    var readyRows = 0;
    var reviewRows = 0;
    var sourceMap = {};
    var sources = [];
    for (var i = 0; i < rows.length; i++) {
      var counts = _importHistoryCounts(rows[i]);
      var label = _importSourceLabel(rows[i]);
      var updatedAt = rows[i].updated_at || rows[i].updatedAt || rows[i].completed_at || rows[i].completedAt || rows[i].created_at || rows[i].createdAt || '';
      totalRows += Number(counts.totalRows || 0);
      readyRows += _promotionReadyCount(counts);
      reviewRows += Number(counts.duplicateRows || 0) + Number(counts.invalidRows || 0) + Number(counts.failedRows || 0);
      if (!sourceMap[label]) {
        sourceMap[label] = { label: label, records: 0, updatedAt: updatedAt };
        sources.push(sourceMap[label]);
      }
      sourceMap[label].records += Number(counts.totalRows || 0);
      if (!sourceMap[label].updatedAt && updatedAt) sourceMap[label].updatedAt = updatedAt;
    }
    return {
      source: 'history',
      totalRows: totalRows,
      readyRows: readyRows,
      reviewRows: reviewRows,
      importCount: rows.length,
      sourceCount: sources.length,
      lastSource: rows[0] ? _importSourceLabel(rows[0]) : '',
      lastUpdated: rows[0] && (rows[0].updated_at || rows[0].updatedAt || rows[0].completed_at || rows[0].completedAt || rows[0].created_at || rows[0].createdAt || ''),
      sources: sources
    };
  }

  function _importSourceLabel(job) {
    job = job || {};
    return job.source_label || job.sourceLabel || job.source_name || job.sourceName ||
      job.connector_name || job.connectorName || job.filename || job.file_name || 'Import source';
  }

  function _getImportJobIdFrom(job) {
    job = job || {};
    return String(job.id || job.import_job_id || job.importJobId || job.import_session_id || job.importSessionId || '');
  }

  function _formatImportDate(value) {
    if (!value) return '';
    if (fmtDateTime) {
      try {
        return fmtDateTime(value);
      } catch (_) {
        return String(value);
      }
    }
    var date = new Date(value);
    return isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function _collectImportMappingFromDom() {
    var entitySelect = el('wsImportEntityType');
    var entityType = (entitySelect && entitySelect.value) || (_importWizard.mapping && _importWizard.mapping.entityType) || 'lead';
    var existingRows = _normalizeImportMappings(_getImportMapping());
    var bySource = {};
    for (var i = 0; i < existingRows.length; i++) {
      bySource[existingRows[i].sourceColumn] = existingRows[i];
    }

    var rows = document.querySelectorAll('.ws-import-map-row');
    var mappings = [];
    for (var r = 0; r < rows.length; r++) {
      var source = rows[r].getAttribute('data-source-column') || '';
      var modeEl = rows[r].querySelector('.ws-import-map-mode');
      var keyEl = rows[r].querySelector('.ws-import-custom-key');
      var mode = modeEl ? modeEl.value : 'unmapped';
      var prev = bySource[source] || {};
      if (mode === 'unmapped') {
        mappings.push({
          sourceColumn: source,
          targetField: null,
          targetPath: null,
          status: 'unmapped',
          confidence: prev.confidence || 0,
          reason: prev.reason || 'user_unmapped'
        });
      } else if (mode === 'custom') {
        var customKey = (keyEl && keyEl.value.trim()) || prev.suggestedCustomFieldKey || _toCustomFieldKey(source);
        mappings.push({
          sourceColumn: source,
          targetField: 'custom_fields',
          targetPath: 'custom_fields.' + customKey,
          customFieldKey: customKey,
          suggestedCustomFieldKey: prev.suggestedCustomFieldKey || customKey,
          status: 'custom_field',
          confidence: prev.confidence || 0.5,
          reason: prev.reason || 'user_custom_field'
        });
      } else {
        var field = mode.substring('field:'.length);
        mappings.push({
          sourceColumn: source,
          targetField: field,
          targetPath: field,
          status: 'mapped',
          confidence: prev.confidence || 1,
          reason: prev.reason || 'user_mapped'
        });
      }
    }

    return _augmentMapping({
      entityType: entityType,
      mappings: mappings,
      schemaVersion: (_importWizard.mapping && (_importWizard.mapping.schemaVersion || _importWizard.mapping.schema_version)) || null
    });
  }

  function _augmentMapping(mapping) {
    var fieldMap = {};
    var customFieldMap = {};
    var unmappedColumns = [];
    var mappings = mapping.mappings || [];
    for (var i = 0; i < mappings.length; i++) {
      if (_isImportCustomFieldMapping(mappings[i])) {
        customFieldMap[mappings[i].sourceColumn] = _customFieldKeyFromMapping(mappings[i]);
      } else if (mappings[i].status === 'mapped') {
        fieldMap[mappings[i].sourceColumn] = mappings[i].targetField;
      } else {
        unmappedColumns.push(mappings[i].sourceColumn);
      }
    }
    mapping.fieldMap = fieldMap;
    mapping.customFieldMap = customFieldMap;
    mapping.unmappedColumns = unmappedColumns;
    mapping.coverage = {
      totalColumns: mappings.length,
      mappedColumns: mappings.filter(function (row) { return row.status === 'mapped' && !_isImportCustomFieldMapping(row); }).length,
      customFieldColumns: mappings.filter(function (row) { return _isImportCustomFieldMapping(row); }).length,
      unmappedColumns: mappings.filter(function (row) { return row.status === 'unmapped'; }).length
    };
    mapping.customFieldPolicy = _getCustomFieldApprovalPolicy(mapping);
    mapping.custom_field_policy = mapping.customFieldPolicy;
    mapping.customFieldApprovalPolicy = mapping.customFieldPolicy;
    mapping.custom_field_approval_policy = mapping.customFieldPolicy;
    return mapping;
  }

  function _getImportMapping() {
    return _importWizard.mapping ||
      (_importWizard.job && (_importWizard.job.mapping_state || _importWizard.job.mappingState)) ||
      null;
  }

  function _normalizeImportMappings(mapping) {
    var rows = mapping && mapping.mappings;
    if (!Array.isArray(rows)) return [];
    return rows.map(function (row) {
      return {
        sourceColumn: row.sourceColumn || row.source_column || '',
        targetField: row.targetField || row.target_field || null,
        targetPath: row.targetPath || row.target_path || null,
        customFieldKey: row.customFieldKey || row.custom_field_key || '',
        suggestedCustomFieldKey: row.suggestedCustomFieldKey || row.suggested_custom_field_key || '',
        status: row.status || 'unmapped',
        confidence: Number(row.confidence || 0),
        reason: row.reason || '',
        guidance: row.guidance || row.mappingGuidance || row.mapping_guidance || null
      };
    }).filter(function (row) {
      return row.sourceColumn;
    });
  }

  function _isImportCustomFieldMapping(row) {
    row = row || {};
    var targetField = String(row.targetField || row.target_field || '').trim();
    var targetPath = String(row.targetPath || row.target_path || '').trim();
    return row.status === 'custom_field' ||
      targetField === 'custom_fields' ||
      targetPath === 'custom_fields' ||
      targetPath.indexOf('custom_fields.') === 0;
  }

  function _customFieldKeyFromMapping(row) {
    row = row || {};
    var explicitKey = row.customFieldKey || row.custom_field_key;
    if (explicitKey) return String(explicitKey).trim();
    var targetPath = String(row.targetPath || row.target_path || '').trim();
    if (targetPath.indexOf('custom_fields.') === 0) {
      return targetPath.slice('custom_fields.'.length).trim();
    }
    var suggestedKey = row.suggestedCustomFieldKey || row.suggested_custom_field_key;
    if (suggestedKey) return String(suggestedKey).trim();
    return _toCustomFieldKey(row.sourceColumn || row.source_column || '');
  }

  function _mappingGuidanceText(row) {
    row = row || {};
    var guidance = row.guidance || row.mappingGuidance || row.mapping_guidance;
    if (typeof guidance === 'string') return guidance;
    if (guidance && typeof guidance === 'object') {
      return guidance.message || guidance.detail || guidance.description || '';
    }
    if (row.reason === 'lifecycle_status_requires_custom_field') {
      return 'This lifecycle label is not a canonical lead status. Save it as a custom field or choose a canonical lead status before promotion.';
    }
    if (row.reason === 'lifecycle_status_normalized') {
      return 'Business lifecycle labels in this column will be normalized to canonical lead statuses during validation.';
    }
    return '';
  }

  function _normalizeImportRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(function (row, index) {
      var raw = row.raw_data || row.rawData || {};
      return {
        id: row.id || row.rowId || row.row_id || '',
        rowNumber: row.row_number || row.rowNumber || (row.rowIndex !== undefined ? row.rowIndex + 1 : index + 1),
        rowIndex: row.rowIndex !== undefined ? row.rowIndex : (row.row_number ? row.row_number - 1 : index),
        status: row.validation_status || row.validationStatus || row.status || 'pending',
        action: row.action || row.import_action || row.importAction || row.operation || row.result_action || row.resultAction || '',
        promotionAction: row.promotion_action || row.promotionAction || row.promote_action || row.promoteAction || row.import_action || row.importAction || row.action || row.operation || '',
        promotionStatus: row.promotion_status || row.promotionStatus || row.import_status || row.importStatus || row.result_status || row.resultStatus || row.status || '',
        reason: row.reason || row.skip_reason || row.skipReason || row.error || row.message || '',
        rawValues: raw.row_data || raw.rowData || row.sourceRow || raw || {},
        mappedEntity: row.mapped_data || row.mappedData || row.mappedEntity || row.normalized_data || {},
        validation_errors: row.validation_errors || row.validationErrors || row.errors || [],
        errors: row.errors || row.validation_errors || [],
        duplicateMetadata: _extractDuplicateMetadata(row),
        entity: _promotedEntityFromRow(row)
      };
    });
  }

  function _mergeImportRowsWithExistingReviewData(nextRows, existingRows) {
    nextRows = Array.isArray(nextRows) ? nextRows : [];
    existingRows = Array.isArray(existingRows) ? existingRows : [];
    if (!nextRows.length || !existingRows.length) return nextRows;

    var existingById = {};
    for (var i = 0; i < existingRows.length; i++) {
      var id = _importRowId(existingRows[i]);
      if (id) existingById[id] = existingRows[i];
    }

    return nextRows.map(function (row) {
      var existing = existingById[_importRowId(row)];
      if (!existing || !_duplicateInfo(existing).isDuplicateLike || _duplicateInfo(row).isDuplicateLike) return row;
      var merged = Object.assign({}, row);
      var metadata = _extractDuplicateMetadata(existing);
      if (metadata && !_extractDuplicateMetadata(merged)) {
        merged.duplicateMetadata = metadata;
        merged.duplicate_metadata = metadata;
      }
      if (_normalizeImportStatus(merged.validation_status || merged.status) === 'valid') {
        merged.validation_status = existing.validation_status || existing.status || merged.validation_status;
        merged.status = existing.status || existing.validation_status || merged.status;
      }
      if (!merged.reason && existing.reason) merged.reason = existing.reason;
      return merged;
    });
  }

  function _importRowId(row) {
    row = row || {};
    return String(row.id || row.rowId || row.row_id || row.source_row_id || row.sourceRowId || '');
  }

  function _isImportRowSelectable(row) {
    var status = _normalizeImportStatus(row && (row.status || row.validation_status));
    if (_duplicateInfo(row).isDuplicateLike) return false;
    return status === 'valid' || status === 'ready' || status === 'validated';
  }

  function _isImportRowSelected(row) {
    var rowId = _importRowId(row);
    return !!(rowId && _importWizard.selectedRowIds && _importWizard.selectedRowIds[rowId] === true);
  }

  function _setImportRowSelected(rowId, selected) {
    if (!_importWizard.selectedRowIds) _importWizard.selectedRowIds = {};
    _importWizard.selectedRowIds[String(rowId)] = !!selected;
  }

  function _syncImportRowSelection(rows) {
    if (!_importWizard.selectedRowIds) _importWizard.selectedRowIds = {};
    rows = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < rows.length; i++) {
      var rowId = _importRowId(rows[i]);
      if (!rowId) continue;
      if (!_isImportRowSelectable(rows[i])) {
        _importWizard.selectedRowIds[rowId] = false;
      } else if (_importWizard.selectedRowIds[rowId] === undefined) {
        _importWizard.selectedRowIds[rowId] = true;
      }
    }
  }

  function _getSelectedImportRowIds(rows) {
    rows = Array.isArray(rows) ? rows : _normalizeImportRows(_importWizard.rows || []);
    _syncImportRowSelection(rows);
    var ids = [];
    for (var i = 0; i < rows.length; i++) {
      var rowId = _importRowId(rows[i]);
      if (rowId && _isImportRowSelectable(rows[i]) && _importWizard.selectedRowIds[rowId] === true) {
        ids.push(rowId);
      }
    }
    return ids;
  }

  function _getImportSelectionCounts(rows, summary) {
    rows = Array.isArray(rows) ? rows : [];
    var importableRows = 0;
    var selectedRows = 0;
    var loadedImportableRows = 0;
    var loadedSelectedRows = 0;
    var summaryDuplicateRows = Number(summary && summary.duplicateRows) || 0;
    var summaryImportableRows = Number(summary && summary.importableRows) || 0;
    var duplicateRows = summaryDuplicateRows;
    var validRows = Number(summary && summary.validRows) || 0;
    if (rows.length) {
      duplicateRows = 0;
      for (var i = 0; i < rows.length; i++) {
        if (_duplicateInfo(rows[i]).isDuplicateLike) duplicateRows++;
        if (!_isImportRowSelectable(rows[i]) || !_importRowId(rows[i])) continue;
        loadedImportableRows++;
        if (_isImportRowSelected(rows[i])) loadedSelectedRows++;
      }
      importableRows = loadedImportableRows;
      selectedRows = loadedSelectedRows;
      duplicateRows = Math.max(duplicateRows, summaryDuplicateRows);
    } else {
      importableRows = summaryImportableRows || validRows;
      selectedRows = importableRows;
    }
    var allLoadedRowsSelected = loadedImportableRows > 0 && loadedSelectedRows === loadedImportableRows;
    var allValidRowsSelected = selectedRows > 0 && selectedRows === importableRows;
    if (summaryImportableRows > importableRows && allLoadedRowsSelected) {
      importableRows = summaryImportableRows;
      selectedRows = summaryImportableRows;
      allValidRowsSelected = true;
    } else if (!duplicateRows && validRows > importableRows && allLoadedRowsSelected) {
      importableRows = validRows;
      selectedRows = validRows;
      allValidRowsSelected = true;
    }
    return {
      importableRows: importableRows,
      selectedRows: selectedRows,
      loadedImportableRows: loadedImportableRows,
      loadedSelectedRows: loadedSelectedRows,
      duplicateRows: duplicateRows,
      allValidRowsSelected: allValidRowsSelected
    };
  }

  function _importSelectionSummaryText(selection) {
    selection = selection || {};
    if (selection.loadedImportableRows && selection.importableRows > selection.loadedImportableRows && selection.allValidRowsSelected) {
      return 'All ' + selection.importableRows + ' valid rows selected for import (' +
        selection.loadedImportableRows + ' loaded for spot-check)';
    }
    var text = selection.selectedRows + ' of ' + selection.importableRows + ' ' +
      'valid rows selected for import';
    if (selection.duplicateRows) {
      text += '; ' + selection.duplicateRows + ' duplicate/review ' +
        (selection.duplicateRows === 1 ? 'row is' : 'rows are') + ' not importable without resolution';
    }
    return text;
  }

  function _getImportPromotionPayload(rows) {
    rows = Array.isArray(rows) ? rows : _normalizeImportRows(_importWizard.rows || []);
    var selection = _getImportSelectionCounts(rows, _getImportValidationSummary());
    if (!selection.selectedRows) return null;
    if (!_importWizard.spotCheckConfirmed) return null;
    var plan = _getImportPlan(rows);
    if (!_isImportPlanConfirmed(plan)) return null;
    var payload = {
      spot_check_confirmed: true,
      import_plan_confirmed: true,
      import_plan_confirmation: String(_importWizard.importPlanConfirmation || '').trim(),
      review_metadata: _getImportReviewMetadata(plan)
    };
    if (selection.allValidRowsSelected && !selection.duplicateRows) return payload;
    var approvedRowIds = _getSelectedImportRowIds(rows);
    if (!approvedRowIds.length) return null;
    payload.approved_row_ids = approvedRowIds;
    return payload;
  }

  function _getImportPromotionBlockedMessage(rows) {
    rows = Array.isArray(rows) ? rows : _normalizeImportRows(_importWizard.rows || []);
    var selection = _getImportSelectionCounts(rows, _getImportValidationSummary());
    if (!selection.selectedRows) return 'Select at least one valid row to import';
    var plan = _getImportPlan(rows);
    if (!_importWizard.spotCheckConfirmed) return 'Confirm you reviewed the mapped values and selected rows before importing';
    if (!_isImportPlanConfirmed(plan)) return 'Type IMPORT to confirm this risky import plan';
    return 'Confirm you reviewed the mapped values and selected rows before importing';
  }

  function _syncImportPromoteButton(selectedRows) {
    var btn = el('wsImportPromoteAction');
    if (!btn) return;
    if (selectedRows === undefined) {
      var rows = _normalizeImportRows(_importWizard.rows.length ? _importWizard.rows : ((_importWizard.validation && _importWizard.validation.outcomes) || []));
      selectedRows = _getImportSelectionCounts(rows, _getImportValidationSummary()).selectedRows;
    }
    _syncImportSpotCheckControl(selectedRows);
    var plan = _getImportPlan(rows);
    btn.disabled = !!_importWizard.busy ||
      Number(selectedRows || 0) < 1 ||
      !_importWizard.spotCheckConfirmed ||
      !_isImportPlanConfirmed(plan);
  }

  function _getImportPlan(rows) {
    var summary = _getImportValidationSummary();
    if (!summary) return null;

    rows = Array.isArray(rows)
      ? rows
      : _normalizeImportRows(_importWizard.rows.length ? _importWizard.rows : ((_importWizard.validation && _importWizard.validation.outcomes) || []));
    _syncImportRowSelection(rows);

    var selection = _getImportSelectionCounts(rows, summary);
    var mapping = _getImportMapping() || {};
    var mappingRows = _normalizeImportMappings(mapping);
    var targetEntity = String(mapping.entityType || mapping.entity_type ||
      (_importWizard.job && (_importWizard.job.target_entity_type || _importWizard.job.targetEntityType)) ||
      'lead').toLowerCase();
    var mappedColumnCount = 0;
    var customFieldColumnCount = 0;
    var ownerAssignmentMappings = [];

    for (var i = 0; i < mappingRows.length; i++) {
      var row = mappingRows[i];
      if (row.status === 'mapped' && row.targetField) mappedColumnCount++;
      if (row.status === 'custom_field') customFieldColumnCount++;
      if (_isOwnerAssignmentField(row.targetField || row.targetPath || row.customFieldKey)) {
        ownerAssignmentMappings.push(_formatFieldLabel(row.targetField || row.targetPath || row.customFieldKey));
      }
    }

    var skippedRows = Math.max(0, Number(summary.totalRows || 0) - Number(selection.selectedRows || 0) - Number(summary.invalidRows || 0));
    var riskReasons = [];
    if (targetEntity === 'opportunity') {
      riskReasons.push('Opportunity imports can affect revenue pipeline reporting.');
    }
    if (ownerAssignmentMappings.length) {
      riskReasons.push('Owner or assignment fields are mapped: ' + ownerAssignmentMappings.slice(0, 3).join(', ') + '.');
    }
    if (Number(selection.selectedRows || 0) > 500) {
      riskReasons.push('Large import threshold exceeded: ' + selection.selectedRows + ' selected rows is above 500.');
    }

    return {
      targetEntity: targetEntity,
      targetEntityLabel: _formatEntityType(targetEntity),
      totalRows: Number(summary.totalRows || 0),
      validRows: Number(summary.validRows || 0),
      invalidRows: Number(summary.invalidRows || 0),
      duplicateRows: Number(selection.duplicateRows || summary.duplicateRows || 0),
      importableRows: Number(selection.importableRows || 0),
      selectedRows: Number(selection.selectedRows || 0),
      skippedRows: skippedRows,
      mappedColumnCount: mappedColumnCount,
      customFieldColumnCount: customFieldColumnCount,
      unmappedColumnCount: Math.max(0, mappingRows.length - mappedColumnCount - customFieldColumnCount),
      totalColumnCount: mappingRows.length || _getImportHeaders().length,
      riskReasons: riskReasons,
      requiresTypedConfirmation: riskReasons.length > 0,
      largeImportThreshold: 500,
      allValidRowsSelected: !!selection.allValidRowsSelected
    };
  }

  function _isImportPlanConfirmed(plan) {
    if (!plan) return false;
    if (!plan.requiresTypedConfirmation) return true;
    return String(_importWizard.importPlanConfirmation || '').trim().toUpperCase() === 'IMPORT';
  }

  function _getImportReviewMetadata(plan) {
    plan = plan || _getImportPlan();
    if (!plan) return {};
    return {
      target_entity_type: plan.targetEntity,
      selected_rows: plan.selectedRows,
      importable_rows: plan.importableRows,
      total_rows: plan.totalRows,
      valid_rows: plan.validRows,
      invalid_rows: plan.invalidRows,
      duplicate_rows: plan.duplicateRows,
      skipped_rows: plan.skippedRows,
      mapped_column_count: plan.mappedColumnCount,
      custom_field_column_count: plan.customFieldColumnCount,
      unmapped_column_count: plan.unmappedColumnCount,
      risk_reasons: plan.riskReasons.slice(),
      requires_typed_confirmation: plan.requiresTypedConfirmation,
      large_import_threshold: plan.largeImportThreshold,
      all_valid_rows_selected: plan.allValidRowsSelected
    };
  }

  function _isOwnerAssignmentField(value) {
    var key = String(value || '').toLowerCase();
    return /(^|[_.-])(owner|owner_id|owner_user_id|assigned_to|assigned_to_user_id|assignee|assignee_id)([_.-]|$)/.test(key) ||
      key === 'owner' ||
      key === 'ownerid' ||
      key === 'assignedto';
  }

  function _promotedEntityFromRow(row) {
    var entity = row.entity || row.promotedEntity || row.promoted_entity ||
      row.canonicalEntity || row.canonical_entity || null;
    if (!entity && (row.entity_id || row.entityId || row.canonical_entity_id || row.canonicalEntityId ||
        row.promoted_entity_id || row.promotedEntityId)) {
      entity = row;
    }
    return entity ? _normalizePromotedEntity(entity, row) : null;
  }

  function _normalizePromotedEntity(entity, row) {
    entity = entity || {};
    row = row || {};
    var type = entity.entityType || entity.entity_type || entity.type || entity.kind ||
      entity.canonicalEntityType || entity.canonical_entity_type ||
      entity.promotedEntityType || entity.promoted_entity_type ||
      row.entityType || row.entity_type || '';
    var id = entity.entityId || entity.entity_id || entity.id ||
      entity.canonicalEntityId || entity.canonical_entity_id ||
      entity.promotedEntityId || entity.promoted_entity_id ||
      entity[type + '_id'] || row.entityId || row.entity_id || row.promotedEntityId || row.promoted_entity_id || '';
    return {
      entityType: type,
      entity_type: type,
      entityId: id,
      entity_id: id,
      displayName: entity.displayName || entity.display_name || entity.label || entity.name || entity.title || '',
      display_name: entity.displayName || entity.display_name || entity.label || entity.name || entity.title || '',
      canonicalUrl: _canonicalEntityHref(entity, row),
      canonical_url: _canonicalEntityHref(entity, row),
      source: entity
    };
  }

  function _getImportHeaders() {
    var preview = _importWizard.preview || _previewFromJob(_importWizard.job);
    return (preview && (preview.headers || preview.header)) || [];
  }

  function _previewFromJob(job) {
    var meta = (job && (job.upload_metadata || job.uploadMetadata)) || {};
    return {
      filename: meta.filename || '',
      headers: meta.headers || [],
      sample_rows: meta.sample_rows || meta.sampleRows || [],
      total_rows: job && (job.total_rows || job.totalRows) || meta.total_rows || meta.totalRows || 0,
      column_count: meta.column_count || meta.columnCount || (meta.headers ? meta.headers.length : 0),
      detected_delimiter: meta.detected_delimiter || meta.detectedDelimiter || ','
    };
  }

  function _getImportValidationSummary() {
    if (_importWizard.validation && _importWizard.validation.summary) {
      return _normalizeImportSummary(_importWizard.validation.summary);
    }
    var job = _importWizard.job || {};
    var meta = job.metadata || {};
    var summary = meta.validation_summary || meta.validationSummary || null;
    if (summary) return _normalizeImportSummary(summary);
    if (job.valid_rows !== undefined || job.validRows !== undefined) return _countsFromJob(job);
    return null;
  }

  function _getImportPromotionSummary() {
    if (_importWizard.promotion && _importWizard.promotion.summary) {
      return _normalizeImportSummary(_importWizard.promotion.summary);
    }
    if (_importWizard.promotion) {
      var promotionSummary = _importWizard.promotion.promotion_summary ||
        _importWizard.promotion.promotionSummary ||
        _importWizard.promotion.counts ||
        _importWizard.promotion.stats ||
        null;
      if (promotionSummary) return _normalizeImportSummary(promotionSummary);

      var rows = _normalizeImportRows(_getImportPromotionRows());
      if (rows.length) return _summaryFromPromotionRows(rows);
    }
    var job = _importWizard.job || {};
    var meta = job.metadata || {};
    var summary = meta.promotion_summary || meta.promotionSummary || null;
    return summary ? _normalizeImportSummary(summary) : null;
  }

  function _normalizeImportSummary(summary) {
    summary = summary || {};
    var createdRows = _numberFrom(summary, ['createdRows', 'created_rows', 'created', 'createdCount', 'created_count']);
    var updatedRows = _numberFrom(summary, ['updatedRows', 'updated_rows', 'updated', 'updatedCount', 'updated_count']);
    var skippedRows = _numberFrom(summary, ['skippedRows', 'skipped_rows', 'skipped', 'skippedCount', 'skipped_count']);
    var failedRows = _numberFrom(summary, ['failedRows', 'failed_rows', 'failed', 'failedCount', 'failed_count', 'errorRows', 'error_rows']);
    var promotedRows = _numberFrom(summary, [
      'promotedRows',
      'promoted_rows',
      'importedRows',
      'imported_rows',
      'successfulRows',
      'successful_rows',
      'successRows',
      'success_rows',
      'promoted',
      'imported',
      'success'
    ]);
    if (!promotedRows && (createdRows || updatedRows)) promotedRows = createdRows + updatedRows;
    var validRows = _numberFrom(summary, ['validRows', 'valid_rows', 'valid', 'validCount', 'valid_count']);
    var importableRows = _numberFrom(summary, ['importableRows', 'importable_rows', 'importable', 'importableCount', 'importable_count']);
    var invalidRows = _numberFrom(summary, ['invalidRows', 'invalid_rows', 'invalid', 'invalidCount', 'invalid_count']);
    var duplicateRows = _numberFrom(summary, [
      'duplicateRows',
      'duplicate_rows',
      'duplicates',
      'duplicateCount',
      'duplicate_count',
      'likelyDuplicateRows',
      'likely_duplicate_rows',
      'needsReviewRows',
      'needs_review_rows'
    ]);
    var totalRows = _numberFrom(summary, ['totalRows', 'total_rows', 'total', 'totalCount', 'total_count', 'processedRows', 'processed_rows']);
    if (!totalRows) {
      totalRows = validRows + invalidRows || promotedRows + failedRows + skippedRows;
    }
    return {
      totalRows: totalRows,
      stagedRows: _numberFrom(summary, ['stagedRows', 'staged_rows', 'staged', 'stagedCount', 'staged_count']),
      validRows: validRows,
      importableRows: importableRows,
      invalidRows: invalidRows,
      duplicateRows: duplicateRows,
      promotedRows: promotedRows,
      createdRows: createdRows,
      updatedRows: updatedRows,
      failedRows: failedRows,
      skippedRows: skippedRows
    };
  }

  function _numberFrom(source, keys) {
    source = source || {};
    for (var i = 0; i < keys.length; i++) {
      if (source[keys[i]] !== undefined && source[keys[i]] !== null && source[keys[i]] !== '') {
        var value = Number(source[keys[i]]);
        return isNaN(value) ? 0 : value;
      }
    }
    return 0;
  }

  function _getImportPromotionRows() {
    var promotion = _importWizard.promotion || {};
    var rows = promotion.results || promotion.rows || promotion.outcomes || promotion.promoted_rows ||
      promotion.promotedRows || promotion.data || [];
    if ((!rows || !rows.length) && _importWizard.promotion && Array.isArray(_importWizard.rows)) {
      return _importWizard.rows;
    }
    return rows || [];
  }

  function _summaryFromPromotionRows(rows) {
    var summary = { totalRows: rows.length, promotedRows: 0, createdRows: 0, updatedRows: 0, failedRows: 0, skippedRows: 0 };
    for (var i = 0; i < rows.length; i++) {
      var status = _normalizePromotionStatus(rows[i]);
      if (status === 'created') summary.createdRows++;
      else if (status === 'updated') summary.updatedRows++;
      else if (status === 'skipped') summary.skippedRows++;
      else if (status === 'failed') summary.failedRows++;
      else summary.promotedRows++;
    }
    summary.promotedRows += summary.createdRows + summary.updatedRows;
    return _normalizeImportSummary(summary);
  }

  function _promotionReadyCount(summary) {
    summary = summary || {};
    return Number(summary.promotedRows || 0) || (Number(summary.createdRows || 0) + Number(summary.updatedRows || 0));
  }

  function _normalizePromotionStatus(row) {
    row = row || {};
    var entity = row.entity || {};
    var raw = String(row.promotionStatus || row.promotion_status || row.resultStatus || row.result_status ||
      row.promotionAction || row.promotion_action || row.action || row.import_action || row.importAction || row.operation ||
      entity.action || entity.importAction || entity.import_action || row.status || 'promoted').toLowerCase();
    if (raw.indexOf('creat') !== -1 || raw === 'inserted' || raw === 'new') return 'created';
    if (raw.indexOf('updat') !== -1 || raw === 'merged') return 'updated';
    if (raw.indexOf('skip') !== -1 || raw === 'duplicate' || raw === 'ignored') return 'skipped';
    if (raw.indexOf('fail') !== -1 || raw.indexOf('error') !== -1 || raw === 'invalid') return 'failed';
    if (raw.indexOf('import') !== -1 || raw.indexOf('promot') !== -1 || raw === 'success') return 'promoted';
    return raw || 'promoted';
  }

  function _canonicalEntityHref(entity, row) {
    entity = entity || {};
    row = row || {};
    var canonical = entity.canonical || entity.canonicalEntity || entity.canonical_entity || {};
    var href = entity.canonicalUrl || entity.canonical_url || entity.url || entity.href ||
      entity.link || entity.webUrl || entity.web_url ||
      canonical.canonicalUrl || canonical.canonical_url || canonical.url || canonical.href ||
      row.canonicalUrl || row.canonical_url || row.url || row.href || '';
    if (href) return _safeHref(href);

    var type = String(entity.entityType || entity.entity_type || entity.type || row.entityType || row.entity_type || '').toLowerCase();
    var id = entity.entityId || entity.entity_id || entity.id || row.entityId || row.entity_id || '';
    if (!id) return '';
    if (type === 'task') return 'my-tasks.html?task=' + encodeURIComponent(id);
    if (type === 'matter' || type === 'workspace' || type === 'client_matter') {
      return 'workspace-details.html?id=' + encodeURIComponent(id);
    }
    if (type === 'document' || type === 'file') return 'file-viewer.html?id=' + encodeURIComponent(id);
    return '';
  }

  function _safeHref(href) {
    href = String(href || '').trim();
    if (!href || /[\u0000-\u001f\u007f]/.test(href) || /^\/\//.test(href)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      try {
        var parsed = new URL(href, window.location.href);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === window.location.origin) {
          return parsed.pathname + parsed.search + parsed.hash;
        }
      } catch (_) {
        return '';
      }
      return '';
    }
    return href;
  }

  function _countsFromJob(job) {
    return _normalizeImportSummary(job || {});
  }

  function _sampleValuesForColumn(column) {
    var preview = _importWizard.preview || {};
    var rows = preview.sample_rows || preview.sampleRows || [];
    var values = [];
    for (var i = 0; i < rows.length && values.length < 3; i++) {
      var value = rows[i] ? rows[i][column] : '';
      if (value !== null && value !== undefined && String(value).trim()) {
        values.push(String(value));
      }
    }
    return values.join(' | ');
  }

  function _getImportJobId() {
    var job = _importWizard.job || {};
    return job.id || job.import_job_id || job.importJobId || job.import_session_id || job.importSessionId || '';
  }

  function _importPath(suffix) {
    return '/api/v1/matters/' + encodeURIComponent(_matterId) + '/imports' + (suffix || '');
  }

  function _unwrapData(result) {
    if (result && result.data !== undefined) return result.data;
    return result || {};
  }

  function _fileSourceName() {
    var file = _importWizard.file;
    return file && file.name ? file.name.replace(/\.csv$/i, '') : 'CSV import';
  }

  function _browserTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_) {
      return 'UTC';
    }
  }

  function _formatBytes(bytes) {
    bytes = Number(bytes || 0);
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function _formatConfidence(value) {
    var num = Number(value || 0);
    if (!num) return '-';
    return Math.round(num > 1 ? num : num * 100) + '%';
  }

  function _formatFieldLabel(value) {
    return _formatEntityType(String(value || '').replace(/\./g, '_'));
  }

  function _formatStatusLabel(value) {
    return _formatEntityType(String(value || '').replace(/\./g, '_'));
  }

  function _toCustomFieldKey(value) {
    var key = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return key || 'field';
  }

  function _metricHtml(label, value) {
    return '<div class="ws-import-metric"><span>' + _escHtml(label) + '</span><strong>' + _escHtml(String(value)) + '</strong></div>';
  }

  function _emptyImportMessage(message) {
    return '<div style="padding:0.75rem;color:var(--lex-text-secondary,#4b5563);font-size:0.8125rem;">' + _escHtml(message) + '</div>';
  }

  function _compactJson(value) {
    if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return '-';
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function _issuesText(errors) {
    if (!Array.isArray(errors) || !errors.length) return '';
    return errors.map(function (err) {
      return (err && (err.message || err.code || err.field)) || String(err);
    }).join('; ');
  }

  function _rowIssueText(row, errors, duplicateInfo) {
    var parts = [];
    var issueText = _issuesText(errors);
    if (issueText) parts.push(issueText);
    if (duplicateInfo && duplicateInfo.isDuplicateLike) {
      if (duplicateInfo.reason) parts.push(duplicateInfo.reason);
      if (duplicateInfo.confidenceLabel) parts.push(duplicateInfo.confidenceLabel);
    }
    return parts.join('; ');
  }

  function _normalizeImportStatus(value) {
    return String(value || 'pending').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'pending';
  }

  function _extractDuplicateMetadata(row) {
    row = row || {};
    var meta = row.duplicateMetadata || row.duplicate_metadata ||
      row.dedupeMetadata || row.dedupe_metadata ||
      row.deduplication || row.dedupe ||
      row.duplicate || row.duplicate_match || row.duplicateMatch ||
      row.match || row.matched_entity || row.matchedEntity || null;
    if (!meta && (row.is_duplicate || row.isDuplicate || row.likely_duplicate || row.likelyDuplicate)) {
      meta = {};
    }
    return meta && typeof meta === 'object' ? meta : null;
  }

  function _duplicateInfo(row) {
    row = row || {};
    var status = _normalizeImportStatus(row.status || row.validation_status);
    var meta = _extractDuplicateMetadata(row);
    var outcome = _normalizeImportStatus(row.outcome || row.validation_outcome || row.validationOutcome ||
      (meta && (meta.outcome || meta.status || meta.result)));
    var action = _normalizeImportStatus(row.action || row.duplicate_action || row.duplicateAction ||
      (meta && (meta.action || meta.resolution || meta.resolutionAction || meta.resolution_action)));
    if ((status === 'valid' || status === 'ready' || status === 'validated') &&
        (action === 'update' || action === 'upsert' || action === 'resolved' || action === 'merge')) {
      return { isDuplicateLike: false, label: _formatStatusLabel(status) };
    }
    var isDuplicateLike = status === 'duplicate' || status === 'likely_duplicate' || status === 'needs_review' ||
      outcome === 'duplicate' || outcome === 'likely_duplicate' || outcome === 'needs_review' ||
      !!(row.is_duplicate || row.isDuplicate || row.likely_duplicate || row.likelyDuplicate || meta);
    if (!isDuplicateLike) {
      return { isDuplicateLike: false, label: _formatStatusLabel(status) };
    }

    var duplicateStatus = status;
    if (duplicateStatus !== 'duplicate' && duplicateStatus !== 'likely_duplicate' && duplicateStatus !== 'needs_review') {
      duplicateStatus = outcome || (row.likely_duplicate || row.likelyDuplicate ? 'likely_duplicate' : 'duplicate');
    }

    var matched = (meta && (meta.matched_entity || meta.matchedEntity || meta.entity || meta.match || meta.record)) || {};
    var matchName = (meta && (meta.match_name || meta.matchName || meta.display_name || meta.displayName || meta.name || meta.email)) ||
      matched.displayName || matched.display_name || matched.name || matched.email || matched.id || '';
    var confidence = meta && (meta.confidence || meta.score || meta.match_score || meta.matchScore);
    var reason = (row.reason || row.skip_reason || row.skipReason || row.message ||
      (meta && (meta.reason || meta.match_reason || meta.matchReason || meta.message || meta.rule || meta.matched_on || meta.matchedOn)) || '');

    return {
      isDuplicateLike: true,
      status: duplicateStatus,
      label: duplicateStatus === 'likely_duplicate' ? 'Likely duplicate' :
        (duplicateStatus === 'needs_review' ? 'Needs review' : 'Duplicate'),
      reason: reason ? _formatDuplicateReason(reason) : 'Potential duplicate detected',
      matchLabel: matchName ? 'Matches ' + matchName : '',
      confidenceLabel: confidence !== undefined && confidence !== null && confidence !== ''
        ? 'Match confidence ' + _formatConfidence(confidence)
        : ''
    };
  }

  function _formatDuplicateReason(value) {
    return _formatStatusLabel(String(value || '').replace(/\./g, '_'));
  }

  function _apiErrorMessage(err, fallback) {
    return (err && (err.message || err.detail)) || fallback;
  }

  function _toastSuccess(message) {
    if (typeof Lex !== 'undefined' && Lex.Toast && Lex.Toast.success) {
      Lex.Toast.success(message);
    }
  }

  function _toastError(message) {
    if (typeof Lex !== 'undefined' && Lex.Toast && Lex.Toast.error) {
      Lex.Toast.error(message);
    }
  }

  function _escHtml(value) {
    return Lex.Utils.escapeHtml(String(value == null ? '' : value));
  }

  function _escAttr(value) {
    return _escHtml(value).replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════════════════════════
  // Data loading
  // ═══════════════════════════════════════════════════════════════

  // Reload the current page (after imports or annotations).
  function _loadData() {
    var table = _table();
    if (table && typeof table.requestServerQuery === 'function') table.requestServerQuery();
  }

  function _isFiltered(query) {
    return Boolean(_searchTerm || Object.keys((query && query.filters) || {}).length);
  }

  // Answers the table's lex-query-change with one page of connected data.
  function _loadPage(query) {
    var gen = ++_gen;
    var table = _table();
    if (!table) return;
    query = query || table.serverQuery;

    Lex.Redact.on(table);

    var ranges = window.LanaLibraryColumnFilters;
    var params = WsTable.buildQueryParams(query, {
      search: _searchTerm,
      rangeBounds: ranges ? ranges.editedRangeBounds : null
    });
    _syncEntitySelect(query.filters || {});
    var url = '/api/v1/matters/' + encodeURIComponent(_matterId) + '/connected-data?' + params.toString();

    api.get(url)
      .then(function (result) {
        if (gen !== _gen) return;

        var rows = (result && result.data) || [];
        var pagination = (result && result.pagination) || {};
        var filters = (result && result.filters) || {};
        var total = Number(pagination.total);
        if (!Number.isFinite(total)) total = rows.length;

        // Full records by id, for the detail modal, chat and annotations.
        _rowDataMap = {};
        rows.forEach(function (row) { if (row && row.id) _rowDataMap[row.id] = row; });

        _updateStatCards(total, filters);
        _updateFilterOptions(filters);

        Lex.Redact.off(table);
        var filtered = _isFiltered(query);
        table.emptyText = WsTable.emptyText(filtered);
        table.emptyActionLabel = filtered ? '' : 'Import CSV';
        _setCount(total);
        table.setServerData(rows.map(WsTable.mapRow), {
          page: pagination.page,
          limit: pagination.limit,
          total: total,
          totalPages: pagination.totalPages || pagination.total_pages
        });
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        Lex.Redact.off(table);
        console.error('[WorkspaceData] Load failed:', err);
        _setCount('');
        table.setServerError('Connected data could not be loaded. Check your connection and try again.');
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Stat cards
  // ═══════════════════════════════════════════════════════════════

  function _formatEntityType(type) {
    if (!type) return '-';
    return type.split('_').map(function (w) {
      return w.charAt(0).toUpperCase() + w.substring(1);
    }).join(' ');
  }

  /** Cached annotation count for the stat card (refreshed on each _loadData). */
  var _annotationStatTotal = 0;

  function _updateStatCards(total, filters) {
    var container = el('wsDataStatCards');
    if (!container) return;

    var entityTypes = (filters && filters.entity_types) || [];
    var connectors  = (filters && filters.connectors)   || [];

    var html =
      '<div style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;">' +
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Total Records</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);">' + total + '</p>' +
      '</div>' +
      '<div style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;">' +
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Entity Types</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);">' + entityTypes.length + '</p>' +
      '</div>' +
      '<div style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;">' +
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Connectors</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);">' + connectors.length + '</p>' +
      '</div>' +
      '<div id="wsDataAnnotationStatCard" style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;">' +
        '<p id="wsDataAnnotationStatLabel" style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Annotations</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);" id="wsDataAnnotationStatCount">' + _annotationStatTotal + '</p>' +
      '</div>' +
      '<div id="wsDataChangesStatCard" style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;cursor:default;" title="Changes in the last 7 days">' +
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Recent Changes</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);" id="wsDataChangesStatCount">-</p>' +
      '</div>';

    container.innerHTML = html;

    // Asynchronously refresh the annotations count so the card
    // stays accurate without blocking the main data render.
    _refreshAnnotationStatCard();

    // Asynchronously fetch 7-day change summary for the stat card.
    _refreshChangesStatCard();
  }

  /**
   * Fetch the total annotation count for this matter from the backend aggregate
   * endpoint and update the stat card counter in-place.
   * Falls back to summing the current page's annotation_count values if the
   * API call fails, and labels the card accordingly.
   */
  function _refreshAnnotationStatCard() {
    if (!_matterId) return;

    var url = '/api/v1/matters/' + encodeURIComponent(_matterId) +
              '/connected-data/annotations/total-count';

    api.get(url).then(function (result) {
      var total = (result && result.data && result.data.total !== undefined)
        ? result.data.total
        : null;

      if (total !== null) {
        _annotationStatTotal = total;
        var countEl = el('wsDataAnnotationStatCount');
        if (countEl) countEl.textContent = String(total);
      } else {
        _refreshAnnotationStatCardFromPage();
      }
    }).catch(function () {
      // Endpoint not yet available — fall back to page-scoped sum
      _refreshAnnotationStatCardFromPage();
    });
  }

  /**
   * Fallback: sum annotation_count from the current page rows in _rowDataMap.
   * Labels the stat card to indicate it reflects the current page only.
   */
  function _refreshAnnotationStatCardFromPage() {
    var sum = 0;
    var keys = Object.keys(_rowDataMap);
    for (var k = 0; k < keys.length; k++) {
      var row = _rowDataMap[keys[k]];
      sum += (row.annotation_count || 0);
    }
    _annotationStatTotal = sum;
    var countEl = el('wsDataAnnotationStatCount');
    if (countEl) countEl.textContent = String(sum);
    // Update the label to signal page-scoped count
    var labelEl = el('wsDataAnnotationStatLabel');
    if (labelEl && labelEl.textContent.indexOf('(this page)') === -1) {
      labelEl.textContent = labelEl.textContent + ' (this page)';
    }
  }

  /**
   * Fetch the 7-day change summary for this matter's organization and
   * update the "Recent Changes" stat card counter in-place.
   * Silent failure — the card shows "-" if the endpoint is unavailable.
   */
  function _refreshChangesStatCard() {
    if (!_matterId) return;
    var url = '/api/v1/matters/' + encodeURIComponent(_matterId) +
              '/connected-data/change-summary?days=7';
    api.get(url).then(function (result) {
      var data = (result && result.data) || {};
      var total = (data.total !== undefined) ? data.total : '-';
      var countEl = el('wsDataChangesStatCount');
      if (countEl) countEl.textContent = String(total);
    }).catch(function () {
      // Silently ignore — feature may not be enabled yet
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Filter options
  // ═══════════════════════════════════════════════════════════════

  function _entityLabel(value) {
    return Lex.Utils.humanizeLabel(value);
  }

  function _connectorLabel(value) {
    return value;
  }

  function _updateFilterOptions(filters) {
    _entityOptions = WsTable.mergeFacetOptions(_entityOptions, filters && filters.entity_types, 'entity_type', _entityLabel);
    _connectorOptions = WsTable.mergeFacetOptions(_connectorOptions, filters && filters.connectors, 'connector_id', _connectorLabel);
    _applyColumnFilterOptions();
    var table = _table();
    _syncEntitySelect(table ? table.serverQuery.filters : {});
  }

  // Every column filters (the table standard).
  function _applyColumnFilterOptions() {
    var table = _table();
    if (!table) return;
    var shared = window.LanaLibraryColumnFilters;
    var pick = function (option) { return { value: option.value, label: option.label }; };
    var map = {
      external_id: { text: true, placeholder: 'ID contains...' },
      raw_data: { text: true, placeholder: 'Data contains...' }
    };
    if (_entityOptions.length) map.entity_type = { single: true, options: _entityOptions.map(pick) };
    if (_connectorOptions.length) map.connector_id = { single: true, options: _connectorOptions.map(pick) };
    if (shared) {
      map.synced_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
      map.created_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    }
    table.setColumnFilterOptions(map);
  }

  // The toolbar Entity type select mirrors the table's entity_type filter.
  function _syncEntitySelect(filters) {
    var select = el('wsDataEntityFilter');
    if (!select) return;
    var current = WsTable.filterValues(filters && filters.entity_type)[0] || 'all';
    var options = [{ value: 'all', label: 'All' }].concat(_entityOptions.map(function (option) {
      return { value: option.value, label: option.label + (option.count != null ? ' (' + option.count + ')' : '') };
    }));
    if (current !== 'all' && !options.some(function (o) { return o.value === current; })) {
      options.push({ value: current, label: _entityLabel(current) });
    }
    var serialized = JSON.stringify(options);
    if (select.getAttribute('options') !== serialized) select.setAttribute('options', serialized);
    if (select.getAttribute('value') !== current) select.setAttribute('value', current);
  }

  // ═══════════════════════════════════════════════════════════════
  // Row formatting
  // ═══════════════════════════════════════════════════════════════

  /** Keep full row data for detail view */
  var _rowDataMap = {};

  /**
   * Extract the user-facing row_data from the connector data JSONB.
   * Google Sheets stores actual values in data.row_data; other connectors
   * may store them flat in data directly.
   */
  function _getRowData(data) {
    return WsTable.getRowData(data);
  }

  // ═══════════════════════════════════════════════════════════════
  // Row click — show raw data modal
  // ═══════════════════════════════════════════════════════════════

  function _wireRowClick() {
    var table = el('wsDataTable');
    if (!table || table._rowClickWired) return;
    table._rowClickWired = true;
    table.addEventListener('row-click', function (e) {
      var detail = e.detail || {};
      var rowId = detail.id;
      var fullRow = _rowDataMap[rowId];
      if (fullRow && fullRow.data) {
        _showDataModal(fullRow);
      }
    });
  }

  /**
   * Show the record detail modal with three tabs:
   *   Data | Annotations | Changes
   *
   * @param {Object} row - Full connector_data row from _rowDataMap.
   */
  function _showDataModal(row) {
    var existing = document.getElementById('wsDataRawModal');
    if (existing) existing.remove();

    var escHtml = Lex.Utils.escapeHtml;
    var data    = row.data || {};
    var rowData = _getRowData(data);

    // ── Collect metadata (internal _ fields) ─────────────────────
    var meta     = {};
    var dataKeys = Object.keys(data);
    for (var i = 0; i < dataKeys.length; i++) {
      if (dataKeys[i].charAt(0) === '_') meta[dataKeys[i]] = data[dataKeys[i]];
    }

    // ── Data tab: field grid ──────────────────────────────────────
    var fieldsHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 2rem;">';
    var rdKeys = Object.keys(rowData);
    for (var j = 0; j < rdKeys.length; j++) {
      var key    = rdKeys[j];
      var val    = rowData[key];
      var valStr = (val !== null && val !== undefined) ? String(val) : '';
      fieldsHtml +=
        '<div style="padding:4px 0;">' +
          '<div style="font-size:11px;font-weight:500;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;">' + escHtml(key) + '</div>' +
          '<div style="font-size:13px;color:#111827;margin-top:2px;word-break:break-word;">' +
            (valStr.length > 0 ? escHtml(valStr) : '<span style="color:#d1d5db;font-style:italic;">empty</span>') +
          '</div>' +
        '</div>';
    }
    fieldsHtml += '</div>';

    // Metadata section (collapsible)
    var metaHtml = '';
    var metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      metaHtml = '<details style="margin-top:1rem;">' +
        '<summary style="font-size:11px;color:#9ca3af;cursor:pointer;">Metadata</summary>' +
        '<div style="margin-top:0.5rem;background:#f9fafb;border-radius:6px;padding:0.75rem;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">';
      for (var m = 0; m < metaKeys.length; m++) {
        metaHtml +=
          '<div style="padding:2px 0;"><span style="color:#9ca3af;">' + escHtml(metaKeys[m]) + ':</span> ' +
          '<span style="color:#4b5563;">' + escHtml(String(meta[metaKeys[m]])) + '</span></div>';
      }
      metaHtml += '</div></details>';
    }

    // Raw JSON section (collapsible)
    var jsonHtml =
      '<details style="margin-top:0.75rem;">' +
      '<summary style="font-size:11px;color:#9ca3af;cursor:pointer;">Raw JSON</summary>' +
      '<pre style="margin-top:0.5rem;background:#f9fafb;border-radius:6px;padding:0.75rem;font-size:11px;' +
        'line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:250px;overflow-y:auto;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#374151;">' +
        escHtml(JSON.stringify(data, null, 2)) +
      '</pre></details>';

    var dataTabContent = fieldsHtml + metaHtml + jsonHtml;

    // ── Changes tab: content is loaded lazily when the tab is first activated ──
    // _renderChangesTab() is called from _setActiveTab when index === 2

    // ── Assemble modal (lex-modal) ────────────────────────────────
    var content = document.createElement('div');
    content.className = 'ws-data-record-detail';

    var subtitle = document.createElement('p');
    subtitle.className = 'ws-data-record-subtitle';
    subtitle.textContent = [
      row.connector_name || row.connector_id || 'LANA',
      _formatEntityType(row.entity_type),
      row.synced_at ? (fmtDateTime(row.synced_at) || '') : ''
    ].filter(Boolean).join(' \u00b7 ');

    var tabNames  = ['Data', 'Annotations', 'Changes'];
    var tabIds    = ['wsModalTabData', 'wsModalTabAnnotations', 'wsModalTabChanges'];
    var tabBodies = ['wsModalBodyData', 'wsModalBodyAnnotations', 'wsModalBodyChanges'];

    var tabBar = document.createElement('div');
    tabBar.className = 'ws-data-record-tabs';
    tabBar.setAttribute('role', 'tablist');
    tabBar.innerHTML = tabNames.map(function (name, idx) {
      return '<button type="button" role="tab" class="ws-data-record-tab" id="' + tabIds[idx] + '" data-ws-modal-tab="' + idx + '">' + name + '</button>';
    }).join('');

    var bodyWrap = document.createElement('div');
    bodyWrap.className = 'ws-data-record-body';
    bodyWrap.innerHTML =
      '<div id="' + tabBodies[0] + '"></div>' +
      '<div id="' + tabBodies[1] + '" style="display:none;"></div>' +
      '<div id="' + tabBodies[2] + '" style="display:none;"></div>';
    bodyWrap.firstChild.innerHTML = dataTabContent;

    content.appendChild(subtitle);
    content.appendChild(tabBar);
    content.appendChild(bodyWrap);

    function _setActiveTab(index) {
      for (var t = 0; t < tabNames.length; t++) {
        var tabEl = document.getElementById(tabIds[t]);
        var bodyEl = document.getElementById(tabBodies[t]);
        if (!tabEl || !bodyEl) continue;
        var active = t === index;
        tabEl.classList.toggle('ws-data-record-tab--active', active);
        tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
        bodyEl.style.display = active ? 'block' : 'none';
      }
      // Annotations and Changes load lazily on first activation
      var lazy = index === 1 ? _renderAnnotationsTab : (index === 2 ? _renderChangesTab : null);
      var container = document.getElementById(tabBodies[index]);
      if (lazy && container && !container.getAttribute('data-loaded')) {
        container.setAttribute('data-loaded', '1');
        lazy(container, row.id, _matterId);
      }
    }

    var modal = Lex.Modal.open({ heading: 'Record detail', size: 'lg', content: content });
    modal.id = 'wsDataRawModal';
    modal.addEventListener('click', function (e) {
      var tab = e.target && e.target.closest ? e.target.closest('[data-ws-modal-tab]') : null;
      if (tab) _setActiveTab(Number(tab.getAttribute('data-ws-modal-tab')) || 0);
    });
    requestAnimationFrame(function () { _setActiveTab(0); });
  }

  // _setupChat() removed — managed by lex-lana-panel component

  // ═══════════════════════════════════════════════════════════════
  // Start
  // ═══════════════════════════════════════════════════════════════

  init();

})();
