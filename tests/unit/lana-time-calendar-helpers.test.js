'use strict';

/**
 * LanaTime calendar helpers added during the app-wide date-utility sweep:
 * quarter/year boundaries, calendar-safe local month arithmetic, daysUntil,
 * the canonical timeAgo formatter, and the compact filename date.
 */

const path = require('path');
const fs = require('fs');

function loadLanaTime() {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/time-utils.js'),
    'utf8'
  );
  const fakeWindow = { Date };
  new Function('window', src)(fakeWindow);
  return fakeWindow.LanaTime;
}

const LanaTime = loadLanaTime();

describe('quarter and year boundaries', () => {
  test('startOfLocalQuarter snaps to the local quarter start', () => {
    expect(LanaTime.startOfLocalQuarter(new Date(2026, 7, 6)).getTime())
      .toBe(new Date(2026, 6, 1).getTime());
    expect(LanaTime.startOfLocalQuarter(new Date(2026, 0, 15)).getTime())
      .toBe(new Date(2026, 0, 1).getTime());
  });

  test('startOfUtcQuarter snaps to the UTC quarter start', () => {
    expect(LanaTime.startOfUtcQuarter(new Date(Date.UTC(2026, 10, 20))).getTime())
      .toBe(Date.UTC(2026, 9, 1));
  });

  test('startOfUtcYear and endOfUtcYear bracket the UTC year', () => {
    const v = new Date(Date.UTC(2026, 7, 6, 12));
    expect(LanaTime.startOfUtcYear(v).getTime()).toBe(Date.UTC(2026, 0, 1));
    expect(LanaTime.endOfUtcYear(v).getTime()).toBe(Date.UTC(2026, 11, 31));
  });

  test('invalid input yields an invalid Date, not a throw', () => {
    expect(Number.isNaN(LanaTime.startOfLocalQuarter('junk').getTime())).toBe(true);
  });
});

describe('addLocalMonths', () => {
  test('adds calendar months preserving time of day', () => {
    const result = LanaTime.addLocalMonths(new Date(2026, 2, 15, 9, 30), 2);
    expect(result.getTime()).toBe(new Date(2026, 4, 15, 9, 30).getTime());
  });

  test('clamps to the last day of shorter target months', () => {
    const result = LanaTime.addLocalMonths(new Date(2026, 0, 31), 1);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28); // 2026 is not a leap year
  });

  test('negative months subtract', () => {
    const result = LanaTime.addLocalMonths(new Date(2026, 0, 15), -1);
    expect(result.getTime()).toBe(new Date(2025, 11, 15).getTime());
  });
});

describe('daysUntil', () => {
  test('is positive for future days, negative for past days', () => {
    const tomorrow = LanaTime.addDays(LanaTime.nowDate(), 1);
    const lastWeek = LanaTime.addDays(LanaTime.nowDate(), -7);
    expect(LanaTime.daysUntil(tomorrow)).toBe(1);
    expect(LanaTime.daysUntil(lastWeek)).toBe(-7);
    expect(LanaTime.daysUntil(LanaTime.nowDate())).toBe(0);
  });
});

describe('timeAgo', () => {
  const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

  function ago(ms) {
    return new Date(NOW - ms);
  }

  test('tiers: just now, minutes, hours, days, weeks, months, years', () => {
    const M = LanaTime.MS_PER_MINUTE;
    const H = LanaTime.MS_PER_HOUR;
    const D = LanaTime.MS_PER_DAY;
    expect(LanaTime.timeAgo(ago(30 * 1000), NOW)).toBe('just now');
    expect(LanaTime.timeAgo(ago(5 * M), NOW)).toBe('5m ago');
    expect(LanaTime.timeAgo(ago(3 * H), NOW)).toBe('3h ago');
    expect(LanaTime.timeAgo(ago(2 * D), NOW)).toBe('2d ago');
    expect(LanaTime.timeAgo(ago(10 * D), NOW)).toBe('1w ago');
    expect(LanaTime.timeAgo(ago(60 * D), NOW)).toBe('2mo ago');
    expect(LanaTime.timeAgo(ago(400 * D), NOW)).toBe('1y ago');
  });

  test('future instants clamp to just now', () => {
    expect(LanaTime.timeAgo(new Date(NOW + 60000), NOW)).toBe('just now');
  });

  test('empty and invalid values return empty string', () => {
    expect(LanaTime.timeAgo('')).toBe('');
    expect(LanaTime.timeAgo(null)).toBe('');
    expect(LanaTime.timeAgo('junk')).toBe('');
  });
});

describe('formatCompactLocalDate', () => {
  test('renders the local day without separators', () => {
    const d = new Date(2026, 7, 6);
    expect(LanaTime.formatCompactLocalDate(d)).toBe('20260806');
  });

  test('empty and invalid values return empty string', () => {
    expect(LanaTime.formatCompactLocalDate(null)).toBe('');
    expect(LanaTime.formatCompactLocalDate('junk')).toBe('');
  });
});
