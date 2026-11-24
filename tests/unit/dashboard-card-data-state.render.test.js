'use strict';

/**
 * Renders the real dashboard tile (dashboard-detail.js renderMetricCard): a
 * tile whose data_state is not ok, including a tile key no longer in the
 * catalog, shows the shared DataState block instead of a value.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');
const { withDashboardScripts } = require('./helpers/dashboard-shared-scripts');

const nodes = { dashboardViewContext: { innerHTML: '' } };
function page() {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/dashboard-detail.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { renderMetricCard, renderModalDetails, formatMetricCardValue, renderViewContext, emptyValue: window.DataState.EMPTY_VALUE };' + source.slice(end + '  init();'.length);
  const window = withDashboardScripts(withReportSharedScripts({ addEventListener() {} }));
  window.testNodes = nodes;
  vm.runInNewContext(source, { window, document: { addEventListener() {}, getElementById: (id) => nodes[id] || null }, console,
    Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: { nowMs: () => 0, formatUtcDayRange: () => '', reportPresetDays: () => ({ start: '2026-01-01', end: '2026-01-07' }) } });
  return window.testExports;
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('an unavailable tile shows its state and reason', () => {
  const html = page().renderMetricCard({ metric_key: 'gone.metric', title: 'gone.metric', value: null, data_state: 'not_configured',
    data_state_reason: 'This number is no longer in the catalog. Remove it from the dashboard or pick another.' });
  expect(text(html)).toContain('Not set up yet');
  expect(text(html)).toContain('no longer in the catalog');
  expect(html).toContain('dash-metric-card');
});

test('an ok tile still shows its value', () => {
  const html = page().renderMetricCard({ metric_key: 'a.b', title: 'Revenue', value: 5, formatted_value: '$5', format: 'currency', data_state: 'ok' });
  expect(text(html)).toContain('Revenue');
  expect(html).not.toContain('lex-data-state');
});

test('a real 0 shows 0, not a placeholder', () => {
  const html = page().renderMetricCard({ metric_key: 'a.z', title: 'Open Matters', value: 0, format: 'number', data_state: 'ok' });
  expect(html).toContain('<div class="dash-metric-card__value">0</div>');
  expect(page().formatMetricCardValue({ value: 0, format: 'currency' })).toBe('$0');
});

test('a missing value shows the shared empty token', () => {
  expect(page().formatMetricCardValue({ value: null, format: 'number' })).toBe(page().emptyValue);
});

describe('tile details read only data_state and data_state_reason', () => {
  test('old failure fields never show', () => {
    const html = page().renderModalDetails({ metric_key: 'a.b', title: 'Revenue', value: 5, data_state: 'ok', status: 'green',
      executable: false, message: 'Calculation is planned but not executable yet', error: 'boom' });
    expect(text(html)).not.toMatch(/planned|executable|boom/i);
    expect(html).not.toContain('lex-data-state');
  });

  test('a tile that is not ok shows the shared state block with the reason', () => {
    const html = page().renderModalDetails({ metric_key: 'a.b', title: 'Owed', value: null, data_state: 'no_data_source',
      data_state_reason: 'No invoice data yet. Connect the app that holds it.' });
    expect(html).toContain('lex-data-state--no-data-source');
    expect(text(html)).toContain('No data source');
    expect(text(html)).toContain('No invoice data yet');
  });
});

test('a tile that is not ok keeps its group label, like an ok tile', () => {
  const html = page().renderMetricCard({ metric_key: 'f.owed', title: 'Owed', value: null, section: { key: 'finance', label: 'Finance' },
    data_state: 'no_data_source', data_state_reason: 'No invoice data yet.' });
  expect(html).toContain('<div class="dash-metric-card__eyebrow">Finance</div>');
});

test('the populated count leaves out tiles that have no data', () => {
  const metrics = [{ metric_key: 'a', value: 1, data_state: 'ok' }, { metric_key: 'b', value: 0, data_state: 'ok' },
    { metric_key: 'c', value: null, data_state: 'no_data_source', data_state_reason: 'x' }];
  page().renderViewContext('owner', metrics, [{}, {}]);
  expect(text(nodes.dashboardViewContext.innerHTML)).toContain('2 populated metrics');
});
