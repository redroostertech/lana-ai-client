/**
 * actionstep-tables.js
 * Table specs, row mappers and query builders for the ActionStep connector
 * page (integrations/actionstep.html): the Matters, Participants, Tasks,
 * File notes and Documents tables (shown both in their own tabs and in the
 * Output tab) and the Job history table on the Logs tab.
 * Markup, renderers and toolbar wiring come from LanaRecordTableKit; paging
 * helpers from LanaIntegrationTables. See docs/TABLE-STANDARD.md.
 *
 * Entity tables are server-paged against
 *   GET /api/v1/generic-connectors/integration-sources/:id/data/<path>
 * ({ records, pagination: { total, limit, offset } }), documents against
 *   GET .../integration-sources/:id/documents ({ documents, pagination }).
 * Job history is client-side: every sync log, document import and finished
 * processing job, merged.
 *
 * Public API (window.LanaActionstepTables, or module.exports in Node):
 *   - ENTITY_TYPES                         -> ['matters', 'participants', 'tasks', 'notes', 'documents']
 *   - entityConfig(type)                   -> { path, listKey, noun, title }
 *   - entitySpec(type, options)            -> LanaRecordTableKit spec
 *   - entityRow(type, record)              -> row (raw values + _raw)
 *   - entityServerFilters(type)            -> setColumnFilterOptions map
 *   - entityParams(type, query)            -> URLSearchParams for the list API
 *   - entityPagination(response, query, n) -> { page, limit, total }
 *   - entityRecords(type, response)        -> the response's record array
 *   - syncJobRow(log), documentJobRow(doc), processingJobRow(job) -> job history rows
 *   - buildJobHistoryRows({ logs, documents, processingJobs }) -> rows
 *   - jobHistorySpec()                     -> kit spec (client-side)
 *   - fetchAllOffset(fetchPage, pageSize, maxPages) -> Promise<{ rows, truncated }>
 */

