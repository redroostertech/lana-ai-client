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

  // A label for a range of whole UTC days ("Nov 10 - Nov 16, 2026"). Takes
  // plain YYYY-MM-DD days or instants and names their UTC day, so the label is
  // the same in every time zone. Reports and dashboards share it.
  function formatUtcDayRange(start, end) {
    function utcDay(value) {
      if (!value) return null;
      var text = String(value);
      var date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(text + 'T00:00:00Z') : new Date(text);
      return Number.isFinite(date.getTime()) ? date : null;
    }
    var from = utcDay(start);
    var to = utcDay(end);
    if (!from || !to) return '';
    var sameYear = from.getUTCFullYear() === to.getUTCFullYear();
    var day = { month: 'short', day: 'numeric', timeZone: 'UTC' };
    var dayYear = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
    return from.toLocaleDateString('en-US', sameYear ? day : dayYear) + ' - ' + to.toLocaleDateString('en-US', dayYear);
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

  // The calendar day of an instant in a time zone, as 'YYYY-MM-DD', or ''.
  function dayInTimeZone(value, timeZone) {
    var date = value === undefined ? nowDate() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone || SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).forEach(function (part) { parts[part.type] = part.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  // Plain-day arithmetic: 'YYYY-MM-DD' parts as a UTC date, so no zone or
  // daylight saving change can move the day.
  function plainDay(year, monthIndex, day) {
    return formatUtcDateOnly(new Date(Date.UTC(year, monthIndex, day)));
  }

  // Plain-day arithmetic on a 'YYYY-MM-DD' value (no zone or daylight saving
  // change can move it): the day `days` later (earlier when negative), or ''.
  function addPlainDays(dayValue, days) {
    var text = String(dayValue || '');
    var y = Number(text.slice(0, 4));
    var m = Number(text.slice(5, 7)) - 1;
    var d = Number(text.slice(8, 10));
    if (text.length !== 10 || !Number.isFinite(y + m + d)) return '';
    return plainDay(y, m, d + Number(days || 0));
  }

  // True for a real calendar day written 'YYYY-MM-DD' (2026-02-31 is not).
  function isPlainDay(value) {
    var text = String(value == null ? '' : value);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && addPlainDays(text, 0) === text;
  }

  // Day of the week of a 'YYYY-MM-DD' value: 0 Sunday to 6 Saturday, or NaN.
  function plainDayOfWeek(dayValue) {
    var text = String(dayValue || '');
    var time = Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));
    return Number.isFinite(time) ? new Date(time).getUTCDay() : NaN;
  }

  // The wall clock of an instant in a time zone: { day: 'YYYY-MM-DD',
  // minutes: minutes since that day's local midnight on the wall clock }, or
  // null for an invalid instant. On a day saving time ends the repeated hour
  // reads the same wall minutes twice; on the day it starts the skipped hour
  // never appears.
  function wallClockInTimeZone(value, timeZone) {
    var date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || SYSTEM_TIME_ZONE, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).forEach(function (part) { parts[part.type] = part.value; });
    var hour = Number(parts.hour) % 24;
    return {
      day: parts.year + '-' + parts.month + '-' + parts.day,
      minutes: hour * 60 + Number(parts.minute) + Number(parts.second) / 60
    };
  }

  // Wall clock minus UTC, in milliseconds, for an instant in a time zone.
  function timeZoneOffsetMs(value, timeZone) {
    var date = value instanceof Date ? value : new Date(value);
    var wall = wallClockInTimeZone(date, timeZone);
    if (!wall) return NaN;
    var wallMs = Date.UTC(Number(wall.day.slice(0, 4)), Number(wall.day.slice(5, 7)) - 1, Number(wall.day.slice(8, 10)))
      + Math.round(wall.minutes * MS_PER_MINUTE);
    return wallMs - Math.floor(date.getTime() / 1000) * 1000;
  }

  // The first instant of a plain day in a time zone (its local midnight, or
  // the first instant that exists when a zone skips midnight), as a Date; an
  // invalid Date for a bad day.
  function startOfDayInTimeZone(dayValue, timeZone) {
    var text = String(dayValue || '');
    var guess = Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));
    if (!Number.isFinite(guess)) return new Date(NaN);
    var zone = timeZone || SYSTEM_TIME_ZONE;
    var first = guess - timeZoneOffsetMs(new Date(guess), zone);
    var second = guess - timeZoneOffsetMs(new Date(first), zone);
    var candidate = new Date(second);
    var wall = wallClockInTimeZone(candidate, zone);
    // Midnight did not exist (the clock jumped past it): the day starts at
    // the first instant whose wall day is this day.
    if (wall && wall.day < text) {
      // Search to the minute for the first instant on this day (gaps are at
      // most a few hours).
      var lo = second;
      var hi = second + 3 * MS_PER_HOUR;
      while (hi - lo > MS_PER_MINUTE) {
        var mid = lo + Math.max(1, Math.floor((hi - lo) / 2 / MS_PER_MINUTE)) * MS_PER_MINUTE;
        if (wallClockInTimeZone(new Date(mid), zone).day < text) lo = mid; else hi = mid;
      }
      return new Date(hi);
    }
    return candidate;
  }

  // The instant a wall clock reading names in a time zone: a plain day and
  // minutes after its local midnight on the wall clock (the inverse of
  // wallClockInTimeZone). A reading in the hour skipped when saving time
  // starts lands just after the jump; one in the hour repeated when it ends
  // is the first of the two. An invalid Date for a bad day.
  function instantFromWallClock(dayValue, minutes, timeZone) {
    var text = String(dayValue || '');
    var guess = Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)))
      + Math.round(Number(minutes) * MS_PER_MINUTE);
    if (!Number.isFinite(guess)) return new Date(NaN);
    var zone = timeZone || SYSTEM_TIME_ZONE;
    var early = guess - timeZoneOffsetMs(new Date(guess - 12 * MS_PER_HOUR), zone);
    var late = guess - timeZoneOffsetMs(new Date(guess + 12 * MS_PER_HOUR), zone);
    var first = Math.min(early, late);
    var second = Math.max(early, late);
    function reads(ms) {
      var wall = wallClockInTimeZone(new Date(ms), zone);
      return wall && wall.day === text && Math.abs(wall.minutes - Number(minutes)) < 1 / 60;
    }
    if (reads(first)) return new Date(first);
    if (reads(second)) return new Date(second);
    // In a skipped hour: the clock after the jump.
    return new Date(Math.max(early, late));
  }

  // Report period presets as plain days (inclusive end) in a time zone. Firm
  // reports pass the firm's zone (Lex.Utils.getFirmTimezone), so the days are
  // the firm's whatever zone the person is in; the backend bounds them in the
  // same zone.
  // "All time": the API takes plain days and reports reject an empty
  // periodStart, so All time starts on a fixed early day, before any firm's
  // records.
  var ALL_TIME_START = '2000-01-01';

  function reportPresetDays(preset, timeZone, now) {
    var today = dayInTimeZone(now === undefined ? nowDate() : now, timeZone);
    var y = Number(today.slice(0, 4));
    var m = Number(today.slice(5, 7)) - 1;
    var d = Number(today.slice(8, 10));
    // Weeks start on Monday, as the backend's weekly periods do.
    var monday = plainDay(y, m, d - ((plainDayOfWeek(today) + 6) % 7));
    switch (preset) {
      case 'today': return { start: today, end: today };
      case 'allTime': return { start: ALL_TIME_START, end: today };
      // Plain days only: the last 24 hours always fall in yesterday and today.
      case 'last24hours': return { start: plainDay(y, m, d - 1), end: today };
      case 'yesterday': return { start: plainDay(y, m, d - 1), end: plainDay(y, m, d - 1) };
      case 'todayAndYesterday': return { start: plainDay(y, m, d - 1), end: today };
      case 'thisWeek': return { start: monday, end: today };
      case 'lastWeek': return { start: addPlainDays(monday, -7), end: addPlainDays(monday, -1) };
      case 'last30days': return { start: plainDay(y, m, d - 29), end: today };
      case 'thisMonth': return { start: plainDay(y, m, 1), end: today };
      case 'lastMonth': return { start: plainDay(y, m - 1, 1), end: plainDay(y, m, 0) };
      case 'thisQuarter': return { start: plainDay(y, Math.floor(m / 3) * 3, 1), end: today };
      case 'thisYear': return { start: plainDay(y, 0, 1), end: today };
      case 'lastYear': return { start: plainDay(y - 1, 0, 1), end: plainDay(y - 1, 11, 31) };
      case 'last7days':
      default: return { start: plainDay(y, m, d - 6), end: today };
    }
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
    formatUtcDayRange: formatUtcDayRange,
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
    dayInTimeZone: dayInTimeZone,
    addPlainDays: addPlainDays,
    isPlainDay: isPlainDay,
    plainDayOfWeek: plainDayOfWeek,
    wallClockInTimeZone: wallClockInTimeZone,
    timeZoneOffsetMs: timeZoneOffsetMs,
    startOfDayInTimeZone: startOfDayInTimeZone,
    instantFromWallClock: instantFromWallClock,
    reportPresetDays: reportPresetDays,
    ALL_TIME_START: ALL_TIME_START,
    toIsoInstant: toIsoInstant,
    toLocalDateInputValue: toLocalDateInputValue,
    toLocalDatetimeInputValue: toLocalDatetimeInputValue,
    millisecondsSince: millisecondsSince,
    millisecondsUntil: millisecondsUntil,
    daysBetween: daysBetween
  };
})(window);
