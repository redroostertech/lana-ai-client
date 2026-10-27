/**
 * leadly-tables.js
 * Table specs, row mappers and query builders for the Leadly integration
 * page (integrations/leadly.html): the Output tab's record tables
 * (contacts, opportunities, pipelines, funnels; server-paged) and the Logs
 * tab's Job History (sync logs + document imports; client-side).
 * Markup, renderers and filters come from LanaRecordTableKit.
 *
 * Backend note: chef removed the /api/v1/leadly router (5864f1261). The
 * builders below keep the page's original contract (page, limit, search,
 * status) and add the sort and column-filter parameters a restored API must
 * honour (docs/TABLE-STANDARD.md section 10).
 *
 * Public API (window.LanaLeadlyTables, or module.exports in Node):
 *   - OUTPUT_TYPES                         -> { contacts, opportunities, pipelines, funnel }
 *       each { endpoint, listKey, spec, mapRow, serverFilters() }
 *   - outputParams(type, query, context)   -> URLSearchParams for GET /api/v1/leadly/<type>
 *   - outputResult(type, response, query)  -> { rows, pagination }
 *   - contactRow, opportunityRow, pipelineRow, funnelRow
 *   - JOB_STATUS_OPTIONS, JOB_TYPE_OPTIONS, ACTIVE_JOB_STATUSES
 *   - syncJobRow(log), documentJobRow(doc), jobHistoryRows(logs, docs)
 *   - jobHistorySpec()
 *   - fetchAllOffsetPages(fetchPage, pageSize, maxPages) -> Promise<{ rows, truncated }>
 */

