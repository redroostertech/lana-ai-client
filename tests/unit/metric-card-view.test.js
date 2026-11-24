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

describe('isPointInTime reads period_scope from the server', () => {
  test('snapshot cards are "right now"', () => {
    expect(View.isPointInTime(card('active_cases_total'))).toBe(true);
    expect(View.isPointInTime(card('overdue_expected_cash'))).toBe(true);
  });
  test('flow cards follow the dates', () => {
    expect(View.isPointInTime(card('average_case_value'))).toBe(false);
    expect(View.isPointInTime({ period_scope: 'cumulative' })).toBe(false);
  });
  test('metric detail carries it as metric.periodScope', () => {
    expect(View.isPointInTime(detail)).toBe(false);
    expect(View.isPointInTime({ metric: { periodScope: 'snapshot' } })).toBe(true);
  });
  test('an older server without the field shows no label', () => {
    expect(View.isPointInTime({ metric_key: 'legal_firm.finance.overdue_expected_cash' })).toBe(false);
  });
});

describe('listBars detects lists from the value shape', () => {
  test('a table card becomes bars labelled from service_label', () => {
    const model = View.listBars(card('new_cases_opened_by_service_offering').value);
    expect(model).toMatchObject({ empty: false, paired: false, max: 21 });
    expect(model.rows).toEqual([{ label: 'Estate Planning', value: 21, second: null, pct: 100, secondPct: null }]);
  });

  test('labels fall back to label, name, then a readable key', () => {
    const model = View.listBars([{ label: 'Week of Jan 5', amount: 10 }, { name: 'Probate', total: 5 }, { service_key: 'trust_admin', count: 2 }]);
    expect(model.rows.map((r) => r.label)).toEqual(['Week of Jan 5', 'Probate', 'Trust admin']);
    expect(model.rows.map((r) => r.pct)).toEqual([100, 50, 20]);
  });

  test('actual against needed rows become paired bars on one scale', () => {
    const model = View.listBars([
      { service_label: 'Estate Planning', actual: 12, needed: 20 },
      { service_label: 'Probate', actual: 9, needed: 6 },
    ]);
    expect(model.paired).toBe(true);
    expect(model.seriesLabels).toEqual(['Actual', 'Needed']);
    expect(model.max).toBe(20);
    expect(model.rows[0]).toMatchObject({ value: 12, second: 20, pct: 60, secondPct: 100 });
  });

  test('an empty list is empty, not a chart', () => {
    expect(View.listBars([])).toEqual({ empty: true, rows: [], paired: false, max: 0, seriesLabels: [], hiddenCount: 0 });
  });

  test('not a list is null', () => {
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
