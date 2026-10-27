/**
 * library-column-filters.js
 * Column filter values shared by the Document Library and Template Library
 * tables: the Last edited ranges, and the workspace list.
 *
 * Public API (window.LanaLibraryColumnFilters, or module.exports in Node):
 *   - EDITED_RANGE_OPTIONS               -> [{ value, label }] for a single-choice filter
 *   - editedRangeBounds(value, now)      -> { after, before } ISO strings (either may be '')
 *   - workspaceOptions(matters, key)     -> [{ value, label }] sorted by name
 *   - loadWorkspaces(api)                -> Promise of every /storage/matters row
 *   - loadWorkspaceOptions(api)          -> Promise of workspaceOptions(all workspaces)
 *
 * Workspaces have two ids: matter_id (the readable key files carry and
 * workspace-details opens, e.g. MATT-53937) and id (the internal uuid
 * templates carry). Pass key 'id' for template filters.
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

  // The user's timezone, from the same lookup Lex.Utils formats dates with
  // (profile, then org, then browser).
  function userTimeZone() {
    if (global.Lex && global.Lex.Utils && typeof global.Lex.Utils.getOrganizationTimezone === 'function') {
      return global.Lex.Utils.getOrganizationTimezone();
    }
    return '';
  }

  // Milliseconds the zone is ahead of UTC at that instant.
  function zoneOffsetMs(date, timeZone) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).forEach(function (part) { parts[part.type] = Number(part.value); });
    var asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
  }

  /**
   * Midnight starting `now`'s calendar day in the given zone, as a Date.
   * Without a usable zone, the browser's local midnight.
   */
  function startOfDayInZone(now, timeZone) {
    try {
      if (!timeZone) throw new Error('no zone');
      var parts = {};
      new Intl.DateTimeFormat('en-US', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(now).forEach(function (part) { parts[part.type] = Number(part.value); });
      var guess = Date.UTC(parts.year, parts.month - 1, parts.day);
      var midnight = guess - zoneOffsetMs(new Date(guess), timeZone);
      // Re-check the offset at the result in case a DST change falls in between.
      return new Date(guess - zoneOffsetMs(new Date(midnight), timeZone));
    } catch (_error) {
      var local = new Date(now.getTime());
      local.setHours(0, 0, 0, 0);
      return local;
    }
  }

  /**
   * Server bounds for a Last edited range: updated_after (inclusive) and
   * updated_before (exclusive), as ISO strings. Unknown values give no bounds.
   * "Today" starts at midnight in the user's timezone; the others are spans.
   * @param {string} value - one of EDITED_RANGE_OPTIONS' values
   * @param {Date} [now]
   * @param {string} [timeZone] - defaults to the user's timezone
   * @returns {{ after: string, before: string }}
   */
  function editedRangeBounds(value, now, timeZone) {
    var current = now instanceof Date ? now : new Date();
    var thirtyDaysAgo = new Date(current.getTime() - 30 * DAY_MS).toISOString();
    switch (value) {
      case 'today': return { after: startOfDayInZone(current, timeZone || userTimeZone()).toISOString(), before: '' };
      case '7d': return { after: new Date(current.getTime() - 7 * DAY_MS).toISOString(), before: '' };
      case '30d': return { after: thirtyDaysAgo, before: '' };
      case 'older': return { after: '', before: thirtyDaysAgo };
      default: return { after: '', before: '' };
    }
  }

  /**
   * Whether a timestamp falls in a range option, using the same bounds the
   * server-filtered tables send. For client-side tables.
   * @param {string} value - ISO timestamp (API time, UTC)
   * @param {string} range - an EDITED_RANGE_OPTIONS value
   * @param {Date} [now]
   * @param {string} [timeZone]
   * @returns {boolean}
   */
  function inEditedRange(value, range, now, timeZone) {
    var bounds = editedRangeBounds(range, now, timeZone);
    if (!bounds.after && !bounds.before) return true;
    var lexUtils = global && global.Lex && global.Lex.Utils;
    var date = value && lexUtils && lexUtils.parseApiUtcDate ? lexUtils.parseApiUtcDate(value) : (value ? new Date(value) : null);
    var time = date ? date.getTime() : NaN;
    if (!Number.isFinite(time)) return false;
    if (bounds.after && time < new Date(bounds.after).getTime()) return false;
    if (bounds.before && time >= new Date(bounds.before).getTime()) return false;
    return true;
  }

  /**
   * Filter options from /api/v1/storage/matters rows: value = matter_id (the
   * id files carry) or the given key, label = workspace name. Names shared by
   * several workspaces get their readable id appended so the choices stay
   * distinct.
   * @param {Array} matters
   * @param {string} [key] - 'matter_id' (default) or 'id'
   * @returns {Array<{value: string, label: string}>}
   */
  function workspaceOptions(matters, key) {
    var valueKey = key === 'id' ? 'id' : 'matter_id';
    var seen = {};
    var options = [];
    var nameCounts = {};
    (matters || []).forEach(function (matter) {
      var value = matter && (valueKey === 'id' ? matter.id : (matter.matter_id || matter.id));
      if (!value || seen[value]) return;
      seen[value] = true;
      var readable = String(matter.matter_id || value);
      var name = String(matter.name || matter.matter_name || readable);
      nameCounts[name] = (nameCounts[name] || 0) + 1;
      options.push({ value: String(value), label: name, readable: readable });
    });
    options.forEach(function (option) {
      if (nameCounts[option.label] > 1 && option.label !== option.readable) {
        option.label = option.label + ' \u00b7 ' + option.readable;
      }
      delete option.readable;
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
    return workspaceOptions(await loadWorkspaces(api));
  }

  /**
   * Every /storage/matters row the user can see ({ id, matter_id, name, ... }).
   * @param {Object} api - window.api
   * @returns {Promise<Array>}
   */
  async function loadWorkspaces(api) {
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
    return matters;
  }

  var moduleApi = {
    EDITED_RANGE_OPTIONS: EDITED_RANGE_OPTIONS,
    editedRangeBounds: editedRangeBounds,
    inEditedRange: inEditedRange,
    workspaceOptions: workspaceOptions,
    loadWorkspaces: loadWorkspaces,
    loadWorkspaceOptions: loadWorkspaceOptions
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaLibraryColumnFilters = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
