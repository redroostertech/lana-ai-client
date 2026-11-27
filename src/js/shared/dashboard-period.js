/**
 * Dashboard period (pure, no DOM).
 *
 * Every dashboard card request and every metric detail link carries the same
 * plain days (YYYY-MM-DD, inclusive end) the page shows. When nothing usable
 * is picked, the page's default range is sent (and the page shows it), so no
 * card ever falls back to a window of its own.
 *
 * No regex anywhere (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DashboardPeriod = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var DEFAULT_PRESET = 'last7days';
  // All time starts here (LanaTime.ALL_TIME_START): such a range asks for
  // no comparison.
  var ALL_TIME_START = '2000-01-01';

  function isAllTime(period) {
    return !!(period && period.start === ALL_TIME_START);
  }

  function isDigits(text) {
    if (!text) return false;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 48 || code > 57) return false;
    }
    return true;
  }

  // A real calendar day written YYYY-MM-DD.
  function isPlainDay(value) {
    if (typeof value !== 'string' || value.length !== 10) return false;
    if (value.charAt(4) !== '-' || value.charAt(7) !== '-') return false;
    var y = value.substring(0, 4);
    var m = value.substring(5, 7);
    var d = value.substring(8, 10);
    if (!isDigits(y) || !isDigits(m) || !isDigits(d)) return false;
    var date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
  }

  /**
   * @param {{start:string,end:string}|null} picked - the days in the inputs
   * @param {{start:string,end:string}|Function} defaultDays - the page's default
   *   range, or a function that returns it (called only when needed)
   * @returns {{periodStart:string, periodEnd:string, usedDefault:boolean}}
   */
  function resolveRequestPeriod(picked, defaultDays) {
    var start = picked && picked.start;
    var end = picked && picked.end;
    if (isPlainDay(start) && isPlainDay(end) && start <= end) {
      return { periodStart: start, periodEnd: end, usedDefault: false };
    }
    var fallback = typeof defaultDays === 'function' ? defaultDays() : defaultDays;
    return { periodStart: fallback.start, periodEnd: fallback.end, usedDefault: true };
  }

  /**
   * The metric detail page for one card, with the same days and grain.
   * options.tab = 'source' opens it on the source records.
   */
  function metricDetailHref(metricKey, period, options) {
    var parts = ['metric_key=' + encodeURIComponent(metricKey || '')];
    if (period && period.asOf) {
      // An as-of card: metric detail takes asOf alone, never a range.
      parts.push('asOf=' + encodeURIComponent(period.asOf));
    } else {
      if (period && period.periodStart) parts.push('periodStart=' + encodeURIComponent(period.periodStart));
      if (period && period.periodEnd) parts.push('periodEnd=' + encodeURIComponent(period.periodEnd));
      if (period && period.compareBy) parts.push('compareBy=' + encodeURIComponent(period.compareBy));
    }
    if (options && options.tab) parts.push('tab=' + encodeURIComponent(options.tab));
    // Where it was opened from, so its breadcrumbs and Back lead there.
    if (options && options.from) parts.push('from=' + encodeURIComponent(options.from));
    if (options && options.dashboardId) parts.push('dashboardId=' + encodeURIComponent(options.dashboardId));
    // Records filters for the table to open with: raw_filter[col]=value.
    var filters = options && options.filters && typeof options.filters === 'object' ? options.filters : {};
    Object.keys(filters).forEach(function (col) {
      if (filters[col] !== null && filters[col] !== undefined && filters[col] !== '') {
        parts.push(encodeURIComponent('raw_filter[' + col + ']') + '=' + encodeURIComponent(filters[col]));
      }
    });
    return 'admin/metric_detail.html?' + parts.join('&');
  }

  /**
   * The quick-select chip to light for these dates, or null for custom
   * dates. Derived from the dates every time, never remembered.
   * @param {{start,end}|null} range
   * @param {Array<[string, {start,end}]>} presets - [name, days] in chip order
   */
  function matchPreset(range, presets) {
    if (!range || !range.start || !range.end || !Array.isArray(presets)) return null;
    for (var i = 0; i < presets.length; i += 1) {
      var days = presets[i][1];
      if (days && days.start === range.start && days.end === range.end) return presets[i][0];
    }
    return null;
  }

  return {
    DEFAULT_PRESET: DEFAULT_PRESET,
    isAllTime: isAllTime,
    matchPreset: matchPreset,
    isPlainDay: isPlainDay,
    resolveRequestPeriod: resolveRequestPeriod,
    metricDetailHref: metricDetailHref,
  };
});
