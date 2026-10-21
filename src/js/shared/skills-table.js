/**
 * skills-table.js
 * Row mapping, cell renderers and column filters for the Skills list
 * (skills.html #skillsListView), following docs/TABLE-STANDARD.md.
 *
 * The skills list arrives in one request and is small, so the table runs
 * client-side: rows keep raw values (slugs, counts, ISO timestamps) and all
 * formatting happens in the renderers.
 *
 * Public API (window.LanaSkillsTable, or module.exports in Node):
 *   - SORT_OPTIONS                       -> [{ value, label }] for the toolbar Sort by
 *   - RUN_RANGES                         -> Runs column ranges, min inclusive, max exclusive
 *   - mapSkillRow(skill)                 -> raw row for lex-table
 *   - labelFor(value)                    -> enum/slug as a readable label
 *   - valueOptions(rows, key, labelFn)   -> distinct values as [{ value, label }]
 *   - inRunRange(count, rangeKey)        -> boolean
 *   - columnFilterOptions(rows, ranges)  -> setColumnFilterOptions map
 *   - categoryFilterOptions(rows)        -> toolbar Category select options
 *   - cellRenderers()                    -> setCellRenderers map
 *   - isFiltered(search, filters)        -> boolean
 *   - emptyText(filtered)                -> empty state copy
 *   - countLabel(total)                  -> "N skills"
 */

