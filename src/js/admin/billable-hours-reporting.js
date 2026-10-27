/**
 * Admin Billable Hours Reporting
 * Firm-wide billable hours management with by-attorney, by-matter views
 * and an approval queue for submitted entries.
 *
 * Each list is a lex-table on the table standard (docs/TABLE-STANDARD.md).
 *
 * @requires lex-table.js, lex-badge.js, lex-input.js, lex-select.js
 * @requires library-column-filters.js - Created range filter
 * @requires admin-table-kit.js        - AdminTableKit toolbar + cell helpers
 */

(function () {
  'use strict';

  var _dateFrom = '';
  var _dateTo = '';
  var _activeTab = 'attorneys';

  // ═══════════════════════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════════════════════

  function init() {
    // Default to this month
    var now = LanaTime.nowDate();
    _dateFrom = LanaTime.toLocalDateInputValue(LanaTime.startOfLocalMonth(now));
    _dateTo = LanaTime.toLocalDateInputValue(now);

    var fromInput = document.getElementById('bhAdminDateFrom');
    var toInput = document.getElementById('bhAdminDateTo');
    if (fromInput) fromInput.value = _dateFrom;
    if (toInput) toInput.value = _dateTo;

    _wirePeriodPresets();
    _wireApplyDates();
    _wireTabSwitching();
    _loadSummary();
    _initTables();
  }

  // ═══════════════════════════════════════════════════════════════
  // Period Presets
  // ═══════════════════════════════════════════════════════════════

  function _wirePeriodPresets() {
    var container = document.getElementById('bhAdminPeriod');
    if (!container) return;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-preset]');
      if (!btn) return;

      var preset = btn.getAttribute('data-preset');
      var now = Lex.Utils.nowDate();
      var from, to;

      if (preset === 'last7days') {
        to = LanaTime.toLocalDateInputValue(now);
        from = LanaTime.toLocalDateInputValue(LanaTime.addDays(now, -7));
      } else if (preset === 'last30days') {
        to = LanaTime.toLocalDateInputValue(now);
        from = LanaTime.toLocalDateInputValue(LanaTime.addDays(now, -30));
      } else if (preset === 'thisMonth') {
        from = LanaTime.toLocalDateInputValue(LanaTime.startOfLocalMonth(now));
        to = LanaTime.toLocalDateInputValue(now);
      } else if (preset === 'thisQuarter') {
        from = LanaTime.toLocalDateInputValue(LanaTime.startOfLocalQuarter(now));
        to = LanaTime.toLocalDateInputValue(now);
      }

      if (from && to) {
        _dateFrom = from;
        _dateTo = to;
        var fromInput = document.getElementById('bhAdminDateFrom');
        var toInput = document.getElementById('bhAdminDateTo');
        if (fromInput) fromInput.value = from;
        if (toInput) toInput.value = to;

        // Update active button styling
        var btns = container.querySelectorAll('[data-preset]');
        for (var i = 0; i < btns.length; i++) {
          btns[i].setAttribute('variant', btns[i] === btn ? 'primary' : 'secondary');
        }

        _loadAll();
      }
    });
  }

  function _wireApplyDates() {
    var applyBtn = document.getElementById('bhAdminApplyDates');
    if (!applyBtn) return;

    applyBtn.addEventListener('click', function () {
      var fromInput = document.getElementById('bhAdminDateFrom');
      var toInput = document.getElementById('bhAdminDateTo');
      _dateFrom = fromInput ? fromInput.value : '';
      _dateTo = toInput ? toInput.value : '';
      _loadAll();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Tabs
  // ═══════════════════════════════════════════════════════════════

  function _wireTabSwitching() {
    var tabBar = document.getElementById('bhAdminTabs');
    if (!tabBar) return;

    tabBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;

      _activeTab = btn.getAttribute('data-tab');

      // Update tab styles
      var tabs = tabBar.querySelectorAll('[data-tab]');
      for (var i = 0; i < tabs.length; i++) {
        var isActive = tabs[i] === btn;
        tabs[i].style.borderBottomColor = isActive ? 'var(--lex-color-blue-600,#2563eb)' : 'transparent';
        tabs[i].style.color = isActive ? 'var(--lex-color-blue-600,#2563eb)' : 'var(--lex-text-muted)';
      }

      // Show/hide content
      var containers = { attorneys: 'bhAdminTabAttorneys', matters: 'bhAdminTabMatters', approvals: 'bhAdminTabApprovals' };
      var keys = Object.keys(containers);
      for (var ci = 0; ci < keys.length; ci++) {
        var el = document.getElementById(containers[keys[ci]]);
        if (el) el.classList.toggle('hidden', keys[ci] !== _activeTab);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Load All
  // ═══════════════════════════════════════════════════════════════

  function _loadAll() {
    _loadSummary();
    _loadAttorneys();
    _loadMatters();
    _loadApprovalQueue();
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════

  function _loadSummary() {
    var container = document.getElementById('bhAdminSummary');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse" style="grid-column:1/-1;"><div class="cc-skeleton" style="height:3rem;width:100%;"></div></div>';

    var url = '/api/v1/billable-hours/admin/summary?';
    if (_dateFrom) url += 'date_from=' + encodeURIComponent(_dateFrom) + '&';
    if (_dateTo) url += 'date_to=' + encodeURIComponent(_dateTo);

    api.get(url)
      .then(function (result) {
        var d = (result && result.data) || {};
        var utilization = d.total_hours > 0 ? Math.round(d.billable_hours / d.total_hours * 100) : 0;

        var cards = [
          { label: 'Total Hours', value: (d.total_hours || 0).toFixed(1) + 'h', tone: '' },
          { label: 'Billable Hours', value: (d.billable_hours || 0).toFixed(1) + 'h', tone: '' },
          { label: 'Billable Amount', value: '$' + _formatMoney(d.billable_amount || 0), tone: '' },
          { label: 'Utilization', value: utilization + '%', tone: utilization >= 70 ? 'good' : 'warn' },
          { label: 'Attorneys', value: d.users_active || 0, tone: '' },
          { label: 'Matters Worked', value: d.matters_worked || 0, tone: '' },
          { label: 'Pending Approval', value: (d.by_status && d.by_status.submitted) || 0, tone: 'warn' },
          { label: 'Approved', value: (d.by_status && d.by_status.approved) || 0, tone: 'good' }
        ];

        var html = '';
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          html += '<div class="bh-admin-stat">';
          html += '<div class="bh-admin-stat__label">' + _escapeHtml(c.label) + '</div>';
          html += '<div class="bh-admin-stat__value' + (c.tone ? ' bh-admin-stat__value--' + c.tone : '') + '">' + c.value + '</div>';
          html += '</div>';
        }
        container.innerHTML = html;
      })
      .catch(function () {
        container.innerHTML = '<div style="color:var(--lex-text-muted);font-size:0.8rem;grid-column:1/-1;">Unable to load summary</div>';
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Tables (docs/TABLE-STANDARD.md)
  //
  // The three admin APIs page (page/limit + total) but cannot sort, search
  // or filter, so each table loads the whole set for the chosen period by
  // walking every page (no hidden cap) and sorts, searches and filters it in
  // the browser. Rows keep raw values; renderers format them.
  // ═══════════════════════════════════════════════════════════════

  // Largest page each API accepts (billable-hours.repository.js).
  var PAGE_SIZE = { attorneys: 100, matters: 100, approvals: 200 };

  var ENDPOINTS = {
    attorneys: '/api/v1/billable-hours/admin/by-attorney',
    matters: '/api/v1/billable-hours/admin/by-matter',
    approvals: '/api/v1/billable-hours/admin/approval-queue'
  };

  var TABLE_IDS = { attorneys: 'bhAttorneysTable', matters: 'bhMattersTable', approvals: 'bhApprovalsTable' };

  var HOUR_RANGES = [
    { value: '0-1', label: 'Under 1 hour' },
    { value: '1-10', label: '1 to 10 hours' },
    { value: '10-40', label: '10 to 40 hours' },
    { value: '40-', label: '40 hours or more' }
  ];

  var COUNT_RANGES = [
    { value: '0-1', label: 'None' },
    { value: '1-6', label: '1 to 5' },
    { value: '6-21', label: '6 to 20' },
    { value: '21-', label: 'More than 20' }
  ];

  var AMOUNT_RANGES = [
    { value: '0-1000', label: 'Under $1,000' },
    { value: '1000-10000', label: '$1,000 to $10,000' },
    { value: '10000-', label: '$10,000 or more' }
  ];

  var _loadSeq = { attorneys: 0, matters: 0, approvals: 0 };
  var _toolbars = {};

  function kit() {
    return window.AdminTableKit;
  }

  /**
   * One page of an admin list: the period plus page/limit.
   * @param {string} key - attorneys | matters | approvals
   * @param {number} page
   * @param {{ from: string, to: string }} period - YYYY-MM-DD bounds
   * @returns {string}
   */
  function listUrl(key, page, period) {
    var params = new URLSearchParams();
    params.set('page', String(page || 1));
    params.set('limit', String(PAGE_SIZE[key]));
    if (period && period.from) params.set('date_from', period.from);
    if (period && period.to) params.set('date_to', period.to);
    return ENDPOINTS[key] + '?' + params.toString();
  }

  /**
   * Every row of a paged admin list, page by page until the total is reached.
   * @returns {Promise<Array>}
   */
  function fetchAll(key, period, getter) {
    var get = getter || function (url) { return api.get(url); };
    var rows = [];
    function next(page) {
      return get(listUrl(key, page, period)).then(function (result) {
        var data = (result && Array.isArray(result.data)) ? result.data : [];
        rows = rows.concat(data);
        var pg = (result && result.pagination) || {};
        var total = Number(pg.total);
        var more = data.length >= PAGE_SIZE[key] && (!Number.isFinite(total) || rows.length < total);
        return more ? next(page + 1) : rows;
      });
    }
    return next(1);
  }

  // "min-max" range (min inclusive, max exclusive, either side open).
  function inRange(cell, range) {
    var parts = String(range || '').split('-');
    var n = Number(cell);
    if (!Number.isFinite(n)) return false;
    var min = parts[0] === '' ? -Infinity : Number(parts[0]);
    var max = parts[1] === '' || parts[1] === undefined ? Infinity : Number(parts[1]);
    return n >= min && n < max;
  }

  function rangeFilter(options) {
    return { single: true, options: options, match: function (cell, values) { return inRange(cell, values[0]); } };
  }

  function createdFilter() {
    var shared = window.LanaLibraryColumnFilters;
    return {
      single: true,
      options: shared ? shared.EDITED_RANGE_OPTIONS : [],
      match: function (cell, values) { return !!shared && shared.inEditedRange(cell, values[0]); }
    };
  }

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function personName(e) {
    return ((e.first_name || '') + ' ' + (e.last_name || '')).trim() || e.name || e.email || '';
  }

  // ── Rows: raw values, the record as _raw ─────────────────────────

  function attorneyRow(e) {
    return {
      user_id: String(e.user_id || e.email || ''),
      name: String(e.name || e.email || ''),
      email: String(e.email || ''),
      total_hours: num(e.total_hours),
      billable_hours: num(e.billable_hours),
      billable_amount: num(e.billable_amount),
      draft_count: num(e.draft_count),
      submitted_count: num(e.submitted_count),
      approved_count: num(e.approved_count),
      created_at: e.created_at || e.first_entry_at || '',
      pending: num(e.submitted_count) > 0 ? 'yes' : 'no',
      _raw: e
    };
  }

  function matterRow(e) {
    return {
      matter_id: String(e.matter_uuid || e.matter_id || ''),
      matter_name: String(e.matter_name || e.matter_id || ''),
      client_name: String(e.client_name || ''),
      attorneys: num(e.attorneys),
      total_hours: num(e.total_hours),
      billable_hours: num(e.billable_hours),
      billable_amount: num(e.billable_amount),
      created_at: e.created_at || e.first_entry_at || '',
      _raw: e
    };
  }

  function approvalRow(e) {
    return {
      id: String(e.id || ''),
      attorney: personName(e),
      matter_id: String(e.matter_uuid || e.matter_id || ''),
      matter: String(e.matter_name || e.matter_id || ''),
      duration_minutes: num(e.duration_minutes),
      activity_type: String(e.activity_type || ''),
      description: String(e.description || ''),
      start_time: e.start_time || '',
      created_at: e.created_at || '',
      actions: '',
      _raw: e
    };
  }

  // ── Renderers ────────────────────────────────────────────────────

  function textCell(value) {
    var k = kit();
    return value ? '<span class="admin-table-text" title="' + k.esc(value) + '">' + k.esc(value) + '</span>' : k.muted('');
  }

  function numberCell(value) {
    return '<span class="bh-num">' + kit().esc(String(num(value))) + '</span>';
  }

  function hoursCell(value, strong) {
    return '<span class="bh-num' + (strong ? ' bh-num--strong' : '') + '">' + num(value).toFixed(1) + 'h</span>';
  }

  function moneyCell(value) {
    return '<span class="bh-num">$' + kit().esc(_formatMoney(num(value))) + '</span>';
  }

  function typeLabel(value) {
    return value ? Lex.Utils.humanizeLabel(value) : '';
  }

  function attorneyRenderers() {
    var k = kit();
    return {
      name: function (val, row) { return k.nameCell(val || row.email); },
      email: textCell,
      total_hours: function (val) { return hoursCell(val); },
      billable_hours: function (val) { return hoursCell(val, true); },
      billable_amount: moneyCell,
      draft_count: numberCell,
      submitted_count: function (val) { return val > 0 ? k.badge(String(val), 'yellow') : numberCell(val); },
      approved_count: numberCell,
      created_at: function (val) { return k.timeCell(val); }
    };
  }

  function matterRenderers() {
    var k = kit();
    return {
      matter_name: function (val, row) { return k.matterLink(row.matter_id, val); },
      client_name: textCell,
      attorneys: numberCell,
      total_hours: function (val) { return hoursCell(val); },
      billable_hours: function (val) { return hoursCell(val, true); },
      billable_amount: moneyCell,
      created_at: function (val) { return k.timeCell(val); }
    };
  }

  function approvalRenderers() {
    var k = kit();
    return {
      attorney: function (val) { return k.nameCell(val); },
      matter: function (val, row) { return k.matterLink(row.matter_id, val); },
      duration_minutes: function (val) { return hoursCell(num(val) / 60, true); },
      activity_type: function (val) { return val ? k.badge(typeLabel(val), 'gray') : k.muted(''); },
      description: textCell,
      start_time: function (val) { return k.timeCell(val); },
      created_at: function (val) { return k.timeCell(val); },
      actions: function (val, row) {
        var id = k.esc(row.id);
        return '<div class="bh-row-actions">' +
          '<button type="button" class="bh-row-btn" data-bh-action="edit" data-id="' + id + '">Edit</button>' +
          '<button type="button" class="bh-row-btn" data-bh-action="history" data-id="' + id + '">History</button>' +
          '<button type="button" class="bh-row-btn bh-row-btn--approve" data-bh-action="approve" data-id="' + id + '">Approve</button>' +
          '</div>';
      }
    };
  }

  // ── Header filters: every column ─────────────────────────────────

  function attorneyFilters() {
    return {
      name: { text: true, placeholder: 'Attorney contains...' },
      email: { text: true, placeholder: 'Email contains...' },
      total_hours: rangeFilter(HOUR_RANGES),
      billable_hours: rangeFilter(HOUR_RANGES),
      billable_amount: rangeFilter(AMOUNT_RANGES),
      draft_count: rangeFilter(COUNT_RANGES),
      submitted_count: rangeFilter(COUNT_RANGES),
      approved_count: rangeFilter(COUNT_RANGES),
      created_at: createdFilter()
    };
  }

  function distinctOptions(rows, key, label) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function (row) {
      var v = row[key];
      if (v === '' || v === null || v === undefined || seen[v]) return;
      seen[v] = true;
      out.push({ value: String(v), label: label ? label(v) : String(v) });
    });
    return out.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function matterFilters() {
    return {
      matter_name: { text: true, placeholder: 'Matter contains...' },
      client_name: { text: true, placeholder: 'Client contains...' },
      attorneys: rangeFilter(COUNT_RANGES.slice(1)),
      total_hours: rangeFilter(HOUR_RANGES),
      billable_hours: rangeFilter(HOUR_RANGES),
      billable_amount: rangeFilter(AMOUNT_RANGES),
      created_at: createdFilter()
    };
  }

  function approvalFilters(rows) {
    var map = {
      attorney: { text: true, placeholder: 'Attorney contains...' },
      matter: { text: true, placeholder: 'Matter contains...' },
      duration_minutes: rangeFilter([
        { value: '0-30', label: 'Under 30 minutes' },
        { value: '30-120', label: '30 minutes to 2 hours' },
        { value: '120-', label: '2 hours or more' }
      ]),
      description: { text: true, placeholder: 'Description contains...' },
      start_time: createdFilter(),
      created_at: createdFilter()
    };
    var types = distinctOptions(rows, 'activity_type', typeLabel);
    if (types.length) map.activity_type = { options: types };
    return map;
  }

  // ── Wiring ───────────────────────────────────────────────────────

  function tableEl(key) {
    return document.getElementById(TABLE_IDS[key]);
  }

  function visibleCount(table, fallback) {
    return table && Array.isArray(table.filteredRows) ? table.filteredRows.length : fallback;
  }

  function _initTables() {
    if (!kit()) return;
    kit().whenTableReady().then(function () {
      _initTable('attorneys', {
        renderers: attorneyRenderers(), filters: attorneyFilters(),
        searchId: 'bhAttorneysSearch', sortId: 'bhAttorneysSort', orderId: 'bhAttorneysSortOrder',
        filterId: 'bhAttorneysPendingFilter', filterKey: 'pending',
        countIds: ['bhAttorneysCount', 'bhAttorneysSectionCount'], noun: ['attorney', 'attorneys']
      });
      _initTable('matters', {
        renderers: matterRenderers(), filters: matterFilters(),
        searchId: 'bhMattersSearch', sortId: 'bhMattersSort', orderId: 'bhMattersSortOrder',
        filterId: 'bhMattersClientFilter', filterKey: 'client_name',
        countIds: ['bhMattersCount', 'bhMattersSectionCount'], noun: ['matter', 'matters']
      });
      _initTable('approvals', {
        renderers: approvalRenderers(), filters: approvalFilters([]),
        searchId: 'bhApprovalsSearch', sortId: 'bhApprovalsSort', orderId: 'bhApprovalsSortOrder',
        filterId: 'bhApprovalsTypeFilter', filterKey: 'activity_type',
        countIds: ['bhApprovalsCount', 'bhApprovalsSectionCount'], noun: ['entry', 'entries']
      });
      _wireApprovalTable();
      _loadAttorneys();
      _loadMatters();
      _loadApprovalQueue();
    });
  }

  function _initTable(key, config) {
    var table = tableEl(key);
    if (!table || table._bhReady) return;
    table._bhReady = true;
    table.setCellRenderers(config.renderers);
    table.setColumnFilterOptions(config.filters);
    var toolbar = kit().bindToolbar({
      table: table,
      searchId: config.searchId,
      sortId: config.sortId,
      orderId: config.orderId,
      filterId: config.filterId,
      filterKey: config.filterKey,
      countIds: config.countIds,
      noun: config.noun
    });
    function recount() {
      var rows = table._bhRows || [];
      toolbar.setCount(visibleCount(table, rows.length));
      var filtered = Boolean(table.searchText) || (typeof table.getActiveFilters === 'function' && Object.keys(table.getActiveFilters() || {}).length > 0);
      table.emptyText = kit().emptyText(filtered, key === 'approvals' ? 'entries pending approval' : 'billable hours for this period');
    }
    // Registered after bindToolbar's own listeners, so these counts win.
    table.addEventListener('lex-filter-change', function (e) { if (e.target === table) recount(); });
    table.addEventListener('lex-data-loaded', function (e) { if (e.target === table) recount(); });
    _toolbars[key] = { toolbar: toolbar, recount: recount };
  }

  function _setRows(key, rows) {
    var table = tableEl(key);
    if (!table || typeof table.setData !== 'function') return;
    table._bhRows = rows;
    if (key === 'matters') _setFilterSelect('bhMattersClientFilter', distinctOptions(rows, 'client_name'));
    if (key === 'approvals') {
      var types = distinctOptions(rows, 'activity_type', typeLabel);
      _setFilterSelect('bhApprovalsTypeFilter', types);
      table.setColumnFilterOptions(approvalFilters(rows));
      if (typeof table.deselectAll === 'function') table.deselectAll();
    }
    table.setData(rows);
    if (_toolbars[key]) _toolbars[key].recount();
  }

  // The main toolbar filter's options come from the loaded rows.
  function _setFilterSelect(id, options) {
    var select = document.getElementById(id);
    if (!select) return;
    var current = select.value || 'all';
    var list = [{ value: 'all', label: 'All' }].concat(options);
    select.options = list;
    var stillThere = list.some(function (o) { return o.value === current; });
    select.value = stillThere ? current : 'all';
  }

  function _loadTable(key, mapRow, errorText) {
    var table = tableEl(key);
    var seq = ++_loadSeq[key];
    return fetchAll(key, { from: _dateFrom, to: _dateTo })
      .then(function (entries) {
        if (seq !== _loadSeq[key]) return;
        _setRows(key, entries.map(mapRow));
      })
      .catch(function (err) {
        if (seq !== _loadSeq[key] || !table) return;
        console.error('[billable-hours] ' + key + ' load failed:', err);
        if (_toolbars[key]) _toolbars[key].toolbar.setCount(null);
        if (typeof table.setError === 'function') table.setError(errorText);
        else table.setServerError(errorText);
      });
  }

  function _loadAttorneys() {
    return _loadTable('attorneys', attorneyRow, 'Attorney hours could not be loaded. Check your connection and try again.');
  }

  function _loadMatters() {
    return _loadTable('matters', matterRow, 'Matter hours could not be loaded. Check your connection and try again.');
  }

  function _loadApprovalQueue() {
    return _loadTable('approvals', approvalRow, 'The approval queue could not be loaded. Check your connection and try again.');
  }

  function _approvalEntry(id) {
    var table = tableEl('approvals');
    var rows = (table && table._bhRows) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) return rows[i]._raw;
    }
    return null;
  }

  function _wireApprovalTable() {
    var table = tableEl('approvals');
    if (!table || table._bhWired) return;
    table._bhWired = true;

    // Row action buttons (lex-table's row-click ignores buttons).
    table.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-bh-action]') : null;
      if (!btn) return;
      e.stopPropagation();
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-bh-action');
      if (action === 'approve') _approveOne(id, btn);
      else if (action === 'edit') {
        var entry = _approvalEntry(id);
        if (entry) _openAdminEditDrawer(entry);
      } else if (action === 'history') _openAdminHistoryDrawer(id);
    });

    // Row click opens the edit drawer.
    table.addEventListener('row-click', function (e) {
      var row = e.detail && e.detail.row;
      if (row && row._raw) _openAdminEditDrawer(row._raw);
    });

    table.addEventListener('bulk-action', function (e) {
      if (!e.detail || e.detail.action !== 'approve') return;
      var ids = (e.detail.items || []).map(function (row) { return row.id; }).filter(Boolean);
      _bulkApprove(ids);
    });
  }

  function _approveOne(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Approving...'; }
    api.post('/api/v1/billable-hours/admin/approve/' + id)
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry approved');
        _loadApprovalQueue();
        _loadSummary();
        _loadAttorneys();
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to approve');
        if (btn) { btn.disabled = false; btn.textContent = 'Approve'; }
      });
  }

  // The bulk endpoint takes at most 100 ids per call.
  function _bulkApprove(ids) {
    if (!ids.length) return;
    var chunks = [];
    for (var i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    var approved = 0;
    var failed = 0;
    chunks.reduce(function (p, chunk) {
      return p.then(function () {
        return api.post('/api/v1/billable-hours/admin/bulk-approve', { ids: chunk })
          .then(function (result) {
            var data = (result && result.data) || {};
            approved += data.approved || 0;
            failed += data.failed || 0;
          })
          .catch(function () { failed += chunk.length; });
      });
    }, Promise.resolve()).then(function () {
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        if (failed > 0 && approved === 0) Lex.Toast.error('Bulk approve failed');
        else if (failed > 0) Lex.Toast.warning(approved + ' approved, ' + failed + ' skipped (already processed or error)');
        else Lex.Toast.success(approved + ' ' + (approved === 1 ? 'entry' : 'entries') + ' approved');
      }
      _loadApprovalQueue();
      _loadSummary();
      _loadAttorneys();
    });
  }

  // Pure table logic, exposed for unit tests.
  window.BillableHoursAdminTables = {
    listUrl: listUrl,
    fetchAll: fetchAll,
    inRange: inRange,
    attorneyRow: attorneyRow,
    matterRow: matterRow,
    approvalRow: approvalRow,
    attorneyRenderers: attorneyRenderers,
    matterRenderers: matterRenderers,
    approvalRenderers: approvalRenderers,
    attorneyFilters: attorneyFilters,
    matterFilters: matterFilters,
    approvalFilters: approvalFilters,
    PAGE_SIZE: PAGE_SIZE
  };

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function _escapeHtml(text) {
    if (!text) return '';
    if (typeof Lex !== 'undefined' && Lex.Utils && Lex.Utils.escapeHtml) {
      return Lex.Utils.escapeHtml(text);
    }
    var str = String(text);
    var result = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '&') result += '&amp;';
      else if (ch === '<') result += '&lt;';
      else if (ch === '>') result += '&gt;';
      else if (ch === '"') result += '&quot;';
      else result += ch;
    }
    return result;
  }

  function _formatMoney(amount) {
    if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ═══════════════════════════════════════════════════════════════
  // Admin Edit & History Drawers
  // ═══════════════════════════════════════════════════════════════

  function _openAdminEditDrawer(entry) {
    var hours = ((entry.duration_minutes || 0) / 60).toFixed(2);
    var rate = entry.hourly_rate != null ? String(entry.hourly_rate) : '';
    var desc = entry.description || '';

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">Editing <strong>' + _escapeHtml(((entry.first_name || '') + ' ' + (entry.last_name || '')).trim() || entry.email || entry.user_id) + '</strong>’s entry on <strong>' + _escapeHtml(entry.matter_name || entry.matter_id) + '</strong>. This action is audited.</div>';

    html += '<div><div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Description</div>';
    html += '<textarea id="bhAdminEditDescription" style="width:100%;min-height:4rem;padding:0.5rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.875rem;font-family:inherit;resize:vertical;">' + _escapeHtml(desc) + '</textarea></div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    html += '<div><div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Hours</div>';
    html += '<input type="number" id="bhAdminEditHours" value="' + _escapeHtml(hours) + '" step="0.1" min="0.1" max="24" style="width:100%;padding:0.375rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;font-size:0.875rem;"></div>';
    html += '<div><div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Rate ($/hr)</div>';
    html += '<input type="number" id="bhAdminEditRate" value="' + _escapeHtml(rate) + '" step="0.01" min="0" placeholder="0.00" style="width:100%;padding:0.375rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;font-size:0.875rem;"></div>';
    html += '</div>';

    if (entry.status === 'approved') {
      html += '<div style="padding:0.5rem 0.75rem;background:var(--lex-color-amber-50,#fffbeb);color:var(--lex-color-amber-800,#92400e);border:1px solid var(--lex-color-amber-200,#fde68a);border-radius:0.375rem;font-size:0.75rem;">This entry is already approved. Changes will be logged as a post-approval correction for payroll and finance.</div>';
    }

    html += '</div>';

    Lex.Drawer.open({
      heading: 'Edit time entry',
      content: html,
      width: 'md',
      buttons: [{ label: 'Save changes', variant: 'primary', id: 'bhAdminEditSaveBtn' }]
    });

    setTimeout(function () {
      var saveBtn = document.getElementById('bhAdminEditSaveBtn');
      if (!saveBtn) return;
      saveBtn.addEventListener('click', function () {
        var updates = {};
        var descEl = document.getElementById('bhAdminEditDescription');
        var hoursEl = document.getElementById('bhAdminEditHours');
        var rateEl = document.getElementById('bhAdminEditRate');
        if (descEl && descEl.value !== (entry.description || '')) updates.description = descEl.value;
        if (hoursEl) {
          var newMinutes = Math.round(parseFloat(hoursEl.value) * 60);
          if (newMinutes > 0 && newMinutes !== entry.duration_minutes) {
            updates.duration_minutes = newMinutes;
          }
        }
        if (rateEl) {
          var raw = rateEl.value;
          if (raw === '' || raw === null) {
            if (entry.hourly_rate != null) updates.hourly_rate = null;
          } else {
            var num = parseFloat(raw);
            if (!isNaN(num) && num >= 0 && num !== parseFloat(entry.hourly_rate)) {
              updates.hourly_rate = num;
            }
          }
        }

        if (Object.keys(updates).length === 0) {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.info('No changes to save');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        api.patch('/api/v1/billable-hours/admin/entries/' + entry.id, updates)
          .then(function () {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry updated');
            if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
            _loadApprovalQueue();
            _loadSummary();
            _loadAttorneys();
            _loadMatters();
          })
          .catch(function (err) {
            var msg = (err && err.message) || 'Failed to update entry';
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save changes';
          });
      });
    }, 50);
  }

  function _openAdminHistoryDrawer(entryId) {
    api.get('/api/v1/billable-hours/entries/' + entryId + '/history')
      .then(function (resp) {
        var rows = (resp && resp.data) || [];
        var html = '<div style="display:flex;flex-direction:column;gap:0.75rem;">';
        if (rows.length === 0) {
          html += '<div style="font-size:0.875rem;color:var(--lex-text-muted);padding:1rem;text-align:center;">No edits recorded for this entry yet.</div>';
        } else {
          for (var i = 0; i < rows.length; i++) {
            html += _renderAdminHistoryRow(rows[i]);
          }
        }
        html += '</div>';
        Lex.Drawer.open({ heading: 'Edit history', content: html, width: 'md', buttons: [] });
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to load edit history');
      });
  }

  function _renderAdminHistoryRow(row) {
    var details = row.details || {};
    var diff = details.diff || {};
    var when = row.created_at ? (typeof Lex !== 'undefined' && Lex.Utils ? Lex.Utils.formatDateTime(row.created_at) : row.created_at) : '-';
    var actor = (row.first_name || row.last_name) ? ((row.first_name || '') + ' ' + (row.last_name || '')).trim() : (row.email || row.user_id || 'Unknown');
    var roleLabel = details.actor_role === 'admin' ? 'Admin' : 'Owner';
    var flag = details.post_approval_edit ? ' <span style="font-size:0.7rem;color:var(--lex-color-amber-700,#b45309);font-weight:600;">[post-approval]</span>' : '';

    var html = '<div style="border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;padding:0.75rem;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--lex-text-primary);">' + _escapeHtml(actor) + ' <span style="font-size:0.7rem;color:var(--lex-text-muted);font-weight:400;">(' + roleLabel + ')</span>' + flag + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">' + _escapeHtml(when) + '</div>';
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
        html += '<span style="font-weight:600;color:var(--lex-text-primary);">' + _escapeHtml(key) + ':</span> ';
        html += '<span style="color:var(--lex-text-muted);text-decoration:line-through;">' + _escapeHtml(before) + '</span> ';
        html += '<span style="color:var(--lex-text-muted);">→</span> ';
        html += '<span style="color:var(--lex-color-blue-700,#1d4ed8);">' + _escapeHtml(after) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  // Boot
  // ═══════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
