'use strict';

/**
 * The real metric detail page with server-side rows: search (debounced),
 * sort, column filters and paging ask GET metric-detail with raw_* params;
 * stale answers are ignored; pinned conflicts outside the search say so.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };

function node() {
  const listeners = {};
  return { value: '', hidden: false, innerHTML: '', textContent: '', dataset: {}, style: {}, attrs: {}, listeners,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, detail) { (listeners[type] || []).forEach((fn) => fn({ detail, target: this })); },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    setData: jest.fn(), setServerData: jest.fn(), setColumnFilterOptions: jest.fn(), restoreQuery: jest.fn(),
    setCellRenderers(r) { this.renderers = r; }, querySelector: () => null, querySelectorAll: () => [] };
}

const rows = [
  { record_id: 'r-1', deal_name: 'Conflicted', decided_on: '2026-11-20', matches_query: false, conflict: { source_name: 'ActionStep', fields: [{ standard_key: 'amount', lana_value: 1, new_source_value: 2 }] } },
  { record_id: 'r-2', deal_name: 'Smith Plan', decided_on: '2026-11-18', outcome: 'won' },
];
const payload = { metric: { key: 'a.b', title: 'Won deals' }, current: { value: 2 }, snapshots: [],
  raw_data: { rows, total: 340, filtered_total: 2, has_more: false, facets: { outcome: [{ value: 'won', count: 9 }] }, sort: { by: 'decided_on', dir: 'desc' } } };

async function page(getMetricDetail) {
  const nodes = {};
  const document = { addEventListener() {}, getElementById: (id) => (nodes[id] = nodes[id] || node()), createElement: () => node(),
    querySelector: (sel) => (sel === 'lex-app' ? { backHref: '' } : null), querySelectorAll: () => [] };
  const api = { getMetricDetail: getMetricDetail || jest.fn().mockResolvedValue({ data: payload }) };
  const Lex = { Auth: { isAdmin: () => true }, Nav: { getParams: () => new URLSearchParams('?metric_key=a.b&periodStart=2026-11-01&periodEnd=2026-11-30'), go: jest.fn() } };
  const window = { location: { search: '' }, Lex, customElements: null };
  const context = vm.createContext({ window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams, Promise, setTimeout, clearTimeout, Lex, api });
  vm.runInContext(read('js/shared/data-state.js'), context);
  for (const rel of ['js/dashboard/metric-goal-comparison.js', 'js/shared/metric-card-view.js', 'js/shared/mini-charts.js', 'js/shared/metric-detail-view.js', 'js/shared/lineage-view.js', 'js/shared/insights-breadcrumbs.js']) {
    vm.runInContext(read(rel), context);
  }
  vm.runInContext(read('js/admin/metric-detail.js'), context);
  await settle();
  return { api, nodes };
}

test('server rows: server paging, facets as filters, and the count line', async () => {
  const { nodes } = await page();
  const table = nodes.metricRawDataTable;
  expect(table.attrs['server-paging']).toBe('');
  expect(table.setServerData).toHaveBeenCalledWith(expect.any(Array), { page: 1, limit: 20, total: 2 });
  expect(table.setColumnFilterOptions).toHaveBeenCalledWith({ outcome: { options: [{ value: 'won', label: 'Won (9 in all)' }] } });
  expect(nodes.metricRawDataCount.textContent).toBe('Showing 2 of 2 (of 340)');
  expect(table.renderers._notes(null, rows[0])).toContain('Conflict, outside your search');
});

test('sort, filters and paging ask the server with raw_* params', async () => {
  const { api, nodes } = await page();
  nodes.metricRawDataTable.fire('lex-query-change', { page: 2, limit: 20, sortBy: 'decided_on', sortDir: 'asc', filters: { outcome: { operator: 'in', value: ['won'] } } });
  await settle();
  expect(api.getMetricDetail).toHaveBeenLastCalledWith('a.b', expect.objectContaining({ periodStart: '2026-11-01', periodEnd: '2026-11-30',
    rawLimit: 20, rawOffset: 20, rawSortBy: 'decided_on', rawSortDir: 'asc', rawFilters: { outcome: 'won' } }));
});

test('search waits about 300 ms and sends only the last text', async () => {
  const { api, nodes } = await page();
  const calls = api.getMetricDetail.mock.calls.length;
  nodes.metricRawDataSearch.fire('lex-input', { value: 'smi' });
  nodes.metricRawDataSearch.fire('lex-input', { value: 'smith' });
  await new Promise((r) => setTimeout(r, 120));
  expect(api.getMetricDetail.mock.calls.length).toBe(calls);
  await new Promise((r) => setTimeout(r, 300));
  await settle();
  expect(api.getMetricDetail.mock.calls.length).toBe(calls + 1);
  expect(api.getMetricDetail.mock.calls[calls][1]).toEqual(expect.objectContaining({ rawQ: 'smith', rawOffset: 0 }));
});

test('a stale answer is ignored', async () => {
  let resolveSlow;
  const slow = new Promise((r) => { resolveSlow = r; });
  let n = 0;
  const getMetricDetail = jest.fn(() => {
    n += 1;
    if (n === 2) return slow;
    if (n === 3) return Promise.resolve({ data: Object.assign({}, payload, { raw_data: Object.assign({}, payload.raw_data, { rows: [rows[1]], filtered_total: 1 }) }) });
    return Promise.resolve({ data: payload });
  });
  const { nodes } = await page(getMetricDetail);
  const table = nodes.metricRawDataTable;
  table.fire('lex-query-change', { page: 2, limit: 20 });
  table.fire('lex-query-change', { page: 3, limit: 20 });
  await settle();
  resolveSlow({ data: Object.assign({}, payload, { raw_data: Object.assign({}, payload.raw_data, { filtered_total: 999 }) }) });
  await settle();
  expect(table.setServerData).toHaveBeenLastCalledWith(expect.any(Array), { page: 3, limit: 20, total: 1 });
});

test('without the server fields the table keeps filtering in the browser', async () => {
  const { nodes } = await page(jest.fn().mockResolvedValue({ data: Object.assign({}, payload, { raw_data: { rows, total: 2, has_more: false } }) }));
  expect(nodes.metricRawDataTable.attrs['server-paging']).toBeUndefined();
  expect(nodes.metricRawDataTable.setServerData).not.toHaveBeenCalled();
});

test('an unknown sort column (400) says so calmly and goes back to the default order', async () => {
  let n = 0;
  const getMetricDetail = jest.fn(() => {
    n += 1;
    if (n === 2) return Promise.reject(Object.assign(new Error('x'), { status: 400, data: { error: { details: { allowed: { sort: ['decided_on'] } } } } }));
    return Promise.resolve({ data: payload });
  });
  const { nodes } = await page(getMetricDetail);
  nodes.metricRawDataTable.fire('lex-query-change', { page: 1, limit: 20, sortBy: 'nope', sortDir: 'asc' });
  await settle();
  expect(getMetricDetail.mock.calls[2][1].rawSortBy).toBeUndefined();
  expect(nodes.metricRawDataSortNote.textContent).toBe('That column cannot be sorted here, so the records are in their usual order.');
  expect(nodes.metricRawDataSortNote.hidden).toBe(false);
});
