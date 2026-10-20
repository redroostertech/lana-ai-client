/**
 * library-column-filters.js
 * Column filter values shared by the Document Library and Template Library
 * tables: the Last edited ranges, and the workspace list.
 *
 * Public API (window.LanaLibraryColumnFilters, or module.exports in Node):
 *   - EDITED_RANGE_OPTIONS               -> [{ value, label }] for a single-choice filter
 *   - editedRangeBounds(value, now)      -> { after, before } ISO strings (either may be '')
 *   - workspaceOptions(matters)          -> [{ value, label }] sorted by name
 *   - loadWorkspaceOptions(api)          -> Promise of workspaceOptions(all workspaces)
 */

(function (global) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  // /api/v1/storage/matters serves at most 100 per page; stop after 20 pages.
  var WORKSPACE_PAGE_SIZE = 100;
  var WORKSPACE_MAX_PAGES = 20;

  var EDITED_RANGE_OPTIONS = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: 'older', label: 'Older than 30 days' }
  ];

  function startOfLocalDay(date) {
    if (global.LanaTime && typeof global.LanaTime.startOfLocalDay === 'function') {
      return global.LanaTime.startOfLocalDay(date);
    }
    var copy = new Date(date.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  /**
   * Server bounds for a Last edited range: updated_after (inclusive) and
   * updated_before (exclusive), as ISO strings. Unknown values give no bounds.
   * @param {string} value - one of EDITED_RANGE_OPTIONS' values
   * @param {Date} [now]
   * @returns {{ after: string, before: string }}
   */
  function editedRangeBounds(value, now) {
    var current = now instanceof Date ? now : new Date();
    var thirtyDaysAgo = new Date(current.getTime() - 30 * DAY_MS).toISOString();
    switch (value) {
      case 'today': return { after: startOfLocalDay(current).toISOString(), before: '' };
      case '7d': return { after: new Date(current.getTime() - 7 * DAY_MS).toISOString(), before: '' };
      case '30d': return { after: thirtyDaysAgo, before: '' };
      case 'older': return { after: '', before: thirtyDaysAgo };
      default: return { after: '', before: '' };
    }
  }

  /**
   * Filter options from /api/v1/storage/matters rows: value = matter_id (the
   * id files and templates carry), label = workspace name. Names shared by
   * several workspaces get their id appended so the choices stay distinct.
   * @param {Array} matters
   * @returns {Array<{value: string, label: string}>}
   */
  function workspaceOptions(matters) {
    var seen = {};
    var options = [];
    var nameCounts = {};
    (matters || []).forEach(function (matter) {
      var value = matter && (matter.matter_id || matter.id);
      if (!value || seen[value]) return;
      seen[value] = true;
      var name = String(matter.name || matter.matter_name || value);
      nameCounts[name] = (nameCounts[name] || 0) + 1;
      options.push({ value: String(value), label: name });
    });
    options.forEach(function (option) {
      if (nameCounts[option.label] > 1 && option.label !== option.value) {
        option.label = option.label + ' \u00b7 ' + option.value;
      }
    });
    return options.sort(function (a, b) {
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });
    });
  }

  /**
   * Every workspace the user can see, as filter options. Failures give [] so
   * the column simply shows no filter.
   * @param {Object} api - window.api
   * @returns {Promise<Array<{value: string, label: string}>>}
   */
  async function loadWorkspaceOptions(api) {
    if (!api || typeof api.get !== 'function') return [];
    var matters = [];
    try {
      for (var page = 1; page <= WORKSPACE_MAX_PAGES; page += 1) {
        var response = await api.get('/api/v1/storage/matters?page=' + page + '&limit=' + WORKSPACE_PAGE_SIZE + '&sort=name&order=asc');
        var rows = (response && response.matters) || [];
        matters = matters.concat(rows);
        var totalPages = Number(response && response.pagination && response.pagination.total_pages) || 1;
        if (!rows.length || page >= totalPages) break;
      }
    } catch (_error) {
      if (!matters.length) return [];
    }
    return workspaceOptions(matters);
  }

  var moduleApi = {
    EDITED_RANGE_OPTIONS: EDITED_RANGE_OPTIONS,
    editedRangeBounds: editedRangeBounds,
    workspaceOptions: workspaceOptions,
    loadWorkspaceOptions: loadWorkspaceOptions
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaLibraryColumnFilters = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
