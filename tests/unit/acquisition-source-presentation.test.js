'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const helper = require('../../src/js/shared/acquisition-source-presentation');
const sourceRoot = path.join(__dirname, '../../src');
const clone = value => JSON.parse(JSON.stringify(value));
function metric(people = false) {
  const org = '87000000-0000-4000-8000-000000000001', start = '2026-01-01T00:00:00.000Z', end = '2026-02-01T00:00:00.000Z';
  const observations = ['EUR', 'USD'].map((currency, index) => ({ period_start: start, period_end_exclusive: end,
    channel_key: JSON.stringify(['acquisition', org, 'source', '87000000-0000-4000-8000-00000000000' + (index + 2), 'crm', '<Referral>']),
    channel_kind: 'known', label: '<Referral>', person_count: 1, won_count: 1,
    currency_totals: [{ currency, count: 1, amount: index ? '12.00000000000000000002' : '-9007199254740993.0123456789' }] }));
  const receipt = { version: 'acquisition-source-observation-v1', organization_id: org,
    window: { start, end_exclusive: end }, interval: { start, end_exclusive: end }, as_of: end, timezone: 'UTC',
    aggregation: 'whole_window', frequency: null, status: 'complete', declaration_digest: 'a'.repeat(64),
    coverage: { eligible_record_count: 2, person_membership_count: 2, unresolved_record_count: 0, unknown_clock_count: 0,
      unknown_channel_person_count: 0, conflicting_person_count: 0, won_count: 2, covered_won_count: 2,
      unknown_amount_count: 0, unknown_currency_count: 0, unattributed_won_count: 0, duplicate_identity_count: 0 },
    observations, currency_totals: observations.flatMap(row => row.currency_totals) };
  const value = observations.map(row => ({ key: row.channel_key, label: row.label, channel_kind: row.channel_kind,
    currency: people ? null : row.currency_totals[0].currency, count: 1, value: people ? 1 : row.currency_totals[0].amount }));
  const key = people ? helper.PEOPLE : helper.MONEY;
  return { key, metric_key: key, name: 'Sources', title: 'Sources', current: value, value, format: 'distribution', currency: null,
    unit: people ? 'people' : 'currency', aggregation: 'report_window', status: receipt.status,
    metadata: { canonical_metric_key: key, definition_version: 'proven-person-acquisition-whole-window-v1',
      organization_id: org, provenance: 'calculated', observation_receipt: receipt } };
}
function page(file, names) {
  let source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
  const end = source.lastIndexOf('  init();');
  if (end < 0) throw Error('Expected actual page initialization seam');
  source = source.slice(0, end) + `  window.testExports = { ${names} };` + source.slice(end + '  init();'.length);
  const window = { AcquisitionSourcePresentation: helper, addEventListener() {} };
  vm.runInNewContext(source, { window, document: { addEventListener() {}, getElementById: () => null }, console,
    Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: { nowMs: () => 0 } });
  return window.testExports;
}
test('actual dashboard and reporting cards preserve all exact signed currencies and qualified equal labels', () => {
  for (const html of [page('js/admin/dashboard-detail.js', 'renderMetricCard').renderMetricCard(metric()),
    page('js/admin/reporting.js', 'createMetricCard').createMetricCard(metric())]) {
    expect(html).toContain('-9007199254740993.0123456789'); expect(html).toContain('12.00000000000000000002');
    expect(html).toContain('EUR'); expect(html).toContain('USD'); expect(html).toContain('&lt;Referral&gt;');
    expect(html).not.toContain('<Referral>'); expect(html).not.toContain('[object Object]');
    expect(html).toContain('87000000-0000-4000-8000-000000000002');
    expect(html).toContain('87000000-0000-4000-8000-000000000003');
  }
});
test('people are displayed as counts, not money or fabricated marketing ROI', () => {
  const html = helper.renderCard(metric(true));
  expect(html).toContain('<th>People</th>'); expect(html).not.toContain('Won opportunity value');
  expect(html).toContain('not historical attribution or marketing ROI');
});
test.each(['amount', 'currency', 'organization', 'scalar', 'manual', 'calendar', 'duplicate', 'metric'])('mismatched %s evidence is visibly unavailable', mutation => {
  const m = clone(metric());
  if (mutation === 'amount') m.value[0].value = '0';
  if (mutation === 'currency') m.value[0].currency = 'GBP';
  if (mutation === 'organization') m.metadata.organization_id = 'other-org';
  if (mutation === 'scalar') m.value = 42;
  if (mutation === 'manual') m.override = true;
  if (mutation === 'calendar') m.metadata.observation_receipt.aggregation = 'calendar_periods';
  if (mutation === 'duplicate') m.value[1] = m.value[0];
  if (mutation === 'metric') m.key = helper.PEOPLE;
  expect(helper.renderCard(m)).toContain('Acquisition-source evidence unavailable');
});
test('missing is not zero and partial known values remain visible', () => {
  const missing = metric(), receipt = missing.metadata.observation_receipt;
  missing.status = receipt.status = 'missing'; missing.value = missing.current = null;
  receipt.observations = []; receipt.currency_totals = [];
  for (const key of Object.keys(receipt.coverage)) receipt.coverage[key] = 0;
  expect(helper.renderCard(missing)).toContain('missing is not zero');
  const partial = metric(); partial.status = partial.metadata.observation_receipt.status = 'partial';
  partial.metadata.observation_receipt.coverage.eligible_record_count++;
  partial.metadata.observation_receipt.coverage.unresolved_record_count++;
  expect(helper.renderCard(partial)).toContain('Partial coverage');
  expect(helper.renderCard(partial)).toContain('-9007199254740993.0123456789');
});
test('both preview consumers use the same exact source presentation', () => {
  const preview = require('../../src/js/shared/metric-card-preview'), previous = global.AcquisitionSourcePresentation;
  global.AcquisitionSourcePresentation = helper;
  try { for (const render of [preview.renderDashboardPreviewCard, preview.renderReportPreviewCard]) expect(render(metric())).toContain('-9007199254740993.0123456789'); }
  finally { global.AcquisitionSourcePresentation = previous; }
});
test('mixed visualization preserves ordinary sibling settings and never combines source currencies', () => {
  const saved = global.document, container = { querySelectorAll: () => [], appendChild: jest.fn() };
  global.document = { createElement: () => container };
  try {
    const viz = { type: 'bar_chart', metrics: [helper.MONEY, 'ordinary'], chartOptions: { stacked: false } }, sibling = {}, render = jest.fn(() => sibling);
    expect(helper.visualization(viz, { metrics: [metric(), { key: 'ordinary', value: 3 }] }, render, jest.fn())).toBe(container);
    expect(render).toHaveBeenCalledWith({ ...viz, metrics: ['ordinary'] }); expect(container.appendChild).toHaveBeenCalledWith(sibling);
  } finally { global.document = saved; }
});
test('mounted standalone and routed pages load the helper before consumers', () => {
  for (const file of ['admin/dashboard-detail.html', 'admin/reporting.html', 'admin/metric-catalog.html', 'insights/module-execution.html']) {
    const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
    expect(source).toContain('js/shared/acquisition-source-presentation.js');
  }
  const routes = fs.readFileSync(path.join(sourceRoot, 'js/lex/lex-router.pages.js'), 'utf8');
  expect(routes.match(/acquisition-source-presentation\.js/g)).toHaveLength(3);
});
test('ordinary bare custom key keeps its existing rendering contract', () => {
  expect(helper.isAcquisitionSource({ key: 'top_performing_sources' })).toBe(false);
  expect(page('js/admin/dashboard-detail.js', 'renderMetricCard').renderMetricCard({ metric_key: 'custom', value: 7, format: 'number' })).toContain('7');
});
test('actual standalone module card uses the source owner, not its generic array chart', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'insights/module-execution.html'), 'utf8');
  const begin = source.indexOf('    function createMetricCard(metric) {');
  const end = source.indexOf('\n    function ', begin + 1);
  expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
  const context = { window: { AcquisitionSourcePresentation: helper } };
  vm.runInNewContext(source.slice(begin, end), context);
  const html = context.createMetricCard(metric());
  expect(html).toContain('-9007199254740993.0123456789'); expect(html).toContain('USD');
  expect(html).not.toContain('<canvas');
});
test('known source namespace and uncertainty cannot be relabeled as complete', () => {
  const altered = clone(metric()); altered.metadata.observation_receipt.coverage.unknown_amount_count = 1;
  expect(helper.renderCard(altered)).toContain('evidence unavailable');
  const foreign = clone(metric()), key = JSON.parse(foreign.metadata.observation_receipt.observations[0].channel_key);
  key[1] = 'other'; foreign.metadata.observation_receipt.observations[0].channel_key = JSON.stringify(key);
  foreign.value[0].key = foreign.current[0].key = JSON.stringify(key);
  expect(helper.renderCard(foreign)).toContain('evidence unavailable');
});

