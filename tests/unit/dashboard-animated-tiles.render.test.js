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
    + '  window.testExports = { renderMetricCard, loadMetrics, loadDashboardById, readPeriodControls, setBanner, fetchSparkline, renderMetrics, variantPicks, allMetrics: function () { return allDashboardMetrics; }, cardLoads: function () { return cardLoads; } };'
    + source.slice(end + '  init();'.length);
  const nodes = {};
  const document = { addEventListener() {}, getElementById: (id) => (nodes[id] = nodes[id] || node()), querySelector: () => null, querySelectorAll: () => [] };
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

  test('expected cash is a plain currency tile, right now', () => {
    const html = page().exports.renderMetricCard(card('expected_cash_by_week'));
    expect(html).not.toContain('mini-bars');
    expect(text(html)).toContain('$48,250');
    expect(text(html)).toContain('Right now');
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
    expect(text(active.split('dash-card__footer')[1])).toContain('Right now');
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
  });

  test('a group that mixes right-now and period metrics tags the right-now bars', async () => {
    const layout = { cards: [{ id: 'g', kind: 'group', title: 'Mixed', metric_keys: ['case_volume.active_cases_total', 'case_volume.new_cases_opened_total'] }] };
    const p = page({ getBIDashboard: jest.fn().mockResolvedValue({ data: { name: 'X', layout } }),
      getDashboardMetricCards: jest.fn().mockResolvedValue({ data: declared.cards_synthetic }) });
    await p.exports.loadDashboardById('d1');
    expect(text(p.nodes.dashboardMetricGrid.innerHTML)).toContain('(now)');
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
