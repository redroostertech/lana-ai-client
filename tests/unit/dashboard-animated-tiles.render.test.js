'use strict';

/**
 * Renders real dashboard tiles (dashboard-detail.js) from a real owner
 * dashboard response (names redacted), and runs the page's card loading
 * with a mocked API: lists draw bars, goal-less cards wait calmly, snapshot
 * cards say "Right now", every ok tile links to its records with the same
 * dates, and the empty state only shows after a finished request.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');
const { withDashboardScripts } = require('./helpers/dashboard-shared-scripts');
const sample = require(path.join(__dirname, '../fixtures/dashboard/metric-cards-sample.json'));

const cards = sample.dashboard_metric_cards_owner_jan_2026.data;
const card = (suffix) => cards.find((c) => c.metric_key.endsWith(suffix));
const text = (html) => html.split('<').map((part) => part.slice(part.indexOf('>') + 1)).join(' ').split(/\s+/).join(' ').trim();

function node(value = '') {
  const classes = new Set();
  return {
    value, hidden: false, innerHTML: '', textContent: '', dataset: {}, options: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    // The grid "has cards" when its markup has a tile in it.
    querySelector(selector) { return selector === '.dash-metric-card' && this.innerHTML.includes('dash-metric-card') ? {} : null; },
    querySelectorAll: () => [],
  };
}

function page(api = {}) {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/dashboard-detail.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end)
    + '  window.testExports = { renderMetricCard, loadMetrics, readPeriodControls, cardLoads: function () { return cardLoads; } };'
    + source.slice(end + '  init();'.length);
  const nodes = {};
  const document = { addEventListener() {}, getElementById: (id) => (nodes[id] = nodes[id] || node()), querySelector: () => null, querySelectorAll: () => [] };
  const window = withDashboardScripts(withReportSharedScripts({ location: { search: '' }, setInterval() {}, addEventListener() {} }));
  const LanaTime = { nowMs: () => 0, formatUtcDayRange: (a, b) => a + ' to ' + b, reportPresetDays: () => ({ start: '2026-01-01', end: '2026-01-31' }), MS_PER_DAY: 86400000 };
  const Lex = { Utils: { getFirmTimezone: () => 'America/New_York' }, Nav: { getParams: () => new URLSearchParams('') } };
  window.Lex = Lex;
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime, Lex, api: Object.assign({ listBIDashboards: jest.fn().mockResolvedValue({ data: [] }) }, api),
    DashboardTiles: { cardRequestKeys: () => null } });
  window.testExports.readPeriodControls();
  return { exports: window.testExports, nodes };
}

describe('tiles', () => {
  test('a list value draws bars labelled from the rows, never "1 row"', () => {
    const html = page().exports.renderMetricCard(card('new_cases_opened_by_service_offering'));
    expect(html).toContain('mini-bars');
    expect(text(html)).toContain('Estate Planning');
    expect(text(html)).toContain('21');
    expect(text(html)).not.toContain('1 row');
  });

  test('an empty list is a calm card, not an empty chart', () => {
    const html = page().exports.renderMetricCard({ metric_key: 'x.expected_cash_by_week', title: 'Expected Cash by Week', value: [], format: 'table', data_state: 'ok' });
    expect(html).not.toContain('mini-bars');
    expect(text(html)).toContain('Waiting for setup');
  });

  test('a card without its goal waits for the goal and links to the catalog, never $0', () => {
    const html = page().exports.renderMetricCard(card('payroll_gap_month'));
    expect(text(html)).toContain('Waiting for a goal');
    expect(text(html)).toContain('Set the Cash This Month goal in the Metric Catalog.');
    expect(html).toContain('editGoal=core.financial-performance.cash_this_month');
    expect(html).toContain('animation="idle"');
    expect(html).not.toContain('$0');
    expect(text(html)).not.toContain('Not enough data');
  });

  test('snapshot cards say "Right now"; flow cards show the dates', () => {
    expect(text(page().exports.renderMetricCard(card('active_cases_total')))).toContain('Right now');
    const flow = text(page().exports.renderMetricCard(card('average_case_value')));
    expect(flow).not.toContain('Right now');
    expect(flow).toContain('Jan 1, 2026 - Jan 31, 2026');
  });

  test('an ok tile links straight to its source records with the page dates', () => {
    const html = page().exports.renderMetricCard(card('average_case_value'));
    const href = html.split('data-metric-detail-link="')[1].split('"')[0].split('&amp;').join('&');
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(qs.get('metric_key')).toBe('legal_firm.finance.average_case_value');
    expect([qs.get('periodStart'), qs.get('periodEnd'), qs.get('tab')]).toEqual(['2026-01-01', '2026-01-31', 'source']);
    expect(html).toContain('data-sparkline-key="legal_firm.finance.average_case_value"');
  });

  test('a goal draws the ring with the target in the card format, and a met goal plays the check', () => {
    const cash = { metric_key: 'legal_firm.finance.cash_this_month', title: 'Cash This Month', value: 32100, formatted_value: '$32,100', format: 'currency',
      period_scope: 'snapshot', data_state: 'ok',
      goal: { target_value_resolved: 50000, attainment_pct: 64.2, delta_to_target: -17900, status: 'yellow',
        pacing: { elapsed_fraction: 0.77, expected_to_date: 38500, pace_status: 'behind' }, target_type: 'static' } };
    const html = page().exports.renderMetricCard(cash);
    expect(html).toContain('mini-ring--yellow');
    expect(text(html)).toContain('of $50,000');
    expect(text(html)).toContain('Behind');
    expect(html).not.toContain('animation="success"');
    const met = page().exports.renderMetricCard(Object.assign({}, cash, { value: 52000, formatted_value: '$52,000',
      goal: Object.assign({}, cash.goal, { attainment_pct: 104, status: 'green', pacing: null }) }));
    expect(met).toContain('animation="success"');
  });

  test('a goal the server could not measure shows the value and a quiet note, no ring', () => {
    const html = page().exports.renderMetricCard({ metric_key: 'a.b', title: 'Cash', value: 10, formatted_value: '$10', format: 'currency', data_state: 'ok',
      goal: { target_value_resolved: null, attainment_pct: null, status: 'unknown', pacing: null, reason: 'unsupported_rolling_goal' } });
    expect(html).not.toContain('mini-ring');
    expect(text(html)).toContain('$10');
    expect(text(html)).toContain('rolling goal');
  });
});

describe('loading', () => {
  test('no "No metrics" while a request is out, and only the latest answer renders', async () => {
    let resolveFirst;
    let resolveSecond;
    const getDashboardMetricCards = jest.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));
    const p = page({ getDashboardMetricCards });
    const first = p.exports.loadMetrics('owner');
    expect(p.nodes.dashboardMetricEmpty.hidden).toBe(true);
    expect(p.nodes.dashboardMetricGrid.innerHTML).toContain('dash-metric-card--skeleton');
    const second = p.exports.loadMetrics('owner');
    resolveSecond({ data: [card('average_case_value')] });
    await second;
    expect(p.nodes.dashboardMetricGrid.innerHTML).toContain('Average Case Value');
    // The older request answers late with nothing: ignored.
    resolveFirst({ data: [] });
    await first;
    expect(p.nodes.dashboardMetricGrid.innerHTML).toContain('Average Case Value');
    expect(p.nodes.dashboardMetricEmpty.hidden).toBe(true);
  });

  test('a finished request with no cards shows the empty state', async () => {
    const p = page({ getDashboardMetricCards: jest.fn().mockResolvedValue({ data: [] }) });
    await p.exports.loadMetrics('owner');
    expect(p.exports.cardLoads().state).toBe('empty');
    expect(p.nodes.dashboardMetricEmpty.hidden).toBe(false);
  });

  test('new dates keep the current tiles on screen, dimmed, until the answer arrives', async () => {
    let resolveNext;
    const getDashboardMetricCards = jest.fn()
      .mockResolvedValueOnce({ data: [card('average_case_value')] })
      .mockImplementationOnce(() => new Promise((r) => { resolveNext = r; }));
    const p = page({ getDashboardMetricCards });
    await p.exports.loadMetrics('owner');
    const before = p.nodes.dashboardMetricGrid.innerHTML;
    const next = p.exports.loadMetrics('owner');
    expect(p.nodes.dashboardMetricGrid.innerHTML).toBe(before);
    expect(p.nodes.dashboardMetricGrid.classList.contains('dash-card-grid--refreshing')).toBe(true);
    expect(p.nodes.dashboardPeriodLoading.hidden).toBe(false);
    resolveNext({ data: [card('active_cases_total')] });
    await next;
    expect(p.nodes.dashboardMetricGrid.classList.contains('dash-card-grid--refreshing')).toBe(false);
    expect(p.nodes.dashboardMetricGrid.innerHTML).toContain('Total Active Cases');
  });

  test('every card request sends both days', async () => {
    const getDashboardMetricCards = jest.fn().mockResolvedValue({ data: [] });
    const p = page({ getDashboardMetricCards });
    await p.exports.loadMetrics('owner');
    expect(getDashboardMetricCards.mock.calls[0][0]).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-01-31' });
  });
});
