'use strict';

// Metric detail can skip its source rows (raw_limit=0): the dashboard's
// sparklines only need the history. The records view leaves it out.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadApi() {
  const context = {
    console, URLSearchParams, AbortController, FormData: class FormData {}, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: jest.fn(),
    localStorage: { getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn() },
    document: { addEventListener: jest.fn(), body: {}, getElementById: jest.fn(() => null) },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' },
    LanaConfig: {},
    LanaTime: { nowMs: jest.fn(() => 1000), millisecondsSince: jest.fn((start) => 1000 - start), MS_PER_MINUTE: 60000 },
  };
  context.window = context;
  context.globalThis = context;
  const apiPath = path.join(__dirname, '../../src/js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
  const api = context.window.api;
  api.request = jest.fn().mockResolvedValue({});
  return api;
}

test('rawLimit 0 is sent as raw_limit=0', async () => {
  const api = loadApi();
  await api.getMetricDetail('a.b', { periodStart: '2026-01-01', periodEnd: '2026-01-31', rawLimit: 0 });
  const url = api.request.mock.calls[0][1];
  expect(url).toContain('periodStart=2026-01-01');
  expect(url).toContain('raw_limit=0');
});

test('without rawLimit the source rows are requested as before', async () => {
  const api = loadApi();
  await api.getMetricDetail('a.b', { periodStart: '2026-01-01' });
  expect(api.request.mock.calls[0][1]).not.toContain('raw_limit');
});

test('an as-of request sends asOf alone: never periodStart, periodEnd or the comparison', async () => {
  const api = loadApi();
  await api.getMetricDetail('a.b', { asOf: '2026-11-27', periodStart: '2026-01-01', periodEnd: '2026-11-27', compareBy: 'monthly', compareToPrevious: true, rawLimit: 20, rawFilters: { month: '2026-10' } });
  const url = api.request.mock.calls[0][1];
  expect(url).toContain('asOf=2026-11-27');
  expect(url).not.toContain('periodStart');
  expect(url).not.toContain('periodEnd');
  expect(url).not.toContain('compareBy');
  expect(url).not.toContain('compareToPrevious');
  expect(url).toContain('raw_limit=20');
  expect(url).toContain('raw_filter%5Bmonth%5D=2026-10');
});
