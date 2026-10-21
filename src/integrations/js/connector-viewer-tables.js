/**
 * connector-viewer-tables.js
 * Specs, rows and query mapping for the Connector Viewer's record tables
 * (integrations/connector-viewer.html), built by LanaRecordTableKit:
 *   - Synced data (connectorDataTable): server-paged
 *     GET .../integration-sources/:id/data
 *   - Grouped collections (connectorGroupsTable): client-side, every group
 *     from GET .../data/groups (no cap)
 *   - Sync logs (connectorLogsTable): client-side, every page of
 *     GET .../logs (the endpoint pages but cannot sort or filter)
 * See docs/TABLE-STANDARD.md.
 *
 * Public API (window.LanaConnectorViewerTables, or module.exports in Node):
 *   - UNASSIGNED, HEALTH_OPTIONS, NOTES_OPTIONS, LOG_PAGE_SIZE, LOG_MAX_PAGES
 *   - dataRow(record)                       -> row (raw values)
 *   - dataParams(query, context)            -> URLSearchParams for .../data
 *   - selectionSignature(params)            -> what a selection depends on (no paging/sort)
 *   - entityOptions(entities)               -> [{ value, label }]
 *   - matterOptions(matters)                -> [{ value, label }] incl. Unassigned
 *   - dataColumns(context)                  -> kit columns for the synced data table
 *   - dataServerFilters(entities, matters)  -> setColumnFilterOptions map (server table)
 *   - groupRow(group, index), groupColumns()
 *   - loadAllLogs(fetchPage, pageSize, maxPages) -> Promise<{ logs, total, truncated }>
 *   - logColumns()
 */

