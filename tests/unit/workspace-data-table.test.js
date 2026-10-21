const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const table = require(path.join(SRC, 'js/shared/workspace-data-table.js'));

function params(query, options) {
  return Object.fromEntries(table.buildQueryParams(query, options).entries());
}

describe('workspace-data-table', () => {
  describe('buildQueryParams', () => {
    test('maps page, size and sort to the connected-data API', () => {
      expect(params({ page: 3, limit: 50, sortBy: 'external_id', sortDir: 'asc', filters: {} })).toEqual({
        page: '3', limit: '50', sort_by: 'external_id', sort_dir: 'asc'
      });
    });

    test('defaults to newest synced first and ignores unknown sort columns', () => {
      expect(params({})).toEqual({ page: '1', limit: '20', sort_by: 'synced_at', sort_dir: 'desc' });
      expect(params({ sortBy: 'raw_data', sortDir: 'sideways' }).sort_by).toBe('synced_at');
      expect(params({ sortBy: 'raw_data', sortDir: 'sideways' }).sort_dir).toBe('desc');
      expect(params({ sortBy: 'created_at' }).sort_by).toBe('created_at');
    });

    test('sends the toolbar search and single-choice column filters', () => {
      const result = params({
        filters: {
          entity_type: { operator: 'in', value: ['lead'] },
          connector_id: { operator: 'in', value: ['manual'] },
          external_id: { operator: 'contains', value: ' 0042 ' },
          raw_data: { operator: 'contains', value: 'Avery' }
        }
      }, { search: '  stone ' });
      expect(result).toMatchObject({
        search: 'stone',
        entity_type: 'lead',
        connector_id: 'manual',
        external_id: '0042',
        data_contains: 'Avery'
      });
    });

    test('maps the Synced and Created ranges to *_after / *_before', () => {
      const bounds = (value) => (value === '7d' ? { after: 'A', before: '' } : value === 'older' ? { after: '', before: 'B' } : {});
      const result = params({
        filters: {
          synced_at: { operator: 'in', value: ['7d'] },
          created_at: { operator: 'in', value: ['older'] }
        }
      }, { rangeBounds: bounds });
      expect(result.synced_after).toBe('A');
      expect(result.synced_before).toBeUndefined();
      expect(result.created_before).toBe('B');
      expect(result.created_after).toBeUndefined();
    });

    test('every sortable column has an API sort name', () => {
      table.SORTABLE_COLUMNS.forEach((col) => expect(table.SORT_BY_COLUMN[col]).toBeTruthy());
      expect(table.COLUMNS).toEqual(expect.arrayContaining(table.SORTABLE_COLUMNS));
      expect(table.LABELS[table.COLUMNS.indexOf('created_at')]).toBe('Created');
    });
  });

  test('readQueryState reads the deep link', () => {
    expect(table.readQueryState('?id=M-1&entity_type=lead&connector_id=manual&search=Avery&page=2')).toEqual({
      entityType: 'lead', connectorId: 'manual', search: 'Avery', page: 2
    });
    expect(table.readQueryState('?entity=task&connector=hubspot&page=0')).toEqual({
      entityType: 'task', connectorId: 'hubspot', search: '', page: 1
    });
  });

  test('mapRow keeps raw values and the record', () => {
    const record = {
      id: 'r1', external_id: 'row-000123456', entity_type: 'lead_source', connector_id: 'gsheets',
      data: { row_data: { name: 'Avery' } }, synced_at: '2026-10-01T10:00:00Z', created_at: '2026-09-01T10:00:00Z'
    };
    const row = table.mapRow(record);
    expect(row).toMatchObject({
      id: 'r1',
      external_id: 'row-000123456',
      entity_type: 'lead_source',
      connector_id: 'gsheets',
      synced_at: '2026-10-01T10:00:00Z',
      created_at: '2026-09-01T10:00:00Z'
    });
    expect(row.raw_data).toBe(record.data);
    expect(row._raw).toBe(record);
  });

  test('dataSummary uses row_data, or the non-internal fields', () => {
    expect(table.dataSummary({ row_data: { a: 1, b: '', c: 'x', d: 'y', e: 'z' } })).toBe('a: 1  |  c: x  |  d: y');
    expect(table.dataSummary({ _sheet: 's', name: 'Avery' })).toBe('name: Avery');
    expect(table.dataSummary(null)).toBe('');
  });

  test('mergeFacetOptions keeps values the API stopped listing', () => {
    const label = (v) => v.toUpperCase();
    const first = table.mergeFacetOptions([], [{ entity_type: 'lead', count: '4' }, { entity_type: 'task', count: '1' }], 'entity_type', label);
    expect(first).toEqual([
      { value: 'lead', label: 'LEAD', count: 4 },
      { value: 'task', label: 'TASK', count: 1 }
    ]);
    const narrowed = table.mergeFacetOptions(first, [{ entity_type: 'task', count: '1' }], 'entity_type', label);
    expect(narrowed.map((o) => o.value)).toEqual(['lead', 'task']);
  });

  test('emptyText reflects filtering', () => {
    expect(table.emptyText(false)).toBe('No connected data yet');
    expect(table.emptyText(true)).toMatch(/No matching records/);
  });

  describe('cellRenderers', () => {
    beforeAll(() => {
      global.Lex = {
        Utils: {
          formatDateTime: (v) => 'DT(' + v + ')',
          humanizeLabel: (v) => {
            const t = String(v).split('_').join(' ');
            return t.charAt(0).toUpperCase() + t.slice(1);
          }
        }
      };
    });
    afterAll(() => { delete global.Lex; });

    const render = (col, record, options) => {
      const row = table.mapRow(record);
      return table.cellRenderers(options)[col](row[col], row, col);
    };

    test('ID shows the tail of long ids with the full id in the title and a selection box', () => {
      const html = render('external_id', { id: 'r1', external_id: 'row-000123456' }, { isSelected: (id) => id === 'r1' });
      expect(html).toContain('…123456');
      expect(html).toContain('title="row-000123456"');
      expect(html).toContain('data-ws-select="r1" checked');
      expect(render('external_id', { id: 'r2' })).toContain('—');
    });

    test('entity type is humanized with a Removed badge for source-deleted records', () => {
      expect(render('entity_type', { id: 'r1', entity_type: 'lead_source' })).toContain('Lead source');
      const removed = render('entity_type', { id: 'r1', entity_type: 'lead', source_deleted: true });
      expect(removed).toContain('<lex-badge label="Removed"');
      expect(removed).toContain('ws-data-cell--removed');
    });

    test('connector links to the connector viewer when it has a UI, else plain text', () => {
      const linked = render('connector_id', { id: 'r1', connector_id: 'hubspot', connector_name: 'HubSpot', connector_ui_url: '/ui/hs' });
      expect(linked).toContain('href="integrations/connector-viewer.html?ui=%2Fui%2Fhs&amp;name=HubSpot');
      expect(linked).toContain('>HubSpot</a>');
      expect(render('connector_id', { id: 'r1' })).toContain('>LANA</span>');
    });

    test('dates go through Lex.Utils.formatDateTime, empty dates are a muted dash', () => {
      expect(render('created_at', { id: 'r1', created_at: '2026-09-01T10:00:00Z' })).toContain('DT(2026-09-01T10:00:00Z)');
      expect(render('synced_at', { id: 'r1' })).toContain('ws-data-cell-muted');
    });

    test('action cell has the chat button and annotation badges', () => {
      const html = render('ai_action', { id: 'r1', annotation_count: 2, has_corrections: true });
      expect(html).toContain('data-ai-row="r1"');
      expect(html).toContain('title="2 annotations"');
      expect(html).toContain('Has corrections');
    });

    test('escapes record content', () => {
      expect(render('raw_data', { id: 'r1', data: { name: '<b>x</b>' } })).not.toContain('<b>');
    });
  });

  test('page markup follows the table standard', () => {
    const html = fs.readFileSync(path.join(SRC, 'workspace-data.html'), 'utf8');
    const tag = html.match(/<lex-table[\s\S]*?id="wsDataTable"[\s\S]*?><\/lex-table>/)[0];
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('server-paging');
    expect(tag).not.toMatch(/\s(searchable|filterable|compact|paginated|page-size)[\s=>]/);
    expect(tag).toContain('columns="' + table.COLUMNS.join(',') + '"');
    expect(html).not.toContain('wsDataPagination');
    expect(html.match(/id="wsDataSearch"/g)).toHaveLength(1);
    expect(html).toContain('js/shared/workspace-data-table.js');
    expect(html).toContain('js/shared/library-column-filters.js');
    expect(html).toContain('js/lex/components/form/lex-input.js');
  });
});
