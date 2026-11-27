'use strict';

/**
 * Dashboard quick picks, as Michael asked: exactly All time, Last 30 days,
 * Last 7 days and Last 24 hrs, in that order, counted in the firm's time
 * zone. All time sends a fixed early start day (the API takes plain days and
 * reports reject an empty periodStart), through today.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function loadTime() {
  const window = { Intl, Date };
  new Function('window', read('js/time-utils.js'))(window);
  return window.LanaTime;
}

test('the four quick picks, in order, with plain labels', () => {
  const html = read('admin/dashboard-detail.html');
  const box = html.slice(html.indexOf('id="dashboardPeriodPresets"'), html.indexOf('</div>', html.indexOf('id="dashboardPeriodPresets"')));
  const picks = box.split('data-dashboard-preset="').slice(1).map((part) => [part.split('"')[0], part.split('>')[1].split('<')[0]]);
  expect(picks).toEqual([['allTime', 'All time'], ['last30days', 'Last 30 days'], ['last7days', 'Last 7 days'], ['last24hours', 'Last 24 hrs']]);
});

test('All time runs from the fixed early day through today; Last 24 hrs is yesterday and today, in the firm zone', () => {
  const T = loadTime();
  const now = new Date('2026-11-27T03:30:00Z');
  expect(T.reportPresetDays('allTime', 'America/New_York', now)).toEqual({ start: T.ALL_TIME_START, end: '2026-11-26' });
  expect(T.ALL_TIME_START).toBe('2000-01-01');
  expect(T.reportPresetDays('last24hours', 'America/New_York', now)).toEqual({ start: '2026-11-25', end: '2026-11-26' });
  expect(T.reportPresetDays('last24hours', 'UTC', now)).toEqual({ start: '2026-11-26', end: '2026-11-27' });
});

test('the default stays Last 7 days', () => {
  expect(read('js/shared/dashboard-period.js')).toContain("var DEFAULT_PRESET = 'last7days';");
});

test('All time asks for no comparison (compareToPrevious=false); other picks still compare', () => {
  const P = require(path.join(SRC, 'js/shared/dashboard-period.js'));
  expect(P.isAllTime({ start: '2000-01-01', end: '2026-11-26' })).toBe(true);
  expect(P.isAllTime({ start: '2026-10-28', end: '2026-11-26' })).toBe(false);
  const page = read('js/admin/dashboard-detail.js');
  expect(page).toContain('params.compareToPrevious = !window.DashboardPeriod.isAllTime(period);');
  expect(read('js/admin/metric-detail.js')).toContain('if (window.DashboardPeriod && window.DashboardPeriod.isAllTime({ start: periodStart, end: periodEnd })) periodParams.compareToPrevious = false;');
});

test('long sparklines are bucketed before drawing on the dashboard and metric detail', () => {
  expect(read('js/admin/dashboard-detail.js')).toContain('window.MetricCardView.bucketSnapshots(');
  expect(read('js/admin/metric-detail.js')).toContain('window.MetricCardView.bucketSnapshots(');
});
