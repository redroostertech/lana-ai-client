const path = require('path');

// The preview module delegates goal/comparison shaping to the two pure mappers
// via globals. Load them onto a shared global before requiring the preview
// module so the renderers exercise the real mapper logic.
global.MetricGoalComparison = require(path.join(
  __dirname,
  '../../src/js/dashboard/metric-goal-comparison.js'
));
global.ReportingGoalComparisonMapper = require(path.join(
  __dirname,
  '../../src/js/shared/reporting-goal-comparison-mapper.js'
));

const preview = require(path.join(
  __dirname,
  '../../src/js/shared/metric-card-preview.js'
));

describe('metric-card-preview', () => {
  describe('renderDashboardPreviewCard', () => {
    test('renders title, value, goal band, and comparison when present', () => {
      const html = preview.renderDashboardPreviewCard({
        title: 'New Clients',
        key: 'firm.new_clients',
        value: 12,
        format: 'integer',
        goal: { status: 'green', attainment_pct: 120 },
        comparison: { direction: 'up', percent_change: 25, previous_value: 9 },
      });
      expect(html).toContain('dash-metric-card');
      expect(html).toContain('New Clients');
      expect(html).toContain('dash-metric-card__goal-band--green');
      expect(html).toContain('On target');
      expect(html).toContain('120% of goal');
      expect(html).toContain('vs previous period');
      expect(html).toContain('was 9');
    });

    test('renders with both goal and comparison null (no goal/comparison sections)', () => {
      const html = preview.renderDashboardPreviewCard({
        title: 'Idle Metric',
        key: 'firm.idle',
        value: 5,
        format: 'integer',
        goal: null,
        comparison: null,
      });
      expect(html).toContain('Idle Metric');
      expect(html).not.toContain('dash-metric-card__goal-band');
      expect(html).not.toContain('vs previous period');
    });

    test('escapes the title', () => {
      const html = preview.renderDashboardPreviewCard({
        title: '<script>x</script>',
        key: 'k',
        value: 1,
      });
      expect(html).not.toContain('<script>x');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('renderReportPreviewCard', () => {
    test('renders status background, current value, change, prior, target, attainment', () => {
      const html = preview.renderReportPreviewCard({
        name: 'Revenue',
        current: 1000,
        format: 'currency',
        goal: { status: 'yellow', target_value_resolved: 1200, attainment_pct: 83 },
        comparison: { direction: 'down', percent_change: -10, previous_value: 1100 },
      });
      expect(html).toContain('metric-catalog-playground-report--yellow');
      expect(html).toContain('Revenue');
      expect(html).toContain('Current Period');
      expect(html).toContain('83% of target');
      expect(html).toContain('decrease');
      // Currency formatting on prior/target.
      expect(html).toContain('$1,100');
      expect(html).toContain('$1,200');
    });

    test('renders with both goal and comparison null (gray, N/A prior and target)', () => {
      const html = preview.renderReportPreviewCard({
        name: 'Unscored',
        current: 42,
        format: 'integer',
        goal: null,
        comparison: null,
      });
      expect(html).toContain('metric-catalog-playground-report--gray');
      expect(html).toContain('Unscored');
      // Prior and Target fall back to N/A.
      expect(html.match(/N\/A/g).length).toBeGreaterThanOrEqual(2);
      expect(html).not.toContain('of target');
    });
  });

  describe('renderRulesPanel', () => {
    test('static goal summarizes the absolute target', () => {
      const html = preview.renderRulesPanel(
        { target_type: 'static', target_value: 160, target_period: 'monthly' },
        null
      );
      expect(html).toContain('Target');
      expect(html).toContain('160');
      expect(html).toContain('monthly');
    });

    test('rolling_average goal summarizes the window N', () => {
      const html = preview.renderRulesPanel(
        { target_type: 'rolling_average', target_value: 3, target_period: 'weekly' },
        null
      );
      expect(html).toContain('Window 3 periods');
    });

    test('growth_rate goal summarizes percent over prior', () => {
      const html = preview.renderRulesPanel(
        { target_type: 'growth_rate', target_value: 5, target_period: 'monthly' },
        null
      );
      expect(html).toContain('5 percent over prior');
    });

    test('explicit thresholds describe Green/Red floors', () => {
      const html = preview.renderRulesPanel(
        { target_type: 'static', target_value: 12, green_threshold: 12, red_threshold: 8 },
        null
      );
      expect(html).toContain('Green and Red are floors');
    });

    test('blank thresholds describe percent-of-target bands', () => {
      const html = preview.renderRulesPanel(
        { target_type: 'static', target_value: 12 },
        null
      );
      expect(html).toContain('Percent-of-target bands');
    });

    test('no goal renders the no-goal message', () => {
      const html = preview.renderRulesPanel(null, { format: 'currency', inverse: true });
      expect(html).toContain('No goal configured for this period.');
      expect(html).toContain('currency');
      expect(html).toContain('lower is better');
    });

    test('definition truncates a long calculation and lists entities', () => {
      const longCalc = 'x'.repeat(400);
      const html = preview.renderRulesPanel(null, {
        calculation: longCalc,
        entities: ['matter', { entity_type: 'contact' }],
      });
      expect(html).toContain('...');
      expect(html).not.toContain('x'.repeat(400));
      expect(html).toContain('matter, contact');
    });
  });

  describe('renderDrilldownTable', () => {
    test('builds a table from rows with the column union', () => {
      const html = preview.renderDrilldownTable([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob', extra: 'z' },
      ]);
      expect(html).toContain('<table');
      expect(html).toContain('<th>id</th>');
      expect(html).toContain('<th>name</th>');
      expect(html).toContain('<th>extra</th>');
      expect(html).toContain('Alice');
      expect(html).toContain('Bob');
    });

    test('escapes cell content', () => {
      const html = preview.renderDrilldownTable([{ note: '<b>hi</b>' }]);
      expect(html).not.toContain('<b>hi</b>');
      expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    });

    test('empty rows render an empty state', () => {
      expect(preview.renderDrilldownTable([])).toContain('No underlying rows');
      expect(preview.renderDrilldownTable(null)).toContain('No underlying rows');
    });

    test('caps columns at 8 and notes truncation beyond 50 rows', () => {
      const wideRow = {};
      for (let i = 0; i < 12; i++) wideRow['c' + i] = i;
      const rows = [];
      for (let r = 0; r < 60; r++) rows.push(Object.assign({}, wideRow));
      const html = preview.renderDrilldownTable(rows);
      // Only 8 columns rendered.
      expect((html.match(/<th>/g) || []).length).toBe(8);
      expect(html).toContain('Showing first 50 of 60 rows');
    });
  });
});
