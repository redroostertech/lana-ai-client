'use strict';

// Firm reports use the firm's time zone for period boundaries, so everyone in
// the firm gets the same numbers. The Reports and Dashboards pages pick preset
// days in the firm's zone (Lex.Utils.getFirmTimezone, from the profile's
// firm_timezone) and send them as plain days. Display-only times keep the
// person's zone (getOrganizationTimezone is unchanged).

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function load(storedUser) {
  const userJson = storedUser ? JSON.stringify(storedUser) : null;
  const win = { localStorage: { getItem: key => (key === 'user' ? userJson : null) }, Intl, Date };
  const doc = { createTextNode: text => ({ nodeType: 3, textContent: String(text) }) };
  new Function('window', fs.readFileSync(path.join(SRC, 'js/time-utils.js'), 'utf8'))(win);
  new Function('window', 'document', fs.readFileSync(path.join(SRC, 'js/lex/lex.utils.js'), 'utf8'))(win, doc);
  return win;
}

const user = { timezone: 'America/New_York', firm_timezone: 'America/Los_Angeles', organization_timezone: 'America/Chicago' };

describe('the firm zone for report periods', () => {
  test('report periods use the firm zone; display keeps the person\'s zone', () => {
    const win = load(user);
    expect(win.Lex.Utils.getFirmTimezone()).toBe('America/Los_Angeles');
    expect(win.Lex.Utils.getOrganizationTimezone()).toBe('America/New_York');
  });

  test.each([
    [{}, 'UTC'],
    [{ firm_timezone: 'Not/AZone', timezone: 'America/New_York' }, 'UTC'],
    [null, 'UTC']
  ])('with no usable firm zone (%j) report periods are UTC days, as the backend reads them', (stored, expected) => {
    expect(load(stored).Lex.Utils.getFirmTimezone()).toBe(expected);
  });
});

describe('preset days in a zone', () => {
  // 05:00Z on Nov 1 is still Oct 31 in Los Angeles, but Nov 1 in New York and UTC.
  const now = new Date('2026-11-01T05:00:00.000Z');

  test('the calendar day of an instant in a zone', () => {
    const { LanaTime } = load(user);
    expect(LanaTime.dayInTimeZone(now, 'America/Los_Angeles')).toBe('2026-10-31');
    expect(LanaTime.dayInTimeZone(now, 'America/New_York')).toBe('2026-11-01');
    expect(LanaTime.dayInTimeZone(now, 'UTC')).toBe('2026-11-01');
  });

  test.each([
    ['last7days', { start: '2026-10-25', end: '2026-10-31' }],
    ['last30days', { start: '2026-10-02', end: '2026-10-31' }],
    ['thisMonth', { start: '2026-10-01', end: '2026-10-31' }],
    ['lastMonth', { start: '2026-09-01', end: '2026-09-30' }],
    ['thisQuarter', { start: '2026-10-01', end: '2026-10-31' }],
    ['thisYear', { start: '2026-01-01', end: '2026-10-31' }],
    ['lastYear', { start: '2025-01-01', end: '2025-12-31' }],
    // Quick periods from the report side panel. Saturday, Oct 31 in Los
    // Angeles; weeks start on Monday, as the backend's weekly periods do.
    ['today', { start: '2026-10-31', end: '2026-10-31' }],
    ['yesterday', { start: '2026-10-30', end: '2026-10-30' }],
    ['todayAndYesterday', { start: '2026-10-30', end: '2026-10-31' }],
    ['thisWeek', { start: '2026-10-26', end: '2026-10-31' }],
    ['lastWeek', { start: '2026-10-19', end: '2026-10-25' }]
  ])('%s for a Los Angeles firm', (preset, expected) => {
    expect(load(user).LanaTime.reportPresetDays(preset, 'America/Los_Angeles', now)).toEqual(expected);
  });

  test('the same moment in New York is already November (the control)', () => {
    const { LanaTime } = load(user);
    expect(LanaTime.reportPresetDays('thisMonth', 'America/New_York', now)).toEqual({ start: '2026-11-01', end: '2026-11-01' });
    expect(LanaTime.reportPresetDays('lastMonth', 'America/New_York', now)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  test('on a Sunday this week still started on Monday', () => {
    const { LanaTime } = load(user);
    expect(LanaTime.reportPresetDays('thisWeek', 'America/New_York', now)).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(LanaTime.reportPresetDays('lastWeek', 'America/New_York', now)).toEqual({ start: '2026-10-19', end: '2026-10-25' });
  });

  test('last month from March 31 is all of February', () => {
    const { LanaTime } = load(user);
    expect(LanaTime.reportPresetDays('lastMonth', 'UTC', new Date('2026-03-31T12:00:00Z'))).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('plain days', () => {
  test('isPlainDay accepts only real calendar days', () => {
    const { LanaTime } = load(user);
    expect(LanaTime.isPlainDay('2026-02-28')).toBe(true);
    expect(LanaTime.isPlainDay('2028-02-29')).toBe(true);
    ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '2026-1-01', '', null, '2026-02-28T00:00:00Z']
      .forEach(value => expect([value, LanaTime.isPlainDay(value)]).toEqual([value, false]));
  });
});

