'use strict';

/**
 * Calendar grid layout (js/calendar/calendar-layout.js) and the zone day
 * helpers it uses from LanaTime (js/time-utils.js): day boundaries in the
 * viewer's zone, daylight saving days, events crossing midnight, overlap
 * columns and the all-day row.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
// time-utils.js is a browser script that registers window.LanaTime.
new Function('window', fs.readFileSync(path.join(SRC, 'js/time-utils.js'), 'utf8'))(globalThis);
const T = globalThis.LanaTime;
const L = require('../../src/js/calendar/calendar-layout.js');

const NY = 'America/New_York';
const ev = (id, start, end, extra = {}) => ({ id, start, end, is_all_day: false, ...extra });
const only = (result) => result.days[0].timed;

describe('LanaTime zone day helpers', () => {
  test.each([
    ['2026-03-08', NY, '2026-03-08T05:00:00.000Z', 23],
    ['2026-11-01', NY, '2026-11-01T04:00:00.000Z', 25],
    ['2026-07-15', NY, '2026-07-15T04:00:00.000Z', 24],
    ['2026-07-15', 'UTC', '2026-07-15T00:00:00.000Z', 24],
    ['2026-03-29', 'Europe/London', '2026-03-29T00:00:00.000Z', 23],
    ['2026-10-04', 'Australia/Sydney', '2026-10-03T14:00:00.000Z', 23]
  ])('%s in %s starts at %s and lasts %i hours', (day, zone, start, hours) => {
    expect(T.startOfDayInTimeZone(day, zone).toISOString()).toBe(start);
    expect(L.dayLengthHours(day, zone)).toBe(hours);
  });

  test('a zone that skips midnight starts the day at the first instant that exists', () => {
    // Santiago springs forward at 00:00 local on 2026-09-06: 00:00 becomes 01:00.
    const start = T.startOfDayInTimeZone('2026-09-06', 'America/Santiago');
    expect(T.wallClockInTimeZone(start, 'America/Santiago')).toEqual({ day: '2026-09-06', minutes: 60 });
    expect(T.wallClockInTimeZone(new Date(start.getTime() - 1000), 'America/Santiago').day).toBe('2026-09-05');
  });

  test('plain day arithmetic crosses months and years and ignores zones', () => {
    expect(T.addPlainDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(T.addPlainDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(T.addPlainDays('nope', 1)).toBe('');
    expect(T.plainDayOfWeek('2026-11-18')).toBe(3);
  });
});

describe('views and windows', () => {
  test('week view runs Sunday to Saturday; day view is one day', () => {
    expect(L.viewDays('week', '2026-11-18')).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    expect(L.viewDays('day', '2026-11-18')).toEqual(['2026-11-18']);
  });

  test('the agenda window is bounded by the zone local midnights, across a fall back week', () => {
    expect(L.windowFor(L.viewDays('week', '2026-11-01'), NY)).toEqual({
      from: '2026-11-01T04:00:00.000Z', to: '2026-11-08T05:00:00.000Z'
    });
  });
});

describe('timed events', () => {
  test('placed on the wall clock of the viewer zone, not UTC', () => {
    const seg = only(L.layout({ days: ['2026-11-18'], timeZone: NY, events: [ev('a', '2026-11-18T14:00:00Z', '2026-11-18T15:30:00Z')] }))[0];
    expect([seg.top, seg.bottom, seg.column, seg.columns]).toEqual([9 * 60, 10.5 * 60, 0, 1]);
  });

  test('the same instant lands on another day for a viewer in another zone', () => {
    const e = ev('a', '2026-11-19T02:00:00Z', '2026-11-19T03:00:00Z');
    expect(only(L.layout({ days: ['2026-11-18'], timeZone: NY, events: [e] })).map((s) => s.top)).toEqual([21 * 60]);
    expect(only(L.layout({ days: ['2026-11-18'], timeZone: 'UTC', events: [e] }))).toEqual([]);
  });

  test('an event crossing midnight is cut into two segments', () => {
    const result = L.layout({ days: ['2026-11-18', '2026-11-19'], timeZone: NY, events: [ev('late', '2026-11-19T03:00:00Z', '2026-11-19T07:00:00Z')] });
    const [first] = result.days[0].timed;
    const [second] = result.days[1].timed;
    expect([first.top, first.bottom, first.continuesBefore, first.continuesAfter]).toEqual([22 * 60, 1440, false, true]);
    expect([second.top, second.bottom, second.continuesBefore, second.continuesAfter]).toEqual([0, 2 * 60, true, false]);
  });

  test('an event ending exactly at midnight stays on its own day', () => {
    const result = L.layout({ days: ['2026-11-18', '2026-11-19'], timeZone: NY, events: [ev('x', '2026-11-19T04:00:00Z', '2026-11-19T05:00:00Z')] });
    expect(result.days[0].timed.map((s) => [s.top, s.bottom])).toEqual([[23 * 60, 1440]]);
    expect(result.days[1].timed).toEqual([]);
  });

  test('spring forward: 1:30 to 3:30 local is one real hour drawn over the skipped hour', () => {
    // 2026-03-08 01:30 EST = 06:30Z; 03:30 EDT = 07:30Z.
    const seg = only(L.layout({ days: ['2026-03-08'], timeZone: NY, events: [ev('s', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z')] }))[0];
    expect([seg.top, seg.bottom]).toEqual([90, 210]);
  });

  test('fall back: an event inside the repeated hour whose wall end reads earlier keeps its real length', () => {
    // 01:45 EDT (05:45Z) to 01:15 EST (06:15Z): 30 real minutes.
    const seg = only(L.layout({ days: ['2026-11-01'], timeZone: NY, events: [ev('f', '2026-11-01T05:45:00Z', '2026-11-01T06:15:00Z')] }))[0];
    expect([seg.top, seg.bottom]).toEqual([105, 135]);
  });

  test('fall back: the second 1 a.m. event sits on the same wall rows as the first', () => {
    const result = L.layout({ days: ['2026-11-01'], timeZone: NY, events: [
      ev('edt', '2026-11-01T05:00:00Z', '2026-11-01T05:30:00Z'),
      ev('est', '2026-11-01T06:00:00Z', '2026-11-01T06:30:00Z')
    ] });
    const byId = Object.fromEntries(only(result).map((s) => [s.event.id, s]));
    expect([byId.edt.top, byId.est.top]).toEqual([60, 60]);
    // Same wall rows, so they share the width instead of hiding each other.
    expect([byId.edt.columns, byId.est.columns]).toEqual([2, 2]);
  });

  test('outside the visible days nothing is placed', () => {
    expect(only(L.layout({ days: ['2026-11-18'], timeZone: NY, events: [ev('o', '2026-11-20T14:00:00Z', '2026-11-20T15:00:00Z')] }))).toEqual([]);
  });
});

describe('overlap columns', () => {
  const day = '2026-11-18';
  const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 18, h + 5, m)).toISOString(); // NY wall time, EST
  const run = (events) => Object.fromEntries(only(L.layout({ days: [day], timeZone: NY, events })).map((s) => [s.event.id, [s.column, s.columns]]));

  test('touching events do not overlap', () => {
    expect(run([ev('a', at(9), at(10)), ev('b', at(10), at(11))])).toEqual({ a: [0, 1], b: [0, 1] });
  });

  test('two overlapping events split the width', () => {
    expect(run([ev('a', at(9), at(10)), ev('b', at(9, 30), at(10, 30))])).toEqual({ a: [0, 2], b: [1, 2] });
  });

  test('a chain shares one cluster and reuses a freed column', () => {
    // a 9-11, b 9:30-10, c 10-10:30: c reuses b's column; all three share a 2-column cluster.
    expect(run([ev('a', at(9), at(11)), ev('b', at(9, 30), at(10)), ev('c', at(10), at(10, 30))]))
      .toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] });
  });

  test('three at once take three columns; a later separate event is full width', () => {
    expect(run([ev('a', at(9), at(10)), ev('b', at(9), at(10)), ev('c', at(9), at(10)), ev('d', at(13), at(14))]))
      .toEqual({ a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] });
  });

  test('a zero-length event is drawn at the minimum height and does not hide under a neighbour', () => {
    const segs = only(L.layout({ days: [day], timeZone: NY, events: [ev('z', at(9), at(9)), ev('n', at(9, 5), at(10))] }));
    const z = segs.find((s) => s.event.id === 'z');
    expect(z.bottom - z.top).toBe(L.MIN_MINUTES);
    expect(z.columns).toBe(2);
  });
});

describe('all-day row', () => {
  const week = L.viewDays('week', '2026-11-18'); // 2026-11-15 .. 2026-11-21

  test('uses the plain dates the agenda gives, whatever the viewer zone', () => {
    const result = L.layout({ days: week, timeZone: 'Pacific/Honolulu', events: [
      { id: 'h', is_all_day: true, start: '2026-11-18T00:00:00Z', end: '2026-11-19T00:00:00Z', start_date: '2026-11-18', end_date: '2026-11-19' }
    ] });
    expect(result.allDay.map((b) => [b.firstColumn, b.span, b.lane])).toEqual([[3, 1, 0]]);
    expect(result.days.every((d) => d.timed.length === 0)).toBe(true);
  });

  test('multi-day bars are clipped to the week and packed into the fewest lanes', () => {
    const result = L.layout({ days: week, timeZone: NY, events: [
      { id: 'trip', is_all_day: true, start_date: '2026-11-13', end_date: '2026-11-17' },
      { id: 'conf', is_all_day: true, start_date: '2026-11-16', end_date: '2026-11-19' },
      { id: 'late', is_all_day: true, start_date: '2026-11-20', end_date: '2026-11-25' },
      { id: 'gone', is_all_day: true, start_date: '2026-11-01', end_date: '2026-11-02' }
    ] });
    const byId = Object.fromEntries(result.allDay.map((b) => [b.event.id, [b.firstColumn, b.span, b.lane, b.continuesBefore, b.continuesAfter]]));
    expect(byId).toEqual({
      trip: [0, 2, 0, true, false],
      conf: [1, 3, 1, false, false],
      late: [5, 2, 0, false, true]
    });
    expect(result.allDayLanes).toBe(2);
  });

  test('without plain dates, the days come from start and end in the viewer zone', () => {
    const result = L.layout({ days: week, timeZone: NY, events: [
      { id: 'x', is_all_day: true, start: '2026-11-17T05:00:00Z', end: '2026-11-18T05:00:00Z' }
    ] });
    expect(result.allDay.map((b) => [b.firstColumn, b.span])).toEqual([[2, 1]]);
  });
});

describe('now line', () => {
  test('is placed on the wall clock only on today', () => {
    const now = new Date('2026-11-18T15:15:00Z');
    expect(L.nowMinutes('2026-11-18', NY, now)).toBe(10 * 60 + 15);
    expect(L.nowMinutes('2026-11-19', NY, now)).toBeNull();
  });
});
