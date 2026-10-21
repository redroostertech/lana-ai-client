/**
 * list-query-params.js
 * Maps a server-paged lex-table query ({ page, limit, sortBy, sortDir,
 * filters }) to the list API parameters of the Workspaces, My Tasks and
 * Library (drive) tables. One builder per API, so each page's mapping is
 * tested on its own (docs/TABLE-STANDARD.md, sections 4 and 7).
 *
 * Public API (window.LanaListQueryParams, or module.exports in Node):
 *   - filterValues(filter)                    -> string[] a column filter selected
 *   - mattersParams(query, context)           -> GET /api/v1/matters params
 *   - myTasksParams(query, context)           -> GET /api/v1/tasks/my params
 *   - libraryFilesParams(query, context)      -> GET /api/v1/storage/library/files params
 *   - MATTER_STATUS_OPTIONS, MATTER_TYPE_OPTIONS, TASK_STATUS_OPTIONS,
 *     TASK_PRIORITY_OPTIONS, TASK_DUE_OPTIONS, FILE_SIZE_RANGES
 *
 * Each builder returns a URLSearchParams. Date ranges use the shared
 * Today / 7 / 30 days / older bounds (LanaLibraryColumnFilters).
 */

(function (global) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  function rangeHelpers() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('./library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  // Values a column filter selected: lex-table sends { operator: 'in', value: [...] }
  // or { operator: 'contains', value: 'text' }.
  function filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value])
      .map(function (item) { return String(item == null ? '' : item).trim(); })
      .filter(Boolean);
  }

  function setRange(params, filter, afterName, beforeName, now) {
    var helpers = rangeHelpers();
    var value = filterValues(filter)[0];
    if (!helpers || !value) return;
    var bounds = helpers.editedRangeBounds(value, now);
    if (bounds.after) params.set(afterName, bounds.after);
    if (bounds.before) params.set(beforeName, bounds.before);
  }

  function pageOf(query) {
    var page = Number(query && query.page);
    return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  }

  function limitOf(query, fallback, max) {
    var limit = Number(query && query.limit);
    if (!Number.isFinite(limit) || limit < 1) limit = fallback;
    return Math.min(Math.floor(limit), max);
  }

  // ── Workspaces: GET /api/v1/matters ───────────────────────────────────

  var MATTER_STATUS_OPTIONS = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'closed', label: 'Closed' },
    { value: 'archived', label: 'Archived' }
  ];

  var MATTER_TYPE_OPTIONS = [
    { value: 'matter', label: 'Client matter' },
    { value: 'workspace', label: 'Workspace' }
  ];

  // Table column -> /api/v1/matters sort_by (its allow-list).
  var MATTER_SORT_BY_COLUMN = {
    name: 'name',
    status: 'status',
    matter_type: 'matter_type',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  /**
   * @param {Object} query - lex-table server query
   * @param {Object} [context] - { search, includeAll, now }
   * @returns {URLSearchParams}
   */
  function mattersParams(query, context) {
    query = query || {};
    context = context || {};
    var filters = query.filters || {};
    var params = new URLSearchParams();
    params.set('page', String(pageOf(query)));
    params.set('page_size', String(limitOf(query, 20, 100)));
    params.set('sort_by', MATTER_SORT_BY_COLUMN[query.sortBy] || 'created_at');
    params.set('sort_order', query.sortDir === 'asc' ? 'asc' : 'desc');
    params.set('exclude_pinned', 'true');
    params.set('include_all', context.includeAll ? 'true' : 'false');
    if (context.search) params.set('search', context.search);

    // Status and Type are single-choice: the API takes one value each.
    var status = filterValues(filters.status)[0];
    if (status) {
      params.set('status', status);
      // The API hides archived rows unless asked for them.
      if (status === 'archived') params.set('include_archived', 'true');
    }
    var type = filterValues(filters.matter_type)[0];
    if (type) params.set('matter_type', type);

    var name = filterValues(filters.name)[0];
    if (name) params.set('name', name);
    var matterId = filterValues(filters.matter_id)[0];
    if (matterId) params.set('matter_id_contains', matterId);
    setRange(params, filters.created_at, 'created_after', 'created_before', context.now);
    setRange(params, filters.updated_at, 'updated_after', 'updated_before', context.now);
    return params;
  }

  // ── My Tasks: GET /api/v1/tasks/my ────────────────────────────────────

  var TASK_STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'in_review', label: 'In review' },
    { value: 'complete', label: 'Complete' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  var TASK_PRIORITY_OPTIONS = [
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'normal', label: 'Normal' },
    { value: 'low', label: 'Low' }
  ];

  // Due is a date-only, mostly future value: its ranges look forward.
  var TASK_DUE_OPTIONS = [
    { value: 'overdue', label: 'Overdue' },
    { value: 'today', label: 'Due today' },
    { value: 'next_7d', label: 'Due in the next 7 days' },
    { value: 'next_30d', label: 'Due in the next 30 days' },
    { value: 'none', label: 'No due date' }
  ];

  // Table column -> /api/v1/tasks/my sort_by (its allow-list).
  var TASK_SORT_BY_COLUMN = {
    title: 'title',
    status: 'status',
    priority: 'priority',
    due_date: 'due_date',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  // The API caps limit at 100.
  var TASK_MAX_LIMIT = 100;

  function startOfToday(now) {
    var helpers = rangeHelpers();
    var bounds = helpers ? helpers.editedRangeBounds('today', now) : { after: '' };
    if (bounds.after) return new Date(bounds.after);
    var local = new Date((now instanceof Date ? now : new Date()).getTime());
    local.setHours(0, 0, 0, 0);
    return local;
  }

  function setDueRange(params, value, now) {
    if (!value) return;
    if (value === 'none') { params.set('no_due_date', 'true'); return; }
    var today = startOfToday(now);
    var span = { today: 1, next_7d: 7, next_30d: 30 }[value];
    if (value === 'overdue') {
      params.set('due_before', today.toISOString());
    } else if (span) {
      params.set('due_after', today.toISOString());
      params.set('due_before', new Date(today.getTime() + span * DAY_MS).toISOString());
    }
  }

  /**
   * @param {Object} query - lex-table server query
   * @param {Object} [context] - { search, now }
   * @returns {URLSearchParams}
   */
  function myTasksParams(query, context) {
    query = query || {};
    context = context || {};
    var filters = query.filters || {};
    var limit = limitOf(query, 20, TASK_MAX_LIMIT);
    var page = pageOf(query);
    var params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', String((page - 1) * limit));
    params.set('sort_by', TASK_SORT_BY_COLUMN[query.sortBy] || 'updated_at');
    params.set('sort_dir', query.sortDir === 'asc' ? 'ASC' : 'DESC');
    if (context.search) params.set('search', context.search);

    var statuses = [];
    filterValues(filters.status).forEach(function (status) {
      statuses.push(status);
      // Older rows still carry the legacy "completed".
      if (status === 'complete') statuses.push('completed');
    });
    if (statuses.length) params.set('statuses', statuses.join(','));
    var priorities = filterValues(filters.priority);
    if (priorities.length) params.set('priorities', priorities.join(','));

    var title = filterValues(filters.title)[0];
    if (title) params.set('title', title);
    var matters = filterValues(filters.workspace_matter);
    if (matters.length) params.set('matter_ids', matters.join(','));
    setDueRange(params, filterValues(filters.due_date)[0], context.now);
    setRange(params, filters.created_at, 'created_after', 'created_before', context.now);
    return params;
  }

  // ── Library search results: GET /api/v1/storage/library/files ─────────

  // Byte ranges, min inclusive, max exclusive (same as the Document Library).
  var FILE_SIZE_RANGES = {
    under_100kb: { label: 'Under 100 KB', min: null, max: 100 * 1024 },
    '100kb_1mb': { label: '100 KB – 1 MB', min: 100 * 1024, max: 1024 * 1024 },
    '1mb_10mb': { label: '1 MB – 10 MB', min: 1024 * 1024, max: 10 * 1024 * 1024 },
    over_10mb: { label: 'Over 10 MB', min: 10 * 1024 * 1024, max: null }
  };

  var FILE_SORT_BY_COLUMN = { name: 'name', size: 'file_size', created_at: 'created_at', updated_at: 'updated_at' };

  /**
   * @param {Object} query - lex-table server query
   * @param {Object} [context] - { search, now }
   * @returns {URLSearchParams}
   */
  function libraryFilesParams(query, context) {
    query = query || {};
    context = context || {};
    var filters = query.filters || {};
    var params = new URLSearchParams();
    params.set('page', String(pageOf(query)));
    params.set('page_size', String(limitOf(query, 20, 100)));
    params.set('sort_by', FILE_SORT_BY_COLUMN[query.sortBy] || 'created_at');
    params.set('sort_order', query.sortDir === 'asc' ? 'asc' : 'desc');
    if (context.search) params.set('search', context.search);
    var name = filterValues(filters.name)[0];
    if (name) params.set('name', name);
    var workspaces = filterValues(filters.workspace);
    if (workspaces.length) params.set('workspaces', workspaces.join(','));
    var size = FILE_SIZE_RANGES[filterValues(filters.size)[0]];
    if (size && size.min !== null) params.set('min_size', String(size.min));
    if (size && size.max !== null) params.set('max_size', String(size.max));
    setRange(params, filters.created_at, 'created_after', 'created_before', context.now);
    return params;
  }

  var moduleApi = {
    filterValues: filterValues,
    mattersParams: mattersParams,
    myTasksParams: myTasksParams,
    libraryFilesParams: libraryFilesParams,
    MATTER_STATUS_OPTIONS: MATTER_STATUS_OPTIONS,
    MATTER_TYPE_OPTIONS: MATTER_TYPE_OPTIONS,
    MATTER_SORT_BY_COLUMN: MATTER_SORT_BY_COLUMN,
    TASK_STATUS_OPTIONS: TASK_STATUS_OPTIONS,
    TASK_PRIORITY_OPTIONS: TASK_PRIORITY_OPTIONS,
    TASK_DUE_OPTIONS: TASK_DUE_OPTIONS,
    TASK_SORT_BY_COLUMN: TASK_SORT_BY_COLUMN,
    TASK_MAX_LIMIT: TASK_MAX_LIMIT,
    FILE_SIZE_RANGES: FILE_SIZE_RANGES,
    FILE_SORT_BY_COLUMN: FILE_SORT_BY_COLUMN
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaListQueryParams = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
