'use strict';

/**
 * Lineage view model (pure): how a number is worked out, in plain words.
 * metric-detail data.lineage -> the "Data used" section; card.lineage and
 * the card's shape -> the "How this card works" panel.
 */

const path = require('path');
const L = require(path.join(__dirname, '../../src/js/shared/lineage-view.js'));

const NOW = Date.parse('2026-11-24T12:00:00Z');
const conversion = {
  sources: [
    { entity: 'lead', label: 'Leads', records_total: 1204, records_in_period: 36,
      systems: [{ label: 'Leadly', records: 1180, last_synced_at: '2026-11-24T09:00:00Z' }, { label: 'LANA', records: 24, last_synced_at: null }],
      last_synced_at: '2026-11-24T09:00:00Z' },
    { entity: 'matter', label: 'Matters', records_total: 916, records_in_period: null,
      systems: [{ label: 'ActionStep', records: 916, last_synced_at: '2026-08-10T15:00:00Z' }], last_synced_at: '2026-08-10T15:00:00Z' },
  ],
  fields: [
    { entity: 'lead', field: 'created_at', label: 'Date created', role: 'date filter' },
    { entity: 'matter', field: 'practice_area', label: 'Practice area', role: 'filter' },
    { entity: 'matter', field: 'service_offering', label: 'Service offering', role: 'group by' },
    { entity: 'matter', field: 'fee', label: 'Fee', role: 'value' },
  ],
  filters: [{ label: 'Estate planning only', detail: 'Practice area is Estate Planning' }],
  formula: { kind: 'ratio', plain: 'Converted clients divided by potential new clients.', expression: 'count(converted) / count(pnc)' },
  period_rule: 'Counts leads created between your dates.',
  inputs: [
    { metric_key: 'legal_firm.sales_intake.pnc_converted_count', title: 'Converted clients', role: 'numerator' },
    { metric_key: 'legal_firm.sales_intake.pnc_count', title: 'Potential new clients', role: 'denominator' },
  ],
  goal_source: { metric_key: 'legal_firm.sales_intake.monthly_target', set: false },
  caveats: ['Leads without a source are left out.'],
};

