'use strict';

/**
 * Metric detail view model (pure): the friendly source records table and
 * the one summary card (value with its unit, change against the prior
 * period, the prior period's dates, a two-bar comparison).
 */

const path = require('path');
const V = require(path.join(__dirname, '../../src/js/shared/metric-detail-view.js'));
const sample = require(path.join(__dirname, '../fixtures/dashboard/metric-cards-sample.json'));

const detail = sample.metric_detail_new_cases_opened_total_jan1_nov24;
const UUID = '3f2a9c1e-8b7d-4e21-9a0f-1c2d3e4f5a6b';

describe('recordsTable', () => {
  test('internal keys and ids never show; headers read as words', () => {
    const table = V.recordsTable(detail.raw_data.rows);
    expect(table.columns.map((c) => c.key)).toEqual(['matter_name', 'client_name', 'status', 'stage', 'opened_at']);
    expect(table.columns.map((c) => c.label)).toEqual(['Matter', 'Client', 'Status', 'Stage', 'Opened']);
  });

  test('internal references (*_ref) are hidden too', () => {
    expect(V.recordsTable([{ matter_ref: 'm-1', matter_name: 'A' }]).columns.map((c) => c.key)).toEqual(['matter_name']);
  });

  test('a column whose values are all UUIDs is hidden whatever its name', () => {
    const table = V.recordsTable([{ ref: UUID, name: 'A' }, { ref: UUID.split('3f2a').join('4a1b'), name: 'B' }]);
    expect(table.columns.map((c) => c.key)).toEqual(['name']);
  });

  test('known names get friendly labels; others are humanised without _at or _date', () => {
    const table = V.recordsTable([{ days: 4, closed_at: '2026-01-02T00:00:00Z', due_date: '2026-02-01', hearing_time: '2026-02-01T15:30:00Z', amount_owed: 10 }]);
    expect(table.columns.map((c) => [c.label, c.type])).toEqual([
      ['Days in stage', 'number'], ['Closed', 'date'], ['Due', 'date'], ['Hearing time', 'datetime'], ['Amount owed', 'money'],
    ]);
  });

  test('cells: dates as days, empty as null (the page shows a muted dash), amounts as money', () => {
    const table = V.recordsTable([{ matter_name: 'A', client_name: '', opened_at: '2026-08-03T16:43:22.716Z', amount: 1250.5 },
      { matter_name: 'B', client_name: 'C', opened_at: null, amount: 2 }]);
    expect(table.rows[0].cells).toEqual([
      { key: 'matter_name', text: 'A', href: null },
      { key: 'client_name', text: null, href: null },
      { key: 'opened_at', text: 'Aug 3, 2026', href: null },
      { key: 'amount', text: '$1,251', href: null },
    ]);
  });

  test('the matter opens its workspace when the row carries a workspace or matter id', () => {
    const table = V.recordsTable([{ matter_id: UUID, matter_name: 'Smith estate' }]);
    expect(table.columns.map((c) => c.key)).toEqual(['matter_name']);
    expect(table.rows[0].cells[0]).toEqual({ key: 'matter_name', text: 'Smith estate', href: 'workspace-details.html?id=' + UUID });
  });

  test('no rows, no columns', () => {
    expect(V.recordsTable([])).toEqual({ columns: [], rows: [] });
  });
});

describe('formatValue', () => {
  test('uses the format and unit, never raw decimals', () => {
    expect(V.formatValue(301.74, { format: 'days' })).toBe('301.7 days');
    expect(V.formatValue(1, { format: 'days' })).toBe('1 day');
    expect(V.formatValue(5388.89, { format: 'currency' })).toBe('$5,389');
    expect(V.formatValue(38.456, { format: 'percentage' })).toBe('38.5%');
    expect(V.formatValue(916, { format: 'integer' })).toBe('916');
    expect(V.formatValue(12.345, { format: 'number', unit: 'months' })).toBe('12.3 months');
    expect(V.formatValue(0, { format: 'currency' })).toBe('$0');
    expect(V.formatValue(null, { format: 'currency' })).toBe(null);
  });
});

