'use strict';

/**
 * Metric card view model (pure): reads the dashboard card contract and
 * decides what a tile draws. Fixtures come from a real owner dashboard
 * response with names redacted (tests/fixtures/dashboard/metric-cards-sample.json).
 */

const path = require('path');
const View = require(path.join(__dirname, '../../src/js/shared/metric-card-view.js'));
const sample = require(path.join(__dirname, '../fixtures/dashboard/metric-cards-sample.json'));

const cards = sample.dashboard_metric_cards_owner_jan_2026.data;
const card = (suffix) => cards.find((c) => c.metric_key.endsWith(suffix));
const detail = sample.metric_detail_new_cases_opened_total_jan1_nov24;

// The first real goal: a $50,000 monthly goal on cash this month.
const cashGoalCard = {
  metric_key: 'legal_firm.finance.cash_this_month', title: 'Cash This Month', value: 32100, formatted_value: '$32,100',
  format: 'currency', period_scope: 'snapshot', data_state: 'ok', comparison: null,
  goal: { target_value_resolved: 50000, attainment_pct: 64.2, delta_to_target: -17900, status: 'yellow',
    pacing: { elapsed_fraction: 0.77, expected_to_date: 38500, pace_status: 'behind' }, target_type: 'static' },
};

test('period_scope is not read for display: no point-in-time helpers', () => {
  expect(View.isPointInTime).toBeUndefined();
  expect(View.periodScope).toBeUndefined();
});

describe('listBars detects lists from the value shape', () => {
  test('a table card becomes bars labelled from service_label', () => {
    const model = View.listBars(card('new_cases_opened_by_service_offering').value);
    expect(model).toMatchObject({ empty: false, paired: false, max: 21 });
    expect(model.rows).toEqual([{ label: 'Estate Planning', value: 21, second: null, pct: 100, secondPct: null, muted: false }]);
  });

  test('labels fall back to label, name, then a readable key', () => {
    const model = View.listBars([{ label: 'Week of Jan 5', value: 10 }, { name: 'Probate', value: 5 }, { service_key: 'trust_admin', value: 2 }]);
    expect(model.rows.map((r) => r.label)).toEqual(['Week of Jan 5', 'Probate', 'Trust admin']);
    expect(model.rows.map((r) => r.pct)).toEqual([100, 50, 20]);
  });

  test('plain list cards read value', () => {
    const model = View.listBars(card('closed_cases_by_service_offering').value);
    expect(model.rows.map((r) => [r.label, r.value])).toEqual([['Estate Planning', 6], ['Guardianship', 2]]);
    expect(model.paired).toBe(false);
  });

  test('with no value field the first count field is used (never a rate or an id)', () => {
    const model = View.listBars([{ label: 'A', amount: 10, total: 4, count: 3 }]);
    expect(model.rows[0].value).toBe(10);
    expect(View.listBars([{ label: 'A', rate: 0.5, record_id: 7 }]).rows[0].value).toBe(null);
  });

  test('actual against needed with needed set draws paired bars on one scale', () => {
    const model = View.listBars([
      { service_key: 'estate_planning', service_label: 'Estate Planning', actual_count: 12, needed_count: 20, variance: -8, average_case_value: 4000 },
      { service_key: 'probate', service_label: 'Probate', actual_count: 9, needed_count: 6, variance: 3, average_case_value: 5000 },
    ]);
    expect(model.paired).toBe(true);
    expect(model.neededPending).toBe(false);
    expect(model.seriesLabels).toEqual(['Actual', 'Needed']);
    expect(model.max).toBe(20);
    expect(model.rows[0]).toMatchObject({ value: 12, second: 20, pct: 60, secondPct: 100 });
  });

  test('actual against needed before a goal draws only actual bars and says needed is pending', () => {
    const model = View.listBars(card('actual_vs_needed_service_offerings').value);
    expect(model.paired).toBe(false);
    expect(model.neededPending).toBe(true);
    expect(model.seriesLabels).toEqual([]);
    expect(model.rows.map((r) => [r.label, r.value, r.second, r.secondPct])).toEqual([
      ['Estate Planning', 21, null, null], ['Guardianship', 0, null, null], ['Probate', 0, null, null], ['Medicaid', 0, null, null],
    ]);
  });

  test('a row whose needed count is still null keeps a single bar inside a paired chart', () => {
    const model = View.listBars([{ service_label: 'A', actual_count: 4, needed_count: 8 }, { service_label: 'B', actual_count: 2, needed_count: null }]);
    expect(model.paired).toBe(true);
    expect(model.rows[1]).toMatchObject({ value: 2, second: null, secondPct: null });
  });

  test('an empty list is empty, not a chart', () => {
    expect(View.listBars([])).toEqual({ empty: true, rows: [], paired: false, neededPending: false, max: 0, seriesLabels: [], hiddenCount: 0 });
  });

  test('not a list is null (expected cash cards are plain currency numbers)', () => {
    expect(View.listBars(card('expected_cash_by_week').value)).toBe(null);
    expect(View.listBars(916)).toBe(null);
    expect(View.listBars(null)).toBe(null);
    expect(View.listBars({ value: 3 })).toBe(null);
  });

  test('long lists keep the first rows and count the rest', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ label: 'Row ' + i, value: i + 1 }));
    const model = View.listBars(rows, 8);
    expect(model.rows).toHaveLength(8);
    expect(model.hiddenCount).toBe(3);
    expect(model.max).toBe(11);
  });

  test('negative or missing numbers draw as zero width, never break', () => {
    const model = View.listBars([{ label: 'A', value: -5 }, { label: 'B', value: 'n/a' }, { label: 'C', value: 10 }]);
    expect(model.rows.map((r) => r.pct)).toEqual([0, 0, 100]);
    expect(model.rows[1].value).toBe(null);
  });
});

