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

  test('only the server field names are read, never guesses', () => {
    const model = View.listBars([{ label: 'A', amount: 10, total: 4, count: 3 }]);
    expect(model.rows[0].value).toBe(null);
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
