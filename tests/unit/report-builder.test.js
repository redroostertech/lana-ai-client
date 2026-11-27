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

  test.each([
    ['a metric-rows report', { metric_rows_key: 'x' }],
    ['any other saved report', { module_key: 'm' }],
    ['a report with no details', null],
  ])('%s sends the chosen period (firm days, end inclusive)', (_label, report) => {
    expect(builder.runReportBody(report, october)).toEqual({ filters: {}, bypass_cache: false, period: october });
  });

  test.each([
    ['empty strings', { start: '', end: '' }],
    ['only a start', { start: '2026-10-01', end: '' }],
    ['only an end', { start: '', end: '2026-10-31' }],
    ['no dates at all', null],
    ['not plain days', { start: '10/01/2026', end: '2026-10-31T00:00:00Z' }],
  ])('%s: no period at all', (_label, days) => {
    expect(builder.runReportBody({ module_key: 'm' }, days)).toEqual({ filters: {}, bypass_cache: false });
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

describe('report data sources', () => {
  const source = { id: 's1', name: 'ActionStep (Firm)', connectorType: 'actionstep', entities: ['matter', 'contact', 'invoice_line'], lastSuccessfulSyncAt: '2026-08-10T14:03:00Z' };

  test('leads with the entities, then the name and the last sync', () => {
    expect(builder.dataSourceView(source)).toEqual({ lead: 'Matter, Contact, Invoice line', name: 'ActionStep (Firm)', lastSync: 'Last synced Aug 10, 2026' });
  });
  test('entities can be objects; no entities leads with the name; no sync says so', () => {
    expect(builder.dataSourceView({ name: 'Leadly', entities: [{ label: 'Leads' }, { name: 'appointment' }] }).lead).toBe('Leads, Appointment');
    expect(builder.dataSourceView({ name: 'Leadly', entities: [] })).toEqual({ lead: 'Leadly', name: '', lastSync: 'Not synced yet' });
    expect(builder.dataSourceView({ connectorType: 'quickbooks' }).lead).toBe('Quickbooks');
  });
  test('the row markup is escaped and has no inline styles', () => {
    const html = builder.dataSourceHtml({ name: '<b>X</b>', entities: ['matter'], lastSuccessfulSyncAt: null });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('style=');
    expect(html).toContain('Not synced yet');
  });
  test('the report page uses it for the data sources list', () => {
    const report = require('fs').readFileSync(require('path').join(__dirname, '../../src/js/admin/report.js'), 'utf8');
    expect(report).toContain('ReportBuilder.dataSourceHtml(');
  });
});
