/**
 * reporting-tables.js
 * The record tables of Firm Reporting (admin/reporting.html), built on
 * lex-table per docs/TABLE-STANDARD.md: the lead-source drilldown, the
 * "table" visualization of a module, and the results of an imported report.
 *
 * All three are client-side tables: each API answers with the whole set
 * (module metrics and report results are computed in one pass; the lead list
 * is read page by page until the end). Rows keep raw values; formatting
 * lives in the renderers; every column has a header filter.
 *
 * Public API (window.ReportingTables, or module.exports in Node):
 *   - mapLead(record)                         -> lead row
 *   - leadQuery(source, start, end, offset, limit) -> query string for /integrations/connector-data
 *   - loadAllLeads(get, source, start, end)   -> Promise<{ rows, truncated }>
 *   - LEAD_TABLE                              -> columns/labels of the lead table
 *   - leadRenderers(), leadFilterOptions()
 *   - breakdownColumns(viz), mapBreakdownRow(row, columns),
 *     breakdownRenderers(columns), breakdownFilterOptions(columns, rows)
 *   - resultColumns(rows), mapResultRow(row, columns),
 *     resultRenderers(columns), resultFilterOptions(columns, rows)
 *   - numberRangeOptions(values, percent), inNumberRange(cell, value)
 *   - mountClientTable(host, config)          -> lex-table element (browser only)
 */

