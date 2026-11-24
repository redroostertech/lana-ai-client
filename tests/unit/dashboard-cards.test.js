'use strict';

/**
 * Declared dashboard cards (layout.cards, the approved trim spec): key
 * normalisation, falling back to layout.metric_keys, sizes by kind, variant
 * switching, group and funnel mapping, and the waiting rollup.
 */

const path = require('path');
const Cards = require(path.join(__dirname, '../../src/js/shared/dashboard-cards.js'));
const fixture = require(path.join(__dirname, '../fixtures/dashboard/declared-layouts.json'));

const owner = fixture.layouts['Owner Overview'];
const sales = fixture.layouts['Sales & Marketing'];
const index = Cards.indexMetrics(fixture.cards_synthetic);

describe('normalizeKey', () => {
  test('adds the legal_firm. prefix to a two-part spec key, once', () => {
    expect(Cards.normalizeKey('finance.cash_this_month')).toBe('legal_firm.finance.cash_this_month');
    expect(Cards.normalizeKey('legal_firm.finance.cash_this_month')).toBe('legal_firm.finance.cash_this_month');
    expect(Cards.normalizeKey('core.financial-performance.cash_this_month')).toBe('core.financial-performance.cash_this_month');
    expect(Cards.normalizeKey(' ')).toBe('');
    expect(Cards.normalizeKey(null)).toBe('');
  });
});

describe('normalizeLayout', () => {
  test('declared cards come back in order with full keys', () => {
    const layout = Cards.normalizeLayout(owner);
    expect(layout.mode).toBe('cards');
    expect(layout.cards.map((c) => c.kind)).toEqual(['headline', 'breakdown', 'goal', 'goal', 'goal', 'breakdown', 'worklist', 'group', 'breakdown', 'number']);
    expect(layout.cards[0]).toMatchObject({ id: 'revenue', keys: ['legal_firm.finance.gross_revenue_total'] });
    expect(layout.cards[5].variants).toEqual([
      { label: 'Next 8 weeks', key: 'legal_firm.finance.expected_cash_by_week' },
      { label: 'Next 6 months', key: 'legal_firm.finance.expected_cash_by_month' },
    ]);
  });

  test('without layout.cards the saved metric_keys are used as before', () => {
    expect(Cards.normalizeLayout({ metric_keys: ['a.b', 'legal_firm.c.d'] })).toEqual({ mode: 'keys', cards: [] });
    expect(Cards.normalizeLayout({})).toEqual({ mode: 'keys', cards: [] });
    expect(Cards.normalizeLayout(null)).toEqual({ mode: 'keys', cards: [] });
  });

  test('cards with no keys or an unknown kind are dropped, not guessed', () => {
    const layout = Cards.normalizeLayout({ cards: [{ id: 'x', kind: 'number' }, { id: 'y', kind: 'sparkle', metric_key: 'a.b' }, { id: 'z', kind: 'number', metric_key: 'a.b' }] });
    expect(layout.cards.map((c) => c.id)).toEqual(['z']);
  });

  test('an empty cards list falls back to metric_keys', () => {
    expect(Cards.normalizeLayout({ cards: [], metric_keys: ['a.b'] }).mode).toBe('keys');
  });
});

describe('requestKeys', () => {
  test('the flat union of metric_keys and every card key, variants included, with full keys', () => {
    const keys = Cards.requestKeys(sales);
    expect(keys).toContain('legal_firm.sales_intake.yearly_new_clients_by_service_offering');
    expect(keys).toContain('legal_firm.marketing.client_acquisition_cost');
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith('legal_firm.'))).toBe(true);
  });
  test('an old layout sends its metric_keys', () => {
    expect(Cards.requestKeys({ metric_keys: ['legal_firm.a.b', 'legal_firm.a.b', 'c.d'] })).toEqual(['legal_firm.a.b', 'legal_firm.c.d']);
  });
});

