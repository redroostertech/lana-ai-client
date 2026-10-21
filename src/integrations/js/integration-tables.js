/**
 * integration-tables.js
 * Query mapping and row mapping shared by the Integrations pages' record
 * tables (actionstep, connector-viewer, leadly, sync-status, connector-crm).
 * Table markup, renderers and filters come from LanaRecordTableKit
 * (../insights/js/record-table-kit.js). See docs/TABLE-STANDARD.md.
 *
 * Public API (window.LanaIntegrationTables, or module.exports in Node):
 *   - filterValues(filter)                       -> string[] a column filter selected
 *   - offsetRequest(query, max)                  -> { limit, offset }
 *   - offsetPagination(pagination, query, n)     -> { page, limit, total } for setServerData
 *   - pagePagination(pagination, query, n)       -> same, from { page, limit, total } APIs
 *   - SYNC_STATUS_OPTIONS, SYNC_STATUS_COLORS, normalizeSyncStatus(status)
 *   - syncLogRow(log)                            -> row (generic /logs shape)
 *   - syncLogColumns()                           -> kit columns for a sync history table
 *   - connectorSourceRow(connector), connectorSourceColumns(), scheduleOf(connector)
 *   - fieldMappingRow(mapping, i), FIELD_MAPPING_COLUMNS
 *   - CONNECTOR_DATA_SORT_BY_COLUMN
 *   - connectorDataParams(query, context)        -> GET .../integration-sources/:id/data params
 */

