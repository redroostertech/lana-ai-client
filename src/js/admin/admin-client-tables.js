/**
 * admin-client-tables.js
 * Header filters and counts for the small client-side admin tables
 * (docs/TABLE-STANDARD.md, sections 4 and 7): the whole set arrives in one
 * request, so lex-table filters it in the browser and the page supplies
 * predicates for the date and number ranges.
 *
 * Public API (window.AdminClientTables, or module.exports in Node):
 *   - rangeFilter(ranges)              -> { single, options, match } for a number column
 *   - inRange(ranges, value, key)      -> bool (min inclusive, max exclusive)
 *   - dateFilter()                     -> { single, options, match } for a timestamp column
 *   - valueOptions(rows, key, labelFn) -> [{ value, label }] of the distinct values, sorted by label
 *   - bindCount(table, ids, noun)      -> keeps "N items" in sync with table.filteredRows
 *
 * ranges: [{ value: 'lt100', label: 'Under 100 ms', max: 100 }, { value: ..., min: 100, max: 500 }]
 */

(function (global) {
  'use strict';

  function shared() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('../shared/library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function capitalize(value) {
    var lex = global && global.Lex && global.Lex.Utils;
    if (lex && typeof lex.humanizeLabel === 'function') return lex.humanizeLabel(value);
    var text = String(value == null ? '' : value).split('_').join(' ').split('-').join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function inRange(ranges, value, key) {
    var range = null;
    for (var i = 0; i < ranges.length; i++) {
      if (ranges[i].value === key) { range = ranges[i]; break; }
    }
    if (!range) return true;
    if (value === null || value === undefined || value === '') return false;
    var n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (range.min !== undefined && n < range.min) return false;
    if (range.max !== undefined && n >= range.max) return false;
    return true;
  }

  function rangeFilter(ranges) {
    return {
      single: true,
      options: ranges.map(function (r) { return { value: r.value, label: r.label }; }),
      match: function (cell, values) { return inRange(ranges, cell, values && values[0]); }
    };
  }

  function dateFilter() {
    var helpers = shared();
    return {
      single: true,
      options: helpers ? helpers.EDITED_RANGE_OPTIONS : [],
      match: function (cell, values) {
        return helpers ? helpers.inEditedRange(cell, values && values[0]) : true;
      }
    };
  }

  function valueOptions(rows, key, labelFn) {
    var seen = {};
    var options = [];
    (rows || []).forEach(function (row) {
      var value = row ? row[key] : null;
      if (value === null || value === undefined || value === '') return;
      var str = String(value);
      if (seen[str]) return;
      seen[str] = true;
      options.push({ value: str, label: String(labelFn ? labelFn(value, row) : capitalize(value)) });
    });
    return options.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function countText(n, noun) {
    var total = Number(n) || 0;
    return total + ' ' + (total === 1 ? noun[0] : noun[1]);
  }

  /**
   * Counts on a client-side table: the rows matching the search and filters
   * across every page (table.filteredRows).
   */
  function bindCount(table, ids, noun) {
    var doc = global.document;
    function update() {
      var rows = table.filteredRows;
      var text = Array.isArray(rows) ? countText(rows.length, noun) : '';
      (ids || []).forEach(function (id) {
        var node = doc.getElementById(id);
        if (node) node.textContent = text;
      });
    }
    ['lex-data-loaded', 'lex-filter-change', 'lex-search'].forEach(function (name) {
      table.addEventListener(name, function (event) {
        if (event.target === table) update();
      });
    });
    return { update: update };
  }

  var moduleApi = {
    rangeFilter: rangeFilter,
    inRange: inRange,
    dateFilter: dateFilter,
    valueOptions: valueOptions,
    countText: countText,
    bindCount: bindCount
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AdminClientTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
