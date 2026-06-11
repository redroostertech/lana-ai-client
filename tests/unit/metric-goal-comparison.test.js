/**
 * Unit tests for the metric goal + comparison view-model helpers.
 *
 * These pin the mapping from the backend `goal` / `comparison` blocks
 * (LANA-AI/docs/METRIC_GOALS_DESIGN.md sections 7 and 11) into the
 * display-ready primitives the dashboard widget and dashboard-detail
 * renderers consume. Graceful-degrade (null in -> null out) is the key
 * contract: when the backend omits a block, the renderer shows nothing extra.
 */

const path = require('path');

const {
  buildGoalView,
  buildComparisonView,
  resolveCompareMode,
} = require(path.join(__dirname, '../../src/js/dashboard/metric-goal-comparison.js'));

describe('buildGoalView', () => {
  test('returns null when goal is null/undefined (graceful degrade)', () => {
    expect(buildGoalView(null)).toBeNull();
    expect(buildGoalView(undefined)).toBeNull();
  });

  test('maps green status to the on-target band with attainment label', () => {
    const view = buildGoalView({
      target_value_resolved: 100,
      attainment_pct: 112,
      delta_to_target: 12,
      status: 'green',
      pacing: null,
      target_type: 'static',
    });
    expect(view.band).toBe('green');
    expect(view.statusLabel).toBe('On target');
    expect(view.attainmentLabel).toBe('112%');
    expect(view.hasAttainment).toBe(true);
    expect(view.pace).toBeNull();
  });

  test('maps yellow and red statuses to risk/off-target bands', () => {
    expect(buildGoalView({ status: 'yellow' }).band).toBe('yellow');
    expect(buildGoalView({ status: 'yellow' }).statusLabel).toBe('At risk');
    expect(buildGoalView({ status: 'red' }).band).toBe('red');
    expect(buildGoalView({ status: 'red' }).statusLabel).toBe('Off target');
  });

  test('maps unknown / unexpected status to a neutral band', () => {
    expect(buildGoalView({ status: 'unknown' }).band).toBe('neutral');
    expect(buildGoalView({ status: 'banana' }).band).toBe('neutral');
    expect(buildGoalView({}).band).toBe('neutral');
  });

  test('omits attainment label when attainment_pct is null/non-numeric', () => {
    const view = buildGoalView({ status: 'green', attainment_pct: null });
    expect(view.attainmentLabel).toBeNull();
    expect(view.hasAttainment).toBe(false);
  });

  test('surfaces pacing label when pacing block is present', () => {
    const view = buildGoalView({
      status: 'yellow',
      attainment_pct: 60,
      pacing: { elapsed_fraction: 0.5, expected_to_date: 50, pace_status: 'behind' },
    });
    expect(view.pace).toEqual({ status: 'behind', label: 'Behind pace' });
  });

  test('suppresses pacing when pacing block is null', () => {
    const view = buildGoalView({ status: 'green', pacing: null });
    expect(view.pace).toBeNull();
  });
});

describe('buildComparisonView', () => {
  test('returns null when comparison is null/undefined (graceful degrade)', () => {
    expect(buildComparisonView(null)).toBeNull();
    expect(buildComparisonView(undefined)).toBeNull();
  });

  test('maps an upward comparison with percent change', () => {
    const view = buildComparisonView({
      previous_value: 80,
      previous_period: { start: '2026-05-01', end: '2026-05-31', mode: 'previous_calendar' },
      absolute_change: 20,
      percent_change: 25,
      direction: 'up',
      source: 'snapshot',
    });
    expect(view.direction).toBe('up');
    expect(view.deltaLabel).toBe('25%');
    expect(view.previousValue).toBe(80);
    expect(view.hasPrevious).toBe(true);
  });

  test('falls back to absolute change when percent_change is null (prior was 0)', () => {
    const view = buildComparisonView({
      previous_value: 0,
      absolute_change: 14,
      percent_change: null,
      direction: 'up',
    });
    expect(view.deltaLabel).toBe('14');
  });

  test('normalizes unexpected direction to flat', () => {
    expect(buildComparisonView({ direction: 'sideways', previous_value: 1 }).direction).toBe('flat');
    expect(buildComparisonView({ previous_value: 1 }).direction).toBe('flat');
  });

  test('flags missing previous value when previous_value is non-numeric', () => {
    const view = buildComparisonView({ direction: 'down', percent_change: -10 });
    expect(view.hasPrevious).toBe(false);
    expect(view.previousValue).toBeNull();
    expect(view.deltaLabel).toBe('10%');
  });
});

describe('resolveCompareMode', () => {
  test('presets compare against the previous calendar period', () => {
    expect(resolveCompareMode(true)).toBe('previous_calendar');
  });

  test('custom ranges compare against the previous equal-length period', () => {
    expect(resolveCompareMode(false)).toBe('previous_period');
  });
});