describe('detailModel', () => {
  test('null lineage draws nothing', () => {
    expect(L.detailModel(null, NOW)).toBe(null);
    expect(L.detailModel(undefined, NOW)).toBe(null);
  });

  test('the calculation in words and a ratio as an equation of its inputs', () => {
    const m = L.detailModel(conversion, NOW);
    expect(m.formula).toBe('Converted clients divided by potential new clients.');
    expect(m.equation).toEqual([
      { op: '', title: 'Converted clients', metric_key: 'legal_firm.sales_intake.pnc_converted_count' },
      { op: '/', title: 'Potential new clients', metric_key: 'legal_firm.sales_intake.pnc_count' },
    ]);
  });

  test('difference and goal equations; a count has none', () => {
    const diff = L.detailModel({ formula: { kind: 'difference', plain: 'x' }, inputs: [
      { metric_key: 'a', title: 'Target', role: 'part' }, { metric_key: 'b', title: 'Actual', role: 'subtract' }] }, NOW);
    expect(diff.equation.map((t) => t.op + t.title)).toEqual(['Target', '-Actual']);
    const goal = L.detailModel({ formula: { kind: 'goal', plain: 'x' }, inputs: [
      { metric_key: 'a', title: 'Cash this month', role: 'part' }, { metric_key: 'g', title: 'Monthly goal', role: 'goal' }] }, NOW);
    expect(goal.equation.map((t) => [t.op, t.title])).toEqual([['', 'Cash this month'], ['of', 'Monthly goal']]);
    expect(L.detailModel({ formula: { kind: 'count', plain: 'Counts matters.' }, inputs: [] }, NOW).equation).toBe(null);
  });

  test('sources lead with the entity on file, plus "counted in your dates" (the metric\'s own date window) when not null', () => {
    const m = L.detailModel(conversion, NOW);
    expect(m.sources.map((s) => s.line)).toEqual(['1,204 leads on file, 36 counted in your dates', '916 matters on file']);
  });

  test('count_scope from the server is the note on the counts; without it, the fallback wording', () => {
    const withScope = L.detailModel({ sources: [Object.assign({}, conversion.sources[0], { count_scope: 'All leads the firm has, by system.' })] }, NOW);
    expect(withScope.sources[0].systemsLabel).toBe('All leads the firm has, by system.');
    expect(L.detailModel(conversion, NOW).sources[0].systemsLabel).toBe('records of this type, by system');
  });

  test('a Right now metric never shows "counted in your dates"', () => {
    expect(L.detailModel(conversion, NOW, { snapshot: true }).sources[0].line).toBe('1,204 leads on file');
  });

  test('the systems line counts records of this type by system (not records used): via a connector, in LANA', () => {
    const m = L.detailModel(conversion, NOW);
    expect(m.sources[0]).toMatchObject({ systemsLabel: 'records of this type, by system', systemsText: '1,180 via Leadly, 24 in LANA', stale: false, staleText: null,
      syncedAt: '2026-11-24T09:00:00Z' });
    expect(m.sources[1]).toMatchObject({ systemsText: '916 via ActionStep', stale: true, staleText: 'last synced Aug 10' });
    expect(m.sources.every((s) => s.label && s.systemsText.indexOf('used') === -1)).toBe(true);
  });

  test('a source with nothing on file is left out', () => {
    const m = L.detailModel({ sources: [{ entity: 'lead', label: 'Leads', records_total: 0, records_in_period: 0, systems: [] }, conversion.sources[1]] }, NOW);
    expect(m.sources.map((s) => s.label)).toEqual(['Matters']);
  });

  test('fields read as sentences, grouped by what they do', () => {
    expect(L.detailModel(conversion, NOW).fieldSentences).toEqual([
      'Date created decides which dates count.',
      'Practice area decides what is included.',
      'Service offering splits the number into groups.',
      'Fee is the value we use.',
    ]);
  });

  test('filters, dates, goal, caveats, and the expression kept for the technical details', () => {
    const m = L.detailModel(conversion, NOW);
    expect(m.filters).toEqual([{ label: 'Estate planning only', detail: 'Practice area is Estate Planning' }]);
    expect(m.periodRule).toBe('Counts leads created between your dates.');
    expect(m.goal).toEqual({ set: false, metric_key: 'legal_firm.sales_intake.monthly_target' });
    expect(m.caveats).toEqual(['Leads without a source are left out.']);
    expect(m.expression).toBe('count(converted) / count(pnc)');
  });

  test('missing parts are empty, never broken', () => {
    expect(L.detailModel({}, NOW)).toEqual({ formula: '', equation: null, sources: [], fieldSentences: [], filters: [], periodRule: '',
      goal: null, caveats: [], expression: '' });
  });
});

describe('cardSummary: one sentence on how a card is put together', () => {
  test.each([
    ['compare', 2, 'Shows these 2 numbers side by side.'],
    ['ranked_bars', 3, 'Each bar is one number.'],
    ['columns', 4, 'Each bar is one number.'],
    ['donut', 3, 'Each slice is one number, as a share of the total.'],
    ['stacked_bar', 2, 'Each part of the bar is one number, as a share of the total.'],
    ['funnel', 4, 'Each step is one number; the percent shows how many moved on from the step before.'],
  ])('%s with %d metrics', (visual, count, sentence) => {
    expect(L.cardSummary(visual, count, 'X')).toBe(sentence);
  });
  test('rings name the goal; single lists name their rows; single numbers need no sentence', () => {
    expect(L.cardSummary('ring', 3, 'Cash This Month')).toBe('The ring shows progress toward the goal set on Cash This Month.');
    expect(L.cardSummary('columns', 1, 'New Clients by Service', true)).toBe('Each bar is one row of New Clients by Service.');
    expect(L.cardSummary('stat', 1, 'Total Active Cases')).toBe(null);
  });
});

describe('cardLines: the instant summary from card.lineage', () => {
  test('formula, dates and source chips', () => {
    expect(L.cardLines({ sources: [{ entity: 'matter', label: 'Matters' }, { entity: 'appt', label: 'Appointments' }],
      formula: { kind: 'count', plain: 'Counts open matters.' }, period_rule: 'As of today.' }))
      .toEqual({ formula: 'Counts open matters.', periodRule: 'As of today.', sources: ['Matters', 'Appointments'] });
    expect(L.cardLines(null)).toBe(null);
  });
});

