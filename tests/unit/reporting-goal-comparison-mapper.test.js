const path = require('path');

const mapper = require(path.join(
  __dirname,
  '../../src/js/shared/reporting-goal-comparison-mapper.js'
));

describe('reporting-goal-comparison-mapper', () => {
  describe('mapGoalStatusToColor', () => {
    test('passes through green/yellow/red', () => {
      expect(mapper.mapGoalStatusToColor('green')).toBe('green');
      expect(mapper.mapGoalStatusToColor('yellow')).toBe('yellow');
      expect(mapper.mapGoalStatusToColor('red')).toBe('red');
    });

    test('maps unknown and unexpected statuses to gray', () => {
      expect(mapper.mapGoalStatusToColor('unknown')).toBe('gray');
      expect(mapper.mapGoalStatusToColor(undefined)).toBe('gray');
      expect(mapper.mapGoalStatusToColor(null)).toBe('gray');
      expect(mapper.mapGoalStatusToColor('purple')).toBe('gray');
    });
  });

  describe('buildGoalComparisonViewModel', () => {
    test('repoints status, target, and attainment onto the goal block', () => {
      const vm = mapper.buildGoalComparisonViewModel({
        status: 'red', // flat field must be ignored when goal present
        target: 999,
        goal: {
          status: 'green',
          target_value_resolved: 120,
          attainment_pct: 104.2
        }
      });

      expect(vm.hasGoal).toBe(true);
      expect(vm.statusColor).toBe('green');
      expect(vm.targetValue).toBe(120);
      expect(vm.attainmentPct).toBeCloseTo(104.2);
    });

    test('repoints prior, percent change, and direction onto the comparison block', () => {
      const vm = mapper.buildGoalComparisonViewModel({
        prior: 999, // flat field must be ignored when comparison present
        changeDirection: 'down',
        comparison: {
          previous_value: 80,
          percent_change: 25,
          direction: 'up'
        }
      });

      expect(vm.hasComparison).toBe(true);
      expect(vm.priorValue).toBe(80);
      expect(vm.percentChange).toBe(25);
      expect(vm.changeDirection).toBe('up');
    });

    test('degrades onto flat fields when goal and comparison are null', () => {
      const vm = mapper.buildGoalComparisonViewModel({
        status: 'yellow',
        target: 50,
        prior: 40,
        changeDirection: 'down',
        goal: null,
        comparison: null
      });

      expect(vm.hasGoal).toBe(false);
      expect(vm.statusColor).toBe('yellow');
      expect(vm.targetValue).toBe(50);
      expect(vm.attainmentPct).toBeNull();

      expect(vm.hasComparison).toBe(false);
      expect(vm.priorValue).toBe(40);
      expect(vm.percentChange).toBeNull();
      expect(vm.changeDirection).toBe('down');
    });

    test('maps an error status to gray in the flat-field path', () => {
      const vm = mapper.buildGoalComparisonViewModel({ status: 'error' });
      expect(vm.statusColor).toBe('gray');
    });

    test('handles a null percent_change and an unknown goal status', () => {
      const vm = mapper.buildGoalComparisonViewModel({
        goal: { status: 'unknown', target_value_resolved: 10, attainment_pct: null },
        comparison: { previous_value: 0, percent_change: null, direction: 'flat' }
      });

      expect(vm.statusColor).toBe('gray');
      expect(vm.attainmentPct).toBeNull();
      expect(vm.priorValue).toBe(0);
      expect(vm.percentChange).toBeNull();
      expect(vm.changeDirection).toBe('flat');
    });

    test('treats missing numeric fields as null rather than NaN', () => {
      const vm = mapper.buildGoalComparisonViewModel({
        goal: { status: 'green' },
        comparison: { direction: 'up' }
      });

      expect(vm.targetValue).toBeNull();
      expect(vm.priorValue).toBeNull();
    });

    test('is safe on a null metric', () => {
      const vm = mapper.buildGoalComparisonViewModel(null);
      expect(vm.hasGoal).toBe(false);
      expect(vm.hasComparison).toBe(false);
      expect(vm.statusColor).toBe('gray');
      expect(vm.changeDirection).toBe('flat');
    });
  });
});

// With no comparison block the tile falls back to the flat fields, and the
// backend's changePercent (shared delta rule) is one of them: 9.4 vs a prior
// 11.2 showed "—" for % change.
describe('flat-field fallback keeps the backend percent change', () => {
  const m = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  test('changePercent and changeDirection come through without a comparison block', () => {
    const vm = m.buildGoalComparisonViewModel({ current: 9.4, prior: 11.2, changePercent: -16.1, changeDirection: 'down' });
    expect(vm.priorValue).toBe(11.2);
    expect(vm.percentChange).toBe(-16.1);
  });
  test('no prior means no percent change', () => {
    expect(m.buildGoalComparisonViewModel({ current: 3, prior: null, changePercent: null }).percentChange).toBeNull();
  });
});