test('actual drilldown summary preserves whole-report exact currencies and coverage on a filtered partial page', () => {
  const Renderer = require('../../src/js/drilldown-renderer');
  const m = metric(), receipt = m.metadata.observation_receipt;
  const savedDocument = global.document, savedWindow = global.window;
  const summaryNode = {}, container = { classList: { remove: jest.fn(), add: jest.fn() } };
  global.document = { getElementById: id => id === 'drilldown-summary' ? summaryNode : container };
  global.window = { AcquisitionSourcePresentation: helper };
  const renderer = Object.create(Renderer.prototype);
  renderer.currentConfig = { organizationId: receipt.organization_id, periodStart: receipt.window.start,
    periodEnd: receipt.window.end_exclusive, summary: { fields: [{ field: 'won_count', label: 'Won', format: { type: 'number' } }] } };
  renderer.currentData = { status: receipt.status, rows: [{ amount: '12.00000000000000000002', currency: 'USD' }],
    metadata: { canonical_metric_key: helper.MONEY, observation_receipt: receipt },
    summary: { coverage_status: receipt.status, coverage: receipt.coverage, currency_totals: receipt.currency_totals,
      period_start: receipt.window.start, period_end_exclusive: receipt.window.end_exclusive,
      observed_end_exclusive: receipt.interval.end_exclusive, as_of: receipt.as_of, timezone: receipt.timezone,
      applied_filters: { channel_key: receipt.observations[1].channel_key, currency: 'USD' }, observation_receipt: receipt, won_count: 2 } };
  // Generic summary remains a real control, not a mock returning source values.
  summaryNode.querySelectorAll = () => [];
  try {
    renderer.renderSummary();
    expect(summaryNode.innerHTML).toContain('-9007199254740993.0123456789');
    expect(summaryNode.innerHTML).toContain('12.00000000000000000002');
    expect(summaryNode.innerHTML).toContain('EUR'); expect(summaryNode.innerHTML).toContain('USD');
    expect(summaryNode.innerHTML).toContain('Whole-report totals');
    expect(summaryNode.innerHTML).toContain('Unknown amount: 0');
    expect(summaryNode.innerHTML).toContain('Selected currency: USD');
    expect(summaryNode.innerHTML).toContain('&lt;Referral&gt;');
    renderer.currentConfig.organizationId = 'different-org';
    renderer.renderSummary();
    expect(summaryNode.innerHTML).toContain('Acquisition-source evidence unavailable');
    expect(summaryNode.innerHTML).not.toContain('-9007199254740993');
    renderer.currentConfig.organizationId = receipt.organization_id;
    const observations = receipt.observations;
    for (const invalid of [{}, [null]]) {
      receipt.observations = invalid;
      expect(() => renderer.renderSummary()).not.toThrow();
      expect(summaryNode.innerHTML).toContain('Acquisition-source evidence unavailable');
    }
    receipt.observations = observations;
    renderer.renderSummary();
    expect(summaryNode.innerHTML).toContain('-9007199254740993.0123456789');
    renderer.currentData.metadata = { canonical_metric_key: 'custom.top_performing_sources' };
    renderer.renderSummary();
    expect(summaryNode.innerHTML).toContain('Won'); expect(summaryNode.innerHTML).not.toContain('Acquisition-source evidence unavailable');
  } finally { global.document = savedDocument; global.window = savedWindow; }
});
