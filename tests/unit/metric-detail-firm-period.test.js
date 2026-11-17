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
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, setData() {},
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

test('blank stats use the shared empty token and a falling movement keeps its minus sign', async () => {
  const blank = await page('?metric_key=matters_opened', { ...payload, current: { value: 0 }, movement: null });
  ['metricCurrentValue', 'metricPriorValue', 'metricMovement', 'metricDirection', 'metricStatus', 'metricCalculation',
    'metricBusinessLogic'].forEach(id => expect([id, blank.nodes[id].textContent]).toEqual([id, blank.empty]));

  const down = await page('?metric_key=matters_opened', { ...payload,
    movement: { prior_value: 8, percent_change: 50, direction: 'down' } });
  expect(down.nodes.metricMovement.textContent).toBe('-50.0%');
  expect(down.nodes.metricDirection.textContent).toBe('down');
  const up = await page('?metric_key=matters_opened', { ...payload,
    movement: { prior_value: 2, percent_change: 100, direction: 'up' } });
  expect(up.nodes.metricMovement.textContent).toBe('+100.0%');
});

test('a blank snapshot value is the muted empty token', async () => {
  const p = await page('?metric_key=matters_opened', payload);
  const value = p.nodes.metricSnapshotsTable.renderers.value;
  expect(value(0, {})).toBe('<span class="metric-detail-muted">' + p.empty + '</span>');
  expect(value(null, {})).toBe('<span class="metric-detail-muted">' + p.empty + '</span>');
  expect(value(9.4, {})).toBe('9.4');
});