describe('metricFor', () => {
  test('finds a card by full key, or by its last part as older layouts did', () => {
    expect(Cards.metricFor(index, 'legal_firm.finance.cash_this_month').title).toBe('Cash This Month');
    const short = Cards.indexMetrics([{ metric_key: 'cash_this_month', title: 'Short' }]);
    expect(Cards.metricFor(short, 'legal_firm.finance.cash_this_month').title).toBe('Short');
    expect(Cards.metricFor(index, 'legal_firm.nope.nothing')).toBe(null);
  });
});

describe('sizes by kind', () => {
  test.each([
    ['headline', 'hero', 2], ['number', 'kpi', 1], ['goal', 'kpi', 1], ['pair', 'wide', 2],
    ['breakdown', 'chart', 2], ['group', 'chart', 2], ['worklist', 'chart', 2],
  ])('%s is %s, span %d', (kind, role, span) => {
    expect(Cards.sizeFor(kind)).toEqual({ role, span });
  });
});

describe('variants', () => {
  const card = Cards.normalizeLayout(sales).cards.find((c) => c.id === 'new_clients_by_service');
  test('the default is the card metric_key', () => {
    expect(Cards.activeVariant(card, undefined)).toEqual({ index: 1, key: 'legal_firm.sales_intake.new_clients_by_service_offering' });
  });
  test('a picked variant swaps the key, an out-of-range pick keeps the default', () => {
    expect(Cards.activeVariant(card, 3).key).toBe('legal_firm.sales_intake.yearly_new_clients_by_service_offering');
    expect(Cards.activeVariant(card, 9).index).toBe(1);
  });
  test('a card without variants uses its own key', () => {
    expect(Cards.activeVariant({ keys: ['legal_firm.a.b'], variants: [] }, 2)).toEqual({ index: -1, key: 'legal_firm.a.b' });
  });
});

describe('groupRows', () => {
  test('bars: one row per metric, labelled with its title; a waiting metric keeps its slot', () => {
    const card = Cards.normalizeLayout(sales).cards.find((c) => c.id === 'leads_by_source');
    const rows = Cards.groupRows(card, index);
    expect(rows.map((r) => [r.label, r.value, r.waiting])).toEqual([
      ['Website Leads', 64, false], ['Referral Leads', 38, false], ['Review Site Leads', null, true],
    ]);
    expect(rows.map((r) => r.pct)).toEqual([100, 59.4, 0]);
    expect(rows[0].key).toBe('legal_firm.marketing.website_lead_count');
  });

  test('funnel: steps keep their order and carry the step-to-step conversion', () => {
    const card = Cards.normalizeLayout(sales).cards.find((c) => c.id === 'funnel');
    const rows = Cards.groupRows(card, index);
    expect(rows.map((r) => r.value)).toEqual([120, 72, 54, 21]);
    expect(rows.map((r) => r.conversionPct)).toEqual([null, 60, 75, 38.9]);
  });

  test('a conversion from zero or a waiting step is not shown', () => {
    const rows = Cards.groupRows({ chart: 'funnel', keys: ['k.a', 'k.b', 'k.c'] }, Cards.indexMetrics([
      { metric_key: 'legal_firm.k.a', title: 'A', value: 0, data_state: 'ok' },
      { metric_key: 'legal_firm.k.b', title: 'B', value: 5, data_state: 'ok' },
      { metric_key: 'legal_firm.k.c', title: 'C', value: null, data_state: 'insufficient_data' },
    ]));
    expect(rows.map((r) => r.conversionPct)).toEqual([null, null, null]);
  });
});