describe('listValueFormat: the unit for list numbers comes from the card format', () => {
  test('currency_breakdown means dollars', () => {
    expect(View.listValueFormat(card('gross_revenue_by_service_offering'))).toBe('currency');
  });
  test('the server row_format wins over the card format', () => {
    expect(View.listValueFormat({ format: 'table', row_format: 'currency' })).toBe('currency');
    expect(View.listValueFormat({ format: 'currency_breakdown', row_format: 'integer' })).toBe('number');
    expect(View.listValueFormat({ format: 'table', row_format: 'percentage' })).toBe('percent');
  });
  test('an unknown or missing row_format falls back to the card format', () => {
    expect(View.listValueFormat({ format: 'currency_breakdown', row_format: 'stars' })).toBe('currency');
    expect(View.listValueFormat({ format: 'currency_breakdown', row_format: null })).toBe('currency');
  });
  test('table means plain numbers', () => {
    expect(View.listValueFormat(card('new_cases_opened_by_service_offering'))).toBe('number');
    expect(View.listValueFormat(card('actual_vs_needed_service_offerings'))).toBe('number');
    expect(View.listValueFormat({})).toBe('number');
  });
});

describe('comparisonArrow', () => {
  test('down with a percent', () => {
    expect(View.comparisonArrow(detail.comparison)).toEqual({ direction: 'down', text: '-85.1%', spoken: 'Down 85.1% from the previous period' });
  });
  test('up and flat', () => {
    expect(View.comparisonArrow({ direction: 'up', percent_change: 12.5 }).text).toBe('+12.5%');
    expect(View.comparisonArrow({ direction: 'flat', percent_change: 0 })).toMatchObject({ direction: 'flat', text: '0%' });
  });
  test('no comparison or no percent draws no arrow', () => {
    expect(View.comparisonArrow(null)).toBe(null);
    expect(View.comparisonArrow({ direction: 'up', percent_change: null, absolute_change: 5 })).toBe(null);
  });
});

