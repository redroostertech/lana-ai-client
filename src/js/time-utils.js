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
    toIsoInstant: toIsoInstant,
    toLocalDateInputValue: toLocalDateInputValue,
    toLocalDatetimeInputValue: toLocalDatetimeInputValue,
    millisecondsSince: millisecondsSince,
    millisecondsUntil: millisecondsUntil,
    daysBetween: daysBetween
  };
})(window);
