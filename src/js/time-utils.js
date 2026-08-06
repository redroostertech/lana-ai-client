/* LanaTime - early-loaded canonical browser clock and time arithmetic. */
(function (global) {
  'use strict';

  var SYSTEM_TIME_ZONE = 'UTC';
  var MS_PER_SECOND = 1000;
  var MS_PER_MINUTE = 60 * MS_PER_SECOND;
  var MS_PER_HOUR = 60 * MS_PER_MINUTE;
  var MS_PER_DAY = 24 * MS_PER_HOUR;

  function nowDate() {
    return new Date();
  }

  function nowMs() {
    return nowDate().getTime();
  }

  function nowIso() {
    return nowDate().toISOString();
  }

  function addMilliseconds(value, milliseconds) {
    var date = value instanceof Date ? value : new Date(value);
    return new Date(date.getTime() + Number(milliseconds || 0));
  }

  function subtractMilliseconds(value, milliseconds) {
    return addMilliseconds(value, -Number(milliseconds || 0));
  }

  function addMinutes(value, minutes) {
    return addMilliseconds(value, Number(minutes || 0) * MS_PER_MINUTE);
  }

  function addHours(value, hours) {
    return addMilliseconds(value, Number(hours || 0) * MS_PER_HOUR);
  }

  function addDays(value, days) {
    return addMilliseconds(value, Number(days || 0) * MS_PER_DAY);
  }

  function startOfUtcDay(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function startOfUtcMonth(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  function addUtcMonths(value, months) {
    var date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    var targetMonthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(months || 0), 1));
    var targetMonthLastDay = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(date.getUTCDate(), targetMonthLastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    ));
  }

  function startOfLocalDay(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfLocalMonth(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfLocalMonth(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function startOfLocalYear(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(date.getFullYear(), 0, 1);
  }

  function endOfLocalYear(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(date.getFullYear(), 11, 31);
  }

  function formatUtcDateOnly(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().split('T')[0] : '';
  }

  function startOfLocalQuarter(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
  }

  function startOfUtcQuarter(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
  }

  function startOfUtcYear(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  }

  function endOfUtcYear(value) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    return new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
  }

  // Calendar-safe local-month arithmetic (local analog of addUtcMonths):
  // Jan 31 + 1 month clamps to the last day of February.
  function addLocalMonths(value, months) {
    var date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return new Date(NaN);
    var targetMonthStart = new Date(date.getFullYear(), date.getMonth() + Number(months || 0), 1);
    var targetMonthLastDay = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0).getDate();
    return new Date(
      targetMonthStart.getFullYear(),
      targetMonthStart.getMonth(),
      Math.min(date.getDate(), targetMonthLastDay),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds()
    );
  }

  // Local calendar day without separators ('YYYYMMDD') for filename stamps.
  function formatCompactLocalDate(value) {
    var day = toLocalDateInputValue(value);
    return day ? day.split('-').join('') : '';
  }

  // Calendar-aware parse: a date-only 'YYYY-MM-DD' string is a LOCAL
  // calendar day (new Date('YYYY-MM-DD') would parse it as UTC midnight,
  // shifting it to the previous evening west of UTC); anything else parses
  // as an instant. Returns an invalid Date for empty/invalid input.
  function toLocalCalendarDate(value) {
    if (value === null || value === undefined || value === '') return new Date(NaN);
    if (value instanceof Date) return value;
    var text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return new Date(
        Number(text.slice(0, 4)),
        Number(text.slice(5, 7)) - 1,
        Number(text.slice(8, 10))
      );
    }
    return new Date(text);
  }

  // Days from today (local calendar days) until the given value; negative
  // when the value is in the past. Date-only strings are treated as local
  // calendar days. Returns NaN for empty/invalid input (never the epoch).
  function daysUntil(value) {
    var target = toLocalCalendarDate(value);
    if (!Number.isFinite(target.getTime())) return NaN;
    return daysBetween(nowDate(), target);
  }

  // Canonical relative-time formatter. Second argument is either a
  // reference-now in ms (legacy) or an options object:
  //   { now: ms, style: 'compact' | 'words' | 'tiny', maxDays: N }
  // style 'compact' (default): 'Just now', 'Nm ago', 'Nh ago', 'Nd ago',
  //   'Nw ago', 'Nmo ago', 'Ny ago'
  // style 'words': 'Just now', 'N minutes ago', 'N hours ago', 'Yesterday',
  //   'N days ago', 'N weeks ago', 'N months ago', 'N years ago'
  // style 'tiny' (dense lists): 'now', 'Nm', 'Nh', 'Nd', 'Nw', 'Nmo', 'Ny'
  // maxDays: when set, values that many days old or older return '' so the
  //   caller can fall back to an absolute date format.
  // Returns '' for empty/invalid values. Future instants clamp to the
  // smallest tier.
  function timeAgo(value, options) {
    if (value === null || value === undefined || value === '' || value === 0) return '';
    var date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';

    var opts = typeof options === 'number' ? { now: options } : (options || {});
    var reference = opts.now === undefined ? nowMs() : Number(opts.now);
    var style = opts.style === 'words' || opts.style === 'tiny' ? opts.style : 'compact';

    function tier(n, unit, wordSingular, wordPlural) {
      if (style === 'tiny') return n + unit;
      if (style === 'words') return n + ' ' + (n === 1 ? wordSingular : wordPlural) + ' ago';
      return n + unit + ' ago';
    }

    var seconds = Math.floor((reference - date.getTime()) / MS_PER_SECOND);
    var minutes = Math.floor(seconds / 60);
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);

    if (opts.maxDays !== undefined && days >= opts.maxDays) return '';

    if (seconds < 60) return style === 'tiny' ? 'now' : 'Just now';
    if (minutes < 60) return tier(minutes, 'm', 'minute', 'minutes');
    if (hours < 24) return tier(hours, 'h', 'hour', 'hours');
    if (style === 'words' && days === 1) return 'Yesterday';
    if (days < 7) return tier(days, 'd', 'day', 'days');
    if (days < 30) return tier(Math.floor(days / 7), 'w', 'week', 'weeks');
    if (days < 365) return tier(Math.floor(days / 30), 'mo', 'month', 'months');
    return tier(Math.floor(days / 365), 'y', 'year', 'years');
  }

  // UTC day-window anchors for 'YYYY-MM-DD' picker values: the ISO instants
  // bracketing that UTC calendar day. The canonical form of the
  // "value + 'T00:00:00Z'" pattern used by reporting/insights/sync windows.
  function utcDayStart(dayValue) {
    if (!dayValue) return null;
    return toIsoInstant(String(dayValue) + 'T00:00:00.000Z');
  }

  function utcDayEnd(dayValue) {
    if (!dayValue) return null;
    return toIsoInstant(String(dayValue) + 'T23:59:59.999Z');
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // API contract converters: form inputs hold user-local wall time, the API
  // speaks ISO 8601 UTC instants. These are the only sanctioned bridges.

  // Any date-like value (datetime-local string, ISO string, Date) -> ISO UTC
  // instant for the API, or null when empty/invalid.
  function toIsoInstant(value) {
    if (value === null || value === undefined || value === '') return null;
    var date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  // API instant (or Date; defaults to now) -> the user-local calendar day in
  // the format a type="date" input expects ('YYYY-MM-DD'), or ''.
  function toLocalDateInputValue(value) {
    if (value === null || value === '') return '';
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  // API instant (or Date) -> user-local wall time in the format a
  // type="datetime-local" input expects ('YYYY-MM-DDTHH:mm'), or ''.
  function toLocalDatetimeInputValue(value) {
    if (value === null || value === '') return '';
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return toLocalDateInputValue(date) + 'T' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function millisecondsSince(startMs, endMs) {
    return Number(endMs === undefined ? nowMs() : endMs) - Number(startMs);
  }

  function millisecondsUntil(targetMs, fromMs) {
    return Number(targetMs) - Number(fromMs === undefined ? nowMs() : fromMs);
  }

  function daysBetween(start, end) {
    return Math.round(millisecondsSince(startOfLocalDay(start).getTime(), startOfLocalDay(end).getTime()) / MS_PER_DAY);
  }

  global.LanaTime = {
    SYSTEM_TIME_ZONE: SYSTEM_TIME_ZONE,
    MS_PER_SECOND: MS_PER_SECOND,
    MS_PER_MINUTE: MS_PER_MINUTE,
    MS_PER_HOUR: MS_PER_HOUR,
    MS_PER_DAY: MS_PER_DAY,
    nowDate: nowDate,
    nowMs: nowMs,
    nowIso: nowIso,
    addMilliseconds: addMilliseconds,
    subtractMilliseconds: subtractMilliseconds,
    addMinutes: addMinutes,
    addHours: addHours,
    addDays: addDays,
    startOfUtcDay: startOfUtcDay,
    startOfUtcMonth: startOfUtcMonth,
    addUtcMonths: addUtcMonths,
    startOfLocalDay: startOfLocalDay,
    startOfLocalMonth: startOfLocalMonth,
    endOfLocalMonth: endOfLocalMonth,
    startOfLocalYear: startOfLocalYear,
    endOfLocalYear: endOfLocalYear,
    formatUtcDateOnly: formatUtcDateOnly,
    startOfLocalQuarter: startOfLocalQuarter,
    startOfUtcQuarter: startOfUtcQuarter,
    startOfUtcYear: startOfUtcYear,
    endOfUtcYear: endOfUtcYear,
    addLocalMonths: addLocalMonths,
    formatCompactLocalDate: formatCompactLocalDate,
    toLocalCalendarDate: toLocalCalendarDate,
    daysUntil: daysUntil,
    timeAgo: timeAgo,
    utcDayStart: utcDayStart,
    utcDayEnd: utcDayEnd,
    toIsoInstant: toIsoInstant,
    toLocalDateInputValue: toLocalDateInputValue,
    toLocalDatetimeInputValue: toLocalDatetimeInputValue,
    millisecondsSince: millisecondsSince,
    millisecondsUntil: millisecondsUntil,
    daysBetween: daysBetween
  };
})(window);
