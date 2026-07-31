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
    millisecondsSince: millisecondsSince,
    millisecondsUntil: millisecondsUntil,
    daysBetween: daysBetween
  };
})(window);
