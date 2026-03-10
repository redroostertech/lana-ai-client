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

  // ═══════════════════════════════════════════════════════════════
  // Module-level state
  // ═══════════════════════════════════════════════════════════════

  var _gen         = 0;
  var _matterId    = '';
  var _matterName  = '';
  var _currentPage = 1;
  var _pageSize    = 50;
  var _searchTerm  = '';
  var _entityFilter = '';
  var _connectorFilter = '';
  var _sortBy      = 'synced_at';
  var _sortDir     = 'desc';
  var _chatEl      = null;
  var _threadsEl   = null;

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

    _fetchMatterDetails();
  }

  // ═══════════════════════════════════════════════════════════════
  // Fetch matter details for breadcrumb/title
  // ═══════════════════════════════════════════════════════════════

  function _fetchMatterDetails() {
    api.get('/api/v1/matters/' + encodeURIComponent(_matterId))
      .then(function (result) {
        var matter = (result && result.data) || result || {};
        _matterName = matter.matter_name || matter.name || _matterId;

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
        _wirePagination();
        _wireAskLana();
        _setupChat();
        _loadData();
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Failed to fetch matter:', err);
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          Lex.Toast.error('Failed to load workspace details');
        }
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Search
  // ═══════════════════════════════════════════════════════════════

  function _wireSearch() {
    var input = el('wsDataSearch');
    if (!input || input._wired) return;
    input._wired = true;

    var debounce = null;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        _searchTerm = input.value.trim();
        _currentPage = 1;
        _loadData();
      }, 300);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Filters
  // ═══════════════════════════════════════════════════════════════

  function _wireFilters() {
    var entitySelect = el('wsDataEntityFilter');
    var connectorSelect = el('wsDataConnectorFilter');

    if (entitySelect && !entitySelect._wired) {
      entitySelect._wired = true;
      entitySelect.addEventListener('lex-change', function (e) {
        _entityFilter = (e.detail && e.detail.value) || '';
        _currentPage = 1;
        _loadData();
      });
    }

    if (connectorSelect && !connectorSelect._wired) {
      connectorSelect._wired = true;
      connectorSelect.addEventListener('lex-change', function (e) {
        _connectorFilter = (e.detail && e.detail.value) || '';
        _currentPage = 1;
        _loadData();
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Pagination
  // ═══════════════════════════════════════════════════════════════

  function _wirePagination() {
    var pager = el('wsDataPagination');
    if (!pager || pager._wired) return;
    pager._wired = true;
    pager.addEventListener('page-change', function (e) {
      var page = e.detail && e.detail.page;
      if (page && page !== _currentPage) {
        _currentPage = page;
        _loadData();
      }
    });
  }

  function _updatePagination(total) {
    var pager = el('wsDataPagination');
    if (!pager) return;
    var totalPages = Math.max(1, Math.ceil(total / _pageSize));
    pager.page       = _currentPage;
    pager.totalPages = totalPages;
    pager.total      = total;
    pager.limit      = _pageSize;
  }

  // ═══════════════════════════════════════════════════════════════
  // Annotation badges on table rows
  // ═══════════════════════════════════════════════════════════════

  /**
   * Post-process the rendered table DOM to append annotation badge(s) and
   * correction indicator to each row that has annotations.
   *
   * Runs inside requestAnimationFrame so the table has finished painting.
   *
   * @param {HTMLElement} table - The lex-table element.
   */
  function _addAnnotationBadges(table) {
    if (!table) return;
    requestAnimationFrame(function () {
      var rows = table.querySelectorAll('tbody tr');
      for (var i = 0; i < rows.length; i++) {
        var rowId   = rows[i].getAttribute('data-row-id');
        var fullRow = _rowDataMap[rowId];
        if (!fullRow) continue;

        var count       = fullRow.annotation_count || 0;
        var hasCorrect  = fullRow.has_corrections  || false;
        if (!count && !hasCorrect) continue;

        // Inject badges into the last visible cell
        var cells = rows[i].querySelectorAll('td');
        if (!cells.length) continue;
        var lastCell = cells[cells.length - 1];

        var badgeWrap = document.createElement('span');
        badgeWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:6px;';

        if (count > 0) {
          var countBadge = document.createElement('span');
          countBadge.title = count + ' annotation' + (count === 1 ? '' : 's');
          countBadge.style.cssText =
            'display:inline-flex;align-items:center;justify-content:center;' +
            'background:#2563eb;color:#fff;border-radius:9999px;' +
            'font-size:10px;font-weight:600;min-width:16px;height:16px;padding:0 4px;' +
            'line-height:1;';
          countBadge.textContent = String(count);
          badgeWrap.appendChild(countBadge);
        }

        if (hasCorrect) {
          var corrBadge = document.createElement('span');
          corrBadge.title = 'Has corrections';
          corrBadge.style.cssText =
            'display:inline-flex;align-items:center;justify-content:center;' +
            'background:#d97706;color:#fff;border-radius:3px;' +
            'font-size:10px;font-weight:700;min-width:16px;height:16px;padding:0 3px;' +
            'line-height:1;';
          corrBadge.textContent = 'C';
          badgeWrap.appendChild(corrBadge);
        }

        lastCell.appendChild(badgeWrap);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Bulk selection & bulk annotate action bar
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add a checkbox to the first cell of each table row and wire shift+click
   * multi-select. When 1+ rows are selected, show the bulk action bar.
   *
   * @param {HTMLElement} table
   */
  function _wireCheckboxColumn(table) {
    if (!table) return;
    requestAnimationFrame(function () {
      var rows = table.querySelectorAll('tbody tr');
      for (var i = 0; i < rows.length; i++) {
        (function (row) {
          var rowId = row.getAttribute('data-row-id');
          if (!rowId) return;
          var firstCell = row.querySelector('td');
          if (!firstCell) return;

          // Avoid double-wiring on re-renders
          if (firstCell.querySelector('.ws-row-checkbox')) return;

          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'ws-row-checkbox';
          cb.style.cssText = 'margin-right:6px;cursor:pointer;flex-shrink:0;';
          cb.checked = !!_selectedRowIds[rowId];

          cb.addEventListener('change', function (e) {
            e.stopPropagation();
            if (cb.checked) {
              _selectedRowIds[rowId] = true;
            } else {
              delete _selectedRowIds[rowId];
            }
            _syncBulkBar();
          });

          // Stop row-click from propagating when clicking checkbox
          cb.addEventListener('click', function (e) { e.stopPropagation(); });

          firstCell.insertBefore(cb, firstCell.firstChild);
        })(rows[i]);
      }
    });
  }

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
      '<select id="wsDataBulkType" style="padding:4px 8px;border-radius:6px;border:1px solid #475569;background:#334155;color:#f8fafc;font-size:13px;">' +
        '<option value="note">Note</option>' +
        '<option value="tag">Tag</option>' +
        '<option value="status">Status</option>' +
        '<option value="correction">Correction</option>' +
        '<option value="flag">Flag</option>' +
      '</select>' +
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

    var annotationType = typeEl.value;
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
            '<select id="wsAnnNewType" style="padding:4px 8px;border-radius:6px;border:1px solid #d1d5db;font-size:12px;">' +
              '<option value="note">Note</option>' +
              '<option value="tag">Tag</option>' +
              '<option value="status">Status</option>' +
              '<option value="correction">Correction</option>' +
              '<option value="flag">Flag</option>' +
            '</select>' +
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
            annotation_type: typeEl ? typeEl.value : 'note',
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
  // Ask LANA button
  // ═══════════════════════════════════════════════════════════════

  function _wireAskLana() {
    var btn = el('askLanaBtn');
    var closeBtn = el('closeChatBtn');
    var chatCol = el('wsDataChatColumn');
    if (!chatCol) return;

    function _openChat() {
      chatCol.style.display = 'flex';
      setTimeout(function () {
        if (!_chatEl) return;
        var composer = _chatEl.querySelector('lex-chat-composer');
        if (composer) {
          var input = composer.querySelector('textarea, input, [contenteditable]');
          if (input) input.focus();
        }
      }, 150);
    }

    function _closeChat() {
      chatCol.style.display = 'none';
    }

    if (btn) btn.addEventListener('click', _openChat);
    if (closeBtn) closeBtn.addEventListener('click', _closeChat);
  }

  // ═══════════════════════════════════════════════════════════════
  // Data loading
  // ═══════════════════════════════════════════════════════════════

  function _loadData() {
    var gen = ++_gen;
    var table = el('wsDataTable');
    if (!table) return;

    _rowDataMap = {};
    Lex.Redact.on(table);

    var url = '/api/v1/matters/' + encodeURIComponent(_matterId) + '/connected-data' +
      '?page=' + _currentPage +
      '&limit=' + _pageSize +
      '&sort_by=' + encodeURIComponent(_sortBy) +
      '&sort_dir=' + encodeURIComponent(_sortDir);

    if (_searchTerm) {
      url += '&search=' + encodeURIComponent(_searchTerm);
    }
    if (_entityFilter) {
      url += '&entity_type=' + encodeURIComponent(_entityFilter);
    }
    if (_connectorFilter) {
      url += '&connector_id=' + encodeURIComponent(_connectorFilter);
    }

    api.get(url)
      .then(function (result) {
        if (gen !== _gen) return;

        var rows = (result && result.data) || [];
        var pagination = (result && result.pagination) || {};
        var filters = (result && result.filters) || {};
        var total = pagination.total || rows.length;

        // Update stat cards
        _updateStatCards(total, filters);

        // Update filter dropdowns
        _updateFilterOptions(filters);

        // Format rows for display
        var formatted = rows.map(function (row) {
          return _formatRow(row);
        });

        Lex.Redact.off(table);
        table.setData(formatted);
        _updatePagination(total);
        _wireRowClick();
        _linkifyConnectorCells(table);
        _addAnnotationBadges(table);
        _wireCheckboxColumn(table);
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        Lex.Redact.off(table);
        console.error('[WorkspaceData] Load failed:', err);
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          Lex.Toast.error('Failed to load connected data');
        }
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
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Annotations</p>' +
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

  function _updateFilterOptions(filters) {
    var entitySelect = el('wsDataEntityFilter');
    var connectorSelect = el('wsDataConnectorFilter');

    if (entitySelect && filters.entity_types) {
      var entityOptions = [{ value: '', label: 'All Entity Types' }];
      for (var i = 0; i < filters.entity_types.length; i++) {
        var et = filters.entity_types[i];
        var label = _formatEntityType(et.entity_type) + ' (' + et.count + ')';
        entityOptions.push({ value: et.entity_type, label: label });
      }
      entitySelect.setAttribute('options', JSON.stringify(entityOptions));
      if (_entityFilter) {
        entitySelect.setAttribute('value', _entityFilter);
      }
    }

    if (connectorSelect && filters.connectors) {
      var connectorOptions = [{ value: '', label: 'All Connectors' }];
      for (var j = 0; j < filters.connectors.length; j++) {
        var c = filters.connectors[j];
        var cLabel = (c.connector_id || 'Unknown') + ' (' + c.count + ')';
        connectorOptions.push({ value: c.connector_id, label: cLabel });
      }
      connectorSelect.setAttribute('options', JSON.stringify(connectorOptions));
      if (_connectorFilter) {
        connectorSelect.setAttribute('value', _connectorFilter);
      }
    }
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
    if (!data || typeof data !== 'object') return {};
    if (data.row_data && typeof data.row_data === 'object') return data.row_data;
    // Fallback: use non-internal fields from data itself
    var out = {};
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].charAt(0) !== '_') out[keys[i]] = data[keys[i]];
    }
    return out;
  }

  function _formatDataSummary(data) {
    var rowData = _getRowData(data);
    var keys = Object.keys(rowData);
    if (keys.length === 0) return '-';
    var parts = [];
    for (var i = 0; i < keys.length && parts.length < 3; i++) {
      var val = rowData[keys[i]];
      if (val == null || val === '') continue;
      var str = String(val);
      if (str.length > 40) str = str.substring(0, 37) + '...';
      parts.push(keys[i] + ': ' + str);
    }
    var result = parts.join('  |  ');
    if (result.length > 140) result = result.substring(0, 137) + '...';
    return result || '-';
  }

  function _formatRow(row) {
    if (row.id) _rowDataMap[row.id] = row;
    var formatted = {
      id:               row.id || '',
      external_id:      row.external_id ? '...' + row.external_id.substring(row.external_id.length - 6) : '-',
      entity_type:      _formatEntityType(row.entity_type),
      connector_id:     row.connector_name || row.connector_id || 'LANA',
      raw_data:         _formatDataSummary(row.data),
      // Annotation metadata passed through for badge rendering
      annotation_count: row.annotation_count || 0,
      has_corrections:  row.has_corrections  || false
    };
    // Visual indicator for source-deleted records — muted/strikethrough style
    if (row.source_deleted) {
      formatted._rowStyle = 'opacity:0.45;text-decoration:line-through;';
      formatted.entity_type = formatted.entity_type + ' (removed)';
    }
    return formatted;
  }

  /**
   * Post-process rendered table to turn connector cells into hyperlinks
   * pointing directly to the connector viewer page.
   * Non-connector data shows "LANA" with no link.
   */
  function _linkifyConnectorCells(table) {
    if (!table) return;
    requestAnimationFrame(function () {
      var rows = table.querySelectorAll('tbody tr');
      for (var i = 0; i < rows.length; i++) {
        var rowId = rows[i].getAttribute('data-row-id');
        var fullRow = _rowDataMap[rowId];
        // connector_id is the 3rd visible column (index 2)
        var cells = rows[i].querySelectorAll('td');
        if (cells.length < 3) continue;
        var cell = cells[2];
        var text = (cell.textContent || '').trim();
        if (!text || text === 'LANA' || text === '-') continue;
        if (!fullRow || !fullRow.connector_ui_url) continue;

        // Build direct link to connector-viewer
        var params = new URLSearchParams({
          ui: fullRow.connector_ui_url,
          name: fullRow.connector_name || fullRow.connector_id || '',
          connectorId: fullRow.connector_id || ''
        });
        var href = 'integrations/connector-viewer.html?' + params.toString();

        var link = document.createElement('a');
        link.href = href;
        link.textContent = fullRow.connector_name || text;
        link.style.cssText = 'color:var(--lex-accent, #2563eb);text-decoration:none;';
        link.addEventListener('mouseenter', function () { this.style.textDecoration = 'underline'; });
        link.addEventListener('mouseleave', function () { this.style.textDecoration = 'none'; });
        link.addEventListener('click', function (e) { e.stopPropagation(); });
        cell.textContent = '';
        cell.appendChild(link);
      }
    });
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

    // ── Assemble modal ────────────────────────────────────────────
    var overlay = document.createElement('div');
    overlay.id = 'wsDataRawModal';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,0.4);';

    var panel = document.createElement('div');
    panel.style.cssText =
      'background:#fff;border-radius:12px;width:680px;max-width:92vw;max-height:82vh;' +
      'display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.15);';

    // Header
    var header = document.createElement('div');
    header.style.cssText =
      'padding:1rem 1.25rem;border-bottom:1px solid #e5e7eb;' +
      'display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML =
      '<div>' +
        '<p style="margin:0;font-weight:600;font-size:14px;color:#111827;">Record Detail</p>' +
        '<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">' +
          escHtml(row.connector_id || '') + ' &middot; ' + escHtml(row.entity_type || '') +
          (row.synced_at ? ' &middot; ' + (fmtDateTime(row.synced_at) || '') : '') +
        '</p>' +
      '</div>' +
      '<button id="wsDataRawClose" style="background:none;border:none;cursor:pointer;padding:4px;color:#9ca3af;border-radius:4px;" title="Close">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' +
        '</svg>' +
      '</button>';

    // Tab bar
    var tabBar = document.createElement('div');
    tabBar.style.cssText =
      'display:flex;border-bottom:1px solid #e5e7eb;flex-shrink:0;padding:0 1.25rem;';

    var tabNames  = ['Data', 'Annotations', 'Changes'];
    var tabIds    = ['wsModalTabData', 'wsModalTabAnnotations', 'wsModalTabChanges'];
    var tabBodies = ['wsModalBodyData', 'wsModalBodyAnnotations', 'wsModalBodyChanges'];

    function _setActiveTab(index) {
      for (var t = 0; t < tabNames.length; t++) {
        var tabEl = document.getElementById(tabIds[t]);
        var bodyEl = document.getElementById(tabBodies[t]);
        if (!tabEl || !bodyEl) continue;
        if (t === index) {
          tabEl.style.borderBottom = '2px solid #2563eb';
          tabEl.style.color = '#2563eb';
          bodyEl.style.display = 'block';
        } else {
          tabEl.style.borderBottom = '2px solid transparent';
          tabEl.style.color = '#6b7280';
          bodyEl.style.display = 'none';
        }
        // Load annotations tab lazily on first activation
        if (t === 1 && index === 1) {
          var annContainer = document.getElementById(tabBodies[1]);
          if (annContainer && !annContainer.getAttribute('data-loaded')) {
            annContainer.setAttribute('data-loaded', '1');
            _renderAnnotationsTab(annContainer, row.id, _matterId);
          }
        }
        // Load changes tab lazily on first activation
        if (t === 2 && index === 2) {
          var changesContainer = document.getElementById(tabBodies[2]);
          if (changesContainer && !changesContainer.getAttribute('data-loaded')) {
            changesContainer.setAttribute('data-loaded', '1');
            _renderChangesTab(changesContainer, row.id, _matterId);
          }
        }
      }
    }

    for (var ti = 0; ti < tabNames.length; ti++) {
      var btn = document.createElement('button');
      btn.id = tabIds[ti];
      btn.textContent = tabNames[ti];
      btn.style.cssText =
        'padding:0.5rem 1rem;border:none;background:none;cursor:pointer;font-size:13px;' +
        'font-weight:500;border-bottom:2px solid transparent;color:#6b7280;';
      (function (idx) {
        btn.addEventListener('click', function () { _setActiveTab(idx); });
      })(ti);
      tabBar.appendChild(btn);
    }

    // Body container
    var bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:1rem 1.25rem;';

    var dataBody = document.createElement('div');
    dataBody.id = tabBodies[0];
    dataBody.innerHTML = dataTabContent;

    var annBody = document.createElement('div');
    annBody.id = tabBodies[1];
    annBody.style.display = 'none';

    var changesBody = document.createElement('div');
    changesBody.id = tabBodies[2];
    changesBody.style.display = 'none';
    // Content loaded lazily by _setActiveTab when index === 2

    bodyWrap.appendChild(dataBody);
    bodyWrap.appendChild(annBody);
    bodyWrap.appendChild(changesBody);

    panel.appendChild(header);
    panel.appendChild(tabBar);
    panel.appendChild(bodyWrap);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Activate first tab
    _setActiveTab(0);

    // Close handlers
    document.getElementById('wsDataRawClose').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Chat integration (insights_chat)
  // ═══════════════════════════════════════════════════════════════

  function _setupChat() {
    var container = el('chatContainer');
    if (!container) return;

    // Create threads list
    _threadsEl = document.createElement('lex-chat-threads');
    _threadsEl.setAttribute('page-scope', 'workspace_data_' + _matterId);
    _threadsEl.setAttribute('context-type', 'insights_chat');
    _threadsEl.style.flexShrink = '0';

    // Create chat
    _chatEl = document.createElement('lex-chat');
    _chatEl.setAttribute('context-type', 'insights_chat');
    _chatEl.setAttribute('source', 'sse');
    _chatEl.setAttribute('placeholder', 'Ask about this workspace data...');
    _chatEl.style.flex = '1';
    _chatEl.style.minHeight = '0';

    container.appendChild(_threadsEl);
    container.appendChild(_chatEl);

    // Re-acquire live references after potential cloning
    var liveChat = container.querySelector('lex-chat');
    var liveThreads = container.querySelector('lex-chat-threads');
    if (liveChat) _chatEl = liveChat;
    if (liveThreads) _threadsEl = liveThreads;

    _threadsEl.style.flexShrink = '0';
    _chatEl.style.flex = '1';
    _chatEl.style.minHeight = '0';
    _chatEl.style.overflow = 'hidden';

    // Wire thread selection
    container.addEventListener('lex-thread-select', function (e) {
      var thread = e.detail && e.detail.thread;
      if (!thread || !_chatEl) return;
      _chatEl.clearConversation();
      _chatEl.loadConversation(thread.thread_id);
    });

    // Auto-select page_general thread when threads finish loading
    container.addEventListener('lex-threads-loaded', function (e) {
      var threads = e.detail && e.detail.threads;
      if (!threads || !threads.length || !_chatEl) return;
      for (var i = 0; i < threads.length; i++) {
        if (threads[i].thread_type === 'page_general' && threads[i].thread_id) {
          _chatEl.loadConversation(threads[i].thread_id);
          if (_threadsEl) _threadsEl.setActiveThread(threads[i].id);
          break;
        }
      }
    });

    // Wire new thread creation
    container.addEventListener('lex-thread-create', function () {
      if (!_chatEl) return;
      _chatEl.clearConversation();
      if (_threadsEl) _threadsEl.setActiveThread(null);
    });

    // Register page_general thread on first conversation
    container.addEventListener('lex-chat-conversation-created', function (e) {
      var conversationId = e.detail && e.detail.conversationId;
      if (!conversationId || typeof api === 'undefined') return;

      if (window.ConversationMenu && typeof window.ConversationMenu.addConversation === 'function') {
        window.ConversationMenu.addConversation({
          thread_id: conversationId,
          title: 'Workspace Data - ' + _matterName,
          updated_at: new Date().toISOString()
        });
      }

      var threadsComp = _threadsEl;
      if (threadsComp && threadsComp._threads && threadsComp._threads.length > 0) {
        for (var i = 0; i < threadsComp._threads.length; i++) {
          if (threadsComp._threads[i].thread_type === 'page_general') {
            var existingThread = threadsComp._threads[i];
            existingThread.thread_id = conversationId;
            api.put('/api/v1/conversation-threads/' + existingThread.id, {
              thread_id: conversationId
            }).catch(function (err) {
              console.warn('[WorkspaceData] Failed to update page thread thread_id:', err);
            });
            return;
          }
        }
      }

      api.post('/api/v1/conversation-threads', {
        title: 'Workspace Data - ' + _matterName,
        thread_type: 'page_general',
        context_type: 'insights_chat',
        page_scope: 'workspace_data_' + _matterId,
        thread_id: conversationId
      }).then(function (resp) {
        var created = resp.data || resp;
        if (_threadsEl) {
          _threadsEl.addThread(created);
          _threadsEl.setActiveThread(created.id);
        }
      }).catch(function (err) {
        console.warn('[WorkspaceData] Failed to register page thread:', err);
      });
    });

    // Wrap chat send to inject workspace context as attachment
    var origSend = _chatEl.send;
    if (typeof origSend === 'function') {
      _chatEl.send = function (content, opts) {
        opts = opts || {};
        opts.attachments = opts.attachments || {};
        opts.attachments.workspace = {
          matter_id: _matterId,
          matter_name: _matterName,
          context: 'workspace_connected_data'
        };
        return origSend.call(this, content, opts);
      };
    }

    // Lock composer tools to insights_chat
    setTimeout(function () {
      if (!_chatEl) return;
      var composer = _chatEl.querySelector('lex-chat-composer');
      if (!composer) return;

      var plusBtn = composer.querySelector('[data-plus]');
      if (plusBtn && plusBtn.parentElement) {
        plusBtn.parentElement.style.display = 'none';
      }

      if (typeof composer.setActiveTools === 'function') {
        composer.setActiveTools(['insights_chat']);
      }
      if (typeof composer.setToolsLocked === 'function') {
        composer.setToolsLocked(true);
      }
    }, 150);
  }

  // ═══════════════════════════════════════════════════════════════
  // Start
  // ═══════════════════════════════════════════════════════════════

  init();

})();
