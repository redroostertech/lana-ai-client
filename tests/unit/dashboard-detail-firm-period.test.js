'use strict';

/**
 * Runs the real Dashboards page script. Dashboard cards are firm metrics:
 * presets pick the firm's days, the card request sends the chosen plain days
 * (the backend bounds them in the firm's zone), and the metric detail link
 * carries the same plain days (the days the person picked), which the metric
 * detail endpoint also bounds in the firm's zone.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function node(value = '') {
  return { value, hidden: false, innerHTML: '', textContent: '', style: {}, options: [], dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] };
}

function page({ storedZone = 'America/Los_Angeles' } = {}) {
  const zone = { firm: storedZone };
  const ensureFirmTimezone = jest.fn(async () => { zone.firm = 'America/Los_Angeles'; });
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/dashboard-detail.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end)
    + '  window.testExports = { selectDashboardPeriodPreset, getMetricCardRequestParams, buildMetricDetailHref, loadMetrics, initPeriodControls };'
    + source.slice(end + '  init();'.length);
  const timeWin = { Date };
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(timeWin);
  const presetCalls = [];
  const realPreset = timeWin.LanaTime.reportPresetDays;
  timeWin.LanaTime.reportPresetDays = (preset, zone) => {
    presetCalls.push([preset, zone]);
    return realPreset(preset, zone, new Date('2026-11-01T05:00:00.000Z'));
  };
  const nodes = {};
  const document = { addEventListener() {}, getElementById: id => (nodes[id] = nodes[id] || node()), createElement: () => node(),
    querySelector: () => null, querySelectorAll: () => [] };
  const view = { period: { start: '2026-10-01T07:00:00.000Z', end: '2026-11-01T06:59:59.999Z', label: 'Oct 1, 2026 - Oct 31, 2026' } };
  const api = { getDashboardMetricCards: jest.fn().mockResolvedValue({ data: [], view, summary: null }),
    getBIDashboards: jest.fn().mockResolvedValue({ data: [] }), ensureFirmTimezone, listBIDashboards: jest.fn().mockResolvedValue({ data: [] }) };
  const window = { location: { search: '' }, setInterval() {}, LanaTime: timeWin.LanaTime };
  const Lex = { Utils: { getFirmTimezone: () => zone.firm, getOrganizationTimezone: () => 'America/New_York' },
    Nav: { getParams: () => new URLSearchParams('') } };
  window.Lex = Lex;
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: timeWin.LanaTime, Lex, api, DashboardTiles: { cardRequestKeys: () => null } });
  return { exports: window.testExports, nodes, api, presetCalls, ensureFirmTimezone };
}

test('a preset picks the firm\'s days and the card request sends them as plain days', async () => {
  const p = page();
  await p.exports.selectDashboardPeriodPreset('thisMonth', false);
  expect(p.presetCalls).toEqual([['thisMonth', 'America/Los_Angeles']]);
  expect([p.nodes.dashboardPeriodStart.value, p.nodes.dashboardPeriodEnd.value]).toEqual(['2026-10-01', '2026-10-31']);
  expect(p.exports.getMetricCardRequestParams('owner', 250)).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-10-31' });
});

test('the metric detail link carries the firm days before the cards load', async () => {
  const p = page();
  // Presets wait for the firm zone (api.ensureFirmTimezone) before picking days.
  await p.exports.selectDashboardPeriodPreset('thisMonth', false);
  const query = new URLSearchParams(p.exports.buildMetricDetailHref('matters_opened').split('?')[1]);
  expect([query.get('periodStart'), query.get('periodEnd')]).toEqual(['2026-10-01', '2026-10-31']);
});

test('after load the link carries the days the person picked, not the window the backend returned', async () => {
  const p = page();
  await p.exports.selectDashboardPeriodPreset('thisMonth', false);
  await p.exports.loadMetrics('owner');
  p.nodes.dashboardPeriodStart.value = '2026-09-03';
  p.nodes.dashboardPeriodEnd.value = '2026-09-20';
  const query = new URLSearchParams(p.exports.buildMetricDetailHref('matters_opened').split('?')[1]);
  expect([query.get('periodStart'), query.get('periodEnd')]).toEqual(['2026-09-03', '2026-09-20']);
});

test('a stored user without firm_timezone refetches the profile before a preset picks days', async () => {
  const p = page({ storedZone: null });
  await p.exports.selectDashboardPeriodPreset('thisMonth', false);
  expect(p.ensureFirmTimezone).toHaveBeenCalledTimes(1);
  expect(p.presetCalls).toEqual([['thisMonth', 'America/Los_Angeles']]);
  expect([p.nodes.dashboardPeriodStart.value, p.nodes.dashboardPeriodEnd.value]).toEqual(['2026-10-01', '2026-10-31']);
});

test('the default preset waits for the profile refetch, so the first card load reads the firm\'s days', async () => {
  const p = page({ storedZone: null });
  const initialPeriod = p.exports.initPeriodControls();
  expect(typeof initialPeriod.then).toBe('function');
  await initialPeriod;
  expect(p.ensureFirmTimezone).toHaveBeenCalledTimes(1);
  expect(p.presetCalls).toEqual([['last7days', 'America/Los_Angeles']]);
});
