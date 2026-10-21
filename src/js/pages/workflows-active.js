/**
 * Active Workflows — page controller (workflows/active.html).
 *
 * One client-side lex-table on the table standard (docs/TABLE-STANDARD.md):
 * toolbar search / Sort by / order / Status filter / count, raw rows,
 * renderers, a header filter on every data column, row actions as buttons,
 * and the details panel as a lex-drawer.
 *
 * Data: Workflows.getAll() (js/workflows.js). Its API call is commented out
 * today, so it returns { workflows: [] } and the table shows its empty state.
 * The whole set arrives in one call, so the table pages it client-side.
 * Rows accept both the demo shape (camelCase, trigger.type) and the chef
 * GET /api/v1/workflows shape (snake_case, trigger_type).
 *
 * Runs on a full page load and on SPA navigation (LexRouter.registerPageInit).
 *
 * @requires workflows.js            - window.Workflows
 * @requires lex-table.js            - client-side table (setData, setError, filteredRows)
 * @requires admin-table-kit.js      - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range options and matching
 */

(function () {
  'use strict';

  var PAGE = 'workflows/active.html';
  var TABLE_ID = 'activeWorkflowsTable';

  var STATUSES = ['active', 'paused', 'draft', 'archived', 'error'];
  var STATUS_COLORS = { active: 'green', paused: 'yellow', error: 'red', draft: 'gray', archived: 'gray' };
  var TRIGGERS = ['manual', 'scheduled', 'event'];
  // The demo data says "schedule"; the workflows API says "scheduled".
  var TRIGGER_ALIASES = { schedule: 'scheduled' };

  var RUN_RANGES = [
    { value: 'none', label: 'No runs', min: 0, max: 1 },
    { value: '1-9', label: '1–9', min: 1, max: 10 },
    { value: '10-99', label: '10–99', min: 10, max: 100 },
    { value: '100+', label: '100 or more', min: 100, max: Infinity }
  ];

  var SUCCESS_RANGES = [
    { value: 'high', label: '90% or more', min: 90, max: Infinity },
    { value: 'mid', label: '70–89%', min: 70, max: 90 },
    { value: 'low', label: 'Under 70%', min: -Infinity, max: 70 }
  ];

  var _rows = [];
  var _toolbar = null;
  var _loadGen = 0;
  var _refreshBound = false;

  function kit() { return window.AdminTableKit; }

  function num(value) {
    var n = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;
  }

  // ── Pure table logic (exposed for unit tests) ──────────────────────────

  /**
   * One table row per workflow: raw values, the record as _raw.
   * @param {Object} w
   * @returns {Object}
   */
  function mapWorkflow(w) {
    var src = w || {};
    var trigger = String(src.trigger_type || (src.trigger && src.trigger.type) || 'manual').toLowerCase();
    return {
      id: String(src.id || ''),
      name: String(src.name || ''),
      description: String(src.description || ''),
      status: String(src.status || 'draft').toLowerCase(),
      trigger_type: TRIGGER_ALIASES[trigger] || trigger,
      executions: num(src.executionCount !== undefined ? src.executionCount : src.execution_count),
      success_rate: num(src.successRate !== undefined ? src.successRate : src.success_rate),
      last_run: src.lastRun || src.last_run || '',
      next_run: src.nextRun || src.next_run || '',
      error_message: String(src.errorMessage || src.error_message || ''),
      created_at: src.createdAt || src.created_at || '',
      actions: '',
      _raw: src
    };
  }

  function inRange(ranges, value, selected) {
    if (value === null || value === undefined) return false;
    var range = ranges.filter(function (r) { return r.value === selected; })[0];
    return !range || (value >= range.min && value < range.max);
  }

  function dateMatch(cell, values) {
    var shared = window.LanaLibraryColumnFilters;
    return !shared || shared.inEditedRange(cell, values[0]);
  }

  /** Header filters: every data column (the actions column has a blank label). */
  function filterOptions() {
    var k = kit();
    var dates = k.dateRangeFilter();
    return {
      name: { text: true, placeholder: 'Workflow name contains...' },
      status: { options: k.labelOptions(STATUSES) },
      trigger_type: { options: k.labelOptions(TRIGGERS) },
      executions: {
        single: true,
        options: RUN_RANGES.map(function (r) { return { value: r.value, label: r.label }; }),
        match: function (cell, values) { return inRange(RUN_RANGES, cell, values[0]); }
      },
      success_rate: {
        single: true,
        options: SUCCESS_RANGES.map(function (r) { return { value: r.value, label: r.label }; }),
        match: function (cell, values) { return inRange(SUCCESS_RANGES, cell, values[0]); }
      },
      last_run: { single: true, options: dates.options, match: dateMatch },
      created_at: { single: true, options: dates.options, match: dateMatch }
    };
  }

  function actionButton(action, id, label) {
    var k = kit();
    var danger = action === 'delete' ? ' workflows-active-action--danger' : '';
    return '<button type="button" class="workflows-active-action' + danger + '" data-workflow-action="' + action +
      '" data-workflow-id="' + k.esc(id) + '">' + k.esc(label) + '</button>';
  }

  function cellRenderers() {
    var k = kit();
    return {
      name: function (val, row) { return k.nameCell(val, row.description); },
      status: function (val) {
        var key = String(val || '').toLowerCase();
        return k.badge(k.capitalize(key), STATUS_COLORS[key] || 'gray');
      },
      trigger_type: function (val) {
        return val ? '<span class="admin-table-text">' + k.esc(k.capitalize(val)) + '</span>' : k.muted('');
      },
      executions: function (val) {
        return val === null || val === undefined ? k.muted('') : '<span class="admin-table-text">' + k.esc(String(val)) + '</span>';
      },
      success_rate: function (val) {
        return val === null || val === undefined ? k.muted('') : '<span class="admin-table-text">' + k.esc(val.toFixed(1)) + '%</span>';
      },
      last_run: function (val) { return val ? k.relativeCell(val) : k.muted('Never'); },
      created_at: function (val) { return k.timeCell(val); },
      actions: function (val, row) {
        if (!row.id) return k.muted('');
        return '<div class="workflows-active-actions">' +
          actionButton('toggle', row.id, row.status === 'active' ? 'Pause' : 'Activate') +
          actionButton('run', row.id, 'Run now') +
          actionButton('delete', row.id, 'Delete') +
          '</div>';
      }
    };
  }

  /** Lex.Nav params this page accepts (lex-nav.js: id, status). */
  function readParams(params) {
    var status = params ? String(params.get('status') || '').toLowerCase() : '';
    return {
      id: params ? String(params.get('id') || '') : '',
      status: STATUSES.indexOf(status) !== -1 ? status : ''
    };
  }

  window.WorkflowsActiveTable = {
    mapWorkflow: mapWorkflow,
    filterOptions: filterOptions,
    cellRenderers: cellRenderers,
    readParams: readParams,
    STATUSES: STATUSES,
    RUN_RANGES: RUN_RANGES,
    SUCCESS_RANGES: SUCCESS_RANGES
  };

  // ── Page wiring (browser) ──────────────────────────────────────────────

  function table() { return document.getElementById(TABLE_ID); }

  function toast(kind, message) {
    if (window.Lex && Lex.Toast && typeof Lex.Toast[kind] === 'function') Lex.Toast[kind](message);
    else if (window.Toast && typeof window.Toast[kind] === 'function') window.Toast[kind](message);
  }

  function findRow(id) {
    return _rows.filter(function (r) { return r.id === id; })[0] || null;
  }

  function refreshCount() {
    var t = table();
    if (!_toolbar || !t) return;
    var rows = t.filteredRows;
    _toolbar.setCount(Array.isArray(rows) ? rows.length : _rows.length);
  }

  function updateEmptyText() {
    var t = table();
    if (!t) return;
    var filtered = Boolean(t.searchText) || Boolean(typeof t.getActiveFilters === 'function' && t.getActiveFilters().size);
    t.emptyText = kit().emptyText(filtered, 'workflows');
  }

  function loadWorkflows(afterLoad) {
    var t = table();
    if (!t || !window.Workflows) return Promise.resolve();
    var gen = ++_loadGen;
    return Promise.resolve()
      .then(function () { return window.Workflows.getAll(); })
      .then(function (data) {
        if (gen !== _loadGen || table() !== t) return;
        var list = data && Array.isArray(data.workflows) ? data.workflows : [];
        _rows = list.map(mapWorkflow);
        updateEmptyText();
        t.setData(_rows);
        refreshCount();
        if (typeof afterLoad === 'function') afterLoad();
      })
      .catch(function (err) {
        if (gen !== _loadGen) return;
        console.error('[workflows-active] load failed:', err);
        if (_toolbar) _toolbar.setCount(null);
        var message = 'Workflows could not be loaded. Check your connection and try again.';
        if (typeof t.setError === 'function') t.setError(message);
        else { t.emptyText = message; t.setData([]); }
      });
  }

  function toggleWorkflow(row) {
    var enabled = row.status !== 'active';
    return window.Workflows.toggle(row.id, enabled)
      .then(function () {
        toast('success', 'Workflow ' + (enabled ? 'activated' : 'paused'));
        return loadWorkflows();
      })
      .catch(function () { toast('error', 'Failed to update workflow'); });
  }

  function runWorkflow(row) {
    toast('info', 'Running workflow...');
    return window.Workflows.execute(row.id)
      .then(function (result) {
        var processed = result && result.recordsProcessed;
        toast('success', processed !== undefined ? 'Workflow completed. Processed ' + processed + ' records.' : 'Workflow started.');
        return loadWorkflows();
      })
      .catch(function () { toast('error', 'Workflow execution failed'); });
  }

  function deleteWorkflow(row, onDone) {
    Lex.Modal.confirm(
      'Delete workflow?',
      'Are you sure you want to delete this workflow? This action cannot be undone.',
      function () {
        window.Workflows.delete(row.id)
          .then(function () {
            toast('success', 'Workflow deleted');
            if (typeof onDone === 'function') onDone();
            return loadWorkflows();
          })
          .catch(function () { toast('error', 'Failed to delete workflow'); });
      },
      { variant: 'danger', confirmText: 'Delete' }
    );
  }

  function runAction(action, row, onDone) {
    if (!row) return;
    if (action === 'toggle') toggleWorkflow(row).then(onDone);
    else if (action === 'run') runWorkflow(row).then(onDone);
    else if (action === 'delete') deleteWorkflow(row, onDone);
  }

  function detailRow(label, html) {
    return '<div class="flex items-center justify-between py-3 border-b" style="border-color: var(--lex-border-default)">' +
      '<span class="text-sm" style="color: var(--lex-text-secondary)">' + kit().esc(label) + '</span>' +
      '<span class="text-sm font-medium" style="color: var(--lex-text-primary)">' + html + '</span></div>';
  }

  function showDetails(row) {
    if (!row || !window.Lex || !Lex.Drawer) return;
    var k = kit();
    var r = cellRenderers();
    var fmt = Lex.Utils.formatDateTime;
    var content = '<div class="workflows-active-details">' +
      detailRow('Status', r.status(row.status)) +
      detailRow('Trigger', k.esc(k.capitalize(row.trigger_type))) +
      detailRow('Runs', row.executions === null ? '—' : k.esc(String(row.executions))) +
      detailRow('Success rate', row.success_rate === null ? '—' : k.esc(row.success_rate.toFixed(1)) + '%') +
      detailRow('Last run', row.last_run ? k.esc(fmt(row.last_run)) : 'Never') +
      detailRow('Next scheduled run', row.next_run ? k.esc(fmt(row.next_run)) : 'Not scheduled') +
      detailRow('Created', row.created_at ? k.esc(fmt(row.created_at)) : '—') +
      (row.error_message
        ? '<div class="mt-4 p-4 rounded-lg" style="background: var(--lex-danger-bg, #fef2f2); color: var(--lex-danger, #b91c1c)">' +
          '<p class="text-sm font-medium">Error message</p><p class="text-sm mt-1">' + k.esc(row.error_message) + '</p></div>'
        : '') +
      '</div>';
    var drawer = Lex.Drawer.open({
      heading: row.name || 'Workflow',
      subtitle: row.description,
      width: 'md',
      content: content,
      buttons: [
        { id: 'workflowDrawerToggle', label: row.status === 'active' ? 'Pause workflow' : 'Activate workflow', variant: 'primary' },
        { id: 'workflowDrawerRun', label: 'Run now', variant: 'secondary' },
        { id: 'workflowDrawerDelete', label: 'Delete', variant: 'danger' }
      ]
    });
    var close = function () { if (drawer && drawer.isConnected) Lex.Drawer.close(); };
    [['workflowDrawerToggle', 'toggle'], ['workflowDrawerRun', 'run'], ['workflowDrawerDelete', 'delete']].forEach(function (pair) {
      var button = drawer.querySelector('#' + pair[0]);
      if (button) button.addEventListener('click', function () { runAction(pair[1], row, close); });
    });
  }

  function init() {
    var t = table();
    if (!t) return;
    var params = readParams(window.Lex && Lex.Nav && Lex.Nav.getParams ? Lex.Nav.getParams() : null);
    kit().whenTableReady().then(function () {
      if (table() !== t) return;
      t.setCellRenderers(cellRenderers());
      t.setColumnFilterOptions(filterOptions());
      t.setData([]);
      _toolbar = kit().bindToolbar({
        table: t,
        searchId: 'activeWorkflowsSearch',
        sortId: 'activeWorkflowsSort',
        orderId: 'activeWorkflowsSortOrder',
        filterId: 'activeWorkflowsStatusFilter',
        filterKey: 'status',
        countIds: ['activeWorkflowsCount', 'activeWorkflowsSectionCount'],
        noun: ['workflow', 'workflows']
      });
      // Client-side counts: every matching row across pages (after the kit's own listeners).
      ['lex-filter-change', 'lex-data-loaded'].forEach(function (name) {
        t.addEventListener(name, function (e) {
          if (e.target !== t) return;
          updateEmptyText();
          refreshCount();
        });
      });
      t.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) showDetails(findRow(row.id) || row);
      });
      t.addEventListener('click', function (e) {
        var button = e.target && e.target.closest ? e.target.closest('[data-workflow-action]') : null;
        if (!button || !t.contains(button)) return;
        e.stopPropagation();
        runAction(button.getAttribute('data-workflow-action'), findRow(button.getAttribute('data-workflow-id')));
      });
      if (!_refreshBound) {
        _refreshBound = true;
        document.addEventListener('lex-refresh', function (e) {
          if (!table()) return;
          e.preventDefault();
          loadWorkflows();
        });
      }
      loadWorkflows(function () {
        if (params.status) {
          t.addFilter('status', 'in', [params.status]);
          var select = document.getElementById('activeWorkflowsStatusFilter');
          if (select) select.value = params.status;
          refreshCount();
        }
        if (params.id) showDetails(findRow(params.id));
      });
    });
  }

  if (window.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit(PAGE, init);
  }
  init();
})();
