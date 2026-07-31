'use strict';

const path = require('path');
const fs = require('fs');

function loadLexUtils(storedUser) {
  const timeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/time-utils.js'),
    'utf8'
  );
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/lex/lex.utils.js'),
    'utf8'
  );
  const userJson = storedUser ? JSON.stringify(storedUser) : null;
  const fakeWindow = {
    localStorage: { getItem: (key) => key === 'user' ? userJson : null },
    Intl,
    Date
  };
  const fakeDocument = {
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    }
  };
  const timeSandbox = new Function('window', timeSrc);
  const lexSandbox = new Function('window', 'document', src);
  timeSandbox(fakeWindow);
  lexSandbox(fakeWindow, fakeDocument);
  return fakeWindow;
}

describe('Lex.Utils UTC API timestamp handling', () => {
  let win;

  beforeAll(() => {
    win = loadLexUtils();
  });

  test('normalizes timezone-less ISO timestamps as UTC', () => {
    expect(win.Lex.Utils.normalizeApiUtcTimestamp('2026-05-11T12:30:00')).toBe('2026-05-11T12:30:00Z');
    expect(win.Lex.Utils.normalizeApiUtcTimestamp('2026-05-11T12:30:00Z')).toBe('2026-05-11T12:30:00Z');
    expect(win.Lex.Utils.normalizeApiUtcTimestamp('2026-05-11T12:30:00-04:00')).toBe('2026-05-11T12:30:00-04:00');
  });

  test('parses timezone-less API timestamps to the same instant as explicit UTC', () => {
    const implicit = win.Lex.Utils.parseApiUtcDate('2026-05-11T12:30:00');
    const explicit = win.Lex.Utils.parseApiUtcDate('2026-05-11T12:30:00Z');
    expect(implicit.toISOString()).toBe('2026-05-11T12:30:00.000Z');
    expect(implicit.getTime()).toBe(explicit.getTime());
  });

  test('formats parsed UTC timestamps in the requested client timezone', () => {
    expect(win.Lex.Utils.formatDateTime('2026-05-11T12:30:00', { timeZone: 'America/New_York' }))
      .toBe('5/11/2026 8:30 AM');
    expect(win.Lex.Utils.formatTime('2026-05-11T12:30:00', { timeZone: 'America/Los_Angeles' }))
      .toBe('5:30 AM');
  });

  test('exposes common client time arithmetic', () => {
    const base = new Date('2026-03-08T06:59:00.000Z');
    expect(win.Lex.Utils.SYSTEM_TIME_ZONE).toBe('UTC');
    expect(win.Lex.Utils.addMilliseconds(base, win.Lex.Utils.MS_PER_MINUTE).toISOString())
      .toBe('2026-03-08T07:00:00.000Z');
    expect(win.Lex.Utils.subtractMilliseconds(base, win.Lex.Utils.MS_PER_MINUTE).toISOString())
      .toBe('2026-03-08T06:58:00.000Z');
    expect(win.Lex.Utils.addHours(base, 2).toISOString()).toBe('2026-03-08T08:59:00.000Z');
    expect(win.Lex.Utils.addDays(base, 1).toISOString()).toBe('2026-03-09T06:59:00.000Z');
    expect(win.Lex.Utils.millisecondsSince(1000, 2500)).toBe(1500);
    expect(win.Lex.Utils.millisecondsUntil(2500, 1000)).toBe(1500);
  });

  test('exposes UTC date boundary helpers', () => {
    const base = new Date('2026-07-31T23:30:00.000Z');
    expect(win.Lex.Utils.startOfUtcDay(base).toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(win.Lex.Utils.startOfUtcMonth(base).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(win.Lex.Utils.addUtcMonths(new Date('2026-01-31T12:00:00.000Z'), 1).toISOString())
      .toBe('2026-02-28T12:00:00.000Z');
    expect(win.Lex.Utils.formatUtcDateOnly(base)).toBe('2026-07-31');
  });

  test('exposes local-calendar helpers for UI date controls', () => {
    const base = new Date(2026, 6, 31, 23, 30, 15);
    expect(win.Lex.Utils.startOfLocalDay(base).getHours()).toBe(0);
    expect(win.Lex.Utils.startOfLocalMonth(base).getDate()).toBe(1);
    expect(win.Lex.Utils.endOfLocalMonth(base).getDate()).toBe(31);
    expect(win.Lex.Utils.startOfLocalYear(base).getMonth()).toBe(0);
    expect(win.Lex.Utils.endOfLocalYear(base).getMonth()).toBe(11);
    expect(win.Lex.Utils.daysBetween(new Date(2026, 6, 30, 12), new Date(2026, 6, 31, 1))).toBe(1);
  });

  test('prefers explicit user timezone over organization timezone for display', () => {
    const userWindow = loadLexUtils({
      timezone: 'America/Los_Angeles',
      organization_timezone: 'America/New_York',
      preferences: { regional: { timezone: 'America/Chicago' } }
    });

    expect(userWindow.Lex.Utils.getOrganizationTimezone()).toBe('America/Los_Angeles');
    expect(userWindow.Lex.Utils.formatTime('2026-05-11T12:30:00Z')).toBe('5:30 AM');
  });

  test('uses regional preference timezone when profile timezone is absent', () => {
    const userWindow = loadLexUtils({
      organization_timezone: 'America/New_York',
      preferences: { regional: { timezone: 'America/Chicago' } }
    });

    expect(userWindow.Lex.Utils.getOrganizationTimezone()).toBe('America/Chicago');
    expect(userWindow.Lex.Utils.formatTime('2026-05-11T12:30:00Z')).toBe('7:30 AM');
  });
});