describe('goalProgress', () => {
  test('the cash goal fills the ring to attainment with a pace marker', () => {
    expect(View.goalProgress(cashGoalCard.goal)).toEqual({
      available: true, fillPct: 64.2, attainmentLabel: '64%', band: 'yellow', statusLabel: 'At risk', target: 50000,
      paceMarkerPct: 77, paceStatus: 'behind', paceLabel: 'Behind', met: false,
    });
  });
  test('a met green goal is met and the ring stops at full', () => {
    const p = View.goalProgress({ target_value_resolved: 50000, attainment_pct: 112, status: 'green', pacing: null });
    expect(p).toMatchObject({ fillPct: 100, met: true, band: 'green', paceMarkerPct: null, paceLabel: null });
  });
  test('green under 100 is not met', () => {
    expect(View.goalProgress({ target_value_resolved: 10, attainment_pct: 95, status: 'green' }).met).toBe(false);
  });
  test('an unavailable goal gives a plain note and no ring', () => {
    const p = View.goalProgress({ target_value_resolved: null, attainment_pct: null, status: 'unknown', pacing: null, reason: 'compatible_prior_unavailable' });
    expect(p.available).toBe(false);
    expect(p.note).toBe('There is no earlier period to measure this goal against yet.');
    expect(View.goalProgress({ status: 'unknown', reason: 'something_new' }).note).toBe('Progress toward this goal is not available for these dates.');
  });
  test('no goal is null', () => {
    expect(View.goalProgress(null)).toBe(null);
    expect(View.goalProgress(cards[0].goal)).toBe(null);
  });
});

describe('sparkline', () => {
  test('fewer than two points draws nothing', () => {
    expect(View.sparkline(detail.snapshots)).toBe(null);
    expect(View.sparkline([{ value_numeric: 4, period_start: '2026-01-01' }])).toBe(null);
    expect(View.sparkline(null)).toBe(null);
  });
  test('points are ordered by period and scaled into the box', () => {
    const line = View.sparkline([
      { value_numeric: 30, period_start: '2026-03-01' },
      { value_numeric: 10, period_start: '2026-01-01' },
      { value_numeric: 'x', period_start: '2026-01-15' },
      { value_numeric: 20, period_start: '2026-02-01' },
    ], 100, 20);
    expect(line.points).toBe('0,18 50,10 100,2');
    expect(line.last).toEqual({ x: 100, y: 2 });
    expect(line.trend).toBe('up');
  });
  test('a flat line sits in the middle', () => {
    expect(View.sparkline([{ value_numeric: 5, captured_at: '2026-01-01' }, { value_numeric: 5, captured_at: '2026-01-02' }], 100, 20).points).toBe('0,10 100,10');
  });
});

