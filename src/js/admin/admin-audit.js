/**
 * Admin Audit Logs — standalone page controller.
 *
 * One server-paged lex-table (docs/TABLE-STANDARD.md) with statistics
 * cards, a Category toolbar filter, header filters on every column, the
 * event info modal and the log detail drawer for admin/audit.html.
 *
 * @requires api.js                - window.api — getAuditEventTypes, getAuditStatistics,
 *                                    queryAuditLogs
 * @requires event-display-names.js - window.EventDisplayNames.getEventDisplayName
 * @requires lex.utils.js          - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-modal.js          - Lex.Modal (event info modal)
 * @requires lex-toast.js          - Lex.Toast.error
 * @requires lex-table.js          - server paging (setServerData)
 * @requires admin-table-kit.js    - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range filter bounds
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

  var TABLE_ID         = 'auditTable';
  var _eventTypes      = [];     // from /audit/event-types
  var _otherEventTypes = [];     // populated by loadStatistics
  var _statsRange      = null;   // created_at range the statistics were loaded for
  var _statsPromise    = null;
  var _searchTerm      = '';
  var _toolbar         = null;
  var _gen             = 0;

  var CATEGORY_CARDS = {
    all:      'statCardAll',
    security: 'statCardSecurity',
    user:     'statCardUser',
    system:   'statCardSystem',
    other:    'statCardOther'
  };

  // =========================================================================
  // Entry point
  // =========================================================================

  function init() {
    _wireStatCards();
    _wireInfoButtons();

    var table = el(TABLE_ID);
    if (!table) return;

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      _statsRange = null;
      table.requestServerQuery();
    });

    window.AdminTableKit.whenTableReady().then(function () {
      if (el(TABLE_ID) !== table) return;
      table.setCellRenderers(cellRenderers());
      table.setColumnFilterOptions(filterOptions(_eventTypes));
      _toolbar = window.AdminTableKit.bindToolbar({
        table: table,
        searchId: 'auditSearch',
        sortId: 'auditSort',
        orderId: 'auditSortOrder',
        filterId: 'auditCategoryFilter',
        filterKey: 'category',
        countIds: ['auditCount', 'auditSectionCount'],
        noun: ['event', 'events'],
        onSearch: function (term) {
          _searchTerm = term;
          table.requestServerQuery({ resetPage: true });
        }
      });
      table.addEventListener('lex-query-change', function (e) {
        if (e.target === table) loadLogs(e.detail);
      });
      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row) _viewLogDetails(row._raw || row);
      });
      table.requestServerQuery({ resetPage: true });
    });

    loadEventTypes();
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
   * The event types of a category (for the query API); null = no category.
   * "Other" uses the uncategorised types the statistics found.
   * @param {string} category
   * @param {string[]} [otherTypes]
   * @returns {string[]|null}
   */
  function getCategoryEventTypes(category, otherTypes) {
    if (category === 'security') return SECURITY_PATTERNS.slice();
    if (category === 'user')     return USER_ACTION_PATTERNS.slice();
    if (category === 'system')   return SYSTEM_EVENT_PATTERNS.slice();
    if (category === 'other')    return (otherTypes || []).slice();
    return null;
  }

  function eventLabel(eventType) {
    var names = typeof EventDisplayNames !== 'undefined' ? EventDisplayNames : window.EventDisplayNames;
    var name = names && typeof names.getEventDisplayName === 'function'
      ? names.getEventDisplayName(eventType)
      : Lex.Utils.humanizeLabel(String(eventType || '').split('.').join(' '));
    return Lex.Utils.capitalizeFirst(name || eventType);
  }

  var CATEGORY_COLORS = { security: 'red', user: 'blue', system: 'green', other: 'gray' };

  // =========================================================================
  // Query mapping
  // =========================================================================

  /**
   * The audit query body for a lex-table server query. Returns null when the
   * filters cannot match anything (a category with no types, or event types
   * outside the chosen category), so the page shows an empty result without
   * a request. search, user_email and sort_* are sent for the API to read
   * once it supports them; today it ignores unknown keys.
   * @param {Object} query - { page, limit, sortDir, filters }
   * @param {string} search
   * @param {string[]} otherTypes
   * @param {Date} [now]
   * @returns {Object|null}
   */
  function toQueryBody(query, search, otherTypes, now) {
    var kit = window.AdminTableKit;
    var q = query || {};
    var filters = q.filters || {};
    var paging = kit.pageOffset(q);
    var body = { limit: paging.limit, offset: paging.offset, sort_by: 'created_at', sort_order: q.sortDir === 'asc' ? 'asc' : 'desc' };

    var category = kit.firstFilterValue(filters, 'category');
    var categoryTypes = getCategoryEventTypes(category, otherTypes);
    var picked = kit.filterValues(filters.event_type);
    var types = categoryTypes;
    if (picked.length) {
      types = categoryTypes ? picked.filter(function (t) { return categoryTypes.indexOf(t) !== -1; }) : picked;
    }
    if (types && !types.length) return null;
    if (types) body.event_types = types;

    var ip = kit.firstFilterValue(filters, 'ip_address');
    if (ip) body.ip_addresses = [ip];
    var email = kit.firstFilterValue(filters, 'user_email');
    if (email) body.user_email = email;
    if (search) body.search = search;
    var range = kit.setRange(null, filters, 'created_at', '', '', now);
    if (range.after) body.start_date = range.after;
    if (range.before) body.end_date = range.before;
    return body;
  }

  function mapLog(log) {
    return {
      id:         String(log.id || ''),
      event_type: String(log.event_type || ''),
      user_email: String(log.user_email || ''),
      ip_address: String(log.ip_address || ''),
      created_at: log.timestamp || log.created_at || '',
      _raw:       log
    };
  }

  function cellRenderers() {
    var kit = window.AdminTableKit;
    return {
      event_type: function (val) {
        if (!val) return kit.muted('');
        return '<span class="admin-table-name" title="' + kit.esc(val) + '">' + kit.esc(eventLabel(val)) + '</span>' +
          '<span class="admin-table-sub">' + kit.esc(Lex.Utils.capitalizeFirst(categoryLabel(classifyEvent(val)))) + '</span>';
      },
      user_email: function (val) {
        return val ? '<span class="admin-table-text" title="' + kit.esc(val) + '">' + kit.esc(val) + '</span>' : kit.muted('');
      },
      ip_address: function (val) {
        return val ? '<span class="admin-table-text">' + kit.esc(val) + '</span>' : kit.muted('');
      },
      created_at: function (val) { return kit.timeCell(val); }
    };
  }

  function categoryLabel(category) {
    return { security: 'Security event', user: 'User action', system: 'System event', other: 'Other event' }[category] || '';
  }

  /**
   * Header filters for every column. Event types come from the server; the
   * known categorised types stand in until it answers.
   * @param {Array} eventTypes
   */
  function filterOptions(eventTypes) {
    var kit = window.AdminTableKit;
    var values = (eventTypes && eventTypes.length)
      ? eventTypes.map(function (et) { return typeof et === 'string' ? et : et.event_type; })
      : SECURITY_PATTERNS.concat(USER_ACTION_PATTERNS, SYSTEM_EVENT_PATTERNS);
    var seen = {};
    var options = values.filter(function (v) {
      if (!v || seen[v]) return false;
      seen[v] = true;
      return true;
    }).map(function (v) { return { value: v, label: eventLabel(v) }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label); });
    return {
      event_type: { options: options },
      user_email: { text: true, placeholder: 'Email contains...' },
      ip_address: { text: true, placeholder: 'IP address is...' },
      created_at: kit.dateRangeFilter()
    };
  }

  // =========================================================================
  // Wire UI
  // =========================================================================

  function _wireStatCards() {
    Object.keys(CATEGORY_CARDS).forEach(function (category) {
      var card = el(CATEGORY_CARDS[category]);
      if (!card || card._auditWired) return;
      card._auditWired = true;
      card.addEventListener('click', function (e) {
        // Don't trigger card click if info button was clicked
        if (e.target.closest('button')) return;
        _selectCategory(category);
      });
    });
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

  // A card click is the Category filter, held in the table's filter state.
  function _selectCategory(category) {
    var table = el(TABLE_ID);
    if (!table || typeof table.addFilter !== 'function') return;
    if (category && category !== 'all') table.addFilter('category', 'in', [category]);
    else table.removeFilter('category');
  }

  function _highlightCard(category) {
    Object.keys(CATEGORY_CARDS).forEach(function (key) {
      var card = el(CATEGORY_CARDS[key]);
      if (!card) return;
      var on = key === (category || 'all');
      card.style.outline = on ? '2px solid var(--lex-bg-accent,#8B7355)' : '';
      card.style.outlineOffset = on ? '-2px' : '';
    });
  }

  // =========================================================================
  // Load Event Types (column filter values)
  // =========================================================================

  function loadEventTypes() {
    api.getAuditEventTypes()
      .then(function (result) {
        _eventTypes = (result && result.event_types) || [];
        var table = el(TABLE_ID);
        if (table && typeof table.setColumnFilterOptions === 'function') {
          table.setColumnFilterOptions(filterOptions(_eventTypes));
        }
      })
      .catch(function (err) {
        console.error('[admin-audit] loadEventTypes error:', err);
      });
  }

  function formatStatNumber(value) {
    var number = Number(value) || 0;
    var abs = Math.abs(number);

    if (abs >= 1000000000) {
      return (number / 1000000000).toFixed(abs >= 10000000000 ? 0 : 1).replace(/\.0$/, '') + 'B';
    }
    if (abs >= 1000000) {
      return (number / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    }
    if (abs >= 100000) {
      return Math.round(number / 1000) + 'k';
    }

    return new Intl.NumberFormat('en-US').format(number);
  }

  function setStatNumber(id, value) {
    var node = el(id);
    if (!node) return;
    node.textContent = formatStatNumber(value);
    node.title = new Intl.NumberFormat('en-US').format(Number(value) || 0);
  }

  // =========================================================================
  // Load Statistics (for the Created range the table shows)
  // =========================================================================

  function loadStatistics(range) {
    var key = (range.after || '') + '|' + (range.before || '');
    if (_statsRange === key && _statsPromise) return _statsPromise;
    _statsRange = key;

    _statsPromise = api.getAuditStatistics(range.after, range.before)
      .then(function (result) {
        setStatNumber('statTotal', result.total_events || 0);

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

        setStatNumber('statSecurity', securityEvents);
        setStatNumber('statUser', userEvents);
        setStatNumber('statSystem', systemEvents);
        setStatNumber('statOther', otherEvents);
      })
      .catch(function (err) {
        console.error('[admin-audit] loadStatistics error:', err);
      });
    return _statsPromise;
  }

  // =========================================================================
  // Load Logs (answers the table's lex-query-change)
  // =========================================================================

  function loadLogs(query) {
    var gen = ++_gen;
    var table = el(TABLE_ID);
    if (!table) return;
    query = query || table.serverQuery;
    var filters = query.filters || {};
    var kit = window.AdminTableKit;
    var filtered = Boolean(_searchTerm || Object.keys(filters).length);
    var category = kit.firstFilterValue(filters, 'category');
    if (_toolbar) _toolbar.syncFilter(filters);
    _highlightCard(category);

    // "Other" needs the uncategorised types, which come with the statistics.
    var range = kit.setRange(null, filters, 'created_at', '', '');
    loadStatistics(range)
      .then(function () {
        if (gen !== _gen) return null;
        var otherTypes = _otherEventTypes.map(function (e) { return e.event_type; });
        var body = toQueryBody(query, _searchTerm, otherTypes);
        if (!body) return { logs: [], pagination: { total: 0 } };
        return api.queryAuditLogs(body);
      })
      .then(function (result) {
        if (gen !== _gen || !result) return;
        var logs = result.logs || [];
        var pagination = result.pagination || {};
        var total = Number(pagination.total !== undefined ? pagination.total : result.total);
        table.emptyText = kit.emptyText(filtered, 'audit events');
        table.setServerData(logs.map(mapLog), {
          page: query.page,
          limit: query.limit,
          total: Number.isFinite(total) ? total : logs.length
        });
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        console.error('[admin-audit] loadLogs error:', err);
        if (_toolbar) _toolbar.setCount(null);
        table.setServerError('Audit logs could not be loaded. Check your connection and try again.');
      });
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

    if (kvEventType) kvEventType.value = eventLabel(log.event_type);
    if (kvTimestamp) kvTimestamp.value = (log.timestamp || log.created_at) ? fmtDateTime(log.timestamp || log.created_at) : '\u2014';
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

  // Pure table logic, exposed for unit tests.
  window.AdminAuditTable = {
    toQueryBody: toQueryBody,
    mapLog: mapLog,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    getCategoryEventTypes: getCategoryEventTypes,
    classifyEvent: classifyEvent
  };

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
