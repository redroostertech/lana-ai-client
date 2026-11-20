'use strict';

/**
 * Runs the real Reports page script. Firm reports use the firm's time zone:
 * presets pick the firm's days, a run sends the chosen plain days (the
 * backend bounds them in the firm's zone), the header names the days the
 * backend labels, and drilldowns ask for the same window.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function node() {
  return { value: '', hidden: false, innerHTML: '', textContent: '', style: {}, loading: false, classList: { add() {}, remove() {} }, querySelectorAll: () => [] };
}

const RESULT = {
  moduleKey: 'matters', moduleName: 'Matters', metrics: [], visualizations: [], dataSources: [],
  period: { type: 'monthly', start: '2026-10-01T07:00:00.000Z', end: '2026-11-01T06:59:59.999Z', startDate: '2026-10-01', endDate: '2026-10-31' },
  priorPeriod: { start: '2026-09-01T07:00:00.000Z', end: '2026-10-01T06:59:59.999Z', startDate: '2026-09-01', endDate: '2026-09-30' }
};

function page({ post = jest.fn().mockResolvedValue(RESULT), get = jest.fn().mockResolvedValue({ data: [] }), storedZone = 'America/Los_Angeles' } = {}) {
  const zone = { firm: storedZone };
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/report.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end)
    + '  window.testExports = { executeModule, selectPeriodPreset, showLeadSourceDrilldown, openGenericDrilldown,'
    + ' showMetricDrilldown, showFunnelStageDrilldown,'
    + ' setModule: function (k) { selectedModuleKey = k; selectedImportedReportId = null; } };'
    + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  window.Lex = { Modal: { alert: jest.fn() }, Utils: { getFirmTimezone: () => zone.firm, getOrganizationTimezone: () => 'America/New_York' } };
  const opened = [];
  window.DrilldownRenderer = function DrilldownRenderer() { this.open = async (...args) => { opened.push(args); }; };
  window.ReportingTables = { loadAllLeads: jest.fn().mockResolvedValue({ rows: [], truncated: false }), mountClientTable() {},
    LEAD_TABLE: { columns: [], labels: {} }, leadRenderers() { return {}; }, leadFilterOptions() { return {}; } };
  const nodes = {};
  const document = { addEventListener() {}, getElementById: (id) => (nodes[id] = nodes[id] || node()), createElement: () => node(),
    querySelector: () => null, querySelectorAll: () => [] };
  const timeWin = { Date };
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(timeWin);
  window.LanaTime = timeWin.LanaTime;
  const presetCalls = [];
  // The profile refetch a stored user without firm_timezone makes (api.ensureFirmTimezone).
  const ensureFirmTimezone = jest.fn(async () => { zone.firm = 'America/Los_Angeles'; });
  const realPreset = timeWin.LanaTime.reportPresetDays;
  timeWin.LanaTime.reportPresetDays = (preset, zone) => {
    presetCalls.push([preset, zone]);
    return realPreset(preset, zone, new Date('2026-11-01T05:00:00.000Z'));
  };
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: timeWin.LanaTime, ReportsList: window.ReportsList, Lex: window.Lex,
    DrilldownRenderer: window.DrilldownRenderer, api: { post, get, user: {}, ensureFirmTimezone } });
  return { exports: window.testExports, nodes, post, presetCalls, opened, tables: window.ReportingTables, ensureFirmTimezone };
}

test('a preset picks the firm\'s days, not the person\'s', async () => {
  const p = page();
  await p.exports.selectPeriodPreset('thisMonth');
  expect(p.presetCalls).toEqual([['thisMonth', 'America/Los_Angeles']]);
  // 05:00Z on Nov 1 is Oct 31 for the Los Angeles firm.
  expect([p.nodes.periodStart.value, p.nodes.periodEnd.value]).toEqual(['2026-10-01', '2026-10-31']);
});

test('a run sends the chosen plain days and the header names the backend\'s days', async () => {
  const p = page();
  p.nodes.periodStart = Object.assign(node(), { value: '2026-10-01' });
  p.nodes.periodEnd = Object.assign(node(), { value: '2026-10-31' });
  p.exports.setModule('matters');
  await p.exports.executeModule();
  expect(p.post).toHaveBeenCalledWith('/api/v1/modules/matters/execute', expect.objectContaining({
    periodStart: '2026-10-01', periodEnd: '2026-10-31' }));
  expect(p.nodes.resultCurrentPeriod.textContent).toBe('Oct 1 - Oct 31, 2026');
  expect(p.nodes.resultPriorPeriod.textContent).toBe('Sep 1 - Sep 30, 2026');
});

test('drilldowns ask for the same firm window', async () => {
  const p = page();
  p.nodes.periodStart = Object.assign(node(), { value: '2026-10-01' });
  p.nodes.periodEnd = Object.assign(node(), { value: '2026-10-31' });
  p.exports.setModule('matters');
  await p.exports.executeModule();
  await p.exports.openGenericDrilldown('opened', 'Opened');
  expect(p.opened[0][2]).toEqual({ periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  await p.exports.showLeadSourceDrilldown('lead_sources', 'Web');
  expect(p.tables.loadAllLeads.mock.calls[0].slice(1)).toEqual(['Web', '2026-10-01T07:00:00.000Z', '2026-11-01T06:59:59.999Z']);
});

test('drilldowns use the days of the run, not date inputs changed after it', async () => {
  const p = page();
  p.nodes.periodStart = Object.assign(node(), { value: '2026-10-01' });
  p.nodes.periodEnd = Object.assign(node(), { value: '2026-10-31' });
  p.exports.setModule('matters');
  await p.exports.executeModule();
  // The person picks new days but does not run the report again.
  p.nodes.periodStart.value = '2026-06-01';
  p.nodes.periodEnd.value = '2026-06-30';
  await p.exports.openGenericDrilldown('opened', 'Opened');
  await p.exports.showMetricDrilldown('opened', 'Opened');
  await p.exports.showFunnelStageDrilldown({ label: 'Lead', pipeline_id: 'p1', position: 0 }, 'funnel');
  expect(p.opened.map(args => [args[2].periodStart, args[2].periodEnd])).toEqual([
    ['2026-10-01', '2026-10-31'], ['2026-10-01', '2026-10-31'], ['2026-10-01', '2026-10-31']]);
});

test('with no run on screen, a drilldown does not read the date inputs', async () => {
  const p = page();
  p.nodes.periodStart = Object.assign(node(), { value: '2026-06-01' });
  p.nodes.periodEnd = Object.assign(node(), { value: '2026-06-30' });
  p.exports.setModule('matters');
  await p.exports.openGenericDrilldown('opened', 'Opened');
  expect(p.opened).toEqual([]);
});

test('a stored user without firm_timezone refetches the profile before a preset picks days', async () => {
  const p = page({ storedZone: null });
  await p.exports.selectPeriodPreset('thisMonth');
  expect(p.ensureFirmTimezone).toHaveBeenCalledTimes(1);
  expect(p.presetCalls).toEqual([['thisMonth', 'America/Los_Angeles']]);
  expect([p.nodes.periodStart.value, p.nodes.periodEnd.value]).toEqual(['2026-10-01', '2026-10-31']);
});
