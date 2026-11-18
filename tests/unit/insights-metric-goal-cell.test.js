/**
 * The Goal cell on Insights module cards: the goal set in the Metric Catalog
 * and its status, a link to the catalog editor for the roles that may set
 * goals, and no target at all on a card that is not a catalog metric.
 */

global.MetricGoalComparison = require('../../src/js/dashboard/metric-goal-comparison.js');
const { goalCellHtml } = require('../../src/insights/js/metric-goal-cell.js');

const KEY = 'core.funnel-analysis-attribution.funnel_overall_conversion';

test('a catalog metric with a goal shows it, its status and an edit link for goal admins', () => {
  const html = goalCellHtml({ catalog_key: KEY, target: 30, goal: { target_value_resolved: 30, attainment_pct: 85, status: 'yellow' } },
    { targetDisplay: '30%', canEdit: true });
  expect(html).toContain('>30%<');
  expect(html).toContain('At risk (85% of goal)');
  expect(html).toContain('href="../admin/metric-catalog.html?editGoal=' + encodeURIComponent(KEY) + '"');
  expect(html).toContain('>Edit goal<');
});

test('control: a role that cannot set goals sees the goal but no link', () => {
  const html = goalCellHtml({ catalog_key: KEY, target: 30, goal: { status: 'green', attainment_pct: 100 } },
    { targetDisplay: '30%', canEdit: false });
  expect(html).toContain('On target');
  expect(html).not.toContain('data-metric-goal-link');
});

test('a catalog metric with no goal offers to set one', () => {
  const html = goalCellHtml({ catalog_key: KEY, target: null, goal: null }, { targetDisplay: 'N/A', canEdit: true });
  expect(html).toContain('No goal set');
  expect(html).toContain('>Set goal<');
});

test('a card that is not a catalog metric has no goal and no link', () => {
  const html = goalCellHtml({ catalog_key: null, target: null, goal: null }, { targetDisplay: '-', canEdit: true });
  expect(html).toContain('No goal for this card');
  expect(html).not.toContain('data-metric-goal-link');
});

test('a goal that cannot be tracked says so instead of a silent unknown', () => {
  const html = goalCellHtml({ catalog_key: KEY, target: null,
    goal: { status: 'unknown', target_value_resolved: null, reason: 'distribution_goal_unavailable' } }, { canEdit: true });
  expect(html).toContain('Not tracked yet');
  expect(html).toContain('cannot be tracked');
});

test('values are escaped', () => {
  const html = goalCellHtml({ catalog_key: KEY, target: 5, goal: null }, { targetDisplay: '<b>5</b>', canEdit: false });
  expect(html).toContain('&lt;b&gt;5&lt;/b&gt;');
});

// A goal of 0 is a real goal: a lower-is-better metric aiming for none shows
// the goal and its status.
test('a goal of 0 is shown with its status', () => {
  const html = goalCellHtml({ catalog_key: KEY, target: 0, goal: { target_value_resolved: 0, status: 'green' } },
    { targetDisplay: '0', canEdit: true });
  expect(html).toContain('data-metric-goal-value>0<');
  expect(html).toContain('On target');
  expect(html).toContain('>Edit goal<');
});

// A number that reads another metric's goal links to that goal, the one
// that changes it, and says which.
test('a card that needs another metric\'s goal links to that goal', () => {
  const input = { metric_key: 'legal_firm.finance.annual_revenue_target', name: 'Annual Revenue Target',
    message: 'Set the Annual Revenue Target goal in the Metric Catalog.' };
  const html = goalCellHtml({ catalog_key: 'core.financial-performance.revenue_gap_to_target', target: null, goal: null,
    goal_input: input }, { canEdit: true });
  expect(html).toContain('href="../admin/metric-catalog.html?editGoal=' + encodeURIComponent(input.metric_key) + '"');
  expect(html).not.toContain('revenue_gap_to_target');
  expect(html).toContain('Set the Annual Revenue Target goal');
  expect(html).toContain('No goal set');
});
