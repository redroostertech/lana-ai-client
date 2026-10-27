'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const helperPath = path.join(__dirname, '../../src/js/shared/opportunity-intake-presentation.js');
const helper = require(helperPath);
const KEY = 'core.funnel-analysis-attribution.conversion_by_source';
const clone = value => JSON.parse(JSON.stringify(value));
function metric() {
  const start = '2026-01-01T00:00:00.000Z', end = '2026-02-01T00:00:00.000Z', org = '87000000-0000-4000-8000-000000000001';
  const observations = [2, 3].map((id, index) => ({ source_key: JSON.stringify(['intake', org, 'source',
    '87000000-0000-4000-8000-00000000000' + id, 'crm', '<Form>']), source_kind: 'known', label: '<Form>',
    period_start: start, period_end_exclusive: end, record_count: 3, won_count: index ? 0 : 2,
    lost_count: index ? 0 : 1, closed_count: index ? 0 : 3, nonclosed_count: index ? 3 : 0,
    unknown_status_count: 0, rate: index ? null : 66.67 }));
  const receipt = { version: 'opportunity-intake-observation-v1', organization_id: org, declaration_digest: 'a'.repeat(64),
    aggregation: 'whole_window', frequency: null, status: 'complete', as_of: end, timezone: 'UTC', currency: null,
    window: { start, end_exclusive: end }, interval: { start, end_exclusive: end }, observations,
    coverage: { eligible_record_count: 6, counted_record_count: 6, excluded_record_count: 0, unresolved_identity_count: 0,
      duplicate_identity_count: 0, unknown_clock_count: 0, unknown_source_count: 0, conflicting_source_count: 0,
      won_count: 2, lost_count: 1, closed_count: 3, nonclosed_count: 3, unknown_status_count: 0 } };
  const value = observations.map(row => ({ key: row.source_key, label: row.label, source_kind: row.source_kind,
    count: row.record_count, won_count: row.won_count, lost_count: row.lost_count, closed_count: row.closed_count,
    nonclosed_count: row.nonclosed_count, unknown_status_count: row.unknown_status_count, value: row.rate }));
  return { key: KEY, metric_key: KEY, name: 'Intake', title: 'Intake', current: value, value, status: receipt.status,
    format: 'distribution', unit: 'percent', currency: null, aggregation: 'report_window', metadata: {
      canonical_metric_key: KEY, definition_version: 'opportunity-intake-closed-win-rate-v1', organization_id: org,
      provenance: 'calculated', observation_receipt: receipt } };
}
function page(file, names) {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin', file), 'utf8');
  const end = source.lastIndexOf('  init();');
  if (end < 0) throw Error('Expected actual initialization seam');
  source = source.slice(0, end) + `  window.testExports = { ${names} };` + source.slice(end + '  init();'.length);
  const window = { OpportunityIntakePresentation: helper, addEventListener() {} };
  vm.runInNewContext(source, { window, document: { addEventListener() {}, getElementById: () => null }, console,
    Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: { nowMs: () => 0 } });
  return window.testExports;
}
test.each([['dashboard-detail.js', 'renderMetricCard'], ['reporting.js', 'createMetricCard']])('%s displays actual intake denominators and null rate, not a generic scalar/share', (file, fn) => {
  const html = page(file, fn)[fn](metric());
  expect(html).toContain('Closed (won + lost)');
  expect(html).toContain('66.67%'); expect(html).toContain('Unavailable');
  expect(html).toContain('000000000002'); expect(html).toContain('000000000003');
  expect(html).toContain('&lt;Form&gt;'); expect(html).not.toContain('<Form>');
  expect(html).not.toContain('[object Object]'); expect(html).toContain('not contact acquisition');
});
test('ordinary same-bare-key custom scalar remains on its original card path', () => {
  const html = page('dashboard-detail.js', 'renderMetricCard').renderMetricCard({ key: 'conversion_by_source', name: 'Custom', current: 12, value: 12, format: 'number' });
  expect(html).toContain('Custom'); expect(html).not.toContain('Closed (won + lost)');
});
test.each(['receipt', 'null-row', 'rate', 'denominator', 'manual', 'scalar', 'organization'])('%s substitution is visibly unavailable', defect => {
  const m = metric();
  if (defect === 'receipt') delete m.metadata.observation_receipt;
  if (defect === 'null-row') m.metadata.observation_receipt.observations[0] = null;
  if (defect === 'rate') m.value[0].value = 0;
  if (defect === 'denominator') m.value[0].closed_count++;
  if (defect === 'manual') m.metadata.manual_override = true;
  if (defect === 'scalar') m.value = 50;
  if (defect === 'organization') m.metadata.organization_id = 'foreign';
  expect(helper.renderCard(m)).toContain('Opportunity intake evidence unavailable');
});
test('partial coverage diagnostics and zero rates remain visible with missing denominator distinct', () => {
  const m = metric(), receipt = m.metadata.observation_receipt;
  receipt.coverage.conflicting_source_count = 3; receipt.status = m.status = 'partial';
  receipt.observations[0].rate = m.value[0].value = 0;
  const html = helper.renderCard(m);
  expect(html).toContain('Conflicting sources: 3'); expect(html).toContain('0%'); expect(html).toContain('Unavailable');
});
test('actual previews and bar visualization retain typed evidence and do not invent a zero bar for unavailable sources', () => {
  const savedWindow = global.window, savedDocument = global.document;
  global.window = { OpportunityIntakePresentation: helper };
  const container = { innerHTML: '', querySelectorAll: () => [], appendChild: jest.fn() };
  global.document = { createElement: () => container };
  try {
    jest.resetModules(); const preview = require('../../src/js/shared/metric-card-preview');
    expect(preview.renderDashboardPreviewCard(metric())).toContain('Closed (won + lost)');
    expect(preview.renderReportPreviewCard(metric())).toContain('66.67%');
    const render = jest.fn(() => ({ chart: true }));
    helper.visualization({ type: 'bar_chart', metrics: [KEY] }, { metrics: [metric()] }, render, jest.fn());
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ type: 'grouped_bar_chart', metrics: [],
      data: [expect.objectContaining({ closed_win_rate: 66.67 })] }));
    expect(container.innerHTML).toContain('Unavailable'); expect(container.appendChild).toHaveBeenCalled();
  } finally { global.window = savedWindow; global.document = savedDocument; }
});
test('actual drilldown summary retains full-window denominators independently of selected page and refuses foreign context', () => {
  const Renderer = require('../../src/js/drilldown-renderer'), m = metric(), receipt = m.metadata.observation_receipt;
  const savedWindow = global.window, savedDocument = global.document, summaryNode = {};
  global.window = { OpportunityIntakePresentation: helper };
  global.document = { getElementById: id => id === 'drilldown-summary' ? summaryNode : { classList: { remove: jest.fn() } } };
  const renderer = Object.create(Renderer.prototype);
  renderer.currentConfig = { organizationId: receipt.organization_id, periodStart: receipt.window.start, periodEnd: receipt.window.end_exclusive };
  renderer.currentData = { status: receipt.status, rows: [], metadata: { canonical_metric_key: KEY }, summary: {
    coverage_status: receipt.status, coverage: receipt.coverage, observation_receipt: receipt,
    period_start: receipt.window.start, period_end_exclusive: receipt.window.end_exclusive,
    observed_end_exclusive: receipt.interval.end_exclusive, as_of: receipt.as_of, timezone: receipt.timezone,
    applied_filters: { source_key: receipt.observations[1].source_key } } };
  try {
    renderer.renderSummary(); expect(summaryNode.innerHTML).toContain('66.67%');
    expect(summaryNode.innerHTML).toContain('Closed: 3'); expect(summaryNode.innerHTML).toContain('Full reporting window before');
    renderer.currentConfig.organizationId = 'other'; renderer.renderSummary();
    expect(summaryNode.innerHTML).toContain('Opportunity intake evidence unavailable');
    renderer.currentConfig.organizationId = receipt.organization_id; receipt.observations = [null];
    expect(() => renderer.renderSummary()).not.toThrow(); expect(summaryNode.innerHTML).toContain('evidence unavailable');
  } finally { global.window = savedWindow; global.document = savedDocument; }
});
test('router loads the intake helper before every existing report/dashboard consumer', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/js/lex/lex-router.pages.js'), 'utf8');
  expect(source.split("'js/shared/opportunity-intake-presentation.js'")).toHaveLength(4);
  const windows = source.split("'js/shared/acquisition-source-presentation.js'").slice(1);
  for (const part of windows) expect(part.indexOf("'js/shared/opportunity-intake-presentation.js'")).toBeLessThan(100);
});
