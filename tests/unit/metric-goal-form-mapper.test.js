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
        yellow_threshold: '',
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
});
