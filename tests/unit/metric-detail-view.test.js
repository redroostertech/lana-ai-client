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

describe('row_columns from the server', () => {
  const rows = [
    { matter_ref: 'm-1', matter_name: 'Estate', product: 'uncategorized', due_date: '2023-07-18T04:00:00Z', expected_amount: '2750', item_kind: 'invoice' },
    { matter_ref: 'm-2', matter_name: 'Trust', product: 'trust_based_plan', due_date: '2023-08-01T04:00:00Z', expected_amount: '1250', item_kind: 'payment_plan' },
  ];
  const rowColumns = [
    { field: 'item_kind', header: 'Kind', labels: { invoice: 'Bill', payment_plan: 'Payment plan step' } },
    { field: 'due_date', header: 'Due', format: 'date' },
    { field: 'expected_amount', header: 'Amount due', format: 'currency', align: 'right' },
    { field: 'product', header: 'Service' },
  ];

  test('only those columns, in that order, with their headers, formats and alignment', () => {
    const table = V.recordsTable(rows, rowColumns);
    expect(table.columns.map((c) => [c.key, c.label, c.type, c.align])).toEqual([
      ['item_kind', 'Kind', 'enum', 'left'], ['due_date', 'Due', 'date', 'left'], ['expected_amount', 'Amount due', 'money', 'right'], ['product', 'Service', 'enum', 'left'],
    ]);
    expect(table.rows[0].cells.map((c) => c.text)).toEqual(['Bill', 'Jul 18, 2023', '$2,750', 'Not mapped']);
    expect(table.rows[1].cells.map((c) => c.text)).toEqual(['Payment plan step', 'Aug 1, 2023', '$1,250', 'Trust based plan']);
  });

  test('a value with no label falls back to the humanised value', () => {
    const table = V.recordsTable([{ item_kind: 'credit_note' }], [{ field: 'item_kind', header: 'Kind', labels: { invoice: 'Bill' } }]);
    expect(table.rows[0].cells[0].text).toBe('Credit note');
  });

  test('null or empty row_columns keeps the inference', () => {
    expect(V.recordsTable(rows, null).columns.map((c) => c.key)).toEqual(V.recordsTable(rows).columns.map((c) => c.key));
    expect(V.recordsTable(rows, []).columns.length).toBeGreaterThan(0);
  });

  test('formatCell applies labels first', () => {
    expect(V.formatCell('invoice', { key: 'item_kind', type: 'enum', labels: { invoice: 'Bill' } })).toBe('Bill');
    expect(V.formatCell('', { key: 'x', type: 'text' })).toBe(null);
  });
});

test('worklistColumns keeps every column the server chose, in its order', () => {
  const cols = V.recordsTable([{ a: 1, b: 2, c: 3, d: 4, e: 5 }], ['e', 'd', 'c', 'b', 'a'].map((f) => ({ field: f, header: f.toUpperCase() }))).columns;
  expect(V.worklistColumns(cols, 4).map((c) => c.key)).toEqual(['e', 'd', 'c', 'b', 'a']);
});

describe('rowsStatus: could the server read the records?', () => {
  test('missing rows_status means the rows were read (today\'s behaviour)', () => {
    expect(V.rowsStatus({ rows: [] })).toBe(null);
    expect(V.rowsStatus(null)).toBe(null);
    expect(V.rowsStatus(undefined)).toBe(null);
  });

  test('available: true means the rows were read, even when there are none', () => {
    expect(V.rowsStatus({ rows: [], rows_status: { available: true } })).toBe(null);
  });

  test('available: false gives the calm title and the server message', () => {
    expect(V.rowsStatus({ rows: [], rows_status: { available: false, reason: 'governed', message: 'These records are kept private by your firm settings.' } })).toEqual({
      reason: 'governed', title: 'Records not available for this card', message: 'These records are kept private by your firm settings.',
    });
  });

  test('available: false without a message still gives a plain sentence', () => {
    const status = V.rowsStatus({ rows_status: { available: false, reason: 'module_unavailable' } });
    expect(status.title).toBe('Records not available for this card');
    expect(status.message).toBe('LANA could not read the records behind this number.');
  });

  test('unavailableHtml is a calm note with the title and escaped message', () => {
    const html = V.unavailableHtml({ title: 'Records not available for this card', message: 'Bills & payments <synced>' });
    expect(html).toBe('<div class="records-unavailable"><p class="records-unavailable__title">Records not available for this card</p>'
      + '<p class="records-unavailable__text">Bills &amp; payments &lt;synced&gt;</p></div>');
  });
});

