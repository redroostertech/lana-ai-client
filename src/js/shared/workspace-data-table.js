/**
 * workspace-data-table.js
 * Query mapping, row mapping and cell renderers for the Workspace Data
 * (Connected Data) table, #wsDataTable on workspace-data.html.
 *
 * The table is server-paged against
 *   GET /api/v1/matters/:matter_id/connected-data
 * which pages (page/limit, max 200), sorts (sort_by allow-list + sort_dir),
 * searches (search: external_id + data text) and filters by one entity_type
 * and one connector_id. Rows keep raw values; every display format lives in
 * the renderers here.
 *
 * Public API (window.LanaWorkspaceDataTable, or module.exports in Node):
 *   - COLUMNS / LABELS / SORTABLE_COLUMNS / SORT_BY_COLUMN
 *   - filterValues(filter)                       -> string[]
 *   - buildQueryParams(query, options)           -> URLSearchParams
 *   - readQueryState(search)                     -> { entityType, connectorId, search, page }
 *   - getRowData(data)                           -> the user-facing fields of a record
 *   - dataSummary(data)                          -> "key: value  |  key: value" text
 *   - mapRow(record)                             -> table row (raw values + _raw)
 *   - mergeFacetOptions(previous, facets, key, labelFn) -> [{ value, label, count }]
 *   - connectorViewerHref(record)                -> connector-viewer URL or ''
 *   - emptyText(filtered)                        -> empty-state copy
 *   - cellRenderers(options)                     -> lex-table renderers
 */