(function (global) {
  'use strict';

  var LEAD_PAGE_SIZE = 500;
  // Stop after 20 pages (10,000 leads) and say so in the table heading.
  var LEAD_MAX_PAGES = 20;
  // A text column with more distinct values than this gets a "contains" box.
  var MAX_OPTION_VALUES = 12;

  function kit() {
    if (global && global.AdminTableKit) return global.AdminTableKit;
    if (typeof require === 'function') {
      try { return require('./admin-table-kit.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function rangeHelpers() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('../shared/library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function lexUtils() {
    return (global && global.Lex && global.Lex.Utils) || null;
  }

  function humanize(value) {
    var lex = lexUtils();
    if (lex && typeof lex.humanizeLabel === 'function') return lex.humanizeLabel(value);
    var text = String(value == null ? '' : value).replace(/[_-]+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function dateRangeFilter() {
    var helpers = rangeHelpers();
    return {
      single: true,
      options: helpers ? helpers.EDITED_RANGE_OPTIONS : [],
      match: function (cell, values) {
        return helpers ? helpers.inEditedRange(cell, values[0]) : true;
      }
    };
  }

  function isBlank(value) {
    return value === null || value === undefined || value === '';
  }

  // Numbers that arrive as strings ("12.5" from Postgres numerics) become
  // numbers so they sort and range-filter as numbers.
  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function looksLikeDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(value) && !isNaN(Date.parse(value));
  }

  // -------------------------------------------------------------------------
  // Number ranges (count, value, amount columns)
  // -------------------------------------------------------------------------

  /**
   * Single-choice range options for a numeric column. Values encode the
   * bounds as "min:max" (min inclusive, max exclusive, either may be empty).
   * Percent columns use quarters; others use powers of ten up to the largest value.
   */
  function numberRangeOptions(values, percent) {
    if (percent) {
      return [
        { value: ':25', label: 'Under 25%' },
        { value: '25:50', label: '25% to 50%' },
        { value: '50:75', label: '50% to 75%' },
        { value: '75:', label: '75% and over' }
      ];
    }
    var max = 0;
    (values || []).forEach(function (v) {
      var n = toNumber(v);
      if (n !== null && n > max) max = n;
    });
    var options = [{ value: ':1', label: 'Under 1' }];
    var lower = 1;
    while (lower * 10 <= max && options.length < 7) {
      options.push({ value: lower + ':' + (lower * 10), label: lower.toLocaleString('en-US') + ' to ' + (lower * 10 - 1).toLocaleString('en-US') });
      lower *= 10;
    }
    options.push({ value: lower + ':', label: lower.toLocaleString('en-US') + ' and over' });
    return options;
  }

  function inNumberRange(cell, value) {
    var n = toNumber(cell);
    if (n === null) return false;
    var parts = String(value || '').split(':');
    var min = parts[0] === '' ? null : Number(parts[0]);
    var max = parts[1] === '' || parts[1] === undefined ? null : Number(parts[1]);
    if (min !== null && n < min) return false;
    if (max !== null && n >= max) return false;
    return true;
  }

  function numberFilter(values, percent) {
    return {
      single: true,
      options: numberRangeOptions(values, percent),
      match: function (cell, selected) { return inNumberRange(cell, selected[0]); }
    };
  }

  // A text column: checkboxes for a short list of values, else a text box.
  function textFilter(values, label) {
    var seen = {};
    var distinct = [];
    (values || []).forEach(function (v) {
      if (isBlank(v)) return;
      var key = String(v);
      if (!seen[key]) { seen[key] = true; distinct.push(key); }
    });
    if (distinct.length && distinct.length <= MAX_OPTION_VALUES) {
      return {
        options: distinct.sort(function (a, b) { return a.localeCompare(b); })
          .map(function (v) { return { value: v, label: v }; })
      };
    }
    return { text: true, placeholder: (label || 'Value') + ' contains...' };
  }

  // -------------------------------------------------------------------------
  // Lead-source drilldown (GET /api/v1/integrations/connector-data)
  // -------------------------------------------------------------------------

  var LEAD_TABLE = {
    columns: ['name', 'email', 'phone', 'company', 'created_at'],
    labels: ['Name', 'Email', 'Phone', 'Company', 'Created']
  };

  function leadName(data) {
    if (!data) return '';
    if (data.name) return String(data.name);
    var parts = [data.firstName, data.lastName].filter(function (p) { return !isBlank(p); });
    return parts.join(' ');
  }

  function mapLead(record) {
    var data = (record && record.data) || {};
    return {
      id: String((record && record.id) || ''),
      name: leadName(data),
      email: String(data.email || ''),
      phone: String(data.phone || ''),
      company: String(data.company || ''),
      created_at: (record && (record.source_created_at || record.created_at)) || '',
      _raw: record
    };
  }

  function leadQuery(source, start, end, offset, limit) {
    var params = new URLSearchParams();
    params.set('entity_type', 'contact');
    params.set('source', source || '');
    if (start) params.set('start_date', start);
    if (end) params.set('end_date', end);
    params.set('limit', String(limit || LEAD_PAGE_SIZE));
    params.set('offset', String(offset || 0));
    return params.toString();
  }

  /**
   * Reads every lead of a source in the period. The endpoint pages by
   * limit/offset without a total, so it reads until a short page.
   * @param {Function} get - (url) => Promise<{ data: [] }>
   */
  async function loadAllLeads(get, source, start, end) {
    var rows = [];
    for (var page = 0; page < LEAD_MAX_PAGES; page++) {
      var response = await get('/api/v1/integrations/connector-data?' + leadQuery(source, start, end, page * LEAD_PAGE_SIZE, LEAD_PAGE_SIZE));
      var batch = (response && Array.isArray(response.data)) ? response.data : [];
      rows = rows.concat(batch.map(mapLead));
      if (batch.length < LEAD_PAGE_SIZE) return { rows: rows, truncated: false };
    }
    return { rows: rows, truncated: true };
  }

  function textCell(value) {
    var k = kit();
    return value ? '<span class="admin-table-text" title="' + k.esc(value) + '">' + k.esc(value) + '</span>' : k.muted('');
  }

  function leadRenderers() {
    var k = kit();
    return {
      name: function (val) { return val ? k.nameCell(val) : k.muted(''); },
      email: textCell,
      phone: textCell,
      company: textCell,
      created_at: function (val) { return k.timeCell(val); }
    };
  }

  function leadFilterOptions() {
    return {
      name: { text: true, placeholder: 'Name contains...' },
      email: { text: true, placeholder: 'Email contains...' },
      phone: { text: true, placeholder: 'Phone contains...' },
      company: { text: true, placeholder: 'Company contains...' },
      created_at: dateRangeFilter()
    };
  }

  // -------------------------------------------------------------------------
  // "table" visualization (module metric breakdown rows)
  // -------------------------------------------------------------------------

  var DEFAULT_BREAKDOWN_COLUMNS = [
    { field: 'label', header: 'Label', align: 'left' },
    { field: 'count', header: 'Count', align: 'right' },
    { field: 'value', header: 'Value', align: 'right', format: 'percent' }
  ];

  function breakdownColumns(viz) {
    var columns = (viz && Array.isArray(viz.columns) && viz.columns.length) ? viz.columns : DEFAULT_BREAKDOWN_COLUMNS;
    return columns.filter(function (c) { return c && c.field; }).map(function (c) {
      return {
        field: String(c.field),
        header: c.header ? String(c.header) : humanize(c.field),
        align: c.align || 'left',
        format: c.format || ''
      };
    });
  }

  function columnKind(column, rows) {
    if (column.format === 'percent' || column.format === 'currency' || column.format === 'number') return 'number';
    if (column.format === 'date') return 'date';
    var sample = (rows || []).map(function (r) { return r[column.field]; }).filter(function (v) { return !isBlank(v); });
    if (!sample.length) return 'text';
    if (sample.every(function (v) { return toNumber(v) !== null; })) return 'number';
    if (sample.every(looksLikeDate)) return 'date';
    return 'text';
  }

  function annotate(columns, rows) {
    return columns.map(function (c) {
      var out = {};
      Object.keys(c).forEach(function (key) { out[key] = c[key]; });
      out.kind = c.kind || columnKind(c, rows);
      return out;
    });
  }

  function mapTypedRow(row, columns, index) {
    var out = { _id: String(index), _raw: row };
    columns.forEach(function (c) {
      var value = row ? row[c.field] : undefined;
      if (c.kind === 'number') {
        var n = toNumber(value);
        out[c.field] = n === null ? null : n;
      } else {
        out[c.field] = isBlank(value) ? '' : (typeof value === 'object' ? JSON.stringify(value) : value);
      }
    });
    return out;
  }

  function mapBreakdownRow(row, columns, index) {
    return mapTypedRow(row, columns, index || 0);
  }

  function numberCell(value, column) {
    var k = kit();
    if (value === null || value === undefined || value === '') return k.muted('');
    var text;
    if (column.format === 'percent') text = Number(value).toFixed(1) + '%';
    else if (column.format === 'currency') {
      text = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
    } else text = Number(value).toLocaleString('en-US');
    return '<span class="admin-table-text reporting-table-number">' + k.esc(text) + '</span>';
  }

  function typedRenderers(columns) {
    var k = kit();
    var renderers = {};
    columns.forEach(function (c, i) {
      if (c.kind === 'number') renderers[c.field] = function (val) { return numberCell(val, c); };
      else if (c.kind === 'date') renderers[c.field] = function (val) { return k.timeCell(val); };
      else if (i === 0) renderers[c.field] = function (val) { return val === '' ? k.muted('') : k.nameCell(String(val)); };
      else renderers[c.field] = function (val) { return textCell(val === '' ? '' : String(val)); };
    });
    return renderers;
  }

  function typedFilterOptions(columns, rows) {
    var options = {};
    columns.forEach(function (c) {
      var values = (rows || []).map(function (r) { return r[c.field]; });
      if (c.kind === 'number') options[c.field] = numberFilter(values, c.format === 'percent');
      else if (c.kind === 'date') options[c.field] = dateRangeFilter();
      else options[c.field] = textFilter(values, c.header);
    });
    return options;
  }

  function breakdownRenderers(columns) { return typedRenderers(columns); }
  function breakdownFilterOptions(columns, rows) { return typedFilterOptions(columns, rows); }

  // -------------------------------------------------------------------------
  // Imported report results (POST /reporting/reports/:id/execute)
  // -------------------------------------------------------------------------

  // Every key any row has, in first-seen order; created_at is labelled "Created".
  function resultColumns(rows) {
    var seen = {};
    var fields = [];
    (rows || []).forEach(function (row) {
      Object.keys(row || {}).forEach(function (key) {
        if (!seen[key] && key.charAt(0) !== '_') { seen[key] = true; fields.push(key); }
      });
    });
    return annotate(fields.map(function (field) {
      return { field: field, header: field === 'created_at' ? 'Created' : humanize(field), align: 'left', format: '' };
    }), rows);
  }

  function mapResultRow(row, columns, index) {
    return mapTypedRow(row, columns, index || 0);
  }

  function resultRenderers(columns) { return typedRenderers(columns); }
  function resultFilterOptions(columns, rows) { return typedFilterOptions(columns, rows); }

  // -------------------------------------------------------------------------
  // Mounting (browser)
  // -------------------------------------------------------------------------

  /**
   * Renders a section heading with the count, an optional search box and a
   * client-side lex-table into host.
   * config: { id, title, noun: [singular, plural], columns, labels, rows,
   *           renderers, filterOptions, sortBy, sortDir, sortable, emptyText,
   *           ariaLabel, search: bool, note, className }
   */
  function mountClientTable(host, config) {
    var k = kit();
    var doc = global.document;
    host.innerHTML = '';

    var heading = doc.createElement('div');
    heading.className = 'reporting-table-heading';
    heading.innerHTML =
      '<h3 class="admin-table-section-title reporting-table-title">' + k.esc(config.title || '') + '</h3>' +
      '<span class="admin-table-toolbar-label reporting-table-count" aria-live="polite"></span>';
    host.appendChild(heading);
    var countEl = heading.querySelector('.reporting-table-count');

    if (config.note) {
      var note = doc.createElement('p');
      note.className = 'reporting-table-note';
      note.textContent = config.note;
      host.appendChild(note);
    }

    var search = null;
    if (config.search) {
      var bar = doc.createElement('div');
      bar.className = 'reporting-table-toolbar';
      bar.setAttribute('role', 'search');
      search = doc.createElement('lex-input');
      search.setAttribute('placeholder', 'Search ' + config.noun[1] + '...');
      search.setAttribute('clearable', 'true');
      search.setAttribute('leading-icon', 'search');
      bar.appendChild(search);
      host.appendChild(bar);
    }

    var table = doc.createElement('lex-table');
    table.id = config.id;
    table.className = 'admin-table lex-table--card ' + (config.className || '');
    table.setAttribute('column-filters', '');
    table.setAttribute('columns', config.columns.join(','));
    // labels is comma-separated: a comma inside a label would split it.
    table.setAttribute('labels', config.labels.map(function (l) { return String(l).replace(/,/g, ' '); }).join(','));
    if (config.sortable) table.setAttribute('sortable-columns', config.sortable.join(','));
    if (config.sortBy) {
      table.setAttribute('sort-by', config.sortBy);
      table.setAttribute('sort-dir', config.sortDir || 'desc');
    }
    table.setAttribute('limit', '20');
    table.setAttribute('id-key', config.idKey || '_id');
    table.setAttribute('empty-text', config.emptyText || ('No ' + config.noun[1] + ' yet'));
    table.setAttribute('aria-label', config.ariaLabel || config.title || '');
    host.appendChild(table);

    function updateCount() {
      var rows = table.filteredRows || [];
      var total = (config.rows || []).length;
      var shown = rows.length;
      countEl.textContent = shown === total
        ? k.countText(total, config.noun[0], config.noun[1])
        : shown + ' of ' + k.countText(total, config.noun[0], config.noun[1]);
      var filtered = Boolean(table.searchText) || (table.getActiveFilters && table.getActiveFilters().size > 0);
      var empty = filtered ? k.emptyText(true, config.noun[1]) : (config.emptyText || k.emptyText(false, config.noun[1]));
      if (table.emptyText !== empty) table.emptyText = empty;
    }

    k.whenTableReady().then(function () {
      // Callers attach host to the page right after this returns.
      return new Promise(function (resolve) {
        if (table.isConnected) resolve(); else global.setTimeout(resolve, 0);
      });
    }).then(function () {
      table.setCellRenderers(config.renderers || {});
      table.setColumnFilterOptions(config.filterOptions || {});
      table.setData(config.rows || []);
      updateCount();
      table.addEventListener('lex-filter-change', function (e) { if (e.target === table) updateCount(); });
      table.addEventListener('lex-data-loaded', function (e) { if (e.target === table) updateCount(); });
      if (search) {
        var timer = null;
        ['lex-input', 'lex-change'].forEach(function (name) {
          search.addEventListener(name, function (event) {
            var value = String((event.detail && event.detail.value) || '').trim();
            global.clearTimeout(timer);
            timer = global.setTimeout(function () {
              if (value === table.searchText) return;
              if (table.dataSource) table.dataSource.setSearch(value);
              updateCount();
            }, 350);
          });
        });
      }
      if (typeof config.onReady === 'function') config.onReady(table);
    });

    return table;
  }

  var moduleApi = {
    LEAD_PAGE_SIZE: LEAD_PAGE_SIZE,
    LEAD_MAX_PAGES: LEAD_MAX_PAGES,
    LEAD_TABLE: LEAD_TABLE,
    mapLead: mapLead,
    leadQuery: leadQuery,
    loadAllLeads: loadAllLeads,
    leadRenderers: leadRenderers,
    leadFilterOptions: leadFilterOptions,
    breakdownColumns: function (viz, rows) { return annotate(breakdownColumns(viz), rows); },
    mapBreakdownRow: mapBreakdownRow,
    breakdownRenderers: breakdownRenderers,
    breakdownFilterOptions: breakdownFilterOptions,
    resultColumns: resultColumns,
    mapResultRow: mapResultRow,
    resultRenderers: resultRenderers,
    resultFilterOptions: resultFilterOptions,
    numberRangeOptions: numberRangeOptions,
    inNumberRange: inNumberRange,
    mountClientTable: mountClientTable
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.ReportingTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
