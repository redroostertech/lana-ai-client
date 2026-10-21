/**
 * metric-tables.js
 * Row mapping, filter options and toolbar wiring for the admin metric tables:
 * Metric Catalog (metricCatalogTable), Metric Detail (metricSnapshotsTable,
 * metricRawDataTable) and the Dashboard Library (dashboardLibraryTable).
 * All four are client-side lex-tables (docs/TABLE-STANDARD.md section 4):
 * each loads its whole set, so rows keep raw values and the table sorts,
 * filters and pages them.
 *
 * Public API (window.LanaMetricTables, or module.exports in Node):
 *   - humanizeLabel(value), capitalizeFirst(value)   -> label text
 *   - fetchAllPages(fetchPage, pageSize, maxPages)    -> Promise of every row
 *   - entityName(entry), normalizeEntityKey(name)
 *   - mapCatalogMetric(metric)                        -> catalog row
 *   - catalogFilterOptions(rows)                      -> setColumnFilterOptions map
 *   - catalogStatusColor(status), runStatusLabel(status)
 *   - sortableRunValue(value)
 *   - mapSnapshot(snapshot)                           -> snapshot row
 *   - snapshotFilterOptions(rows)
 *   - rawDataTable(rows, maxColumns)                  -> { columns, labels, rows, dateColumns }
 *   - mapDashboardRecord(record, index)               -> dashboard row
 *   - dashboardFilterOptions(rows)
 *   - createdRangeFilter()                            -> date range filter config
 *   - filteredRows(table)                             -> every row the table's filters/search keep
 *   - bindClientToolbar(table, ids, options)          -> wires search/sort/order/main filter/count
 */

