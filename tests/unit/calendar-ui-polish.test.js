'use strict';

/**
 * Calendar UI polish: the event location (drawer field and details row),
 * which events the details panel reads in full, the links it lists, and the
 * default time of a new event. Pure model code (calendar-event-form.model.js).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
new Function('window', fs.readFileSync(path.join(SRC, 'js/time-utils.js'), 'utf8'))(globalThis);
require('../../src/js/calendar/calendar-layout.js');
const F = require('../../src/js/calendar/calendar-event-form.model.js');

const NY = 'America/New_York';

describe('location field model', () => {
  test('a new event starts with no location', () => {
    expect(F.draftForNew({ day: '2026-11-18', minutes: 600, timeZone: NY }).location).toBe('');
  });

  test('an existing event fills the field from the detail', () => {
    const detail = { calendar_event_id: 'CAL-1', title: 'Signing', start_time: '2026-11-16T15:00:00.000Z',
      end_time: '2026-11-16T16:30:00.000Z', timezone: NY, location: 'Conference room A' };
    expect(F.draftFromEvent(detail, 'UTC').location).toBe('Conference room A');
    expect(F.draftFromEvent({ ...detail, location: null }, 'UTC').location).toBe('');
  });

  test('the payload sends the trimmed location, and an empty string to clear it', () => {
    const values = { title: 'X', start_date: '2026-11-18', start_time: '09:00', end_date: '2026-11-18', end_time: '10:00', time_zone: NY };
    expect(F.toPayload({ ...values, location: '  Room 4  ' }).body.location).toBe('Room 4');
    expect(F.toPayload({ ...values, location: '' }).body.location).toBe('');
    expect(F.toPayload(values).body.location).toBe('');
  });

  test('a repeating event still saves its location with the other details', () => {
    expect(F.toPayload({ title: 'Standup', location: 'Zoom' }, { keepTimes: true }).body).toEqual({
      title: 'Standup', visibility: 'public', description: '', location: 'Zoom'
    });
  });
});

describe('details panel', () => {
  test('only a LANA event the viewer can read is fetched in full', () => {
    expect(F.detailId({ id: 'CAL-2026-0001', busy: false })).toBe('CAL-2026-0001');
    expect(F.detailId({ id: 'busy-3', busy: true })).toBeNull();
    expect(F.detailId({ id: 'cd:ca300000-0000-4000-8000-000000000110', busy: false })).toBeNull();
    expect(F.detailId(null)).toBeNull();
  });

  test('location shows from the detail, never on a busy block', () => {
    expect(F.detailLocation({ busy: false }, { location: ' Conference room A ' })).toBe('Conference room A');
    expect(F.detailLocation({ busy: false }, { location: '' })).toBe('');
    expect(F.detailLocation({ busy: false }, null)).toBe('');
    expect(F.detailLocation({ busy: true }, { location: 'Doctor office' })).toBe('');
  });

  test('links: every readable link from the detail, matter, workspace and task', () => {
    const detail = { links: [
      { target_type: 'workspace', target_id: 'w1', label: 'Rivera signing workspace' },
      { target_type: 'matter', target_id: 'm1', label: 'Rivera Estate Plan' },
      { target_type: 'task', target_id: 't1', label: 'Prepare signing packet' }
    ] };
    const item = { busy: false, matter: { id: 'm1', name: 'Rivera Estate Plan' } };
    expect(F.detailLinks(item, detail)).toEqual([
      'Workspace: Rivera signing workspace', 'Matter: Rivera Estate Plan', 'Task: Prepare signing packet'
    ]);
    expect(F.detailLinks(item, { links: [] })).toEqual([]);
  });

  test('links: before or without a detail, the agenda matter; a busy block none', () => {
    expect(F.detailLinks({ busy: false, matter: { name: 'Harper Trust', matter_id: 'M-7' } }, null)).toEqual(['Matter: Harper Trust']);
    expect(F.detailLinks({ busy: false, matter: { matter_id: 'M-7' } }, null)).toEqual(['Matter: M-7']);
    expect(F.detailLinks({ busy: false, matter: null }, null)).toEqual([]);
    expect(F.detailLinks({ busy: true }, { links: [{ target_type: 'matter', label: 'Secret' }] })).toEqual([]);
  });
});

describe('new event default time', () => {
  // 2026-11-18 is a Wednesday; New York is UTC-5 in November. Work day 8 AM to 6 PM.
  const draft = (now, day) => F.draftForNew({ timeZone: NY, day, now: new Date(now) });
  const when = (d) => [d.start_date, d.start_time, d.end_date, d.end_time];

  test.each([
    ['during the work day: the next half hour', '2026-11-18T15:10:00Z', '2026-11-18', ['2026-11-18', '10:30', '2026-11-18', '11:30']],
    ['on a half hour: that half hour', '2026-11-18T15:00:00Z', '2026-11-18', ['2026-11-18', '10:00', '2026-11-18', '11:00']],
    ['before the work day: 9 to 10 AM today', '2026-11-18T11:30:00Z', '2026-11-18', ['2026-11-18', '09:00', '2026-11-18', '10:00']],
    ['after the work day: 9 AM the next work day', '2026-11-19T00:00:00Z', '2026-11-18', ['2026-11-19', '09:00', '2026-11-19', '10:00']],
    ['the next half hour would start at 6 PM: the next work day', '2026-11-18T22:45:00Z', '2026-11-18', ['2026-11-19', '09:00', '2026-11-19', '10:00']],
    ['Friday evening: Monday', '2026-11-21T01:00:00Z', '2026-11-20', ['2026-11-23', '09:00', '2026-11-23', '10:00']],
    ['a Saturday: the next work day', '2026-11-21T16:00:00Z', '2026-11-21', ['2026-11-23', '09:00', '2026-11-23', '10:00']],
    ['another selected day: 9 to 10 AM on it', '2026-11-18T15:10:00Z', '2026-11-25', ['2026-11-25', '09:00', '2026-11-25', '10:00']],
    ['no selected day: today', '2026-11-18T15:10:00Z', undefined, ['2026-11-18', '10:30', '2026-11-18', '11:30']]
  ])('%s', (_label, now, day, expected) => {
    expect(when(draft(now, day))).toEqual(expected);
  });

  test('a clicked slot still uses that slot, even after hours', () => {
    const d = F.draftForNew({ timeZone: NY, day: '2026-11-18', minutes: 21 * 60, now: new Date('2026-11-19T01:00:00Z') });
    expect(when(d)).toEqual(['2026-11-18', '21:00', '2026-11-18', '22:00']);
  });
});

describe('new event on a clicked day (explicitDay)', () => {
  const draft = (now, day) => F.draftForNew({ timeZone: NY, day, explicitDay: true, minutes: null, now: new Date(now) });
  const when = (d) => [d.start_date, d.start_time, d.end_date, d.end_time];

  test.each([
    ['today after hours: stays today at 9 AM', '2026-11-19T00:00:00Z', '2026-11-18', ['2026-11-18', '09:00', '2026-11-18', '10:00']],
    ['a Saturday: stays on it at 9 AM', '2026-11-21T16:00:00Z', '2026-11-21', ['2026-11-21', '09:00', '2026-11-21', '10:00']],
    ['today inside the work day: the next half hour', '2026-11-18T15:10:00Z', '2026-11-18', ['2026-11-18', '10:30', '2026-11-18', '11:30']],
    ['today before the work day: 9 AM', '2026-11-18T11:30:00Z', '2026-11-18', ['2026-11-18', '09:00', '2026-11-18', '10:00']],
    ['another day: 9 AM on it', '2026-11-19T00:00:00Z', '2026-11-22', ['2026-11-22', '09:00', '2026-11-22', '10:00']]
  ])('%s', (_label, now, day, expected) => {
    expect(when(draft(now, day))).toEqual(expected);
  });

  test('the New button (no explicitDay) still moves after hours to the next work day', () => {
    const d = F.draftForNew({ timeZone: NY, day: '2026-11-18', now: new Date('2026-11-19T00:00:00Z') });
    expect(d.start_date).toBe('2026-11-19');
  });
});