(function (global) {
  'use strict';

  function filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.values)) value = value.values;
    return (Array.isArray(value) ? value : [value])
      .map(function (item) { return String(item == null ? '' : item).trim(); })
      .filter(Boolean);
  }

  function pageOf(query) {
    var page = Number(query && query.page);
    return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  }

  /** lex-table query -> { limit, offset }, limit capped at max (default 100). */
  function offsetRequest(query, max) {
    var cap = Number(max) || 100;
    var limit = Number(query && query.limit);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    limit = Math.min(Math.floor(limit), cap);
    return { limit: limit, offset: (pageOf(query) - 1) * limit };
  }

  /** { total, limit, offset } from the API -> { page, limit, total }. */
  function offsetPagination(pagination, query, visibleCount) {
    var request = offsetRequest(query);
    var source = pagination || {};
    var limit = Number(source.limit) || request.limit;
    var offset = Number(source.offset);
    if (!Number.isFinite(offset)) offset = request.offset;
    var total = Number(source.total);
    return {
      page: Math.floor(offset / limit) + 1,
      limit: limit,
      total: Number.isFinite(total) ? total : offset + Number(visibleCount || 0)
    };
  }

  /** { page, limit|page_size, total, total_pages } from the API -> setServerData shape. */
  function pagePagination(pagination, query, visibleCount) {
    var source = pagination || {};
    var limit = Number(source.limit || source.page_size || source.pageSize) || Number(query && query.limit) || 20;
    var page = Number(source.page) || pageOf(query);
    var total = Number(source.total);
    return {
      page: page,
      limit: limit,
      total: Number.isFinite(total) ? total : (page - 1) * limit + Number(visibleCount || 0)
    };
  }

  // ── Sync logs ──────────────────────────────────────────────────────────

  var SYNC_STATUS_OPTIONS = [
    { value: 'completed', label: 'Completed' },
    { value: 'running', label: 'Running' },
    { value: 'queued', label: 'Queued' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  var SYNC_STATUS_COLORS = {
    completed: 'green',
    success: 'green',
    running: 'blue',
    started: 'blue',
    processing: 'blue',
    queued: 'yellow',
    pending: 'yellow',
    partial: 'yellow',
    failed: 'red',
    error: 'red',
    cancelled: 'gray'
  };

  function normalizeSyncStatus(status) {
    var value = String(status || '').trim().toLowerCase();
    if (value === 'success') return 'completed';
    if (value === 'started' || value === 'processing' || value === 'in_progress') return 'running';
    return value;
  }

  function durationSeconds(log) {
    if (log.duration_seconds != null && log.duration_seconds !== '') {
      var seconds = Number(log.duration_seconds);
      if (Number.isFinite(seconds)) return seconds;
    }
    if (log.duration_ms != null && log.duration_ms !== '') {
      var ms = Number(log.duration_ms);
      if (Number.isFinite(ms)) return Math.round(ms / 1000);
    }
    if (log.started_at && log.completed_at) {
      var diff = (new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000;
      if (Number.isFinite(diff) && diff >= 0) return Math.round(diff);
    }
    return null;
  }

  /** A generic connector sync log (GET .../logs or /integrations/sync-history) as a row. */
  function syncLogRow(log) {
    var l = log || {};
    var records = l.records || {};
    return {
      id: l.id != null ? String(l.id) : '',
      sync_type: l.sync_type || '',
      connector: l.connector_name || l.connector_id || '',
      status: normalizeSyncStatus(l.status || l.sync_status),
      processed: Number(records.processed != null ? records.processed : (l.records_processed != null ? l.records_processed : l.records_synced)) || 0,
      created: Number(records.created != null ? records.created : l.records_created) || 0,
      failed: Number(records.failed != null ? records.failed : l.records_failed) || 0,
      duration: durationSeconds(l),
      error_message: l.error_message || '',
      triggered_by: l.triggered_by || '',
      created_at: l.started_at || l.created_at || '',
      completed_at: l.completed_at || '',
      _raw: l
    };
  }

  var DURATION_RANGES = [
    { value: 'under_10s', label: 'Under 10 seconds', min: null, max: 10 },
    { value: '10s_1m', label: '10 seconds – 1 minute', min: 10, max: 60 },
    { value: '1m_10m', label: '1 – 10 minutes', min: 60, max: 600 },
    { value: 'over_10m', label: 'Over 10 minutes', min: 600, max: null },
    { value: 'none', label: 'Not finished' }
  ];

  var COUNT_RANGES = [
    { value: 'zero', label: 'None', min: null, max: 1 },
    { value: '1_100', label: '1 – 100', min: 1, max: 101 },
    { value: '101_1000', label: '101 – 1,000', min: 101, max: 1001 },
    { value: 'over_1000', label: 'Over 1,000', min: 1001, max: null }
  ];

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds === '') return '';
    var s = Number(seconds);
    if (!Number.isFinite(s)) return '';
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  /**
   * Kit columns for a sync history table. options.connector adds a Connector
   * column (cross-connector history); options.error adds the error text.
   */
  function syncLogColumns(options) {
    var opts = options || {};
    var kit = global.LanaRecordTableKit;
    var columns = [];
    if (opts.connector) columns.push({ key: 'connector', label: 'Connector', kind: 'name' });
    columns.push({ key: 'sync_type', label: 'Type', kind: 'enum', width: '120px' });
    columns.push({ key: 'status', label: 'Status', kind: 'badge', width: '120px', colors: SYNC_STATUS_COLORS });
    columns.push({ key: 'processed', label: 'Processed', kind: 'number', width: '120px', ranges: COUNT_RANGES });
    if (opts.created !== false) columns.push({ key: 'created', label: 'Records created', kind: 'number', width: '150px', ranges: COUNT_RANGES });
    columns.push({ key: 'failed', label: 'Failed', kind: 'number', width: '100px', ranges: COUNT_RANGES });
    columns.push({
      key: 'duration', label: 'Duration', kind: 'number', width: '110px', ranges: DURATION_RANGES,
      render: function (value) {
        var text = formatDuration(value);
        return text ? '<span class="rtk-num">' + text + '</span>' : (kit ? kit.muted('') : '—');
      }
    });
    if (opts.error) columns.push({ key: 'error_message', label: 'Error', kind: 'text', width: '22%' });
    columns.push({ key: 'created_at', label: 'Created', kind: 'created' });
    return columns;
  }

  // ── Connected sources: GET /api/v1/integrations/connectors ─────────────

  var CONNECTION_STATUS_COLORS = {
    connected: 'green',
    syncing: 'blue',
    error: 'red',
    disconnected: 'gray',
    pending: 'yellow'
  };

  var SCHEDULE_LABELS = {
    realtime: 'Real-time',
    hourly: 'Every hour',
    daily: 'Daily',
    weekly: 'Weekly',
    manual: 'Manual'
  };

  /** The page's schedule wording from a connector's config ('manual' when unset). */
  function scheduleOf(connector) {
    var config = (connector && connector.config) || {};
    if (config.sync_frequency) return String(config.sync_frequency);
    var minutes = Number(connector && connector.sync_interval_minutes);
    if (Number.isFinite(minutes) && minutes > 0) {
      if (minutes <= 60) return 'hourly';
      if (minutes <= 1440) return 'daily';
      return 'weekly';
    }
    return 'manual';
  }

  /** A connector from /integrations/connectors as a row (raw values). */
  function connectorSourceRow(connector) {
    var c = connector || {};
    var records = c.records != null ? c.records : c.record_count;
    return {
      id: c.id != null ? String(c.id) : '',
      name: c.instance_name && c.instance_name !== c.name ? c.name + ' · ' + c.instance_name : (c.name || c.source_name || ''),
      category: c.category || '',
      status: String(c.status || '').toLowerCase(),
      last_sync: c.last_sync || c.lastSync || '',
      records: records == null || records === '' ? null : Number(records),
      schedule: scheduleOf(c),
      created_at: c.created_at || '',
      actions: '',
      _raw: c
    };
  }

  function connectorSourceColumns() {
    var kit = global.LanaRecordTableKit;
    return [
      { key: 'name', label: 'Source', kind: 'name' },
      { key: 'category', label: 'Category', kind: 'enum', width: '140px' },
      { key: 'status', label: 'Status', kind: 'badge', width: '130px', colors: CONNECTION_STATUS_COLORS },
      { key: 'last_sync', label: 'Last sync', kind: 'relative', width: '140px' },
      { key: 'records', label: 'Records', kind: 'number', width: '110px', ranges: COUNT_RANGES.concat([{ value: 'none', label: 'Not reported' }]) },
      { key: 'schedule', label: 'Schedule', kind: 'enum', width: '130px', labels: SCHEDULE_LABELS },
      { key: 'created_at', label: 'Created', kind: 'created' },
      {
        key: 'actions', label: '', kind: 'actions', width: '120px',
        render: function (_value, row) {
          return kit ? kit.actionButton('sync', row.id, 'Sync now') : '';
        }
      }
    ];
  }

  // ── Field mappings: GET /api/v1/integrations/connectors/:id/field-mappings ─

  function fieldMappingRow(mapping, index) {
    var m = mapping || {};
    return {
      id: m.id != null ? String(m.id) : 'mapping-' + index,
      source: m.source || m.source_field || '',
      target: m.target || m.target_field || '',
      enabled: m.enabled ? 'enabled' : 'disabled',
      _raw: m
    };
  }

  var FIELD_MAPPING_COLUMNS = [
    { key: 'source', label: 'Source field', kind: 'name' },
    { key: 'target', label: 'Target field', kind: 'code', width: '35%' },
    { key: 'enabled', label: 'Enabled', kind: 'badge', width: '120px', colors: { enabled: 'green', disabled: 'gray' }, labels: { enabled: 'Enabled', disabled: 'Disabled' } }
  ];

  // ── Generic connector data: GET .../integration-sources/:id/data ───────

  // Table column -> the endpoint's sort_by allow-list (buildOrderBy).
  var CONNECTOR_DATA_SORT_BY_COLUMN = {
    entity_type: 'entity_type',
    external_id: 'external_id',
    synced_at: 'synced_at',
    source_created_at: 'source_created_at',
    created_at: 'source_created_at',
    source_updated_at: 'source_updated_at',
    annotation_count: 'annotation_count'
  };

  /**
   * @param {Object} query - lex-table server query
   * @param {Object} [context] - { search, entityType, matterId, extraFilters: [{field, operator, value}] }
   * @returns {URLSearchParams}
   */
  function connectorDataParams(query, context) {
    var q = query || {};
    var ctx = context || {};
    var filters = q.filters || {};
    var request = offsetRequest(q, 200);
    var params = new URLSearchParams();
    params.set('limit', String(request.limit));
    params.set('offset', String(request.offset));
    params.set('sort_by', CONNECTOR_DATA_SORT_BY_COLUMN[q.sortBy] || 'synced_at');
    params.set('sort_dir', q.sortDir === 'asc' ? 'asc' : 'desc');
    var search = ctx.search !== undefined ? ctx.search : q.search;
    if (search) params.set('q', String(search).trim());
    var entityTypes = filterValues(filters.entity_type);
    var entityType = ctx.entityType || (entityTypes.length === 1 ? entityTypes[0] : '');
    if (entityType) params.set('entity_type', entityType);
    if (ctx.matterId) params.set('matter_id', ctx.matterId);

    var rules = (ctx.extraFilters || []).slice();
    if (!ctx.entityType && entityTypes.length > 1) rules.push({ field: 'entity_type', operator: 'in', value: entityTypes });
    var externalId = filterValues(filters.external_id)[0];
    if (externalId) rules.push({ field: 'external_id', operator: 'contains', value: externalId });
    var matters = filterValues(filters.matter_name);
    if (matters.length) rules.push({ field: 'matter_id', operator: 'in', value: matters });
    var health = filterValues(filters.health);
    health.forEach(function (value) {
      if (value === 'corrected') rules.push({ field: 'has_corrections', operator: 'equals', value: 'true' });
      if (value === 'flagged') rules.push({ field: 'has_flags', operator: 'equals', value: 'true' });
    });
    if (rules.length) params.set('filters', JSON.stringify(rules));
    return params;
  }

  var moduleApi = {
    filterValues: filterValues,
    offsetRequest: offsetRequest,
    offsetPagination: offsetPagination,
    pagePagination: pagePagination,
    SYNC_STATUS_OPTIONS: SYNC_STATUS_OPTIONS,
    SYNC_STATUS_COLORS: SYNC_STATUS_COLORS,
    DURATION_RANGES: DURATION_RANGES,
    COUNT_RANGES: COUNT_RANGES,
    normalizeSyncStatus: normalizeSyncStatus,
    formatDuration: formatDuration,
    syncLogRow: syncLogRow,
    syncLogColumns: syncLogColumns,
    CONNECTION_STATUS_COLORS: CONNECTION_STATUS_COLORS,
    SCHEDULE_LABELS: SCHEDULE_LABELS,
    scheduleOf: scheduleOf,
    connectorSourceRow: connectorSourceRow,
    connectorSourceColumns: connectorSourceColumns,
    fieldMappingRow: fieldMappingRow,
    FIELD_MAPPING_COLUMNS: FIELD_MAPPING_COLUMNS,
    CONNECTOR_DATA_SORT_BY_COLUMN: CONNECTOR_DATA_SORT_BY_COLUMN,
    connectorDataParams: connectorDataParams
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaIntegrationTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