test('summary: a null value is no data, with no change, prior or bars', () => {
  const s = V.summary({ current: { value: null }, comparison: { previous_value: 5, percent_change: 10, direction: 'up' } });
  expect(s).toMatchObject({ noData: true, value: 'No data for these dates', changeText: null, priorText: null, bars: null });
  expect(V.summary({ current: { value: 0 } }).noData).toBeFalsy();
});

test('periodText: the backend label, else the picked dates, else nothing', () => {
  expect(V.periodText({ label: 'Oct 1, 2026 - Oct 31, 2026' }, '2026-11-18', '2026-11-24')).toBe('Oct 1, 2026 - Oct 31, 2026');
  expect(V.periodText(null, '2026-11-18', '2026-11-24')).toBe('Nov 18, 2026 to Nov 24, 2026');
  expect(V.periodText(null, null, null)).toBe('');
});

test('summary: a hidden comparison gives its message and no change, prior or bars', () => {
  const s = V.summary({ current: { value: 12 }, comparison: null, comparison_hidden: { reason: 'source_stale', message: 'No comparison while the source is behind.' } });
  expect(s).toMatchObject({ value: '12', changeText: null, priorText: null, bars: null, hiddenText: 'No comparison while the source is behind.' });
  expect(V.summary({ current: { value: 12 } }).hiddenText).toBeFalsy();
});

describe('units come from the server, singular included', () => {
  test('the server formatted value wins ("1 case"), never "1 cases"', () => {
    expect(V.summary({ current: { value: 1, unit: 'cases', formatted_value: '1 case' } }).value).toBe('1 case');
  });
  test('a server unit is used exactly as sent, with no client plural', () => {
    expect(V.summary({ current: { value: 1, unit: 'case' } }).value).toBe('1 case');
    expect(V.formatValue(1, { unit: 'case' })).toBe('1 case');
  });
});

test('summary: comparison_hidden is read from the top level only', () => {
  const hidden = { reason: 'source_stale', message: 'No comparison while the source is behind.' };
  expect(V.summary({ current: { value: 12, comparison_hidden: hidden } }).hiddenText).toBeFalsy();
});

describe('metric detail records: reasons, dates, conflicts and fixes', () => {
  const conflictRow = {
    record_id: 'r-1', row_date: '2026-11-20', row_reason: 'Won on Nov 20 with no amount.', client_name: 'Jordan Smith', amount: null,
    refs: [{ object: 'deal', id: 'd-1' }],
    conflict: { flag_annotation_id: 'f-1', detected_at: '2026-11-21T10:00:00Z', fields: [{ field_key: 'monetaryValue', standard_key: 'amount',
      lana_value: 4500, previous_source_value: 4500, new_source_value: 3000, source_changed_at: '2026-11-21T09:00:00Z' }] },
  };
  const fixedRow = { record_id: 'r-2', row_date: '2026-11-18', row_reason: 'Won on Nov 18.', client_name: 'Casey Lee', amount: 2000, fixed_in_lana: { fields: ['amount'] } };

  test('row_reason, conflict, fixed_in_lana and refs are not columns; a Notes column is added; row_date reads as Date', () => {
    const t = V.recordsTable([conflictRow, fixedRow]);
    expect(t.columns.map((c) => c.key)).toEqual(['row_date', 'client_name', 'amount', '_notes']);
    expect(t.columns.find((c) => c.key === 'row_date').label).toBe('Date');
    expect(t.columns[3]).toMatchObject({ key: '_notes', label: 'Notes', type: 'notes' });
  });

  test('server columns get the Notes column too, and no Notes without reasons', () => {
    expect(V.recordsTable([conflictRow], [{ field: 'client_name', header: 'Client' }]).columns.map((c) => c.key)).toEqual(['client_name', '_notes']);
    expect(V.recordsTable([{ client_name: 'A' }]).columns.map((c) => c.key)).toEqual(['client_name']);
  });

  test('rowNotes: the reason, the conflict with both values, and the fixed mark', () => {
    expect(V.rowNotes(conflictRow)).toEqual({
      reason: 'Won on Nov 20 with no amount.',
      conflict: { fields: [{ label: 'Amount', lana: '$4,500', source: '$3,000', previous: '$4,500' }] },
      fixed: null,
    });
    expect(V.rowNotes(fixedRow)).toEqual({ reason: 'Won on Nov 18.', conflict: null, fixed: ['Amount'] });
    expect(V.rowNotes({ a: 1 })).toEqual({ reason: '', conflict: null, fixed: null });
  });

  test('the server order is kept when rows carry row_date or conflicts', () => {
    expect(V.keepsServerOrder([conflictRow, fixedRow])).toBe(true);
    expect(V.keepsServerOrder([{ client_name: 'A', due_date: '2026-01-01' }])).toBe(false);
  });

  test('records header: as of, the basis label and the conflicts summary', () => {
    const payload = { as_of: '2026-11-24T08:00:00Z', raw_data: { rows: [], rows_basis: { basis: 'won_on', as_of: '2026-11-24', start_date: '2026-11-01', end_date: '2026-11-30', label: 'Deals won between Nov 1 and Nov 30, 2026' },
      conflicts: { count: 3, message: '3 records disagree with what your CRM says now.' }, pinned_count: 3, corrected_count: 1 } };
    expect(V.recordsHeader(payload)).toEqual({ asOf: 'As of Nov 24, 2026', basis: 'Deals won between Nov 1 and Nov 30, 2026',
      conflicts: '3 records disagree with what your CRM says now. 3 shown first. 1 fixed in LANA.' });
    expect(V.recordsHeader({ raw_data: { rows: [] } })).toEqual({ asOf: '', basis: '', conflicts: '' });
    expect(V.recordsHeader({ raw_data: { conflicts: { count: 1 } } }).conflicts).toBe('1 record disagrees with its source.');
  });
});