(function (global) {
  'use strict';

  var UNASSIGNED = '__unassigned__';
  var LOG_PAGE_SIZE = 100;
  var LOG_MAX_PAGES = 20;

  var HEALTH_OPTIONS = [
    { value: 'clean', label: 'Clean' },
    { value: 'corrected', label: 'Corrected' },
    { value: 'flagged', label: 'Flagged' }
  ];

  var NOTES_OPTIONS = [
    { value: 'none', label: 'No notes' },
    { value: 'has', label: 'Has notes' }
  ];

  function kit() {
    if (global && global.LanaRecordTableKit) return global.LanaRecordTableKit;
    if (typeof require === 'function') {
      try { return require('../../insights/js/record-table-kit.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function tables() {
    if (global && global.LanaIntegrationTables) return global.LanaIntegrationTables;
    if (typeof require === 'function') {
      try { return require('./integration-tables.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function filterValues(filter) {
    var t = tables();
    return t ? t.filterValues(filter) : [];
  }

  // ── Synced data ────────────────────────────────────────────────────────

  function healthOf(record) {
    if (record.has_flags || Number(record.flag_count) > 0) return 'flagged';
    if (record.has_corrections) return 'corrected';
    return 'clean';
  }

  function dataRow(record) {
    var r = record || {};
    return {
      id: r.id != null ? String(r.id) : '',
      select: '',
      entity_type: r.entity_type || '',
      external_id: r.external_id != null ? String(r.external_id) : '',
      matter_name: r.matter_name || '',
      matter_id: r.matter_id || '',
      health: healthOf(r),
      annotation_count: Number(r.annotation_count) || 0,
      created_at: r.source_created_at || '',
      synced_at: r.synced_at || '',
      actions: '',
      _raw: r
    };
  }

  /**
   * lex-table query -> .../data params. The Matter, Health and Notes column
   * filters become filter rules here; context.rules are the page's
   * hand-built field rules (data.* paths), sent as they are.
   * @param {Object} query - { page, limit, sortBy, sortDir, search, filters }
   * @param {Object} [context] - { search, rules }
   */
  function dataParams(query, context) {
    var q = query || {};
    var ctx = context || {};
    var filters = Object.assign({}, q.filters || {});
    var rules = (ctx.rules || []).slice();

    var matters = filterValues(filters.matter_name);
    delete filters.matter_name;
    var assigned = matters.filter(function (v) { return v !== UNASSIGNED; });
    if (assigned.length) {
      // The API cannot OR "unassigned" with matter ids; a mixed choice keeps the ids.
      rules.push({ field: 'matter_id', operator: 'in', value: assigned });
    } else if (matters.length) {
      rules.push({ field: 'matter_id', operator: 'not_exists' });
    }

    var health = filterValues(filters.health)[0];
    delete filters.health;
    if (health === 'clean') {
      rules.push({ field: 'has_corrections', operator: 'equals', value: 'false' });
      rules.push({ field: 'has_flags', operator: 'equals', value: 'false' });
    } else if (health === 'corrected') {
      rules.push({ field: 'has_corrections', operator: 'equals', value: 'true' });
    } else if (health === 'flagged') {
      rules.push({ field: 'has_flags', operator: 'equals', value: 'true' });
    }

    var notes = filterValues(filters.annotation_count)[0];
    delete filters.annotation_count;
    if (notes === 'none') rules.push({ field: 'annotation_count', operator: 'equals', value: '0' });
    if (notes === 'has') rules.push({ field: 'annotation_count', operator: 'not_equals', value: '0' });

    var mapped = Object.assign({}, q, { filters: filters });
    var search = ctx.search !== undefined ? ctx.search : q.search;
    return tables().connectorDataParams(mapped, { search: search || '', extraFilters: rules });
  }

  /** The parts of the request a bulk selection depends on (not paging or sort). */
  function selectionSignature(params) {
    var p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '');
    return JSON.stringify([p.get('q') || '', p.get('entity_type') || '', p.get('filters') || '']);
  }

  function entityOptions(entities) {
    var k = kit();
    var keys = Array.isArray(entities) ? entities : Object.keys(entities || {});
    return keys.filter(Boolean).map(String).sort().map(function (key) {
      return { value: key, label: k ? k.label(key) : key };
    });
  }

  function matterOptions(matters) {
    var options = (matters || []).filter(function (m) { return m && m.id; }).map(function (m) {
      return { value: String(m.id), label: String(m.name || m.matter_id || m.client_name || 'Matter') };
    }).sort(function (a, b) { return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }); });
    return [{ value: UNASSIGNED, label: 'Unassigned' }].concat(options);
  }

  /**
   * @param {Object} context - { isSelected(id), allFiltered(), isOpen(id) }
   */
  function dataColumns(context) {
    var ctx = context || {};
    var k = kit();
    var esc = k ? k.esc : String;
    function selectedMarker(id) {
      return ctx.isOpen && ctx.isOpen(id) ? '<span data-rtk-selected hidden></span>' : '';
    }
    return [
      {
        key: 'select', label: '', kind: 'html', width: '44px', sortable: false,
        render: function (_v, row) {
          var checked = (ctx.allFiltered && ctx.allFiltered()) || (ctx.isSelected && ctx.isSelected(row.id));
          return '<input type="checkbox" data-select-row="' + esc(row.id) + '" aria-label="Select row"' + (checked ? ' checked' : '') + '>' + selectedMarker(row.id);
        }
      },
      { key: 'entity_type', label: 'Entity', kind: 'enum', width: '150px' },
      { key: 'external_id', label: 'External ID', kind: 'code' },
      { key: 'matter_name', label: 'Matter', kind: 'matter', matterKey: 'matter_id', width: '20%', sortable: false },
      {
        key: 'health', label: 'Health', kind: 'badge', width: '130px', sortable: false,
        render: function (value, row) {
          var raw = (row && row._raw) || {};
          if (value === 'flagged') {
            var count = Number(raw.flag_count) || 0;
            return '<lex-badge label="' + esc(count > 1 ? 'Flagged ×' + count : 'Flagged') + '" color="yellow"></lex-badge>' +
              (raw.has_corrections ? ' <lex-badge label="Corrected" color="blue"></lex-badge>' : '');
          }
          if (value === 'corrected') return '<lex-badge label="Corrected" color="blue"></lex-badge>';
          return '<lex-badge label="Clean" color="green"></lex-badge>';
        }
      },
      { key: 'annotation_count', label: 'Notes', kind: 'number', width: '96px' },
      { key: 'created_at', label: 'Created', kind: 'created' },
      { key: 'synced_at', label: 'Synced', kind: 'relative', width: '130px' },
      {
        key: 'actions', label: 'Actions', kind: 'actions', width: '150px',
        render: function (_v, row) {
          if (!k) return '';
          return '<span class="rtk-actions">' + k.actionButton('inspect', row.id, 'Inspect') + k.actionButton('flag', row.id, 'Flag') + '</span>';
        }
      }
    ];
  }

  // Sort by: the data endpoint sorts these.
  var DATA_SORTABLE = 'entity_type,external_id,annotation_count,created_at,synced_at';

  /**
   * Header filters for the server-paged data table. Created and Synced have
   * none: the endpoint has no date-range operators (backend gap).
   */
  function dataServerFilters(entities, matters) {
    return {
      entity_type: { options: entityOptions(entities) },
      external_id: { text: true, placeholder: 'External ID contains...' },
      matter_name: { options: matterOptions(matters) },
      health: { single: true, options: HEALTH_OPTIONS },
      annotation_count: { single: true, options: NOTES_OPTIONS }
    };
  }

  // ── Grouped collections ────────────────────────────────────────────────

  function groupRow(group, index) {
    var g = group || {};
    return {
      id: g.group_key ? String(g.group_key) : 'group-' + index,
      name: g.label || g.sheet_name || g.source_collection_name || g.entity_type || '',
      group_type: g.group_type || '',
      entity_type: g.entity_type || '',
      row_count: Number(g.row_count) || 0,
      assigned_count: g.assigned_count == null ? null : Number(g.assigned_count),
      matter: g.assigned_matter_name || '',
      matter_id: g.assigned_matter_id || '',
      last_synced_at: g.last_synced_at || '',
      actions: '',
      _raw: g
    };
  }

  function groupColumns() {
    var k = kit();
    var t = tables();
    var counts = t ? t.COUNT_RANGES : undefined;
    return [
      { key: 'name', label: 'Group', kind: 'name' },
      { key: 'group_type', label: 'Type', kind: 'enum', width: '150px' },
      { key: 'entity_type', label: 'Entity', kind: 'enum', width: '130px' },
      { key: 'row_count', label: 'Rows', kind: 'number', width: '96px', ranges: counts },
      { key: 'assigned_count', label: 'Assigned', kind: 'number', width: '110px', ranges: counts },
      { key: 'matter', label: 'Matter', kind: 'matter', matterKey: 'matter_id', width: '18%' },
      { key: 'last_synced_at', label: 'Last synced', kind: 'relative', width: '130px' },
      {
        key: 'actions', label: 'Actions', kind: 'actions', width: '130px',
        render: function (_v, row) { return k ? k.actionButton('assign-group', row.id, 'Assign group') : ''; }
      }
    ];
  }

  // ── Sync logs ──────────────────────────────────────────────────────────

  /**
   * Every log, page by page. fetchPage(limit, offset) resolves to the
   * endpoint's { logs, pagination: { total } }. Stops at the total, a short
   * page, or maxPages (then truncated is true).
   */
  async function loadAllLogs(fetchPage, pageSize, maxPages) {
    var limit = pageSize || LOG_PAGE_SIZE;
    var pages = maxPages || LOG_MAX_PAGES;
    var logs = [];
    var total = null;
    for (var page = 0; page < pages; page += 1) {
      var response = await fetchPage(limit, page * limit);
      var rows = response && Array.isArray(response.logs) ? response.logs : [];
      logs = logs.concat(rows);
      var reported = Number(response && response.pagination && response.pagination.total);
      if (Number.isFinite(reported)) total = reported;
      if (rows.length < limit) break;
      if (total !== null && logs.length >= total) break;
    }
    if (total === null) total = logs.length;
    return { logs: logs, total: total, truncated: logs.length < total };
  }

  /** @param {Object} [context] - { isOpen(id) } marks the open log's row */
  function logColumns(context) {
    var ctx = context || {};
    var t = tables();
    var columns = t.syncLogColumns({ error: true });
    columns.forEach(function (column) {
      if (column.key !== 'created_at') return;
      column.label = 'Created';
      var base = kit().cells.created;
      column.render = function (value, row) {
        return base(value) + (ctx.isOpen && ctx.isOpen(row.id) ? '<span data-rtk-selected hidden></span>' : '');
      };
    });
    return columns;
  }

  var moduleApi = {
    UNASSIGNED: UNASSIGNED,
    HEALTH_OPTIONS: HEALTH_OPTIONS,
    NOTES_OPTIONS: NOTES_OPTIONS,
    LOG_PAGE_SIZE: LOG_PAGE_SIZE,
    LOG_MAX_PAGES: LOG_MAX_PAGES,
    DATA_SORTABLE: DATA_SORTABLE,
    dataServerFilters: dataServerFilters,
    dataRow: dataRow,
    dataParams: dataParams,
    selectionSignature: selectionSignature,
    entityOptions: entityOptions,
    matterOptions: matterOptions,
    dataColumns: dataColumns,
    groupRow: groupRow,
    groupColumns: groupColumns,
    loadAllLogs: loadAllLogs,
    logColumns: logColumns
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaConnectorViewerTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
