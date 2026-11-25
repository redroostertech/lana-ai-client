'use strict';

/**
 * Insights breadcrumbs (pure): each page's trail reflects the real path and
 * every crumb but the last is a link. The back target is the parent crumb.
 */

const path = require('path');
const B = require(path.join(__dirname, '../../src/js/shared/insights-breadcrumbs.js'));

describe('metricDetail', () => {
  test('from a saved dashboard: All dashboards / the dashboard (same dates) / the metric', () => {
    const items = B.metricDetail({ from: 'dashboard', dashboardId: 'd-1', dashboardName: 'Owner Overview',
      periodStart: '2026-11-01', periodEnd: '2026-11-24', metricTitle: 'New Clients Needed for Payroll' });
    expect(items).toEqual([
      { label: 'All dashboards', href: 'admin/dashboard-library.html' },
      { label: 'Owner Overview', href: 'admin/dashboard-detail.html?id=d-1&periodStart=2026-11-01&periodEnd=2026-11-24' },
      { label: 'New Clients Needed for Payroll' },
    ]);
    expect(items.map((i) => i.label)).not.toContain('Metric Detail');
  });

  test('a dashboard whose name is not known yet reads "Dashboard"', () => {
    expect(B.metricDetail({ from: 'dashboard', dashboardId: 'd-1', metricTitle: 'X' })[1].label).toBe('Dashboard');
  });

  test('from the Metric Catalog and from Reports', () => {
    expect(B.metricDetail({ from: 'catalog', metricTitle: 'Cash' })).toEqual([
      { label: 'Metric Catalog', href: 'admin/metric-catalog.html' }, { label: 'Cash' }]);
    expect(B.metricDetail({ from: 'report', metricTitle: 'Cash' })).toEqual([
      { label: 'Reports', href: 'admin/reports-list.html' }, { label: 'Cash' }]);
  });

  test('a direct link (or a dashboard origin without an id) defaults to Insights', () => {
    expect(B.metricDetail({ metricTitle: 'Cash' })).toEqual([{ label: 'Insights', href: 'admin/analytics.html' }, { label: 'Cash' }]);
    expect(B.metricDetail({ from: 'dashboard', metricTitle: 'Cash' })[0].label).toBe('Insights');
  });
});

describe('dashboard pages', () => {
  test('a saved dashboard: All dashboards / its name', () => {
    expect(B.dashboardDetail({ name: 'Owner Overview' })).toEqual([
      { label: 'All dashboards', href: 'admin/dashboard-library.html' }, { label: 'Owner Overview' }]);
  });
  test('a standard view: Insights / its title', () => {
    expect(B.dashboardDetail({ name: 'Owner Performance', standard: true })).toEqual([
      { label: 'Insights', href: 'admin/analytics.html' }, { label: 'Owner Performance' }]);
  });
  test('All dashboards: Insights / All dashboards', () => {
    expect(B.dashboardLibrary()).toEqual([{ label: 'Insights', href: 'admin/analytics.html' }, { label: 'All dashboards' }]);
  });
});

test('backHref is the parent crumb', () => {
  expect(B.backHref([{ label: 'A', href: 'a.html' }, { label: 'B', href: 'b.html' }, { label: 'C' }])).toBe('b.html');
  expect(B.backHref([{ label: 'C' }])).toBe('');
});