describe('the styled About section helpers', () => {
  test('equationPills: inputs as pills with values and the result, operators as symbols', () => {
    const pills = L.equationPills(conversion, { 'legal_firm.sales_intake.pnc_converted_count': '16', 'legal_firm.sales_intake.pnc_count': '211' }, '7.6%');
    expect(pills).toEqual({ type: 'equation', terms: [
      { op: '', label: 'Converted clients', value: '16', metric_key: 'legal_firm.sales_intake.pnc_converted_count' },
      { op: '÷', label: 'Potential new clients', value: '211', metric_key: 'legal_firm.sales_intake.pnc_count' },
    ], result: '7.6%' });
  });

  test('equationPills: a count reads as a sentence of pills from the source and the filters', () => {
    expect(L.equationPills({ formula: { kind: 'count' }, sources: [{ label: 'Matters' }], filters: [{ label: 'Practice area is Probate' }] }, {}, '36'))
      .toEqual({ type: 'sentence', parts: [{ text: 'Count of' }, { pill: 'Matters' }, { text: 'where' }, { pill: 'Practice area is Probate' }], result: '36' });
    expect(L.equationPills({ formula: { kind: 'sum' }, sources: [{ label: 'Payments' }] }, {}, '$5').parts).toEqual([{ text: 'Total of' }, { pill: 'Payments' }]);
    expect(L.equationPills(null, {}, '')).toBe(null);
    expect(L.equationPills({ formula: { kind: 'ratio' }, inputs: [] }, {}, '1')).toBe(null);
  });

  test('syncStatus: green under a day, amber up to a week, red beyond, unknown without a time', () => {
    expect(L.syncStatus('2026-11-24T09:00:00Z', NOW)).toBe('fresh');
    expect(L.syncStatus('2026-11-20T09:00:00Z', NOW)).toBe('recent');
    expect(L.syncStatus('2026-08-10T15:00:00Z', NOW)).toBe('stale');
    expect(L.syncStatus(null, NOW)).toBe('unknown');
  });

  test('sameText: the Data used sentence hides when it repeats How it is calculated', () => {
    expect(L.sameText('Counts open matters.', ' counts open  matters ')).toBe(true);
    expect(L.sameText('Counts open matters.', 'Counts closed matters.')).toBe(false);
    expect(L.sameText('', 'x')).toBe(false);
  });

  test('flowSteps: Data, Filters, Dates, Result', () => {
    const steps = L.flowSteps(L.detailModel(conversion, NOW), conversion);
    expect(steps.map((s) => [s.key, s.title, s.lines])).toEqual([
      ['data', 'Data', ['Leads', 'Matters']],
      ['filters', 'Filters', ['Estate planning only']],
      ['dates', 'Dates', ['Counts leads created between your dates.']],
      ['result', 'Result', ['Ratio']],
    ]);
    expect(L.flowSteps(L.detailModel({ formula: { kind: 'count' } }, NOW), { formula: { kind: 'count' } }).map((s) => s.lines))
      .toEqual([['No sources listed'], ['Everything counts'], ['Follows the dates you pick'], ['Count']]);
  });

  test('fieldRows: each detail with its role icon', () => {
    expect(L.fieldRows(conversion).map((r) => [r.icon, r.sentence])).toEqual([
      ['calendar', 'Date created decides which dates count.'],
      ['funnel', 'Practice area decides what is included.'],
      ['layers', 'Service offering splits the number into groups.'],
      ['sigma', 'Fee is the value we use.'],
    ]);
  });

  test('source cards: a big total, the in-dates chip, via and sync status, and count_scope once as a note', () => {
    const lineage = { sources: [Object.assign({}, conversion.sources[0], { count_scope: 'All leads, not only these.' })] };
    expect(L.sourceCards(lineage, NOW)).toEqual([{ label: 'Leads', entity: 'lead', total: '1,204 leads', inDates: '36 in your dates',
      via: 'via Leadly, 24 in LANA', syncedAt: '2026-11-24T09:00:00Z', status: 'fresh', scopeNote: 'All leads, not only these.' }]);
    expect(L.sourceCards(lineage, NOW, { snapshot: true })[0].inDates).toBe(null);
  });
});
