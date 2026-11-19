/**
 * Calendar work hours: where the firm's work hours fall on the day and week
 * grid. Pure (no DOM), unit tested directly.
 *
 * The hours come from GET /api/v1/firm-handbook/work-hours (the Firm
 * Handbook's published work hours this person may read, else the firm's
 * default, Monday to Friday 8 AM to 6 PM): wall times in the firm's zone,
 * one { start, end } or none per weekday. The grid is drawn in the viewer's
 * zone, which may differ, so each shown day gets the firm's hours as
 * instants (LanaTime.instantFromWallClock) read back on the viewer's wall
 * clock (LanaTime.wallClockInTimeZone), cut at that day's midnights.
 *
 * Times come from LanaTime (js/time-utils.js); nothing here keeps its own
 * clock or zone arithmetic.
 */
(function (global) {
  'use strict';

  var MINUTES_PER_DAY = 1440;

  function time() {
    var T = global.LanaTime;
    if (!T) throw new Error('LanaTime (js/time-utils.js) must load before calendar-work-hours.js');
    return T;
  }

  function minutesOf(hhmm) {
    var text = String(hhmm || '');
    if (text.length !== 5 || text.charAt(2) !== ':') return null;
    var hours = Number(text.substring(0, 2));
    var minutes = Number(text.substring(3));
    if (!isFinite(hours) || !isFinite(minutes)) return null;
    return hours * 60 + minutes;
  }

  /** The firm's hours by JS weekday (0 Sunday to 6 Saturday): { start, end } minutes, or null. */
  function hoursByWeekday(workHours) {
    var out = [null, null, null, null, null, null, null];
    var days = workHours && Array.isArray(workHours.days) ? workHours.days : [];
    days.forEach(function (d) {
      var start = minutesOf(d && d.start);
      var end = minutesOf(d && d.end);
      if (start === null || end === null || end <= start) return;
      var weekday = Number(d.iso_weekday) % 7;
      if (weekday >= 0 && weekday <= 6) out[weekday] = { start: start, end: end };
    });
    return out;
  }

  /** The weekdays the firm works (0 Sunday to 6 Saturday), or null when there are no hours. */
  function workWeekdays(workHours) {
    var days = [];
    hoursByWeekday(workHours).forEach(function (hours, weekday) { if (hours) days.push(weekday); });
    return days.length ? days : null;
  }

  /**
   * The work segments of each shown day on the viewer's wall clock:
   * [[{ top, bottom }], ...] in minutes after local midnight, aligned with
   * `days`; null when there are no hours (draw no shading).
   */
  function segmentsForDays(workHours, days, viewZone) {
    var T = time();
    var byWeekday = hoursByWeekday(workHours);
    if (!byWeekday.some(Boolean)) return null;
    var firmZone = (workHours && workHours.time_zone) || viewZone;
    return (days || []).map(function (day) {
      var segments = [];
      // A firm day before or after can reach this day when the zones differ.
      [-1, 0, 1].forEach(function (offset) {
        var firmDay = T.addPlainDays(day, offset);
        var hours = byWeekday[T.plainDayOfWeek(firmDay)];
        if (!hours) return;
        var start = T.wallClockInTimeZone(T.instantFromWallClock(firmDay, hours.start, firmZone), viewZone);
        var end = T.wallClockInTimeZone(T.instantFromWallClock(firmDay, hours.end, firmZone), viewZone);
        if (!start || !end) return;
        var top = start.day < day ? 0 : (start.day > day ? null : start.minutes);
        var bottom = end.day > day ? MINUTES_PER_DAY : (end.day < day ? null : end.minutes);
        if (top === null || bottom === null || bottom <= top) return;
        segments.push({ top: top, bottom: bottom });
      });
      return segments.sort(function (a, b) { return a.top - b.top; });
    });
  }

  /**
   * Where a day or week grid opens, in wall minutes: about an hour before
   * now when today is shown and now is inside its work hours, else the
   * earliest work start among the shown days; null when there is none (the
   * grid's own default).
   */
  function scrollMinutes(segments, days, viewZone, now) {
    if (!segments) return null;
    var T = time();
    var wall = T.wallClockInTimeZone(now === undefined ? T.nowDate() : now, viewZone);
    var index = wall ? (days || []).indexOf(wall.day) : -1;
    if (index !== -1 && segments[index].some(function (s) { return wall.minutes >= s.top && wall.minutes < s.bottom; })) {
      return Math.max(0, Math.floor((wall.minutes - 60) / 30) * 30);
    }
    var earliest = null;
    segments.forEach(function (list) {
      list.forEach(function (s) { if (earliest === null || s.top < earliest) earliest = s.top; });
    });
    return earliest;
  }

  var api = {
    hoursByWeekday: hoursByWeekday,
    workWeekdays: workWeekdays,
    segmentsForDays: segmentsForDays,
    scrollMinutes: scrollMinutes
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaCalendarWorkHours = api;
})(typeof window !== 'undefined' ? window : globalThis);