(function (global) {
  'use strict';

  function kit() {
    if (global && global.LanaRecordTableKit) return global.LanaRecordTableKit;
    if (typeof require === 'function') {
      try { return require('../../insights/js/record-table-kit.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function helpers() {
    if (global && global.LanaIntegrationTables) return global.LanaIntegrationTables;
    if (typeof require === 'function') {
      try { return require('./integration-tables.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function ranges() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('../../js/shared/library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function filterValues(filter) {
    return helpers().filterValues(filter);
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function createdOf(record) {
    var r = record || {};
    return r.created_at || r.date_added || r.dateAdded || r.source_created_at || '';
  }

  // ── Output tab: row mappers ────────────────────────────────────────────

  function contactRow(contact) {
    var c = contact || {};
    var name = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || c.name || c.contact_name || '';
    return {
      id: String(c.id != null ? c.id : (c.external_id || '')),
      name: name,
      email: c.email || '',
      phone: c.phone || '',
      company: c.company || c.company_name || '',
      created_at: createdOf(c),
      _raw: c
    };
  }

  function opportunityRow(opp) {
    var o = opp || {};
    return {
      id: String(o.id != null ? o.id : (o.external_id || '')),
      name: o.name || '',
      status: String(o.status || '').toLowerCase(),
      monetary_value: num(o.monetary_value),
      stage_name: o.stage_name || '',
      created_at: createdOf(o),
      _raw: o
    };
  }

  function pipelineRow(pipeline) {
    var p = pipeline || {};
    var stages = Array.isArray(p.stages) ? p.stages : [];
    return {
      id: String(p.id != null ? p.id : (p.external_id || '')),
      name: p.name || '',
      stage_count: stages.length,
      opportunity_count: stages.reduce(function (sum, s) { return sum + (Number(s && s.opportunity_count) || 0); }, 0),
      total_value: stages.reduce(function (sum, s) { return sum + (Number(s && s.total_value) || 0); }, 0),
      created_at: createdOf(p),
      _raw: p
    };
  }

  function funnelRow(funnel) {
    var f = funnel || {};
    var steps = f.steps ? (Array.isArray(f.steps) ? f.steps.length : Object.keys(f.steps).length) : 0;
    return {
      id: String(f.id != null ? f.id : (f.external_id || '')),
      name: f.name || '',
      category: f.category || '',
      step_count: steps,
      status: f.is_active ? 'active' : 'inactive',
      created_at: createdOf(f),
      _raw: f
    };
  }

  // ── Output tab: specs ──────────────────────────────────────────────────

  var COUNT_RANGES = [
    { value: 'zero', label: 'None', min: null, max: 1 },
    { value: '1_10', label: '1 – 10', min: 1, max: 11 },
    { value: '11_100', label: '11 – 100', min: 11, max: 101 },
    { value: 'over_100', label: 'Over 100', min: 101, max: null }
  ];

  var VALUE_RANGES = [
    { value: 'under_1k', label: 'Under $1,000', min: null, max: 1000 },
    { value: '1k_10k', label: '$1,000 – $10,000', min: 1000, max: 10000 },
    { value: '10k_100k', label: '$10,000 – $100,000', min: 10000, max: 100000 },
    { value: 'over_100k', label: 'Over $100,000', min: 100000, max: null }
  ];

  var OPPORTUNITY_STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' },
    { value: 'abandoned', label: 'Abandoned' }
  ];
  var OPPORTUNITY_STATUS_COLORS = { open: 'blue', won: 'green', lost: 'red', abandoned: 'gray' };

  var FUNNEL_STATUS_OPTIONS = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' }
  ];
  var FUNNEL_STATUS_COLORS = { active: 'green', inactive: 'gray' };

  function textFilter(label) {
    return { text: true, placeholder: label + ' contains...' };
  }

  function rangeOptions(list) {
    return list.map(function (r) { return { value: r.value, label: r.label }; });
  }

  function createdServerFilter() {
    var r = ranges();
    return r ? { single: true, options: r.EDITED_RANGE_OPTIONS } : null;
  }

  function withCreated(map) {
    var created = createdServerFilter();
    if (created) map.created_at = created;
    return map;
  }

  var OUTPUT_TYPES = {
    contacts: {
      endpoint: '/api/v1/leadly/contacts',
      listKey: 'contacts',
      mapRow: contactRow,
      spec: {
        id: 'leadlyContactsTable',
        title: 'Contacts',
        noun: ['contact', 'contacts'],
        searchPlaceholder: 'Search contacts by name, email or phone...',
        emptyText: 'No contacts synced yet',
        filteredEmptyText: 'No matching contacts. Try a different search or clear the filters.',
        light: true,
        serverPaging: true,
        sortBy: 'created_at',
        sortDir: 'desc',
        minWidth: 860,
        columns: [
          { key: 'name', label: 'Name', kind: 'name' },
          { key: 'email', label: 'Email', kind: 'email', width: '24%' },
          { key: 'phone', label: 'Phone', kind: 'code', width: '150px' },
          { key: 'company', label: 'Company', kind: 'text', width: '18%' },
          { key: 'created_at', label: 'Created', kind: 'created' }
        ]
      },
      serverFilters: function () {
        return withCreated({
          name: textFilter('Name'),
          email: textFilter('Email'),
          phone: textFilter('Phone'),
          company: textFilter('Company')
        });
      }
    },
    opportunities: {
      endpoint: '/api/v1/leadly/opportunities',
      listKey: 'opportunities',
      mapRow: opportunityRow,
      spec: {
        id: 'leadlyOpportunitiesTable',
        title: 'Opportunities',
        noun: ['opportunity', 'opportunities'],
        searchPlaceholder: 'Search opportunities...',
        emptyText: 'No opportunities synced yet',
        filteredEmptyText: 'No matching opportunities. Try a different search or clear the filters.',
        light: true,
        serverPaging: true,
        sortBy: 'created_at',
        sortDir: 'desc',
        minWidth: 860,
        columns: [
          { key: 'name', label: 'Name', kind: 'name' },
          { key: 'status', label: 'Status', kind: 'badge', width: '120px', options: OPPORTUNITY_STATUS_OPTIONS, colors: OPPORTUNITY_STATUS_COLORS },
          { key: 'monetary_value', label: 'Value', kind: 'currency', width: '130px', ranges: VALUE_RANGES },
          { key: 'stage_name', label: 'Stage', kind: 'text', width: '20%' },
          { key: 'created_at', label: 'Created', kind: 'created' }
        ]
      },
      serverFilters: function () {
        return withCreated({
          name: textFilter('Name'),
          status: { options: OPPORTUNITY_STATUS_OPTIONS },
          monetary_value: { single: true, options: rangeOptions(VALUE_RANGES) },
          stage_name: textFilter('Stage')
        });
      }
    },
    pipelines: {
      endpoint: '/api/v1/leadly/pipelines',
      listKey: 'pipelines',
      mapRow: pipelineRow,
      spec: {
        id: 'leadlyPipelinesTable',
        title: 'Pipelines',
        noun: ['pipeline', 'pipelines'],
        searchPlaceholder: 'Search pipelines...',
        emptyText: 'No pipelines synced yet',
        filteredEmptyText: 'No matching pipelines. Try a different search or clear the filters.',
        light: true,
        serverPaging: true,
        sortBy: 'created_at',
        sortDir: 'desc',
        minWidth: 820,
        columns: [
          { key: 'name', label: 'Pipeline', kind: 'name' },
          { key: 'stage_count', label: 'Stages', kind: 'number', width: '100px', ranges: COUNT_RANGES },
          { key: 'opportunity_count', label: 'Opportunities', kind: 'number', width: '140px', ranges: COUNT_RANGES },
          { key: 'total_value', label: 'Total value', kind: 'currency', width: '140px', ranges: VALUE_RANGES },
          { key: 'created_at', label: 'Created', kind: 'created' }
        ]
      },
      serverFilters: function () {
        return withCreated({
          name: textFilter('Pipeline'),
          stage_count: { single: true, options: rangeOptions(COUNT_RANGES) },
          opportunity_count: { single: true, options: rangeOptions(COUNT_RANGES) },
          total_value: { single: true, options: rangeOptions(VALUE_RANGES) }
        });
      }
    },
    funnel: {
      endpoint: '/api/v1/leadly/funnels',
      listKey: 'funnels',
      mapRow: funnelRow,
      spec: {
        id: 'leadlyFunnelsTable',
        title: 'Funnels',
        noun: ['funnel', 'funnels'],
        searchPlaceholder: 'Search funnels...',
        emptyText: 'No funnels synced yet',
        filteredEmptyText: 'No matching funnels. Try a different search or clear the filters.',
        light: true,
        serverPaging: true,
        sortBy: 'created_at',
        sortDir: 'desc',
        minWidth: 820,
        columns: [
          { key: 'name', label: 'Funnel', kind: 'name' },
          { key: 'category', label: 'Category', kind: 'enum', width: '160px' },
          { key: 'step_count', label: 'Steps', kind: 'number', width: '100px', ranges: COUNT_RANGES },
          { key: 'status', label: 'Status', kind: 'badge', width: '120px', options: FUNNEL_STATUS_OPTIONS, colors: FUNNEL_STATUS_COLORS },
          { key: 'created_at', label: 'Created', kind: 'created' }
        ]
      },
      serverFilters: function () {
        return withCreated({
          name: textFilter('Funnel'),
          category: textFilter('Category'),
          step_count: { single: true, options: rangeOptions(COUNT_RANGES) },
          status: { options: FUNNEL_STATUS_OPTIONS }
        });
      }
    }
  };

  // Table column -> sort_by the API is asked for (its allow-list must match).
  var SORT_BY_COLUMN = {
    name: 'name',
    email: 'email',
    phone: 'phone',
    company: 'company',
    status: 'status',
    monetary_value: 'monetary_value',
    stage_name: 'stage_name',
    stage_count: 'stage_count',
    opportunity_count: 'opportunity_count',
    total_value: 'total_value',
    category: 'category',
    step_count: 'step_count',
    created_at: 'created_at'
  };

  function setRange(params, values, list, minName, maxName) {
    var picked = list.filter(function (r) { return r.value === values[0]; })[0];
    if (!picked) return;
    if (picked.min !== null && picked.min !== undefined) params.set(minName, String(picked.min));
    if (picked.max !== null && picked.max !== undefined) params.set(maxName, String(picked.max));
  }

  /**
   * GET /api/v1/leadly/<type> parameters: page, limit (max 100), search,
   * sort_by/sort_order, and one parameter per column filter.
   * @param {string} type - OUTPUT_TYPES key
   * @param {Object} query - lex-table server query
   * @param {Object} [context] - { now }
   * @returns {URLSearchParams}
   */
  function outputParams(type, query, context) {
    var q = query || {};
    var ctx = context || {};
    var filters = q.filters || {};
    var request = helpers().offsetRequest(q, 100);
    var params = new URLSearchParams();
    params.set('page', String(Math.floor(request.offset / request.limit) + 1));
    params.set('limit', String(request.limit));
    if (q.search) params.set('search', String(q.search).trim());
    params.set('sort_by', SORT_BY_COLUMN[q.sortBy] || 'created_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');

    ['name', 'email', 'phone', 'company', 'stage_name', 'category'].forEach(function (key) {
      var value = filterValues(filters[key])[0];
      if (value) params.set(key, value);
    });
    var statuses = filterValues(filters.status);
    if (statuses.length) params.set('status', statuses.join(','));
    var value = filterValues(filters.monetary_value);
    if (value.length) setRange(params, value, VALUE_RANGES, 'min_value', 'max_value');
    var total = filterValues(filters.total_value);
    if (total.length) setRange(params, total, VALUE_RANGES, 'min_total_value', 'max_total_value');
    ['stage_count', 'opportunity_count', 'step_count'].forEach(function (key) {
      var picked = filterValues(filters[key]);
      if (picked.length) setRange(params, picked, COUNT_RANGES, 'min_' + key, 'max_' + key);
    });
    var created = filterValues(filters.created_at)[0];
    var r = ranges();
    if (created && r) {
      var bounds = r.editedRangeBounds(created, ctx.now);
      if (bounds.after) params.set('created_after', bounds.after);
      if (bounds.before) params.set('created_before', bounds.before);
    }
    return params;
  }

  /** The API answer -> rows and setServerData pagination. */
  function outputResult(type, response, query) {
    var config = OUTPUT_TYPES[type];
    var list = (response && config && Array.isArray(response[config.listKey])) ? response[config.listKey] : [];
    var rows = list.map(config.mapRow);
    return { rows: rows, pagination: helpers().pagePagination(response && response.pagination, query, rows.length) };
  }

  // ── Logs tab: Job History (client-side) ────────────────────────────────

  var ACTIVE_JOB_STATUSES = ['started', 'starting', 'running', 'queued'];

  var JOB_STATUS_OPTIONS = [
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'pending', label: 'Pending' }
  ];

  var JOB_STATUS_COLORS = { completed: 'green', failed: 'red', cancelled: 'gray', pending: 'yellow', partial: 'yellow' };

  var JOB_TYPE_OPTIONS = [
    { value: 'sync', label: 'Leadly CRM sync' },
    { value: 'document', label: 'Document import' }
  ];

  function seconds(from, to) {
    if (!from || !to) return null;
    var diff = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
    return Number.isFinite(diff) && diff >= 0 ? Math.round(diff) : null;
  }

  /** A Leadly sync log as a Job History row (raw values; the page's job object kept). */
  function syncJobRow(log) {
    var l = log || {};
    var job = {
      id: l.id,
      filename: (l.sync_type ? kit().label(l.sync_type) : 'Full') + ' sync',
      job_type: 'Leadly CRM Sync',
      status: l.status,
      created_at: l.started_at,
      completed_at: l.completed_at,
      processed_count: l.records_fetched || l.records_processed || 0,
      error_message: l.error_message,
      _isSync: true,
      details: {
        records_created: l.records_created || 0,
        records_updated: l.records_updated || 0,
        records_failed: l.records_failed || 0
      }
    };
    return {
      id: 'sync-' + String(l.id != null ? l.id : ''),
      name: job.filename,
      type: 'sync',
      status: String(l.status || '').toLowerCase(),
      processed: Number(job.processed_count) || 0,
      duration: seconds(l.started_at, l.completed_at),
      error_message: l.error_message || '',
      completed_at: l.completed_at || '',
      created_at: l.started_at || l.created_at || '',
      _job: job,
      _raw: l
    };
  }

  /** A Leadly document import as a Job History row. */
  function documentJobRow(doc) {
    var d = doc || {};
    var job = {
      id: d.id,
      filename: d.original_filename || d.filename,
      job_type: 'Document Import',
      status: d.status,
      created_at: d.created_at,
      completed_at: d.updated_at,
      processed_count: 1,
      error_message: d.error_message,
      _isDocument: true,
      details: { matter_id: d.matter_id, document_id: d.document_id, file_size: d.file_size }
    };
    return {
      id: 'doc-' + String(d.id != null ? d.id : ''),
      name: job.filename || '',
      type: 'document',
      status: String(d.status || '').toLowerCase(),
      processed: 1,
      duration: seconds(d.created_at, d.updated_at),
      error_message: d.error_message || '',
      matter_id: d.matter_id || '',
      completed_at: d.updated_at || '',
      created_at: d.created_at || '',
      _job: job,
      _raw: d
    };
  }

  /** Finished sync logs and document imports (active ones show under Active Jobs). */
  function jobHistoryRows(logs, documents) {
    return (logs || []).map(syncJobRow).concat((documents || []).map(documentJobRow))
      .filter(function (row) { return ACTIVE_JOB_STATUSES.indexOf(row.status) === -1; });
  }

  function jobHistorySpec() {
    var h = helpers();
    var k = kit();
    return {
      id: 'leadlyJobHistoryTable',
      title: 'Job history',
      noun: ['job', 'jobs'],
      searchPlaceholder: 'Search jobs...',
      emptyText: 'No job history yet',
      filteredEmptyText: 'No matching jobs. Try a different search or clear the filters.',
      light: true,
      sortBy: 'created_at',
      sortDir: 'desc',
      minWidth: 980,
      searchKeys: 'name,error_message',
      mainFilter: { key: 'status', label: 'Status', options: JOB_STATUS_OPTIONS },
      columns: [
        {
          key: 'name', label: 'Job', kind: 'name',
          render: function (value, row) {
            var html = k.cells.name(value);
            if (row && row.error_message) html += '<div class="text-xs mt-1" style="color: var(--lex-status-danger-text, #b42318)" title="' + k.esc(row.error_message) + '">' + k.esc(row.error_message) + '</div>';
            return html;
          }
        },
        { key: 'type', label: 'Type', kind: 'enum', width: '160px', options: JOB_TYPE_OPTIONS, labels: { sync: 'Leadly CRM sync', document: 'Document import' } },
        { key: 'status', label: 'Status', kind: 'badge', width: '120px', options: JOB_STATUS_OPTIONS, colors: JOB_STATUS_COLORS },
        { key: 'processed', label: 'Processed', kind: 'number', width: '120px', ranges: h.COUNT_RANGES },
        {
          key: 'duration', label: 'Duration', kind: 'number', width: '110px', ranges: h.DURATION_RANGES,
          render: function (value) {
            var text = h.formatDuration(value);
            return text ? '<span class="rtk-num">' + k.esc(text) + '</span>' : k.muted('');
          }
        },
        { key: 'completed_at', label: 'Finished', kind: 'relative', width: '130px' },
        { key: 'created_at', label: 'Created', kind: 'created' }
      ]
    };
  }

  /**
   * Every row of an offset-paged list: fetchPage(limit, offset) resolves to
   * an array; rows are de-duplicated by id; stops at a short page or a page
   * with nothing new. truncated = maxPages reached.
   */
  async function fetchAllOffsetPages(fetchPage, pageSize, maxPages) {
    var limit = pageSize || 100;
    var pages = maxPages || 20;
    var all = [];
    var seen = {};
    for (var page = 0; page < pages; page += 1) {
      var rows = await fetchPage(limit, page * limit);
      var list = Array.isArray(rows) ? rows : [];
      var added = 0;
      list.forEach(function (row) {
        var key = row && row.id != null ? String(row.id) : null;
        if (key !== null && seen[key]) return;
        if (key !== null) seen[key] = true;
        all.push(row);
        added += 1;
      });
      // A short page ends the list; a page of rows already seen means the
      // API ignored offset, so stop instead of repeating it.
      if (list.length < limit || added === 0) return { rows: all, truncated: false };
    }
    return { rows: all, truncated: true };
  }

  var moduleApi = {
    OUTPUT_TYPES: OUTPUT_TYPES,
    SORT_BY_COLUMN: SORT_BY_COLUMN,
    VALUE_RANGES: VALUE_RANGES,
    COUNT_RANGES: COUNT_RANGES,
    outputParams: outputParams,
    outputResult: outputResult,
    contactRow: contactRow,
    opportunityRow: opportunityRow,
    pipelineRow: pipelineRow,
    funnelRow: funnelRow,
    ACTIVE_JOB_STATUSES: ACTIVE_JOB_STATUSES,
    JOB_STATUS_OPTIONS: JOB_STATUS_OPTIONS,
    JOB_TYPE_OPTIONS: JOB_TYPE_OPTIONS,
    syncJobRow: syncJobRow,
    documentJobRow: documentJobRow,
    jobHistoryRows: jobHistoryRows,
    jobHistorySpec: jobHistorySpec,
    fetchAllOffsetPages: fetchAllOffsetPages
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaLeadlyTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
