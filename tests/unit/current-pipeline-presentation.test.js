'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const KEY = 'core.funnel-analysis-attribution.current_pipeline_value';
const sourceRoot = path.join(__dirname, '../../src');
function metric(status = 'complete') {
  const totals = status === 'complete' ? ['AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'USD'].map(currency => ({ currency,
    positive_amount: '0', negative_amount: '-9007199254740993.0123456789', signed_amount: '-9007199254740993.0123456789',
    positive_count: 0, negative_count: 1, zero_count: 0 })) : [];
  const receipt = { version: 'current-pipeline-observation-v2', metric_key: 'current_pipeline_value',
    definition_version: 'current-open-active-opportunity-stock-evidence-v1', organization_id: '94000000-0000-4000-8000-000000000001',
    as_of: '2026-10-01T12:00:00.000Z', timezone: 'UTC', aggregation: 'current_snapshot', status,
    coverage: { admitted_record_count: totals.length || (status === 'partial' ? 1 : 0),
      eligible_opportunity_count: totals.length || (status === 'partial' ? 1 : 0), covered_opportunity_count: totals.length,
      unknown_identity_count: 0, duplicate_identity_count: 0, unknown_status_count: 0,
      unknown_amount_count: status === 'partial' ? 1 : 0, unknown_currency_count: 0 },
    currency_totals: totals, conservation_verified: true };
  const value = totals.map(row => ({ key: row.currency, label: row.currency, currency: row.currency, value: row.signed_amount,
    positive_amount: row.positive_amount, negative_amount: row.negative_amount,
    positive_count: row.positive_count, negative_count: row.negative_count, zero_count: row.zero_count }));
  return { key: KEY, metric_key: KEY, title: 'Pipeline', name: 'Pipeline', value, current: value, format: 'distribution',
    unit: 'currency', aggregation: 'current_snapshot', status, metadata: { observation_receipt: receipt,
      definition_version: receipt.definition_version, organization_id: receipt.organization_id, canonical_metric_key: KEY, provenance: 'calculated' } };
}
function helper() {
  const file = path.join(sourceRoot, 'js/shared/current-pipeline-presentation.js');
  return fs.existsSync(file) ? require(file) : undefined;
}
function page(file, names) {
  let source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
  const end = source.lastIndexOf('  init();');
  if (end < 0) throw Error('Expected real page initialization seam');
  source = source.slice(0, end) + `  window.testExports = { ${names} };` + source.slice(end + '  init();'.length);
  const window = { CurrentPipelinePresentation: helper(), addEventListener() {} };
  const context = { window, document: { addEventListener() {}, getElementById: () => null }, console,
    CurrentPipelinePresentation: helper(), Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn(),
    LanaTime: { nowMs: () => 0 } };
  vm.runInNewContext(source, context);
  return window.testExports;
}
test('actual dashboard and reporting cards keep all currency rows and exact signed strings', () => {
  const m = metric();
  const outputs = [page('js/admin/dashboard-detail.js', 'renderMetricCard').renderMetricCard(m),
    page('js/admin/reporting.js', 'createMetricCard').createMetricCard(m)];
  for (const html of outputs) {
    for (const row of m.value) expect(html).toContain(row.currency);
    expect(html).toContain('-9007199254740993.0123456789'); expect(html).toContain('Current stock');
    expect(html).toContain(m.metadata.observation_receipt.as_of); expect(html).not.toContain('Total Leads');
    expect(html).not.toContain('$'); expect(html).not.toContain('[object Object]');
  }
});
test.each(['empty', 'partial'])('actual dashboard %s does not turn an empty distribution into a scalar', status => {
  const html = page('js/admin/dashboard-detail.js', 'renderMetricCard').renderMetricCard(metric(status));
  expect(html).toContain(status === 'empty' ? 'No open or active opportunities' : 'Partial coverage');
  expect(html).not.toContain('Current period');
});
test('unrelated scalar dashboard preserves its legacy formatting', () => {
  const html = page('js/admin/dashboard-detail.js', 'renderMetricCard').renderMetricCard({ metric_key: 'custom', value: 7, format: 'number' });
  expect(html).toContain('7'); expect(html).not.toContain('Current stock');
});
test.each(['amount', 'receipt', 'manual', 'currency', 'coverage', 'null_child'])('governed %s mismatch is visibly unverified', defect => {
  const m = metric();
  if (defect === 'amount') m.value[0].value = '999';
  if (defect === 'receipt') delete m.metadata.observation_receipt;
  if (defect === 'manual') m.override = true;
  if (defect === 'currency') m.value[0].currency = 'USD';
  if (defect === 'coverage') m.metadata.observation_receipt.coverage = {};
  if (defect === 'null_child') m.metadata.observation_receipt.currency_totals[0] = null;
  const html = page('js/admin/dashboard-detail.js', 'renderMetricCard').renderMetricCard(m);
  expect(html).toContain('Current pipeline evidence unavailable'); expect(html).not.toContain('-9007199254740993');
});
test('mixed chart delegates the ordinary sibling with unchanged chart configuration', () => {
  const container = { querySelectorAll: () => [], appendChild: jest.fn() };
  const savedDocument = global.document;
  global.document = { createElement: () => container };
  try {
    const sibling = { key: 'ordinary', current: 7 }, ordinaryChart = {};
    const render = jest.fn(() => ordinaryChart), viz = { type: 'bar_chart', metrics: [KEY, 'ordinary'], chartOptions: { stacked: false } };
    expect(helper().visualization(viz, { metrics: [metric(), sibling] }, render, jest.fn())).toBe(container);
    expect(container.innerHTML).toContain('-9007199254740993.0123456789');
    expect(render).toHaveBeenCalledWith({ ...viz, metrics: ['ordinary'] });
    expect(container.appendChild).toHaveBeenCalledWith(ordinaryChart);
  } finally { global.document = savedDocument; }
});
test('both actual preview cards use the typed distribution and keep legacy detail options intact', () => {
  const preview = require('../../src/js/shared/metric-card-preview');
  const saved = global.CurrentPipelinePresentation; global.CurrentPipelinePresentation = helper();
  try {
    for (const render of [preview.renderDashboardPreviewCard, preview.renderReportPreviewCard]) {
      expect(render(metric())).toContain('-9007199254740993.0123456789');
    }
    const legacy = { periodStart: '2026-01-01', compareToPrevious: true };
    expect(helper().detailOptions(metric(), legacy)).toEqual({});
    expect(helper().detailOptions({ key: 'custom' }, legacy)).toBe(legacy);
  } finally { global.CurrentPipelinePresentation = saved; }
});
test('standalone and routed page mounts load the typed helper before its consumers', () => {
  for (const file of ['admin/dashboard-detail.html', 'admin/reporting.html', 'admin/metric-catalog.html', 'insights/module-execution.html']) {
    const text = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
    expect(text).toContain('js/shared/current-pipeline-presentation.js');
  }
  const routes = fs.readFileSync(path.join(sourceRoot, 'js/lex/lex-router.pages.js'), 'utf8');
  expect(routes.match(/current-pipeline-presentation\.js/g)).toHaveLength(3);
});
test('partial known currency amounts remain visible and hostile metadata stays escaped', () => {
  const m = metric(); m.status = m.metadata.observation_receipt.status = 'partial';
  m.metadata.observation_receipt.coverage.admitted_record_count += 1;
  m.metadata.observation_receipt.coverage.unknown_status_count = 1;
  m.metadata.observation_receipt.timezone = '<img src=x onerror=bad()>';
  const html = helper().renderCard(m);
  expect(html).toContain('Partial coverage'); expect(html).toContain('-9007199254740993.0123456789');
  expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
});
