'use strict';

/**
 * Firm Reporting record tables on the table standard (docs/TABLE-STANDARD.md):
 * lead drilldown paging and rows, "table" visualization and imported report
 * results (raw rows, renderers, header filters), and the page contract.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });

function load() {
  const win = { localStorage: { getItem: () => STORED_USER }, Intl, Date, URLSearchParams };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/reporting-tables.js'))(win);
  return win.ReportingTables;
}

const T = load();

describe('lead drilldown', () => {
  test('maps connector records to raw rows', () => {
    const row = T.mapLead({
      id: 7,
      source_created_at: '2026-10-01T12:00:00Z',
      created_at: '2026-10-02T00:00:00Z',
      data: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', company: 'Engines' }
    });
    expect(row).toMatchObject({
      id: '7', name: 'Ada Lovelace', email: 'ada@example.com', phone: '', company: 'Engines',
      created_at: '2026-10-01T12:00:00Z'
    });
    expect(row._raw.id).toBe(7);
    expect(T.mapLead({ id: 1, created_at: '2026-01-01T00:00:00Z', data: { name: 'Bo' } }))
      .toMatchObject({ name: 'Bo', created_at: '2026-01-01T00:00:00Z' });
  });

  test('query carries source, period and limit/offset', () => {
    const q = new URLSearchParams(T.leadQuery('Google Ads', '2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z', 500, 500));
    expect(q.get('entity_type')).toBe('contact');
    expect(q.get('source')).toBe('Google Ads');
    expect(q.get('start_date')).toBe('2026-10-01T00:00:00Z');
    expect(q.get('end_date')).toBe('2026-10-31T23:59:59Z');
    expect(q.get('limit')).toBe('500');
    expect(q.get('offset')).toBe('500');
  });

  test('reads pages until a short page, with no hidden cap', async () => {
    const urls = [];
    const page = (n) => Array.from({ length: n }, (_, i) => ({ id: urls.length * 1000 + i, data: {} }));
    const get = jest.fn(async (url) => {
      urls.push(url);
      return { data: urls.length < 3 ? page(T.LEAD_PAGE_SIZE) : page(3) };
    });
    const result = await T.loadAllLeads(get, 'Web', '', '');
    expect(get).toHaveBeenCalledTimes(3);
    expect(result.rows).toHaveLength(T.LEAD_PAGE_SIZE * 2 + 3);
    expect(result.truncated).toBe(false);
    expect(new URLSearchParams(urls[2].split('?')[1]).get('offset')).toBe(String(T.LEAD_PAGE_SIZE * 2));
  });

  test('stops at the page ceiling and reports it', async () => {
    const get = async () => ({ data: Array.from({ length: T.LEAD_PAGE_SIZE }, () => ({ data: {} })) });
    const result = await T.loadAllLeads(get, 'Web', '', '');
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(T.LEAD_PAGE_SIZE * T.LEAD_MAX_PAGES);
  });

  test('every column has a filter and Created formats through Lex.Utils', () => {
    const filters = T.leadFilterOptions();
    T.LEAD_TABLE.columns.forEach((col) => expect(filters[col]).toBeTruthy());
    expect(filters.name.text).toBe(true);
    expect(filters.created_at.single).toBe(true);
    expect(filters.created_at.options.map((o) => o.value)).toEqual(['today', '7d', '30d', 'older']);
    expect(T.LEAD_TABLE.labels[T.LEAD_TABLE.columns.indexOf('created_at')]).toBe('Created');

    const r = T.leadRenderers();
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('1/20/2026 3:16 PM');
    expect(r.email('')).toContain('—');
    expect(r.name('<b>x</b>')).not.toContain('<b>');
  });
});

describe('"table" visualization', () => {
  const metricRows = [
    { label: 'Referral', count: '12', value: 40.5 },
    { label: 'Web', count: 30, value: '59.5' }
  ];

  test('default columns, numeric strings become numbers', () => {
    const cols = T.breakdownColumns({}, metricRows);
    expect(cols.map((c) => c.field)).toEqual(['label', 'count', 'value']);
    expect(cols.map((c) => c.kind)).toEqual(['text', 'number', 'number']);
    const row = T.mapBreakdownRow(metricRows[0], cols, 0);
    expect(row).toMatchObject({ _id: '0', label: 'Referral', count: 12, value: 40.5 });
    expect(row._raw).toBe(metricRows[0]);
  });

  test('configured columns keep their headers; renderers format, rows stay raw', () => {
    const cols = T.breakdownColumns({ columns: [{ field: 'practice_area' }, { field: 'total', header: 'Paid total', format: 'currency' }] },
      [{ practice_area: 'Family', total: '1500.4' }]);
    expect(cols.map((c) => c.header)).toEqual(['Practice area', 'Paid total']);
    const r = T.breakdownRenderers(cols);
    expect(r.total(1500.4)).toContain('$1,500');
    expect(r.practice_area('Family')).toContain('admin-table-name');
    const pct = T.breakdownRenderers(T.breakdownColumns({}, metricRows));
    expect(pct.value(40.5)).toContain('40.5%');
  });

  test('every column filters: text values or contains, numbers by range', () => {
    const cols = T.breakdownColumns({}, metricRows);
    const rows = metricRows.map((r, i) => T.mapBreakdownRow(r, cols, i));
    const f = T.breakdownFilterOptions(cols, rows);
    expect(f.label.options.map((o) => o.value)).toEqual(['Referral', 'Web']);
    expect(f.count.single).toBe(true);
    expect(f.count.match(12, ['10:100'])).toBe(true);
    expect(f.count.match(12, [':1'])).toBe(false);
    expect(f.value.options[0].label).toBe('Under 25%');
    expect(f.value.match(59.5, ['50:75'])).toBe(true);

    const many = Array.from({ length: 20 }, (_, i) => ({ label: 'L' + i, count: i, value: i }));
    const manyRows = many.map((r, i) => T.mapBreakdownRow(r, cols, i));
    expect(T.breakdownFilterOptions(cols, manyRows).label).toEqual({ text: true, placeholder: 'Label contains...' });
  });

  test('number ranges grow with the data', () => {
    expect(T.numberRangeOptions([5, 12000]).map((o) => o.value)).toEqual([':1', '1:10', '10:100', '100:1000', '1000:10000', '10000:']);
    expect(T.inNumberRange('7', '1:10')).toBe(true);
    expect(T.inNumberRange(10, '1:10')).toBe(false);
    expect(T.inNumberRange(null, '1:')).toBe(false);
  });
});

describe('imported report results', () => {
  const rows = [
    { matter_type: 'family', row_count: '4', created_at: '2026-10-01T10:00:00Z' },
    { matter_type: 'estate', row_count: 2, created_at: '2026-10-03T10:00:00Z', extra: 'x' }
  ];

  test('columns are every key, humanized, with created_at labelled Created', () => {
    const cols = T.resultColumns(rows);
    expect(cols.map((c) => c.field)).toEqual(['matter_type', 'row_count', 'created_at', 'extra']);
    expect(cols.map((c) => c.header)).toEqual(['Matter type', 'Row count', 'Created', 'Extra']);
    expect(cols.map((c) => c.kind)).toEqual(['text', 'number', 'date', 'text']);
  });

  test('rows keep raw values; all rows, no 100-row cap', () => {
    const big = Array.from({ length: 250 }, (_, i) => ({ n: i }));
    const cols = T.resultColumns(big);
    expect(big.map((r, i) => T.mapResultRow(r, cols, i))).toHaveLength(250);
    const row = T.mapResultRow(rows[0], T.resultColumns(rows), 0);
    expect(row).toMatchObject({ matter_type: 'family', row_count: 4, created_at: '2026-10-01T10:00:00Z', extra: '' });
  });

  test('every column has a filter; dates use the Created ranges', () => {
    const cols = T.resultColumns(rows);
    const mapped = rows.map((r, i) => T.mapResultRow(r, cols, i));
    const f = T.resultFilterOptions(cols, mapped);
    cols.forEach((c) => expect(f[c.field]).toBeTruthy());
    expect(f.created_at.options.map((o) => o.value)).toEqual(['today', '7d', '30d', 'older']);
    expect(typeof f.created_at.match).toBe('function');
    expect(f.matter_type.options.map((o) => o.value)).toEqual(['estate', 'family']);
    expect(T.resultRenderers(cols).created_at('2026-10-01T10:00:00Z')).toContain('10/1/2026');
  });
});

describe('page contract', () => {
  const html = read('admin/reporting.html');
  const js = read('js/admin/reporting.js');

  test('no hand-built tables, native selects or browser dialogs remain outside the kept summary tables', () => {
    expect(html).not.toMatch(/<select\b/);
    expect(js).not.toMatch(/<select\b/);
    expect(js).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
    expect(js).not.toMatch(/window\.(alert|confirm|prompt)\(/);
    // Kept plain: top-N tag/journey/campaign/landing breakdowns (4) in reporting.js,
    // the missing-entities list in reporting.html.
    expect((js.match(/<table\b/g) || []).length).toBe(4);
    expect((html.match(/<table\b/g) || []).length).toBe(1);
  });

  test('drilldown and customize overlays are lex components; table scripts load', () => {
    expect(html).toMatch(/<lex-modal id="drilldownModal"/);
    expect(html).toMatch(/<lex-drawer id="customizePanel"/);
    expect(html).not.toContain('customizeOverlay');
    ['lex-table.js', 'admin-table-kit.js', 'library-column-filters.js', 'reporting-tables.js', 'admin-tables.css']
      .forEach((file) => expect(html).toContain(file));
    expect(html.indexOf('reporting-tables.js')).toBeLessThan(html.indexOf('admin/reporting.js'));
  });
});
