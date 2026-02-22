/**
 * Admin Audit Logs — standalone page controller.
 *
 * Handles audit log listing, statistics, category filtering,
 * event info modal, and log detail drawer for admin/audit.html.
 *
 * @requires api.js                - window.api — getAuditEventTypes, getAuditStatistics,
 *                                    getAuditLogs, queryAuditLogs
 * @requires event-display-names.js - window.EventDisplayNames.getEventDisplayName
 * @requires lex.utils.js          - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-modal.js          - Lex.Modal (event info modal)
 * @requires lex-toast.js          - Lex.Toast.error
 * @requires lex-table.js          - table.setData()
 */

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases
  // =========================================================================

  var escHtml     = Lex.Utils.escapeHtml;
  var fmtDateTime = Lex.Utils.formatDateTime;

  // =========================================================================
  // Constants — event category classification
  // =========================================================================

  var SECURITY_PATTERNS = [
    'auth.failed',
    'auth.admin_denied',
    'permission.denied',
    'matter.access_denied',
    'security_violation',
    'user.login_failed'
  ];

  var USER_ACTION_PATTERNS = [
    'user.login',
    'user.logout',
    'user.deleted',
    'user.created',
    'user.updated',
    'matter.created',
    'matter.pinned',
    'matter.unpinned',
    'matter.updated',
    'matter.deleted',
    'matter.permanently_deleted',
    'document_uploaded',
    'document_upload',
    'document.permanently_deleted',
    'document_modification',
    'document_access',
    'folder.permanently_deleted',
    'chat_stream',
    'rag_query',
    'search_query',
    'hybrid_search',
    'api_token.created',
    'api_token.deleted',
    'role.created',
    'role.updated',
    'role.deleted',
    'role.assigned',
    'role.unassigned',
    'group.created',
    'group.updated',
    'group.deleted',
    'group.member_added',
    'group.member_removed',
    'board_metric.created',
    'board_metric.updated',
    'board_metric.deleted',
    'board_metric.reordered',
    'board_metric.roles_assigned',
    'management_board.created',
    'management_board.updated',
    'management_board.deleted',
    'management_board.user_assigned',
    'management_board.access_revoked',
    'metric_submission.created',
    'metric_submission.updated',
    'metric_submission.deleted',
    'actionstep_data_access'
  ];

  var SYSTEM_EVENT_PATTERNS = [
    'document_text_extraction_started',
    'document_text_extracted',
    'document_text_extraction_failed',
    'document_ai_indexed',
    'connector_document_sync',
    'bulk_import_completed',
    'metadata_update',
    'privilege_filter',
    'ml_classification',
    'ml_fallback',
    'ml_training',
    'ml_feedback',
    'session.started',
    'session.heartbeat',
    'session.ended',
    'on_demand_processing_triggered',
    'worker.started',
    'worker.completed',
    'worker.failed',
    'system.startup',
    'system.shutdown',
    'cache.cleared',
    'database.migration',
    'health.check',
    'backup.created',
    'backup.restored'
  ];

  // =========================================================================
  // Module-level state
  // =========================================================================

  var _currentPage     = 1;
  var _pageSize        = 10;
  var _logs            = [];
  var _eventTypes      = [];
  var _categoryFilter  = null;   // null | 'all' | 'security' | 'user' | 'system' | 'other'
  var _otherEventTypes = [];     // populated by loadStatistics

  // =========================================================================
  // Entry point
  // =========================================================================

  function init() {
    _wireStatCards();
    _wireInfoButtons();
    _wireFilters();
    _wireDrawer();
    _setDefaultDates();

    loadEventTypes();
    loadStatistics();
    loadLogs();
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  /**
   * Classify an event type into a category.
   * @param {string} type
   * @returns {string} 'security' | 'user' | 'system' | 'other'
   */
  function classifyEvent(type) {
    if (SECURITY_PATTERNS.indexOf(type) !== -1) return 'security';
    if (USER_ACTION_PATTERNS.indexOf(type) !== -1) return 'user';
    if (SYSTEM_EVENT_PATTERNS.indexOf(type) !== -1) return 'system';
    return 'other';
  }

  /**
   * Build the event types array for a given category (for query API).
   * @param {string} category
   * @returns {string[]}
   */
  function getCategoryEventTypes(category) {
    if (category === 'security') return SECURITY_PATTERNS.slice();
    if (category === 'user')     return USER_ACTION_PATTERNS.slice();
    if (category === 'system')   return SYSTEM_EVENT_PATTERNS.slice();
    if (category === 'other')    return _otherEventTypes.map(function (e) { return e.event_type; });
    return [];
  }

  /**
   * Build an HTML pill badge for an event type.
   * @param {string} eventType
   * @returns {string}
   */
  function eventTypePill(eventType) {
    var displayName = escHtml(EventDisplayNames.getEventDisplayName(eventType));
    return (
      '<span style="' +
        'display:inline-flex;align-items:center;' +
        'padding:2px 8px;border-radius:9999px;' +
        'font-size:var(--lex-body-xs-size,0.75rem);' +
        'font-weight:500;' +
        'background:var(--lex-status-neutral-bg,#F2F4F7);' +
        'color:var(--lex-text-secondary);' +
      '">' + displayName + '</span>'
    );
  }

  // =========================================================================
  // Wire UI
  // =========================================================================

  function _wireStatCards() {
    var cards = [
      { id: 'statCardAll',      category: 'all' },
      { id: 'statCardSecurity', category: 'security' },
      { id: 'statCardUser',     category: 'user' },
      { id: 'statCardSystem',   category: 'system' },
      { id: 'statCardOther',    category: 'other' }
    ];

    for (var i = 0; i < cards.length; i++) {
      (function (cfg) {
        var card = el(cfg.id);
        if (!card || card._auditWired) return;
        card._auditWired = true;
        card.addEventListener('click', function (e) {
          // Don't trigger card click if info button was clicked
          if (e.target.closest('button')) return;
          _selectCategory(cfg.category);
        });
      })(cards[i]);
    }
  }

  function _wireInfoButtons() {
    var buttons = [
      { id: 'infoSecurity', category: 'security' },
      { id: 'infoUser',     category: 'user' },
      { id: 'infoSystem',   category: 'system' },
      { id: 'infoOther',    category: 'other' }
    ];

    for (var i = 0; i < buttons.length; i++) {
      (function (cfg) {
        var btn = el(cfg.id);
        if (!btn || btn._auditWired) return;
        btn._auditWired = true;
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          _showEventInfo(cfg.category);
        });
      })(buttons[i]);
    }
  }

  function _wireFilters() {
    var applyBtn = el('applyFiltersBtn');
    var clearBtn = el('clearFiltersBtn');

    if (applyBtn && !applyBtn._auditWired) {
      applyBtn._auditWired = true;
      applyBtn.addEventListener('click', function () {
        _categoryFilter = null;
        _clearCardHighlights();
        _currentPage = 1;
        loadLogs();
      });
    }

    if (clearBtn && !clearBtn._auditWired) {
      clearBtn._auditWired = true;
      clearBtn.addEventListener('click', function () {
        var eventSelect = el('eventTypeFilter');
        var fromDate    = el('fromDate');
        var toDate      = el('toDate');
        if (eventSelect) eventSelect.value = '';
        if (fromDate)    fromDate.value    = '';
        if (toDate)      toDate.value      = '';
        _categoryFilter = null;
        _clearCardHighlights();
        _currentPage = 1;
        loadLogs();
      });
    }
  }

  function _wireDrawer() {
    var drawer = el('auditDrawer');
    if (!drawer || drawer._auditCloseWired) return;
    drawer._auditCloseWired = true;
    // No additional wiring needed — drawer just displays data
  }

  function _setDefaultDates() {
    var toDate = el('toDate');
    if (toDate) {
      var today = new Date();
      var yyyy = today.getFullYear();
      var mm   = String(today.getMonth() + 1);
      var dd   = String(today.getDate());
      if (mm.length < 2) mm = '0' + mm;
      if (dd.length < 2) dd = '0' + dd;
      toDate.value = yyyy + '-' + mm + '-' + dd;
    }
  }

  // =========================================================================
  // Category selection + card highlighting
  // =========================================================================

  function _selectCategory(category) {
    _categoryFilter = category;
    _currentPage = 1;

    // Highlight selected card
    _clearCardHighlights();
    var cardMap = {
      all:      'statCardAll',
      security: 'statCardSecurity',
      user:     'statCardUser',
      system:   'statCardSystem',
      other:    'statCardOther'
    };
    var cardId = cardMap[category];
    if (cardId) {
      var card = el(cardId);
      if (card) {
        card.style.outline = '2px solid var(--lex-bg-accent,#8B7355)';
        card.style.outlineOffset = '-2px';
      }
    }

    // Clear the event type filter select since we're using category
    var eventSelect = el('eventTypeFilter');
    if (eventSelect) eventSelect.value = '';

    loadLogs();
  }

  function _clearCardHighlights() {
    var ids = ['statCardAll', 'statCardSecurity', 'statCardUser', 'statCardSystem', 'statCardOther'];
    for (var i = 0; i < ids.length; i++) {
      var card = el(ids[i]);
      if (card) {
        card.style.outline = '';
        card.style.outlineOffset = '';
      }
    }
  }

  // =========================================================================
  // Load Event Types (for filter dropdown)
  // =========================================================================

  function loadEventTypes() {
    api.getAuditEventTypes()
      .then(function (result) {
        _eventTypes = result.event_types || [];
        var selectEl = el('eventTypeFilter');
        if (!selectEl) return;

        var opts = [{ value: '', label: 'All Event Types' }];
        for (var i = 0; i < _eventTypes.length; i++) {
          var et = _eventTypes[i];
          var eventType = typeof et === 'string' ? et : et.event_type;
          var count = (typeof et === 'object' && et.count) ? ' (' + et.count + ')' : '';
          opts.push({ value: eventType, label: eventType + count });
        }
        selectEl.options = opts;
      })
      .catch(function (err) {
        console.error('[admin-audit] loadEventTypes error:', err);
      });
  }

  // =========================================================================
  // Load Statistics
  // =========================================================================

  function loadStatistics() {
    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    api.getAuditStatistics(thirtyDaysAgo.toISOString(), new Date().toISOString())
      .then(function (result) {
        var totalEl = el('statTotal');
        if (totalEl) totalEl.textContent = result.total_events || 0;

        // Classify events from by_event_type
        var byType = result.by_event_type || [];
        var securityEvents = 0;
        var userEvents     = 0;
        var systemEvents   = 0;
        var otherEvents    = 0;

        _otherEventTypes = [];

        for (var i = 0; i < byType.length; i++) {
          var item  = byType[i];
          var type  = item.event_type;
          var count = parseInt(item.count, 10) || 0;
          var cat   = classifyEvent(type);

          if (cat === 'security')    securityEvents += count;
          else if (cat === 'user')   userEvents += count;
          else if (cat === 'system') systemEvents += count;
          else {
            otherEvents += count;
            _otherEventTypes.push({ event_type: type, count: count });
          }
        }

        var secEl = el('statSecurity');
        var usrEl = el('statUser');
        var sysEl = el('statSystem');
        var othEl = el('statOther');

        if (secEl) secEl.textContent = securityEvents;
        if (usrEl) usrEl.textContent = userEvents;
        if (sysEl) sysEl.textContent = systemEvents;
        if (othEl) othEl.textContent = otherEvents;
      })
      .catch(function (err) {
        console.error('[admin-audit] loadStatistics error:', err);
      });
  }

  // =========================================================================
  // Load Logs (server-side pagination, category filtering)
  // =========================================================================

  function loadLogs() {
    var table = el('auditTable');
    if (table) Lex.Redact.on(table);

    var eventSelect = el('eventTypeFilter');
    var fromDateEl  = el('fromDate');
    var toDateEl    = el('toDate');

    var eventType = eventSelect ? (eventSelect.value || '') : '';
    var fromDate  = fromDateEl  ? (fromDateEl.value  || '') : '';
    var toDate    = toDateEl    ? (toDateEl.value    || '') : '';

    var promise;

    // Path 1: Category filter active and no manual event type override
    if (_categoryFilter && _categoryFilter !== 'all' && !eventType) {
      if (_categoryFilter === 'other') {
        // For "other", fetch a large batch and filter client-side
        var filters = {};
        if (fromDate) filters.start_date = fromDate;
        if (toDate)   filters.end_date   = toDate;

        promise = api.getAuditLogs(1, 1000, filters).then(function (result) {
          var allLogs = result.logs || [];

          // Build set of all known event types for fast lookup
          var knownSet = {};
          var allKnown = SECURITY_PATTERNS.concat(USER_ACTION_PATTERNS).concat(SYSTEM_EVENT_PATTERNS);
          for (var k = 0; k < allKnown.length; k++) {
            knownSet[allKnown[k]] = true;
          }

          // Filter to only "other" events
          var otherLogs = [];
          for (var m = 0; m < allLogs.length; m++) {
            if (!knownSet[allLogs[m].event_type]) {
              otherLogs.push(allLogs[m]);
            }
          }

          // Client-side pagination
          var startIdx = (_currentPage - 1) * _pageSize;
          _logs = otherLogs.slice(startIdx, startIdx + _pageSize);
          var total = otherLogs.length;

          return { logs: _logs, total: total };
        });
      } else {
        // Use query API for category filtering
        var queryBody = {
          limit:  _pageSize,
          offset: (_currentPage - 1) * _pageSize,
          event_types: getCategoryEventTypes(_categoryFilter)
        };
        if (fromDate) queryBody.start_date = new Date(fromDate).toISOString();
        if (toDate)   queryBody.end_date   = new Date(toDate).toISOString();

        promise = api.queryAuditLogs(queryBody).then(function (result) {
          _logs = result.logs || [];
          var total = (result.pagination && result.pagination.total) || result.total || _logs.length;
          return { logs: _logs, total: total };
        });
      }
    }
    // Path 2: Default — use simple GET endpoint
    else {
      var simpleFilters = {};
      if (eventType) simpleFilters.event_type = eventType;
      if (fromDate)  simpleFilters.start_date = fromDate;
      if (toDate)    simpleFilters.end_date   = toDate;

      promise = api.getAuditLogs(_currentPage, _pageSize, simpleFilters).then(function (result) {
        _logs = result.logs || [];
        var total = (result.pagination && result.pagination.total) || result.total || _logs.length;
        return { logs: _logs, total: total };
      });
    }

    promise
      .then(function (data) {
        if (table) {
          Lex.Redact.off(table);
          _ensureTableObserver(table);
          table.setData(data.logs);
        }
        _renderPagination(data.total);
      })
      .catch(function (err) {
        if (table) Lex.Redact.off(table);
        console.error('[admin-audit] loadLogs error:', err);
        Lex.Toast.error('Failed to load audit logs');
      });
  }

  // =========================================================================
  // Table Renderers (MutationObserver pattern)
  // =========================================================================

  function _ensureTableObserver(table) {
    if (table._auditRendererAttached) return;
    table._auditRendererAttached = true;

    new MutationObserver(function () {
      requestAnimationFrame(function () { _applyTableRenderers(table); });
    }).observe(table, { childList: true });
  }

  function _applyTableRenderers(table) {
    var rows = (table.dataSource && table.dataSource.data) || [];

    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    var trs = tbody.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr  = trs[i];
      var row = rows[i];
      if (!row) continue;

      var tds = tr.querySelectorAll('td');
      if (tds.length === 0) continue;

      // Column order: timestamp(0), event_type(1), user_email(2), ip_address(3)

      // Timestamp cell (index 0): formatted datetime
      if (tds[0] && row.timestamp) {
        tds[0].innerHTML =
          '<span style="font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-secondary);white-space:nowrap;">' +
            escHtml(fmtDateTime(row.timestamp)) +
          '</span>';
      }

      // Event type cell (index 1): pill badge
      if (tds[1] && row.event_type) {
        tds[1].innerHTML = eventTypePill(row.event_type);
      }

      // User email cell (index 2): break long emails
      if (tds[2]) {
        tds[2].innerHTML =
          '<div style="max-width:16rem;word-break:break-all;font-size:var(--lex-body-sm-size,0.875rem);">' +
            escHtml(row.user_email || '-') +
          '</div>';
      }

      // Actions cell — append "View" button if not already there
      var logId = escHtml(String(row.id || ''));
      var actionsCell = tr.querySelector('td.audit-actions-cell');
      if (!actionsCell) {
        actionsCell = document.createElement('td');
        actionsCell.className = 'audit-actions-cell';
        actionsCell.style.cssText = 'white-space:nowrap;text-align:right;padding-right:0.5rem;';
        tr.appendChild(actionsCell);
      }
      actionsCell.innerHTML =
        '<button data-log-id="' + logId + '" ' +
          'style="font-size:var(--lex-body-sm-size,0.875rem);font-weight:500;' +
          'color:var(--lex-bg-accent,#8B7355);cursor:pointer;background:none;border:none;padding:4px 8px;">' +
          'View' +
        '</button>';

      // Wire the view button
      (function (rowRef) {
        var viewBtn = actionsCell.querySelector('button');
        if (viewBtn && !viewBtn._auditWired) {
          viewBtn._auditWired = true;
          viewBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            _viewLogDetails(rowRef);
          });
        }
      })(row);
    }
  }

  // =========================================================================
  // Pagination (server-side — manual prev/next)
  // =========================================================================

  function _renderPagination(total) {
    var infoEl = el('paginationInfo');
    var ctrlEl = el('paginationControls');

    if (!total || total === 0) {
      if (infoEl) infoEl.textContent = '';
      if (ctrlEl) ctrlEl.innerHTML   = '';
      return;
    }

    var totalPages = Math.ceil(total / _pageSize);
    var start      = ((_currentPage - 1) * _pageSize) + 1;
    var end        = Math.min(_currentPage * _pageSize, total);

    if (infoEl) {
      infoEl.textContent = 'Showing ' + start + '-' + end + ' of ' + total + ' logs';
    }

    if (!ctrlEl) return;

    if (totalPages <= 1) {
      ctrlEl.innerHTML = '';
      return;
    }

    var prevDisabled = _currentPage <= 1;
    var nextDisabled = _currentPage >= totalPages;

    var btnStyle = 'padding:6px 12px;border-radius:var(--lex-radius-md,6px);' +
      'border:1px solid var(--lex-border-default);font-size:var(--lex-body-sm-size,0.875rem);cursor:pointer;';
    var disabledStyle = 'opacity:0.4;cursor:not-allowed;';

    ctrlEl.innerHTML =
      '<button id="paginationPrev" style="' + btnStyle + (prevDisabled ? disabledStyle : 'background:var(--lex-bg-primary);color:var(--lex-text-primary);') + '"' +
        (prevDisabled ? ' disabled' : '') + '>Previous</button>' +
      '<span style="padding:6px 12px;font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-secondary);">' +
        'Page ' + _currentPage + ' of ' + totalPages +
      '</span>' +
      '<button id="paginationNext" style="' + btnStyle + (nextDisabled ? disabledStyle : 'background:var(--lex-bg-primary);color:var(--lex-text-primary);') + '"' +
        (nextDisabled ? ' disabled' : '') + '>Next</button>';

    // Wire buttons
    var prevBtn = el('paginationPrev');
    var nextBtn = el('paginationNext');

    if (prevBtn && !prevDisabled) {
      prevBtn.addEventListener('click', function () {
        _currentPage--;
        loadLogs();
      });
    }
    if (nextBtn && !nextDisabled) {
      nextBtn.addEventListener('click', function () {
        _currentPage++;
        loadLogs();
      });
    }
  }

  // =========================================================================
  // Event Info Modal
  // =========================================================================

  function _showEventInfo(category) {
    var modal   = el('eventInfoModal');
    var content = el('eventInfoContent');
    if (!modal || !content) return;

    var descriptions = {
      security: {
        title: 'Security Events',
        description: 'Authentication, authorization, and access control failures',
        events: [
          { name: 'auth.failed', desc: 'Failed authentication attempts' },
          { name: 'auth.admin_denied', desc: 'Admin access denied' },
          { name: 'user.login_failed', desc: 'Failed login attempts' },
          { name: 'permission.denied', desc: 'Permission check failures' },
          { name: 'matter.access_denied', desc: 'Matter access violations' },
          { name: 'security_violation', desc: 'Security policy violations' }
        ]
      },
      user: {
        title: 'User Actions',
        description: 'User-initiated operations and activities',
        events: [
          { name: 'User Management', desc: 'login, logout, created, updated, deleted' },
          { name: 'Matter Operations', desc: 'created, updated, deleted, pinned, unpinned' },
          { name: 'Document Operations', desc: 'upload, access, modification, deletion' },
          { name: 'AI & Search', desc: 'chat_stream, rag_query, search_query, hybrid_search' },
          { name: 'Management Boards', desc: 'board metrics, submissions, board operations' },
          { name: 'RBAC', desc: 'role/group management and assignments' },
          { name: 'API Access', desc: 'token creation/deletion, ActionStep data access' }
        ]
      },
      system: {
        title: 'System Events',
        description: 'Automated background processing and system operations',
        events: [
          { name: 'Document Processing', desc: 'text extraction, AI indexing' },
          { name: 'Data Synchronization', desc: 'connector syncs, bulk imports' },
          { name: 'ML Operations', desc: 'classification, training, feedback' },
          { name: 'System Maintenance', desc: 'metadata updates, privilege filtering' },
          { name: 'Session Management', desc: 'started, heartbeat, ended' },
          { name: 'On-Demand Processing', desc: 'triggered processing tasks' }
        ]
      },
      other: {
        title: 'Other Events',
        description: 'Events that don\'t fit into the standard categories',
        events: _otherEventTypes
      }
    };

    var info = descriptions[category];
    if (!info) return;

    modal.heading = info.title;

    var html = '<p style="font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-secondary);margin-bottom:1rem;">' +
      escHtml(info.description) + '</p>';

    if (category === 'other') {
      if (info.events.length === 0) {
        html += '<p style="color:var(--lex-text-tertiary);font-style:italic;">No uncategorized events found.</p>';
      } else {
        html += '<div style="display:flex;flex-direction:column;gap:0.5rem;">';
        for (var i = 0; i < info.events.length; i++) {
          var evt = info.events[i];
          html +=
            '<div style="display:flex;align-items:center;justify-content:space-between;' +
              'padding:0.75rem;background:var(--lex-bg-secondary);border-radius:var(--lex-radius-md,6px);">' +
              '<span style="font-family:monospace;font-size:var(--lex-body-sm-size,0.875rem);">' +
                escHtml(evt.event_type) +
              '</span>' +
              '<span style="color:var(--lex-text-secondary);font-size:var(--lex-body-sm-size,0.875rem);">' +
                escHtml(String(evt.count)) + ' events' +
              '</span>' +
            '</div>';
        }
        html += '</div>';
      }
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:0.75rem;">';
      var borderColors = {
        security: 'var(--lex-color-danger-500,#EF4444)',
        user:     'var(--lex-color-info-500,#3B82F6)',
        system:   'var(--lex-color-success-500,#22C55E)'
      };
      var borderColor = borderColors[category] || 'var(--lex-border-default)';

      for (var j = 0; j < info.events.length; j++) {
        var ev = info.events[j];
        html +=
          '<div style="border-left:4px solid ' + borderColor + ';padding:0.5rem 0 0.5rem 1rem;">' +
            '<div style="font-weight:500;color:var(--lex-text-primary);">' + escHtml(ev.name) + '</div>' +
            '<div style="font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-secondary);">' + escHtml(ev.desc) + '</div>' +
          '</div>';
      }
      html += '</div>';
    }

    content.innerHTML = html;
    modal.open = true;
  }

  // =========================================================================
  // View Log Details (Drawer)
  // =========================================================================

  function _viewLogDetails(log) {
    var drawer = el('auditDrawer');
    if (!drawer || !log) return;

    var kvEventType = el('auditKvEventType');
    var kvTimestamp = el('auditKvTimestamp');
    var kvUser     = el('auditKvUser');
    var kvIP       = el('auditKvIP');
    var detailsPre = el('auditKvDetails');

    if (kvEventType) kvEventType.value = EventDisplayNames.getEventDisplayName(log.event_type);
    if (kvTimestamp) kvTimestamp.value = log.timestamp ? fmtDateTime(log.timestamp) : '\u2014';
    if (kvUser)      kvUser.value     = String(log.user_email || '\u2014');
    if (kvIP)        kvIP.value       = String(log.ip_address || '\u2014');

    if (detailsPre) {
      try {
        detailsPre.textContent = JSON.stringify(log.details || {}, null, 2);
      } catch (e) {
        detailsPre.textContent = String(log.details || '{}');
      }
    }

    drawer.open = true;
  }

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
