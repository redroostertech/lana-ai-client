'use strict';

/**
 * The attribution summary renders the sections the visualization declares
 * (sections: [{ role, metric }]): the role picks the layout and the metric
 * comes from the execute response by the declared key. A section whose
 * metric is missing or not ok shows the shared DataState block.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function render(viz, data) {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/report.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { renderAttributionSummary };' + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const document = { addEventListener() {}, getElementById: () => null, createElement: () => ({ innerHTML: '' }) };
  vm.runInNewContext(source, { window, document, console, Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn() });
  return window.testExports.renderAttributionSummary(viz, data, 'u1').innerHTML;
}

const SECTIONS = [
  { role: 'multi_touch', metric: 'k_multi' },
  { role: 'journeys', metric: 'k_paths' },
  { role: 'first_vs_last_touch', metric: 'k_touch' },
  { role: 'campaigns', metric: 'k_campaigns' },
  { role: 'landing_pages', metric: 'k_pages' }
];
const METRICS = [
  { key: 'k_multi', current: [{ label: 'Single Touch', value: 6, win_rate: 10 }, { label: 'Multi Touch', value: 4, win_rate: 30 }] },
  { key: 'k_paths', current: [{ label: 'Path Alpha', journey_type: 'multi', value: 4, won_count: 1, win_rate: 25 }] },
  { key: 'k_touch', current: [{ touch_type: 'first_touch', channel: 'Channel Beta', value: 8, win_rate: 20 },
    { touch_type: 'last_touch', channel: 'Channel Gamma', value: 4, win_rate: 50 }] },
  { key: 'k_campaigns', current: [{ label: 'Campaign Delta', channel: 'x', value: 3, won_count: 1, win_rate: 33 }] },
  { key: 'k_pages', current: [{ label: '/page-epsilon', value: 2, won_count: 1, win_rate: 50 }] }
];

test('each declared section renders its metric, in the declared order', () => {
  const html = render({ title: 'Attribution', metrics: METRICS.map(m => m.key), sections: SECTIONS }, { metrics: METRICS });
  const order = ['40%', 'Path Alpha', 'Channel Beta', 'Channel Gamma', 'Campaign Delta', '/page-epsilon'].map(t => html.indexOf(t));
  order.forEach(index => expect(index).toBeGreaterThan(-1));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(html).not.toContain('lex-data-state');
});

test('only declared sections render, keyed by the declared metric', () => {
  const html = render({ title: 'Attribution', sections: [{ role: 'campaigns', metric: 'k_pages' }] }, { metrics: METRICS });
  expect(html).toContain('Campaign Performance');
  expect(html).toContain('/page-epsilon');
  expect(html).not.toContain('Campaign Delta');
  expect(html).not.toContain('Lead Journey Paths');
});

test('a missing metric and a not-ok metric each show the DataState block', () => {
  const metrics = [{ key: 'k_paths', data_state: 'insufficient_data', data_state_reason: 'Reason Zeta' }, METRICS[3]];
  const html = render({ title: 'Attribution', sections: [
    { role: 'journeys', metric: 'k_paths' }, { role: 'landing_pages', metric: 'k_absent' }, { role: 'campaigns', metric: 'k_campaigns' }
  ] }, { metrics });
  expect(html.match(/class="lex-data-state /g)).toHaveLength(2);
  expect(html).toContain('Not enough data');
  expect(html).toContain('Reason Zeta');
  expect(html).toContain('Could not work this out');
  expect(html).toContain('Campaign Delta');
});

test('a visualization with no sections renders no metric sections and shows the DataState block', () => {
  const html = render({ title: 'Attribution', metrics: METRICS.map(m => m.key) }, { metrics: METRICS });
  expect(html).toContain('Attribution');
  expect(html).not.toContain('Path Alpha');
  expect(html.match(/class="lex-data-state /g)).toHaveLength(1);
  expect(html).toContain('lex-data-state--not-configured');
  expect(html).toContain('Not set up yet');
});

test('sections with only unknown roles show the DataState block too', () => {
  const html = render({ title: 'Attribution', sections: [{ role: 'not_a_role', metric: 'k_multi' }] }, { metrics: METRICS });
  expect(html).toContain('lex-data-state--not-configured');
});
