/**
 * Metric detail view model (pure, no DOM).
 *
 * The friendly source records table (no internal ids, words for headers,
 * dates as days, empty cells left for the page to show as a muted dash) and
 * the one summary card (the value with its unit, the change against the
 * prior period both ways, the prior period's days, a two-bar comparison).
 * No regex (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MetricDetailView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // The firm's currency (Lex.Utils.getFirmCurrency, from /auth/me), else USD.
  function firmCurrency() {
    var host = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    var utils = host.Lex && host.Lex.Utils;
    return utils && typeof utils.getFirmCurrency === 'function' ? utils.getFirmCurrency() : 'USD';
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LABELS = {
    matter_name: 'Matter', client_name: 'Client', status: 'Status', stage: 'Stage', opened_at: 'Opened', closed_at: 'Closed',
    days: 'Days in stage', due_date: 'Due', amount: 'Amount', created_at: 'Created', updated_at: 'Updated', row_date: 'Date',
  };
  // Row fields the server sends to describe a row, not to show as columns:
  // they go in the Notes column (or open the record panel).
  var ROW_NOTE_KEYS = ['row_reason', 'conflict', 'fixed_in_lana', 'refs', 'edit', 'outcome_edit',
    'corrected_fields', 'conflict_fields', 'fields', 'actions', 'flag_annotation_id', 'matches_query'];
  var LINK_IDS = ['workspace_id', 'matter_id'];

  function endsWith(text, tail) {
    return text.length >= tail.length && text.slice(-tail.length) === tail;
  }

  function isHex(ch) {
    return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  function isUuid(value) {
    if (typeof value !== 'string' || value.length !== 36) return false;
    for (var i = 0; i < 36; i += 1) {
      var ch = value.charAt(i);
      if (i === 8 || i === 13 || i === 18 || i === 23) { if (ch !== '-') return false; } else if (!isHex(ch)) return false;
    }
    return true;
  }

  function isEmpty(value) {
    return value === null || value === undefined || value === '';
  }

  function isInternal(key, rows) {
    var k = key.toLowerCase();
    if (k === 'id' || k === 'uuid' || k === 'request_access' || k.charAt(0) === '_' || endsWith(k, '_key') || endsWith(k, '_id') || endsWith(k, '_uuid') || endsWith(k, '_ref')) return true;
    var filled = rows.filter(function (row) { return !isEmpty(row[key]); });
    return filled.length > 0 && filled.every(function (row) { return isUuid(row[key]); });
  }

  function isTimeKey(key) {
    var k = key.toLowerCase();
    return endsWith(k, '_time') || k === 'time' || endsWith(k, '_datetime');
  }

  function isDateKey(key) {
    var k = key.toLowerCase();
    return endsWith(k, '_at') || endsWith(k, '_date') || k === 'date' || endsWith(k, '_on');
  }

  function labelFor(key) {
    if (LABELS[key]) return LABELS[key];
    var k = key;
    ['_at', '_date', '_on'].forEach(function (tail) { if (endsWith(k, tail) && k.length > tail.length) k = k.slice(0, -tail.length); });
    var words = k.split('_').join(' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
  }

  function dayText(value) {
    var text = String(value);
    if (text.length < 10 || text.charAt(4) !== '-' || text.charAt(7) !== '-') return text;
    var month = Number(text.substring(5, 7));
    var day = Number(text.substring(8, 10));
    if (!(month >= 1 && month <= 12) || !(day >= 1)) return text;
    return MONTHS[month - 1] + ' ' + day + ', ' + text.substring(0, 4);
  }

  function dateTimeText(value) {
    var time = Date.parse(String(value));
    if (!isFinite(time)) return String(value);
    return new Date(time).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  }

  var MONEY_WORDS = ['amount', 'value', 'fee', 'balance', 'total', 'price', 'revenue', 'cost'];

  function isMoneyKey(key) {
    var k = key.toLowerCase();
    return MONEY_WORDS.some(function (word) { return k.indexOf(word) !== -1; });
  }

  function isNumeric(value) {
    if (typeof value === 'number') return isFinite(value);
    if (typeof value !== 'string' || !value.trim()) return false;
    return isFinite(Number(value));
  }

  function isLower(ch) { return ch >= 'a' && ch <= 'z'; }
  function isDigitCh(ch) { return ch >= '0' && ch <= '9'; }

  // A code-like value: lower case letters, digits and underscores, with a letter.
  function isSnake(value) {
    if (typeof value !== 'string' || !value || value.length > 40) return false;
    var letter = false;
    for (var i = 0; i < value.length; i += 1) {
      var ch = value.charAt(i);
      if (isLower(ch)) letter = true;
      else if (!isDigitCh(ch) && ch !== '_') return false;
    }
    return letter;
  }

  function typeOf(key, rows) {
    if (isTimeKey(key)) return 'datetime';
    if (isDateKey(key)) return 'date';
    var filled = rows.filter(function (row) { return !isEmpty(row[key]); });
    if (!filled.length) return 'text';
    if (isMoneyKey(key) && filled.every(function (row) { return isNumeric(row[key]); })) return 'money';
    if (filled.every(function (row) { return typeof row[key] === 'number'; })) return 'number';
    if (filled.every(function (row) { return isSnake(row[key]); })) return 'enum';
    return 'text';
  }

  function words(value) {
    var text = String(value).split('_').join(' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function isDaysKey(key) {
    var k = String(key || '').toLowerCase();
    return k === 'days' || k.indexOf('days_') === 0 || (k.length > 5 && k.slice(-5) === '_days');
  }

  // One formatter for the records table and the dashboard worklists.
  function cellText(value, type, key) {
    if (isEmpty(value)) return null;
    if (type === 'date') return dayText(value);
    if (type === 'datetime') return dateTimeText(value);
    if (type === 'money') return Number(value).toLocaleString('en-US', { style: 'currency', currency: firmCurrency(), maximumFractionDigits: 0 });
    if (type === 'number') {
      var number = Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
      // A count of days (days_waiting, open_days, days) reads "12 days".
      return isDaysKey(key) ? number + (Number(value) === 1 ? ' day' : ' days') : number;
    }
    if (type === 'enum') {
      var k = String(key || '').toLowerCase();
      // A product or service the firm has not mapped yet (Settings > Mappings).
      if (value === 'uncategorized' && (k.indexOf('product') !== -1 || k.indexOf('service') !== -1)) return 'Not mapped';
      return words(value);
    }
    return String(value);
  }

  // Up to n columns for a short list: names, then dates, then amounts, then
  // the rest. Columns the server chose are kept as they are, all of them.
  function worklistColumns(columns, n) {
    // The Notes column belongs to the full records table, not a short list.
    columns = (columns || []).filter(function (col) { return col.type !== 'notes'; });
    if (columns.length && columns[0].fromServer) return columns;
    function rank(col) {
      var k = col.key.toLowerCase();
      if (k === 'name' || k.slice(-5) === '_name') return 0;
      if (col.type === 'date' || col.type === 'datetime') return 1;
      if (col.type === 'money') return 2;
      return 3;
    }
    return (columns || []).map(function (col, i) { return { col: col, i: i }; })
      .sort(function (a, b) { return rank(a.col) - rank(b.col) || a.i - b.i; })
      .slice(0, n || 4).map(function (entry) { return entry.col; });
  }

  function linkFor(row) {
    for (var i = 0; i < LINK_IDS.length; i += 1) {
      if (isUuid(row[LINK_IDS[i]])) return 'workspace-details.html?id=' + encodeURIComponent(row[LINK_IDS[i]]);
    }
    return null;
  }

  // A value through the column's labels (from the server), else formatted.
  function formatCell(value, col) {
    if (isEmpty(value)) return null;
    if (col.labels && Object.prototype.hasOwnProperty.call(col.labels, String(value))) return String(col.labels[String(value)]);
    return cellText(value, col.type, col.key);
  }

  // The server's row_columns ([{ field, header, format?, align?, labels? }]):
  // only those columns, in that order, with their headers and formats.
  var SERVER_FORMATS = { currency: 'money', date: 'date' };

  function serverColumns(rowColumns, list) {
    return rowColumns.filter(function (c) { return c && c.field; }).map(function (c) {
      var type = SERVER_FORMATS[c.format] || typeOf(c.field, list);
      return {
        key: String(c.field),
        label: c.header ? String(c.header) : labelFor(String(c.field)),
        type: type,
        align: c.align === 'right' || c.align === 'left' ? c.align : (type === 'money' || type === 'number' ? 'right' : 'left'),
        labels: c.labels && typeof c.labels === 'object' ? c.labels : null,
        fromServer: true,
      };
    });
  }

  /**
   * { columns: [{ key, label, type, align, labels? }], rows: [{ cells: [{ key, text, href }] }] }
   * rowColumns (the server's row_columns) wins when present; else the
   * columns are worked out from the field names and values.
   */
  function recordsTable(rows, rowColumns) {
    var list = (Array.isArray(rows) ? rows : []).filter(function (row) { return row && typeof row === 'object'; });
    var keys = [];
    list.forEach(function (row) { Object.keys(row).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); }); });
    var columns = Array.isArray(rowColumns) && rowColumns.length ? serverColumns(rowColumns, list) : keys.filter(function (key) {
      return ROW_NOTE_KEYS.indexOf(key) === -1 && !isInternal(key, list) && list.some(function (row) { return !isEmpty(row[key]); });
    }).map(function (key) {
      var type = typeOf(key, list);
      return { key: key, label: labelFor(key), type: type, align: type === 'money' || type === 'number' ? 'right' : 'left' };
    });
    // A Date column (row_date) that repeats another date column on every row
    // says the same thing twice: hide it.
    columns = withoutRepeatedRowDate(columns, list);
    // The row's reason, conflict and "Fixed in LANA" mark in one Notes column.
    if (list.some(hasNotes)) columns = columns.concat([{ key: '_notes', label: 'Notes', type: 'notes', align: 'left', fromServer: columns.length && columns[0].fromServer }]);
    return {
      columns: columns,
      rows: list.map(function (row, index) {
        var href = linkFor(row);
        return {
          id: 'row-' + index,
          cells: columns.map(function (col) {
            return { key: col.key, text: formatCell(row[col.key], col), href: col.key === 'matter_name' ? href : null };
          }),
        };
      }),
    };
  }

  function dayPart(value) {
    return isEmpty(value) ? '' : String(value).substring(0, 10);
  }

  function withoutRepeatedRowDate(columns, list) {
    if (!list.length || !columns.some(function (c) { return c.key === 'row_date'; })) return columns;
    var twin = columns.filter(function (c) {
      return c.key !== 'row_date' && (c.type === 'date' || c.type === 'datetime')
        && list.every(function (row) { return dayPart(row.row_date) !== '' && dayPart(row[c.key]) === dayPart(row.row_date); });
    })[0];
    return twin ? columns.filter(function (c) { return c.key !== 'row_date'; }) : columns;
  }

  function hasNotes(row) {
    return !!(row && ((typeof row.row_reason === 'string' && row.row_reason.trim()) || conflictOfRow(row)
      || correctedOfRow(row).length || (row.fixed_in_lana && typeof row.fixed_in_lana === 'object')
      || (row.edit && typeof row.edit === 'object') || (row.outcome_edit && typeof row.outcome_edit === 'object')));
  }

  // A row's conflict in any shape the server sends (see DataFixes.conflictOf).
  function conflictOfRow(row) {
    var r = row || {};
    if (r.conflict && typeof r.conflict === 'object') return r.conflict;
    if (r.flag_annotation_id && Array.isArray(r.fields)) return { flag_annotation_id: r.flag_annotation_id, source_name: r.source_name || r.system || null, fields: r.fields };
    if (Array.isArray(r.conflict_fields) && r.conflict_fields.length) return { source_name: r.source_name || null, fields: r.conflict_fields };
    return null;
  }

  function correctedOfRow(row) {
    if (row && Array.isArray(row.corrected_fields)) return row.corrected_fields;
    return row && row.fixed_in_lana && Array.isArray(row.fixed_in_lana.fields) ? row.fixed_in_lana.fields : [];
  }

  function fieldLabel(field) {
    var key = (field && (field.standard_key || field.field_key)) || '';
    return LABELS[key] || words(key);
  }

  function fieldValue(field, value) {
    if (isEmpty(value)) return '';
    var key = String((field && (field.standard_key || field.field_key)) || '');
    if (key === 'amount' || key.indexOf('value') !== -1 || key.indexOf('amount') !== -1) return cellText(value, 'money', key) || String(value);
    if (isDateKey(key) || key.indexOf('date') !== -1 || key.slice(-3) === '_on') return cellText(value, 'date', key) || String(value);
    return typeof value === 'object' ? '' : String(value);
  }

  /** The Notes for one row: { reason, conflict: { fields: [{ label, lana, source, previous }] } | null, fixed: [labels] | null }. */
  function rowNotes(row) {
    var r = row || {};
    var found = conflictOfRow(r);
    var conflict = found && Array.isArray(found.fields)
      ? { fields: found.fields.filter(function (f) { return f && typeof f === 'object'; }).map(function (f) {
        var out = { label: fieldLabel(f), lana: fieldValue(f, f.lana_value), source: fieldValue(f, f.new_source_value) };
        if (found.source_name) out.sourceName = String(found.source_name);
        if (!isEmpty(f.previous_source_value)) out.previous = fieldValue(f, f.previous_source_value);
        return out;
      }) }
      : null;
    var correctedList = correctedOfRow(r);
    var fixedFields = correctedList.length ? correctedList : null;
    return {
      reason: typeof r.row_reason === 'string' ? r.row_reason.trim() : '',
      conflict: conflict,
      // A pinned conflict that does not match the search or filters.
      outsideSearch: !!(conflict && r.matches_query === false),
      fixed: fixedFields ? fixedFields.map(function (f) { return typeof f === 'object' ? fieldLabel(f) : (LABELS[f] || words(f)); }) : null,
    };
  }

  // ── Server-side rows (search, sort, filters, paging) ───────────────
  /** The server handles the rows when raw_data carries filtered_total, facets, sort or filters. */
  function isServerRows(raw) {
    if (!raw || typeof raw !== 'object') return false;
    return !!(raw.filtered_total !== undefined || (raw.facets && typeof raw.facets === 'object')
      || (raw.sort && typeof raw.sort === 'object') || (raw.filters && typeof raw.filters === 'object'));
  }

  /**
   * The table's query ({ search, sortBy, sortDir, filters, page, limit },
   * filters as lex-table sends them) as getMetricDetail raw_* params. A
   * picked value "from..to" is a range (col_from, col_to).
   */
  function rowsRequestParams(query) {
    var q = query || {};
    var limit = Number(q.limit) || 20;
    var page = Number(q.page) || 1;
    var out = {};
    var search = typeof q.search === 'string' ? q.search.trim() : '';
    if (search) out.rawQ = search;
    if (q.sortBy) { out.rawSortBy = String(q.sortBy); out.rawSortDir = q.sortDir === 'asc' ? 'asc' : 'desc'; }
    var filters = {};
    Object.keys(q.filters || {}).forEach(function (col) {
      var f = q.filters[col];
      var value = f && typeof f === 'object' ? f.value : f;
      // Several picks go as a comma list meaning "any of"; a value with a
      // comma in it cannot travel that way, so it is skipped.
      if (Array.isArray(value)) {
        var picks = value.map(String).filter(function (v) { return v !== '' && v.indexOf(',') === -1; });
        if (picks.length > 1 || (picks.length === 1 && picks[0].indexOf('..') === -1)) {
          if (picks.length) filters[col] = picks.join(',');
          return;
        }
        value = picks[0];
      }
      if (value === undefined || value === null || value === '') return;
      var text = String(value);
      var dots = text.indexOf('..');
      if (dots !== -1) {
        if (text.substring(0, dots)) filters[col + '_from'] = text.substring(0, dots);
        if (text.substring(dots + 2)) filters[col + '_to'] = text.substring(dots + 2);
      } else {
        filters[col] = text;
      }
    });
    if (Object.keys(filters).length) out.rawFilters = filters;
    out.rawLimit = limit;
    out.rawOffset = (page - 1) * limit;
    return out;
  }

  // ── Records filters from the link ──────────────────────────────
  var LINK_FILTER_HEAD = 'raw_filter[';

  /** Every raw_filter[col]=value in the link: { col: value }. */
  function urlFilters(params) {
    var out = {};
    if (!params || typeof params.forEach !== 'function') return out;
    params.forEach(function (value, key) {
      var k = String(key);
      if (k.indexOf(LINK_FILTER_HEAD) !== 0 || k.charAt(k.length - 1) !== ']') return;
      var col = k.slice(LINK_FILTER_HEAD.length, -1);
      if (col && value !== '') out[col] = String(value);
    });
    return out;
  }

  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // "2026-10" reads "Oct 2026", "older" reads "Older"; anything else as sent.
  function filterValueWords(value, col) {
    var text = String(value);
    if (text === 'older') return 'Older';
    // A blank month: the record has no date to group it by.
    if (text === EMPTY_FACET && col === 'month') return 'No date recorded';
    var parts = text.split('-');
    var month = parts.length === 2 && parts[0].length === 4 && parts[1].length === 2 ? Number(parts[1]) : NaN;
    if (month >= 1 && month <= 12 && isFinite(Number(parts[0]))) return MONTH_NAMES[month - 1] + ' ' + parts[0];
    return text;
  }

  /** A link filter chip: "Month: Oct 2026". */
  function linkFilterText(col, value) {
    var name = String(col).split('_').join(' ');
    return name.charAt(0).toUpperCase() + name.slice(1) + ': ' + filterValueWords(value, col);
  }

  /** "Showing X of filtered_total (of total)". */
  function rowsCountText(raw, shown) {
    var r = raw || {};
    var filtered = Number(r.filtered_total);
    var total = Number(r.total);
    var n = Number(shown) || 0;
    if (!isFinite(filtered)) return '';
    if (!isFinite(total) || total === filtered) return 'Showing ' + n.toLocaleString('en-US') + ' of ' + filtered.toLocaleString('en-US');
    return 'Showing ' + n.toLocaleString('en-US') + ' of ' + filtered.toLocaleString('en-US') + ' (of ' + total.toLocaleString('en-US') + ')';
  }

  /** "Showing the first N of source_total records." when the server truncated the rows. */
  function truncatedText(raw) {
    if (!raw || raw.truncated !== true) return '';
    var shown = Number(raw.total);
    var all = Number(raw.source_total);
    if (!isFinite(shown) || !isFinite(all)) return 'Showing the first records only.';
    return 'Showing the first ' + shown.toLocaleString('en-US') + ' of ' + all.toLocaleString('en-US') + ' records.';
  }

  /**
   * facets { col: [{ value, count }] } as lex-table column filter options
   * (pick several). Counts are over all rows, not the search, so they read
   * "(9 in all)". Blank values become "(empty)". A value with a comma is
   * not offered, since picks travel as a comma list.
   */
  var EMPTY_FACET = '(empty)';

  function facetFilterOptions(facets) {
    var out = {};
    Object.keys(facets || {}).forEach(function (col) {
      var list = Array.isArray(facets[col]) ? facets[col] : [];
      var countText = function (f) { return f.count !== undefined && f.count !== null ? ' (' + Number(f.count).toLocaleString('en-US') + ' in all)' : ''; };
      var options = list.filter(function (f) { return f && !isEmpty(f.value) && String(f.value).indexOf(',') === -1; }).map(function (f) {
        // A month column reads like the month bars ("Oct 2026", "Older").
        var label = col === 'month' ? filterValueWords(f.value, col) : (typeof f.value === 'string' ? words(f.value) : String(f.value));
        return { value: String(f.value), label: label + countText(f) };
      });
      var blank = list.filter(function (f) { return f && isEmpty(f.value); })[0];
      if (blank) options.push({ value: EMPTY_FACET, label: filterValueWords(EMPTY_FACET, col) + countText(blank) });
      if (options.length) out[col] = { options: options };
    });
    return out;
  }

  /** The server sorts rows (newest first, conflicts pinned on top) when they carry row_date or conflicts. */
  function keepsServerOrder(rows) {
    return (Array.isArray(rows) ? rows : []).some(function (row) { return row && (!isEmpty(row.row_date) || (row.conflict && typeof row.conflict === 'object')); });
  }

  function plural(n, one, many) {
    return Number(n).toLocaleString('en-US') + ' ' + (Number(n) === 1 ? one : many);
  }

  /** The records header: { asOf: 'As of Nov 24, 2026', basis: rows_basis.label, conflicts: summary } ('' when absent). */
  function recordsHeader(payload) {
    var p = payload || {};
    var raw = p.raw_data || {};
    var asOf = !isEmpty(p.as_of) ? cellText(String(p.as_of).substring(0, 10), 'date', 'as_of') : '';
    var basis = raw.rows_basis && typeof raw.rows_basis === 'object' && raw.rows_basis.label ? String(raw.rows_basis.label) : '';
    var conflicts = '';
    var c = raw.conflicts && typeof raw.conflicts === 'object' ? raw.conflicts : null;
    if (c && Number(c.count) > 0) {
      conflicts = c.message ? String(c.message).trim()
        : (Number(c.count) === 1 ? '1 record disagrees with its source.' : plural(c.count, 'record', 'records') + ' disagree with their source.');
      var pinned = Number(raw.pinned_count) || 0;
      var corrected = Number(raw.corrected_count) || 0;
      if (pinned > 0) conflicts += ' ' + Number(pinned).toLocaleString('en-US') + ' shown first.';
      if (corrected > 0) conflicts += ' ' + Number(corrected).toLocaleString('en-US') + ' fixed in LANA.';
    }
    return { asOf: asOf ? 'As of ' + asOf : '', basis: basis, conflicts: conflicts };
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function oneDecimal(n) {
    return Number(Math.abs(n).toFixed(1)).toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  /** A value in the metric's format and unit ("301.7 days", "$5,389", "38.5%"). */
  function formatValue(value, meta) {
    var n = toNumber(value);
    if (n === null) return null;
    var format = String((meta && meta.format) || 'number').toLowerCase();
    var unit = meta && meta.unit ? String(meta.unit) : '';
    if (format === 'currency') return n.toLocaleString('en-US', { style: 'currency', currency: firmCurrency(), maximumFractionDigits: 0 });
    if (format === 'percentage' || format === 'percent') return Number(n.toFixed(1)).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
    if (format === 'integer' || format === 'count') return Math.round(n).toLocaleString('en-US');
    if (format === 'days') unit = n === 1 ? 'day' : 'days';
    var text = Number(n.toFixed(1)).toLocaleString('en-US', { maximumFractionDigits: 1 });
    return unit ? text + ' ' + unit : text;
  }

  function changeText(abs, meta) {
    var format = String((meta && meta.format) || 'number').toLowerCase();
    var sign = abs > 0 ? '+' : (abs < 0 ? '-' : '');
    if (format === 'currency') return sign + Math.abs(abs).toLocaleString('en-US', { style: 'currency', currency: firmCurrency(), maximumFractionDigits: 0 });
    if (format === 'integer' || format === 'count') return sign + Math.round(Math.abs(abs)).toLocaleString('en-US');
    if (format === 'percentage' || format === 'percent') return sign + Math.abs(abs).toFixed(1) + ' points';
    var unit = format === 'days' ? 'days' : (meta && meta.unit ? String(meta.unit) : '');
    return sign + Math.abs(abs).toFixed(1) + (unit ? ' ' + unit : '');
  }

  function dayBefore(iso) {
    var time = Date.parse(String(iso).substring(0, 10) + 'T00:00:00Z');
    return isFinite(time) ? new Date(time - 86400000).toISOString().substring(0, 10) : null;
  }

  /** The summary card: { value, direction, changeText, priorText, priorDays, bars }. */
  function summary(payload) {
    var current = (payload && payload.current) || {};
    var meta = { format: current.format, unit: current.unit || (payload && payload.metric && payload.metric.unit) };
    var value = toNumber(current.value_numeric !== undefined && current.value_numeric !== null ? current.value_numeric : current.value);
    // The server's own text wins: it owns the units, singular included ("1 case").
    var mainText = value !== null && typeof current.formatted_value === 'string' && current.formatted_value.trim() !== ''
      ? current.formatted_value.trim() : formatValue(value, meta);
    // The server withheld the comparison (comparison_hidden): its message
    // goes in place of the change, and there is nothing to compare.
    // Top level on the detail payload (data.comparison_hidden, with data.comparison null).
    var hidden = (payload && payload.comparison_hidden) || null;
    if (hidden && typeof hidden === 'object' && value !== null) {
      var shared = typeof globalThis !== 'undefined' && globalThis.DataState ? globalThis.DataState : null;
      return { value: mainText, direction: null, changeText: null, priorText: null, priorDays: null, bars: null,
        hiddenText: shared ? shared.comparisonHiddenText({ comparison_hidden: hidden }) : String(hidden.message || 'No comparison for these dates.') };
    }
    var cmp = payload && payload.comparison;
    if (!cmp && payload && payload.movement) {
      cmp = { previous_value: payload.movement.prior_value, percent_change: payload.movement.percent_change, direction: payload.movement.direction };
    }
    var prior = cmp ? toNumber(cmp.previous_value) : null;
    // A null value means nothing was recorded for these dates: the calm
    // words, and no change, prior or bars to compare against.
    if (value === null) {
      return { value: NO_DATA_TEXT, noData: true, direction: null, changeText: null, priorText: null, priorDays: null, bars: null };
    }
    var empty = { value: mainText, direction: null, changeText: null, priorText: null, priorDays: null, bars: null };
    if (!cmp || prior === null) return empty;
    var abs = toNumber(cmp.absolute_change);
    if (abs === null) abs = value - prior;
    var pct = toNumber(cmp.percent_change);
    var direction = cmp.direction === 'up' || cmp.direction === 'down' ? cmp.direction : 'flat';
    var words = direction === 'up' ? 'Up' : (direction === 'down' ? 'Down' : 'No change');
    var change = words + (pct !== null && direction !== 'flat' ? ' ' + oneDecimal(pct) + '%' : '') + ', ' + changeText(abs, meta);
    var period = cmp.previous_period;
    var max = Math.max(Math.abs(value), Math.abs(prior));
    return {
      value: mainText,
      direction: direction,
      changeText: change,
      priorText: 'vs ' + formatValue(prior, meta) + ' in the prior period',
      priorDays: period && period.start && period.end ? { start: String(period.start).substring(0, 10), end: dayBefore(period.end) } : null,
      bars: max > 0 ? { currentPct: Math.round((Math.abs(value) / max) * 1000) / 10, priorPct: Math.round((Math.abs(prior) / max) * 1000) / 10 } : null,
    };
  }

  var NO_DATA_TEXT = 'No data for these dates';

  // The period line: the backend's label, else the picked dates, else ''.
  function periodText(period, start, end, asOf) {
    // An as-of card: "As of Nov 27, 2026".
    if (asOf) return 'As of ' + dayText(String(asOf).substring(0, 10));
    if (period && period.label) return String(period.label);
    return start && end ? dayRangeText({ start: String(start).substring(0, 10), end: String(end).substring(0, 10) }) : '';
  }

  function dayRangeText(days) {
    if (!days || !days.start || !days.end) return '';
    return dayText(days.start) + ' to ' + dayText(days.end);
  }

  // A records row for the table: raw values (so sorting works), plus the
  // workspace link for the matter when the row carries one.
  function recordsRow(row, index) {
    var out = { _row_id: 'row-' + index, _href: linkFor(row || {}) };
    Object.keys(row || {}).forEach(function (key) { out[key] = row[key]; });
    return out;
  }

  // raw_data.rows_status from metric detail. Missing, or available: true,
  // means the rows were read (even zero): null. available: false means the
  // server could not read them, so say so calmly instead of "no records".
  var UNAVAILABLE_TITLE = 'Records not available for this card';
  var UNAVAILABLE_MESSAGE = 'LANA could not read the records behind this number.';

  function rowsStatus(rawData) {
    var status = rawData && rawData.rows_status;
    if (!status || typeof status !== 'object' || status.available !== false) return null;
    var message = typeof status.message === 'string' && status.message.trim() ? status.message.trim() : UNAVAILABLE_MESSAGE;
    return { reason: status.reason || null, title: UNAVAILABLE_TITLE, message: message };
  }

  var HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeText(value) {
    return String(value).split('').map(function (ch) { return HTML_ESCAPES[ch] || ch; }).join('');
  }

  // The calm note shown in place of a records table.
  function unavailableHtml(status) {
    return '<div class="records-unavailable"><p class="records-unavailable__title">' + escapeText(status.title) + '</p>'
      + '<p class="records-unavailable__text">' + escapeText(status.message) + '</p></div>';
  }

  return {
    dayRangeText: dayRangeText,
    cellText: cellText,
    formatCell: formatCell,
    worklistColumns: worklistColumns,
    recordsRow: recordsRow,
    recordsTable: recordsTable,
    formatValue: formatValue,
    summary: summary,
    rowNotes: rowNotes,
    isServerRows: isServerRows,
    rowsRequestParams: rowsRequestParams,
    urlFilters: urlFilters,
    linkFilterText: linkFilterText,
    rowsCountText: rowsCountText,
    truncatedText: truncatedText,
    facetFilterOptions: facetFilterOptions,
    keepsServerOrder: keepsServerOrder,
    recordsHeader: recordsHeader,
    periodText: periodText,
    isUuid: isUuid,
    rowsStatus: rowsStatus,
    unavailableHtml: unavailableHtml,
  };
});
