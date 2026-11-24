'use strict';

/**
 * Insights names its two surfaces by what they do: Reports (run an analysis
 * for a period) and Dashboards (saved standing views). "Firm Reporting",
 * "Library" and the "New Dashboard" sidebar button blurred the two.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function insightsItems() {
  const app = read('js/lex/components/layout/lex-app.js');
  const start = app.indexOf("appContext === 'insights'\n        ? [");
  return app.slice(start, app.indexOf(']', start));
}

// Every app's home item is "Dashboard" with the shared four-squares grid
// icon; the saved dashboards list is "All dashboards" so it is not confused
// with the home.
test('the Insights sidebar reads Dashboard, Reports, All dashboards and Billable Hours', () => {
  const items = insightsItems();
  const labels = [...items.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  expect(labels).toEqual(['Reports', 'All dashboards', 'Billable Hours']);
  expect(items).toContain("{ id: 'insights-dashboard', home: true, href: 'admin/analytics.html' }");
  expect(items).toContain("{ id: 'insights-reports', label: 'Reports', icon: 'bar-chart-2', href: 'admin/reports-list.html' }");
  expect(items).toContain("{ id: 'insights-dashboards', label: 'All dashboards', icon: 'book-open', href: 'admin/dashboard-library.html' }");
});

test.each([
  ['admin/reports-list.html', 'insights-reports', 'Reports'],
  ['admin/report.html', 'insights-reports', 'Report'],
  ['admin/dashboard-library.html', 'insights-dashboards', 'All dashboards'],
])('%s is titled %s', (file, nav, title) => {
  const html = read(file);
  expect(html).toContain('active-nav-id="' + nav + '"');
  expect(html).toContain('page-title="' + title + '"');
  expect(html).toContain('<title>' + title + ' - LANA AI</title>');
  expect(html).not.toMatch(/Firm Reporting|heading="Library"/);
});

test('the SPA router uses the same names', () => {
  const pages = read('js/lex/lex-router.pages.js');
  const entry = (file) => pages.slice(pages.indexOf("'" + file + "': {"), pages.indexOf('},', pages.indexOf("'" + file + "': {")));
  expect(entry('admin/reports-list.html')).toMatch(/title: 'Reports',\s+activeNav: 'insights-reports'/);
  expect(entry('admin/report.html')).toMatch(/title: 'Report',\s+activeNav: 'insights-reports'/);
  expect(entry('admin/dashboard-library.html')).toMatch(/title: 'All dashboards',\s+activeNav: 'insights-dashboards'/);
  expect(entry('admin/dashboard-builder.html')).toMatch(/activeNav: 'insights-dashboards'/);
  expect(entry('admin/dashboard-detail.html')).toMatch(/activeNav: 'insights-dashboards'/);
});

test('the Insights home is titled Dashboard and names the two the same way', () => {
  const html = read('admin/analytics.html');
  expect(html).not.toContain('Firm Reporting');
  expect(html).toContain('page-title="Dashboard"');
  expect(read('admin/reports-list.html')).toContain(`items='[{"label":"Dashboard","href":"admin/analytics.html"},{"label":"Reports"}]'`);
  expect(read('admin/report.html')).toContain(`items='[{"label":"Reports","href":"admin/reports-list.html"},{"label":"Report"}]'`);
});

// Dashboard detail builds its trail from the real path (insights-breadcrumbs.js:
// All dashboards / <name>); the builder keeps Dashboard / All dashboards.
test('dashboard detail reads its trail from the breadcrumb builder', () => {
  expect(read('js/admin/dashboard-detail.js')).toContain('InsightsBreadcrumbs.dashboardDetail(');
});

test('the builder breadcrumbs read Dashboard / All dashboards', () => {
  ['js/admin/dashboard-builder.js'].forEach((file) => {
    const js = read(file);
    expect(js).toContain("{ label: 'Dashboard', href: 'admin/analytics.html' },\n        { label: 'All dashboards', href: 'admin/dashboard-library.html' },");
    expect(js).not.toContain("{ label: 'Library', href: 'admin/dashboard-library.html' }");
  });
});
