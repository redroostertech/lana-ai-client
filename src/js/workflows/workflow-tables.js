/**
 * workflow-tables.js
 * The lex-table pieces of the Workflows pages (dashboard, execution logs,
 * retargeting), per docs/TABLE-STANDARD.md: the workflows list query
 * mapping, row mappers that keep raw values, status/trigger/platform label
 * maps, cell renderers and the column filter configs.
 *
 * Cell markup and the toolbar wiring come from AdminTableKit
 * (js/admin/admin-table-kit.js), shared with the admin list tables.
 *
 * Public API (window.WorkflowTables, or module.exports in Node):
 *   - workflowsParams(query, search, now)   -> URLSearchParams for GET /api/v1/workflows
 *   - mapWorkflow(raw), mapExecution(raw), mapAudience(raw)
 *   - workflowRenderers(), executionRenderers(), audienceRenderers()
 *   - workflowFilterOptions(), executionFilterOptions(), audienceFilterOptions()
 *   - formatDuration(ms), syncState(audience)
 *   - WORKFLOW_STATUS_OPTIONS, TRIGGER_OPTIONS, EXECUTION_STATUS_OPTIONS,
 *     PLATFORM_OPTIONS, SYNC_STATE_OPTIONS, RECORD_RANGES, DURATION_RANGES, SIZE_RANGES
 */