(function (global) {
  'use strict';

  var SORT_OPTIONS = [
    { value: 'created_at', label: 'Created' },
    { value: 'skill_name', label: 'Name' },
    { value: 'category', label: 'Category' },
    { value: 'skill_type', label: 'Type' },
    { value: 'version', label: 'Version' },
    { value: 'installation_count', label: 'Runs' }
  ];

  var RUN_RANGES = {
    none: { label: 'Never run', min: 0, max: 1 },
    '1_10': { label: '1 – 9', min: 1, max: 10 },
    '10_100': { label: '10 – 99', min: 10, max: 100 },
    over_100: { label: '100 or more', min: 100, max: null }
  };

  function utils() {
    var scope = global && global.Lex ? global : (typeof globalThis !== 'undefined' ? globalThis : null);
    return scope && scope.Lex && scope.Lex.Utils ? scope.Lex.Utils : null;
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
    return '<span class="skills-table-muted">—</span>';
  }

  // "document-intelligence" -> "Document intelligence".
  function labelFor(value) {
    var text = value == null ? '' : String(value);
    if (!text) return '';
    var lexUtils = utils();
    if (lexUtils && typeof lexUtils.humanizeLabel === 'function') return lexUtils.humanizeLabel(text);
    var words = text.split('_').join(' ').split('-').join(' ').split(' ').filter(Boolean).join(' ');
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
  }

  /**
   * One skill as a lex-table row. Accepts both the skills shape (skill_*)
   * and the renamed automations shape (automation_*).
   * @param {Object} skill
   * @returns {Object}
   */
  function mapSkillRow(skill) {
    var source = skill || {};
    var meta = source.metadata || {};
    var config = source.skill_config || source.automation_config || {};
    var runs = Number(source.installation_count || source.total_executions || 0);
    return {
      skill_id: source.skill_id || source.automation_id || source.id || '',
      skill_name: source.skill_name || source.automation_name || source.name || '',
      description: source.skill_description || source.automation_description || source.description ||
        config.description || meta.description || '',
      category: source.category || config.category || meta.category || 'automation',
      skill_type: source.skill_type || config.skill_type || config.automation_type || meta.skill_type || '',
      version: String(source.skill_version || source.automation_version || source.version ||
        config.version || meta.version || '1.0.0'),
      installation_count: Number.isFinite(runs) ? runs : 0,
      created_at: source.created_at || '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      _raw: source
    };
  }

  /**
   * Distinct non-empty values of a row key as filter options, sorted by label.
   * @param {Array} rows
   * @param {string} key
   * @param {Function} [labelFn] - defaults to labelFor
   */
  function valueOptions(rows, key, labelFn) {
    var toLabel = typeof labelFn === 'function' ? labelFn : labelFor;
    var seen = {};
    var options = [];
    (rows || []).forEach(function (row) {
      var value = row && row[key];
      if (value === null || value === undefined || value === '') return;
      var text = String(value);
      if (seen[text]) return;
      seen[text] = true;
      options.push({ value: text, label: toLabel(text) });
    });
    return options.sort(function (a, b) {
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  function inRunRange(count, rangeKey) {
    var range = RUN_RANGES[rangeKey];
    if (!range) return true;
    var value = Number(count);
    if (!Number.isFinite(value)) return false;
    if (range.min !== null && value < range.min) return false;
    if (range.max !== null && value >= range.max) return false;
    return true;
  }

  /**
   * Every column filters (table standard section 7).
   * @param {Array} rows - mapped rows
   * @param {Object} [ranges] - window.LanaLibraryColumnFilters
   */
  function columnFilterOptions(rows, ranges) {
    var map = {
      skill_name: { text: true, placeholder: 'Name contains...' },
      description: { text: true, placeholder: 'Description contains...' },
      category: { options: valueOptions(rows, 'category') },
      skill_type: { options: valueOptions(rows, 'skill_type') },
      version: { options: valueOptions(rows, 'version', String) },
      installation_count: {
        single: true,
        options: Object.keys(RUN_RANGES).map(function (key) { return { value: key, label: RUN_RANGES[key].label }; }),
        match: function (cell, values) { return inRunRange(cell, values[0]); }
      }
    };
    if (ranges && ranges.EDITED_RANGE_OPTIONS) {
      map.created_at = {
        single: true,
        options: ranges.EDITED_RANGE_OPTIONS,
        match: function (cell, values) { return ranges.inEditedRange(cell, values[0]); }
      };
    }
    return map;
  }

  function categoryFilterOptions(rows) {
    return [{ value: 'all', label: 'All' }].concat(valueOptions(rows, 'category'));
  }

  function cellRenderers() {
    return {
      skill_name: function (val) {
        return val ? '<span class="skills-table-name">' + esc(val) + '</span>' : muted();
      },
      description: function (val) {
        return val ? '<span class="skills-table-truncate" title="' + esc(val) + '">' + esc(val) + '</span>' : muted();
      },
      category: function (val) {
        return val ? esc(labelFor(val)) : muted();
      },
      skill_type: function (val) {
        return val ? esc(labelFor(val)) : muted();
      },
      version: function (val) {
        return val ? '<span class="skills-table-secondary">' + esc(val) + '</span>' : muted();
      },
      installation_count: function (val) {
        var count = Number(val);
        return Number.isFinite(count) ? esc(count.toLocaleString('en-US')) : muted();
      },
      created_at: function (val) {
        var lexUtils = utils();
        var text = val && lexUtils ? lexUtils.formatDateTime(val) : '';
        if (!text || text === 'Never') return muted();
        return '<time class="skills-table-time" datetime="' + esc(val) + '">' + esc(text) + '</time>';
      }
    };
  }

  function isFiltered(search, filters) {
    return Boolean(String(search || '').trim() || Object.keys(filters || {}).length);
  }

  function emptyText(filtered) {
    return filtered ? 'No matching skills. Try a different search or clear the filters.' : 'No skills yet';
  }

  function countLabel(total) {
    var n = Number(total) || 0;
    return n + (n === 1 ? ' skill' : ' skills');
  }

  var moduleApi = {
    SORT_OPTIONS: SORT_OPTIONS,
    RUN_RANGES: RUN_RANGES,
    mapSkillRow: mapSkillRow,
    labelFor: labelFor,
    valueOptions: valueOptions,
    inRunRange: inRunRange,
    columnFilterOptions: columnFilterOptions,
    categoryFilterOptions: categoryFilterOptions,
    cellRenderers: cellRenderers,
    isFiltered: isFiltered,
    emptyText: emptyText,
    countLabel: countLabel
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaSkillsTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
