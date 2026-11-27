/**
 * As-of reports (layout.period_mode 'as_of'): the small adapter that reads
 * the fields such reports and their cards carry, so the field names live in
 * one place. Pure functions, no DOM.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AsOfCards = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var AS_OF = 'as_of';

  function isDigits(text) {
    if (!text) return false;
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      if (ch < '0' || ch > '9') return false;
    }
    return true;
  }

  // A real YYYY-MM-DD day.
  function isPlainDay(value) {
    var text = typeof value === 'string' ? value : '';
    var parts = text.split('-');
    if (text.length !== 10 || parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) return false;
    if (!parts.every(isDigits)) return false;
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    return date.getUTCFullYear() === Number(parts[0]) && date.getUTCMonth() === Number(parts[1]) - 1 && date.getUTCDate() === Number(parts[2]);
  }

  /** True when the dashboard reads "as of" one day (layout or dashboard period_mode). */
  function isAsOf(dashboard) {
    if (!dashboard || typeof dashboard !== 'object') return false;
    var layout = dashboard.layout && typeof dashboard.layout === 'object' ? dashboard.layout : {};
    return (layout.period_mode || dashboard.period_mode) === AS_OF;
  }

  /** The as-of day: the linked day when it is a real day, else today. */
  function asOfDay(linked, today) {
    return isPlainDay(linked) ? linked : today;
  }

  /** The card request's dates: the end day only. */
  function cardPeriod(day) {
    return { periodEnd: day };
  }

  function dayWords(day) {
    if (!isPlainDay(day)) return '';
    return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }

  /** "As of Nov 27, 2026". */
  function headerLabel(day) {
    var words = dayWords(day);
    return words ? 'As of ' + words : 'As of today';
  }

  return {
    isAsOf: isAsOf,
    isPlainDay: isPlainDay,
    asOfDay: asOfDay,
    cardPeriod: cardPeriod,
    dayWords: dayWords,
    headerLabel: headerLabel,
  };
});
