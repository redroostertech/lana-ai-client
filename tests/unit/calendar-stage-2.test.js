'use strict';

/**
 * Calendar stage 2 pure modules: the wall clock to instant helper
 * (LanaTime.instantFromWallClock), the work-week and month views
 * (calendar-layout.js), drag to move or resize (dragResult), and the event
 * drawer model (calendar-event-form.model.js).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
new Function('window', fs.readFileSync(path.join(SRC, 'js/time-utils.js'), 'utf8'))(globalThis);
const T = globalThis.LanaTime;
const L = require('../../src/js/calendar/calendar-layout.js');
const F = require('../../src/js/calendar/calendar-event-form.model.js');

const NY = 'America/New_York';

describe('LanaTime.instantFromWallClock', () => {
  test.each([
    ['a normal day', '2026-07-15', 600, '2026-07-15T14:00:00.000Z'],
    ['before the spring change', '2026-03-08', 90, '2026-03-08T06:30:00.000Z'],
    ['inside the skipped hour lands after the jump', '2026-03-08', 150, '2026-03-08T07:30:00.000Z'],
    ['after the spring change', '2026-03-08', 180, '2026-03-08T07:00:00.000Z'],
    ['the repeated hour is its first reading', '2026-11-01', 90, '2026-11-01T05:30:00.000Z'],
    ['after the autumn change', '2026-11-01', 150, '2026-11-01T07:30:00.000Z']
  ])('%s', (_label, day, minutes, expected) => {
    expect(T.instantFromWallClock(day, minutes, NY).toISOString()).toBe(expected);
  });

  test('it reads back as the same wall clock (round trip)', () => {
    const instant = T.instantFromWallClock('2026-12-24', 13 * 60 + 45, 'Asia/Kolkata');
    expect(T.wallClockInTimeZone(instant, 'Asia/Kolkata')).toEqual({ day: '2026-12-24', minutes: 13 * 60 + 45 });
  });
});

describe('views', () => {
  test('work week is Monday to Friday of the week holding the day', () => {
    expect(L.viewDays('workweek', '2026-11-18')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
    // A Sunday belongs to the week it starts.
    expect(L.viewDays('workweek', '2026-11-15')[0]).toBe('2026-11-16');
  });

  test('month is six weeks from the Sunday on or before the first', () => {
    const days = L.viewDays('month', '2026-11-18');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-11-01'); // November 2026 starts on a Sunday
    expect(L.viewDays('month', '2026-12-31')[0]).toBe('2026-11-29');
  });
});

describe('monthLayout', () => {
  const days = L.viewDays('month', '2026-11-18');
  const ev = (id, start, end, extra = {}) => ({ id, start, end, is_all_day: false, ...extra });

  test('a multi-day event shows on every day it covers; one ending at midnight does not reach the next day', () => {
    const result = L.monthLayout({ days, month: '2026-11-18', timeZone: NY, events: [
      ev('trip', '2026-11-10T14:00:00Z', '2026-11-12T15:00:00Z'),
      ev('late', '2026-11-13T03:00:00Z', '2026-11-13T05:00:00Z') // 22:00 to midnight on the 12th in New York
    ] });
    const cell = (day) => result.weeks.flat().find((c) => c.day === day);
    expect(cell('2026-11-10').items.map((i) => i.event.id)).toEqual(['trip']);
    expect(cell('2026-11-11').items[0]).toMatchObject({ continuesBefore: true, continuesAfter: true });
    expect(cell('2026-11-12').items.map((i) => i.event.id)).toEqual(['trip', 'late']);
    expect(cell('2026-11-13').items).toEqual([]);
  });

  test('all-day first; past capacity one row gives way to the "more" line; days of other months are outside', () => {
    const result = L.monthLayout({ days, month: '2026-11-18', timeZone: NY, capacity: 2, events: [
      ev('b', '2026-11-18T15:00:00Z', '2026-11-18T16:00:00Z'),
      ev('a', '2026-11-18T14:00:00Z', '2026-11-18T15:00:00Z'),
      { id: 'holiday', is_all_day: true, start_date: '2026-11-18', end_date: '2026-11-19', start: '2026-11-18T05:00:00Z', end: '2026-11-19T05:00:00Z' }
    ] });
    const cell = result.weeks.flat().find((c) => c.day === '2026-11-18');
    // Two rows fit: three events show one and "2 more", never "1 more" beside an empty row.
    expect(cell.items.map((i) => i.event.id)).toEqual(['holiday']);
    expect(cell.more).toBe(2);
    expect(result.weeks).toHaveLength(6);
    expect(result.weeks[5][6]).toMatchObject({ day: '2026-12-12', outside: true });
  });
});

test('monthLayout: everything that fits is shown with no "more" line', () => {
  const days = L.viewDays('month', '2026-11-18');
  const events = ['a', 'b', 'c'].map((id, i) => ({ id, start: `2026-11-18T1${i}:00:00Z`, end: `2026-11-18T1${i}:30:00Z`, is_all_day: false }));
  const cell = L.monthLayout({ days, month: '2026-11-18', timeZone: 'UTC', capacity: 3, events }).weeks.flat().find((c) => c.day === '2026-11-18');
  expect([cell.items.length, cell.more]).toEqual([3, 0]);
});

test('monthCapacity: rows that fit under the date, at least one; unmeasured falls back to 4', () => {
  expect(L.monthCapacity(104, 20, 20)).toBe(4);
  expect(L.monthCapacity(150, 22, 21)).toBe(6);
  expect(L.monthCapacity(30, 22, 21)).toBe(1);
  expect(L.monthCapacity(0, 0, 0)).toBe(4);
});

test.each([
  ['today, inside the work day: about an hour before now, on the half hour', '2026-11-18T15:40:00Z', 9 * 60 + 30],
  ['today, before the work day: the work day start', '2026-11-18T11:00:00Z', 8 * 60],
  ['today, after the work day: the work day start', '2026-11-18T23:30:00Z', 8 * 60],
  ['another week: the work day start', '2026-12-02T15:40:00Z', 8 * 60]
])('initialScrollMinutes: %s', (_label, now, expected) => {
  expect(L.initialScrollMinutes(L.viewDays('week', '2026-11-18'), NY, new Date(now))).toBe(expected);
});

describe('dragResult', () => {
  const meeting = { start: '2026-11-18T14:00:00.000Z', end: '2026-11-18T15:00:00.000Z' }; // 9 to 10 AM New York

  test('move: by days and snapped minutes, keeping the length', () => {
    expect(L.dragResult(meeting, { mode: 'move', dayDelta: 1, minuteDelta: 37 }, NY))
      .toEqual({ start: '2026-11-19T14:30:00.000Z', end: '2026-11-19T15:30:00.000Z' });
  });

  test('move across the autumn clock change keeps the wall time', () => {
    const friday = { start: '2026-10-30T13:00:00.000Z', end: '2026-10-30T14:00:00.000Z' }; // 9 AM EDT
    expect(L.dragResult(friday, { mode: 'move', dayDelta: 3 }, NY)) // Monday, 9 AM EST
      .toEqual({ start: '2026-11-02T14:00:00.000Z', end: '2026-11-02T15:00:00.000Z' });
  });

  test('move past midnight carries into the next day', () => {
    expect(L.dragResult(meeting, { mode: 'move', minuteDelta: 15 * 60 }, NY).start).toBe('2026-11-19T05:00:00.000Z');
  });

  test('resize moves only the end and never closer than 15 minutes to the start', () => {
    expect(L.dragResult(meeting, { mode: 'resize', minuteDelta: 30 }, NY))
      .toEqual({ start: meeting.start, end: '2026-11-18T15:30:00.000Z' });
    expect(L.dragResult(meeting, { mode: 'resize', minuteDelta: -120 }, NY).end).toBe('2026-11-18T14:15:00.000Z');
  });

  test('pointer offset to snapped wall minutes', () => {
    expect(L.minutesAtOffset(240, 960)).toBe(360);
    expect(L.minutesAtOffset(247, 960)).toBe(375);
    expect(L.minutesAtOffset(5000, 960)).toBe(1425);
    expect(L.minutesAtOffset(10, 0)).toBe(0);
  });
});

describe('event drawer model', () => {
  test('a new event at a clicked slot is one hour in the viewer zone', () => {
    expect(F.draftForNew({ day: '2026-11-18', minutes: 9 * 60 + 30, timeZone: NY })).toMatchObject({
      id: null, start_date: '2026-11-18', start_time: '09:30', end_date: '2026-11-18', end_time: '10:30', time_zone: NY, visibility: 'public'
    });
  });

  test('payload: wall times in the event zone become instants', () => {
    const { body } = F.toPayload({ title: ' Consult ', start_date: '2026-11-18', start_time: '09:00', end_date: '2026-11-18', end_time: '10:15', time_zone: NY });
    expect(body).toEqual({ title: 'Consult', is_all_day: false, timezone: NY, start_time: '2026-11-18T14:00:00.000Z',
      end_time: '2026-11-18T15:15:00.000Z', visibility: 'public', description: '', location: '' });
  });

  test('payload: an all-day event runs midnight to the midnight after its last day', () => {
    const { body } = F.toPayload({ title: 'Trial', is_all_day: true, start_date: '2026-11-01', end_date: '2026-11-02', time_zone: NY });
    expect([body.start_time, body.end_time]).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-03T05:00:00.000Z']);
  });

  test.each([
    ['no title', { title: '  ' }, 'title'],
    ['end before start', { end_time: '08:00' }, 'end_time'],
    ['end equal to start', { end_time: '09:00' }, 'end_time'],
    ['a bad time', { start_time: '9am' }, 'start_time']
  ])('payload refuses %s', (_label, change, field) => {
    const values = { title: 'X', start_date: '2026-11-18', start_time: '09:00', end_date: '2026-11-18', end_time: '10:00', time_zone: NY, ...change };
    expect(F.toPayload(values).errors.map((e) => e.name)).toContain(field);
  });

  test('an existing event round-trips through the form unchanged', () => {
    const detail = { calendar_event_id: 'CAL-1', title: 'Hearing', start_time: '2026-03-09T13:00:00.000Z', end_time: '2026-03-09T14:30:00.000Z',
      timezone: NY, visibility: 'private', description: 'Bring file', attendees: [{ id: 'a1', user_id: 'u2' }, { id: 'a2', contact_id: 'c1' }] };
    const draft = F.draftFromEvent(detail, 'UTC');
    expect(draft).toMatchObject({ start_time: '09:00', end_time: '10:30', attendees: ['u2'], visibility: 'private' });
    expect(F.toPayload(draft).body).toMatchObject({ start_time: detail.start_time, end_time: detail.end_time });
    const allDay = F.draftFromEvent({ title: 'Off', is_all_day: true, timezone: NY, start_time: '2026-11-01T04:00:00.000Z', end_time: '2026-11-03T05:00:00.000Z' });
    expect([allDay.start_date, allDay.end_date]).toEqual(['2026-11-01', '2026-11-02']);
  });

  test('attendee changes: add the new, remove the dropped, never the owner', () => {
    const current = [{ id: 'row-b', user_id: 'b' }, { id: 'row-c', user_id: 'c' }, { id: 'row-x', contact_id: 'x' }];
    expect(F.attendeeChanges(['a', 'b', 'me'], current, 'me')).toEqual({ add: [{ user_id: 'a' }], remove: ['row-c'] });
  });

  test('conflict lines: a block the viewer may not read says busy, never a title', () => {
    const lines = F.conflictLines([
      { user_id: 'me', title: 'Hearing', private: false, start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z' },
      { user_id: 'u2', name: 'Ben', title: null, private: true, start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z' },
      // A private block never shows a title, even if one arrived.
      { user_id: 'u3', name: 'Cy', title: 'Secret', private: true, start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z' }
    ], 'me', NY);
    expect(lines[2]).toBe('Cy: busy, Wed, Nov 18, 9:00 AM to 10:00 AM');
    expect(lines[0]).toBe('You: Hearing, Wed, Nov 18, 9:00 AM to 10:00 AM');
    expect(lines[1]).toBe('Ben: busy, Wed, Nov 18, 9:00 AM to 10:00 AM');
  });

  test('isConflict reads the 409 CALENDAR_CONFLICT error only', () => {
    expect(F.isConflict({ status: 409, code: 'CALENDAR_CONFLICT' })).toBe(true);
    expect(F.isConflict({ status: 409, code: 'CONFLICT' })).toBe(false);
    expect(F.isConflict({ status: 400, code: 'CALENDAR_CONFLICT' })).toBe(false);
  });

  test('link options split matters from workspaces and keep only uuid ids', () => {
    const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
    const options = F.linkOptions(
      [{ id: id(1), name: 'Smith', matter_type: 'matter' }, { id: id(2), name: 'Ops', matter_type: 'workspace' }, { id: 'MAT-3', name: 'Code only' }],
      [{ id: id(3), title: 'Sign will' }]
    );
    expect(options.matter.map((o) => o.label)).toEqual(['Smith']);
    expect(options.workspace.map((o) => o.label)).toEqual(['Ops']);
    expect(options.task.map((o) => o.label)).toEqual(['Sign will']);
  });
});

describe('review: week view text and widths', () => {
  const ev = (id, start, end) => ({ id, start, end, is_all_day: false });
  test('an event widens into columns to its right that nothing overlaps while it runs', () => {
    // a 9-12 spans the day; b 9-10 and c 10-11 share the second column; d 11-12 takes it after.
    const result = L.layout({ days: ['2026-11-18'], timeZone: 'UTC', events: [
      ev('a', '2026-11-18T09:00:00Z', '2026-11-18T12:00:00Z'),
      ev('b', '2026-11-18T09:00:00Z', '2026-11-18T10:00:00Z'),
      ev('e', '2026-11-18T13:00:00Z', '2026-11-18T14:00:00Z'),
      ev('f', '2026-11-18T13:30:00Z', '2026-11-18T14:30:00Z'),
      ev('g', '2026-11-18T13:00:00Z', '2026-11-18T13:20:00Z')
    ] });
    const byId = Object.fromEntries(result.days[0].timed.map((seg) => [seg.event.id, seg]));
    expect([byId.a.columns, byId.a.span, byId.b.span]).toEqual([2, 1, 1]);
    // e and g start together (two columns), f overlaps e from 13:30 and takes g's column after it ends.
    expect(byId.e.columns).toBe(2);
    expect(byId.f.column).toBe(1);
    expect(byId.g.span).toBe(1);
  });

  test('alone in its cluster an event takes the whole width', () => {
    const [seg] = L.layout({ days: ['2026-11-18'], timeZone: 'UTC', events: [ev('x', '2026-11-18T09:00:00Z', '2026-11-18T10:00:00Z')] }).days[0].timed;
    expect([seg.columns, seg.span]).toEqual([1, 1]);
  });
});

