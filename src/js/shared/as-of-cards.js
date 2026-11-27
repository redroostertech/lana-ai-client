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

  // ── Monthly bars (metadata.by_month) ─────────────────────────────
  var OLDER = 'older';
  var MONTH_BAR_LIMIT = 13;
  // The record field a bar filters the records by (raw_filter[month]).
  var MONTH_FIELD = 'month';
  var MONTH_SUBTITLES = {
    created: 'By month created',
    last_touch: 'By month of last contact',
    latest_client_message: "By month of the client's latest message",
    opened: 'By month the matter opened',
    detected: 'By month found',
    next_billing: 'By next billing month',
    due: 'By month due',
  };

  function metaOf(card) {
    return card && card.metadata && typeof card.metadata === 'object' ? card.metadata : {};
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  /**
   * The card's months: [{ month, label, count, value, format }], "Older"
   * first, then oldest to newest, at most 13 (Older plus the newest 12).
   * null when there are none.
   */
  function byMonth(card) {
    var list = metaOf(card).by_month;
    if (!Array.isArray(list)) return null;
    var items = list.filter(function (item) { return item && typeof item === 'object' && item.month; }).map(function (item) {
      var month = String(item.month);
      return { month: month, label: item.label ? String(item.label) : month, count: numberOrNull(item.count), value: numberOrNull(item.value),
        format: item.format ? String(item.format) : '' };
    });
    if (!items.length) return null;
    var older = items.filter(function (item) { return item.month === OLDER; });
    var months = items.filter(function (item) { return item.month !== OLDER; }).sort(function (a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
    var room = MONTH_BAR_LIMIT - older.slice(0, 1).length;
    return older.slice(0, 1).concat(months.slice(Math.max(0, months.length - room)));
  }

  /** A card that draws month bars: visual month_bars, or by_month with no visual. */
  function isMonthCard(visual, card) {
    if (visual === 'month_bars') return true;
    return !visual && !!byMonth(card);
  }

  /** "By month created", from metadata.group_by_month_of; '' when unknown. */
  function monthSubtitle(card) {
    var of = metaOf(card).group_by_month_of;
    return of && Object.prototype.hasOwnProperty.call(MONTH_SUBTITLES, of) ? MONTH_SUBTITLES[of] : '';
  }

  function countWords(count, unit) {
    var word = unit ? String(unit) : 'records';
    if (count === 1 && word.length > 1 && word.charAt(word.length - 1) === 's') word = word.slice(0, -1);
    return Number(count).toLocaleString('en-US') + ' ' + word;
  }

  /** "Oct: 12 deals · $45,000" (formatValue formats the amount). */
  function monthTip(item, formatValue, unit) {
    var parts = [];
    if (item.count !== null && item.count !== undefined) parts.push(countWords(item.count, unit));
    if (item.value !== null && item.value !== undefined) parts.push(formatValue(item.value));
    return item.label + ': ' + parts.join(' \u00b7 ');
  }

  /** The word for the count (metadata.unit, for example "deals"). */
  function monthUnit(card) {
    var unit = metaOf(card).unit;
    return unit ? String(unit) : '';
  }

  return {
    MONTH_FIELD: MONTH_FIELD,
    byMonth: byMonth,
    isMonthCard: isMonthCard,
    monthSubtitle: monthSubtitle,
    monthTip: monthTip,
    monthUnit: monthUnit,
    isAsOf: isAsOf,
    isPlainDay: isPlainDay,
    asOfDay: asOfDay,
    cardPeriod: cardPeriod,
    dayWords: dayWords,
    headerLabel: headerLabel,
  };
});
