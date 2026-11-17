'use strict';

/**
 * Report and dashboard periods are whole UTC days. Their labels name those
 * days the same in every time zone: a Nov 10 start never reads "Nov 9" in
 * New York. Run with TZ=America/New_York and TZ=UTC.
 */

const path = require('path');
const fs = require('fs');

const src = fs.readFileSync(path.resolve(__dirname, '../../src/js/time-utils.js'), 'utf8');
const win = { Date };
new Function('window', src)(win);
const LanaTime = win.LanaTime;

describe('formatUtcDayRange', () => {
  test.each([
    [['2026-11-10', '2026-11-16'], 'Nov 10 - Nov 16, 2026'],
    [['2026-11-10T00:00:00.000Z', '2026-11-16T23:59:59.999Z'], 'Nov 10 - Nov 16, 2026'],
    [['2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z'], 'Oct 1 - Oct 31, 2026'],
    [['2025-12-29', '2026-01-04'], 'Dec 29, 2025 - Jan 4, 2026'],
  ])('%j', ([start, end], expected) => {
    expect(LanaTime.formatUtcDayRange(start, end)).toBe(expected);
  });

  test('a missing or bad day gives an empty label', () => {
    expect(LanaTime.formatUtcDayRange('', '2026-11-16')).toBe('');
    expect(LanaTime.formatUtcDayRange('nope', '2026-11-16')).toBe('');
  });
});

describe('pages label periods with the shared UTC-day helper', () => {
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../src/js/admin', rel), 'utf8');

  test('reporting labels current and prior periods from the result days', () => {
    // Rendered in report-metric-card.render.test.js (headerLabels).
    expect(read('report-metric-card.js')).toMatch(/LanaTime\.formatUtcDayRange\(period\.startDate \|\| period\.start, period\.endDate \|\| period\.end\)/);
    expect(read('reporting.js')).toContain('window.ReportMetricCard.headerLabels(data)');
  });

  test('dashboard period captions use the shared helper', () => {
    const source = read('dashboard-detail.js');
    const label = source.slice(source.indexOf('function formatPeriodLabel'), source.indexOf('function updateCompareByOptions'));
    expect(label).toMatch(/LanaTime\.formatUtcDayRange/);
    expect(label).not.toMatch(/toLocaleDateString/);
  });
});
