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
  // Every month in order, up to 24 (cards with future months, such as next
  // billing, run past the end month).
  var MONTH_BAR_LIMIT = 24;
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
   * first, then oldest to newest, at most 24 (Older plus the newest).
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

  // Records with no grouping date (metadata.by_month_unplaced): a note under
  // the bars, so bars plus the note add up to the headline. It opens the
  // records with a blank month (the backend's "(empty)" filter).
  var UNPLACED_FILTER = '(empty)';

  function unplacedOf(card) {
    var u = metaOf(card).by_month_unplaced;
    if (!u || typeof u !== 'object') return null;
    var count = numberOrNull(u.count);
    if (!count) return null;
    return { label: u.label ? String(u.label) : 'No date recorded', count: count, value: numberOrNull(u.value) };
  }

  /** "3 with no date recorded ($4,500)"; '' when there are none. */
  function unplacedNote(card, formatValue) {
    var u = unplacedOf(card);
    if (!u) return '';
    var words = u.label.charAt(0).toLowerCase() + u.label.slice(1);
    return u.count.toLocaleString('en-US') + ' with ' + words + (u.value !== null ? ' (' + formatValue(u.value) + ')' : '');
  }

  /** The word for the count (metadata.unit, for example "deals"). */
  function monthUnit(card) {
    var unit = metaOf(card).unit;
    return unit ? String(unit) : '';
  }

  // ── Link cards (metadata { headline, target: { slug | dashboard_id } }) ──
  function targetOf(card) {
    var meta = metaOf(card);
    var link = meta.link && typeof meta.link === 'object' ? meta.link : null;
    var target = meta.target || (link && (link.target || link));
    return target && typeof target === 'object' ? { target: target, headline: meta.headline || (link && link.headline) || '' } : null;
  }

  /** { headline, slug, dashboardId } for a card that points at a report, else null. */
  function linkOf(card) {
    var found = targetOf(card);
    if (!found) return null;
    var slug = found.target.slug ? String(found.target.slug) : '';
    var dashboardId = found.target.dashboard_id ? String(found.target.dashboard_id) : '';
    if (!slug && !dashboardId) return null;
    return { headline: String(found.headline || ''), slug: slug, dashboardId: dashboardId };
  }

  /** A link card: visual link, or a target and no visual. */
  function isLinkCard(visual, card) {
    if (visual === 'link') return true;
    return !visual && !!linkOf(card);
  }

  /** The report's page, opened as of a day. */
  function targetHref(dashboardId, day) {
    return 'admin/dashboard-detail.html?id=' + encodeURIComponent(dashboardId) + (isPlainDay(day) ? '&asOf=' + day : '');
  }

  // ── The server's period label ───────────────────────────────────
  var DATE_WORDS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
    'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'to'];
  var TRIM_CHARS = ',.;:()';

  function trimWord(word) {
    var start = 0;
    var end = word.length;
    while (start < end && TRIM_CHARS.indexOf(word.charAt(start)) !== -1) start += 1;
    while (end > start && TRIM_CHARS.indexOf(word.charAt(end - 1)) !== -1) end -= 1;
    return word.slice(start, end);
  }

  // True when every word is a month, "to", a number or a dash.
  function isPlainRange(text) {
    return text.split(' ').every(function (raw) {
      var word = trimWord(raw).toLowerCase();
      if (!word || word === '-' || word === '\u2013') return true;
      if (DATE_WORDS.indexOf(word) !== -1) return true;
      return isDigits(word.split('-').join('').split('/').join(''));
    });
  }

  /**
   * The server's words for the card's dates ("Deals created Oct 29 - Nov 27,
   * 2026, still open on Nov 27, 2026"), from lineage.period_rule,
   * period_label or period, when they say more than a plain range; else ''.
   */
  function periodLabel(card) {
    if (!card || typeof card !== 'object') return '';
    var lineage = card.lineage && typeof card.lineage === 'object' ? card.lineage : {};
    var options = [lineage.period_rule, card.period_label, card.period];
    for (var i = 0; i < options.length; i += 1) {
      var text = typeof options[i] === 'string' ? options[i].trim() : '';
      if (text && !isPlainRange(text)) return text;
    }
    return '';
  }

  return {
    UNPLACED_FILTER: UNPLACED_FILTER,
    unplacedNote: unplacedNote,
    periodLabel: periodLabel,
    linkOf: linkOf,
    isLinkCard: isLinkCard,
    targetHref: targetHref,
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
