/**
 * Workspace Billable Hours Tab
 * Renders summary metrics, the time entries lex-table (docs/TABLE-STANDARD.md)
 * with its toolbar, period, bulk actions, and the review/approve drawer for a
 * specific matter's billable hours.
 *
 * @requires lex-table.js, lex-badge.js, lex-input.js, lex-select.js, lex-drawer.js, lex-modal.js
 * @requires library-column-filters.js - Created / Worked range filters
 * @requires admin-table-kit.js        - AdminTableKit toolbar wiring
 */

(function () {
  'use strict';

  var _matterId = null;
  var _entries = [];
  var _dateFrom = '';
  var _dateTo = '';
  var ADMIN_BILLABLE_ROLES = ['system_admin', 'org_admin', 'organization_admin', 'admin'];

  /**
   * Render the billable hours tab for a matter.
   * Called by switchMatterTab('billableHours') in workspace-details.js.
   */
  window.renderBillableHoursTab = function (matter) {
    _matterId = matter.matter_id;

    // If the caller deep-linked with `bhFrom` / `bhTo` (e.g. the dashboard
    // widget's "Review" button on a draft), honour that window so the row
    // they came to review is actually visible. Falls back to "current month
    // → today (UTC)" when no override is provided.
    var navFrom = '';
    var navTo = '';
    if (window.Lex && Lex.Nav && typeof Lex.Nav.getParams === 'function') {
      var p = Lex.Nav.getParams();
      navFrom = (p && p.get('bhFrom')) || '';
      navTo = (p && p.get('bhTo')) || '';
    }

    if (navFrom && navTo) {
      _dateFrom = navFrom;
      _dateTo = navTo;
    } else {
      var now = LanaTime.nowDate();
      _dateFrom = LanaTime.toLocalDateInputValue(LanaTime.startOfLocalMonth(now));
      _dateTo = LanaTime.toLocalDateInputValue(now);
    }

    _renderFilters();
    _loadSummary(matter);
    _loadEntries(matter);
    _wireGenerateButton(matter);
    _wireManualEntryButton(matter);
  };

  // ═══════════════════════════════════════════════════════════════
  // Toolbar (docs/TABLE-STANDARD.md section 2) + period
  // ═══════════════════════════════════════════════════════════════

  var SORT_ICON = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>';

  function _renderFilters() {
    var container = document.getElementById('bhFiltersBar');
    if (!container) return;

    // Already wired to this table: keep the toolbar (and its search, sort and
    // filter state) and only show the new period.
    var existing = _table();
    if (existing && existing._bhReady && document.getElementById('bhEntriesSearch')) {
      var fromEl = document.getElementById('bhDateFrom');
      var toEl = document.getElementById('bhDateTo');
      if (fromEl) fromEl.value = _dateFrom;
      if (toEl) toEl.value = _dateTo;
      return;
    }

    var esc = Lex.Utils.escapeHtml;
    var sortOptions = JSON.stringify([
      { value: 'start_time', label: 'Worked' },
      { value: 'created_at', label: 'Created' },
      { value: 'duration_minutes', label: 'Hours' },
      { value: 'status', label: 'Status' },
      { value: 'activity_type', label: 'Type' },
      { value: 'description', label: 'Entry' }
    ]);
    var statusOptions = JSON.stringify([{ value: 'all', label: 'All' }].concat(STATUS_OPTIONS));

    container.innerHTML =
      '<div class="bg-white rounded-lg shadow-sm border p-4" style="border-color: var(--lex-border-default)" role="search" aria-label="Search and filter time entries">' +
        '<div class="flex items-center gap-4 flex-wrap">' +
          '<div class="flex-1 min-w-[200px]">' +
            '<lex-input id="bhEntriesSearch" placeholder="Search time entries..." clearable="true" leading-icon="search"></lex-input>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Sort by:</label>' +
            '<lex-select id="bhEntriesSort" options=\'' + esc(sortOptions) + '\' value="start_time"></lex-select>' +
          '</div>' +
          '<lex-btn id="bhEntriesSortOrder" variant="ghost" icon="true" title="Toggle sort order" data-order="desc">' + SORT_ICON + '</lex-btn>' +
          '<div class="flex items-center gap-2">' +
            '<label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Status:</label>' +
            '<lex-select id="bhEntriesStatusFilter" options=\'' + esc(statusOptions) + '\' value="all"></lex-select>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label for="bhDateFrom" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">From</label>' +
            '<input type="date" id="bhDateFrom" class="bh-date-input" value="' + esc(_dateFrom) + '">' +
            '<label for="bhDateTo" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">to</label>' +
            '<input type="date" id="bhDateTo" class="bh-date-input" value="' + esc(_dateTo) + '">' +
            '<lex-btn id="bhFilterApplyBtn" variant="outline" size="sm">Apply</lex-btn>' +
          '</div>' +
          '<div id="bhEntriesCount" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)"></div>' +
        '</div>' +
      '</div>';

    // Period: reload the whole set for the new window.
    var applyBtn = document.getElementById('bhFilterApplyBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        var fromInput = document.getElementById('bhDateFrom');
        var toInput = document.getElementById('bhDateTo');
        _dateFrom = fromInput ? fromInput.value : '';
        _dateTo = toInput ? toInput.value : '';
        _refresh();
      });
    }

    _initEntriesTable();
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary Card
  // ═══════════════════════════════════════════════════════════════

  function _loadSummary(matter) {
    var container = document.getElementById('bhSummaryCard');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse bh-stats__full"><div class="cc-skeleton bh-skeleton"></div></div>';

    var url = '/api/v1/billable-hours/summary?matter_id=' + encodeURIComponent(matter.matter_id);
    if (_dateFrom) url += '&date_from=' + encodeURIComponent(_dateFrom);
    if (_dateTo) url += '&date_to=' + encodeURIComponent(_dateTo);
    url = _appendAdminScope(url);

    api.get(url)
      .then(function (result) {
        var data = (result && result.data) || {};
        container.innerHTML = _buildSummaryCards(data);
      })
      .catch(function () {
        container.innerHTML = '<div class="bh-stats__full bh-muted">Unable to load summary</div>';
      });
  }

  function _buildSummaryCards(data) {
    var cards = [
      { label: 'Total Hours', value: (data.total_hours || 0).toFixed(1), suffix: 'h' },
      { label: 'Billable Hours', value: (data.billable_hours || 0).toFixed(1), suffix: 'h' },
      { label: 'Billable Amount', value: '$' + _formatMoney(data.billable_amount || 0), suffix: '' },
      { label: 'Entries', value: data.total_entries || 0, suffix: '' },
      { label: 'Drafts', value: (data.by_status && data.by_status.draft) || 0, suffix: '', highlight: true },
      { label: 'Approved', value: (data.by_status && data.by_status.approved) || 0, suffix: '' }
    ];

    var html = '';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      html += '<div class="bh-stat">';
      html += '<div class="bh-stat__label">' + Lex.Utils.escapeHtml(c.label) + '</div>';
      html += '<div class="bh-stat__value' + (c.highlight ? ' bh-stat__value--highlight' : '') + '">' + Lex.Utils.escapeHtml(String(c.value)) + Lex.Utils.escapeHtml(c.suffix) + '</div>';
      html += '</div>';
    }
    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  // Time Entries table (docs/TABLE-STANDARD.md)
  //
  // GET /billable-hours/drafts pages (page/limit, max 200) but cannot sort,
  // search or filter beyond one status, so the table loads every entry for
  // the matter and period by walking the pages (no hidden cap), then sorts,
  // searches and filters in the browser. Rows keep raw values.
  // ═══════════════════════════════════════════════════════════════

  var DRAFTS_PAGE_SIZE = 200;
  var TABLE_ID = 'bhEntriesTable';

  var STATUS_OPTIONS = [
    { value: 'draft', label: 'Draft' },
    { value: 'submitted', label: 'Submitted' },
    { value: 'approved', label: 'Approved' },
    { value: 'invoiced', label: 'Invoiced' }
  ];

  var STATUS_COLORS = { draft: 'yellow', submitted: 'blue', approved: 'green', invoiced: 'purple' };

  var SOURCE_LABELS = { activity: 'Auto', manual: 'Manual', imported: 'Imported' };
  var SOURCE_TITLES = {
    activity: 'Auto-tracked from activity',
    manual: 'Manually entered by user',
    imported: 'Imported from external system'
  };

  var _loadSeq = 0;
  var _toolbar = null;

  /**
   * One page of the matter's time entries (every status, the period, and the
   * admin all-users scope).
   */
  function draftsUrl(matterId, page, period, adminScope) {
    var url = '/api/v1/billable-hours/drafts?matter_id=' + encodeURIComponent(matterId) +
      '&status=all&limit=' + DRAFTS_PAGE_SIZE + '&page=' + (page || 1);
    if (period && period.from) url += '&date_from=' + encodeURIComponent(period.from);
    if (period && period.to) url += '&date_to=' + encodeURIComponent(period.to);
    if (adminScope) url += '&all_users=true';
    return url;
  }

  function _num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function entryRow(e) {
    return {
      id: String(e.id || ''),
      description: String(e.description || ''),
      duration_minutes: _num(e.duration_minutes),
      activity_type: String(e.activity_type || ''),
      source: String(e.source || ''),
      status: String(e.status || 'draft'),
      start_time: e.start_time || '',
      created_at: e.created_at || '',
      actions: '',
      _raw: e
    };
  }

  function _esc(value) {
    return Lex.Utils.escapeHtml(value == null ? '' : String(value));
  }

  function _muted(text) {
    return '<span class="bh-cell-muted">' + _esc(text || '—') + '</span>';
  }

  function _badge(label, color, title) {
    if (!label) return _muted('');
    return '<lex-badge label="' + _esc(label) + '" color="' + _esc(color || 'gray') + '" size="sm"' +
      (title ? ' title="' + _esc(title) + '"' : '') + '></lex-badge>';
  }

  function _time(value) {
    if (!value) return _muted('');
    var text = Lex.Utils.formatDateTime(value);
    return '<time class="bh-cell-time" datetime="' + _esc(value) + '" title="' + _esc(text) + '">' + _esc(text) + '</time>';
  }

  function _label(value) {
    if (!value) return '';
    return typeof Lex.Utils.humanizeLabel === 'function' ? Lex.Utils.humanizeLabel(value) : String(value);
  }

  function entryRenderers() {
    return {
      description: function (val) {
        var text = val || 'No description';
        return '<span class="bh-cell-name" title="' + _esc(text) + '">' + _esc(text) + '</span>';
      },
      duration_minutes: function (val) {
        return '<span class="bh-cell-hours">' + (_num(val) / 60).toFixed(1) + 'h</span>';
      },
      activity_type: function (val) { return val ? '<span class="bh-cell-text">' + _esc(_label(val)) + '</span>' : _muted(''); },
      source: function (val) {
        return val ? _badge(SOURCE_LABELS[val] || _label(val), val === 'manual' ? 'blue' : (val === 'imported' ? 'purple' : 'gray'), SOURCE_TITLES[val]) : _muted('');
      },
      status: function (val) { return _badge(_label(val), STATUS_COLORS[val] || 'gray'); },
      start_time: _time,
      created_at: _time,
      actions: function (val, row) {
        var e = row._raw || {};
        var id = _esc(row.id);
        var html = '<div class="bh-row-actions">';
        var overlaps = Array.isArray(e.has_overlap_with) ? e.has_overlap_with : [];
        if (overlaps.length > 0) {
          html += '<button type="button" class="bh-row-btn bh-row-btn--warn" data-bh-action="overlap" data-id="' + id + '" title="Overlaps ' +
            overlaps.length + ' other ' + (overlaps.length === 1 ? 'entry' : 'entries') + '">Overlap</button>';
        }
        if (row.status === 'draft') {
          html += '<button type="button" class="bh-row-btn bh-row-btn--approve" data-bh-action="approve" data-id="' + id + '">Approve</button>';
          html += '<button type="button" class="bh-row-btn bh-row-btn--reject" data-bh-action="reject" data-id="' + id + '">Reject</button>';
        }
        return html + '</div>';
      }
    };
  }

  function _createdRange() {
    var shared = window.LanaLibraryColumnFilters;
    return {
      single: true,
      options: shared ? shared.EDITED_RANGE_OPTIONS : [],
      match: function (cell, values) { return !!shared && shared.inEditedRange(cell, values[0]); }
    };
  }

  function _minutesInRange(cell, range) {
    var parts = String(range || '').split('-');
    var n = _num(cell);
    var min = parts[0] === '' ? -Infinity : Number(parts[0]);
    var max = parts[1] === '' || parts[1] === undefined ? Infinity : Number(parts[1]);
    return n >= min && n < max;
  }

  function entryFilters(rows) {
    var types = {};
    (rows || []).forEach(function (r) { if (r.activity_type) types[r.activity_type] = true; });
    var typeOptions = Object.keys(types).sort().map(function (t) { return { value: t, label: _label(t) }; });
    var map = {
      description: { text: true, placeholder: 'Entry contains...' },
      duration_minutes: {
        single: true,
        options: [
          { value: '0-30', label: 'Under 30 minutes' },
          { value: '30-120', label: '30 minutes to 2 hours' },
          { value: '120-', label: '2 hours or more' }
        ],
        match: function (cell, values) { return _minutesInRange(cell, values[0]); }
      },
      source: { options: Object.keys(SOURCE_LABELS).map(function (k) { return { value: k, label: SOURCE_LABELS[k] }; }) },
      status: { options: STATUS_OPTIONS.slice() },
      start_time: _createdRange(),
      created_at: _createdRange()
    };
    if (typeOptions.length) map.activity_type = { options: typeOptions };
    return map;
  }

  function _table() {
    return document.getElementById(TABLE_ID);
  }

  function _entryById(id) {
    for (var i = 0; i < _entries.length; i++) {
      if (_entries[i].id === id) return _entries[i];
    }
    return null;
  }

  function _initEntriesTable() {
    var table = _table();
    var kit = window.AdminTableKit;
    if (!table || !kit || table._bhReady) return;
    table._bhReady = true;
    kit.whenTableReady().then(function () {
      if (_table() !== table) return;
      table.setCellRenderers(entryRenderers());
      table.setColumnFilterOptions(entryFilters(_entries.map(entryRow)));
      _toolbar = kit.bindToolbar({
        table: table,
        searchId: 'bhEntriesSearch',
        sortId: 'bhEntriesSort',
        orderId: 'bhEntriesSortOrder',
        filterId: 'bhEntriesStatusFilter',
        filterKey: 'status',
        countIds: ['bhEntriesCount', 'bhEntriesSectionCount'],
        noun: ['entry', 'entries']
      });
      // After bindToolbar's listeners, so these counts win.
      table.addEventListener('lex-filter-change', function (e) { if (e.target === table) _recount(); });
      table.addEventListener('lex-data-loaded', function (e) { if (e.target === table) _recount(); });

      table.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-bh-action]') : null;
        if (!btn) return;
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-bh-action');
        if (action === 'approve') _approveEntry(id);
        else if (action === 'reject') _confirmReject(id);
        else if (action === 'overlap') _openOverlapDrawer(id);
      });

      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row._raw) _openEntryModal(row._raw);
      });

      table.addEventListener('bulk-action', function (e) {
        var detail = e.detail || {};
        var items = detail.items || [];
        if (detail.action === 'approve') _bulkAction('approve', items);
        else if (detail.action === 'reject') _confirmBulkReject(items);
      });

      _showRows();
    });
  }

  function _recount() {
    var table = _table();
    if (!table || !_toolbar) return;
    _toolbar.setCount(Array.isArray(table.filteredRows) ? table.filteredRows.length : _entries.length);
    var filtered = Boolean(table.searchText) || (typeof table.getActiveFilters === 'function' && Object.keys(table.getActiveFilters() || {}).length > 0);
    table.emptyText = filtered
      ? 'No matching time entries. Try a different search or clear the filters.'
      : 'No time entries for this period. Use "Generate for Today" to create drafts from today\'s activity.';
  }

  function _showRows() {
    var table = _table();
    if (!table || typeof table.setData !== 'function') return;
    var rows = _entries.map(entryRow);
    table.setColumnFilterOptions(entryFilters(rows));
    if (typeof table.deselectAll === 'function') table.deselectAll();
    table.setData(rows);
    _recount();
  }

  /**
   * Every page of the matter's entries for the period.
   */
  function fetchAllEntries(matterId, period, adminScope, getter) {
    var get = getter || function (url) { return api.get(url); };
    var rows = [];
    function next(page) {
      return get(draftsUrl(matterId, page, period, adminScope)).then(function (result) {
        var data = (result && Array.isArray(result.data)) ? result.data : [];
        rows = rows.concat(data);
        var total = Number(result && result.pagination && result.pagination.total);
        var more = data.length >= DRAFTS_PAGE_SIZE && (!isFinite(total) || rows.length < total);
        return more ? next(page + 1) : rows;
      });
    }
    return next(1);
  }

  function _loadEntries(matter) {
    var seq = ++_loadSeq;
    var mid = (matter && matter.matter_id) || _matterId;
    return fetchAllEntries(mid, { from: _dateFrom, to: _dateTo }, _isAdminBillableHoursUser())
      .then(function (entries) {
        if (seq !== _loadSeq) return;
        _entries = entries;
        _showRows();
      })
      .catch(function (err) {
        if (seq !== _loadSeq) return;
        console.error('[billable-hours] time entries load failed:', err);
        var table = _table();
        if (_toolbar) _toolbar.setCount(null);
        if (!table) return;
        var message = 'Time entries could not be loaded. Check your connection and try again.';
        if (typeof table.setError === 'function') table.setError(message);
        else if (typeof table.setServerError === 'function') table.setServerError(message);
      });
  }

  function _appendAdminScope(url) {
    if (_isAdminBillableHoursUser()) {
      return url + '&all_users=true';
    }
    return url;
  }

  function _isAdminBillableHoursUser() {
    var user = null;
    if (typeof api !== 'undefined' && api && api.user) {
      user = api.user;
    }
    if (!user && typeof Lex !== 'undefined' && Lex.state && Lex.state.user) {
      user = Lex.state.user;
    }
    if (!user) {
      try {
        var stored = localStorage.getItem('user');
        user = stored ? JSON.parse(stored) : null;
      } catch (e) {
        user = null;
      }
    }
    if (!user) return false;

    if (_isAdminRole(user.role_name || user.role)) return true;

    var roles = user.roles || user.role_names || [];
    if (!Array.isArray(roles)) roles = [roles];
    for (var i = 0; i < roles.length; i++) {
      if (_isAdminRole(roles[i])) return true;
    }

    return false;
  }

  function _isAdminRole(role) {
    var roleName = '';
    if (typeof role === 'string') {
      roleName = role;
    } else if (role && typeof role === 'object') {
      roleName = role.name || role.role_name || role.role || '';
    }
    roleName = String(roleName).toLowerCase();
    return ADMIN_BILLABLE_ROLES.indexOf(roleName) !== -1;
  }

  // ─────────────────────────────────────────────────────────────
  // Overlap resolution
  // ─────────────────────────────────────────────────────────────
  // The row's Overlap button opens a lex-drawer listing the entries that
  // overlap it (resolved against the loaded set; no extra fetches). Each
  // overlap offers Open, Delete this overlap and, when both are drafts on
  // the same matter, Merge into the other. "Keep both" is closing the drawer.
  function _renderOverlapPanel(entry) {
    var ids = Array.isArray(entry.has_overlap_with) ? entry.has_overlap_with : [];
    var others = ids.map(_entryById).filter(function (x) { return !!x; });

    var html = '<div class="bh-overlap-list">';
    html += '<div class="bh-overlap-heading">Overlapping entries (' + ids.length + ')</div>';

    if (others.length === 0) {
      // The API listed ids outside the loaded period.
      html += '<div class="bh-cell-muted">Overlapping entries are outside the current period. Widen the date range to see them.</div>';
      return html + '</div>';
    }

    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      var oHours = ((o.duration_minutes || 0) / 60).toFixed(1);
      var canMerge = entry.status === 'draft' && o.status === 'draft' && entry.matter_id === o.matter_id;
      html += '<div class="bh-overlap-item" data-id="' + _esc(o.id) + '">';
      html += '<div class="bh-overlap-main">';
      html += '<div class="bh-cell-name">' + oHours + 'h · ' + _esc(o.description || 'No description') + '</div>';
      html += '<div class="bh-cell-muted">' + _esc(_label(o.activity_type || 'general')) + ' · ' + _esc(_label(o.status || 'draft')) +
        (o.source ? ' · ' + _esc(SOURCE_LABELS[o.source] || _label(o.source)) : '') + '</div>';
      html += '</div>';
      html += '<div class="bh-row-actions">';
      html += '<button type="button" class="bh-row-btn" data-overlap-action="open" data-other-id="' + _esc(o.id) + '">Open</button>';
      html += '<button type="button" class="bh-row-btn bh-row-btn--reject" data-overlap-action="delete" data-other-id="' + _esc(o.id) + '">Delete this overlap</button>';
      if (canMerge) {
        html += '<button type="button" class="bh-row-btn" data-overlap-action="merge" data-source-id="' + _esc(entry.id) + '" data-other-id="' + _esc(o.id) + '">Merge into the other</button>';
      }
      html += '</div></div>';
    }
    return html + '</div>';
  }

  function _openOverlapDrawer(entryId) {
    var entry = _entryById(entryId);
    if (!entry || !Lex.Drawer) return;
    var drawer = Lex.Drawer.open({
      heading: 'Resolve overlap',
      content: _renderOverlapPanel(entry),
      width: 'md',
      buttons: []
    });
    var root = (drawer && drawer.addEventListener) ? drawer : document;
    var handler = function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-overlap-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-overlap-action');
      var otherId = btn.getAttribute('data-other-id');
      root.removeEventListener('click', handler);
      if (Lex.Drawer.close) Lex.Drawer.close();
      if (action === 'open') {
        var other = _entryById(otherId);
        if (other) _openEntryModal(other);
      } else if (action === 'delete') {
        _resolveDelete(otherId);
      } else if (action === 'merge') {
        _resolveMerge(btn.getAttribute('data-source-id'), otherId);
      }
    };
    root.addEventListener('click', handler);
  }

  function _resolveDelete(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/reject')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Overlapping entry deleted');
        _refresh();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Failed to delete overlap';
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  function _resolveMerge(sourceId, otherId) {
    api.post('/api/v1/billable-hours/drafts/' + sourceId + '/merge', { merge_with_id: otherId })
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entries merged');
        _refresh();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Failed to merge entries';
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  function _approveEntry(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/approve')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry approved');
        _refresh();
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to approve entry');
      });
  }

  function _confirmReject(entryId) {
    Lex.Modal.confirm(
      'Reject entry',
      'Reject this time entry? This action cannot be undone.',
      function () { _rejectEntry(entryId); },
      { variant: 'danger', confirmText: 'Reject' }
    );
  }

  function _rejectEntry(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/reject')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry rejected');
        if (Lex.Drawer && document.querySelector && document.querySelector('lex-drawer')) Lex.Drawer.close();
        _refresh();
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to reject entry');
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Bulk Actions (lex-table selectable + bulk-actions)
  // ═══════════════════════════════════════════════════════════════

  // Only drafts can be approved or rejected; other selected rows are skipped.
  function _draftIds(items) {
    return (items || []).filter(function (row) { return row && row.status === 'draft'; })
      .map(function (row) { return row.id; });
  }

  function _confirmBulkReject(items) {
    var ids = _draftIds(items);
    if (ids.length === 0) {
      if (Lex.Toast) Lex.Toast.info('Only draft entries can be rejected');
      return;
    }
    Lex.Modal.confirm(
      'Reject selected entries',
      'Reject ' + ids.length + ' draft ' + (ids.length === 1 ? 'entry' : 'entries') + '? This cannot be undone.',
      function () { _bulkAction('reject', items); },
      { variant: 'danger', confirmText: 'Reject all' }
    );
  }

  function _bulkAction(action, items) {
    var ids = _draftIds(items);
    var skipped = (items || []).length - ids.length;
    if (ids.length === 0) {
      if (Lex.Toast) Lex.Toast.info('Only draft entries can be ' + (action === 'approve' ? 'approved' : 'rejected'));
      return;
    }

    var completed = 0;
    var failed = 0;

    function processNext(idx) {
      if (idx >= ids.length) {
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          var tail = skipped > 0 ? ' (' + skipped + ' not drafts, skipped)' : '';
          if (failed > 0) {
            Lex.Toast.warning(completed + ' ' + action + 'd, ' + failed + ' failed' + tail);
          } else {
            Lex.Toast.success(completed + ' entr' + (completed !== 1 ? 'ies' : 'y') + ' ' + action + 'd' + tail);
          }
        }
        _refresh();
        return;
      }

      var endpoint = action === 'approve'
        ? '/api/v1/billable-hours/drafts/' + ids[idx] + '/approve'
        : '/api/v1/billable-hours/drafts/' + ids[idx] + '/reject';

      api.post(endpoint)
        .then(function () { completed++; processNext(idx + 1); })
        .catch(function () { failed++; processNext(idx + 1); });
    }

    processNext(0);
  }

  // ═══════════════════════════════════════════════════════════════
  // Entry Detail Modal (full-screen for editing)
  // ═══════════════════════════════════════════════════════════════

  function _openEntryModal(entry) {
    var hours = ((entry.duration_minutes || 0) / 60).toFixed(1);
    var date = entry.start_time ? Lex.Utils.formatDateTime(entry.start_time) : '-';
    var isDraft = entry.status === 'draft';
    // Owners can edit drafts AND submitted entries. Approved entries are
    // locked for owners; only admins can edit those (admin route).
    var isOwnerEditable = entry.status === 'draft' || entry.status === 'submitted';

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';

    // Hours + Activity type
    html += '<div style="display:flex;gap:1rem;align-items:center;">';
    if (isOwnerEditable) {
      html += '<div><input type="number" id="bhEditHours" value="' + hours + '" step="0.1" min="0.1" max="24" style="width:5rem;font-size:1.5rem;font-weight:700;color:var(--lex-color-blue-700,#1d4ed8);text-align:center;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;padding:0.25rem;">h</div>';
    } else {
      html += '<div style="font-size:2rem;font-weight:700;color:var(--lex-color-blue-700,#1d4ed8);">' + hours + 'h</div>';
    }
    html += '<div>';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(_label(entry.activity_type || 'general')) + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">' + Lex.Utils.escapeHtml(date) + '</div>';
    html += '</div>';
    html += '</div>';

    // Description
    html += '<div>';
    html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Description</div>';
    if (isOwnerEditable) {
      html += '<textarea id="bhEditDescription" style="width:100%;min-height:4rem;padding:0.5rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.875rem;font-family:inherit;resize:vertical;">' + Lex.Utils.escapeHtml(entry.description || '') + '</textarea>';
      if (isDraft) {
        html += '<div style="display:flex;gap:0.5rem;margin-top:0.25rem;">';
        html += '<button id="bhRegenDescBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;">Regenerate description with AI</button>';
        html += '</div>';
      }
    } else {
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);padding:0.5rem;background:var(--lex-bg-muted,#f9fafb);border-radius:0.375rem;">' + Lex.Utils.escapeHtml(entry.description || 'No description') + '</div>';
    }
    html += '</div>';

    // Details grid — rate becomes editable when entry is owner-editable
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    var fields = [
      { label: 'Status', value: _label(entry.status || 'draft') },
      { label: 'Billing Code', value: entry.billing_code || '-' },
      { label: 'Duration', value: entry.duration_minutes + ' minutes (' + hours + 'h)' },
      { label: 'Billable', value: entry.is_billable ? 'Yes' : 'No' },
      { label: 'Source', value: SOURCE_LABELS[entry.source || 'manual'] || _label(entry.source) }
    ];
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      html += '<div>';
      html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">' + Lex.Utils.escapeHtml(f.label) + '</div>';
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(f.value) + '</div>';
      html += '</div>';
    }
    // Rate cell
    html += '<div>';
    html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">Rate</div>';
    if (isOwnerEditable) {
      var rateVal = entry.hourly_rate != null ? String(entry.hourly_rate) : '';
      html += '<div style="display:flex;align-items:center;gap:0.25rem;font-size:0.875rem;">';
      html += '$<input type="number" id="bhEditRate" value="' + Lex.Utils.escapeHtml(rateVal) + '" step="0.01" min="0" placeholder="0.00" style="width:6rem;padding:0.25rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;font-size:0.875rem;">/hr';
      html += '</div>';
    } else {
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);">' + (entry.hourly_rate ? '$' + entry.hourly_rate + '/hr' : 'Not set') + '</div>';
    }
    html += '</div>';
    html += '</div>';

    // Audit-history link — every entry can have history once it has been
    // edited; we surface the link regardless and let the endpoint return [].
    html += '<div style="padding-top:0.25rem;">';
    html += '<button id="bhHistoryBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;text-decoration:underline;">View edit history</button>';
    html += '</div>';

    // Split + Merge buttons for drafts
    if (isDraft) {
      html += '<div style="padding-top:0.5rem;border-top:1px solid var(--lex-border-default,#e5e7eb);display:flex;gap:1rem;">';
      if (entry.duration_minutes > 6) {
        html += '<button id="bhSplitBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;">Split this entry into two</button>';
      }
      // Merge: show dropdown of other drafts for the same matter
      var mergeTargets = _entries.filter(function (e) {
        return e.id !== entry.id && e.status === 'draft' && e.matter_id === entry.matter_id;
      });
      if (mergeTargets.length > 0) {
        html += '<div style="display:flex;align-items:center;gap:0.25rem;">';
        html += '<span style="font-size:0.75rem;color:var(--lex-color-blue-600);">Merge with:</span>';
        var mergeOptions = mergeTargets.map(function (mt) {
          var mtHours = ((mt.duration_minutes || 0) / 60).toFixed(1);
          return { value: String(mt.id), label: mtHours + 'h — ' + _label(mt.activity_type || 'general') };
        });
        html += '<lex-select id="bhMergeTarget" options=\'' + Lex.Utils.escapeHtml(JSON.stringify(mergeOptions)) + '\' value="' + Lex.Utils.escapeHtml(mergeOptions[0].value) + '"></lex-select>';
        html += '<button id="bhMergeBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;font-weight:600;">Merge</button>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Activity source data
    if (entry.source_segment_data && Array.isArray(entry.source_segment_data) && entry.source_segment_data.length > 0) {
      html += '<div>';
      html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Source Activities (' + entry.source_segment_data.length + ')</div>';
      html += '<div style="max-height:8rem;overflow-y:auto;font-size:0.75rem;background:var(--lex-bg-muted,#f9fafb);border-radius:0.375rem;padding:0.5rem;">';
      for (var si = 0; si < entry.source_segment_data.length && si < 15; si++) {
        var seg = entry.source_segment_data[si];
        html += '<div style="color:var(--lex-text-secondary);">' + Lex.Utils.escapeHtml((seg.type || 'event') + (seg.resourceName ? ': ' + seg.resourceName : '')) + '</div>';
      }
      if (entry.source_segment_data.length > 15) {
        html += '<div style="color:var(--lex-text-muted);font-style:italic;">+' + (entry.source_segment_data.length - 15) + ' more</div>';
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';

    // Build footer buttons
    var buttons = [];
    if (isDraft) {
      buttons.push({ label: 'Approve', variant: 'primary', id: 'bhModalApproveBtn' });
      buttons.push({ label: 'Reject', variant: 'danger', id: 'bhModalRejectBtn' });
    } else if (isOwnerEditable) {
      // Submitted: owner can save edits without resubmitting; admin handles
      // the approval transition from /admin/approve/:id.
      buttons.push({ label: 'Save changes', variant: 'primary', id: 'bhModalSaveBtn' });
    }

    Lex.Drawer.open({
      heading: 'Time Entry — ' + hours + 'h ' + _label(entry.activity_type || ''),
      content: html,
      width: 'lg',
      buttons: buttons
    });

    // Wire modal actions after drawer opens
    setTimeout(function () {
      var approveBtn = document.getElementById('bhModalApproveBtn');
      if (approveBtn) {
        approveBtn.addEventListener('click', function () {
          _saveAndApprove(entry);
        });
      }

      var saveBtn = document.getElementById('bhModalSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          _saveOnly(entry);
        });
      }

      var historyBtn = document.getElementById('bhHistoryBtn');
      if (historyBtn) {
        historyBtn.addEventListener('click', function () {
          _openHistoryDrawer(entry.id);
        });
      }

      var rejectBtn = document.getElementById('bhModalRejectBtn');
      if (rejectBtn) {
        rejectBtn.addEventListener('click', function () {
          _confirmReject(entry.id);
        });
      }

      var regenBtn = document.getElementById('bhRegenDescBtn');
      if (regenBtn) {
        regenBtn.addEventListener('click', function () {
          regenBtn.textContent = 'Generating...';
          regenBtn.disabled = true;
          api.post('/api/v1/billable-hours/drafts/' + entry.id + '/regenerate')
            .then(function (result) {
              if (result && result.data && result.data.description) {
                var textarea = document.getElementById('bhEditDescription');
                if (textarea) textarea.value = result.data.description;
              }
              regenBtn.textContent = 'Regenerate description with AI';
              regenBtn.disabled = false;
            })
            .catch(function () {
              regenBtn.textContent = 'Failed — try again';
              regenBtn.disabled = false;
            });
        });
      }

      var splitBtn = document.getElementById('bhSplitBtn');
      if (splitBtn) {
        splitBtn.addEventListener('click', function () {
          var halfMinutes = Math.floor(entry.duration_minutes / 2);
          api.post('/api/v1/billable-hours/drafts/' + entry.id + '/split', { split_minutes: halfMinutes })
            .then(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry split into two');
              if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
              _refresh();
            })
            .catch(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to split entry');
            });
        });
      }

      var mergeBtn = document.getElementById('bhMergeBtn');
      if (mergeBtn) {
        mergeBtn.addEventListener('click', function () {
          var select = document.getElementById('bhMergeTarget');
          if (!select || !select.value) return;
          api.post('/api/v1/billable-hours/drafts/' + entry.id + '/merge', { merge_with_id: select.value })
            .then(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entries merged');
              if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
              _refresh();
            })
            .catch(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to merge entries');
            });
        });
      }
    }, 100);
  }

  // Collect modal field values into a PATCH payload. Only changed fields
  // are included so the audit diff stays meaningful.
  function _collectModalUpdates(entry) {
    var textarea = document.getElementById('bhEditDescription');
    var hoursInput = document.getElementById('bhEditHours');
    var rateInput = document.getElementById('bhEditRate');
    var updates = {};

    if (textarea && textarea.value !== entry.description) {
      updates.description = textarea.value;
    }
    if (hoursInput) {
      var newMinutes = Math.round(parseFloat(hoursInput.value) * 60);
      if (newMinutes > 0 && newMinutes !== entry.duration_minutes) {
        updates.duration_minutes = newMinutes;
      }
    }
    if (rateInput) {
      var raw = rateInput.value;
      if (raw === '' || raw === null) {
        if (entry.hourly_rate != null) updates.hourly_rate = null;
      } else {
        var num = parseFloat(raw);
        if (!isNaN(num) && num >= 0 && num !== parseFloat(entry.hourly_rate)) {
          updates.hourly_rate = num;
        }
      }
    }
    return updates;
  }

  function _saveAndApprove(entry) {
    var updates = _collectModalUpdates(entry);

    if (Object.keys(updates).length > 0) {
      api.patch('/api/v1/billable-hours/drafts/' + entry.id, updates)
        .then(function () { _approveEntry(entry.id); })
        .catch(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to save edits — entry not approved');
        });
    } else {
      _approveEntry(entry.id);
    }
  }

  function _saveOnly(entry) {
    var updates = _collectModalUpdates(entry);
    if (Object.keys(updates).length === 0) {
      if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.info('No changes to save');
      return;
    }
    api.patch('/api/v1/billable-hours/drafts/' + entry.id, updates)
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Changes saved');
        if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
        _refresh();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Failed to save changes';
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  // Audit-history viewer. Renders a chronological list of edit events with
  // before/after diffs so owners can see what their admins changed (and
  // admins can see what they themselves changed).
  function _openHistoryDrawer(entryId) {
    api.get('/api/v1/billable-hours/entries/' + entryId + '/history')
      .then(function (resp) {
        var rows = (resp && resp.data) || [];
        var html = '<div style="display:flex;flex-direction:column;gap:0.75rem;">';
        if (rows.length === 0) {
          html += '<div style="font-size:0.875rem;color:var(--lex-text-muted);padding:1rem;text-align:center;">No edits recorded for this entry yet.</div>';
        } else {
          for (var i = 0; i < rows.length; i++) {
            html += _renderHistoryRow(rows[i]);
          }
        }
        html += '</div>';
        Lex.Drawer.open({
          heading: 'Edit history',
          content: html,
          width: 'md',
          buttons: []
        });
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to load edit history');
      });
  }

  function _renderHistoryRow(row) {
    var details = row.details || {};
    var diff = details.diff || {};
    var when = row.created_at ? Lex.Utils.formatDateTime(row.created_at) : '-';
    var actor = (row.first_name || row.last_name) ? ((row.first_name || '') + ' ' + (row.last_name || '')).trim() : (row.email || row.user_id || 'Unknown');
    var roleLabel = details.actor_role === 'admin' ? 'Admin' : 'Owner';
    var flag = details.post_approval_edit ? ' <span style="font-size:0.7rem;color:var(--lex-color-amber-700,#b45309);font-weight:600;">[post-approval]</span>' : '';

    var html = '<div style="border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;padding:0.75rem;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(actor) + ' <span style="font-size:0.7rem;color:var(--lex-text-muted);font-weight:400;">(' + roleLabel + ')</span>' + flag + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">' + Lex.Utils.escapeHtml(when) + '</div>';
    html += '</div>';

    var keys = Object.keys(diff);
    if (keys.length === 0) {
      html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">No field changes recorded.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:0.25rem;font-size:0.75rem;">';
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var d = diff[key] || {};
        var before = d.before === null || d.before === undefined ? '—' : String(d.before);
        var after = d.after === null || d.after === undefined ? '—' : String(d.after);
        html += '<div>';
        html += '<span style="font-weight:600;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(key) + ':</span> ';
        html += '<span style="color:var(--lex-text-muted);text-decoration:line-through;">' + Lex.Utils.escapeHtml(before) + '</span> ';
        html += '<span style="color:var(--lex-text-muted);">→</span> ';
        html += '<span style="color:var(--lex-color-blue-700,#1d4ed8);">' + Lex.Utils.escapeHtml(after) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  // Generate Button
  // ═══════════════════════════════════════════════════════════════

  function _wireGenerateButton(matter) {
    var btn = document.getElementById('bhGenerateBtn');
    if (!btn || btn._bhWired) return;
    btn._bhWired = true;

    btn.addEventListener('click', function () {
      btn.textContent = 'Generating...';
      btn.disabled = true;

      // The user's LOCAL calendar day — toISOString() would send the UTC day,
      // which is tomorrow for evening users west of UTC.
      var today = LanaTime.toLocalDateInputValue(LanaTime.nowDate());
      api.post('/api/v1/billable-hours/generate', { date: today })
        .then(function (result) {
          var data = result && result.data;
          var count = (data && data.generated) || 0;
          btn.textContent = 'Generate for Today';
          btn.disabled = false;
          if (count > 0) {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success(count + ' draft' + (count !== 1 ? 's' : '') + ' generated');
          } else {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.info('No new billable activity found');
          }
          _refresh();
        })
        .catch(function () {
          btn.textContent = 'Generate for Today';
          btn.disabled = false;
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Generation failed');
        });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Manual Entry
  // ═══════════════════════════════════════════════════════════════

  function _wireManualEntryButton(matter) {
    var btn = document.getElementById('bhAddManualBtn');
    if (!btn || btn._bhWired) return;
    btn._bhWired = true;

    btn.addEventListener('click', function () {
      _showManualEntryForm(matter);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Manual entry form
  //
  // Backed by POST /api/v1/billable-hours/manual which creates a row with
  // source='manual'. Body accepts EITHER duration_minutes OR (start_time,
  // end_time) — we let the user pick which pair to fill via a tab toggle.
  // The form is rendered inside the standard Lex.Drawer; on success we
  // surface any overlap metadata in the toast so the user knows to triage.
  // ─────────────────────────────────────────────────────────────
  function _showManualEntryForm(matter) {
    var inputStyle = 'width:100%;padding:0.375rem 0.625rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.8125rem;font-family:inherit;';
    var labelStyle = 'font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;';

    // Default start/end to "now minus 30 min" → "now" so the inputs are pre-filled.
    var now = Lex.Utils.nowDate();
    var nowStr = _toDatetimeLocal(now);
    var halfHourAgoStr = _toDatetimeLocal(Lex.Utils.addMinutes(now, -30));

    var matterIdForForm = (matter && matter.matter_id) || _matterId || '';
    var hasPresetMatter = !!matterIdForForm;

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';

    // Matter (locked when in workspace context)
    html += '<div>';
    html += '<label style="' + labelStyle + '">Matter</label>';
    if (hasPresetMatter) {
      html += '<input type="text" id="manualEntryMatterId" value="' + Lex.Utils.escapeHtml(matterIdForForm) + '" readonly style="' + inputStyle + 'background:var(--lex-bg-muted,#f9fafb);color:var(--lex-text-muted);font-family:monospace;">';
      html += '<div style="font-size:0.7rem;color:var(--lex-text-muted);margin-top:0.25rem;">Using current matter context</div>';
    } else {
      // Fallback: free-text input. Workspace details page is always scoped to
      // a matter, so this branch is unlikely to be hit — but we keep it as a
      // safety net rather than silently failing.
      html += '<input type="text" id="manualEntryMatterId" placeholder="Matter ID (UUID)" style="' + inputStyle + '">';
    }
    html += '</div>';

    // Description
    html += '<div>';
    html += '<label style="' + labelStyle + '">Description <span style="color:var(--lex-color-red-600,#dc2626);">*</span></label>';
    html += '<textarea id="manualEntryDesc" style="' + inputStyle + 'min-height:4.5rem;resize:vertical;" placeholder="Describe the work performed..."></textarea>';
    html += '</div>';

    // Time mode toggle: duration vs start/end
    html += '<div>';
    html += '<label style="' + labelStyle + '">Time</label>';
    html += '<div role="tablist" style="display:flex;gap:0.25rem;margin-bottom:0.5rem;">';
    html += '<button type="button" id="manualEntryModeDuration" data-mode="duration" style="flex:1;padding:0.375rem;font-size:0.75rem;font-weight:600;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;background:var(--lex-color-blue-600,#2563eb);color:white;cursor:pointer;">Duration</button>';
    html += '<button type="button" id="manualEntryModeRange"    data-mode="range"    style="flex:1;padding:0.375rem;font-size:0.75rem;font-weight:600;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;background:white;color:var(--lex-text-secondary);cursor:pointer;">Start / End</button>';
    html += '</div>';

    // Duration pane
    html += '<div id="manualEntryDurationPane">';
    html += '<input type="number" id="manualEntryMinutes" value="30" step="1" min="1" max="1440" style="' + inputStyle + '" placeholder="Minutes">';
    html += '<div style="font-size:0.7rem;color:var(--lex-text-muted);margin-top:0.25rem;">Duration in minutes</div>';
    html += '</div>';

    // Range pane
    html += '<div id="manualEntryRangePane" style="display:none;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    html += '<div>';
    html += '<label style="' + labelStyle + '">Start</label>';
    html += '<input type="datetime-local" id="manualEntryStart" value="' + halfHourAgoStr + '" style="' + inputStyle + '">';
    html += '</div>';
    html += '<div>';
    html += '<label style="' + labelStyle + '">End</label>';
    html += '<input type="datetime-local" id="manualEntryEnd" value="' + nowStr + '" style="' + inputStyle + '">';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // Activity type
    html += '<div>';
    html += '<label style="' + labelStyle + '">Activity Type</label>';
    var typeOptions = [
      { value: 'general', label: 'General' },
      { value: 'research', label: 'Research' },
      { value: 'review', label: 'Review' },
      { value: 'drafting', label: 'Drafting' },
      { value: 'communication', label: 'Communication' },
      { value: 'case_management', label: 'Case management' }
    ];
    html += '<lex-select id="manualEntryType" options=\'' + Lex.Utils.escapeHtml(JSON.stringify(typeOptions)) + '\' value="general"></lex-select>';
    html += '</div>';

    // Two-column row for billing code + rate
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    html += '<div>';
    html += '<label style="' + labelStyle + '">Billing Code</label>';
    html += '<input type="text" id="manualEntryBillingCode" style="' + inputStyle + '" placeholder="Optional">';
    html += '</div>';
    html += '<div>';
    html += '<label style="' + labelStyle + '">Hourly Rate</label>';
    html += '<input type="number" id="manualEntryRate" step="0.01" min="0" style="' + inputStyle + '" placeholder="Optional">';
    html += '</div>';
    html += '</div>';

    // Billable checkbox
    html += '<div style="display:flex;align-items:center;gap:0.5rem;">';
    html += '<input type="checkbox" id="manualEntryBillable" checked style="cursor:pointer;">';
    html += '<label for="manualEntryBillable" style="font-size:0.8125rem;color:var(--lex-text-secondary);cursor:pointer;">Billable</label>';
    html += '</div>';

    // Inline error region (populated from API validation failures)
    html += '<div id="manualEntryError" style="display:none;padding:0.5rem 0.75rem;background:var(--lex-color-red-50,#fef2f2);border:1px solid var(--lex-color-red-200,#fecaca);border-radius:0.375rem;color:var(--lex-color-red-700,#b91c1c);font-size:0.75rem;"></div>';

    html += '</div>';

    Lex.Drawer.open({
      heading: 'New Time Entry',
      content: html,
      width: 'md',
      buttons: [
        { label: 'Create', variant: 'primary', id: 'manualEntrySaveBtn' }
      ]
    });

    setTimeout(function () {
      // Mode toggle wiring
      var durBtn = document.getElementById('manualEntryModeDuration');
      var rangeBtn = document.getElementById('manualEntryModeRange');
      var durPane = document.getElementById('manualEntryDurationPane');
      var rangePane = document.getElementById('manualEntryRangePane');
      var currentMode = 'duration';

      function setMode(mode) {
        currentMode = mode;
        if (mode === 'duration') {
          durPane.style.display = '';
          rangePane.style.display = 'none';
          durBtn.style.background = 'var(--lex-color-blue-600,#2563eb)';
          durBtn.style.color = 'white';
          rangeBtn.style.background = 'white';
          rangeBtn.style.color = 'var(--lex-text-secondary)';
        } else {
          durPane.style.display = 'none';
          rangePane.style.display = 'grid';
          rangeBtn.style.background = 'var(--lex-color-blue-600,#2563eb)';
          rangeBtn.style.color = 'white';
          durBtn.style.background = 'white';
          durBtn.style.color = 'var(--lex-text-secondary)';
        }
      }

      if (durBtn) durBtn.addEventListener('click', function () { setMode('duration'); });
      if (rangeBtn) rangeBtn.addEventListener('click', function () { setMode('range'); });

      var saveBtn = document.getElementById('manualEntrySaveBtn');
      if (!saveBtn) return;

      saveBtn.addEventListener('click', function () {
        var matterIdEl = document.getElementById('manualEntryMatterId');
        var descEl = document.getElementById('manualEntryDesc');
        var typeEl = document.getElementById('manualEntryType');
        var billableEl = document.getElementById('manualEntryBillable');
        var billingCodeEl = document.getElementById('manualEntryBillingCode');
        var rateEl = document.getElementById('manualEntryRate');
        var errorEl = document.getElementById('manualEntryError');

        function showError(msg) {
          if (!errorEl) return;
          errorEl.textContent = msg;
          errorEl.style.display = 'block';
        }
        function clearError() {
          if (!errorEl) return;
          errorEl.textContent = '';
          errorEl.style.display = 'none';
        }
        clearError();

        var matterIdVal = matterIdEl ? (matterIdEl.value || '').trim() : '';
        var descVal = descEl ? descEl.value.trim() : '';
        var typeVal = typeEl ? typeEl.value : 'general';
        var billableVal = billableEl ? billableEl.checked : true;
        var billingCodeVal = billingCodeEl ? billingCodeEl.value.trim() : '';
        var rateRaw = rateEl ? rateEl.value : '';

        if (!matterIdVal) { showError('Matter is required'); return; }
        if (!descVal) { showError('Description is required'); return; }

        var body = {
          matter_id: matterIdVal,
          description: descVal,
          activity_type: typeVal,
          is_billable: billableVal
        };

        if (currentMode === 'duration') {
          var minutesEl = document.getElementById('manualEntryMinutes');
          var minutesVal = minutesEl ? parseInt(minutesEl.value, 10) : NaN;
          if (!minutesVal || minutesVal <= 0) {
            showError('Duration must be a positive number of minutes');
            return;
          }
          body.duration_minutes = minutesVal;
        } else {
          var startEl = document.getElementById('manualEntryStart');
          var endEl = document.getElementById('manualEntryEnd');
          var startVal = startEl ? startEl.value : '';
          var endVal = endEl ? endEl.value : '';
          if (!startVal || !endVal) {
            showError('Both start and end are required');
            return;
          }
          var startIso = LanaTime.toIsoInstant(startVal);
          var endIso = LanaTime.toIsoInstant(endVal);
          if (new Date(endIso) <= new Date(startIso)) {
            showError('End time must be after start time');
            return;
          }
          body.start_time = startIso;
          body.end_time = endIso;
        }

        if (billingCodeVal) body.billing_code = billingCodeVal;
        if (rateRaw !== '' && rateRaw !== null) {
          var rateNum = parseFloat(rateRaw);
          if (!isNaN(rateNum) && rateNum >= 0) body.hourly_rate = rateNum;
        }

        saveBtn.disabled = true;
        var originalLabel = saveBtn.textContent;
        saveBtn.textContent = 'Creating...';

        api.post('/api/v1/billable-hours/manual', body)
          .then(function (result) {
            var meta = (result && result.metadata) || {};
            var overlaps = Array.isArray(meta.overlapsWith) ? meta.overlapsWith : [];
            if (typeof Lex !== 'undefined' && Lex.Toast) {
              if (overlaps.length > 0) {
                Lex.Toast.success('Entry created — overlaps ' + overlaps.length + ' other entr' + (overlaps.length === 1 ? 'y' : 'ies') + ' on this matter');
              } else {
                Lex.Toast.success('Time entry created');
              }
            }
            if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
            _refresh();
          })
          .catch(function (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalLabel;
            // ApiError carries a message; surface server-side validation
            // detail directly in the form so the user can fix it inline.
            var msg = (err && err.message) || 'Failed to create entry';
            if (err && err.data) {
              var errDetail = err.data.error && err.data.error.message;
              if (errDetail) msg = errDetail;
              else if (err.data.detail) msg = err.data.detail;
            }
            showError(msg);
          });
      });
    }, 100);
  }

  // Convert a Date to the value format expected by <input type="datetime-local">
  // ("YYYY-MM-DDTHH:MM" in local time). Delegates to
  // LanaTime.toLocalDatetimeInputValue, which builds the local-wall-clock
  // string (native toISOString would shift it to UTC).
  function _toDatetimeLocal(d) {
    return LanaTime.toLocalDatetimeInputValue(d);
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function _refresh() {
    _loadEntries({ matter_id: _matterId });
    _loadSummary({ matter_id: _matterId });
  }

  function _formatMoney(amount) {
    if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Pure table logic, exposed for unit tests.
  window.WorkspaceBillableHoursTable = {
    draftsUrl: draftsUrl,
    fetchAllEntries: fetchAllEntries,
    entryRow: entryRow,
    entryRenderers: entryRenderers,
    entryFilters: entryFilters,
    draftIds: _draftIds,
    DRAFTS_PAGE_SIZE: DRAFTS_PAGE_SIZE
  };

})();

