/**
 * Calendar layout: where each event sits on the day and week grid. Pure (no
 * DOM), so it is unit tested directly; lex-calendar-grid only draws what this
 * returns.
 *
 * Rules
 *   - Days are plain 'YYYY-MM-DD' values in one time zone (the agenda's
 *     time_zone, the viewer's own zone). Day boundaries are that zone's
 *     local midnights (LanaTime.startOfDayInTimeZone), so a day may be 23 or
 *     25 hours long when daylight saving time starts or ends.
 *   - Timed events are placed on the wall clock: top and bottom are minutes
 *     after local midnight (0 to 1440), so every column has the same 24 rows.
 *     On the day saving time ends, the repeated hour reads the same wall
 *     minutes twice; an event whose wall end falls before its wall start is
 *     drawn for its real length instead.
 *   - An event that crosses midnight is cut into one segment per day, marked
 *     continuesBefore / continuesAfter.
 *   - Events occupy [start, end): one ending as the next starts do not
 *     overlap. Overlapping segments share the column width: each cluster of
 *     segments that overlap (directly or through each other) is split into
 *     as many columns as it needs, and each segment takes the first free one.
 *     A very short event is drawn at least MIN_MINUTES tall and laid out at
 *     that height, so its label stays readable and nothing hides under it.
 *   - All-day events use start_date and end_date (end exclusive) when the
 *     agenda gives them, else the days their start and end fall on. They go
 *     in the all-day row as bars spanning the visible days they cover,
 *     packed into the fewest lanes.
 *
 * Times come from LanaTime (js/time-utils.js); nothing here keeps its own
 * clock or zone arithmetic.
 */
