/* Approvals — HITL Approval Inbox & Detail controller.
   Handles both approvals.html (inbox) and approval-detail.html (detail view).

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - All time/date formatting via Lex.Utils.timeAgo() / Lex.Utils.formatDate()
     - IIFE wrapper to keep scope clean

   @requires api.js          — window.api (api.get / api.post)
   @requires lex.utils.js    — Lex.Utils.escapeHtml, Lex.Utils.timeAgo, Lex.Utils.formatDateTime
   @requires lex-toast.js    — Lex.Toast.success / .error / .warning
   @requires lex-table.js    — server-paged inbox table
   @requires admin-table-kit.js — AdminTableKit toolbar + query helpers
   @requires library-column-filters.js — date ranges + workspace list
*/

(function () {
  'use strict';

  // ===========================================================================
  // Lex aliases
  // ===========================================================================

  var escHtml     = Lex.Utils.escapeHtml;
  var timeAgo     = Lex.Utils.timeAgo;
  var fmtDateTime = Lex.Utils.formatDateTime;

  // ===========================================================================
  // Shared helpers
  // ===========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  // ===========================================================================
  // Badge renderers
  // ===========================================================================

  /**
   * Render a priority badge HTML string.
   * @param {string} priority — low | normal | high | urgent
   * @returns {string}
   */
  function priorityBadge(priority) {
    var p = String(priority || 'normal').toLowerCase();
    var cls = 'apr-priority apr-priority-' + p;
    var labels = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
    var label = labels[p] || p;
    return '<span class="' + escHtml(cls) + '">' + escHtml(label) + '</span>';
  }

  /**
   * Render a status badge HTML string.
   * @param {string} status — pending | approved | rejected | expired | cancelled
   * @returns {string}
   */
  function statusBadge(status) {
    var s = String(status || 'pending').toLowerCase();
    var cls = 'apr-status apr-status-' + s;
    var labels = {
      pending:   'Pending',
      approved:  'Approved',
      rejected:  'Rejected',
      expired:   'Expired',
      cancelled: 'Cancelled'
    };
    var label = labels[s] || s;
    return '<span class="' + escHtml(cls) + '">' + escHtml(label) + '</span>';
  }

  /**
   * Render a source type badge HTML string.
   * @param {string} sourceType — workflow | chat | skill | manual
   * @returns {string}
   */
  /**
   * The display name for every approval source type, in one place.
   *
   * This used to be two copies: one inside sourceBadge() for the inbox list
   * and one inside _formatSourceType() for the detail header. Adding a source
   * type to one of them fixed half the screen and looked finished. That is how
   * `privilege_review` nearly shipped rendering as a raw string to a reviewer
   * deciding whether privileged material may be disclosed.
   *
   * An unknown type still falls back to something readable rather than
   * failing, so a new source type is never invisible, just unlabelled.
   */
  var SOURCE_TYPE_LABELS = {
    workflow:         'Workflow',
    chat:             'Chat',
    skill:            'Skill',
    manual:           'Manual',
    privilege_review: 'Privilege review',
    // Source types GET /api/v1/approvals stores and filters on.
    agentic_task:                'Agentic task',
    agentic_snapshot:            'Agentic snapshot',
    workflow_execution:          'Workflow execution',
    automation_execution:        'Automation execution',
    document_edit_batch_release: 'Document release',
    standalone:                  'Standalone'
  };

  function sourceTypeLabel(sourceType) {
    return SOURCE_TYPE_LABELS[String(sourceType || '').toLowerCase()] || null;
  }

  function sourceBadge(sourceType) {
    var s = String(sourceType || '').toLowerCase();
    var label = sourceTypeLabel(s) || escHtml(s);
    return '<span class="apr-source">' + escHtml(label) + '</span>';
  }

  /**
   * Format a countdown from now until expiresAt.
   * Returns an object with { text, urgencyClass }.
   * @param {string|null} expiresAt
   * @param {string} status
   * @returns {{ text: string, urgencyClass: string }}
   */
  function formatTimeRemaining(expiresAt, status) {
    if (!expiresAt || status !== 'pending') {
      return { text: '', urgencyClass: '' };
    }

    var now   = LanaTime.nowMs();
    var expMs = new Date(expiresAt).getTime();
    var diffMs = expMs - now;

    if (isNaN(expMs)) {
      return { text: '', urgencyClass: '' };
    }

    if (diffMs <= 0) {
      return { text: 'Expired', urgencyClass: 'expired' };
    }

    var totalMinutes = Math.floor(diffMs / 60000);
    var hours        = Math.floor(totalMinutes / 60);
    var minutes      = totalMinutes % 60;
    var days         = Math.floor(hours / 24);

    var text = '';
    if (days > 0) {
      text = days + 'd ' + (hours % 24) + 'h remaining';
    } else if (hours > 0) {
      text = hours + 'h ' + minutes + 'm remaining';
    } else {
      text = minutes + 'm remaining';
    }

    var urgencyClass = 'ok';
    if (totalMinutes < 60) {
      urgencyClass = 'urgent';
    } else if (totalMinutes < 240) {
      urgencyClass = 'warning';
    }

    return { text: text, urgencyClass: urgencyClass };
  }

  /**
   * Format a date for display (e.g. "Apr 2, 2026 at 3:45 PM").
   * Falls back to timeAgo if the date is recent.
   * @param {string} dateStr
   * @returns {string}
   */
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      // Use timeAgo for dates within the last 7 days
      var daysDiff = Lex.Utils.millisecondsSince(d.getTime()) / Lex.Utils.MS_PER_DAY;
      if (daysDiff < 7) {
        return timeAgo(dateStr);
      }
      return fmtDateTime(dateStr);
    } catch (e) {
      return dateStr;
    }
  }

  // ===========================================================================
  // API functions
  // ===========================================================================

  /**
   * Load approvals assigned to the current user (inbox view).
   * @returns {Promise}
   */
  function loadInbox() {
    return api.get('/api/v1/approvals/inbox');
  }

  /**
   * Load pending inbox count for the current user.
   * @returns {Promise}
   */
  function loadInboxCount() {
    return api.get('/api/v1/approvals/inbox/count');
  }

  /**
   * Load a single approval by ID.
   * @param {string} id
   * @returns {Promise}
   */
  function loadApproval(id) {
    return api.get('/api/v1/approvals/' + encodeURIComponent(id));
  }

  /**
   * Load status history for an approval.
   * @param {string} id
   * @returns {Promise}
   */
  function loadHistory(id) {
    return api.get('/api/v1/approvals/' + encodeURIComponent(id) + '/history');
  }

  /**
   * Approve an approval request.
   * @param {string} id
   * @param {string} comments
   * @returns {Promise}
   */
  function approveRequest(id, comments) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/approve', { comments: comments });
  }

  /**
   * Reject an approval request.
   * @param {string} id
   * @param {string} comments
   * @returns {Promise}
   */
  function rejectRequest(id, comments) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/reject', { comments: comments });
  }

  /**
   * Cancel an approval request.
   * @param {string} id
   * @returns {Promise}
   */
  function cancelRequest(id) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/cancel', {});
  }

  /**
   * Reassign an approval request to another user.
   * @param {string} id
   * @param {{ assigned_to: string, comments: string }} data
   * @returns {Promise}
   */
  function reassignRequest(id, data) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/reassign', data);
  }

  /**
   * Load aggregate stats for the approvals page.
   * @returns {Promise}
   */
  function loadStats() {
    return api.get('/api/v1/approvals/stats');
  }

  // ===========================================================================
  // INBOX PAGE logic — server-paged lex-table (docs/TABLE-STANDARD.md)
  // ===========================================================================

  var INBOX_TABLE_ID = 'aprTable';

  // Values GET /api/v1/approvals accepts (approvals.validators.js).
  var APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'cancelled'];
  var APPROVAL_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
  var APPROVAL_SOURCE_TYPES = [
    'agentic_task', 'agentic_snapshot', 'workflow_execution',
    'automation_execution', 'document_edit_batch_release', 'standalone'
  ];

  var STATUS_COLORS   = { pending: 'yellow', approved: 'green', rejected: 'red', expired: 'gray', cancelled: 'gray' };
  var PRIORITY_COLORS = { urgent: 'red', high: 'yellow', normal: 'blue', low: 'gray' };

  // Table column -> /api/v1/approvals sort_by (its allow-list).
  var SORT_BY_COLUMN = { created_at: 'created_at', priority: 'priority', expires_at: 'expires_at' };

  // Expires column ranges: bounds on expires_at relative to now.
  var EXPIRES_RANGE_OPTIONS = [
    { value: 'past', label: 'Already expired' },
    { value: '1h', label: 'Within 1 hour' },
    { value: '24h', label: 'Within 24 hours' },
    { value: 'later', label: 'Later than 24 hours' }
  ];

  var HOUR_MS = 60 * 60 * 1000;

  var _inbox = {
    searchTerm: '',
    toolbar:    null,
    gen:        0,
    workspaces: {},   // matter uuid -> workspace name (link labels)
    users:      []
  };

  function _kit() {
    return window.AdminTableKit;
  }

  /**
   * expires_after / expires_before for an Expires range option.
   * @param {string} value
   * @param {Date} [now]
   * @returns {{ after: string, before: string }}
   */
  function expiresRangeBounds(value, now) {
    var t = (now && typeof now.getTime === 'function' ? now : new Date(LanaTime.nowMs())).getTime();
    var iso = function (ms) { return new Date(ms).toISOString(); };
    switch (value) {
      case 'past':  return { after: '', before: iso(t) };
      case '1h':    return { after: iso(t), before: iso(t + HOUR_MS) };
      case '24h':   return { after: iso(t), before: iso(t + 24 * HOUR_MS) };
      case 'later': return { after: iso(t + 24 * HOUR_MS), before: '' };
      default:      return { after: '', before: '' };
    }
  }

  /**
   * The /api/v1/approvals query for a lex-table server query.
   * The API pages with limit/offset and takes one status, priority and
   * source type each (the header filters for those are single-choice).
   * Filters it does not read yet (title contains, Created and Expires ranges,
   * requester) go under the standard names so they apply once it does.
   * @param {Object} query  - { page, limit, sortBy, sortDir, filters }
   * @param {string} search - toolbar search
   * @param {Date} [now]
   * @returns {URLSearchParams}
   */
  function inboxApiParams(query, search, now) {
    var kit = _kit();
    var q = query || {};
    var filters = q.filters || {};
    var params = new URLSearchParams();
    var paging = kit.pageOffset(q);
    params.set('limit', String(Math.min(paging.limit, 100)));
    params.set('offset', String(paging.offset));
    params.set('sort_by', SORT_BY_COLUMN[q.sortBy] || 'created_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    if (search) params.set('search', search);

    var title = kit.firstFilterValue(filters, 'title');
    if (title) params.set('title', title);
    var single = { status: 'status', priority: 'priority', source_type: 'source_type',
      matter_id: 'matter_id', assigned_to: 'assigned_to', requested_by: 'requested_by' };
    Object.keys(single).forEach(function (col) {
      var value = kit.firstFilterValue(filters, col);
      if (value) params.set(single[col], value);
    });

    var expires = expiresRangeBounds(kit.firstFilterValue(filters, 'expires_at'), now);
    if (expires.after) params.set('expires_after', expires.after);
    if (expires.before) params.set('expires_before', expires.before);
    kit.setRange(params, filters, 'created_at', 'created_after', 'created_before', now);
    return params;
  }

  function _personName(first, last, email) {
    var name = (String(first || '').trim() + ' ' + String(last || '').trim()).trim();
    return name || String(email || '');
  }

  /**
   * One row per approval: raw values, the record as _raw.
   * @param {Object} a
   * @returns {Object}
   */
  function mapApproval(a) {
    var item = a || {};
    return {
      id:           String(item.id || ''),
      title:        String(item.title || ''),
      source_type:  String(item.source_type || item.sourceType || '').toLowerCase(),
      priority:     String(item.priority || 'normal').toLowerCase(),
      status:       String(item.status || 'pending').toLowerCase(),
      requested_by: String(item.requested_by || ''),
      assigned_to:  String(item.assigned_to || ''),
      matter_id:    String(item.matter_id || ''),
      expires_at:   item.expires_at || item.expiresAt || '',
      created_at:   item.created_at || item.createdAt || '',
      _raw:         item
    };
  }

  function _requesterName(raw) {
    return String(raw.requester_name || raw.requesterName ||
      _personName(raw.requested_by_first_name, raw.requested_by_last_name, raw.requested_by_email) || '');
  }

  function _assigneeName(raw) {
    return String(raw.assigned_to_name || raw.assignedToName ||
      _personName(raw.assigned_to_first_name, raw.assigned_to_last_name, raw.assigned_to_email) || '');
  }

  function _text(value, title) {
    var kit = _kit();
    if (!value) return kit.muted('');
    return '<span class="apr-cell-text" title="' + kit.esc(title || value) + '">' + kit.esc(value) + '</span>';
  }

  function inboxCellRenderers(workspaces) {
    var kit = _kit();
    var names = workspaces || _inbox.workspaces;
    return {
      title: function (val) {
        var name = val || 'Untitled approval';
        return '<span class="apr-cell-name" title="' + kit.esc(name) + '">' + kit.esc(name) + '</span>';
      },
      source_type: function (val) {
        return val ? _text(sourceTypeLabel(val) || Lex.Utils.humanizeLabel(val)) : kit.muted('');
      },
      priority: function (val) {
        return kit.badge(Lex.Utils.humanizeLabel(val), PRIORITY_COLORS[val] || 'gray');
      },
      status: function (val) {
        return kit.badge(Lex.Utils.humanizeLabel(val), STATUS_COLORS[val] || 'gray');
      },
      requested_by: function (val, row) { return _text(_requesterName(row._raw)); },
      assigned_to: function (val, row) {
        var name = _assigneeName(row._raw);
        return name ? _text(name) : kit.muted('Unassigned');
      },
      matter_id: function (val) {
        if (!val) return kit.muted('');
        return '<button type="button" class="apr-workspace-link" data-matter-id="' + kit.esc(val) + '">' +
          '<span>' + kit.esc(names[val] || 'Open workspace') + '</span></button>';
      },
      expires_at: function (val, row) {
        if (!val) return kit.muted('');
        var timer = formatTimeRemaining(val, row.status);
        var full = fmtDateTime(val);
        if (timer.text) {
          return '<time class="apr-cell-time apr-item-timer ' + kit.esc(timer.urgencyClass) + '" datetime="' + kit.esc(val) + '" title="' + kit.esc(full) + '">' + kit.esc(timer.text) + '</time>';
        }
        return '<time class="apr-cell-time" datetime="' + kit.esc(val) + '" title="' + kit.esc(full) + '">' + kit.esc(full) + '</time>';
      },
      created_at: function (val) {
        if (!val) return kit.muted('');
        var text = fmtDateTime(val);
        return '<time class="apr-cell-time" datetime="' + kit.esc(val) + '" title="' + kit.esc(text) + '">' + kit.esc(text) + '</time>';
      }
    };
  }

  function _sourceOptions() {
    return APPROVAL_SOURCE_TYPES.map(function (value) {
      return { value: value, label: sourceTypeLabel(value) || Lex.Utils.humanizeLabel(value) };
    });
  }

  /**
   * Header filters for every column. Status, priority and source take one
   * value each because the API filters on one.
   * @param {Array} workspaceOptions - [{ value: matter uuid, label }]
   * @param {Array} userOptions      - [{ value: user id, label }]
   */
  function inboxFilterOptions(workspaceOptions, userOptions) {
    var kit = _kit();
    var map = {
      title:       { text: true, placeholder: 'Title contains...' },
      source_type: { single: true, options: _sourceOptions() },
      priority:    { single: true, options: kit.labelOptions(APPROVAL_PRIORITIES) },
      status:      { single: true, options: kit.labelOptions(APPROVAL_STATUSES) },
      expires_at:  { single: true, options: EXPIRES_RANGE_OPTIONS },
      created_at:  kit.dateRangeFilter()
    };
    if (userOptions && userOptions.length) {
      map.requested_by = { single: true, options: userOptions };
      map.assigned_to = { single: true, options: userOptions };
    }
    if (workspaceOptions && workspaceOptions.length) map.matter_id = { single: true, options: workspaceOptions };
    return map;
  }

  function _inboxTable() {
    return el(INBOX_TABLE_ID);
  }

  function initInboxPage() {
    var table = _inboxTable();
    if (!table) return;
    _fetchStats();
    _bindStats();

    _kit().whenTableReady().then(function () {
      if (_inboxTable() !== table) return;
      table.setCellRenderers(inboxCellRenderers());
      table.setColumnFilterOptions(inboxFilterOptions([], []));
      _inbox.toolbar = _kit().bindToolbar({
        table: table,
        searchId: 'aprSearch',
        sortId: 'aprSort',
        orderId: 'aprSortOrder',
        filterId: 'aprStatusFilter',
        filterKey: 'status',
        countIds: ['aprCount', 'aprSectionCount'],
        noun: ['approval', 'approvals'],
        onSearch: function (term) {
          _inbox.searchTerm = term;
          table.requestServerQuery({ resetPage: true });
        }
      });
      table.addEventListener('lex-query-change', function (e) {
        if (e.target !== table) return;
        _fetchApprovals(e.detail);
      });
      table.addEventListener('lex-filter-change', function (e) {
        if (e.target !== table) return;
        _syncStatHighlight(_kit().firstFilterValue(e.detail && e.detail.filters, 'status'));
      });
      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) _openApproval(row.id);
      });
      _loadFilterSources(table);

      // Pending first, as before: the filter lives in the table's own state,
      // so Clear filters resets it. Setting it emits the first query.
      void table.serverQuery;
      table.addFilter('status', 'in', ['pending']);
    });
  }

  function _openApproval(id) {
    if (!id) return;
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go('approval-detail.html', { params: { id: id } });
      return;
    }
    window.location.href = 'approval-detail.html?id=' + encodeURIComponent(id);
  }

  function _userOptions(res) {
    var users = Array.isArray(res) ? res : ((res && (res.data || res.users)) || []);
    return users.map(function (u) {
      var label = u.full_name || u.fullName || _personName(u.first_name, u.last_name, u.email) || u.id;
      return { value: String(u.id || ''), label: String(label) };
    }).filter(function (o) { return o.value; });
  }

  // Workspace names (link labels + filter) and users (requester/assignee filters).
  function _loadFilterSources(table) {
    var shared = window.LanaLibraryColumnFilters;
    var workspaces = shared ? shared.loadWorkspaces(api) : Promise.resolve([]);
    var users = api.get('/api/v1/users?limit=100').then(_userOptions).catch(function () { return []; });
    Promise.all([workspaces, users]).then(function (results) {
      if (_inboxTable() !== table) return;
      var options = shared ? shared.workspaceOptions(results[0], 'id') : [];
      var names = {};
      options.forEach(function (o) { names[o.value] = o.label; });
      _inbox.workspaces = names;
      _inbox.users = results[1];
      table.setCellRenderers(inboxCellRenderers(names));
      table.setColumnFilterOptions(inboxFilterOptions(options, results[1]));
    });
  }

  function _bindStats() {
    // Stat tiles set the Status filter (same state as the toolbar select).
    var statsBar = el('aprStats');
    if (!statsBar) return;
    statsBar.addEventListener('click', function (e) {
      var stat = e.target.closest('.apr-stat');
      var table = _inboxTable();
      if (!stat || !table) return;
      var status = stat.dataset.status || '';
      if (status) table.addFilter('status', 'in', [status]);
      else table.removeFilter('status');
    });
  }

  function _syncStatHighlight(status) {
    var stats = document.querySelectorAll('.apr-stat');
    for (var i = 0; i < stats.length; i++) {
      var stat = stats[i];
      if ((stat.dataset.status || '') === (status || '')) stat.classList.add('active');
      else stat.classList.remove('active');
    }
  }

  function _fetchStats() {
    loadStats().then(function (res) {
      // GET /approvals/stats answers { stats: { pending_count, ..., total_count } }.
      var data = (res && (res.stats || res.data)) || res || {};
      var byStatus = data.by_status || data.byStatus || {};
      var count = function (key) {
        return Number(data[key + '_count'] !== undefined ? data[key + '_count'] : byStatus[key]) || 0;
      };
      _setStatCount('aprCountAll',      Number(data.total_count !== undefined ? data.total_count : data.total) || 0);
      _setStatCount('aprCountPending',  count('pending'));
      _setStatCount('aprCountApproved', count('approved'));
      _setStatCount('aprCountRejected', count('rejected'));
      _setStatCount('aprCountExpired',  count('expired'));
    }).catch(function () {
      // Stats are non-critical — fail silently
    });
  }

  function _setStatCount(id, count) {
    var elem = el(id);
    if (elem) elem.textContent = String(count);
  }

  /**
   * Answer the table's lex-query-change with one page of approvals.
   * @param {Object} query
   */
  function _fetchApprovals(query) {
    var gen = ++_inbox.gen;
    var table = _inboxTable();
    if (!table) return;
    query = query || table.serverQuery;
    var filters = query.filters || {};
    var filtered = Boolean(_inbox.searchTerm || Object.keys(filters).length);
    if (_inbox.toolbar) _inbox.toolbar.syncFilter(filters);

    api.get('/api/v1/approvals?' + inboxApiParams(query, _inbox.searchTerm).toString())
      .then(function (res) {
        if (gen !== _inbox.gen) return;
        var items = (res && (res.approvals || res.data)) || [];
        var pagination = (res && res.pagination) || {};
        table.emptyText = _kit().emptyText(filtered, 'approvals');
        table.setServerData(items.map(mapApproval), {
          page: query.page,
          limit: query.limit,
          total: pagination.total !== undefined ? pagination.total : items.length
        });
      })
      .catch(function (err) {
        if (gen !== _inbox.gen) return;
        console.error('[approvals] list error:', err);
        if (_inbox.toolbar) _inbox.toolbar.setCount(null);
        table.setServerError((err && err.message) || 'Approvals could not be loaded. Check your connection and try again.');
      });
  }

  // Pure table logic, exposed for unit tests.
  window.ApprovalsTable = {
    inboxApiParams: inboxApiParams,
    expiresRangeBounds: expiresRangeBounds,
    mapApproval: mapApproval,
    cellRenderers: inboxCellRenderers,
    filterOptions: inboxFilterOptions,
    SORT_BY_COLUMN: SORT_BY_COLUMN
  };

  // ===========================================================================
  // DETAIL PAGE logic
  // ===========================================================================

  var _detail = {
    approvalId:  '',
    approval:    null,
    actioning:   false,
    timerHandle: null
  };

  function initDetailPage() {
    _detail.approvalId = getQueryParam('id');

    if (!_detail.approvalId) {
      hide('apdLoading');
      show('apdError');
      return;
    }

    _fetchApproval();
  }

  function _fetchApproval() {
    show('apdLoading');
    hide('apdContent');
    hide('apdError');

    loadApproval(_detail.approvalId).then(function (res) {
      var approval = (res && res.approval)
        || (res && res.data && res.data.approval)
        || (res && res.data)
        || res;
      if (!approval || !approval.id) {
        hide('apdLoading');
        show('apdError');
        return;
      }

      _detail.approval = approval;
      _renderDetailHeader(approval);
      _renderInfoGrid(approval);
      _renderPayload(approval);
      _showActionPanel(approval);

      hide('apdLoading');
      show('apdContent');

      // Load history asynchronously
      _fetchHistory(_detail.approvalId);

      // If pending, start a live countdown
      if (approval.status === 'pending' && (approval.expires_at || approval.expiresAt)) {
        _startDetailTimer(approval.expires_at || approval.expiresAt);
      }
    }).catch(function () {
      hide('apdLoading');
      show('apdError');
    });
  }

  function _renderDetailHeader(approval) {
    var titleEl   = el('apdTitle');
    var descEl    = el('apdDesc');
    var statusEl  = el('apdStatusBadge');
    var priorityEl = el('apdPriorityBadge');
    var sourceEl  = el('apdSourceBadge');
    var timerEl   = el('apdTimer');

    if (titleEl)   titleEl.textContent = approval.title || 'Untitled Approval';
    if (descEl && approval.description) {
      descEl.textContent = approval.description;
      descEl.style.display = '';
    }

    if (statusEl)  statusEl.innerHTML  = statusBadge(approval.status);
    if (priorityEl) priorityEl.innerHTML = priorityBadge(approval.priority);
    if (sourceEl)  sourceEl.innerHTML  = sourceBadge(approval.source_type || approval.sourceType);

    if (timerEl) {
      var timer = formatTimeRemaining(approval.expires_at || approval.expiresAt, approval.status);
      timerEl.textContent = timer.text;
      timerEl.className   = timer.urgencyClass ? 'apr-item-timer ' + timer.urgencyClass : '';
    }
  }

  function _startDetailTimer(expiresAt) {
    if (_detail.timerHandle) clearInterval(_detail.timerHandle);

    _detail.timerHandle = setInterval(function () {
      var timerEl = el('apdTimer');
      if (!timerEl) {
        clearInterval(_detail.timerHandle);
        return;
      }
      var timer = formatTimeRemaining(expiresAt, 'pending');
      timerEl.textContent = timer.text;
      timerEl.className   = timer.urgencyClass ? 'apr-item-timer ' + timer.urgencyClass : '';

      if (timer.urgencyClass === 'expired') {
        clearInterval(_detail.timerHandle);
      }
    }, 60000);
  }

  function _renderInfoGrid(approval) {
    var grid = el('apdInfoGrid');
    if (!grid) return;

    var fields = [
      { label: 'Requester',    value: approval.requester_name  || approval.requesterName  || '—' },
      { label: 'Assigned To',  value: approval.assigned_to_name || approval.assignedToName || 'Unassigned' },
      { label: 'Source',       value: _formatSourceType(approval.source_type || approval.sourceType) },
      { label: 'Priority',     value: _capitalize(approval.priority || 'normal') },
      { label: 'Status',       value: _capitalize(approval.status || 'pending') },
      { label: 'Created',      value: formatDate(approval.created_at || approval.createdAt) },
      { label: 'Expires',      value: formatDate(approval.expires_at || approval.expiresAt) },
      { label: 'Source ID',    value: approval.source_id || approval.sourceId || '—' }
    ];

    var html = '';
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      html += [
        '<div class="apd-info-item">',
          '<div class="apd-info-label">' + escHtml(f.label) + '</div>',
          '<div class="apd-info-value">' + escHtml(String(f.value)) + '</div>',
        '</div>'
      ].join('');
    }

    grid.innerHTML = html;
  }

  function _capitalize(str) {
    if (!str) return '';
    return String(str).charAt(0).toUpperCase() + String(str).slice(1);
  }

  function _formatSourceType(sourceType) {
    if (!sourceType) return '—';
    return sourceTypeLabel(sourceType) || _capitalize(sourceType);
  }

  function _formatByteCount(bytes) {
    var count = Math.max(0, Number(bytes) || 0);
    if (count < 1024) return count + ' bytes';
    if (count < 1024 * 1024) return (count / 1024).toFixed(1) + ' KB';
    return (count / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function _releaseSourceSummary(request) {
    if (request.contentBase64 !== undefined) {
      var padding = String(request.contentBase64 || '').slice(-2).split('=').length - 1;
      var byteCount = Math.max(0, Math.floor(String(request.contentBase64 || '').length * 3 / 4) - padding);
      return 'Stored document bytes (' + _formatByteCount(byteCount) + ')';
    }
    if (request.contentText !== undefined) {
      return 'Stored document text (' + String(request.contentText || '').length + ' characters)';
    }
    if (request.documentId) return 'Matter document ' + request.documentId;
    if (request.artifactId) return 'Generated artifact ' + request.artifactId;
    return 'Stored release source';
  }

  function _renderDocumentReleasePayload(payload) {
    var request = payload.release_request && typeof payload.release_request === 'object'
      ? payload.release_request
      : {};
    var target = payload.approval_target && typeof payload.approval_target === 'object'
      ? payload.approval_target
      : {};
    var rows = [
      { key: 'File', value: request.filename || 'Document release' },
      { key: 'Content type', value: request.contentType || '—' },
      { key: 'Release notes', value: request.releaseNotes || '—' },
      { key: 'Release content', value: _releaseSourceSummary(request) },
      { key: 'Matter', value: payload.matterId || '—' },
      { key: 'Source document', value: payload.sourceDocumentId || '—' },
      { key: 'Edit batch', value: payload.batchId || '—' },
      { key: 'Approval target', value: target.display_name || target.email || 'Unassigned' }
    ];
    var html = '<div class="apd-payload-kv">';
    for (var i = 0; i < rows.length; i++) {
      html += [
        '<div class="apd-kv-row">',
          '<div class="apd-kv-key">' + escHtml(rows[i].key) + '</div>',
          '<div class="apd-kv-val">' + escHtml(String(rows[i].value)) + '</div>',
        '</div>'
      ].join('');
    }
    return html + '</div>';
  }

  function _renderPayload(approval) {
    var container = el('apdPayloadContent');
    var card      = el('apdPayloadCard');
    if (!container) return;

    var payload = approval.payload;

    // Hide payload card if there's nothing to show
    if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) {
      if (card) hide(card);
      return;
    }

    if ((approval.source_type || approval.sourceType) === 'document_edit_batch_release' &&
        typeof payload === 'object' && !Array.isArray(payload)) {
      container.innerHTML = _renderDocumentReleasePayload(payload);
      return;
    }

    // Try to render as key-value pairs if it's a flat object
    if (typeof payload === 'object' && !Array.isArray(payload)) {
      var keys = Object.keys(payload);
      var isFlat = true;
      for (var i = 0; i < keys.length; i++) {
        var v = payload[keys[i]];
        if (typeof v === 'object' && v !== null) {
          isFlat = false;
          break;
        }
      }

      if (isFlat) {
        var html = '<div class="apd-payload-kv">';
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var val = payload[key] === null || payload[key] === undefined ? '—' : String(payload[key]);
          html += [
            '<div class="apd-kv-row">',
              '<div class="apd-kv-key">' + escHtml(key) + '</div>',
              '<div class="apd-kv-val">' + escHtml(val) + '</div>',
            '</div>'
          ].join('');
        }
        html += '</div>';
        container.innerHTML = html;
        return;
      }
    }

    // Fall back to pretty-printed JSON
    var jsonStr = '';
    try {
      jsonStr = JSON.stringify(payload, null, 2);
    } catch (e) {
      jsonStr = String(payload);
    }
    container.innerHTML = '<pre class="apd-payload">' + escHtml(jsonStr) + '</pre>';
  }

  function _fetchHistory(id) {
    var timeline = el('apdTimeline');
    if (!timeline) return;

    loadHistory(id).then(function (res) {
      var entries = (res && res.data) || [];
      _renderTimeline(entries);
    }).catch(function () {
      if (timeline) {
        timeline.innerHTML = '<div style="padding:16px;color:var(--lex-text-tertiary);font-size:0.8125rem;">Unable to load history.</div>';
      }
    });
  }

  function _renderTimeline(entries) {
    var timeline = el('apdTimeline');
    if (!timeline) return;

    if (!entries || entries.length === 0) {
      timeline.innerHTML = '<div style="padding:16px;color:var(--lex-text-tertiary);font-size:0.8125rem;">No history entries.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var entry  = entries[i];
      var action = String(entry.action || entry.status || 'created').toLowerCase();
      var actor  = escHtml(String(entry.actor_name  || entry.actorName  || entry.actor || 'System'));
      var ts     = escHtml(formatDate(entry.created_at || entry.createdAt || entry.timestamp));
      var comment = entry.comments || entry.comment || '';

      var dotClass = 'apd-timeline-dot ' + action;

      html += [
        '<div class="apd-timeline-item">',
          '<div class="' + escHtml(dotClass) + '"></div>',
          '<div class="apd-timeline-line"></div>',
          '<div class="apd-timeline-body">',
            '<div class="apd-timeline-action">' + escHtml(_capitalize(action)) + '</div>',
            '<div class="apd-timeline-actor">' + actor + ' &middot; ' + ts + '</div>',
            comment ? '<div class="apd-timeline-comment">' + escHtml(String(comment)) + '</div>' : '',
          '</div>',
        '</div>'
      ].join('');
    }

    timeline.innerHTML = html;
  }

  function _showActionPanel(approval) {
    var actionCard = el('apdActionCard');
    if (!actionCard) return;

    // Only show action panel for pending approvals
    if (approval.status !== 'pending') {
      hide(actionCard);
      return;
    }

    show(actionCard);
    _bindActionButtons(approval);
  }

  function _bindActionButtons(approval) {
    var approveBtn   = el('apdApproveBtn');
    var rejectBtn    = el('apdRejectBtn');
    var reassignBtn  = el('apdReassignBtn');
    var cancelBtn    = el('apdCancelBtn');
    var commentInput = el('apdComment');

    if (approveBtn) {
      approveBtn.addEventListener('click', function () {
        if (_detail.actioning) return;
        var comments = commentInput ? commentInput.value.trim() : '';
        _performAction('approve', comments);
      });
    }

    if (rejectBtn) {
      rejectBtn.addEventListener('click', function () {
        if (_detail.actioning) return;
        var comments = commentInput ? commentInput.value.trim() : '';
        _performAction('reject', comments);
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        if (_detail.actioning) return;
        Lex.Modal.confirm(
          'Cancel Approval Request',
          'Are you sure you want to cancel this approval request? This action cannot be undone.',
          function () {
            _performAction('cancel', '');
          }
        );
      });
    }

    if (reassignBtn) {
      reassignBtn.addEventListener('click', function () {
        _openReassignModal();
      });
    }
  }

  function _performAction(actionType, comments) {
    _detail.actioning = true;

    // Disable all action buttons during request
    _setActionButtonsLoading(true);

    var promise;
    if (actionType === 'approve') {
      promise = approveRequest(_detail.approvalId, comments);
    } else if (actionType === 'reject') {
      promise = rejectRequest(_detail.approvalId, comments);
    } else if (actionType === 'cancel') {
      promise = cancelRequest(_detail.approvalId);
    } else {
      _detail.actioning = false;
      _setActionButtonsLoading(false);
      return;
    }

    promise.then(function () {
      _detail.actioning = false;
      var label = actionType === 'approve' ? 'Approved' : (actionType === 'reject' ? 'Rejected' : 'Cancelled');
      Lex.Toast.success('Approval ' + label.toLowerCase() + ' successfully');

      // Hide action panel and refresh data
      hide('apdActionCard');
      _fetchApproval();

      // Clear timer
      if (_detail.timerHandle) {
        clearInterval(_detail.timerHandle);
        _detail.timerHandle = null;
      }
    }).catch(function (err) {
      _detail.actioning = false;
      _setActionButtonsLoading(false);
      Lex.Toast.error('Action failed: ' + (err && err.message ? err.message : 'Please try again'));
    });
  }

  function _setActionButtonsLoading(loading) {
    var btns = ['apdApproveBtn', 'apdRejectBtn', 'apdReassignBtn', 'apdCancelBtn'];
    for (var i = 0; i < btns.length; i++) {
      var btn = el(btns[i]);
      if (btn) {
        if (loading) {
          btn.setAttribute('loading', '');
          btn.setAttribute('disabled', '');
        } else {
          btn.removeAttribute('loading');
          btn.removeAttribute('disabled');
        }
      }
    }
  }

  function _openReassignModal() {
    var modal = el('apdReassignModal');
    if (!modal) return;

    // Load users into the reassign select
    _loadUsersForReassign();

    modal.setAttribute('open', '');

    var cancelBtn  = el('apdReassignCancelBtn');
    var confirmBtn = el('apdReassignConfirmBtn');

    if (cancelBtn) {
      cancelBtn.onclick = function () {
        modal.removeAttribute('open');
      };
    }

    if (confirmBtn) {
      confirmBtn.onclick = function () {
        var userSelect   = el('apdReassignUser');
        var commentInput = el('apdReassignComment');

        var userId   = userSelect  ? (userSelect.value  || '') : '';
        var comments = commentInput ? (commentInput.value || '').trim() : '';

        if (!userId) {
          Lex.Toast.warning('Please select a user to reassign to');
          return;
        }

        reassignRequest(_detail.approvalId, { assigned_to: userId, comments: comments })
          .then(function () {
            modal.removeAttribute('open');
            Lex.Toast.success('Approval reassigned successfully');
            _fetchApproval();
          })
          .catch(function (err) {
            Lex.Toast.error('Reassign failed: ' + (err && err.message ? err.message : 'Please try again'));
          });
      };
    }
  }

  function _loadUsersForReassign() {
    var userSelect = el('apdReassignUser');
    if (!userSelect) return;

    api.get('/api/v1/users?limit=100').then(function (res) {
      var users = (res && res.data) || [];
      var options = [];
      for (var i = 0; i < users.length; i++) {
        var u = users[i];
        options.push({
          value: String(u.id),
          label: escHtml(String(u.full_name || u.fullName || u.email || u.id))
        });
      }
      userSelect.options = options;
    }).catch(function () {
      // Non-critical — user can still type if select allows it
    });
  }

  // ===========================================================================
  // Page detection and init
  // ===========================================================================

  /**
   * Determine which page we're on and initialize the appropriate controller.
   * Called once the Lex page-init script has mounted the template content.
   */
  function init() {
    var path = window.location.pathname;

    // Check page by filename
    var isDetail = (
      path.indexOf('approval-detail') !== -1 ||
      (path.indexOf('approval') !== -1 && getQueryParam('id'))
    );

    if (isDetail) {
      initDetailPage();
    } else {
      initInboxPage();
    }
  }

  // lex-page-init.js runs synchronously before this script, so the template
  // content is already in the DOM. Call init directly.
  init();

  // Cleanup timer on page unload
  window.addEventListener('unload', function () {
    if (_detail.timerHandle) clearInterval(_detail.timerHandle);
  });

})();
