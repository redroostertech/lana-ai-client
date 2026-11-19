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

  /** The first day of the month holding `day`. */
  function monthStart(day) {
    return String(day || '').slice(0, 8) + '01';
  }

  /**
   * The days a view shows: one for 'day', Sunday to Saturday for 'week',
   * Monday to Friday for 'workweek', and for 'month' six whole weeks from
   * the Sunday on or before the first of the month (42 days, so every month
   * has the same grid).
   */
  function viewDays(view, day) {
    if (view === 'week') return daysFrom(weekStart(day), 7);
    if (view === 'workweek') return daysFrom(time().addPlainDays(weekStart(day), 1), 5);
    if (view === 'month') return daysFrom(weekStart(monthStart(day)), 42);
    return daysFrom(day, 1);
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
      cluster.forEach(function (seg) {
        seg.columns = columnEnds.length;
        // Use the width there is: widen into each column to the right that
        // nothing in the cluster occupies while this segment runs.
        var span = 1;
        for (var col = seg.column + 1; col < seg.columns; col += 1) {
          var taken = cluster.some(function (other) {
            return other !== seg && other.column === col && other.top < seg.bottom && seg.top < other.bottom;
          });
          if (taken) break;
          span += 1;
        }
        seg.span = span;
      });
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

  // The plain days a timed event covers in a zone: from the day it starts to
  // the day holding its last instant (an event ending at midnight does not
  // reach the next day).
  function timedDays(event, timeZone) {
    var T = time();
    var start = ms(event.start);
    var end = ms(event.end);
    if (!Number.isFinite(start)) return null;
    if (!Number.isFinite(end) || end < start) end = start;
    var first = T.dayInTimeZone(new Date(start), timeZone);
    var last = T.dayInTimeZone(new Date(end > start ? end - 1 : start), timeZone);
    return { startDay: first, endDay: T.addPlainDays(last, 1) };
  }

  /**
   * Month grid: the 42 days in weeks of seven, each day with the events that
   * touch it (all-day first, then by start), as many as fit shown and the
   * rest counted in `more`. A multi-day event is listed on every day it
   * covers, marked continuesBefore / continuesAfter.
   *
   * @param {{ days: string[], month: string, timeZone: string, events: Array<Object>, capacity?: number }} input
   *   month is any day of the month shown ('YYYY-MM-DD'); days outside it are
   *   marked outside. capacity is how many event rows fit in a cell with no
   *   "more" line (monthCapacity measures it); a day with more events shows
   *   one row fewer and the "more" line, so "1 more" never sits beside room
   *   for that one event.
   * @returns {{ weeks: Array<Array<{ day, outside, items: Array<{ event, continuesBefore, continuesAfter }>, more }>> }}
   */
  function monthLayout(input) {
    var days = (input && input.days) || [];
    var timeZone = (input && input.timeZone) || time().SYSTEM_TIME_ZONE;
    var monthKey = String((input && input.month) || days[Math.min(days.length - 1, 7)] || '').slice(0, 7);
    var capacity = input && Number.isFinite(input.capacity) ? Math.max(1, Math.floor(input.capacity)) : 4;
    var spans = ((input && input.events) || []).map(function (event) {
      var span = event.is_all_day ? allDaySpan(event, timeZone) : timedDays(event, timeZone);
      return span ? { event: event, startDay: span.startDay, endDay: span.endDay, startMs: ms(event.start) } : null;
    }).filter(Boolean).sort(function (a, b) {
      var allDayFirst = (b.event.is_all_day ? 1 : 0) - (a.event.is_all_day ? 1 : 0);
      return allDayFirst || a.startMs - b.startMs || String(a.event.id || '').localeCompare(String(b.event.id || ''));
    });
    var cells = days.map(function (day) {
      var touching = spans.filter(function (span) { return span.startDay <= day && span.endDay > day; });
      var shown = touching.length <= capacity ? touching.length : Math.max(0, capacity - 1);
      return {
        day: day,
        outside: day.slice(0, 7) !== monthKey,
        items: touching.slice(0, shown).map(function (span) {
          return { event: span.event, continuesBefore: span.startDay < day, continuesAfter: time().addPlainDays(day, 1) < span.endDay };
        }),
        more: touching.length - shown
      };
    });
    var weeks = [];
    for (var i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks: weeks };
  }

  /**
   * How many event rows fit in a month cell with no "more" line: the cell's
   * height less its date, over one row's height (at least 1).
   */
  function monthCapacity(cellHeight, dateHeight, rowHeight) {
    if (!(cellHeight > 0) || !(rowHeight > 0)) return 4;
    return Math.max(1, Math.floor((cellHeight - (dateHeight || 0)) / rowHeight));
  }

  // The work day starts at 8 AM until the firm can set its own hours.
  var WORKDAY_START_MINUTES = 8 * 60;
  var WORKDAY_END_MINUTES = 18 * 60;

  /**
   * Where a day or week grid opens, in wall minutes: about an hour before
   * now when today is shown and now is inside the work day, else the start
   * of the work day.
   */
  function initialScrollMinutes(days, timeZone, now) {
    var wall = time().wallClockInTimeZone(now === undefined ? time().nowDate() : now, timeZone);
    if (wall && (days || []).indexOf(wall.day) !== -1 && wall.minutes >= WORKDAY_START_MINUTES && wall.minutes < WORKDAY_END_MINUTES) {
      return Math.max(0, Math.floor((wall.minutes - 60) / 30) * 30);
    }
    return WORKDAY_START_MINUTES;
  }

  /** Minutes snapped to the nearest `step` (15 by default). */
  function snapMinutes(minutes, step) {
    var size = step || 15;
    return Math.round(Number(minutes) / size) * size;
  }

  // A wall reading with minutes outside one day carried into the next or
  // previous day.
  function carryWall(day, minutes) {
    var T = time();
    var d = day;
    var m = minutes;
    while (m >= MINUTES_PER_DAY) { m -= MINUTES_PER_DAY; d = T.addPlainDays(d, 1); }
    while (m < 0) { m += MINUTES_PER_DAY; d = T.addPlainDays(d, -1); }
    return { day: d, minutes: m };
  }

  /**
   * Where a timed event lands after a drag, on the wall clock of the zone
   * the grid shows. 'move' shifts its start by dayDelta days and
   * minuteDelta minutes and keeps its real length; 'resize' moves only its
   * end, never closer than MIN_MINUTES to the start. A day the clocks change
   * keeps the wall time (a 9 AM meeting moved across the change is still at
   * 9 AM).
   *
   * @returns {{ start: string, end: string }|null} ISO instants, or null for an unusable event
   */
  function dragResult(event, change, timeZone) {
    var T = time();
    var start = ms(event && event.start);
    var end = ms(event && event.end);
    if (!Number.isFinite(start)) return null;
    if (!Number.isFinite(end) || end < start) end = start;
    var c = change || {};
    var dayDelta = Math.round(Number(c.dayDelta) || 0);
    var minuteDelta = snapMinutes(Number(c.minuteDelta) || 0);
    if (c.mode === 'resize') {
      var endWall = T.wallClockInTimeZone(new Date(end), timeZone);
      var moved = carryWall(endWall.day, endWall.minutes + minuteDelta);
      var newEnd = T.instantFromWallClock(moved.day, moved.minutes, timeZone).getTime();
      newEnd = Math.max(newEnd, start + MIN_MINUTES * T.MS_PER_MINUTE);
      return { start: new Date(start).toISOString(), end: new Date(newEnd).toISOString() };
    }
    var startWall = T.wallClockInTimeZone(new Date(start), timeZone);
    var to = carryWall(T.addPlainDays(startWall.day, dayDelta), startWall.minutes + minuteDelta);
    var newStart = T.instantFromWallClock(to.day, to.minutes, timeZone).getTime();
    return { start: new Date(newStart).toISOString(), end: new Date(newStart + (end - start)).toISOString() };
  }

  /** Wall minutes for a pointer at `offsetY` in a column `height` pixels tall, snapped. */
  function minutesAtOffset(offsetY, height, step) {
    if (!(height > 0)) return 0;
    var raw = Math.max(0, Math.min(MINUTES_PER_DAY, (offsetY / height) * MINUTES_PER_DAY));
    return Math.min(MINUTES_PER_DAY - (step || 15), snapMinutes(raw, step));
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
    monthStart: monthStart,
    monthLayout: monthLayout,
    monthCapacity: monthCapacity,
    initialScrollMinutes: initialScrollMinutes,
    WORKDAY_START_MINUTES: WORKDAY_START_MINUTES,
    snapMinutes: snapMinutes,
    dragResult: dragResult,
    minutesAtOffset: minutesAtOffset,
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