(function (global) {
  'use strict';

  var MINUTES_PER_DAY = 1440;
  var MIN_MINUTES = 15;

  function time() {
    var T = global.LanaTime;
    if (!T) throw new Error('LanaTime (js/time-utils.js) must load before calendar-layout.js');
    return T;
  }

  /** `count` plain days starting at `firstDay`. */
  function daysFrom(firstDay, count) {
    var days = [];
    for (var i = 0; i < count; i += 1) days.push(time().addPlainDays(firstDay, i));
    return days;
  }

  /** The Sunday that starts the week holding `day`. */
  function weekStart(day) {
    var dow = time().plainDayOfWeek(day);
    return Number.isFinite(dow) ? time().addPlainDays(day, -dow) : '';
  }

  /** The days a view shows: one for 'day', Sunday to Saturday for 'week'. */
  function viewDays(view, day) {
    return view === 'week' ? daysFrom(weekStart(day), 7) : daysFrom(day, 1);
  }

  /** The agenda window for these days in a zone: { from, to } ISO instants. */
  function windowFor(days, timeZone) {
    var T = time();
    var first = T.startOfDayInTimeZone(days[0], timeZone);
    var after = T.startOfDayInTimeZone(T.addPlainDays(days[days.length - 1], 1), timeZone);
    return { from: first.toISOString(), to: after.toISOString() };
  }

  /** Hours in a local day: 24, or 23 / 25 when the clocks change that day. */
  function dayLengthHours(day, timeZone) {
    var T = time();
    var start = T.startOfDayInTimeZone(day, timeZone).getTime();
    var next = T.startOfDayInTimeZone(T.addPlainDays(day, 1), timeZone).getTime();
    return Math.round((next - start) / T.MS_PER_HOUR);
  }

  function ms(value) {
    var t = new Date(value).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  // Inclusive first and exclusive last plain day an all-day event covers.
  function allDaySpan(event, timeZone) {
    var T = time();
    var startDay = event.start_date || T.dayInTimeZone(event.start, timeZone);
    var endDay = event.end_date || '';
    if (!endDay) {
      var endWall = event.end ? T.wallClockInTimeZone(event.end, timeZone) : null;
      endDay = endWall ? (endWall.minutes > 0 ? T.addPlainDays(endWall.day, 1) : endWall.day) : '';
    }
    if (!endDay || endDay <= startDay) endDay = T.addPlainDays(startDay, 1);
    return { startDay: startDay, endDay: endDay };
  }

  // The timed segment of an event on one day, or null when it does not fall there.
  function timedSegment(event, day, timeZone, dayStartMs, nextDayStartMs) {
    var T = time();
    var start = ms(event.start);
    var end = ms(event.end);
    if (!Number.isFinite(start)) return null;
    if (!Number.isFinite(end) || end < start) end = start;
    // [start, end) meets [dayStart, nextDayStart); a zero-length event is on
    // the day its instant falls in.
    var meets = end > start
      ? start < nextDayStartMs && end > dayStartMs
      : start >= dayStartMs && start < nextDayStartMs;
    if (!meets) return null;
    var continuesBefore = start < dayStartMs;
    var continuesAfter = end > nextDayStartMs;
    var top = continuesBefore ? 0 : T.wallClockInTimeZone(start, timeZone).minutes;
    var bottom;
    if (continuesAfter || end === nextDayStartMs) {
      bottom = MINUTES_PER_DAY;
    } else {
      bottom = T.wallClockInTimeZone(end, timeZone).minutes;
      var realMinutes = (end - Math.max(start, dayStartMs)) / T.MS_PER_MINUTE;
      if (bottom < top) bottom = Math.min(MINUTES_PER_DAY, top + realMinutes);
    }
    var drawnBottom = Math.min(MINUTES_PER_DAY, Math.max(bottom, top + MIN_MINUTES));
    var drawnTop = Math.min(top, drawnBottom - MIN_MINUTES);
    return {
      event: event,
      day: day,
      top: drawnTop,
      bottom: drawnBottom,
      startMinutes: top,
      endMinutes: bottom,
      continuesBefore: continuesBefore,
      continuesAfter: continuesAfter
    };
  }

  /**
   * Columns for overlapping segments of one day. Mutates each segment with
   * column (0-based) and columns (how many share its cluster).
   */
  function assignColumns(segments) {
    var sorted = segments.slice().sort(function (a, b) {
      return a.top - b.top || b.bottom - a.bottom || String(a.event.id || '').localeCompare(String(b.event.id || ''));
    });
    var cluster = [];
    var columnEnds = [];
    var clusterEnd = -1;
    function close() {
      cluster.forEach(function (seg) { seg.columns = columnEnds.length; });
      cluster = [];
      columnEnds = [];
    }
    sorted.forEach(function (seg) {
      if (cluster.length && seg.top >= clusterEnd) close();
      var column = -1;
      for (var i = 0; i < columnEnds.length; i += 1) {
        if (columnEnds[i] <= seg.top) { column = i; break; }
      }
      if (column === -1) { column = columnEnds.length; columnEnds.push(seg.bottom); } else { columnEnds[column] = seg.bottom; }
      seg.column = column;
      cluster.push(seg);
      clusterEnd = cluster.length === 1 ? seg.bottom : Math.max(clusterEnd, seg.bottom);
    });
    close();
    return sorted;
  }

  /**
   * Lay out events on visible days.
   *
   * @param {{ days: string[], timeZone: string, events: Array<Object> }} input
   *   events carry start, end (ISO), is_all_day, start_date, end_date and id
   * @returns {{ days: Array<{ day: string, hours: number, timed: Array<Object> }>,
   *   allDay: Array<{ event, firstColumn, span, lane, continuesBefore, continuesAfter }>,
   *   allDayLanes: number }}
   */
  function layout(input) {
    var T = time();
    var days = (input && input.days) || [];
    var timeZone = (input && input.timeZone) || T.SYSTEM_TIME_ZONE;
    var events = (input && input.events) || [];
    var bounds = days.map(function (day) {
      return {
        start: T.startOfDayInTimeZone(day, timeZone).getTime(),
        next: T.startOfDayInTimeZone(T.addPlainDays(day, 1), timeZone).getTime()
      };
    });

    var columns = days.map(function (day, index) {
      var timed = [];
      events.forEach(function (event) {
        if (event.is_all_day) return;
        var seg = timedSegment(event, day, timeZone, bounds[index].start, bounds[index].next);
        if (seg) timed.push(seg);
      });
      return {
        day: day,
        hours: Math.round((bounds[index].next - bounds[index].start) / T.MS_PER_HOUR),
        timed: assignColumns(timed)
      };
    });

    var bars = [];
    if (days.length) {
      var firstVisible = days[0];
      var afterVisible = T.addPlainDays(days[days.length - 1], 1);
      events.forEach(function (event) {
        if (!event.is_all_day) return;
        var span = allDaySpan(event, timeZone);
        if (span.endDay <= firstVisible || span.startDay >= afterVisible) return;
        var from = span.startDay < firstVisible ? firstVisible : span.startDay;
        var until = span.endDay > afterVisible ? afterVisible : span.endDay;
        var firstColumn = days.indexOf(from);
        var lastColumn = days.indexOf(T.addPlainDays(until, -1));
        if (firstColumn === -1 || lastColumn === -1) return;
        bars.push({
          event: event,
          firstColumn: firstColumn,
          span: lastColumn - firstColumn + 1,
          continuesBefore: span.startDay < firstVisible,
          continuesAfter: span.endDay > afterVisible
        });
      });
    }
    bars.sort(function (a, b) {
      return a.firstColumn - b.firstColumn || b.span - a.span || String(a.event.id || '').localeCompare(String(b.event.id || ''));
    });
    var laneEnds = [];
    bars.forEach(function (bar) {
      var lane = -1;
      for (var i = 0; i < laneEnds.length; i += 1) {
        if (laneEnds[i] <= bar.firstColumn) { lane = i; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = bar.firstColumn + bar.span;
      bar.lane = lane;
    });

    return { days: columns, allDay: bars, allDayLanes: laneEnds.length };
  }

  /**
   * Hour labels for the gutter: the wall hours 0 to 23 as the zone shows
   * them on that day (labels only; rows are always the 24 wall hours).
   */
  function hourLabels(formatHour) {
    var labels = [];
    for (var h = 0; h < 24; h += 1) labels.push({ hour: h, minutes: h * 60, label: formatHour ? formatHour(h) : String(h) });
    return labels;
  }

  /** Where the "now" line goes on a day, in wall minutes, or null when now is not that day. */
  function nowMinutes(day, timeZone, now) {
    var wall = time().wallClockInTimeZone(now === undefined ? time().nowDate() : now, timeZone);
    return wall && wall.day === day ? wall.minutes : null;
  }

  var api = {
    MINUTES_PER_DAY: MINUTES_PER_DAY,
    MIN_MINUTES: MIN_MINUTES,
    daysFrom: daysFrom,
    weekStart: weekStart,
    viewDays: viewDays,
    windowFor: windowFor,
    dayLengthHours: dayLengthHours,
    layout: layout,
    assignColumns: assignColumns,
    hourLabels: hourLabels,
    nowMinutes: nowMinutes
  };
  global.LanaCalendarLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