describe('summary', () => {
  test('current, the change both ways, and the prior period with its dates', () => {
    const s = V.summary({ current: { value: 301.74, format: 'days' },
      comparison: { previous_value: 300.7, absolute_change: 1.04, percent_change: 0.35, direction: 'up',
        previous_period: { start: '2025-02-07T05:00:00.000Z', end: '2026-01-01T05:00:00.000Z' } } });
    expect(s).toEqual({
      value: '301.7 days', direction: 'up', changeText: 'Up 0.3%, +1.0 days', priorText: 'vs 300.7 days in the prior period',
      priorDays: { start: '2025-02-07', end: '2025-12-31' }, bars: { currentPct: 100, priorPct: 99.7 },
    });
  });

  test('the real sample: down 85.1%, 205 fewer', () => {
    const s = V.summary(detail);
    expect(s.value).toBe('36');
    expect(s.changeText).toBe('Down 85.1%, -205');
    expect(s.priorText).toBe('vs 241 in the prior period');
    expect(s.bars).toEqual({ currentPct: 14.9, priorPct: 100 });
  });

  test('no comparison: just the value', () => {
    expect(V.summary({ current: { value: 5, format: 'integer' }, comparison: null }))
      .toEqual({ value: '5', direction: null, changeText: null, priorText: null, priorDays: null, bars: null });
  });

  test('older payloads with movement read the same', () => {
    const s = V.summary({ current: { value: 10, format: 'integer' }, movement: { prior_value: 8, percent_change: 25, direction: 'up' } });
    expect(s.changeText).toBe('Up 25%, +2');
  });
});

test('dayRangeText names two plain days', () => {
  expect(V.dayRangeText({ start: '2025-02-07', end: '2025-12-31' })).toBe('Feb 7, 2025 to Dec 31, 2025');
  expect(V.dayRangeText(null)).toBe('');
});

test('cellText is the one formatter the records table uses', () => {
  expect(V.cellText('2026-08-03T16:43:22.716Z', 'date')).toBe('Aug 3, 2026');
  expect(V.cellText('', 'text')).toBe(null);
  expect(V.cellText(1250.5, 'number')).toBe('1,250.5');
});

describe('cell formatting the worklist and the records table share', () => {
  const rows = [
    { matter_name: 'Estate', product: 'uncategorized', payment_step: 'payment_2', item_kind: 'invoice', due_date: '2023-07-18T04:00:00Z',
      expected_amount: '2750', invoice_number: '1080', service_offering: 'estate_planning', source: 'ActionStep API' },
    { matter_name: 'Trust', product: 'trust_based_plan', payment_step: 'payment_1', item_kind: 'invoice', due_date: '2023-08-01T04:00:00Z',
      expected_amount: '1250.5', invoice_number: '1081', service_offering: 'uncategorized', source: 'ActionStep API' },
  ];
  const table = V.recordsTable(rows);
  const col = (key) => table.columns.find((c) => c.key === key);
  const cell = (i, key) => table.rows[i].cells.find((c) => c.key === key).text;

  test('amount-like fields are money, right-aligned, even when the server sends strings', () => {
    expect(col('expected_amount')).toMatchObject({ type: 'money', align: 'right' });
    expect(cell(0, 'expected_amount')).toBe('$2,750');
    expect(cell(1, 'expected_amount')).toBe('$1,251');
  });

  test('a numeric string that is not an amount stays as it is', () => {
    expect(col('invoice_number')).toMatchObject({ type: 'text', align: 'left' });
    expect(cell(0, 'invoice_number')).toBe('1080');
  });

  test('snake_case values read as words; "uncategorized" reads "Not mapped" only on product or service fields', () => {
    expect(cell(0, 'payment_step')).toBe('Payment 2');
    expect(cell(0, 'item_kind')).toBe('Invoice');
    expect(cell(0, 'product')).toBe('Not mapped');
    expect(cell(1, 'product')).toBe('Trust based plan');
    expect(cell(1, 'service_offering')).toBe('Not mapped');
    expect(cell(0, 'source')).toBe('ActionStep API');
    expect(V.cellText('uncategorized', 'enum', 'category')).toBe('Uncategorized');
  });

  test('dates as days; numbers right-aligned', () => {
    expect(cell(0, 'due_date')).toBe('Jul 18, 2023');
    expect(V.recordsTable([{ days: 4 }, { days: 12 }]).columns[0]).toMatchObject({ type: 'number', align: 'right' });
  });

  test('worklistColumns: up to four, names and dates and amounts before the rest', () => {
    expect(V.worklistColumns(table.columns, 4).map((c) => c.key)).toEqual(['matter_name', 'due_date', 'expected_amount', 'product']);
  });
});
