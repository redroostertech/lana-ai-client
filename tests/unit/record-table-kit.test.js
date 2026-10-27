const path = require('path');

const SRC = path.join(__dirname, '../../src');

global.window = global;
global.LanaLibraryColumnFilters = require(path.join(SRC, 'js/shared/library-column-filters.js'));
const kit = require(path.join(SRC, 'insights/js/record-table-kit.js'));

const spec = {
  id: 'leadsTable',
  title: 'Leads',
  noun: ['lead', 'leads'],
  sortBy: 'created_at',
  sortDir: 'desc',
  minWidth: 800,
  columns: [
    { key: 'name', label: 'Name', kind: 'name' },
    { key: 'email', label: 'Email', kind: 'email', width: '22%' },
    { key: 'status', label: 'Status', kind: 'badge', colors: { qualified: 'green' }, labels: { not_qualified: 'Not qualified' } },
    { key: 'value', label: 'Value', kind: 'currency', ranges: [{ value: 'lt', label: 'Under $1,000', min: null, max: 1000 }, { value: 'none', label: 'No value' }] },
    { key: 'matter', label: 'Workspace', kind: 'matter', matterKey: 'matter_id' },
    { key: 'created_at', label: 'Created', kind: 'created' },
    { key: 'actions', label: '', kind: 'actions' }
  ]
};

describe('record-table-kit', () => {
  test('labels humanize codes with a leading capital', () => {
    expect(kit.label('in_progress')).toBe('In progress');
    expect(kit.label('lead-management')).toBe('Lead management');
    expect(kit.label('sync.completed')).toBe('Sync completed');
  });

  test('markup is a standard toolbar, heading and lex-table--card', () => {
    const html = kit.markup(spec);
    expect(html).toContain('id="leadsTableSearch"');
    expect(html).toContain('id="leadsTableSort"');
    expect(html).toContain('id="leadsTableSortOrder"');
    expect(html).toContain('id="leadsTableCount"');
    expect(html).toContain('id="leadsTableSectionCount"');
    expect(html).toContain('class="lex-table--card" column-filters');
    expect(html).not.toMatch(/\bsearchable\b|\bfilterable\b|\bcompact\b/);
    expect(html).toContain('columns="name,email,status,value,matter,created_at,actions"');
    expect(html).toContain('labels="Name,Email,Status,Value,Workspace,Created, "');
    expect(html).toContain('sortable-columns="name,email,status,value,matter,created_at"');
    expect(html).toContain('sort-by="created_at" sort-dir="desc"');
    expect(html).toContain('limit="20"');
    expect(html).not.toContain('server-paging');
    expect(kit.markup(Object.assign({}, spec, { serverPaging: true }))).toContain(' server-paging');
  });

  test('sort options use the column labels and skip actions', () => {
    expect(kit.sortOptionsFor(spec).map((o) => o.label)).toEqual(['Name', 'Email', 'Status', 'Value', 'Workspace', 'Created']);
  });

  test('every labelled column gets a filter', () => {
    const rows = [
      { id: 1, status: 'qualified', value: 500, created_at: new Date().toISOString() },
      { id: 2, status: 'not_qualified', value: null }
    ];
    const map = kit.filterOptionsFor(spec, rows);
    expect(Object.keys(map).sort()).toEqual(['created_at', 'email', 'matter', 'name', 'status', 'value']);
    expect(map.name).toEqual({ text: true, placeholder: 'Name contains...' });
    expect(map.status.options).toEqual([
      { value: 'not_qualified', label: 'Not qualified' },
      { value: 'qualified', label: 'Qualified' }
    ]);
    expect(map.created_at.single).toBe(true);
    expect(map.created_at.match(new Date().toISOString(), ['today'])).toBe(true);
    expect(map.value.match(500, ['lt'])).toBe(true);
    expect(map.value.match(1500, ['lt'])).toBe(false);
    expect(map.value.match(null, ['none'])).toBe(true);
    expect(map.value.match(null, ['lt'])).toBe(false);
  });

  test('number columns without ranges filter by presence', () => {
    const map = kit.filterOptionsFor({ columns: [{ key: 'n', label: 'N', kind: 'number' }] }, []);
    expect(map.n.match(0, ['has_value'])).toBe(true);
    expect(map.n.match('', ['no_value'])).toBe(true);
  });

  test('renderers format raw values and escape text', () => {
    const r = kit.renderersFor(spec);
    expect(r.name('<b>Ann</b>')).toContain('&lt;b&gt;Ann&lt;/b&gt;');
    expect(r.name('')).toContain('rtk-muted');
    expect(r.status('qualified')).toBe('<lex-badge label="Qualified" color="green"></lex-badge>');
    expect(r.status('not_qualified')).toContain('label="Not qualified" color="gray"');
    expect(r.value(1234)).toContain('$1,234');
    expect(r.matter('Smith v Jones', { matter_id: 'MATT-1' })).toContain('data-matter-id="MATT-1"');
    expect(r.matter('Loose name', {})).not.toContain('data-matter-id');
    expect(r.created_at('')).toContain('rtk-muted');
  });

  test('created cells use Lex.Utils.formatDateTime', () => {
    global.Lex = { Utils: { formatDateTime: () => '1/20/2026 3:16 PM', timeAgo: () => '2 hours ago' } };
    try {
      const html = kit.renderersFor(spec).created_at('2026-01-20T20:16:00Z');
      expect(html).toContain('1/20/2026 3:16 PM');
      expect(html).toContain('title="2 hours ago"');
    } finally {
      delete global.Lex;
    }
  });

  test('widths: min-width, nowrap headers, fixed Created width', () => {
    const css = kit.widthCss(spec);
    expect(css).toContain('#leadsTable table { min-width: 800px; }');
    expect(css).toContain('#leadsTable th { white-space: nowrap; }');
    expect(css).toContain('#leadsTable th:nth-child(2) { width: 22%; }');
    expect(css).toContain('#leadsTable th:nth-child(6) { width: 176px; }');
  });

  test('count text', () => {
    expect(kit.countText(1, ['lead', 'leads'])).toBe('1 lead');
    expect(kit.countText(1200, ['lead', 'leads'])).toBe('1,200 leads');
  });

  test('action buttons carry the row id', () => {
    expect(kit.actionButton('inspect', 'a"1', 'Inspect')).toBe('<button type="button" class="rtk-action" data-row-action="inspect" data-row-id="a&quot;1">Inspect</button>');
  });
});
