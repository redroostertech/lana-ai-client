/**
 * search-analytics-tables.js
 * The three record tables of admin/search-analytics.html on the table
 * standard (docs/TABLE-STANDARD.md): Top queries, Zero-result queries and
 * Slow queries. Each API returns one capped list for the chosen period with
 * no paging, so every table is client-side over that list.
 *
 * Public API (window.SearchAnalyticsTables, or module.exports in Node):
 *   - FETCH_LIMIT                      -> rows asked of each endpoint
 *   - periodParams(days, start, end)   -> URLSearchParams for the period
 *   - mapTopQuery(q, i), mapZeroResult(q, i), mapSlowQuery(q, i) -> raw rows
 *   - renderers.top(), renderers.zero(), renderers.slow() -> lex-table cell renderers
 *   - filters.top(rows), filters.zero(rows), filters.slow(rows) -> header filters
 *   - capNote(count)                   -> heading note when the list hit FETCH_LIMIT
 *
 * @requires admin-table-kit.js, admin-client-tables.js, lex.utils.js
 */

(function (global) {
  'use strict';

  // The endpoints have no paging; ask for enough that the period's list is
  // complete in practice, and say so in the heading when it is not.
  var FETCH_LIMIT = 500;
  var SLOW_THRESHOLD_MS = 100;
  var VERY_SLOW_MS = 500;

  var LATENCY_RANGES = [
    { value: 'lt100', label: 'Under 100 ms', max: 100 },
    { value: '100-500', label: '100–499 ms', min: 100, max: 500 },
    { value: '500-1000', label: '500–999 ms', min: 500, max: 1000 },
    { value: 'gte1000', label: '1 s or more', min: 1000 }
  ];
  var FREQUENCY_RANGES = [
    { value: '1', label: 'Once', max: 2 },
    { value: '2-10', label: '2–9 times', min: 2, max: 10 },
    { value: '10-50', label: '10–49 times', min: 10, max: 50 },
    { value: 'gte50', label: '50 or more', min: 50 }
  ];
  var PERCENT_RANGES = [
    { value: '0', label: '0%', max: 0.0001 },
    { value: '0-25', label: 'Up to 25%', min: 0.0001, max: 25 },
    { value: '25-50', label: '25–49%', min: 25, max: 50 },
    { value: 'gte50', label: '50% or more', min: 50 }
  ];
  var RESULT_RANGES = [
    { value: '0', label: 'None', max: 1 },
    { value: '1-10', label: '1–9', min: 1, max: 10 },
    { value: 'gte10', label: '10 or more', min: 10 }
  ];

  function kit() { return global.AdminTableKit; }
  function client() { return global.AdminClientTables; }
  function humanize(value) {
    return global.Lex && global.Lex.Utils ? global.Lex.Utils.humanizeLabel(value) : String(value || '');
  }

  function periodParams(days, start, end) {
    var params = new URLSearchParams();
    params.set('limit', String(FETCH_LIMIT));
    if (start && end) {
      params.set('startDate', start);
      params.set('endDate', end);
    } else {
      params.set('days', String(days || 7));
    }
    return params;
  }

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function mapTopQuery(q, index) {
    return {
      _key: 'top-' + index,
      query_text: String(q.query_text || ''),
      query_type: q.query_type || '',
      frequency: num(q.frequency),
      avg_latency_ms: num(q.avg_latency_ms),
      zero_result_rate_percent: num(q.zero_result_rate_percent),
      ctr_percent: num(q.ctr_percent),
      _raw: q
    };
  }

  function mapZeroResult(q, index) {
    return {
      _key: String(q.id || 'zero-' + index),
      query_text: String(q.query_text || ''),
      query_type: q.query_type || '',
      user: q.user_email || q.user_id || '',
      matter_id: q.matter_id || '',
      created_at: q.created_at || '',
      _raw: q
    };
  }

  function mapSlowQuery(q, index) {
    return {
      _key: String(q.id || 'slow-' + index),
      query_text: String(q.query_text || ''),
      query_type: q.query_type || '',
      latency_ms: num(q.latency_ms),
      result_count: num(q.result_count),
      matter_id: q.matter_id || '',
      created_at: q.created_at || '',
      _raw: q
    };
  }

  function textCell(value) {
    var k = kit();
    if (value === null || value === undefined || value === '') return k.muted('');
    return '<span class="admin-table-text" title="' + k.esc(value) + '">' + k.esc(value) + '</span>';
  }

  function numberCell(value, suffix, digits) {
    var k = kit();
    if (value === null || value === undefined) return k.muted('');
    var text = digits !== undefined ? Number(value).toFixed(digits) : Math.round(value).toLocaleString('en-US');
    return '<span class="admin-table-text">' + k.esc(text + (suffix || '')) + '</span>';
  }

  function queryCell(value) {
    return value ? kit().nameCell(value) : kit().muted('');
  }

  function typeCell(value) {
    return value ? kit().badge(humanize(value), 'gray') : kit().muted('');
  }

  function matterCell(value) {
    return value ? kit().matterLink(value, value) : kit().muted('');
  }

  function latencyCell(value) {
    var k = kit();
    if (value === null || value === undefined) return k.muted('');
    var color = value > VERY_SLOW_MS ? 'red' : 'yellow';
    return k.badge(Math.round(value).toLocaleString('en-US') + ' ms', color);
  }

  var renderers = {
    top: function () {
      return {
        query_text: queryCell,
        query_type: typeCell,
        frequency: function (v) { return numberCell(v); },
        avg_latency_ms: function (v) { return numberCell(v, ' ms'); },
        zero_result_rate_percent: function (v) { return numberCell(v, '%', 1); },
        ctr_percent: function (v) { return numberCell(v, '%', 1); }
      };
    },
    zero: function () {
      return {
        query_text: queryCell,
        query_type: typeCell,
        user: textCell,
        matter_id: matterCell,
        created_at: function (v) { return kit().timeCell(v); }
      };
    },
    slow: function () {
      return {
        query_text: queryCell,
        query_type: typeCell,
        latency_ms: latencyCell,
        result_count: function (v) { return numberCell(v); },
        matter_id: matterCell,
        created_at: function (v) { return kit().timeCell(v); }
      };
    }
  };

  function queryText() { return { text: true, placeholder: 'Query contains...' }; }

  var filters = {
    top: function (rows) {
      var c = client();
      return {
        query_text: queryText(),
        query_type: { options: c.valueOptions(rows, 'query_type') },
        frequency: c.rangeFilter(FREQUENCY_RANGES),
        avg_latency_ms: c.rangeFilter(LATENCY_RANGES),
        zero_result_rate_percent: c.rangeFilter(PERCENT_RANGES),
        ctr_percent: c.rangeFilter(PERCENT_RANGES)
      };
    },
    zero: function (rows) {
      var c = client();
      return {
        query_text: queryText(),
        query_type: { options: c.valueOptions(rows, 'query_type') },
        user: { options: c.valueOptions(rows, 'user', String) },
        matter_id: { options: c.valueOptions(rows, 'matter_id', String) },
        created_at: c.dateFilter()
      };
    },
    slow: function (rows) {
      var c = client();
      return {
        query_text: queryText(),
        query_type: { options: c.valueOptions(rows, 'query_type') },
        latency_ms: c.rangeFilter(LATENCY_RANGES.slice(1)),
        result_count: c.rangeFilter(RESULT_RANGES),
        matter_id: { options: c.valueOptions(rows, 'matter_id', String) },
        created_at: c.dateFilter()
      };
    }
  };

  function capNote(count) {
    return count >= FETCH_LIMIT ? 'Showing the first ' + FETCH_LIMIT + ' for this period' : '';
  }

  var moduleApi = {
    FETCH_LIMIT: FETCH_LIMIT,
    SLOW_THRESHOLD_MS: SLOW_THRESHOLD_MS,
    periodParams: periodParams,
    mapTopQuery: mapTopQuery,
    mapZeroResult: mapZeroResult,
    mapSlowQuery: mapSlowQuery,
    renderers: renderers,
    filters: filters,
    capNote: capNote
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.SearchAnalyticsTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
