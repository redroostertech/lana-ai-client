'use strict';

/**
 * Drilldowns open with the module key the execute response carries and
 * the metric key the visualization declares, never a hard-coded report.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function page() {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end)
    + '  window.testExports = { openGenericDrilldown, showMetricDrilldown, renderFunnelChart,'
    + ' setResult: function (c) { currentModuleConfig = c; selectedModuleKey = null;'
    + ' runPeriodDays = c ? { periodStart: "2026-11-01", periodEnd: "2026-11-15" } : null; } };'
    + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const ids = { periodStart: { value: '2026-11-01' }, periodEnd: { value: '2026-11-15' }, drilldownContent: { innerHTML: '' }, drilldownModal: {} };
  const document = { addEventListener() {}, getElementById: (id) => ids[id] || null, createElement: () => ({ innerHTML: '' }) };
  const timeWin = { Date };
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(timeWin);
  const open = jest.fn().mockResolvedValue();
  const funnel = {};
  const Lex = { Modal: { alert: jest.fn() } };
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: timeWin.LanaTime, Lex,
    api: { user: { organization_id: 'o1' } },
    DrilldownRenderer: function () { this.open = open; },
    FunnelChartRenderer: function (id, data, opts) { funnel.opts = opts; this.render = () => {}; } });
  return { exports: window.testExports, open, funnel, ids, Lex };
}

test('a metric drilldown uses the module key from the execute response', async () => {
  const p = page();
  p.exports.setResult({ moduleKey: 'declared-module' });
  await p.exports.openGenericDrilldown('m1', 'Metric');
  expect(p.open).toHaveBeenCalledWith('declared-module', 'm1', expect.any(Object));
});

test('Details uses the module key from the execute response', async () => {
  const p = page();
  p.exports.setResult({ moduleKey: 'declared-module' });
  await p.exports.showMetricDrilldown('m2', 'Metric');
  expect(p.open).toHaveBeenCalledWith('declared-module', 'm2', expect.any(Object));
});

test('with no report on screen, a drilldown does not guess a report', async () => {
  const p = page();
  p.exports.setResult(null);
  await p.exports.openGenericDrilldown('m1', 'Metric');
  expect(p.open).not.toHaveBeenCalled();
  expect(p.Lex.Modal.alert).toHaveBeenCalled();
});

test('a funnel stage drilldown opens the metric the funnel visualization declares', async () => {
  const p = page();
  p.exports.setResult({ moduleKey: 'declared-module' });
  p.exports.renderFunnelChart({ type: 'funnel_chart', metrics: ['declared_stage_metric'] },
    { metrics: [{ key: 'declared_stage_metric', current: [{ label: 'Intake' }] }] }, 'u1');
  await p.funnel.opts.onStageClick({ label: 'Intake', pipeline_id: 'p1', position: 0 });
  expect(p.open).toHaveBeenCalledWith('declared-module', 'declared_stage_metric', expect.objectContaining({ drill_source: 'Intake' }));
});
