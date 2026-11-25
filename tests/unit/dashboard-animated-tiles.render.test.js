'use strict';

/**
 * Renders real dashboard tiles (dashboard-detail.js) from a real owner
 * dashboard response (names redacted), and runs the page's card loading
 * with a mocked API: lists draw bars, goal-less cards wait calmly, every card
 * shows the picked dates (no "Right now"), every ok tile links to its records with the same
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
    attrs: {}, addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    // The grid "has cards" when its markup has a tile in it.
    querySelector(selector) { return selector === '.dash-metric-card' && this.innerHTML.includes('dash-metric-card') ? {} : null; },
    querySelectorAll: () => [],
  };
}

function page(api = {}, user = null) {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/dashboard-detail.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end)
    + '  window.testExports = { renderMetricCard, loadMetrics, loadDashboardById, readPeriodControls, setBanner, fetchSparkline, renderMetrics, openMetricModal, worklistHtml, drawRows, variantPicks, allMetrics: function () { return allDashboardMetrics; }, cardLoads: function () { return cardLoads; } };'
    + source.slice(end + '  init();'.length);
  const nodes = {};
  const document = { body: node(), addEventListener() {}, getElementById: (id) => (nodes[id] = nodes[id] || node()), querySelector: () => null, querySelectorAll: () => [] };
  const window = withDashboardScripts(withReportSharedScripts({ location: { search: '' }, setInterval() {}, addEventListener() {} }));
  const LanaTime = { nowMs: () => 0, formatUtcDayRange: (a, b) => a + ' to ' + b, reportPresetDays: () => ({ start: '2026-01-01', end: '2026-01-31' }), MS_PER_DAY: 86400000 };
  const Lex = { Utils: { getFirmTimezone: () => 'America/New_York' }, Nav: { getParams: () => new URLSearchParams('') } };
  window.Lex = Lex;
  window.api = { user };
  // The dashboard switcher draws into the shell's title bar, which this test has no DOM for.
  window.TitleSwitcher = { render() {} };
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime, Lex, api: Object.assign({ listBIDashboards: jest.fn().mockResolvedValue({ data: [] }) }, api),
    DashboardTiles: window.DashboardTiles });
  window.testExports.readPeriodControls();
  return { exports: window.testExports, nodes };
}

describe('tiles', () => {
  test('a list value draws columns labelled from the rows, never "1 row"', () => {
    const html = page().exports.renderMetricCard(card('new_cases_opened_by_service_offering'));
    expect(html).toContain('mini-cols');
    expect(text(html)).toContain('Estate Planning');
    expect(text(html)).toContain('21');
    expect(text(html)).not.toContain('1 row');
  });

  test('an empty list is a calm card, not an empty chart', () => {
    const html = page().exports.renderMetricCard(card('gross_revenue_by_service_offering'));
    expect(html).not.toContain('mini-bars');
    expect(text(html)).toContain('Waiting for setup');
  });

  test('currency_breakdown bars are dollars; table bars are plain numbers', () => {
    const revenue = Object.assign({}, card('gross_revenue_by_service_offering'), { value: sample.currency_breakdown_rows_synthetic });
    const money = text(page().exports.renderMetricCard(revenue));
    expect(money).toContain('$84,250');
    expect(money).toContain('$31,001');
    const closed = text(page().exports.renderMetricCard(card('closed_cases_by_service_offering')));
    expect(closed).toContain('Estate Planning: 6');
    expect(closed).not.toContain('$');
  });

  test('actual vs needed before a goal: actual bars only and a quiet note', () => {
    const html = page().exports.renderMetricCard(card('actual_vs_needed_service_offerings'));
    expect(html).toContain('mini-cols');
    expect(html).not.toContain('mini-cols__bar--second');
    expect(text(html)).not.toContain('4 rows');
    expect(text(html)).not.toContain('null');
    expect(text(html)).toContain('Needed counts appear once a goal is set.');
    expect(html).not.toContain('data-data-state-action');
  });

  test('the needed note links to the Metric Catalog when the card says which goal to set', () => {
    const withPrompt = Object.assign({}, card('actual_vs_needed_service_offerings'), {
      goal_input: { metric_key: 'legal_firm.finance.annual_revenue_goal', message: 'Set the goal in the Metric Catalog.' } });
    expect(page().exports.renderMetricCard(withPrompt)).toContain('data-data-state-action="admin/metric-catalog.html?editGoal=legal_firm.finance.annual_revenue_goal"');
  });

  test('expected cash is a plain currency tile with the picked dates', () => {
    const html = page().exports.renderMetricCard(card('expected_cash_by_week'));
    expect(html).not.toContain('mini-bars');
    expect(text(html)).toContain('$48,250');
    expect(text(html)).not.toContain('Right now');
    expect(text(html)).toContain('Jan 1, 2026 - Jan 31, 2026');
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

  test('every card shows the dates, whatever period_scope the server sends (no "Right now")', () => {
    const snapshot = page().exports.renderMetricCard(card('active_cases_total'));
    expect(text(snapshot)).not.toContain('Right now');
    expect(snapshot).not.toContain('period--now');
    expect(text(snapshot)).toContain('Jan 1, 2026 - Jan 31, 2026');
    const flow = text(page().exports.renderMetricCard(card('average_case_value')));
    expect(flow).not.toContain('Right now');
    expect(flow).toContain('Jan 1, 2026 - Jan 31, 2026');
  });

  test('an ok tile links straight to its source records with the page dates', () => {
    const html = page().exports.renderMetricCard(card('average_case_value'));
    const href = html.split('data-metric-detail-link="')[1].split('"')[0].split('&amp;').join('&');
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(qs.get('metric_key')).toBe('legal_firm.finance.average_case_value');
    // Metric detail has no tabs now: the records always show.
    expect([qs.get('periodStart'), qs.get('periodEnd'), qs.get('tab')]).toEqual(['2026-01-01', '2026-01-31', null]);
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

describe('bento layout and header', () => {
  test('the first ok number by server order is the hero; charts span wide; waiting cards come last', async () => {
    const p = page({ getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cards }) });
    await p.exports.loadMetrics('owner');
    const html = p.nodes.dashboardMetricGrid.innerHTML;
    const articles = html.split('<article ').slice(1);
    expect(articles.filter((a) => a.includes('dash-metric-card--hero'))).toHaveLength(1);
    expect(articles[0]).toContain('dash-bento__item--hero');
    expect(articles[0]).toContain('Average Case Value');
    expect(articles.filter((a) => a.includes('dash-bento__item--chart')).length).toBeGreaterThan(0);
    expect(articles[articles.length - 1]).toContain('dash-metric-card--waiting');
  });

  test('pill tabs list All and each group with counts', async () => {
    const p = page({ getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cards }) });
    await p.exports.loadMetrics('owner');
    const tabs = text(p.nodes.dashboardTypeFilters.innerHTML);
    expect(tabs).toContain('All ' + cards.length);
    expect(tabs).toContain('Finance');
    expect(p.nodes.dashboardTypeFilters.innerHTML).toContain('aria-selected="true" data-dashboard-type-filter="all"');
  });

  test('the greeting names the signed-in person, and hides when there is no first name', () => {
    const named = page({}, { first_name: 'Ana' });
    named.exports.setBanner({ title: 'Owner Performance', subtitle: 'x' });
    expect(named.nodes.dashboardGreeting.textContent).toMatch(/^Good (morning|afternoon|evening), Ana$/);
    expect(named.nodes.dashboardGreeting.hidden).toBe(false);
    const nameless = page({}, null);
    nameless.exports.setBanner({ title: 'Owner Performance', subtitle: 'x' });
    expect(nameless.nodes.dashboardGreeting.hidden).toBe(true);
  });

  test('a kpi card shows the delta chip under its number', () => {
    const html = page().exports.renderMetricCard(Object.assign({}, card('average_case_value'), {
      comparison: { previous_value: 5000, absolute_change: 389, percent_change: 7.8, direction: 'up' } }));
    expect(html).toContain('mini-delta mini-delta--up');
    expect(text(html)).toContain('+7.8% vs previous period');
  });
});

describe('when the saved dashboard cannot be read', () => {
  function sharedPage(api) {
    const p = page(Object.assign({ listBIDashboards: jest.fn().mockResolvedValue({ data: [] }) }, api));
    return p;
  }

  test('a 403 on the dashboard still draws the standard cards in the bento, cards as direct grid children', async () => {
    const forbidden = Object.assign(new Error('Permission required: dashboard:read'), { status: 403 });
    const getDashboardMetricCards = jest.fn().mockResolvedValue({ data: cards });
    const p = sharedPage({ getBIDashboard: jest.fn().mockRejectedValue(forbidden), getDashboardMetricCards });
    await p.exports.loadDashboardById('abc');
    const html = p.nodes.dashboardMetricGrid.innerHTML;
    expect(getDashboardMetricCards).toHaveBeenCalledTimes(1);
    expect(html).not.toContain('dash-metric-section');
    // Every top-level element in the grid is a card.
    const topLevel = html.split('<article ').length - 1;
    expect(topLevel).toBe(cards.length);
    expect(html).toContain('dash-metric-card--hero');
    expect(text(p.nodes.dashboardFallbackNote.innerHTML)).toContain('This saved dashboard could not be opened');
    expect(p.nodes.dashboardFallbackNote.hidden).toBe(false);
  });

  test('when the cards fail too, the calm error shows and no empty state', async () => {
    const down = Object.assign(new Error('The server cannot reach its database'), { status: 503 });
    const p = sharedPage({ getBIDashboard: jest.fn().mockRejectedValue(down), getDashboardMetricCards: jest.fn().mockRejectedValue(down) });
    await p.exports.loadDashboardById('abc');
    expect(p.nodes.dashboardMetricGrid.innerHTML).toContain('dash-load-error');
    expect(p.nodes.dashboardMetricEmpty.hidden).toBe(true);
  });

  test('a readable dashboard hides the note', async () => {
    const p = sharedPage({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Mine', layout: { dashboard_type: 'owner', metric_keys: [] } } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cards }) });
    await p.exports.loadDashboardById('abc');
    expect(p.nodes.dashboardFallbackNote.hidden).toBe(true);
  });
});

// The server now accepts raw_limit=0: sparklines ask for the history only.
test('sparklines ask for history only (raw_limit 0), with the page dates', async () => {
  const getMetricDetail = jest.fn().mockResolvedValue({ data: { snapshots: [] } });
  const p = page({ getMetricDetail });
  await p.exports.fetchSparkline({ metricKey: 'a.b', cacheKey: 'a.b|x' });
  expect(getMetricDetail).toHaveBeenCalledWith('a.b', { periodStart: '2026-01-01', periodEnd: '2026-01-31', compareBy: 'monthly', rawLimit: 0 });
});

describe('declared cards (layout.cards from the trim spec)', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));

  async function open(name) {
    const layout = declared.layouts[name];
    const getDashboardMetricCards = jest.fn().mockResolvedValue({ data: declared.cards_synthetic });
    const getMetricDetail = jest.fn().mockResolvedValue({ data: { snapshots: [], raw_data: { rows: declared.worklist_rows_synthetic } } });
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name, layout } }), getDashboardMetricCards, getMetricDetail });
    await p.exports.loadDashboardById('d1');
    return { p, html: p.nodes.dashboardMetricGrid.innerHTML, getDashboardMetricCards };
  }
  const articlesOf = (html) => html.split('<article ').slice(1);
  const linkKeys = (html) => html.split('data-metric-detail-link="').slice(1).map((part) => new URLSearchParams(part.split('"')[0].split('&amp;').join('&').split('?')[1]).get('metric_key'));

  test('Owner Overview: the request sends the full key union; cards follow the declared order', async () => {
    const { html, getDashboardMetricCards } = await open('Owner Overview');
    const keys = getDashboardMetricCards.mock.calls[0][0].metric_keys.split(',');
    expect(keys).toContain('legal_firm.finance.expected_cash_by_month');
    expect(keys.every((k) => k.startsWith('legal_firm.'))).toBe(true);
    const articles = articlesOf(html.split('dash-waiting-strip')[0]);
    expect(articles[0]).toContain('dash-metric-card--hero');
    expect(articles[0]).toContain('Gross Revenue');
    expect(articles.map((a) => (a.split('dash-metric-card__title">')[1] || '').split('<')[0])).toEqual([
      'Gross Revenue', 'Target Revenue', 'Cash This Month', 'Gross Revenue by Service Offering', 'Cash Coming In',
      'Overdue Expected Cash', 'New vs Closed Cases', 'Actual vs Needed Service Offerings', 'Total Active Cases',
    ]);
  });

  test('goal cards: ring from card.goal or from metadata; later metrics as lines, a waiting one as a chip', async () => {
    const { html } = await open('Owner Overview');
    const payroll = articlesOf(html).find((a) => a.includes('Cash This Month'));
    expect(payroll).toContain('mini-ring');
    expect(text(payroll)).toContain('Payroll Gap This Month Waiting for a goal');
    expect(text(payroll)).toContain('Payroll Clients Needed 4');
    expect(linkKeys(payroll)).toEqual(expect.arrayContaining(['legal_firm.finance.payroll_leads_needed', 'legal_firm.finance.payroll_gap_month']));
    // No card.goal here: the ring comes from metadata.attainmentPercent.
    const target = articlesOf(html).find((a) => a.includes('>Target Revenue<'));
    expect(target).toContain('mini-ring--neutral');
    expect(text(target)).toContain('of $150,000');
    expect(text(target)).toContain('Gap to target $31,750');
    expect(text(target)).toContain('Annual Revenue Target Waiting for a goal');
  });

  test('an all-waiting composite goes to the strip; the strip counts it', async () => {
    const { html } = await open('Owner Overview');
    const strip = html.slice(html.indexOf('dash-waiting-strip'));
    expect(text(html)).toContain('1 card is waiting for setup');
    // The composite's title comes from the words its metrics share.
    expect(strip).toContain('>Owner Benefit<');
  });

  test('breakdown variants: a toggle, and a pick swaps the list without a refetch', async () => {
    const { p, html, getDashboardMetricCards } = await open('Owner Overview');
    const cash = articlesOf(html).find((a) => a.includes('Cash Coming In'));
    expect(cash).toContain('data-dashboard-variant="cash_coming_in|0"');
    expect(cash).toContain('aria-pressed="true" data-dashboard-variant="cash_coming_in|0"');
    expect(cash).toContain('Week of Jan 5');
    p.exports.variantPicks.cash_coming_in = 1;
    p.exports.renderMetrics(p.exports.allMetrics(), null, 'owner');
    const after = articlesOf(p.nodes.dashboardMetricGrid.innerHTML).find((a) => a.includes('Cash Coming In'));
    expect(after).toContain('Feb 2026');
    expect(after).not.toContain('Week of Jan 5');
    expect(getDashboardMetricCards).toHaveBeenCalledTimes(1);
  });

  test('group bars: each bar opens its own metric; worklist has a View all and a rows slot', async () => {
    const { html } = await open('Owner Overview');
    const cases = articlesOf(html).find((a) => a.includes('New vs Closed Cases'));
    // Paired columns from the two by-service lists; the totals ride along as chips.
    expect(cases).toContain('mini-cols__bar--second');
    expect(linkKeys(cases)).toEqual(expect.arrayContaining(['legal_firm.case_volume.new_cases_opened_total', 'legal_firm.case_volume.closed_cases_total',
      'legal_firm.case_volume.new_cases_opened_by_service_offering']));
    expect(cases).not.toContain('dash-metric-card__icon-btn');
    const overdue = articlesOf(html).find((a) => a.includes('Overdue Expected Cash'));
    expect(overdue).toContain('data-worklist-key="legal_firm.finance.overdue_expected_cash"');
    expect(text(overdue)).toContain('View all');
  });

  test('Sales & Marketing: funnel with conversions, a waiting source in its slot, and the pair', async () => {
    const { html } = await open('Sales & Marketing');
    const funnel = articlesOf(html).find((a) => a.includes('Intake Funnel'));
    expect(funnel).toContain('mini-group--funnel');
    expect(text(funnel)).toContain('60% of the step before');
    expect(text(funnel)).toContain('38.9% of the step before');
    const leads = articlesOf(html).find((a) => a.includes('Leads by Source'));
    expect(text(leads)).toContain('Review Site Connect a data source');
    const pair = articlesOf(html).find((a) => a.includes('dash-metric-card--pair'));
    expect(text(pair)).toContain('Marketing Spend $6,400');
    expect(text(pair)).toContain('Client Acquisition Cost $305');
    expect(linkKeys(pair)).toEqual(['legal_firm.marketing.marketing_spend', 'legal_firm.marketing.client_acquisition_cost']);
    expect(text(html)).toContain('2 cards are waiting for setup');
  });

  test('a tab or search shows the plain bento of matching metrics', async () => {
    const { p } = await open('Sales & Marketing');
    p.nodes.dashboardMetricSearch.value = 'spend';
    p.exports.renderMetrics(p.exports.allMetrics(), null, 'department');
    const html = p.nodes.dashboardMetricGrid.innerHTML;
    expect(articlesOf(html)).toHaveLength(1);
    expect(html).toContain('Marketing Spend');
  });
});


describe('every visual family renders on the seven consolidated dashboards', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  const Cards = require(path.join(__dirname, '../../src/js/shared/dashboard-cards.js'));
  const Visuals = require(path.join(__dirname, '../../src/js/shared/card-visuals.js'));
  const SIGNATURE = {
    hero: 'dash-metric-card--hero', stat: 'dash-metric-card__value', gauge: 'mini-gauge', ring: 'dash-metric-card--goal',
    bullet: 'mini-bullet', columns: 'mini-cols', ranked_bars: 'mini-rank', paired_columns: 'mini-cols', donut: 'mini-donut',
    stacked_bar: 'mini-stack', funnel: 'mini-group--funnel', compare: 'dash-pair', worklist: 'data-rows-visual="worklist"',
    timeline: 'data-rows-visual="timeline"', aging: 'data-rows-visual="aging"',
  };
  const index = Cards.indexMetrics(declared.cards_synthetic);

  test.each(Object.keys(declared.layouts))('%s', async (name) => {
    const layout = declared.layouts[name];
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name, layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }),
      getMetricDetail: jest.fn().mockResolvedValue({ data: { snapshots: [], raw_data: { rows: [] } } }) });
    await p.exports.loadDashboardById('d1');
    const html = p.nodes.dashboardMetricGrid.innerHTML;
    expect(html).not.toMatch(/undefined|NaN|>null</);
    expect(html).not.toContain('dash-metric-card__eyebrow');
    expect(p.nodes.dashboardTypeFilters.hidden).toBe(true);
    const resolved = Cards.resolveCards(Cards.normalizeLayout(layout).cards, index);
    resolved.filter((r) => r.state !== 'waiting').forEach((r) => {
      let visual = Visuals.visualFor(r.def);
      // A timeline or aging over several counts has no rows to place: its fallback draws instead.
      if ((visual === 'timeline' || visual === 'aging') && r.def.keys.length > 1) visual = r.def.options.fallback || 'columns';
      expect([r.def.id, visual, html.includes(SIGNATURE[visual])]).toEqual([r.def.id, visual, true]);
    });
  });
});

describe('one card shell', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));

  test('every card in the bento has a header and a footer row; the footer carries the period and a records link where one metric stands alone', async () => {
    const layout = declared.layouts['Owner Overview'];
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Owner Overview', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }),
      getMetricDetail: jest.fn().mockResolvedValue({ data: { snapshots: [], raw_data: { rows: [] } } }) });
    await p.exports.loadDashboardById('d1');
    const html = p.nodes.dashboardMetricGrid.innerHTML.split('dash-waiting-strip')[0];
    const articles = html.split('<article ').slice(1);
    articles.forEach((a) => {
      expect(a).toContain('dash-metric-card__top');
      expect(a).toContain('dash-card__footer');
      expect(a.indexOf('dash-metric-card__top')).toBeLessThan(a.indexOf('dash-card__footer'));
    });
    const active = articles.find((a) => a.includes('Total Active Cases'));
    expect(text(active.split('dash-card__footer')[1])).not.toContain('Right now');
    expect(text(active.split('dash-card__footer')[1])).toContain('Jan 1, 2026');
    expect(text(active.split('dash-card__footer')[1])).toContain('See the records');
  });

  test('a waiting headline stays a one-row hero with the calm state', async () => {
    const layout = { cards: [{ id: 'h', kind: 'headline', metric_key: 'finance.missing_total' }, { id: 'n', kind: 'number', metric_key: 'case_volume.active_cases_total' }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    const hero = p.nodes.dashboardMetricGrid.innerHTML.split('<article ')[1];
    expect(hero).toContain('dash-metric-card--hero');
    expect(hero).toContain('lex-data-state--calm');
    expect(hero).not.toContain('dash-bento__item--tall');
    // A calm hero takes its own short row across the grid, not a tall green box.
    expect(hero).toContain('dash-span-4-4');
  });

  test('a group with mixed period_scope gets no "(now)" tags', async () => {
    const layout = { cards: [{ id: 'g', kind: 'group', title: 'Mixed', metric_keys: ['case_volume.active_cases_total', 'case_volume.new_cases_opened_total'] }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    expect(text(p.nodes.dashboardMetricGrid.innerHTML)).not.toContain('(now)');
    expect(text(p.nodes.dashboardMetricGrid.innerHTML)).not.toContain('Right now');
  });
});

describe('server revisions', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  const listCard = { metric_key: 'legal_firm.bonus_compensation.completed_trust_design_meetings_by_attorney', title: 'Trust Design Meetings by Attorney',
    format: 'table', data_state: 'ok', period: 'Jan 1, 2026 - Jan 31, 2026', period_scope: 'flow',
    value: [{ attorney_id: 'a1', attorney_name: 'Avery Stone', value: 4 }, { attorney_id: 'a2', attorney_name: 'Blake Ross', value: 7 }] };

  test('a headline can be a list drawn as ranked bars with initials, on the hero', async () => {
    const layout = { cards: [{ id: 'h', kind: 'headline', metric_key: 'bonus_compensation.completed_trust_design_meetings_by_attorney',
      visual: 'ranked_bars', visual_options: { initials: true } }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Attorney Performance', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic.concat([listCard]) }) });
    await p.exports.loadDashboardById('d1');
    const hero = p.nodes.dashboardMetricGrid.innerHTML.split('<article ')[1];
    expect(hero).toContain('dash-metric-card--hero');
    expect(hero).toContain('mini-rank');
    expect(hero.indexOf('Blake Ross')).toBeLessThan(hero.indexOf('Avery Stone'));
    expect(hero).toContain('>BR<');
  });

  test('visual_options.note shows as a muted line above the footer', async () => {
    const layout = { cards: [{ id: 'n', kind: 'number', metric_key: 'case_volume.active_cases_total', visual_options: { note: 'Closed matters only. Best viewed over This Year.' } }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    const card = p.nodes.dashboardMetricGrid.innerHTML;
    expect(card).toContain('<p class="dash-card__note">Closed matters only. Best viewed over This Year.</p>');
    expect(card.indexOf('dash-card__note')).toBeLessThan(card.indexOf('dash-card__footer'));
  });
});

describe('declared titles and header actions', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  test('a declared title wins on single-metric cards too', async () => {
    const layout = { cards: [{ id: 'h', kind: 'headline', title: 'Open Probate Matters', metric_key: 'case_volume.active_cases_total' },
      { id: 'n', kind: 'number', title: 'Trust Settlement Clients', metric_key: 'case_volume.new_cases_opened_total' }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    const html = p.nodes.dashboardMetricGrid.innerHTML;
    expect(html).toContain('>Open Probate Matters<');
    expect(html).toContain('>Trust Settlement Clients<');
    expect(html).not.toContain('>Total Active Cases<');
  });

  test('the header has Learn More and no Open Reports', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../src/admin/dashboard-detail.html'), 'utf8');
    expect(html).toContain('id="dashboardLearnMoreBtn"');
    expect(html).not.toContain('Open Reports');
    expect(html).not.toContain('dashboardStoryToggle');
  });
});

test('packed rows: the hero and one stat fill four columns; a lone chart spans the row', async () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  const layout = { cards: [{ id: 'h', kind: 'headline', metric_key: 'case_volume.active_cases_total' },
    { id: 'n', kind: 'number', metric_key: 'case_volume.new_cases_opened_total' },
    { id: 'c', kind: 'breakdown', metric_key: 'sales_intake.new_clients_by_service_offering' }] };
  const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
    getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
  await p.exports.loadDashboardById('d1');
  const articles = p.nodes.dashboardMetricGrid.innerHTML.split('<article ').slice(1);
  expect(articles.map((a) => (a.match(/dash-span-4-(\d)/) || [])[1])).toEqual(['3', '1', '4']);
  expect(articles.map((a) => (a.match(/dash-span-2-(\d)/) || [])[1])).toEqual(['2', '2', '2']);
});

describe('the header names the saved dashboard', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));

  test('a readable saved dashboard shows its own name and one-line description', async () => {
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Owner Overview', description: 'How the firm is doing.', layout: { dashboard_type: 'owner', metric_keys: [] } } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    expect(p.nodes.dashboardDetailBanner.attrs).toMatchObject({ heading: 'Owner Overview', subtitle: 'How the firm is doing.' });
  });

  test('when the definition cannot be read, the saved name and description still win over the type view title', async () => {
    const blip = Object.assign(new Error('server cannot reach its database'), { status: 503 });
    const p = page({ getBIDashboard: jest.fn().mockRejectedValue(blip),
      listBIDashboards: jest.fn().mockResolvedValue({ data: [{ id: 'd1', name: 'Owner Overview', description: 'How the firm is doing.' }] }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    expect(p.nodes.dashboardDetailBanner.attrs.heading).toBe('Owner Overview');
    expect(p.nodes.dashboardDetailBanner.attrs.subtitle).toBe('How the firm is doing.');
  });

  test('when nothing names it, the header says Dashboard, never the old type title', async () => {
    const blip = Object.assign(new Error('blip'), { status: 503 });
    const p = page({ getBIDashboard: jest.fn().mockRejectedValue(blip), listBIDashboards: jest.fn().mockResolvedValue({ data: [] }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: [] }) });
    await p.exports.loadDashboardById('d1');
    expect(p.nodes.dashboardDetailBanner.attrs.heading).toBe('Dashboard');
    expect(p.nodes.dashboardDetailBanner.attrs.heading).not.toBe('Owner Performance');
  });
});

describe('How this card works', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  const withLineage = declared.cards_synthetic.map((c) => (c.metric_key.endsWith('marketing_spend') || c.metric_key.endsWith('client_acquisition_cost')
    ? Object.assign({}, c, { lineage: { sources: [{ entity: 'expense', label: 'Expenses' }], formula: { kind: 'sum', plain: 'Adds up marketing expenses.' }, period_rule: 'Expenses dated between your dates.' } })
    : c));
  const full = { sources: [{ entity: 'expense', label: 'Expenses', records_total: 52, records_in_period: 7,
    systems: [{ label: 'QuickBooks', records: 52, last_synced_at: '2020-01-01T00:00:00Z' }] }], formula: { kind: 'sum', plain: 'Adds up marketing expenses.' } };

  async function openPair() {
    const layout = { cards: [{ id: 'p', kind: 'pair', title: 'Spend and Cost', visual: 'compare', metric_keys: ['marketing.marketing_spend', 'marketing.client_acquisition_cost'] }] };
    const getMetricDetail = jest.fn().mockResolvedValue({ data: { snapshots: [], lineage: full } });
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: withLineage }), getMetricDetail });
    await p.exports.loadDashboardById('d1');
    getMetricDetail.mockClear();
    p.exports.openMetricModal('legal_firm.marketing.marketing_spend');
    return { p, getMetricDetail };
  }

  test('a composite card: one sentence on how it is put together, then each metric with its formula, dates and sources', async () => {
    const { p } = await openPair();
    const html = p.nodes.dashboardMetricModalBody.innerHTML;
    expect(p.nodes.dashboardMetricModalTitle.textContent).toBe('Spend and Cost');
    expect(text(html)).toContain('Shows these 2 numbers side by side.');
    expect(text(html)).toContain('Marketing Spend');
    expect(text(html)).toContain('Adds up marketing expenses.');
    expect(text(html)).toContain('Expenses dated between your dates.');
    // The entity (Expenses) leads, from card.lineage or the full lineage.
    expect(text(html).toLowerCase()).toContain('expenses');
    expect(html.split('See full details').length - 1).toBe(2);
    expect(text(html)).not.toContain('legal_firm.');
  });

  test('the full lineage loads only when the panel opens (raw_limit 0), then adds source counts and sync', async () => {
    const { p, getMetricDetail } = await openPair();
    expect(getMetricDetail).toHaveBeenCalledTimes(2);
    expect(getMetricDetail.mock.calls[0][1]).toMatchObject({ rawLimit: 0, periodStart: '2026-01-01', periodEnd: '2026-01-31' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const html = p.nodes.dashboardMetricModalBody.innerHTML;
    expect(text(html)).toContain('52 expenses on file, 7 counted in your dates');
    expect(text(html)).toContain('records of this type, by system: 52 via QuickBooks, last synced Jan 1');
    expect(html).not.toContain('dash-howto__chip">QuickBooks');
  });

  test('no lineage on the card: the panel still explains the card without breaking', async () => {
    const layout = { cards: [{ id: 'g', kind: 'group', title: 'Leads by Source', visual: 'ranked_bars', metric_keys: ['marketing.website_lead_count', 'marketing.referral_lead_count'] }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }),
      getMetricDetail: jest.fn().mockResolvedValue({ data: { lineage: null } }) });
    await p.exports.loadDashboardById('d1');
    p.exports.openMetricModal('legal_firm.marketing.website_lead_count');
    const html = p.nodes.dashboardMetricModalBody.innerHTML;
    expect(text(html)).toContain('Each bar is one number.');
    expect(text(html)).toContain('Website Leads');
    expect(html).not.toMatch(/undefined|null/);
  });
});

describe('breadcrumbs and the way back', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  test('a saved dashboard reads All dashboards / its name, and its records links say where they came from', async () => {
    const layout = { cards: [{ id: 'n', kind: 'number', metric_key: 'case_volume.active_cases_total' }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Owner Overview', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    expect(p.nodes.dashboardDetailBreadcrumb.items).toEqual([
      { label: 'All dashboards', href: 'admin/dashboard-library.html' }, { label: 'Owner Overview' }]);
    const href = p.nodes.dashboardMetricGrid.innerHTML.split('data-metric-detail-link="')[1].split('"')[0].split('&amp;').join('&');
    const qs = new URLSearchParams(href.split('?')[1]);
    expect([qs.get('from'), qs.get('dashboardId')]).toEqual(['dashboard', 'd1']);
  });
});

describe('mappings on dashboard cards', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  test('mapping_coverage adds a caveat with a link; a Not mapped bar links to Mappings; not_mapped is a calm state', async () => {
    const cards = declared.cards_synthetic.map((c) => {
      if (c.metric_key.endsWith('closed_cases_by_service_offering')) {
        return Object.assign({}, c, { mapping_coverage: { mapped: 8, not_mapped: 42 },
          value: c.value.concat([{ service_key: 'not_mapped', service_label: 'Not mapped', value: 42 }]) });
      }
      if (c.metric_key.endsWith('active_cases_total')) return Object.assign({}, c, { value: null, data_state: 'not_mapped', data_state_reason: '' });
      return c;
    });
    const layout = { cards: [{ id: 'b', kind: 'breakdown', metric_key: 'case_volume.closed_cases_by_service_offering' },
      { id: 'n', kind: 'number', metric_key: 'case_volume.active_cases_total' }, { id: 'x', kind: 'number', metric_key: 'case_volume.new_cases_opened_total' }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }), getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cards }) });
    await p.exports.loadDashboardById('d1');
    const html = p.nodes.dashboardMetricGrid.innerHTML;
    expect(text(html)).toContain('42 matters are not mapped to a service yet');
    expect(html).toContain('class="dash-card__caveat"');
    expect(html).toContain('mini-cols__group--muted');
    expect(html).toContain('data-metric-detail-link="settings-v2.html#mappings"');
    expect(text(html)).toContain('1 card is waiting for setup');
    expect(text(html)).toContain('Map your case types to see this number.');
  });
});

test('worklist cells use the shared formatter: money right-aligned, codes as words, dates as days, ids hidden', () => {
  const p = page();
  const html = p.exports.worklistHtml([
    { matter_ref: 'm-1', matter_name: 'Estate', product: 'uncategorized', payment_step: 'payment_2', due_date: '2023-07-18T04:00:00Z', expected_amount: '2750' },
    { matter_ref: 'm-2', matter_name: 'Trust', product: 'trust_based_plan', payment_step: 'payment_1', due_date: '2023-08-01T04:00:00Z', expected_amount: '1250' },
  ]);
  expect(text(html)).toContain('Matter Due Expected amount Product');
  expect(text(html)).toContain('Estate Jul 18, 2023 $2,750 Not mapped');
  expect(html).toContain('<td class="dash-worklist__num">$2,750</td>');
  expect(html).not.toContain('m-1');
  expect(html).not.toContain('uncategorized');
});

describe('server row_columns and caveats on worklists', () => {
  const rows = [{ matter_ref: 'm-1', item_kind: 'invoice', due_date: '2023-07-18T04:00:00Z', expected_amount: '2750', product: 'uncategorized' }];
  const rowColumns = [{ field: 'item_kind', header: 'Kind', labels: { invoice: 'Bill' } }, { field: 'due_date', header: 'Due', format: 'date' },
    { field: 'expected_amount', header: 'Amount due', format: 'currency', align: 'right' }];

  test('the worklist shows exactly the server columns, headers, labels and alignment', () => {
    const html = page().exports.worklistHtml(rows, rowColumns);
    expect(text(html)).toContain('Kind Due Amount due Bill Jul 18, 2023 $2,750');
    expect(html).toContain('<td class="dash-worklist__num">$2,750</td>');
    expect(html).not.toContain('Not mapped');
  });

  test('a worklist card shows its lineage caveat as a short muted note', async () => {
    const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
    const cards = declared.cards_synthetic.map((c) => (c.metric_key.endsWith('overdue_expected_cash')
      ? Object.assign({}, c, { lineage: { sources: [{ label: 'Bills' }], formula: { kind: 'sum', plain: 'x' }, caveats: ['Bills come from your practice system as of its last sync.'] } }) : c));
    const layout = { cards: [{ id: 'w', kind: 'worklist', metric_key: 'finance.overdue_expected_cash' }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }), getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cards }) });
    await p.exports.loadDashboardById('d1');
    expect(p.nodes.dashboardMetricGrid.innerHTML).toContain('<p class="dash-card__note">Bills come from your practice system as of its last sync.</p>');
  });
});

describe('caveat note from metric detail when the card has none', () => {
  function slot(existingNote) {
    const inserted = [];
    const card = { querySelector: (sel) => (sel === '.dash-card__note' && existingNote ? {} : null) };
    const attrs = { 'data-worklist-key': 'k', 'data-rows-visual': 'worklist', 'data-rows-fallback': 'worklist', 'data-rows-sort': '' };
    return { inserted, innerHTML: '', parentNode: card, nextElementSibling: null, classList: { remove() {} },
      getAttribute: (n) => attrs[n], insertAdjacentHTML: (where, html) => inserted.push([where, html]) };
  }
  const rows = [{ matter_name: 'A', due_date: '2023-07-18' }];

  test('adds the first detail caveat after the rows', () => {
    const s = slot(false);
    page().exports.drawRows(s, rows, null, ['Bills come from your practice system as of its last sync.', 'Other']);
    expect(s.inserted).toEqual([['afterend', '<p class="dash-card__note">Bills come from your practice system as of its last sync.</p>']]);
  });

  test('keeps the card note when the card already has one, and adds nothing without caveats', () => {
    const a = slot(true);
    page().exports.drawRows(a, rows, null, ['x']);
    expect(a.inserted).toEqual([]);
    const b = slot(false);
    page().exports.drawRows(b, rows, null, []);
    expect(b.inserted).toEqual([]);
  });
});

describe('the server sends no_goal for cards that need a goal', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  const noGoal = (c, keepInput) => Object.assign({}, c, { data_state: 'no_goal', data_state_reason: 'No goal set. An admin can set one in the Metric Catalog.' },
    keepInput ? {} : { goal_input: undefined });

  test('no_goal without goal_input still waits for a goal and links to the Metric Catalog, never $0', () => {
    const html = page().exports.renderMetricCard(noGoal(card('payroll_gap_month'), false));
    expect(text(html)).toContain('Waiting for a goal');
    expect(text(html)).toContain('No goal set. An admin can set one in the Metric Catalog.');
    expect(html).toContain('admin/metric-catalog.html?editGoal=legal_firm.finance.payroll_gap_month');
    expect(html).not.toContain('$0');
    expect(text(html)).not.toContain('Not enough data');
  });

  test('no_goal with goal_input keeps the goal_input message and link', () => {
    const html = page().exports.renderMetricCard(noGoal(card('payroll_gap_month'), true));
    expect(text(html)).toContain('Set the Cash This Month goal in the Metric Catalog.');
    expect(html).toContain('editGoal=core.financial-performance.cash_this_month');
  });

  test.each([true, false])('composite cards show the muted chip for no_goal slots (goal_input kept: %s)', async (keepInput) => {
    const cardsNoGoal = declared.cards_synthetic.map((c) => (/payroll_gap_month|annual_revenue_target/.test(c.metric_key) ? noGoal(c, keepInput) : c));
    const layout = declared.layouts['Owner Overview'];
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Owner Overview', layout } }), getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cardsNoGoal }),
      getMetricDetail: jest.fn().mockResolvedValue({ data: { snapshots: [] } }) });
    await p.exports.loadDashboardById('d1');
    const articles = p.nodes.dashboardMetricGrid.innerHTML.split('<article ').slice(1);
    const payroll = articles.find((a) => a.includes('Cash This Month'));
    expect(text(payroll)).toContain('Payroll Gap This Month Waiting for a goal');
    expect(payroll).toContain('mini-ring');
    const target = articles.find((a) => a.includes('>Target Revenue<'));
    expect(text(target)).toContain('Annual Revenue Target Waiting for a goal');
    expect(text(payroll + target)).not.toContain('No goal set Waiting');
  });
});

describe('worklists when the server could not read the records', () => {
  const unavailable = { reason: 'no_rows', title: 'Records not available for this card', message: 'This card does not keep a list of records.' };
  function slot(visual, templateHtml) {
    const label = { textContent: 'View all' };
    const card = { querySelector: (sel) => (sel === '.dash-card__records span' ? label : null) };
    const attrs = { 'data-worklist-key': 'k', 'data-rows-visual': visual, 'data-rows-fallback': templateHtml ? 'columns' : 'worklist', 'data-rows-sort': '' };
    const template = templateHtml ? { innerHTML: templateHtml, classList: { contains: (c) => c === 'dash-rows-fallback' } } : null;
    return { label, inserted: [], innerHTML: '', parentNode: card, nextElementSibling: template, classList: { remove() {} },
      getAttribute: (n) => attrs[n], insertAdjacentHTML() {} };
  }

  test('a worklist shows the calm note, no table, no "No records right now", and the link reads See the records', () => {
    const s = slot('worklist');
    page().exports.drawRows(s, [], null, [], unavailable);
    expect(s.innerHTML).toContain('Records not available for this card');
    expect(s.innerHTML).toContain('This card does not keep a list of records.');
    expect(s.innerHTML).not.toContain('<table');
    expect(s.innerHTML).not.toContain('No records right now');
    expect(s.label.textContent).toBe('See the records');
  });

  test('a timeline falls back to its fallback visual, else to the note, never to an empty list', () => {
    const withFallback = slot('timeline', '<div class="mini-chart">fallback</div>');
    page().exports.drawRows(withFallback, [], null, [], unavailable);
    expect(withFallback.innerHTML).toBe('<div class="mini-chart">fallback</div>');
    const without = slot('aging');
    page().exports.drawRows(without, [], null, [], unavailable);
    expect(without.innerHTML).toContain('Records not available for this card');
    expect(without.innerHTML).not.toContain('No records right now');
  });

  test('without rows_status an empty worklist is unchanged', () => {
    const s = slot('worklist');
    page().exports.drawRows(s, [], null, [], null);
    expect(s.innerHTML).toContain('No records right now');
    expect(s.label.textContent).toBe('View all');
  });
});

describe('ok cards whose value is null', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  const nulled = (c) => Object.assign({}, c, { value: null, formatted_value: null, data_state: 'ok', goal: null, comparison: null, metadata: undefined });

  test.each(['currency', 'number', 'percent', 'days'])('a %s card shows the calm state, never 0, $0, NaN or null', (format) => {
    const html = page().exports.renderMetricCard(nulled(Object.assign({}, card('expected_cash_by_week'), { format })));
    const words = text(html);
    expect(words).toContain('No data for these dates');
    ['$0', 'NaN', 'null', ' 0 ', '0%'].forEach((bad) => expect(' ' + words + ' ').not.toContain(bad));
  });

  test('composite slots with null show the muted chip', async () => {
    const cardsNull = declared.cards_synthetic.map((c) => (/payroll_clients_needed|payroll_leads_needed/.test(c.metric_key) ? nulled(c) : c));
    const layout = declared.layouts['Owner Overview'];
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'Owner Overview', layout } }), getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cardsNull }),
      getMetricDetail: jest.fn().mockResolvedValue({ data: { snapshots: [] } }) });
    await p.exports.loadDashboardById('d1');
    const payroll = p.nodes.dashboardMetricGrid.innerHTML.split('<article ').slice(1).find((a) => a.includes('Cash This Month'));
    expect(payroll).toContain('<span class="dash-chip-waiting" title="Nothing was recorded for these dates.">No data for these dates</span>');
    expect(text(payroll)).not.toContain('Payroll Clients Needed 0');
    expect(text(payroll)).not.toContain('NaN');
  });
});

describe('every drilldown link from a declared card carries a full catalog key', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  const keysIn = (html) => html.split('data-metric-detail-link="').slice(1)
    .map((part) => new URLSearchParams(part.split('"')[0].split('&amp;').join('&').split('?')[1]).get('metric_key'));
  const catalogKeys = new Set(declared.cards_synthetic.map((c) => c.metric_key));

  test.each(Object.keys(declared.layouts))('%s', async (name) => {
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name, layout: declared.layouts[name] } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }), getMetricDetail: jest.fn().mockResolvedValue({ data: { snapshots: [] } }) });
    await p.exports.loadDashboardById('d1');
    const keys = keysIn(p.nodes.dashboardMetricGrid.innerHTML);
    expect(keys.length).toBeGreaterThan(0);
    keys.forEach((key) => {
      expect(key.startsWith('legal_firm.')).toBe(true);
      expect(key.split('.').length).toBeGreaterThanOrEqual(3);
    });
  });

  test('a layout key matched by its last part links with the card\'s own catalog key', async () => {
    const metric = Object.assign({}, declared.cards_synthetic.find((c) => c.metric_key.endsWith('overdue_expected_cash')),
      { metric_key: 'legal_firm.bonus_compensation.overdue_expected_cash' });
    const layout = { cards: [{ id: 'g', kind: 'goal', metric_keys: ['finance.overdue_expected_cash', 'finance.cash_this_month'], chips: ['finance.cash_this_month'] }] };
    const cash = Object.assign({}, declared.cards_synthetic.find((c) => c.metric_key.endsWith('cash_this_month')), { metric_key: 'legal_firm.bonus_compensation.cash_this_month' });
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }), getDashboardMetricCards: jest.fn().mockResolvedValue({ data: [metric, cash] }),
      getMetricDetail: jest.fn().mockResolvedValue({ data: { snapshots: [] } }) });
    await p.exports.loadDashboardById('d1');
    const keys = keysIn(p.nodes.dashboardMetricGrid.innerHTML);
    expect(keys).toContain('legal_firm.bonus_compensation.overdue_expected_cash');
    expect(keys).toContain('legal_firm.bonus_compensation.cash_this_month');
    expect(keys).not.toContain('legal_firm.finance.overdue_expected_cash');
    expect(keys).not.toContain('legal_firm.finance.cash_this_month');
  });
});

describe('freshness badge on dashboard cards', () => {
  const stale = { stale: true, as_of: '2026-08-10', systems: ['ActionStep API'], label: 'Data from ActionStep API as of Aug 10, 2026' };
  test('a stale card shows the server label in its footer, next to the period', () => {
    const html = page().exports.renderMetricCard(Object.assign({}, card('average_case_value'), { freshness: stale }));
    const footer = html.split('dash-card__footer')[1];
    expect(footer).toContain('<span class="lex-freshness" title="Data from ActionStep API as of Aug 10, 2026">Data from ActionStep API as of Aug 10, 2026</span>');
  });
  test('fresh or missing freshness shows nothing', () => {
    expect(page().exports.renderMetricCard(Object.assign({}, card('average_case_value'), { freshness: Object.assign({}, stale, { stale: false }) }))).not.toContain('lex-freshness');
    expect(page().exports.renderMetricCard(Object.assign({}, card('average_case_value'), { freshness: null }))).not.toContain('lex-freshness');
  });
});

describe('comparison_hidden on dashboard cards', () => {
  const hidden = { reason: 'insufficient_history', message: 'No comparison yet: this firm has less than a year of history.', as_of: null, systems: [] };
  test('the message replaces the change chip; never 0% or a dash', () => {
    const html = page().exports.renderMetricCard(Object.assign({}, card('average_case_value'), { comparison: null, prior: null, comparison_hidden: hidden }));
    expect(html).toContain('<p class="lex-comparison-hidden">No comparison yet: this firm has less than a year of history.</p>');
    expect(html).not.toContain('mini-delta');
    expect(text(html)).not.toContain('0%');
    expect(text(html)).not.toContain('vs previous period');
  });
});

describe('not_mapped and metadata.mapping_coverage', () => {
  const declared = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));
  test('coverage under metadata (with unlinked) still gives the caveat and link', async () => {
    const cards = declared.cards_synthetic.map((c) => (c.metric_key.endsWith('closed_cases_by_service_offering')
      ? Object.assign({}, c, { metadata: Object.assign({}, c.metadata, { mapping_coverage: { mapped: 8, not_mapped: 42, unlinked: 5 } }) }) : c));
    const layout = { cards: [{ id: 'b', kind: 'breakdown', metric_key: 'case_volume.closed_cases_by_service_offering' }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }), getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cards }) });
    await p.exports.loadDashboardById('d1');
    const html = p.nodes.dashboardMetricGrid.innerHTML;
    expect(text(html)).toContain('42 matters are not mapped to a service yet');
    expect(html).toContain('data-metric-detail-link="settings-v2.html#mappings"');
    expect(text(html)).not.toContain('NaN');
  });
  test('only unlinked records: no caveat and nothing breaks', async () => {
    const cards = declared.cards_synthetic.map((c) => (c.metric_key.endsWith('closed_cases_by_service_offering')
      ? Object.assign({}, c, { metadata: { mapping_coverage: { mapped: 8, not_mapped: 0, unlinked: 5 } } }) : c));
    const layout = { cards: [{ id: 'b', kind: 'breakdown', metric_key: 'case_volume.closed_cases_by_service_offering' }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }), getDashboardMetricCards: jest.fn().mockResolvedValue({ data: cards }) });
    await p.exports.loadDashboardById('d1');
    expect(p.nodes.dashboardMetricGrid.innerHTML).not.toContain('dash-card__caveat');
  });
  test('a not_mapped card shows the server reason in the calm state', () => {
    const html = page().exports.renderMetricCard(Object.assign({}, card('average_case_value'), { value: null, data_state: 'not_mapped',
      data_state_reason: '12 of your matter types are not linked to a LANA service yet, so this number would be incomplete.' }));
    expect(html).toContain('lex-data-state--calm');
    expect(text(html)).toContain('12 of your matter types are not linked to a LANA service yet, so this number would be incomplete.');
  });
});