(function (global) {
  'use strict';

  var MAX_LIMIT = 100;

  function shared() {
    if (global && global.LanaIntegrationTables) return global.LanaIntegrationTables;
    if (typeof require === 'function') {
      try { return require('./integration-tables.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function dateRanges() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('../../js/shared/library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function filterValues(filter) {
    var helpers = shared();
    if (helpers) return helpers.filterValues(filter);
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
  }

  function first(filter) {
    return filterValues(filter)[0] || '';
  }

  function pick() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return '';
  }

  function numberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // ── Entity tables ───────────────────────────────────────────────────────

  var ENTITY_TYPES = ['matters', 'participants', 'tasks', 'notes', 'documents'];

  var MATTER_STATUS_OPTIONS = [
    { value: 'Active', label: 'Active' },
    { value: 'Pending', label: 'Pending' },
    { value: 'Closed', label: 'Closed' }
  ];
  var MATTER_STATUS_COLORS = { active: 'green', pending: 'yellow', closed: 'gray' };

  var TASK_STATUS_OPTIONS = [
    { value: 'Pending', label: 'Pending' },
    { value: 'In Progress', label: 'In progress' },
    { value: 'Complete', label: 'Complete' },
    { value: 'Cancelled', label: 'Cancelled' }
  ];
  var TASK_STATUS_COLORS = {
    complete: 'green', completed: 'green', 'in progress': 'blue', pending: 'yellow', overdue: 'red', cancelled: 'gray'
  };
  var TASK_STATUS_LABELS = { 'In Progress': 'In progress' };

  var PARTICIPANT_TYPE_OPTIONS = [
    { value: 'person', label: 'Person' },
    { value: 'company', label: 'Company' }
  ];

  var DOCUMENT_STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'processing', label: 'Processing' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' }
  ];
  var DOCUMENT_STATUS_COLORS = { completed: 'green', imported: 'green', processing: 'blue', pending: 'yellow', failed: 'red' };

  var TASK_DUE_OPTIONS = [
    { value: 'overdue', label: 'Overdue' },
    { value: 'has_due', label: 'Has a due date' },
    { value: 'none', label: 'No due date' }
  ];

  var FILE_SIZE_RANGES = [
    { value: 'under_100kb', label: 'Under 100 KB', min: null, max: 100 * 1024 },
    { value: '100kb_1mb', label: '100 KB – 1 MB', min: 100 * 1024, max: 1024 * 1024 },
    { value: '1mb_10mb', label: '1 MB – 10 MB', min: 1024 * 1024, max: 10 * 1024 * 1024 },
    { value: 'over_10mb', label: 'Over 10 MB', min: 10 * 1024 * 1024, max: null }
  ];

  var ENTITY_CONFIG = {
    matters: { path: '/data/matters', listKey: 'records', noun: ['matter', 'matters'], title: 'Matters' },
    participants: { path: '/data/participants', listKey: 'records', noun: ['participant', 'participants'], title: 'Participants' },
    tasks: { path: '/data/tasks', listKey: 'records', noun: ['task', 'tasks'], title: 'Tasks' },
    notes: { path: '/data/file-notes', listKey: 'records', noun: ['file note', 'file notes'], title: 'File notes' },
    documents: { path: '/documents', listKey: 'documents', noun: ['document', 'documents'], title: 'Documents' }
  };

  // Table column -> the list API's sort_by (see the backend gaps: the
  // restored routes must accept these).
  var SORT_BY_COLUMN = {
    matters: { name: 'matter_name', reference: 'file_reference', action_type: 'action_type_name', assigned_to: 'assigned_to_name', status: 'status', created_at: 'created_at' },
    participants: { name: 'display_name', email: 'email', phone: 'phone', location: 'city', participant_type: 'is_company', created_at: 'created_at' },
    tasks: { name: 'task_name', matter_name: 'matter_name', assigned_to: 'assigned_to_name', status: 'current_status', due_date: 'due_date', created_at: 'created_at' },
    notes: { note: 'note_text', matter_name: 'matter_name', entered_by: 'entered_by_name', source: 'source', created_at: 'note_timestamp' },
    documents: { name: 'filename', matter_name: 'matter_name', size: 'file_size', status: 'status', created_at: 'created_at' }
  };

  function entityConfig(type) {
    return ENTITY_CONFIG[type] || null;
  }

  function entityRow(type, record) {
    var r = record || {};
    var id = r.id != null ? String(r.id) : '';
    switch (type) {
      case 'matters':
        return {
          id: id,
          name: pick(r.matter_name, r.name),
          reference: pick(r.file_reference, r.reference),
          action_type: pick(r.action_type_name),
          assigned_to: pick(r.assigned_to_name, r.assigned_to_display_name),
          status: pick(r.status),
          created_at: pick(r.date_created, r.created_at),
          _raw: r
        };
      case 'participants': {
        var location = [r.city, r.state_province].filter(Boolean).join(', ');
        return {
          id: id,
          name: pick(r.display_name, r.company_name),
          email: pick(r.email),
          phone: pick(r.phone),
          location: location,
          participant_type: r.is_company ? 'company' : 'person',
          created_at: pick(r.as_created_at, r.created_at),
          _raw: r
        };
      }
      case 'tasks':
        return {
          id: id,
          name: pick(r.task_name),
          matter_name: pick(r.matter_name),
          assigned_to: pick(r.assigned_to_name),
          status: pick(r.current_status),
          due_date: pick(r.due_date),
          created_at: pick(r.as_created_at, r.created_at),
          _overdue: !r.completed_timestamp && !!r.due_date && new Date(r.due_date).getTime() < Date.now(),
          _raw: r
        };
      case 'notes':
        return {
          id: id,
          note: pick(r.note_text),
          matter_name: pick(r.matter_name),
          entered_by: pick(r.entered_by_name),
          source: pick(r.source),
          created_at: pick(r.note_timestamp, r.created_at),
          _raw: r
        };
      case 'documents':
        return {
          id: id,
          name: pick(r.original_filename, r.filename),
          matter_name: pick(r.matter_name),
          size: numberOrNull(r.file_size),
          status: pick(r.status),
          created_at: pick(r.created_at),
          _raw: r
        };
      default:
        return { id: id, _raw: r };
    }
  }

  function entityRecords(type, response) {
    var config = entityConfig(type);
    var list = response && config ? response[config.listKey] : null;
    return Array.isArray(list) ? list : [];
  }

  function formatBytes(bytes) {
    var n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var value = n / 1024;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return (Math.round(value * 10) / 10) + ' ' + units[unit];
  }

  function kit() {
    return global.LanaRecordTableKit;
  }

  function mutedHtml() {
    return kit() ? kit().muted('') : '—';
  }

  /**
   * options.id overrides the table id (the Output tab and the entity tabs
   * use different ids); options.light for the lighter in-panel toolbar.
   */
  function entitySpec(type, options) {
    var opts = options || {};
    var config = entityConfig(type);
    var base = {
      id: opts.id || ('actionstep' + type.charAt(0).toUpperCase() + type.slice(1) + 'Table'),
      title: config.title,
      noun: config.noun,
      ariaLabel: 'ActionStep ' + config.title.toLowerCase(),
      serverPaging: true,
      light: !!opts.light,
      sortBy: 'created_at',
      sortDir: 'desc',
      searchPlaceholder: 'Search ' + config.title.toLowerCase() + '...',
      filteredEmptyText: 'No matching ' + config.noun[1] + '. Try a different search or clear the filters.'
    };
    switch (type) {
      case 'matters':
        return Object.assign(base, {
          minWidth: 900,
          emptyText: 'No matters found. Click "Import CSV Data" to import from ActionStep.',
          mainFilter: { key: 'status', label: 'Status', options: MATTER_STATUS_OPTIONS },
          columns: [
            { key: 'name', label: 'Matter', kind: 'name' },
            { key: 'reference', label: 'File ref', kind: 'code', width: '130px' },
            { key: 'action_type', label: 'Type', kind: 'text', width: '16%' },
            { key: 'assigned_to', label: 'Assigned to', kind: 'text', width: '16%' },
            { key: 'status', label: 'Status', kind: 'badge', width: '110px', colors: MATTER_STATUS_COLORS },
            { key: 'created_at', label: 'Created', kind: 'created' }
          ]
        });
      case 'participants':
        return Object.assign(base, {
          minWidth: 900,
          emptyText: 'No participants found',
          columns: [
            { key: 'name', label: 'Name', kind: 'name' },
            { key: 'email', label: 'Email', kind: 'email', width: '20%' },
            { key: 'phone', label: 'Phone', kind: 'text', width: '130px' },
            { key: 'location', label: 'Location', kind: 'text', width: '15%' },
            { key: 'participant_type', label: 'Type', kind: 'badge', width: '110px', colors: { company: 'blue', person: 'gray' } },
            { key: 'created_at', label: 'Created', kind: 'created' }
          ]
        });
      case 'tasks':
        return Object.assign(base, {
          minWidth: 960,
          emptyText: 'No tasks found',
          mainFilter: { key: 'status', label: 'Status', options: TASK_STATUS_OPTIONS },
          columns: [
            { key: 'name', label: 'Task', kind: 'name' },
            { key: 'matter_name', label: 'Matter', kind: 'text', width: '18%' },
            { key: 'assigned_to', label: 'Assigned to', kind: 'text', width: '14%' },
            { key: 'status', label: 'Status', kind: 'badge', width: '120px', colors: TASK_STATUS_COLORS, labels: TASK_STATUS_LABELS },
            {
              key: 'due_date', label: 'Due', kind: 'date', width: '120px',
              render: function (value, row) {
                var cell = kit().cells.date(value);
                if (row && row._overdue) return '<span class="actionstep-overdue" title="Overdue">' + cell + '</span>';
                return cell;
              }
            },
            { key: 'created_at', label: 'Created', kind: 'created' }
          ]
        });
      case 'notes':
        return Object.assign(base, {
          minWidth: 900,
          emptyText: 'No file notes found',
          columns: [
            { key: 'note', label: 'Note', kind: 'name' },
            { key: 'matter_name', label: 'Matter', kind: 'text', width: '18%' },
            { key: 'entered_by', label: 'Entered by', kind: 'text', width: '14%' },
            { key: 'source', label: 'Source', kind: 'enum', width: '110px' },
            { key: 'created_at', label: 'Created', kind: 'created' }
          ]
        });
      case 'documents':
        return Object.assign(base, {
          minWidth: 820,
          emptyText: 'No documents found',
          columns: [
            { key: 'name', label: 'File', kind: 'name' },
            { key: 'matter_name', label: 'Matter', kind: 'text', width: '20%' },
            {
              key: 'size', label: 'Size', kind: 'number', width: '110px', ranges: FILE_SIZE_RANGES,
              render: function (value) {
                var text = formatBytes(value);
                return text ? '<span class="rtk-num">' + text + '</span>' : mutedHtml();
              }
            },
            { key: 'status', label: 'Status', kind: 'badge', width: '120px', colors: DOCUMENT_STATUS_COLORS },
            { key: 'created_at', label: 'Created', kind: 'created' }
          ]
        });
      default:
        return null;
    }
  }

  function textFilter(label) {
    return { text: true, placeholder: label + ' contains...' };
  }

  function createdFilter() {
    var r = dateRanges();
    return r ? { single: true, options: r.EDITED_RANGE_OPTIONS } : null;
  }

  /** Server-side column filters: every column of each entity table. */
  function entityServerFilters(type) {
    var map;
    switch (type) {
      case 'matters':
        map = {
          name: textFilter('Matter'), reference: textFilter('File ref'), action_type: textFilter('Type'),
          assigned_to: textFilter('Assigned to'), status: { options: MATTER_STATUS_OPTIONS }
        };
        break;
      case 'participants':
        map = {
          name: textFilter('Name'), email: textFilter('Email'), phone: textFilter('Phone'),
          location: textFilter('Location'), participant_type: { single: true, options: PARTICIPANT_TYPE_OPTIONS }
        };
        break;
      case 'tasks':
        map = {
          name: textFilter('Task'), matter_name: textFilter('Matter'), assigned_to: textFilter('Assigned to'),
          status: { options: TASK_STATUS_OPTIONS }, due_date: { single: true, options: TASK_DUE_OPTIONS }
        };
        break;
      case 'notes':
        map = {
          note: textFilter('Note'), matter_name: textFilter('Matter'), entered_by: textFilter('Entered by'),
          source: textFilter('Source')
        };
        break;
      case 'documents':
        map = {
          name: textFilter('File'), matter_name: textFilter('Matter'),
          size: { single: true, options: FILE_SIZE_RANGES.map(function (r) { return { value: r.value, label: r.label }; }) },
          status: { options: DOCUMENT_STATUS_OPTIONS }
        };
        break;
      default:
        map = {};
    }
    var created = createdFilter();
    if (created) map.created_at = created;
    return map;
  }

  // Column filter -> list API parameter (text "contains" unless noted).
  var FILTER_PARAM = {
    matters: { name: 'matter_name', reference: 'file_reference', action_type: 'action_type', assigned_to: 'assigned_to' },
    participants: { name: 'display_name', email: 'email', phone: 'phone', location: 'location' },
    tasks: { name: 'task_name', matter_name: 'matter_name', assigned_to: 'assigned_to' },
    notes: { note: 'note_text', matter_name: 'matter_name', entered_by: 'entered_by', source: 'source' },
    documents: { name: 'filename', matter_name: 'matter_name' }
  };

  function setRange(params, filter, now) {
    var r = dateRanges();
    var value = first(filter);
    if (!r || !value) return;
    var bounds = r.editedRangeBounds(value, now);
    if (bounds.after) params.set('created_after', bounds.after);
    if (bounds.before) params.set('created_before', bounds.before);
  }

  /**
   * lex-table server query -> list API params: page, limit (max 100),
   * search, sort_by/sort_order and one parameter per column filter.
   * @param {string} type
   * @param {Object} query - { page, limit, sortBy, sortDir, search, filters }
   * @param {Object} [context] - { now }
   * @returns {URLSearchParams}
   */
  function entityParams(type, query, context) {
    var q = query || {};
    var ctx = context || {};
    var filters = q.filters || {};
    var page = Math.max(1, Math.floor(Number(q.page) || 1));
    var limit = Math.min(Math.max(1, Math.floor(Number(q.limit) || 20)), MAX_LIMIT);
    var params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    params.set('offset', String((page - 1) * limit));
    var sortMap = SORT_BY_COLUMN[type] || {};
    var sortBy = sortMap[q.sortBy] || sortMap.created_at || 'created_at';
    params.set('sort_by', sortBy);
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    var search = String(q.search || '').trim();
    if (search) params.set('search', search);

    var textParams = FILTER_PARAM[type] || {};
    Object.keys(textParams).forEach(function (column) {
      var value = first(filters[column]);
      if (value) params.set(textParams[column], value);
    });

    var statuses = filterValues(filters.status);
    if (statuses.length) params.set('status', statuses.join(','));

    if (type === 'participants') {
      var kind = first(filters.participant_type);
      if (kind) params.set('is_company', kind === 'company' ? 'true' : 'false');
    }
    if (type === 'tasks') {
      var due = first(filters.due_date);
      if (due === 'overdue') params.set('overdue', 'true');
      else if (due === 'has_due') params.set('has_due_date', 'true');
      else if (due === 'none') params.set('has_due_date', 'false');
    }
    if (type === 'documents') {
      var size = FILE_SIZE_RANGES.filter(function (r) { return r.value === first(filters.size); })[0];
      if (size && size.min !== null) params.set('min_size', String(size.min));
      if (size && size.max !== null) params.set('max_size', String(size.max));
    }
    setRange(params, filters.created_at, ctx.now);
    return params;
  }

  function entityPagination(response, query, visibleCount) {
    var helpers = shared();
    var source = (response && response.pagination) || {};
    if (helpers) return helpers.offsetPagination(source, query, visibleCount);
    return { page: Number(query && query.page) || 1, limit: Number(source.limit) || 20, total: Number(source.total) || visibleCount || 0 };
  }

  // ── Job history (client-side) ──────────────────────────────────────────

  var JOB_TYPE_OPTIONS = [
    { value: 'sync', label: 'ActionStep sync' },
    { value: 'document_import', label: 'Document import' },
    { value: 'document_processing', label: 'Document processing' }
  ];
  var JOB_TYPE_LABELS = { sync: 'ActionStep sync', document_import: 'Document import', document_processing: 'Document processing' };

  function normalizeStatus(status) {
    var helpers = shared();
    return helpers ? helpers.normalizeSyncStatus(status) : String(status || '').toLowerCase();
  }

  function secondsBetween(start, end) {
    if (!start || !end) return null;
    var diff = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
    return Number.isFinite(diff) && diff >= 0 ? Math.round(diff) : null;
  }

  function syncJobRow(log) {
    var l = log || {};
    var records = l.records || {};
    var job = {
      id: l.id,
      filename: (l.sync_type ? String(l.sync_type).charAt(0).toUpperCase() + String(l.sync_type).slice(1) : 'Full') + ' sync',
      job_type: 'ActionStep Sync',
      status: l.status,
      created_at: l.started_at,
      completed_at: l.completed_at,
      processed_count: pick(records.processed, l.records_fetched, l.records_processed, 0),
      error_message: l.error_message,
      _isSync: true,
      details: {
        records_created: pick(records.created, l.records_created, 0),
        records_updated: pick(records.updated, l.records_updated, 0),
        records_failed: pick(records.failed, l.records_failed, 0)
      }
    };
    return {
      id: 'sync-' + (l.id != null ? l.id : ''),
      name: job.filename,
      job_type: 'sync',
      status: normalizeStatus(l.status),
      processed: Number(job.processed_count) || 0,
      duration: l.duration_seconds != null && Number.isFinite(Number(l.duration_seconds)) ? Number(l.duration_seconds) : secondsBetween(l.started_at, l.completed_at),
      error_message: l.error_message || '',
      created_at: l.started_at || '',
      _job: job,
      _raw: l
    };
  }

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
      id: 'doc-' + (d.id != null ? d.id : ''),
      name: job.filename || '',
      job_type: 'document_import',
      status: normalizeStatus(d.status),
      processed: 1,
      duration: secondsBetween(d.created_at, d.updated_at),
      error_message: d.error_message || '',
      created_at: d.created_at || '',
      _job: job,
      _raw: d
    };
  }

  function processingJobRow(job) {
    var j = job || {};
    var mapped = {
      id: j.id,
      filename: j.document_name,
      job_type: 'Document Processing',
      status: j.status,
      created_at: j.queued_at || j.created_at,
      completed_at: j.completed_at,
      processed_count: j.progress_percentage,
      error_message: j.error_message,
      _isProcessing: true,
      details: { progress: j.progress_percentage, strategy: j.processing_strategy, priority: j.priority }
    };
    return {
      id: 'proc-' + (j.id != null ? j.id : ''),
      name: j.document_name || '',
      job_type: 'document_processing',
      status: normalizeStatus(j.status),
      processed: numberOrNull(j.progress_percentage),
      duration: secondsBetween(mapped.created_at, j.completed_at),
      error_message: j.error_message || '',
      created_at: mapped.created_at || '',
      _job: mapped,
      _raw: j
    };
  }

  /** Finished jobs only: pending/processing ones show under Active jobs. */
  function buildJobHistoryRows(input) {
    var data = input || {};
    var rows = [];
    (data.logs || []).forEach(function (log) { rows.push(syncJobRow(log)); });
    (data.documents || []).forEach(function (doc) { rows.push(documentJobRow(doc)); });
    (data.processingJobs || []).forEach(function (job) {
      if (job && (job.status === 'pending' || job.status === 'processing')) return;
      rows.push(processingJobRow(job));
    });
    return rows;
  }

  function jobHistorySpec() {
    var helpers = shared();
    return {
      id: 'actionstepJobHistoryTable',
      title: 'All jobs',
      noun: ['job', 'jobs'],
      ariaLabel: 'Job history',
      light: true,
      sortBy: 'created_at',
      sortDir: 'desc',
      minWidth: 960,
      searchPlaceholder: 'Search jobs...',
      emptyText: 'No job history',
      filteredEmptyText: 'No matching jobs. Try a different search or clear the filters.',
      columns: [
        {
          key: 'name', label: 'Job', kind: 'name',
          render: function (value, row) {
            var k = kit();
            var html = k.cells.name(value || (row && row._job && row._job.id ? String(row._job.id).substring(0, 8) : ''));
            if (row && row.error_message) html += '<div class="actionstep-job-error" title="' + k.esc(row.error_message) + '">' + k.esc(row.error_message) + '</div>';
            return html;
          }
        },
        { key: 'job_type', label: 'Type', kind: 'enum', width: '170px', options: JOB_TYPE_OPTIONS, labels: JOB_TYPE_LABELS },
        { key: 'status', label: 'Status', kind: 'badge', width: '120px', colors: helpers ? helpers.SYNC_STATUS_COLORS : {} },
        { key: 'processed', label: 'Processed', kind: 'number', width: '120px', ranges: helpers ? helpers.COUNT_RANGES : undefined },
        {
          key: 'duration', label: 'Duration', kind: 'number', width: '110px', ranges: helpers ? helpers.DURATION_RANGES : undefined,
          render: function (value) {
            var text = helpers ? helpers.formatDuration(value) : '';
            return text ? '<span class="rtk-num">' + text + '</span>' : mutedHtml();
          }
        },
        { key: 'created_at', label: 'Created', kind: 'created' }
      ]
    };
  }

  /**
   * Every row of an offset-paged API. fetchPage(limit, offset) resolves to
   * { rows, total }; stops at the total, a short page, or maxPages (then
   * truncated is true so the page can say so).
   */
  async function fetchAllOffset(fetchPage, pageSize, maxPages) {
    var limit = pageSize || MAX_LIMIT;
    var pages = maxPages || 20;
    var all = [];
    for (var page = 0; page < pages; page += 1) {
      var result = await fetchPage(limit, page * limit);
      var rows = result && Array.isArray(result.rows) ? result.rows : [];
      all = all.concat(rows);
      var total = Number(result && result.total);
      if (rows.length < limit) return { rows: all, truncated: false };
      if (Number.isFinite(total) && total > 0 && all.length >= total) return { rows: all, truncated: false };
    }
    return { rows: all, truncated: true };
  }

  var moduleApi = {
    ENTITY_TYPES: ENTITY_TYPES,
    MATTER_STATUS_OPTIONS: MATTER_STATUS_OPTIONS,
    TASK_STATUS_OPTIONS: TASK_STATUS_OPTIONS,
    DOCUMENT_STATUS_OPTIONS: DOCUMENT_STATUS_OPTIONS,
    PARTICIPANT_TYPE_OPTIONS: PARTICIPANT_TYPE_OPTIONS,
    TASK_DUE_OPTIONS: TASK_DUE_OPTIONS,
    FILE_SIZE_RANGES: FILE_SIZE_RANGES,
    SORT_BY_COLUMN: SORT_BY_COLUMN,
    JOB_TYPE_OPTIONS: JOB_TYPE_OPTIONS,
    entityConfig: entityConfig,
    entitySpec: entitySpec,
    entityRow: entityRow,
    entityRecords: entityRecords,
    entityServerFilters: entityServerFilters,
    entityParams: entityParams,
    entityPagination: entityPagination,
    formatBytes: formatBytes,
    syncJobRow: syncJobRow,
    documentJobRow: documentJobRow,
    processingJobRow: processingJobRow,
    buildJobHistoryRows: buildJobHistoryRows,
    jobHistorySpec: jobHistorySpec,
    fetchAllOffset: fetchAllOffset
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaActionstepTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