describe('splitFormatted / formatTween drive the count-up', () => {
  test('currency keeps its sign and grouping', () => {
    const parts = View.splitFormatted('$549,420');
    expect(parts).toEqual({ prefix: '$', number: 549420, decimals: 0, grouped: true, suffix: '' });
    expect(View.formatTween(parts, 1234.4)).toBe('$1,234');
    expect(View.formatTween(parts, 549420)).toBe('$549,420');
  });
  test('percent and days keep their suffix and decimals', () => {
    expect(View.splitFormatted('12.5%')).toEqual({ prefix: '', number: 12.5, decimals: 1, grouped: false, suffix: '%' });
    expect(View.formatTween(View.splitFormatted('3.0 days'), 1.25)).toBe('1.3 days');
  });
  test('text without a number does not count', () => {
    expect(View.splitFormatted('View details')).toBe(null);
    expect(View.splitFormatted('n/a')).toBe(null);
    expect(View.splitFormatted('1.2.3')).toBe(null);
    expect(View.splitFormatted('')).toBe(null);
  });
  test('easeOut runs 0 to 1', () => {
    expect(View.easeOut(0)).toBe(0);
    expect(View.easeOut(1)).toBe(1);
    expect(View.easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

test('list rows are labelled from the first *_name field before label or name', () => {
  const model = View.listBars([{ attorney_id: 'a1', attorney_name: 'Avery Stone', value: 4 }, { attorney_id: 'a2', attorney_name: 'Blake Ross', value: 2 }]);
  expect(model.rows.map((r) => r.label)).toEqual(['Avery Stone', 'Blake Ross']);
  expect(View.listBars([{ service_label: 'Probate', client_name: 'X', value: 1 }]).rows[0].label).toBe('Probate');
});

test('a "Not mapped" row in a breakdown is marked muted and labelled plainly', () => {
  const model = View.listBars([{ service_key: 'estate_planning', service_label: 'Estate Planning', value: 21 }, { service_key: 'not_mapped', service_label: 'not_mapped', value: 42 }]);
  expect(model.rows.map((r) => [r.label, r.muted])).toEqual([['Estate Planning', false], ['Not mapped', true]]);
  expect(View.listBars([{ label: 'X', value: 1, not_mapped: true }]).rows[0].muted).toBe(true);
});

describe('listHasNoTotal: rate and average lists are never summed', () => {
  const rows = [{ label: 'A', value: 40 }, { label: 'B', value: 60 }];
  test('formatted_value null on a list means no total', () => {
    expect(View.listHasNoTotal({ value: rows, formatted_value: null, format: 'table' })).toBe(true);
  });
  test('a percentage list never has a client total', () => {
    expect(View.listHasNoTotal({ value: rows, row_format: 'percentage', formatted_value: '2 rows' })).toBe(true);
    expect(View.listHasNoTotal({ value: rows, format: 'percentage' })).toBe(true);
  });
  test('an average or rate list (metadata.aggregation) never has a client total', () => {
    expect(View.listHasNoTotal({ value: rows, format: 'table', metadata: { aggregation: 'average' } })).toBe(true);
    expect(View.listHasNoTotal({ value: rows, format: 'table', metadata: { aggregation: 'rate' } })).toBe(true);
  });
  test('count and money lists, and non-lists, are unchanged', () => {
    expect(View.listHasNoTotal({ value: rows, format: 'currency_breakdown', formatted_value: '$100' })).toBe(false);
    expect(View.listHasNoTotal({ value: rows, format: 'table' })).toBe(false);
    expect(View.listHasNoTotal({ value: 3, formatted_value: null })).toBe(false);
  });
});

describe('second line and "Too few to rate" rows', () => {
  const line = (value) => ({ label: 'Cohort rate', value, format: 'percentage', numerator: 21, denominator: 50 });
  test('secondLine formats { label, value (0 to 100), format: percentage } on the client', () => {
    expect(View.secondLine({ metadata: { second_line: line(42) } })).toBe('Cohort rate 42%');
    expect(View.secondLine({ metadata: { second_line: line(33.333) } })).toBe('Cohort rate 33.3%');
    expect(View.secondLine({ metadata: { second_line: line(0) } })).toBe('Cohort rate 0%');
  });
  test('a null value, no second_line key, or any other shape shows nothing', () => {
    expect(View.secondLine({ metadata: { second_line: line(null) } })).toBe('');
    expect(View.secondLine({ metadata: {} })).toBe('');
    expect(View.secondLine({ metadata: { second_line: 'Cohort rate 31%' } })).toBe('');
    expect(View.secondLine(null)).toBe('');
  });
  test('metric detail reads current.metadata.second_line only', () => {
    expect(View.secondLine({ current: { metadata: { second_line: line(42) } } })).toBe('Cohort rate 42%');
    expect(View.secondLine({ current: { value: 1 }, metadata: { second_line: line(42) } }, 'detail')).toBe('');
  });
  test('a row with no number but a server label keeps the label and draws no bar', () => {
    const model = View.listBars([{ label: 'Referral', value: 40 }, { label: 'Web', value: null, value_label: 'Too few to rate' }], 12);
    expect(model.rows[1]).toMatchObject({ label: 'Web', value: null, pct: 0, valueLabel: 'Too few to rate' });
    expect(model.rows[0].valueLabel).toBeUndefined();
  });
  test('only value_label is read (the server shape); a real 0 is still a bar value', () => {
    const model = View.listBars([{ label: 'A', value: null, display_value: 'x', formatted_value: 'y' }, { label: 'B', value: 0 }], 12);
    expect(model.rows[0].valueLabel).toBeUndefined();
    expect(model.rows[1]).toMatchObject({ value: 0 });
    expect(model.rows[1].valueLabel).toBeUndefined();
  });
});

test('team rows: conversion_rate null with status insufficient_data and value_label', () => {
  const model = View.listBars([
    { attorney_name: 'Avery Stone', conversion_rate: 40 },
    { attorney_name: 'Blake Ross', conversion_rate: null, status: 'insufficient_data', value_label: 'Too few to rate' },
  ], 12);
  expect(model.rows[1]).toMatchObject({ label: 'Blake Ross', value: null, pct: 0, valueLabel: 'Too few to rate' });
});

test('a bucket cut by the picked dates keeps partial: true', () => {
  const model = View.listBars([{ label: 'Q3', value: 4 }, { label: 'Q4', value: 2, partial: true }], 12);
  expect(model.rows[1].partial).toBe(true);
  expect(model.rows[0].partial).toBeUndefined();
});

describe('unassignedNote: decided records nobody owns', () => {
  test('decided > 0 gives "Not assigned to anyone: 3 won, 2 lost"', () => {
    expect(View.unassignedNote({ metadata: { unassigned: { won: 3, lost: 2, decided: 5 } } })).toBe('Not assigned to anyone: 3 won, 2 lost');
    expect(View.unassignedNote({ metadata: { unassigned: { won: 1, lost: 0, decided: 1 } } })).toBe('Not assigned to anyone: 1 won, 0 lost');
  });
  test('nothing when decided is 0, missing, or there is no unassigned block', () => {
    expect(View.unassignedNote({ metadata: { unassigned: { won: 0, lost: 0, decided: 0 } } })).toBe('');
    expect(View.unassignedNote({ metadata: { unassigned: { won: 2 } } })).toBe('');
    expect(View.unassignedNote({ metadata: {} })).toBe('');
    expect(View.unassignedNote(null)).toBe('');
  });
});

describe('card text: headline, callouts and the second line link', () => {
  test('cardText reads metadata.headline and every callout (plain text or { kind, rule, text, metric_key })', () => {
    expect(View.cardText({ metadata: { headline: 'Deals are closing faster.', callouts: ['One.', '', null, 'Two.', { kind: 'warning', rule: 'r1', text: 'Three.', metric_key: 'a.b' }, { text: '' }, { kind: 'x' }] } }))
      .toEqual({ headline: 'Deals are closing faster.', callouts: ['One.', 'Two.', 'Three.'] });
    expect(View.cardText({ metadata: {} })).toEqual({ headline: '', callouts: [] });
    expect(View.cardText(null)).toEqual({ headline: '', callouts: [] });
  });
  test('secondLineLink: second_line.link = { metric_key } opens that metric; nothing else is read', () => {
    const line = { label: 'Deals with an amount', value: 80, format: 'percentage' };
    expect(View.secondLineLink({ metadata: { second_line: Object.assign({}, line, { link: { metric_key: 'legal_firm.sales_intake.deals_missing_amount' } }) } }))
      .toEqual({ metricKey: 'legal_firm.sales_intake.deals_missing_amount' });
    expect(View.secondLineLink({ metadata: { second_line: Object.assign({}, line, { metric_key: 'a.b.c' }) } })).toBe(null);
    expect(View.secondLineLink({ metadata: { second_line: Object.assign({}, line, { link: { href: 'x.html' } }) } })).toBe(null);
    expect(View.secondLineLink({ metadata: { second_line: line } })).toBe(null);
  });

});

describe('bucketSnapshots: long daily series drawn by week or month', () => {
  const daily = (n, value) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2020, 0, 6 + i));
    return { period_start: d.toISOString().slice(0, 10), value_numeric: value === undefined ? 1 : value };
  });
  test('short series are drawn as they are', () => {
    const s = daily(30);
    expect(View.bucketSnapshots(s, 'integer')).toBe(s);
  });
  test('more than a year of days: summed by week for counts and currency', () => {
    const out = View.bucketSnapshots(daily(700), 'currency');
    expect(out).toHaveLength(100);
    expect(out[0]).toEqual({ period_start: '2020-01-06', value_numeric: 7 });
    expect(View.bucketSnapshots(daily(700), 'number')[0].value_numeric).toBe(7);
  });
  test('many years of days (9,827 points): summed by month', () => {
    const out = View.bucketSnapshots(daily(9827), 'integer');
    expect(out.length).toBeLessThan(330);
    expect(out[0].period_start).toBe('2020-01-01');
    expect(out[0].value_numeric).toBe(26);
  });
  test('rates and averages are never summed: the last value of each bucket is drawn', () => {
    const series = daily(700).map((p, i) => Object.assign({}, p, { value_numeric: i }));
    const out = View.bucketSnapshots(series, 'percentage');
    expect(out[0]).toEqual({ period_start: '2020-01-06', value_numeric: 6 });
    expect(View.bucketSnapshots(series, 'average')[0].value_numeric).toBe(6);
  });
});

describe('rowLabel: never "Item N" when the row has words', () => {
  const label = (row) => View.listBars([row], 12).rows[0].label;
  test('leads by source, pipeline by age, owners and services read their own words', () => {
    expect(label({ source: '1.1 Truth Talk', value: 30, leads: 30, qualified_leads: 12, spend: 500 })).toBe('1.1 Truth Talk');
    expect(label({ age_band: 'Under 30 days', open_count: 79, no_amount_count: 10, value: 314350 })).toBe('Under 30 days');
    expect(label({ owner_name: 'Avery Stone', value: 4 })).toBe('Avery Stone');
    expect(label({ service: 'Probate', value: 2 })).toBe('Probate');
    expect(label({ category: 'Referral', value: 2 })).toBe('Referral');
    expect(label({ bucket: '31 to 60 days', value: 2 })).toBe('31 to 60 days');
    expect(label({ stage_label: 'Consultation', value: 2 })).toBe('Consultation');
  });
  test('stage and pipeline together read "Stage (Pipeline)"', () => {
    expect(label({ pipeline: '1. Estate Planning', stage: 'Lead', stage_position: 0, open_count: 19, no_amount_count: 4, value: 73000 })).toBe('Lead (1. Estate Planning)');
  });
  test('label or name still win; otherwise the first plain text field that is not an id or a date', () => {
    expect(label({ name: 'Named', source: 'x', value: 1 })).toBe('Named');
    expect(label({ record_id: 'abc', created_at: '2026-01-01', channel_text: 'Walk-in', value: 1 })).toBe('Walk-in');
  });
  test('"Item N" only when there are no words at all', () => {
    expect(label({ value: 1, count: 2 })).toBe('Item 1');
  });
});

describe('second_line formats by its own format', () => {
  test('currency uses the firm currency, number is grouped, percentage keeps one decimal', () => {
    expect(View.secondLine({ metadata: { second_line: { label: 'Weighted by win probability', value: 2540063.42, format: 'currency' } } })).toBe('Weighted by win probability $2,540,063');
    expect(View.secondLine({ metadata: { second_line: { label: 'Open deals', value: 1234.5, format: 'number' } } })).toBe('Open deals 1,234.5');
    expect(View.secondLine({ metadata: { second_line: { label: 'Cohort rate', value: 42.25, format: 'percentage' } } })).toBe('Cohort rate 42.3%');
  });
  test('the firm currency is used when the page has one', () => {
    global.Lex = { Utils: { getFirmCurrency: () => 'EUR' } };
    try {
      expect(View.secondLine({ metadata: { second_line: { label: 'Weighted', value: 1000, format: 'currency' } } })).toBe('Weighted €1,000');
    } finally { delete global.Lex; }
  });
});

describe('listValueFormat: a value format the server sends for distribution rows', () => {
  test('value_format on the card or in metadata, or the value column in row_columns', () => {
    expect(View.listValueFormat({ format: 'distribution', value_format: 'currency' })).toBe('currency');
    expect(View.listValueFormat({ format: 'distribution', metadata: { value_format: 'currency' } })).toBe('currency');
    expect(View.listValueFormat({ format: 'distribution', metadata: { value_format: 'percentage' } })).toBe('percent');
    expect(View.listValueFormat({ format: 'distribution', row_columns: [{ field: 'stage', header: 'Stage' }, { field: 'value', header: 'Value', format: 'currency' }] })).toBe('currency');
  });
  test('without a hint, never guessed from field names', () => {
    expect(View.listValueFormat({ format: 'distribution', value: [{ stage: 'Lead', value: 73000, no_amount_count: 4 }] })).toBe('number');
  });
});

describe('cross-tab rows with no value field (team appointments by meeting type)', () => {
  const row = { team_member: 'Avery Stone', meeting_type: 'Consultation', appointments: 68, held: 29, no_show: 30, cancelled: 8, no_outcome: 1, show_rate: 49.2,
    refs: [{ object: 'person', id: 'p-1', user_id: 'u-9' }] };
  test('two category words read "Member · Type"; the value is the first count field, never a rate', () => {
    const model = View.listBars([row], 12);
    expect(model.rows[0]).toMatchObject({ label: 'Avery Stone · Consultation', value: 68, ref: { object: 'person', id: 'p-1', user_id: 'u-9' } });
  });
  test('a row with only rates has no value rather than a summed or guessed one', () => {
    expect(View.listBars([{ team_member: 'A', show_rate: 49.2, conversion_pct: 10 }], 12).rows[0].value).toBe(null);
  });
  test('rows with a value field keep it; positions and ids are not counts', () => {
    expect(View.listBars([{ stage: 'Lead', stage_position: 3, open_count: 19, value: 73000 }], 12).rows[0].value).toBe(73000);
    expect(View.listBars([{ stage: 'Lead', stage_position: 3, open_count: 19 }], 12).rows[0].value).toBe(19);
  });
});

describe('second_line does not repeat a number its label already says', () => {
  test('label with the raw number as a whole word, or the formatted value: no value appended', () => {
    expect(View.secondLine({ metadata: { second_line: { label: '4 of 47 deals won in these dates have no amount', value: 4, format: 'number' } } }))
      .toBe('4 of 47 deals won in these dates have no amount');
    expect(View.secondLine({ metadata: { second_line: { label: 'Weighted $2,540,063', value: 2540063.42, format: 'currency' } } })).toBe('Weighted $2,540,063');
  });
  test('a number inside another number or word still gets the value', () => {
    expect(View.secondLine({ metadata: { second_line: { label: 'Deals over 40 days', value: 4, format: 'number' } } })).toBe('Deals over 40 days 4');
    expect(View.secondLine({ metadata: { second_line: { label: 'Cohort rate', value: 42, format: 'percentage' } } })).toBe('Cohort rate 42%');
  });
});

describe('name plus a role or status: the name alone, status as a muted suffix', () => {
  test('rowLabel uses the name; rowStatus gives the status unless it repeats the name', () => {
    const owner = { owner_name: 'Taylor Vance', role: 'owner', value: 3 };
    const unassigned = { owner_name: 'Unassigned', status: 'unassigned', value: 2 };
    const linked = { team_member: 'Jordan Reese', link_status: 'Linked to LANA', value: 5 };
    expect(View.listBars([owner, unassigned, linked], 12).rows.map((r) => [r.label, r.status || ''])).toEqual([
      ['Taylor Vance', ''], ['Unassigned', ''], ['Jordan Reese', 'Linked to LANA'],
    ]);
  });
  test('the cross-tab still reads "Member · Meeting type"', () => {
    expect(View.listBars([{ team_member: 'Avery Stone', meeting_type: 'Consultation', appointments: 3 }], 12).rows[0].label).toBe('Avery Stone · Consultation');
  });
});

test('row_format "currency" alone makes a distribution money', () => {
  expect(View.listValueFormat({ format: 'distribution', row_format: 'currency' })).toBe('currency');
});

describe('access and kind fields are statuses; raw enums are hidden', () => {
  test('*_access and *_kind never join the label; only human text shows as the suffix', () => {
    const rows = View.listBars([
      { team_member: 'Jordan Reese', lana_access: 'Linked to LANA', value: 5 },
      { owner_name: 'Taylor Vance', owner_kind: 'owner', value: 3 },
      { owner_name: 'Casey Lee', owner_kind: 'not_on_team', value: 2 },
    ], 12).rows;
    expect(rows.map((r) => [r.label, r.status || ''])).toEqual([['Jordan Reese', 'Linked to LANA'], ['Taylor Vance', ''], ['Casey Lee', '']]);
  });
});

test('a value inferred from a count field is marked, so card money formats do not apply', () => {
  const model = View.listBars([{ owner_name: 'Taylor Vance', open_count: 266 }], 12);
  expect(model.rows[0].value).toBe(266);
  expect(model.inferred).toBe(true);
  expect(View.listBars([{ owner_name: 'A', value: 5 }], 12).inferred).toBe(false);
});

test('integer is a known format: a whole number, never currency', () => {
  expect(View.listValueFormat({ row_format: 'integer', value: [] })).toBe('number');
  expect(View.listValueFormat({ row_format: 'INTEGER', value_format: 'currency', value: [] })).toBe('number');
  expect(View.secondLine({ metadata: { second_line: { label: 'Open deals', value: 266.4, format: 'integer' } } })).toBe('Open deals 266');
});
