/**
 * Chart points (pure, no DOM).
 *
 * A chart value from the server: a number (or numeric string) passes
 * through and a real 0 stays 0; null, missing, empty or non-numeric values
 * are gaps (null), so a line breaks and no bar is drawn instead of a false
 * 0. Used by the Reports charts (report.js) and the time series renderer.
 * No regex (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChartPoints = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function value(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string' && raw.trim() === '') return null;
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    var n = Number(raw);
    return isFinite(n) ? n : null;
  }

  // The first argument that is not a gap (a real 0 counts), else null.
  function firstValue() {
    for (var i = 0; i < arguments.length; i += 1) {
      var n = value(arguments[i]);
      if (n !== null) return n;
    }
    return null;
  }

  return { value: value, firstValue: firstValue };
});
