'use strict';

/**
 * The report builder's pure parts (src/js/admin/report-builder.js): which
 * catalog metrics each path lists, the saved report body for a metric's value
 * or rows, the run body, and the results table columns a metric-rows report
 * declares. The backend refuses any key that is not in the catalog.
 */

const builder = require('../../src/js/admin/report-builder.js');

const CATALOG = [
  { key: 'core.financial-performance.average_case_value', display_name: 'Average Case Value', has_rows: true, display_domain: 'Finance' },
  { key: 'legal_firm.finance.profit_margin', display_name: 'Profit Margin', has_rows: true },
  { key: 'legal_firm.marketing.source_average_case_value', display_name: 'Source Average Case Value', has_rows: false },
  { key: 'core.ops.no_flag', title: 'A Metric Without The Flag' }
];

describe('catalog metric options', () => {
  test('the rows path lists only metrics with rows', () => {
    expect(builder.catalogMetricOptions(CATALOG, builder.KINDS.rows).map(o => o.value))
      .toEqual(['core.financial-performance.average_case_value', 'legal_firm.finance.profit_margin']);
  });

  test('metrics that share a name say where each comes from, and the key when that is not enough', () => {
    const shared = [
      { key: 'core.financial-performance.average_case_value', display_name: 'Average Case Value', has_rows: true,
        source: { type: 'template_seed', moduleKey: 'financial-performance' } },
      { key: 'core.growth-intake-performance.average_case_value', display_name: 'Average Case Value', has_rows: true,
        source: { type: 'template_seed', moduleKey: 'growth-intake-performance' } },
      { key: 'legal_firm.finance.average_case_value', display_name: 'Average Case Value', has_rows: true,
        source: { group: 'legal_firm.finance' } },
      { key: 'x.finance.average_case_value', display_name: 'Average Case Value', has_rows: true, source: { group: 'x.finance' } },
      { key: 'core.ops.unique', display_name: 'Unique Metric', has_rows: true }
    ];
    const labels = builder.catalogMetricOptions(shared, builder.KINDS.rows).map(o => o.label);
    expect(labels).toEqual([
      'Average Case Value (Finance) (legal_firm.finance.average_case_value)',
      'Average Case Value (Finance) (x.finance.average_case_value)',
      'Average Case Value (Financial Performance)',
      'Average Case Value (Growth Intake Performance)',
      'Unique Metric'
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('the value path lists every catalog metric, by label', () => {
    expect(builder.catalogMetricOptions(CATALOG, builder.KINDS.value).map(o => o.label))
      .toEqual(['A Metric Without The Flag', 'Average Case Value', 'Profit Margin', 'Source Average Case Value']);
  });
});

describe('the saved report body', () => {
  const KEY = 'core.financial-performance.average_case_value';

  test.each([
    ['rows', builder.KINDS.rows, { metric_rows: { metric_key: KEY } }],
    ['value', builder.KINDS.value, { metric_keys: [KEY] }]
  ])('%s', (_label, kind, config) => {
    expect(builder.catalogReportDefinition({ kind, metricKey: KEY, name: '  Cases won  ' }))
      .toEqual({ body: { name: 'Cases won', description: '', config } });
  });

  test.each([
    [{ kind: 'rows', metricKey: '', name: 'R' }, 'Pick a metric.'],
    [{ kind: 'rows', metricKey: KEY, name: '   ' }, 'Give the report a name.']
  ])('a missing choice is a message, not a request: %j', (choice, problem) => {
    expect(builder.catalogReportDefinition(choice)).toEqual({ problem });
  });
});

describe('the run body', () => {
  const october = { start: '2026-10-01', end: '2026-10-31' };

  test('a metric-rows report sends the chosen period', () => {
    expect(builder.runReportBody({ metric_rows_key: 'x' }, october))
      .toEqual({ filters: {}, bypass_cache: false, period: october });
  });

  test.each([
    ['another kind of saved report', { module_key: 'm' }, october],
    ['a metric-rows report with no period chosen', { metric_rows_key: 'x' }, { start: '', end: '' }]
  ])('%s sends no period', (_label, report, days) => {
    expect(builder.runReportBody(report, days)).toEqual({ filters: {}, bypass_cache: false });
  });
});

describe('declared table columns', () => {
  test("the backend's headers, with the module's format type the table knows", () => {
    const result = { columns: [
      { field: 'opportunity_name', header: 'Case', align: 'left' },
      { field: 'value', header: 'Value', align: 'right', format: { type: 'currency', prefix: '$', decimals: 0 } },
      { field: 'won_date', header: 'Won On', format: { type: 'relative_time' } }
    ] };
    expect(builder.declaredTableColumns(result)).toEqual([
      { field: 'opportunity_name', header: 'Case', align: 'left', format: '' },
      { field: 'value', header: 'Value', align: 'right', format: 'currency' },
      { field: 'won_date', header: 'Won On', align: 'left', format: '' }
    ]);
  });

  test.each([[{}], [{ columns: [] }], [null], [{ columns: [{ field: 'client_name' }, { field: 'service' }] }]])(
    'no headers declared (the table names the row keys): %j', (result) => {
    expect(builder.declaredTableColumns(result)).toBeNull();
  });
});