describe('resolve and the waiting rollup', () => {
  const resolved = Cards.resolveCards(Cards.normalizeLayout(owner).cards, index);

  test('a composite with some waiting metrics stays a card; all waiting becomes one waiting card', () => {
    const payroll = resolved.find((r) => r.def.id === 'payroll');
    expect(payroll.state).toBe('mixed');
    expect(payroll.metrics.map((m) => m.waiting)).toEqual([false, true, false, false]);
    const benefit = resolved.find((r) => r.def.id === 'owner_benefit');
    expect(benefit.state).toBe('waiting');
  });

  test('a metric missing from the response counts as waiting', () => {
    const r = Cards.resolveCards([{ id: 'x', kind: 'number', keys: ['legal_firm.not.there'], variants: [] }], index);
    expect(r[0].state).toBe('waiting');
    expect(r[0].metrics[0]).toMatchObject({ key: 'legal_firm.not.there', metric: null, waiting: true });
  });

  test('waiting cards are pulled out for the strip; the rest keep their order and sizes', () => {
    const { items, waiting } = Cards.planDeclared(resolved);
    expect(waiting.map((r) => r.def.id)).toEqual(['owner_benefit']);
    // The two compact cards after the hero move up beside it, so the hero's
    // row stays short; everything else keeps the declared order.
    expect(items.map((i) => [i.resolved.def.id, i.role, i.span])).toEqual([
      ['revenue', 'hero', 2], ['revenue_target', 'kpi', 1], ['payroll', 'kpi', 1], ['revenue_by_service', 'chart', 2],
      ['cash_coming_in', 'chart', 2], ['overdue_cash', 'chart', 2], ['cases_by_service', 'chart', 2],
      ['actual_vs_needed', 'chart', 2], ['active_cases', 'kpi', 1],
    ]);
  });

  test('splitWaiting pulls stand-alone waiting cards out of an older layout too', () => {
    const { shown, waiting } = Cards.splitWaiting([{ data_state: 'ok' }, { data_state: 'insufficient_data' }, { data_state: 'ok' }]);
    expect(shown).toHaveLength(2);
    expect(waiting).toHaveLength(1);
  });
});

describe('goalFor: the ring comes from card.goal, else from metadata with attainmentPercent', () => {
  test('card.goal wins', () => {
    const g = Cards.goalFor(Cards.metricFor(index, 'legal_firm.finance.cash_this_month'));
    expect(g).toMatchObject({ source: 'goal', progress: { available: true, fillPct: 64.2, target: 50000 } });
    expect(g.details).toEqual([]);
  });

  test('metadata attainmentPercent draws the ring, with target and gap as details', () => {
    const metric = { metric_key: 'legal_firm.x.y', value: 118250, format: 'currency', data_state: 'ok', goal: null,
      metadata: { target: 150000, attainmentPercent: 78.83, revenueGap: 31750 } };
    const g = Cards.goalFor(metric);
    expect(g.source).toBe('metadata');
    expect(g.progress).toMatchObject({ available: true, fillPct: 78.8, attainmentLabel: '79%', target: 150000, band: 'neutral', statusLabel: 'Toward the target' });
    expect(g.details).toEqual([{ label: 'Target', value: 150000 }, { label: 'Gap to target', value: 31750 }]);
  });

  test('a metadata ring over 100 is met; a waiting metric or no goal gives none', () => {
    expect(Cards.goalFor({ data_state: 'ok', metadata: { target: 10, attainmentPercent: 120 } }).progress).toMatchObject({ fillPct: 100, met: true, band: 'green' });
    expect(Cards.goalFor({ data_state: 'ok', value: 3, goal: null, metadata: {} })).toBe(null);
    expect(Cards.goalFor({ data_state: 'insufficient_data', goal_input: { message: 'Set it.' } })).toBe(null);
    expect(Cards.goalFor(null)).toBe(null);
  });
});

test('a no_data_source metric counts as waiting in composites and the rollup', () => {
  const idx = Cards.indexMetrics([{ metric_key: 'legal_firm.a.b', data_state: 'no_data_source', data_state_reason: 'Connect the app that holds this data to see this number.' }]);
  const r = Cards.resolveCards([{ id: 'n', kind: 'number', keys: ['legal_firm.a.b'], variants: [] }], idx);
  expect(r[0].state).toBe('waiting');
  expect(Cards.splitWaiting([{ data_state: 'no_data_source' }]).waiting).toHaveLength(1);
});

describe('worklistColumns', () => {
  test('up to four readable columns: ids and access flags left out, empty columns dropped', () => {
    const rows = fixture.worklist_rows_synthetic;
    expect(Cards.worklistColumns(rows)).toEqual(['matter_name', 'status', 'due_date', 'amount']);
    expect(Cards.worklistColumns([{ id: 1, request_access: null, opened_at: '2026-01-01', note: '' }])).toEqual(['opened_at']);
    expect(Cards.worklistColumns([])).toEqual([]);
  });
  test('date columns are named *_at, *_date or date', () => {
    expect(['opened_at', 'due_date', 'date', 'status'].map(Cards.isDateColumn)).toEqual([true, true, true, false]);
  });
});