(function (global) {
  'use strict';

  var COLUMNS = ['external_id', 'entity_type', 'connector_id', 'raw_data', 'synced_at', 'created_at', 'ai_action'];
  // The action column has no header text; a zero-width space keeps lex-table
  // from falling back to the column key.
  var LABELS = ['ID', 'Entity type', 'Connector', 'Data', 'Synced', 'Created', '\u200b'];

  // Table column -> connected-data API sort_by (its allow-list is synced_at,
  // created_at, updated_at, entity_type, external_id, connector_id).
  var SORT_BY_COLUMN = {
    synced_at: 'synced_at',
    created_at: 'created_at',
    external_id: 'external_id',
    entity_type: 'entity_type',
    connector_id: 'connector_id'
  };
  var SORTABLE_COLUMNS = Object.keys(SORT_BY_COLUMN);
  var DEFAULT_SORT = 'synced_at';

  function lexUtils() {
    return (global && global.Lex && global.Lex.Utils) || null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function humanize(value) {
    var utils = lexUtils();
    if (utils && typeof utils.humanizeLabel === 'function') return utils.humanizeLabel(value);
    var text = String(value == null ? '' : value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function formatDateTime(value) {
    var utils = lexUtils();
    if (!value || !utils || typeof utils.formatDateTime !== 'function') return '';
    var text = utils.formatDateTime(value);
    return text === 'Never' ? '' : text;
  }

  var MUTED_DASH = '<span class="ws-data-cell-muted">—</span>';

  // Full date and time through Lex.Utils (the user's timezone).
  function timeCell(value) {
    var text = formatDateTime(value);
    if (!text) return MUTED_DASH;
    return '<time class="ws-data-time" datetime="' + esc(value) + '" title="' + esc(text) + '">' + esc(text) + '</time>';
  }

  // Values a column filter selected: lex-table sends { operator, value }.
  function filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value])
      .map(function (v) { return String(v == null ? '' : v).trim(); })
      .filter(Boolean);
  }

  /**
   * API query string for one table query.
   * @param {Object} query - lex-table { page, limit, sortBy, sortDir, filters }
   * @param {Object} [options]
   * @param {string} [options.search] - toolbar search text
   * @param {Function} [options.rangeBounds] - value -> { after, before }
   *   (LanaLibraryColumnFilters.editedRangeBounds)
   * @returns {URLSearchParams}
   */
  function buildQueryParams(query, options) {
    query = query || {};
    options = options || {};
    var filters = query.filters || {};
    var params = new URLSearchParams();
    params.set('page', String(query.page || 1));
    params.set('limit', String(query.limit || 20));
    params.set('sort_by', SORT_BY_COLUMN[query.sortBy] || DEFAULT_SORT);
    params.set('sort_dir', query.sortDir === 'asc' ? 'asc' : 'desc');

    var search = String(options.search || '').trim();
    if (search) params.set('search', search);

    // The API takes one entity type and one connector: these filters are
    // single-choice in the table.
    var entityType = filterValues(filters.entity_type)[0];
    if (entityType) params.set('entity_type', entityType);
    var connectorId = filterValues(filters.connector_id)[0];
    if (connectorId) params.set('connector_id', connectorId);

    var externalId = filterValues(filters.external_id)[0];
    if (externalId) params.set('external_id', externalId);
    var dataText = filterValues(filters.raw_data)[0];
    if (dataText) params.set('data_contains', dataText);

    if (typeof options.rangeBounds === 'function') {
      var synced = options.rangeBounds(filterValues(filters.synced_at)[0]) || {};
      if (synced.after) params.set('synced_after', synced.after);
      if (synced.before) params.set('synced_before', synced.before);
      var created = options.rangeBounds(filterValues(filters.created_at)[0]) || {};
      if (created.after) params.set('created_after', created.after);
      if (created.before) params.set('created_before', created.before);
    }
    return params;
  }

  /**
   * Deep-link state from the page URL (?entity_type=&connector_id=&search=&page=).
   * @param {string} search - location.search
   */
  function readQueryState(search) {
    var params = new URLSearchParams(search || '');
    return {
      entityType: String(params.get('entity_type') || params.get('entity') || '').trim(),
      connectorId: String(params.get('connector_id') || params.get('connector') || '').trim(),
      search: String(params.get('search') || '').trim(),
      page: Math.max(1, Number(params.get('page') || 1) || 1)
    };
  }

  /**
   * The user-facing fields of a connector_data record. Google Sheets keeps
   * them in data.row_data; other connectors store them flat, with internal
   * fields prefixed "_".
   */
  function getRowData(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.row_data && typeof data.row_data === 'object') return data.row_data;
    var out = {};
    Object.keys(data).forEach(function (key) {
      if (key.charAt(0) !== '_') out[key] = data[key];
    });
    return out;
  }

  // First three non-empty fields, for the Data cell (full text in its title).
  function dataSummary(data) {
    var rowData = getRowData(data);
    var parts = [];
    var keys = Object.keys(rowData);
    for (var i = 0; i < keys.length && parts.length < 3; i++) {
      var val = rowData[keys[i]];
      if (val == null || val === '') continue;
      parts.push(keys[i] + ': ' + (typeof val === 'object' ? JSON.stringify(val) : String(val)));
    }
    return parts.join('  |  ');
  }

  function mapRow(record) {
    record = record || {};
    return {
      id: record.id || '',
      external_id: record.external_id || '',
      entity_type: record.entity_type || '',
      connector_id: record.connector_id || '',
      raw_data: record.data || record.raw_data || null,
      synced_at: record.synced_at || record.updated_at || record.created_at || '',
      created_at: record.created_at || '',
      ai_action: '',
      _raw: record
    };
  }

  /**
   * Filter options from the API's facet rows, merged with the ones already
   * known. The API narrows its facets by the active filters, so a value stays
   * listed after another one is picked.
   * @param {Array} previous - [{ value, label, count }]
   * @param {Array} facets - e.g. [{ entity_type: 'lead', count: '4' }]
   * @param {string} key - facet field name
   * @param {Function} labelFn - value -> label
   */
  function mergeFacetOptions(previous, facets, key, labelFn) {
    var byValue = {};
    var order = [];
    (previous || []).forEach(function (option) {
      if (!option || !option.value || byValue[option.value]) return;
      byValue[option.value] = { value: option.value, label: option.label, count: option.count };
      order.push(option.value);
    });
    (facets || []).forEach(function (facet) {
      var value = facet && facet[key] != null ? String(facet[key]) : '';
      if (!value) return;
      var count = Number(facet.count);
      if (!byValue[value]) {
        byValue[value] = { value: value, label: labelFn(value, facet), count: null };
        order.push(value);
      }
      if (Number.isFinite(count)) byValue[value].count = count;
    });
    return order.map(function (value) { return byValue[value]; })
      .sort(function (a, b) {
        return String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base', numeric: true });
      });
  }

  function connectorViewerHref(record) {
    if (!record || !record.connector_ui_url) return '';
    var params = new URLSearchParams({
      ui: record.connector_ui_url,
      name: record.connector_name || record.connector_id || '',
      connectorId: record.connector_id || '',
      connectorType: record.connector_id || ''
    });
    return 'integrations/connector-viewer.html?' + params.toString();
  }

  function emptyText(filtered) {
    return filtered
      ? 'No matching records. Try a different search or clear the filters.'
      : 'No connected data yet';
  }

  var AI_ICON_SVG = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27a7 7 0 0 1-13.46 0H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>' +
    '<circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></svg>';

  /**
   * lex-table renderers. Rows come from mapRow.
   * @param {Object} [options]
   * @param {Function} [options.isSelected] - id -> boolean (bulk-annotate checkbox)
   */
  function cellRenderers(options) {
    options = options || {};
    var isSelected = typeof options.isSelected === 'function' ? options.isSelected : function () { return false; };

    function removedClass(row) {
      return row && row._raw && row._raw.source_deleted ? ' ws-data-cell--removed' : '';
    }

    return {
      external_id: function (value, row) {
        var id = String((row && row.id) || '');
        var checkbox = id
          ? '<input type="checkbox" class="ws-row-checkbox" data-ws-select="' + esc(id) + '"' +
            (isSelected(id) ? ' checked' : '') + ' aria-label="Select record">'
          : '';
        var text = String(value || '');
        // Long external ids differ at the end: show the last six characters.
        var shown = text.length > 8 ? '…' + text.slice(-6) : text;
        return '<span class="ws-data-id-cell">' + checkbox +
          (text
            ? '<span class="ws-data-id' + removedClass(row) + '" title="' + esc(text) + '">' + esc(shown) + '</span>'
            : MUTED_DASH) +
          '</span>';
      },
      entity_type: function (value, row) {
        var label = value ? humanize(value) : '';
        var removed = row && row._raw && row._raw.source_deleted
          ? ' <lex-badge label="Removed" color="gray" size="sm" title="Deleted at the source"></lex-badge>'
          : '';
        return (label ? '<span class="' + removedClass(row).trim() + '">' + esc(label) + '</span>' : MUTED_DASH) + removed;
      },
      connector_id: function (value, row) {
        var record = (row && row._raw) || {};
        // Records imported into LANA itself have no connector.
        var label = record.connector_name || value || 'LANA';
        var href = connectorViewerHref(record);
        if (href) {
          return '<a class="ws-data-connector-link" href="' + esc(href) + '" title="Open ' + esc(label) + '">' + esc(label) + '</a>';
        }
        return '<span class="ws-data-cell-text" title="' + esc(label) + '">' + esc(label) + '</span>';
      },
      raw_data: function (value, row) {
        var summary = dataSummary(value);
        if (!summary) return MUTED_DASH;
        return '<span class="ws-data-summary' + removedClass(row) + '" title="' + esc(summary) + '">' + esc(summary) + '</span>';
      },
      synced_at: timeCell,
      created_at: timeCell,
      ai_action: function (_value, row) {
        var record = (row && row._raw) || {};
        var id = String((row && row.id) || '');
        var count = Number(record.annotation_count) || 0;
        var badges = '';
        if (count > 0) {
          badges += '<span class="ws-data-annotation-count" title="' + count + ' annotation' + (count === 1 ? '' : 's') + '">' + count + '</span>';
        }
        if (record.has_corrections) {
          badges += '<span class="ws-data-correction" title="Has corrections">C</span>';
        }
        var button = id
          ? '<button type="button" class="lex-ai-row-btn" data-ai-row="' + esc(id) + '" title="Send to LANA chat" aria-label="Send to LANA chat">' + AI_ICON_SVG + '</button>'
          : '';
        return '<span class="ws-data-action-cell">' + button + badges + '</span>';
      }
    };
  }

  var moduleApi = {
    COLUMNS: COLUMNS,
    LABELS: LABELS,
    SORT_BY_COLUMN: SORT_BY_COLUMN,
    SORTABLE_COLUMNS: SORTABLE_COLUMNS,
    filterValues: filterValues,
    buildQueryParams: buildQueryParams,
    readQueryState: readQueryState,
    getRowData: getRowData,
    dataSummary: dataSummary,
    mapRow: mapRow,
    mergeFacetOptions: mergeFacetOptions,
    connectorViewerHref: connectorViewerHref,
    emptyText: emptyText,
    cellRenderers: cellRenderers
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaWorkspaceDataTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
