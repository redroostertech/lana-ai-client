const path = require('path');

const mapper = require(path.join(
  __dirname,
  '../../src/js/shared/metric-goal-form-mapper.js'
));

describe('metric-goal-form-mapper', () => {
  describe('indexGoals', () => {
    test('indexes by metric_key then target_period', () => {
      const index = mapper.indexGoals([
        { metric_key: 'matters_open', target_period: 'monthly', target_value: 100 },
        { metric_key: 'matters_open', target_period: 'weekly', target_value: 25 },
        { metric_key: 'tasks_overdue', target_period: 'monthly', target_value: 0 },
      ]);

      expect(index.matters_open.monthly.target_value).toBe(100);
      expect(index.matters_open.weekly.target_value).toBe(25);
      expect(index.tasks_overdue.monthly.target_value).toBe(0);
    });

    test('defaults a missing period to monthly and ignores junk rows', () => {
      const index = mapper.indexGoals([
        { metric_key: 'm1', target_value: 5 },
        null,
        { target_value: 9 },
      ]);
      expect(index.m1.monthly.target_value).toBe(5);
      expect(Object.keys(index)).toEqual(['m1']);
    });

    test('returns empty object for non-array input', () => {
      expect(mapper.indexGoals(null)).toEqual({});
      expect(mapper.indexGoals(undefined)).toEqual({});
    });
  });

  describe('getGoal / hasAnyGoal', () => {
    const index = mapper.indexGoals([
      { metric_key: 'm1', target_period: 'monthly', target_value: 10 },
    ]);

    test('getGoal returns the matching period or null', () => {
      expect(mapper.getGoal(index, 'm1', 'monthly').target_value).toBe(10);
      expect(mapper.getGoal(index, 'm1', 'weekly')).toBeNull();
      expect(mapper.getGoal(index, 'missing', 'monthly')).toBeNull();
    });

    test('hasAnyGoal is true only when a goal exists for any period', () => {
      expect(mapper.hasAnyGoal(index, 'm1')).toBe(true);
      expect(mapper.hasAnyGoal(index, 'missing')).toBe(false);
    });
  });

  describe('buildGoalPayload', () => {
    test('builds a minimal payload from required + defaulted fields', () => {
      const result = mapper.buildGoalPayload({
        target_value: '120',
        target_type: 'static',
        target_period: 'monthly',
      });
      expect(result.ok).toBe(true);
      expect(result.payload).toEqual({
        target_value: 120,
        target_type: 'static',
        target_period: 'monthly',
      });
    });

    test('includes optional thresholds and notes only when supplied', () => {
      const result = mapper.buildGoalPayload({
        target_value: '50',
        target_type: 'growth_rate',
        target_period: 'weekly',
        green_threshold: '90',
        red_threshold: '60',
        notes: '  pace it  ',
      });
      expect(result.ok).toBe(true);
      expect(result.payload).toEqual({
        target_value: 50,
        target_type: 'growth_rate',
        target_period: 'weekly',
        green_threshold: 90,
        red_threshold: 60,
        notes: 'pace it',
      });
      expect(result.payload).not.toHaveProperty('yellow_threshold');
    });

    test('rejects a blank target_value', () => {
      const result = mapper.buildGoalPayload({ target_value: '', target_type: 'static' });
      expect(result.ok).toBe(false);
      expect(result.payload).toBeNull();
      expect(result.errors.target_value).toBeTruthy();
    });

    test('rejects a non-numeric target_value', () => {
      const result = mapper.buildGoalPayload({ target_value: 'abc' });
      expect(result.ok).toBe(false);
      expect(result.errors.target_value).toBeTruthy();
    });

    test('rejects a non-numeric optional threshold', () => {
      const result = mapper.buildGoalPayload({ target_value: '10', green_threshold: 'nope' });
      expect(result.ok).toBe(false);
      expect(result.errors.green_threshold).toBeTruthy();
    });

    test('rolling_average requires an integer window N of 1 or more', () => {
      const fraction = mapper.buildGoalPayload({
        target_value: '2.5',
        target_type: 'rolling_average',
        target_period: 'monthly',
      });
      expect(fraction.ok).toBe(false);
      expect(fraction.errors.target_value).toBeTruthy();

      const tooLow = mapper.buildGoalPayload({
        target_value: '0',
        target_type: 'rolling_average',
        target_period: 'monthly',
      });
      expect(tooLow.ok).toBe(false);
      expect(tooLow.errors.target_value).toBeTruthy();

      const ok = mapper.buildGoalPayload({
        target_value: '3',
        target_type: 'rolling_average',
        target_period: 'monthly',
      });
      expect(ok.ok).toBe(true);
      expect(ok.payload.target_value).toBe(3);
      expect(ok.payload.target_type).toBe('rolling_average');
    });

    test('falls back to static/monthly when type or period is invalid', () => {
      const result = mapper.buildGoalPayload({
        target_value: '1',
        target_type: 'bogus',
        target_period: 'yearly',
      });
      expect(result.ok).toBe(true);
      expect(result.payload.target_type).toBe('static');
      expect(result.payload.target_period).toBe('monthly');
    });
  });

  describe('formatToken', () => {
    test('lowercases a string token', () => {
      expect(mapper.formatToken('Currency')).toBe('currency');
    });

    test('reads .type from a registry object', () => {
      expect(mapper.formatToken({ type: 'Percentage' })).toBe('percentage');
    });

    test('returns empty for null / unknown shapes', () => {
      expect(mapper.formatToken(null)).toBe('');
      expect(mapper.formatToken({})).toBe('');
    });
  });

  describe('targetValueLabel', () => {
    test('static carries the metric unit per format', () => {
      expect(mapper.targetValueLabel('static', 'percentage')).toBe('Target value (%)');
      expect(mapper.targetValueLabel('static', 'currency')).toBe('Target value ($)');
      expect(mapper.targetValueLabel('static', 'number')).toBe('Target value');
      expect(mapper.targetValueLabel('static', 'integer')).toBe('Target value');
      expect(mapper.targetValueLabel('static', 'days')).toBe('Target value');
      expect(mapper.targetValueLabel('static', '')).toBe('Target value');
    });

    test('growth_rate is always Growth percent regardless of format', () => {
      expect(mapper.targetValueLabel('growth_rate', 'currency')).toBe('Growth percent');
    });

    test('rolling_average is always Periods to average (N)', () => {
      expect(mapper.targetValueLabel('rolling_average', 'percentage')).toBe('Periods to average (N)');
    });
  });

  describe('formatGoalValue', () => {
    test('formats currency, percentage, integer, days, and plain numbers', () => {
      expect(mapper.formatGoalValue(25000, 'currency')).toBe('$25,000');
      expect(mapper.formatGoalValue(95, 'percentage')).toBe('95%');
      expect(mapper.formatGoalValue(12, 'integer')).toBe('12');
      expect(mapper.formatGoalValue(1, 'days')).toBe('1 day');
      expect(mapper.formatGoalValue(3, 'days')).toBe('3 days');
      expect(mapper.formatGoalValue(1.25, 'number')).toBe('1.25');
    });

    test('formats a real zero target (not treated as empty)', () => {
      expect(mapper.formatGoalValue(0, 'integer')).toBe('0');
    });

    test('returns empty for blank / non-numeric values', () => {
      expect(mapper.formatGoalValue(null, 'currency')).toBe('');
      expect(mapper.formatGoalValue('', 'currency')).toBe('');
    });
  });

  describe('buildRecommendationView', () => {
    test('shows a formatted suggestion for static with a non-null value', () => {
      const view = mapper.buildRecommendationView(
        { recommended_value: 25000, basis: 'based on your trailing 6-period average' },
        'currency',
        'static'
      );
      expect(view.show).toBe(true);
      expect(view.valueDisplay).toBe('$25,000');
      expect(view.rawValue).toBe(25000);
      expect(view.basis).toBe('based on your trailing 6-period average');
    });

    test('hides for growth_rate and rolling_average even with a value', () => {
      const rec = { recommended_value: 10, basis: 'metric template default' };
      expect(mapper.buildRecommendationView(rec, 'number', 'growth_rate').show).toBe(false);
      expect(mapper.buildRecommendationView(rec, 'number', 'rolling_average').show).toBe(false);
    });

    test('hides when the recommendation is missing or its value is null', () => {
      expect(mapper.buildRecommendationView(null, 'number', 'static').show).toBe(false);
      expect(mapper.buildRecommendationView({ recommended_value: null }, 'number', 'static').show).toBe(false);
      expect(mapper.buildRecommendationView({ recommended_value: 'x' }, 'number', 'static').show).toBe(false);
    });

    test('defaults missing targetType to static and shows the value', () => {
      const view = mapper.buildRecommendationView({ recommended_value: 12 }, 'integer');
      expect(view.show).toBe(true);
      expect(view.valueDisplay).toBe('12');
    });
  });
});
