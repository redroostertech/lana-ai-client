/**
 * document-types-table.js
 * Rows, cell renderers and column filters for the Learned Document Types
 * table on the Workspace Details Document Generation tab (docTypesTable).
 * See docs/TABLE-STANDARD.md.
 *
 * Data: GET /api/v1/matters/:matterId/document-types returns the whole set
 * for one matter (a handful of types), so the table is client-side.
 *
 * Public API (window.LanaDocumentTypesTable, or module.exports in Node):
 *   - SOURCE_OPTIONS, STRUCTURE_OPTIONS, COUNT_RANGES, CONFIDENCE_RANGES
 *   - typeRow(type)                     -> row (raw values + _raw)
 *   - buildRows(types)                  -> rows (the toolbar search runs in the table)
 *   - renderers()                       -> lex-table cell renderers
 *   - filterOptions(rows, ranges)       -> setColumnFilterOptions map
 *   - inRange(value, rangeValue, ranges)-> bool for the number range filters
 *   - emptyText(filtered)               -> empty-state copy
 */

(function (global) {
  'use strict';

  var SOURCE_OPTIONS = [
    { value: 'auto_detected', label: 'Auto detected' },
    { value: 'template_set', label: 'Template set' }
  ];

  var STRUCTURE_OPTIONS = [
    { value: 'learned', label: 'Learned' },
    { value: 'not_analyzed', label: 'Not analyzed' }
  ];

  // min inclusive, max exclusive (docs/TABLE-STANDARD.md, section 7)
  var COUNT_RANGES = [
    { value: '0-1', label: 'Fewer than 1', min: 0, max: 1 },
    { value: '1-5', label: '1 to 4', min: 1, max: 5 },
    { value: '5-20', label: '5 to 19', min: 5, max: 20 },
    { value: '20-', label: '20 or more', min: 20, max: null }
  ];

  var CONFIDENCE_RANGES = [
    { value: '0-40', label: 'Low (under 40%)', min: 0, max: 40 },
    { value: '40-70', label: 'Medium (40% to 69%)', min: 40, max: 70 },
    { value: '70-', label: 'High (70% or more)', min: 70, max: null }
  ];

  var SOURCE_COLORS = { auto_detected: 'blue', template_set: 'indigo' };
  var STRUCTURE_COLORS = { learned: 'green', not_analyzed: 'gray' };

  function utils() {
    return global && global.Lex && global.Lex.Utils ? global.Lex.Utils : null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function muted() {
    return '<span class="wd-table-muted">—</span>';
  }

  function label(value) {
    var text = value == null ? '' : String(value);
    var u = utils();
    if (u && typeof u.humanizeLabel === 'function') return u.humanizeLabel(text);
    text = text.split('_').join(' ').split('-').join(' ').split(' ').filter(Boolean).join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function optionLabel(options, value) {
    for (var i = 0; i < options.length; i++) {
      if (options[i].value === value) return options[i].label;
    }
    return label(value);
  }

  // The API sends 0..1 scores; the table keeps a 0..100 integer so the
  // range filter and sort work on the same number the cell shows.
  function confidencePercent(t) {
    var score = t.structure_confidence;
    if (score === null || score === undefined || score === '') score = t.avg_confidence;
    if (score === null || score === undefined || score === '') score = t.confidence_score;
    var n = Number(score);
    if (!Number.isFinite(n)) return null;
    return Math.round((n <= 1 ? n * 100 : n));
  }

  function typeRow(type) {
    var t = type || {};
    var count = Number(t.document_count);
    return {
      id: String(t.document_type || ''),
      document_type: String(t.document_type_label || t.document_type || ''),
      source: String(t.source || ''),
      document_count: Number.isFinite(count) ? count : 0,
      confidence: confidencePercent(t),
      structure: (t.has_structure || t.structure_version) ? 'learned' : 'not_analyzed',
      created_at: t.created_at || t.first_classified_at || '',
      _raw: t
    };
  }

  function buildRows(types) {
    return (types || []).map(typeRow);
  }

  function badge(text, color) {
    return '<lex-badge label="' + esc(text) + '" color="' + esc(color) + '" size="sm"></lex-badge>';
  }

  function renderers() {
    return {
      document_type: function (val, row) {
        if (!val) return muted();
        var raw = (row && row._raw) || {};
        var sub = raw.template_set_name ? '<span class="wd-table-sub" title="' + esc(raw.template_set_name) + '">' + esc(raw.template_set_name) + '</span>' : '';
        return '<span class="wd-table-name" title="' + esc(val) + '">' + esc(label(val)) + '</span>' + sub;
      },
      source: function (val) {
        return val ? badge(optionLabel(SOURCE_OPTIONS, val), SOURCE_COLORS[val] || 'gray') : muted();
      },
      document_count: function (val) {
        return '<span class="wd-table-num">' + esc(Number(val) || 0) + '</span>';
      },
      confidence: function (val) {
        if (val === null || val === undefined || val === '') return muted();
        var color = val >= 70 ? 'green' : val >= 40 ? 'yellow' : 'red';
        return badge(val + '%', color);
      },
      structure: function (val) {
        return badge(optionLabel(STRUCTURE_OPTIONS, val), STRUCTURE_COLORS[val] || 'gray');
      },
      created_at: function (val) {
        var u = utils();
        var full = val && u && typeof u.formatDateTime === 'function' ? u.formatDateTime(val) : '';
        if (!full || full === 'Never') return muted();
        var rel = typeof u.timeAgo === 'function' ? u.timeAgo(val) : '';
        return '<time class="wd-table-time" datetime="' + esc(val) + '" title="' + esc(rel) + '">' + esc(full) + '</time>';
      }
    };
  }

  function findRange(list, value) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].value === value) return list[i];
    }
    return null;
  }

  function inRange(value, rangeValue, list) {
    var range = findRange(list, rangeValue);
    if (!range) return true;
    if (value === null || value === undefined || value === '') return false;
    var n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (range.min !== null && n < range.min) return false;
    if (range.max !== null && n >= range.max) return false;
    return true;
  }

  function strip(list) {
    return list.map(function (r) { return { value: r.value, label: r.label }; });
  }

  /**
   * Header filters for every column. ranges = LanaLibraryColumnFilters.
   */
  function filterOptions(rows, ranges) {
    var present = {};
    (rows || []).forEach(function (r) { if (r.source) present[r.source] = true; });
    var sources = SOURCE_OPTIONS.filter(function (o) { return present[o.value]; });
    Object.keys(present).forEach(function (v) {
      if (!findRange(SOURCE_OPTIONS, v)) sources.push({ value: v, label: label(v) });
    });
    var map = {
      document_type: { text: true, placeholder: 'Type contains...' },
      source: { options: sources.length ? sources : SOURCE_OPTIONS.slice() },
      document_count: { single: true, options: strip(COUNT_RANGES), match: function (cell, v) { return inRange(cell, v[0], COUNT_RANGES); } },
      confidence: { single: true, options: strip(CONFIDENCE_RANGES), match: function (cell, v) { return inRange(cell, v[0], CONFIDENCE_RANGES); } },
      structure: { options: STRUCTURE_OPTIONS.slice() }
    };
    if (ranges) {
      map.created_at = {
        single: true,
        options: ranges.EDITED_RANGE_OPTIONS,
        match: function (cell, v) { return ranges.inEditedRange(cell, v[0]); }
      };
    }
    return map;
  }

  function emptyText(filtered) {
    return filtered
      ? 'No matching document types. Try a different search or clear the filters.'
      : 'No document types learned yet';
  }

  var api = {
    SOURCE_OPTIONS: SOURCE_OPTIONS,
    STRUCTURE_OPTIONS: STRUCTURE_OPTIONS,
    COUNT_RANGES: COUNT_RANGES,
    CONFIDENCE_RANGES: CONFIDENCE_RANGES,
    typeRow: typeRow,
    buildRows: buildRows,
    renderers: renderers,
    filterOptions: filterOptions,
    inRange: inRange,
    emptyText: emptyText
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.LanaDocumentTypesTable = api;
})(typeof window !== 'undefined' ? window : globalThis);
