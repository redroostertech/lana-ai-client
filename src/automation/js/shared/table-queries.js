/**
 * table-queries.js
 * Pure, DOM-free query mapping for the automation app's server-paged tables
 * (Library "Live Automations", Run History "Triggered Runs", Approvals
 * "Approval Queue"), per docs/TABLE-STANDARD.md.
 *
 * Each builder turns a lex-table query ({ page, limit, sortBy, sortDir,
 * filters }) plus the toolbar search into the list API's URLSearchParams, and
 * each pagination reader turns the API's pagination into the table's
 * { page, limit, total, total_pages }.
 *
 * Classic script (window.AutomationTableQueries) so Jest can require it, like
 * design-to-builder.mapper.js; the ES-module views read it from window.
 */
(function (global) {
  'use strict';

  // Date range bounds come from the shared library filters (Today / 7d / 30d / older).
  function columnFilters() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try {
        return require('../../../js/shared/library-column-filters.js');
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  function lexUtils() {
    return global && global.Lex && global.Lex.Utils ? global.Lex.Utils : null;
  }

  // ── Labels ─────────────────────────────────────────────────────────────

  function capitalizeFirst(value) {
    var utils = lexUtils();
    if (utils && typeof utils.capitalizeFirst === 'function') return utils.capitalizeFirst(value);
    var text = String(value == null ? '' : value);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  // "lead-management" -> "Lead management", "automation_execution" -> "Automation execution".
  function humanizeLabel(value) {
    var utils = lexUtils();
    if (utils && typeof utils.humanizeLabel === 'function') return utils.humanizeLabel(value);
    var text = String(value == null ? '' : value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return capitalizeFirst(text);
  }

  // "matter.created" -> "Matter created" (event names use dots as well).
  function humanizeEvent(value) {
    return humanizeLabel(String(value == null ? '' : value).replace(/[.:]+/g, ' '));
  }

  function optionsFromValues(values, labeler) {
    var seen = {};
    var label = typeof labeler === 'function' ? labeler : humanizeLabel;
    var options = [];
    (values || []).forEach(function (raw) {
      var value = raw && typeof raw === 'object' ? raw.value : raw;
      if (value === undefined || value === null || value === '') return;
      value = String(value);
      if (seen[value]) return;
      seen[value] = true;
      options.push({ value: value, label: label(value) });
    });
    return options;
  }

  // Values of a facet response ({ <name>: [{ value, count }] }), most common first as served.
  function facetValues(response, name) {
    var source = response && (response[name] || (response.data && response.data[name]));
    if (!Array.isArray(source)) return [];
    return source.map(function (row) { return row && typeof row === 'object' ? row.value : row; })
      .filter(function (value) { return value !== undefined && value !== null && value !== ''; })
      .map(String);
  }

  // ── Filter values ──────────────────────────────────────────────────────

  // Values a column filter selected: lex-table sends { operator: 'in', value: [...] }
  // or { operator: 'contains', value } for text columns.
  function filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value])
      .map(function (item) { return String(item == null ? '' : item).trim(); })
      .filter(Boolean);
  }

  function setCsv(params, key, filter) {
    var values = filterValues(filter);
    if (values.length) params.set(key, values.join(','));
  }

  function setText(params, key, filter) {
    var value = filterValues(filter)[0];
    if (value) params.set(key, value);
  }

  function setDateRange(params, prefix, filter, now) {
    var shared = columnFilters();
    var range = filterValues(filter)[0];
    if (!shared || !range) return;
    var bounds = shared.editedRangeBounds(range, now);
    if (bounds.after) params.set(prefix + '_after', bounds.after);
    if (bounds.before) params.set(prefix + '_before', bounds.before);
  }

  function sortDir(query) {
    return query && query.sortDir === 'asc' ? 'asc' : 'desc';
  }

  function pageLimit(query, max) {
    var limit = Math.max(1, parseInt(query && query.limit, 10) || 20);
    return Math.min(limit, max || 100);
  }

  function pageNumber(query) {
    return Math.max(1, parseInt(query && query.page, 10) || 1);
  }

  // ── Pagination readers ─────────────────────────────────────────────────

  function readPagination(response) {
    return (response && (response.pagination || (response.data && !Array.isArray(response.data) && response.data.pagination))) || null;
  }

  function finiteNumber(value) {
    var number = Number(value);
    return value !== undefined && value !== null && value !== '' && Number.isFinite(number) ? number : null;
  }

  /**
   * Table pagination from either page- or offset-style API pagination.
   * Without a server total (an API that predates paging) the page's own rows
   * are the total, so the table shows one page rather than a wrong count.
   */
  function tablePagination(response, query, rowCount) {
    var source = readPagination(response) || {};
    var limit = finiteNumber(source.limit) || finiteNumber(source.page_size) || pageLimit(query);
    var offset = finiteNumber(source.offset);
    var page = finiteNumber(source.page) || (offset !== null ? Math.floor(offset / limit) + 1 : pageNumber(query));
    var total = finiteNumber(source.total);
    if (total === null) total = finiteNumber(response && response.total);
    if (total === null) total = (page - 1) * limit + Number(rowCount || 0);
    var totalPages = finiteNumber(source.total_pages) || finiteNumber(source.totalPages) || Math.max(1, Math.ceil(total / limit));
    return { page: page, limit: limit, total: total, total_pages: totalPages };
  }

  // ── Library: GET /api/automations ──────────────────────────────────────

  var LIBRARY_SORT_BY = {
    name: 'name',
    category: 'category',
    automation_type: 'type',
    scope: 'scope',
    visibility: 'visibility',
    state: 'state',
    last_executed_at: 'last_executed_at',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  var SCOPE_OPTIONS = [
    { value: 'organization', label: 'Organization' },
    { value: 'matter', label: 'Matter' }
  ];
  var VISIBILITY_OPTIONS = [
    { value: 'private', label: 'Private' },
    { value: 'org_wide', label: 'Org-wide' }
  ];
  var STATE_OPTIONS = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' }
  ];

  function libraryParams(query, search, now) {
    query = query || {};
    var filters = query.filters || {};
    var params = new URLSearchParams();
    params.set('page', String(pageNumber(query)));
    params.set('limit', String(pageLimit(query, 100)));
    params.set('sort_by', LIBRARY_SORT_BY[query.sortBy] || 'updated_at');
    params.set('sort_dir', sortDir(query));
    if (search) params.set('search', String(search));
    setText(params, 'name', filters.name);
    setCsv(params, 'category', filters.category);
    setCsv(params, 'automation_type', filters.automation_type);
    setCsv(params, 'scope', filters.scope);
    setCsv(params, 'visibility', filters.visibility);
    setCsv(params, 'state', filters.state);
    setDateRange(params, 'last_executed', filters.last_executed_at, now);
    setDateRange(params, 'updated', filters.updated_at, now);
    setDateRange(params, 'created', filters.created_at, now);
    return params;
  }

  // ── Run History: GET /api/executions ───────────────────────────────────

  var RUNS_SORT_BY = {
    automation_name: 'name',
    matter: 'matter',
    trigger_event_type: 'trigger',
    scope: 'scope',
    // The API's created_at sort is COALESCE(started_at, created_at): it
    // serves both date columns (a run's start and creation are the same
    // moment unless it waited in a queue).
    started_at: 'created_at',
    created_at: 'created_at',
    status: 'status',
    duration: 'duration'
  };

  var RUN_STATUSES = ['pending', 'running', 'in_progress', 'awaiting_approval', 'paused', 'completed', 'failed', 'cancelled', 'rejected'];

  // Duration column ranges: min inclusive, max exclusive, in milliseconds.
  var DURATION_RANGES = {
    under_1s: { label: 'Under 1s', min: null, max: 1000 },
    '1s_10s': { label: '1–10s', min: 1000, max: 10000 },
    '10s_60s': { label: '10–60s', min: 10000, max: 60000 },
    over_1m: { label: 'Over 1 min', min: 60000, max: null }
  };

  function durationOptions() {
    return Object.keys(DURATION_RANGES).map(function (key) {
      return { value: key, label: DURATION_RANGES[key].label };
    });
  }

  function runsParams(query, search, now) {
    query = query || {};
    var filters = query.filters || {};
    var params = new URLSearchParams();
    var limit = pageLimit(query, 100);
    params.set('limit', String(limit));
    params.set('offset', String((pageNumber(query) - 1) * limit));
    params.set('sort_by', RUNS_SORT_BY[query.sortBy] || 'created_at');
    params.set('sort_dir', sortDir(query));
    if (search) params.set('query', String(search));
    setText(params, 'automation_name', filters.automation_name);
    setCsv(params, 'scope', filters.scope);
    setCsv(params, 'matter_ids', filters.matter);
    setCsv(params, 'trigger_event_type', filters.trigger_event_type);
    setCsv(params, 'status', filters.status);
    setDateRange(params, 'started', filters.started_at, now);
    setDateRange(params, 'created', filters.created_at, now);
    var duration = DURATION_RANGES[filterValues(filters.duration)[0]];
    if (duration && duration.min !== null) params.set('min_duration_ms', String(duration.min));
    if (duration && duration.max !== null) params.set('max_duration_ms', String(duration.max));
    return params;
  }

  // "850 ms", "4.2 s", "3.5 min"; '' when unknown.
  function humanizeDuration(durationMs) {
    var ms = Number(durationMs);
    if (durationMs === null || durationMs === undefined || durationMs === '' || !Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    if (ms < 3600000) return (ms / 60000).toFixed(1) + ' min';
    return (ms / 3600000).toFixed(1) + ' h';
  }

  // ── Approvals: GET /api/approvals/inbox ────────────────────────────────

  var APPROVALS_SORT_BY = {
    title: 'title',
    priority: 'priority',
    source_type: 'source_type',
    approval_type: 'approval_type',
    created_at: 'created_at',
    expires_at: 'expires_at'
  };

  // Lowest to highest; the server sorts priority by this rank, not alphabetically.
  var PRIORITIES = ['low', 'normal', 'high', 'urgent'];
  var APPROVAL_TYPES = ['tool_execution', 'document_review', 'entity_mutation', 'workflow_step', 'automation_action', 'general'];
  var APPROVAL_SOURCE_TYPES = ['agentic_task', 'agentic_snapshot', 'workflow_execution', 'automation_execution', 'document_edit_batch_release', 'standalone'];

  function priorityRank(priority) {
    var index = PRIORITIES.indexOf(String(priority || '').toLowerCase());
    return index === -1 ? 1 : index;
  }

  function approvalsParams(query, search, now) {
    query = query || {};
    var filters = query.filters || {};
    var params = new URLSearchParams();
    var limit = pageLimit(query, 100);
    params.set('limit', String(limit));
    params.set('offset', String((pageNumber(query) - 1) * limit));
    params.set('sort_by', APPROVALS_SORT_BY[query.sortBy] || 'created_at');
    params.set('sort_dir', sortDir(query));
    if (search) params.set('search', String(search));
    setText(params, 'title', filters.title);
    setCsv(params, 'approval_type', filters.approval_type);
    setCsv(params, 'priority', filters.priority);
    setCsv(params, 'source_type', filters.source_type);
    // The inbox filters one matter at a time (matter_id); the column is single-choice.
    setText(params, 'matter_id', filters.matter);
    setDateRange(params, 'created', filters.created_at, now);
    setDateRange(params, 'expires', filters.expires_at, now);
    return params;
  }

  var moduleApi = {
    capitalizeFirst: capitalizeFirst,
    humanizeLabel: humanizeLabel,
    humanizeEvent: humanizeEvent,
    optionsFromValues: optionsFromValues,
    facetValues: facetValues,
    filterValues: filterValues,
    tablePagination: tablePagination,
    LIBRARY_SORT_BY: LIBRARY_SORT_BY,
    SCOPE_OPTIONS: SCOPE_OPTIONS,
    VISIBILITY_OPTIONS: VISIBILITY_OPTIONS,
    STATE_OPTIONS: STATE_OPTIONS,
    libraryParams: libraryParams,
    RUNS_SORT_BY: RUNS_SORT_BY,
    RUN_STATUSES: RUN_STATUSES,
    DURATION_RANGES: DURATION_RANGES,
    durationOptions: durationOptions,
    runsParams: runsParams,
    humanizeDuration: humanizeDuration,
    APPROVALS_SORT_BY: APPROVALS_SORT_BY,
    PRIORITIES: PRIORITIES,
    APPROVAL_TYPES: APPROVAL_TYPES,
    APPROVAL_SOURCE_TYPES: APPROVAL_SOURCE_TYPES,
    priorityRank: priorityRank,
    approvalsParams: approvalsParams
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AutomationTableQueries = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