(function (global) {
  'use strict';

  function utils() {
    return global && global.Lex && global.Lex.Utils ? global.Lex.Utils : null;
  }

  function capitalizeFirst(value) {
    var lexUtils = utils();
    if (lexUtils && typeof lexUtils.capitalizeFirst === 'function') return lexUtils.capitalizeFirst(value);
    var text = value === null || value === undefined ? '' : String(value);
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  // Enum or slug -> "Lead management". Registry keys also use dots
  // ("legal_firm.estate_planning"), which become spaces too.
  function humanizeLabel(value) {
    var text = value === null || value === undefined ? '' : String(value).split('.').join(' ');
    var lexUtils = utils();
    if (lexUtils && typeof lexUtils.humanizeLabel === 'function') return lexUtils.humanizeLabel(text);
    return capitalizeFirst(text.split('_').join(' ').split('-').join(' ').split(' ').filter(Boolean).join(' '));
  }

  function isBlank(value) {
    return value === null || value === undefined || value === '';
  }

  /**
   * Every row of an offset-paged API. fetchPage(limit, offset) resolves to
   * { rows, total }; paging stops at the total, a short page, or maxPages.
   */
  async function fetchAllPages(fetchPage, pageSize, maxPages) {
    var limit = pageSize || 100;
    var pages = maxPages || 50;
    var all = [];
    var first = null;
    for (var page = 0; page < pages; page += 1) {
      var result = await fetchPage(limit, page * limit);
      if (!first) first = result;
      var rows = (result && Array.isArray(result.rows)) ? result.rows : [];
      all = all.concat(rows);
      var total = Number(result && result.total);
      if (!rows.length || rows.length < limit) break;
      if (Number.isFinite(total) && all.length >= total) break;
    }
    return { rows: all, first: first };
  }

  // ---------------------------------------------------------------------------
  // Metric Catalog
  // ---------------------------------------------------------------------------

  // Registry entity entries come as strings or objects
  // ({ "Entity Type": "Feedback", ... }, { name }, { key }).
  function entityName(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      var keys = ['Entity Type', 'entityType', 'entity_type', 'name', 'entity', 'key', 'id', 'type', 'label'];
      for (var i = 0; i < keys.length; i++) {
        if (Object.prototype.hasOwnProperty.call(value, keys[i]) && value[keys[i]]) {
          return String(value[keys[i]]);
        }
      }
    }
    return String(value);
  }

  // "Calendar Event", "calendar event" and "calendar_event" are one entity.
  function normalizeEntityKey(name) {
    return String(name == null ? '' : name)
      .trim()
      .toLowerCase()
      .replace(/[\s.\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  // A numeric (or null) for sorting the Value column from a run result.
  function sortableRunValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
      var asNum = Number(value);
      return value.trim() !== '' && isFinite(asNum) ? asNum : null;
    }
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'object') {
      var candidates = ['value', 'total', 'count', 'amount', 'rate', 'percentage', 'percent'];
      for (var i = 0; i < candidates.length; i++) {
        if (Object.prototype.hasOwnProperty.call(value, candidates[i])) {
          return sortableRunValue(value[candidates[i]]);
        }
      }
    }
    return null;
  }

  var RUN_STATUS_LABELS = { never: 'Never run', pending: 'Running', pass: 'Pass', fail: 'Fail' };

  function runStatusLabel(status) {
    return RUN_STATUS_LABELS[status] || humanizeLabel(status);
  }

  function catalogStatusColor(status) {
    var lower = String(status || '').toLowerCase();
    if (lower.indexOf('active') !== -1) return 'green';
    if (lower.indexOf('planned') !== -1) return 'yellow';
    return 'gray';
  }

  /**
   * A catalog row keeps the registry record (the drawers read it) plus raw
   * column values: domain/audience/status codes, executable as a boolean,
   * entity keys as an array. Run and goal columns start empty and are
   * stamped by the page as runs finish and goals load.
   */
  function mapCatalogMetric(metric) {
    var record = metric || {};
    var entities = Array.isArray(record.entities) ? record.entities : [];
    var entityKeys = [];
    entities.forEach(function (entry) {
      var key = normalizeEntityKey(entityName(entry));
      if (key && entityKeys.indexOf(key) === -1) entityKeys.push(key);
    });
    return Object.assign({}, record, {
      id: record.key,
      display_name: record.display_name || record.title || record.name || record.key,
      domain: record.domain || '',
      audience: record.primaryAudience || record.primary_audience || '',
      entity_keys: entityKeys,
      status: record.status || '',
      executable: record.executable === true,
      last_run_status: 'never',
      last_run_value: null,
      goal_target: null,
      actions: '',
      _raw: record
    });
  }

  function distinct(rows, key) {
    var seen = {};
    var values = [];
    (rows || []).forEach(function (row) {
      var value = row && row[key];
      (Array.isArray(value) ? value : [value]).forEach(function (item) {
        if (isBlank(item)) return;
        var text = String(item);
        if (seen[text]) return;
        seen[text] = true;
        values.push(text);
      });
    });
    return values;
  }

  function labelledOptions(values, labelFn) {
    return values
      .map(function (value) { return { value: value, label: labelFn(value) }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }); });
  }

  function textFilter(placeholder) {
    return { text: true, placeholder: placeholder };
  }

  function createdRangeFilter() {
    var ranges = global && global.LanaLibraryColumnFilters;
    if (!ranges) return null;
    return {
      single: true,
      options: ranges.EDITED_RANGE_OPTIONS,
      match: function (cell, values) { return ranges.inEditedRange(cell, values[0]); }
    };
  }

  // Numeric value ranges for client tables: "Has a value" / "No value".
  var VALUE_PRESENCE_OPTIONS = [
    { value: 'has_value', label: 'Has a value' },
    { value: 'no_value', label: 'No value' }
  ];

  function valuePresenceFilter() {
    return {
      single: true,
      options: VALUE_PRESENCE_OPTIONS,
      match: function (cell, values) {
        var has = !isBlank(cell);
        return values[0] === 'no_value' ? !has : has;
      }
    };
  }

  function catalogFilterOptions(rows) {
    return {
      display_name: textFilter('Name contains...'),
      domain: { options: labelledOptions(distinct(rows, 'domain'), humanizeLabel) },
      audience: { options: labelledOptions(distinct(rows, 'audience'), humanizeLabel) },
      entity_keys: {
        options: labelledOptions(distinct(rows, 'entity_keys'), humanizeLabel),
        match: function (cell, values) {
          var keys = Array.isArray(cell) ? cell : [];
          return values.some(function (value) { return keys.indexOf(value) !== -1; });
        }
      },
      status: { options: labelledOptions(distinct(rows, 'status'), humanizeLabel) },
      executable: { options: [{ value: 'true', label: 'Executable' }, { value: 'false', label: 'Planned' }] },
      last_run_status: {
        options: ['never', 'pending', 'pass', 'fail'].map(function (value) {
          return { value: value, label: runStatusLabel(value) };
        })
      },
      last_run_value: valuePresenceFilter(),
      goal_target: {
        single: true,
        options: [{ value: 'has_value', label: 'Goal set' }, { value: 'no_value', label: 'No goal' }],
        match: valuePresenceFilter().match
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Metric Detail
  // ---------------------------------------------------------------------------

  /** A captured snapshot: raw timestamps and the numeric value. */
  function mapSnapshot(snapshot, index) {
    var record = snapshot || {};
    var value = record.value_numeric;
    return {
      id: record.snapshot_id || record.observation_id || ('snapshot-' + (index || 0)),
      created_at: record.captured_at || record.computed_at || record.created_at || '',
      value: value === null || value === undefined || value === '' || !isFinite(Number(value)) ? null : Number(value),
      status: record.calculation_status || '',
      period_start: record.period_start || '',
      period_end: record.period_end || '',
      format: record.format || null,
      _raw: record
    };
  }

  function snapshotFilterOptions(rows) {
    var created = createdRangeFilter();
    var map = {
      value: valuePresenceFilter(),
      status: { options: labelledOptions(distinct(rows, 'status'), humanizeLabel) }
    };
    if (created) {
      map.created_at = created;
      map.period_start = createdRangeFilter();
      map.period_end = createdRangeFilter();
    }
    return map;
  }

  function isDateKey(key) {
    var lower = String(key || '').toLowerCase();
    return lower === 'date' || /_at$/.test(lower) || /_date$/.test(lower) || /^date_/.test(lower);
  }

  function cellValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_error) { return String(value); }
    }
    return value;
  }

  /**
   * Source rows have whatever columns the metric's query returns. Objects
   * become JSON text (the only way a cell can show them); scalars stay raw.
   * created_at, when present, leads and is labelled "Created".
   */
  function rawDataTable(rows, maxColumns) {
    var list = Array.isArray(rows) ? rows : [];
    var limit = maxColumns || 12;
    var keys = [];
    list.forEach(function (row) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        if (keys.indexOf('value') === -1) keys.push('value');
        return;
      }
      Object.keys(row).forEach(function (key) {
        if (key.charAt(0) !== '_' && keys.indexOf(key) === -1) keys.push(key);
      });
    });
    var createdIndex = keys.indexOf('created_at');
    if (createdIndex > 0) {
      keys.splice(createdIndex, 1);
      keys.unshift('created_at');
    }
    keys = keys.slice(0, limit);
    var mapped = list.map(function (row, index) {
      var out = { _row_id: 'row-' + index };
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        out.value = cellValue(row);
        return out;
      }
      keys.forEach(function (key) { out[key] = cellValue(row[key]); });
      return out;
    });
    return {
      columns: keys,
      labels: keys.map(function (key) { return key === 'created_at' ? 'Created' : humanizeLabel(key); }),
      rows: mapped,
      dateColumns: keys.filter(isDateKey)
    };
  }

  // ---------------------------------------------------------------------------
  // Dashboard Library
  // ---------------------------------------------------------------------------

  /**
   * A BI dashboard (or a built-in catalog entry) as a row. audience is the
   * raw dashboard_type code; created_at/updated_at stay ISO strings.
   */
  function mapDashboardRecord(record, index) {
    var source = record || {};
    var layout = source.layout || {};
    var type = layout.dashboard_type || source.key || 'owner';
    return {
      key: source.id || source.key,
      id: source.id || null,
      row_id: source.id || source.key || ('dashboard-' + (index || 0)),
      name: source.name || '',
      description: source.description || '',
      audience: layout.dashboard_type || source.audience || '',
      category: layout.category || source.category || '',
      scope: source.scope || 'Organization-wide',
      visibility: layout.visibility_label || source.visibility || 'Resource shares',
      state: source.state || 'Active',
      created_at: source.created_at || '',
      updated_at: source.updated_at || '',
      pin: '',
      actions: '',
      tags: source.tags || layout.category || '',
      href: source.id
        ? 'admin/dashboard-detail.html?id=' + encodeURIComponent(source.id)
        : (source.href || 'admin/dashboard-detail.html?type=' + encodeURIComponent(type)),
      _raw: source
    };
  }

  function dashboardFilterOptions(rows) {
    var map = {
      name: textFilter('Name contains...'),
      audience: { options: labelledOptions(distinct(rows, 'audience'), humanizeLabel) },
      category: { options: labelledOptions(distinct(rows, 'category'), capitalizeFirst) },
      scope: { options: labelledOptions(distinct(rows, 'scope'), capitalizeFirst) },
      visibility: { options: labelledOptions(distinct(rows, 'visibility'), capitalizeFirst) },
      state: { options: labelledOptions(distinct(rows, 'state'), humanizeLabel) }
    };
    var created = createdRangeFilter();
    if (created) {
      map.created_at = created;
      map.updated_at = createdRangeFilter();
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Client-side table helpers
  // ---------------------------------------------------------------------------

  /** Every row the table's current filters and search keep (all pages). */
  function filteredRows(table) {
    var source = table && table.dataSource;
    var raw = source && source._rawData;
    if (!Array.isArray(raw)) return [];
    var pipeline = global && global.Lex && global.Lex.LexDataPipeline;
    if (!pipeline) return raw.slice();
    var result = pipeline.process(raw, {
      filters: source._filters,
      searchQuery: source._searchQuery,
      searchColumns: table._getSearchColumns ? table._getSearchColumns() : null,
      sortBy: source._sortBy,
      sortDir: source._sortDir
    });
    return result.data;
  }

  function filterValue(table, key) {
    var filters = table && table.dataSource && table.dataSource._filters;
    var filter = filters && typeof filters.get === 'function' ? filters.get(key) : null;
    if (!filter) return '';
    var value = filter.value;
    if (filter.operator === 'match' && value && Array.isArray(value.values)) value = value.values;
    return String(Array.isArray(value) ? (value.length === 1 ? value[0] : '') : value);
  }

  /**
   * Wires a toolbar card to a client-side lex-table:
   *   ids = { search, sort, order, filter, counts: [ids] }
   *   options = { filterKey, noun: ['metric', 'metrics'], defaultSort, onCount }
   * Search, the Sort by select and the order button drive the table; header
   * sorting and filter changes flow back into the toolbar; the main filter
   * lives in the table's filter state so Clear filters resets it.
   * Returns { updateCount, syncToolbar }.
   */
  function bindClientToolbar(table, ids, options) {
    var doc = global.document;
    var opts = options || {};
    var noun = opts.noun || ['item', 'items'];
    function node(id) { return id ? doc.getElementById(id) : null; }

    function updateCount() {
      var source = table.dataSource;
      var total = source && source.pagination ? Number(source.pagination.total) || 0 : 0;
      var text = total + ' ' + (total === 1 ? noun[0] : noun[1]);
      (ids.counts || []).forEach(function (id) {
        var target = node(id);
        if (target) target.textContent = text;
      });
      if (typeof opts.onCount === 'function') opts.onCount(total);
    }

    function syncToolbar() {
      var source = table.dataSource;
      var select = node(ids.sort);
      var order = node(ids.order);
      var sortBy = (source && source._sortBy) || table.sortBy;
      var sortDir = (source && source._sortDir) || table.sortDir;
      if (select && sortBy && select.value !== sortBy) select.value = sortBy;
      if (order) order.dataset.order = sortDir === 'asc' ? 'asc' : 'desc';
      var filterSelect = node(ids.filter);
      if (filterSelect && opts.filterKey) {
        var current = filterValue(table, opts.filterKey) || 'all';
        if (filterSelect.value !== current) filterSelect.value = current;
      }
    }

    function applySort(column, direction) {
      table.sortBy = column;
      table.sortDir = direction;
      if (table.dataSource) table.dataSource.setSort(column, direction);
    }

    var search = node(ids.search);
    if (search) {
      var runSearch = function (event) {
        var value = event && event.detail && event.detail.value !== undefined ? event.detail.value : search.value;
        if (table.dataSource) table.dataSource.setSearch(String(value || '').trim());
      };
      search.addEventListener('lex-input', runSearch);
      search.addEventListener('lex-change', runSearch);
    }

    var sortSelect = node(ids.sort);
    var orderButton = node(ids.order);
    function currentOrder() {
      return orderButton && orderButton.dataset.order === 'asc' ? 'asc' : 'desc';
    }
    if (sortSelect) {
      sortSelect.addEventListener('lex-change', function (event) {
        var column = (event && event.detail && event.detail.value) || opts.defaultSort;
        if (column) applySort(column, currentOrder());
      });
    }
    if (orderButton) {
      orderButton.addEventListener('click', function () {
        orderButton.dataset.order = currentOrder() === 'asc' ? 'desc' : 'asc';
        var column = (sortSelect && sortSelect.value) || table.sortBy || opts.defaultSort;
        if (column) applySort(column, currentOrder());
      });
    }

    var filterSelect = node(ids.filter);
    if (filterSelect && opts.filterKey) {
      filterSelect.addEventListener('lex-change', function (event) {
        var value = String((event && event.detail && event.detail.value) || '');
        if (value && value !== 'all') table.addFilter(opts.filterKey, 'in', [value]);
        else table.removeFilter(opts.filterKey);
      });
    }

    table.addEventListener('lex-filter-change', function () { updateCount(); syncToolbar(); });
    table.addEventListener('lex-data-loaded', updateCount);
    table.addEventListener('sort-change', syncToolbar);

    return { updateCount: updateCount, syncToolbar: syncToolbar };
  }

  /** Empty copy that says when the filters, not the data, emptied the table. */
  function emptyText(table, emptyCopy, filteredCopy) {
    var source = table && table.dataSource;
    var filtered = !!(source && ((source._filters && source._filters.size > 0) || source._searchQuery));
    return filtered ? filteredCopy : emptyCopy;
  }

  var moduleApi = {
    humanizeLabel: humanizeLabel,
    capitalizeFirst: capitalizeFirst,
    fetchAllPages: fetchAllPages,
    entityName: entityName,
    normalizeEntityKey: normalizeEntityKey,
    sortableRunValue: sortableRunValue,
    runStatusLabel: runStatusLabel,
    catalogStatusColor: catalogStatusColor,
    mapCatalogMetric: mapCatalogMetric,
    catalogFilterOptions: catalogFilterOptions,
    mapSnapshot: mapSnapshot,
    snapshotFilterOptions: snapshotFilterOptions,
    isDateKey: isDateKey,
    rawDataTable: rawDataTable,
    mapDashboardRecord: mapDashboardRecord,
    dashboardFilterOptions: dashboardFilterOptions,
    createdRangeFilter: createdRangeFilter,
    valuePresenceFilter: valuePresenceFilter,
    filteredRows: filteredRows,
    bindClientToolbar: bindClientToolbar,
    emptyText: emptyText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaMetricTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
