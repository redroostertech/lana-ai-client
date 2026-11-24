'use strict';

/**
 * Runs the real Metric Detail page script. The page sends the plain firm days
 * from its link as they are (the backend bounds them in the firm's zone) and
 * names the period with the label the backend returns, never a window it
 * works out itself.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function node() {
  return { value: '', hidden: false, innerHTML: '', textContent: '', items: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, setData() {}, setColumnFilterOptions() {},
    setCellRenderers(r) { this.renderers = r; }, querySelector: () => null, querySelectorAll: () => [] };
}

async function page(search, payload, apiExtra) {
  const source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/metric-detail.js'), 'utf8');
  const dataState = fs.readFileSync(path.join(__dirname, '../../src/js/shared/data-state.js'), 'utf8');
  const nodes = {};
  const document = { addEventListener() {}, getElementById: id => (nodes[id] = nodes[id] || node()), createElement: () => node(),
    querySelectorApp: null,
    querySelector: (sel) => (sel === 'lex-app' ? app : null), querySelectorAll: () => [] };
  const api = Object.assign({ getMetricDetail: jest.fn().mockResolvedValue({ success: true, data: payload }) }, apiExtra || {});
  const app = { backHref: '' };
  const Lex = { Auth: { isAdmin: () => true }, Nav: { getParams: () => new URLSearchParams(search), go: jest.fn() } };
  const window = { location: { search }, Lex, customElements: null };
  const context = vm.createContext({ window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    Promise, setTimeout, Lex, api });
  vm.runInContext(dataState, context);
  for (const rel of ['js/dashboard/metric-goal-comparison.js', 'js/shared/metric-card-view.js', 'js/shared/mini-charts.js', 'js/shared/metric-detail-view.js', 'js/shared/lineage-view.js', 'js/shared/insights-breadcrumbs.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8'), context);
  }
  vm.runInContext(source, context);
  await new Promise(resolve => { setImmediate(resolve); });
  await new Promise(resolve => { setImmediate(resolve); });
  return { api, nodes, app, empty: window.DataState.EMPTY_VALUE };
}

const payload = { metric: { key: 'matters_opened', title: 'Matters opened' }, current: { value: 4 }, movement: null,
  snapshots: [], raw_data: { rows: [] },
  period: { startDate: '2026-10-01', endDate: '2026-10-31', timeZone: 'America/Los_Angeles', label: 'Oct 1, 2026 - Oct 31, 2026' } };

test('the page sends the link\'s plain firm days unchanged and shows the backend\'s period label', async () => {
  const p = await page('?metric_key=matters_opened&periodStart=2026-10-01&periodEnd=2026-10-31&compareBy=weekly', payload);
  expect(p.api.getMetricDetail).toHaveBeenCalledWith('matters_opened',
    { periodStart: '2026-10-01', periodEnd: '2026-10-31', compareBy: 'weekly' });
  expect(p.nodes.metricPeriod.textContent).toBe('Oct 1, 2026 - Oct 31, 2026');
});

test('no period from the backend shows the shared empty token, not a guessed window', async () => {
  const p = await page('?metric_key=matters_opened', { ...payload, period: null });
  expect(p.api.getMetricDetail).toHaveBeenCalledWith('matters_opened');
  expect(p.empty).toBe('n/a');
  expect(p.nodes.metricPeriod.textContent).toBe(p.empty);
});

test('one summary: the value in its format, the change both ways, and the prior period', async () => {
  const blank = await page('?metric_key=matters_opened', { ...payload, current: { value: null }, movement: null });
  expect(blank.nodes.metricSummaryValue.textContent).toBe(blank.empty);
  expect(blank.nodes.metricSummaryChange.hidden).toBe(true);

  const zero = await page('?metric_key=matters_opened', { ...payload, current: { value: 0, format: 'integer' } });
  expect(zero.nodes.metricSummaryValue.textContent).toBe('0');

  const down = await page('?metric_key=matters_opened', { ...payload, current: { value: 4, format: 'integer' },
    movement: { prior_value: 8, percent_change: 50, direction: 'down' } });
  expect(down.nodes.metricSummaryChange.textContent).toBe('Down 50%, -4');
  expect(down.nodes.metricSummaryPrior.textContent).toBe('vs 8 in the prior period');

  const days = await page('?metric_key=matters_opened', { ...payload, current: { value: 301.74, format: 'days' },
    comparison: { previous_value: 300.7, absolute_change: 1.04, percent_change: 0.35, direction: 'up',
      previous_period: { start: '2025-02-07T05:00:00.000Z', end: '2026-01-01T05:00:00.000Z' } } });
  expect(days.nodes.metricSummaryValue.textContent).toBe('301.7 days');
  expect(days.nodes.metricSummaryChange.textContent).toBe('Up 0.3%, +1.0 days');
  expect(days.nodes.metricSummaryPrior.textContent).toBe('vs 300.7 days in the prior period (Feb 7, 2025 to Dec 31, 2025)');
});

test('history shows only with two or more stored values', async () => {
  const none = await page('?metric_key=matters_opened', payload);
  expect(none.nodes.metricHistorySection.hidden).toBe(true);
  const two = await page('?metric_key=matters_opened', { ...payload,
    snapshots: [{ value_numeric: 3, period_start: '2026-08-01' }, { value_numeric: 5, period_start: '2026-09-01' }] });
  expect(two.nodes.metricHistorySection.hidden).toBe(false);
  expect(two.nodes.metricHistoryChart.innerHTML).toContain('mini-spark');
});

test('the records table hides ids and reads as words', async () => {
  const p = await page('?metric_key=matters_opened', { ...payload, raw_data: { rows: [
    { matter_key: 'm-1', matter_name: 'Estate', client_name: '', status: 'active', opened_at: '2026-08-03T16:43:22.716Z' }] } });
  const table = p.nodes.metricRawDataTable;
  expect(table.attrs.columns).toBe('matter_name,status,opened_at');
  expect(table.attrs.labels).toBe('Matter,Status,Opened');
  expect(table.renderers.opened_at('2026-08-03T16:43:22.716Z', {})).toContain('Aug 3, 2026');
  expect(table.renderers.status('', {})).toBe('<span class="metric-detail-muted">-</span>');
});

test('a blank snapshot value is the muted empty token', async () => {
  const p = await page('?metric_key=matters_opened', { ...payload,
    snapshots: [{ value_numeric: 3, period_start: '2026-08-01' }, { value_numeric: 5, period_start: '2026-09-01' }] });
  const value = p.nodes.metricSnapshotsTable.renderers.value;
  expect(value(0, {})).toBe('<span class="metric-detail-muted">' + p.empty + '</span>');
  expect(value(null, {})).toBe('<span class="metric-detail-muted">' + p.empty + '</span>');
  expect(value(9.4, {})).toBe('9.4');
});

describe('Data used', () => {
  const lineage = {
    sources: [{ entity: 'lead', label: 'Leads', records_total: 1204, records_in_period: 36,
      systems: [{ label: 'Leadly', records: 1180, last_synced_at: '2020-01-01T00:00:00Z' }], last_synced_at: '2020-01-01T00:00:00Z' }],
    fields: [{ entity: 'lead', field: 'created_at', label: 'Date created', role: 'date filter' }],
    filters: [{ label: 'Estate planning only', detail: 'Practice area is Estate Planning' }],
    formula: { kind: 'ratio', plain: 'Converted clients divided by potential new clients.', expression: 'count(a) / count(b)' },
    period_rule: 'Counts leads created between your dates.',
    inputs: [{ metric_key: 'legal_firm.s.converted', title: 'Converted clients', role: 'numerator' },
      { metric_key: 'legal_firm.s.pnc', title: 'Potential new clients', role: 'denominator' }],
    goal_source: { metric_key: 'legal_firm.s.target', set: false },
    caveats: ['Leads without a source are left out.'],
  };

  test('no lineage, no section', async () => {
    const p = await page('?metric_key=matters_opened', payload);
    expect(p.nodes.metricDataUsed.hidden).toBe(true);
  });

  test('the equation as pills, the four-step flow, source cards with a stale dot, details with icons, goal, caveats', async () => {
    const p = await page('?metric_key=matters_opened&periodStart=2026-10-01&periodEnd=2026-10-31', { ...payload, current: { value: 7.6, format: 'percentage' }, lineage });
    const html = p.nodes.metricDataUsed.innerHTML;
    const text = html.split('<').map((part) => part.slice(part.indexOf('>') + 1)).join(' ').split(/\s+/).join(' ');
    expect(p.nodes.metricDataUsed.hidden).toBe(false);
    expect(html).toContain('mabout__equation');
    expect(html).toContain('data-metric-record-link="admin/metric_detail.html?metric_key=legal_firm.s.pnc&amp;periodStart=2026-10-01&amp;periodEnd=2026-10-31"');
    // Inputs carry their current values (fetched once); the result closes the equation.
    expect(text).toMatch(/Converted clients \S+ ÷ Potential new clients \S+ = 7\.6%/);
    expect(html.split('class="mabout__step ').length - 1).toBe(4);
    expect(text).toContain('Estate planning only');
    expect(text).toContain('Counts leads created between your dates.');
    expect(text).toContain('1,204 leads');
    expect(text).toContain('36 in your dates');
    expect(html).toContain('mabout__dot--stale');
    expect(text).toContain('via Leadly');
    expect(text).toContain('Date created decides which dates count.');
    expect(html).toContain('admin/metric-catalog.html?editGoal=legal_firm.s.target');
    expect(html).toContain('mabout__caveat');
    expect(text).toContain('Leads without a source are left out.');
    expect(html).toContain('<details class="metric-data__technical">');
    expect(text).toContain('count(a) / count(b)');
  });

  test('the Data used sentence hides when How it is calculated already says it', async () => {
    const p = await page('?metric_key=matters_opened', { ...payload, metric: { ...payload.metric, calculation: 'Converted clients divided by potential new clients.' }, lineage });
    expect(p.nodes.metricDataUsed.innerHTML).not.toContain('mabout__formula');
  });
});

describe('breadcrumbs', () => {
  test('opened from a dashboard: All dashboards / the dashboard with the same dates / the metric; Back goes to the dashboard', async () => {
    const p = await page('?metric_key=matters_opened&periodStart=2026-10-01&periodEnd=2026-10-31&from=dashboard&dashboardId=d-1', payload,
      { getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Owner Overview' } }) });
    await new Promise((r) => setImmediate(r));
    expect(p.nodes.metricDetailBreadcrumb.items).toEqual([
      { label: 'All dashboards', href: 'admin/dashboard-library.html' },
      { label: 'Owner Overview', href: 'admin/dashboard-detail.html?id=d-1&periodStart=2026-10-01&periodEnd=2026-10-31' },
      { label: 'Matters opened' },
    ]);
    expect(p.app.backHref).toBe('admin/dashboard-detail.html?id=d-1&periodStart=2026-10-01&periodEnd=2026-10-31');
  });

  test('a direct link: Insights / the metric', async () => {
    const p = await page('?metric_key=matters_opened', payload);
    expect(p.nodes.metricDetailBreadcrumb.items).toEqual([{ label: 'Insights', href: 'admin/analytics.html' }, { label: 'Matters opened' }]);
  });
});

test('the server count_scope sits once in a tooltip on the total, not repeated as text', async () => {
  const lineage = { sources: [{ entity: 'matter', label: 'Matters', records_total: 7723, records_in_period: null,
    count_scope: 'All records of this type the firm has, by system, not only the ones this number uses.',
    systems: [{ label: 'ActionStep', records: 7715, last_synced_at: '2020-08-10T00:00:00Z' }, { label: 'LANA', records: 8, last_synced_at: null }],
    last_synced_at: '2020-08-10T00:00:00Z' }], formula: { kind: 'count', plain: 'Counts open matters.' } };
  const p = await page('?metric_key=matters_opened', { ...payload, lineage });
  const html = p.nodes.metricDataUsed.innerHTML;
  expect(html).toContain('7,723 matters');
  expect(html).toContain('via ActionStep, 8 in LANA');
  expect(html.split('title="All records of this type the firm has').length - 1).toBe(1);
  expect(html).not.toContain('in your dates');
  expect(html).toContain('Count of');
});
