'use strict';

/**
 * Metric detail records on the server: search, sort, column filters and
 * paging go to GET /api/v1/modules/metric-detail/:metricKey when the
 * response says it can (filtered_total, facets, sort or filters on
 * raw_data); otherwise the table keeps filtering in the browser.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const V = require(path.join(__dirname, '../../src/js/shared/metric-detail-view.js'));

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('when the server handles the rows', () => {
  test('filtered_total, facets, sort or filters on raw_data; total or has_more alone is not enough', () => {
    expect(V.isServerRows({ rows: [], filtered_total: 3 })).toBe(true);
    expect(V.isServerRows({ rows: [], facets: { status: [] } })).toBe(true);
    expect(V.isServerRows({ rows: [], total: 40, has_more: true })).toBe(false);
    expect(V.isServerRows(null)).toBe(false);
  });
});

describe('rowsRequestParams: the table query as raw_* params', () => {
  test('search, sort, value filters, ranges and paging', () => {
    expect(V.rowsRequestParams({ search: ' smith ', sortBy: 'decided_on', sortDir: 'desc', page: 3, limit: 20,
      filters: { outcome: { operator: 'in', value: ['won'] }, source: { operator: 'contains', value: 'truth' }, decided_on: { operator: 'in', value: ['2026-11-01..2026-11-15'] } } }))
      .toEqual({ rawQ: 'smith', rawSortBy: 'decided_on', rawSortDir: 'desc', rawLimit: 20, rawOffset: 40,
        rawFilters: { outcome: 'won', source: 'truth', decided_on_from: '2026-11-01', decided_on_to: '2026-11-15' } });
  });
  test('nothing picked: just the page', () => {
    expect(V.rowsRequestParams({ page: 1, limit: 20 })).toEqual({ rawLimit: 20, rawOffset: 0 });
  });
});

describe('words around the server rows', () => {
  test('"Showing X of filtered_total (of total)"', () => {
    expect(V.rowsCountText({ filtered_total: 12, total: 340 }, 12)).toBe('Showing 12 of 12 (of 340)');
    expect(V.rowsCountText({ filtered_total: 340, total: 340 }, 20)).toBe('Showing 20 of 340');
  });
  test('truncated: "Showing the first N of source_total records"', () => {
    expect(V.truncatedText({ truncated: true, total: 5000, source_total: 12345 })).toBe('Showing the first 5,000 of 12,345 records.');
    expect(V.truncatedText({ truncated: false })).toBe('');
  });
  test('facets become column filter options with counts', () => {
    expect(V.facetFilterOptions({ outcome: [{ value: 'won', count: 9 }, { value: 'lost', count: 3 }], empty: [] }))
      .toEqual({ outcome: { options: [{ value: 'won', label: 'Won (9)' }, { value: 'lost', label: 'Lost (3)' }] } });
  });
  test('a pinned conflict outside the search says so', () => {
    expect(V.rowNotes({ conflict: { fields: [] }, matches_query: false }).outsideSearch).toBe(true);
    expect(V.rowNotes({ conflict: { fields: [] }, matches_query: true }).outsideSearch).toBe(false);
  });
});

test('api.getMetricDetail sends the raw_* params', async () => {
  const context = { console, URLSearchParams, AbortController, FormData: class {}, setTimeout, clearTimeout, setInterval, clearInterval, fetch: jest.fn(),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, body: {}, getElementById: () => null },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' }, LanaConfig: {},
    LanaTime: { nowMs: () => 1000, millisecondsSince: () => 0, MS_PER_MINUTE: 60000 } };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(read('js/api.js'), context);
  const api = context.window.api;
  api.request = jest.fn().mockResolvedValue({});
  await api.getMetricDetail('a.b', { periodStart: '2026-11-01', periodEnd: '2026-11-30', rawLimit: 20, rawOffset: 40, rawQ: 'smith', rawSortBy: 'decided_on', rawSortDir: 'desc',
    rawFilters: { outcome: 'won', decided_on_from: '2026-11-01' } });
  const url = api.request.mock.calls[0][1];
  expect(url).toContain('raw_limit=20');
  expect(url).toContain('raw_offset=40');
  expect(url).toContain('raw_q=smith');
  expect(url).toContain('raw_sort_by=decided_on');
  expect(url).toContain('raw_sort_dir=desc');
  expect(url).toContain('raw_filter%5Boutcome%5D=won');
  expect(url).toContain('raw_filter%5Bdecided_on_from%5D=2026-11-01');
});
