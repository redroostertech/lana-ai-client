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

async function page(search, payload) {
  const source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/metric-detail.js'), 'utf8');
  const dataState = fs.readFileSync(path.join(__dirname, '../../src/js/shared/data-state.js'), 'utf8');
  const nodes = {};
  const document = { addEventListener() {}, getElementById: id => (nodes[id] = nodes[id] || node()), createElement: () => node(),
    querySelector: () => null, querySelectorAll: () => [] };
  const api = { getMetricDetail: jest.fn().mockResolvedValue({ success: true, data: payload }) };
  const Lex = { Auth: { isAdmin: () => true }, Nav: { getParams: () => new URLSearchParams(search), go: jest.fn() } };
  const window = { location: { search }, Lex, customElements: null };
  const context = vm.createContext({ window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    Promise, setTimeout, Lex, api });
  vm.runInContext(dataState, context);
  for (const rel of ['js/dashboard/metric-goal-comparison.js', 'js/shared/metric-card-view.js', 'js/shared/mini-charts.js', 'js/shared/metric-detail-view.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8'), context);
  }
  vm.runInContext(source, context);
  await new Promise(resolve => { setImmediate(resolve); });
  await new Promise(resolve => { setImmediate(resolve); });
  return { api, nodes, empty: window.DataState.EMPTY_VALUE };
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