test('final contract: pinned_count and corrected_count are read from raw_data only; the conflict names its source', () => {
  const header = V.recordsHeader({ raw_data: { conflicts: { count: 2, message: 'Two disagree.', pinned_count: 9 }, pinned_count: 2, corrected_count: 1 } });
  expect(header.conflicts).toBe('Two disagree. 2 shown first. 1 fixed in LANA.');
  expect(V.recordsHeader({ raw_data: { conflicts: { count: 2, message: 'Two disagree.', pinned_count: 9, corrected_count: 4 } } }).conflicts).toBe('Two disagree.');
  const notes = V.rowNotes({ conflict: { source_name: 'ActionStep', fields: [{ standard_key: 'amount', lana_value: 4500, new_source_value: 3000 }] } });
  expect(notes.conflict.fields[0].sourceName).toBe('ActionStep');
});

test('a Date column (row_date) that repeats another date column on every row is hidden', () => {
  const rows = [
    { deal_name: 'A', decided_on: '2026-11-20', row_date: '2026-11-20', row_reason: 'Won.' },
    { deal_name: 'B', decided_on: '2026-11-18T00:00:00Z', row_date: '2026-11-18', row_reason: 'Won.' },
  ];
  expect(V.recordsTable(rows).columns.map((c) => c.key)).toEqual(['deal_name', 'decided_on', '_notes']);
  expect(V.recordsTable(rows, [{ field: 'deal_name', header: 'Deal name' }, { field: 'decided_on', header: 'Decided', format: 'date' }, { field: 'row_date', header: 'Date', format: 'date' }])
    .columns.map((c) => c.key)).toEqual(['deal_name', 'decided_on', '_notes']);
  const differs = rows.map((r, i) => Object.assign({}, r, { decided_on: i ? '2026-11-01' : r.decided_on }));
  expect(V.recordsTable(differs).columns.map((c) => c.key)).toEqual(['deal_name', 'decided_on', 'row_date', '_notes']);
});

test('days counts read "N days" (days_waiting, *_days, days)', () => {
  const t = V.recordsTable([{ deal_name: 'A', days_waiting: 12 }, { deal_name: 'B', days_waiting: 1 }]);
  expect(t.rows.map((r) => r.cells[1].text)).toEqual(['12 days', '1 day']);
  expect(V.recordsTable([{ open_days: 3 }]).rows[0].cells[0].text).toBe('3 days');
  expect(V.recordsTable([{ amount: 3 }]).rows[0].cells[0].text).toBe('$3');
});