(function (global) {
  'use strict';

  function kit() {
    if (global && global.AdminTableKit) return global.AdminTableKit;
    if (typeof require === 'function') {
      try { return require('../admin/admin-table-kit.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function ranges() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('../shared/library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Label maps (capital first letter) and badge colours
  // ---------------------------------------------------------------------------

  // workflows.status in chef: draft | active | paused | archived ('error' is
  // kept for older demo data).
  var WORKFLOW_STATUS = {
    draft:    { label: 'Draft', color: 'gray' },
    active:   { label: 'Active', color: 'green' },
    paused:   { label: 'Paused', color: 'yellow' },
    archived: { label: 'Archived', color: 'gray' },
    error:    { label: 'Error', color: 'red' }
  };

  // workflows.trigger_type in chef: manual | scheduled | event.
  var TRIGGERS = {
    manual:    { label: 'Manual', color: 'gray' },
    scheduled: { label: 'Scheduled', color: 'blue' },
    schedule:  { label: 'Scheduled', color: 'blue' },
    event:     { label: 'Event', color: 'purple' }
  };

  var EXECUTION_STATUS = {
    success: { label: 'Success', color: 'green' },
    error:   { label: 'Failed', color: 'red' },
    failed:  { label: 'Failed', color: 'red' },
    running: { label: 'Running', color: 'blue' }
  };

  var PLATFORMS = {
    facebook: { label: 'Facebook', color: 'blue' },
    google:   { label: 'Google', color: 'red' }
  };

  var SYNC_STATES = {
    active:   { label: 'Active', color: 'green' },
    never:    { label: 'Never synced', color: 'yellow' },
    disabled: { label: 'Disabled', color: 'gray' }
  };

  function optionsOf(map, keys) {
    return keys.map(function (key) { return { value: key, label: map[key].label }; });
  }

  var WORKFLOW_STATUS_OPTIONS = optionsOf(WORKFLOW_STATUS, ['draft', 'active', 'paused', 'archived']);
  var TRIGGER_OPTIONS = optionsOf(TRIGGERS, ['manual', 'scheduled', 'event']);
  var EXECUTION_STATUS_OPTIONS = optionsOf(EXECUTION_STATUS, ['success', 'error', 'running']);
  var PLATFORM_OPTIONS = optionsOf(PLATFORMS, ['facebook', 'google']);
  var SYNC_STATE_OPTIONS = optionsOf(SYNC_STATES, ['active', 'never', 'disabled']);

  // Number ranges: min inclusive, max exclusive.
  var RECORD_RANGES = [
    { value: '0', label: 'None', min: 0, max: 1 },
    { value: '1-10', label: '1 to 9', min: 1, max: 10 },
    { value: '10-100', label: '10 to 99', min: 10, max: 100 },
    { value: '100+', label: '100 or more', min: 100, max: null }
  ];
  var DURATION_RANGES = [
    { value: 'lt1s', label: 'Under 1 second', min: 0, max: 1000 },
    { value: '1-10s', label: '1 to 10 seconds', min: 1000, max: 10000 },
    { value: '10-60s', label: '10 to 60 seconds', min: 10000, max: 60000 },
    { value: '1m+', label: 'Over 1 minute', min: 60000, max: null }
  ];
  var SIZE_RANGES = [
    { value: 'lt100', label: 'Under 100', min: 0, max: 100 },
    { value: '100-1000', label: '100 to 999', min: 100, max: 1000 },
    { value: '1000-10000', label: '1,000 to 9,999', min: 1000, max: 10000 },
    { value: '10000+', label: '10,000 or more', min: 10000, max: null }
  ];

  function inNumberRange(rangeList, cell, value) {
    var range = rangeList.filter(function (r) { return r.value === value; })[0];
    var n = Number(cell);
    if (!range || cell === null || cell === undefined || cell === '' || !Number.isFinite(n)) return false;
    return n >= range.min && (range.max === null || n < range.max);
  }

  function numberFilter(rangeList) {
    return {
      single: true,
      options: rangeList.map(function (r) { return { value: r.value, label: r.label }; }),
      match: function (cell, values) { return inNumberRange(rangeList, cell, values[0]); }
    };
  }

  function dateFilter() {
    var shared = ranges();
    return {
      single: true,
      options: shared ? shared.EDITED_RANGE_OPTIONS : [],
      match: function (cell, values) { return shared ? shared.inEditedRange(cell, values[0]) : true; }
    };
  }

  // ---------------------------------------------------------------------------
  // Workflows list query (GET /api/v1/workflows: limit, offset, status,
  // triggerType, search, sortBy, sortOrder)
  // ---------------------------------------------------------------------------

  var WORKFLOW_SORT = {
    name: 'name',
    status: 'status',
    trigger_type: 'trigger_type',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  /**
   * Query params for a server-paged workflows table. The API takes one
   * status and one trigger type, matches search against name + description,
   * and does not filter dates yet: name / created_* / updated_* are sent for
   * it to read once it supports them.
   */
  function workflowsParams(query, search, now) {
    var k = kit();
    var q = query || {};
    var filters = q.filters || {};
    var paging = k.pageOffset(q);
    var params = new URLSearchParams();
    params.set('limit', String(paging.limit));
    params.set('offset', String(paging.offset));
    params.set('sortBy', WORKFLOW_SORT[q.sortBy] || 'updated_at');
    params.set('sortOrder', q.sortDir === 'asc' ? 'ASC' : 'DESC');

    var status = k.firstFilterValue(filters, 'status');
    if (status) params.set('status', status);
    var trigger = k.firstFilterValue(filters, 'trigger_type');
    if (trigger) params.set('triggerType', trigger);

    var name = k.firstFilterValue(filters, 'name');
    var term = String(search || '').trim();
    if (term || name) params.set('search', term || name);
    if (name) params.set('name', name);

    k.setRange(params, filters, 'created_at', 'created_after', 'created_before', now);
    k.setRange(params, filters, 'updated_at', 'updated_after', 'updated_before', now);
    return params;
  }

  function str(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function triggerOf(raw) {
    var trigger = raw.trigger_type || raw.triggerType || raw.trigger;
    if (trigger && typeof trigger === 'object') trigger = trigger.type;
    trigger = str(trigger).toLowerCase();
    return trigger === 'schedule' ? 'scheduled' : trigger;
  }

  function mapWorkflow(raw) {
    var w = raw || {};
    return {
      id: str(w.id),
      name: str(w.name),
      description: str(w.description),
      status: str(w.status).toLowerCase(),
      trigger_type: triggerOf(w),
      updated_at: w.updated_at || w.updatedAt || '',
      created_at: w.created_at || w.createdAt || '',
      actions: '',
      _raw: w
    };
  }

  function mapExecution(raw) {
    var l = raw || {};
    return {
      id: str(l.id),
      workflow_name: str(l.workflowName || l.workflow_name),
      workflow_id: str(l.workflowId || l.workflow_id),
      status: str(l.status).toLowerCase(),
      trigger: triggerOf(l),
      records_processed: num(l.recordsProcessed !== undefined ? l.recordsProcessed : l.records_processed),
      duration_ms: num(l.duration !== undefined ? l.duration : l.duration_ms),
      created_at: l.startedAt || l.started_at || l.created_at || '',
      actions: '',
      _raw: l
    };
  }

  function syncState(audience) {
    var a = audience || {};
    var enabled = a.syncEnabled !== undefined ? a.syncEnabled : a.sync_enabled;
    if (!enabled) return 'disabled';
    if (!(a.lastSync || a.last_sync)) return 'never';
    return 'active';
  }

  function mapAudience(raw) {
    var a = raw || {};
    return {
      id: str(a.id),
      name: str(a.name),
      platform: str(a.platform).toLowerCase(),
      size: num(a.size),
      sync_state: syncState(a),
      last_sync: a.lastSync || a.last_sync || '',
      created_at: a.createdAt || a.created_at || '',
      actions: '',
      _raw: a
    };
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined || ms === '') return '';
    var n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1000) return Math.round(n) + 'ms';
    if (n < 60000) return (n / 1000).toFixed(1) + 's';
    return Math.floor(n / 60000) + 'm ' + Math.round((n % 60000) / 1000) + 's';
  }

  // ---------------------------------------------------------------------------
  // Cell renderers
  // ---------------------------------------------------------------------------

  function mapBadge(map, value) {
    var k = kit();
    if (!value) return k.muted('');
    var entry = map[value];
    var label = entry ? entry.label : k.capitalize(value);
    return k.badge(label, entry ? entry.color : 'gray');
  }

  function textCell(value) {
    var k = kit();
    if (value === null || value === undefined || value === '') return k.muted('');
    return '<span class="admin-table-text" title="' + k.esc(value) + '">' + k.esc(value) + '</span>';
  }

  function numberCell(value) {
    if (value === null || value === undefined) return kit().muted('');
    return textCell(Number(value).toLocaleString('en-US'));
  }

  var ICONS = {
    pause: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
    play: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
    run: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
    sync: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>'
  };

  // Row actions are buttons (lex-table's row-click ignores them); each page
  // handles them with one delegated listener on [data-action].
  function actionButton(action, id, title, icon) {
    var k = kit();
    return '<button type="button" class="workflow-table-action" data-action="' + k.esc(action) + '" data-id="' + k.esc(id) +
      '" title="' + k.esc(title) + '" aria-label="' + k.esc(title) + '">' + icon + '</button>';
  }

  function workflowRenderers() {
    var k = kit();
    return {
      name: function (val, row) { return k.nameCell(val, row && row.description); },
      status: function (val) { return mapBadge(WORKFLOW_STATUS, val); },
      trigger_type: function (val) { return mapBadge(TRIGGERS, val); },
      updated_at: function (val) { return k.relativeCell(val); },
      created_at: function (val) { return k.timeCell(val); },
      actions: function (_val, row) {
        var active = row.status === 'active';
        return '<div class="workflow-table-actions">' +
          actionButton('toggle', row.id, active ? 'Pause' : 'Activate', active ? ICONS.pause : ICONS.play) +
          actionButton('run', row.id, 'Run now', ICONS.run) +
          '</div>';
      }
    };
  }

  function executionRenderers() {
    var k = kit();
    return {
      workflow_name: function (val, row) { return k.nameCell(val, row && row.id); },
      status: function (val) { return mapBadge(EXECUTION_STATUS, val); },
      trigger: function (val) { return mapBadge(TRIGGERS, val); },
      records_processed: function (val) { return numberCell(val); },
      duration_ms: function (val) { return textCell(formatDuration(val)); },
      created_at: function (val) { return k.timeCell(val); },
      actions: function (_val, row) {
        return '<button type="button" class="workflow-table-link" data-action="details" data-id="' + k.esc(row.id) + '">View details</button>';
      }
    };
  }

  function audienceRenderers() {
    var k = kit();
    return {
      name: function (val, row) { return k.nameCell(val, row && row.id); },
      platform: function (val) { return mapBadge(PLATFORMS, val); },
      size: function (val) { return numberCell(val); },
      sync_state: function (val) { return mapBadge(SYNC_STATES, val); },
      last_sync: function (val) { return k.relativeCell(val); },
      created_at: function (val) { return k.timeCell(val); },
      actions: function (_val, row) {
        var enabled = row.sync_state !== 'disabled';
        return '<div class="workflow-table-actions">' +
          actionButton('sync', row.id, 'Sync now', ICONS.sync) +
          actionButton('toggle-sync', row.id, enabled ? 'Disable sync' : 'Enable sync', enabled ? ICONS.pause : ICONS.play) +
          '</div>';
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Column filters (every column)
  // ---------------------------------------------------------------------------

  // Server table: the API takes one status and one trigger, so both are
  // single-choice.
  function workflowFilterOptions() {
    var k = kit();
    return {
      name: { text: true, placeholder: 'Workflow name contains...' },
      status: { single: true, options: WORKFLOW_STATUS_OPTIONS },
      trigger_type: { single: true, options: TRIGGER_OPTIONS },
      updated_at: k.dateRangeFilter(),
      created_at: k.dateRangeFilter()
    };
  }

  // Client tables (the whole set is loaded): predicates for dates and numbers.
  function executionFilterOptions(workflowNames) {
    var names = (workflowNames || []).filter(Boolean);
    var seen = {};
    var unique = names.filter(function (n) { if (seen[n]) return false; seen[n] = true; return true; })
      .sort(function (a, b) { return a.localeCompare(b); });
    return {
      workflow_name: unique.length
        ? { options: unique.map(function (n) { return { value: n, label: n }; }) }
        : { text: true, placeholder: 'Workflow name contains...' },
      status: { options: EXECUTION_STATUS_OPTIONS },
      trigger: { options: TRIGGER_OPTIONS },
      records_processed: numberFilter(RECORD_RANGES),
      duration_ms: numberFilter(DURATION_RANGES),
      created_at: dateFilter()
    };
  }

  function audienceFilterOptions() {
    return {
      name: { text: true, placeholder: 'Audience name contains...' },
      platform: { options: PLATFORM_OPTIONS },
      size: numberFilter(SIZE_RANGES),
      sync_state: { options: SYNC_STATE_OPTIONS },
      last_sync: dateFilter(),
      created_at: dateFilter()
    };
  }

  var moduleApi = {
    WORKFLOW_STATUS: WORKFLOW_STATUS,
    TRIGGERS: TRIGGERS,
    EXECUTION_STATUS: EXECUTION_STATUS,
    PLATFORMS: PLATFORMS,
    SYNC_STATES: SYNC_STATES,
    WORKFLOW_STATUS_OPTIONS: WORKFLOW_STATUS_OPTIONS,
    TRIGGER_OPTIONS: TRIGGER_OPTIONS,
    EXECUTION_STATUS_OPTIONS: EXECUTION_STATUS_OPTIONS,
    PLATFORM_OPTIONS: PLATFORM_OPTIONS,
    SYNC_STATE_OPTIONS: SYNC_STATE_OPTIONS,
    RECORD_RANGES: RECORD_RANGES,
    DURATION_RANGES: DURATION_RANGES,
    SIZE_RANGES: SIZE_RANGES,
    workflowsParams: workflowsParams,
    mapWorkflow: mapWorkflow,
    mapExecution: mapExecution,
    mapAudience: mapAudience,
    syncState: syncState,
    formatDuration: formatDuration,
    inNumberRange: inNumberRange,
    workflowRenderers: workflowRenderers,
    executionRenderers: executionRenderers,
    audienceRenderers: audienceRenderers,
    workflowFilterOptions: workflowFilterOptions,
    executionFilterOptions: executionFilterOptions,
    audienceFilterOptions: audienceFilterOptions
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.WorkflowTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