describe('compositeTitle', () => {
  const m = (title) => ({ metric: { title } });
  test('the declared title wins', () => {
    expect(Cards.compositeTitle({ title: 'Leads by Source' }, [m('Website Leads')])).toBe('Leads by Source');
  });
  test('otherwise the words the metric titles share, plural kept', () => {
    expect(Cards.compositeTitle({}, [m('Medicaid Case Count'), m('Medicaid Cases Won')])).toBe('Medicaid Cases');
    expect(Cards.compositeTitle({}, [m('Payment Plan Client Count'), m('Payment Plan Balance Owed')])).toBe('Payment Plan');
  });
  test('nothing shared, or a single metric, falls back to the first title', () => {
    expect(Cards.compositeTitle({}, [m('Marketing Spend'), m('Client Acquisition Cost')])).toBe('Marketing Spend');
    expect(Cards.compositeTitle({}, [m('Total Active Cases')])).toBe('Total Active Cases');
    expect(Cards.compositeTitle({}, [{ metric: null, key: 'legal_firm.a.website_lead_count' }])).toBe('Website lead count');
  });
});

describe('visual options on declared cards', () => {
  const raw = { cards: [{ id: 'cases', kind: 'group', metric_keys: ['case_volume.new_total', 'case_volume.closed_total'], visual: 'paired_columns',
    metric_keys_override: ['case_volume.new_by_service', 'case_volume.closed_by_service'], series_labels: ['New', 'Closed'], accent: 'danger',
    chips: ['finance.x'], detail: ['finance.net_revenue'], centre_key: 'finance.total', badge_key: 'finance.month', relation: 'per new client', ratio_bar: true }] };

  test('options are kept with full keys', () => {
    const card = Cards.normalizeLayout(raw).cards[0];
    expect(card.visual).toBe('paired_columns');
    expect(card.options).toMatchObject({
      metric_keys_override: ['legal_firm.case_volume.new_by_service', 'legal_firm.case_volume.closed_by_service'],
      series_labels: ['New', 'Closed'], accent: 'danger', chips: ['legal_firm.finance.x'], detail: ['legal_firm.finance.net_revenue'],
      centre_key: 'legal_firm.finance.total', badge_key: 'legal_firm.finance.month', relation: 'per new client', ratio_bar: true,
    });
  });

  test('keys named by options are requested too', () => {
    const keys = Cards.requestKeys(raw);
    ['legal_firm.case_volume.new_by_service', 'legal_firm.finance.x', 'legal_firm.finance.net_revenue', 'legal_firm.finance.total', 'legal_firm.finance.month']
      .forEach((key) => expect(keys).toContain(key));
  });

  test('an unknown accent is dropped', () => {
    expect(Cards.normalizeLayout({ cards: [{ id: 'a', kind: 'number', metric_key: 'a.b', accent: 'purple' }] }).cards[0].options.accent).toBe(null);
  });
});

test('with no compact cards to pull up, the order is unchanged', () => {
  const plan = Cards.planDeclared([
    { def: { id: 'h', kind: 'headline' }, state: 'ok' }, { def: { id: 'c', kind: 'breakdown' }, state: 'ok' }, { def: { id: 'w', kind: 'worklist' }, state: 'ok' },
  ]);
  expect(plan.items.map((i) => i.resolved.def.id)).toEqual(['h', 'c', 'w']);
});

test('only one compact card is pulled up when only one exists', () => {
  const plan = Cards.planDeclared([
    { def: { id: 'h', kind: 'headline' }, state: 'ok' }, { def: { id: 'c', kind: 'breakdown' }, state: 'ok' }, { def: { id: 'n', kind: 'number' }, state: 'ok' },
  ]);
  expect(plan.items.map((i) => i.resolved.def.id)).toEqual(['h', 'n', 'c']);
});
