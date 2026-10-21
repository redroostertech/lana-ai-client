const path = require('path');

const SRC = path.join(__dirname, '../../src');

global.window = global;
global.LanaRecordTableKit = require(path.join(SRC, 'insights/js/record-table-kit.js'));
const tables = require(path.join(SRC, 'integrations/js/integration-tables.js'));

describe('integration-tables', () => {
  test('offset paging from a lex-table query', () => {
    expect(tables.offsetRequest({ page: 3, limit: 20 })).toEqual({ limit: 20, offset: 40 });
    expect(tables.offsetRequest({ page: 1, limit: 500 })).toEqual({ limit: 100, offset: 0 });
    expect(tables.offsetRequest({})).toEqual({ limit: 20, offset: 0 });
  });

  test('offset pagination back to a page', () => {
    expect(tables.offsetPagination({ total: 95, limit: 20, offset: 40 }, { page: 3, limit: 20 }, 20))
      .toEqual({ page: 3, limit: 20, total: 95 });
    expect(tables.offsetPagination(null, { page: 2, limit: 20 }, 5)).toEqual({ page: 2, limit: 20, total: 25 });
    expect(tables.pagePagination({ page: 2, limit: 25, total: 60 }, {}, 25)).toEqual({ page: 2, limit: 25, total: 60 });
  });

  test('sync log rows keep raw values', () => {
    const row = tables.syncLogRow({
      id: 7, sync_type: 'full', status: 'success', records: { processed: 10, created: 2, failed: 1 },
      started_at: '2026-10-01T10:00:00Z', completed_at: '2026-10-01T10:01:05Z'
    });
    expect(row).toMatchObject({ id: '7', sync_type: 'full', status: 'completed', processed: 10, created: 2, failed: 1, duration: 65, created_at: '2026-10-01T10:00:00Z' });
    expect(tables.syncLogRow({ sync_status: 'started', duration_ms: 4200 })).toMatchObject({ status: 'running', duration: 4 });
    expect(tables.syncLogRow({ connector_name: 'Leadly', records_synced: 3 })).toMatchObject({ connector: 'Leadly', processed: 3 });
  });

  test('durations', () => {
    expect(tables.formatDuration(5)).toBe('5s');
    expect(tables.formatDuration(65)).toBe('1m 5s');
    expect(tables.formatDuration(3720)).toBe('1h 2m');
    expect(tables.formatDuration(null)).toBe('');
  });

  test('sync log columns end with Created and every column has a label', () => {
    const cols = tables.syncLogColumns({ connector: true, error: true });
    expect(cols[0].key).toBe('connector');
    expect(cols[cols.length - 1]).toMatchObject({ key: 'created_at', label: 'Created', kind: 'created' });
    expect(cols.every((c) => c.label)).toBe(true);
    const map = global.LanaRecordTableKit.filterOptionsFor({ columns: cols }, []);
    expect(Object.keys(map)).toHaveLength(cols.length);
  });

  test('connector data params map sort, search and column filters', () => {
    const params = tables.connectorDataParams({
      page: 2, limit: 25, sortBy: 'created_at', sortDir: 'asc',
      filters: {
        entity_type: { operator: 'in', value: ['contact', 'opportunity'] },
        external_id: { operator: 'contains', value: 'abc' },
        matter_name: { operator: 'in', value: ['m-1'] },
        health: { operator: 'in', value: ['flagged'] }
      }
    }, { search: 'smith' });
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('25');
    expect(params.get('sort_by')).toBe('source_created_at');
    expect(params.get('sort_dir')).toBe('asc');
    expect(params.get('q')).toBe('smith');
    expect(params.get('entity_type')).toBeNull();
    expect(JSON.parse(params.get('filters'))).toEqual([
      { field: 'entity_type', operator: 'in', value: ['contact', 'opportunity'] },
      { field: 'external_id', operator: 'contains', value: 'abc' },
      { field: 'matter_id', operator: 'in', value: ['m-1'] },
      { field: 'has_flags', operator: 'equals', value: 'true' }
    ]);
  });

  test('a single entity type and unknown sort fall back cleanly', () => {
    const params = tables.connectorDataParams({ sortBy: 'nope', filters: { entity_type: { operator: 'in', value: ['contact'] } } });
    expect(params.get('entity_type')).toBe('contact');
    expect(params.get('sort_by')).toBe('synced_at');
    expect(params.get('sort_dir')).toBe('desc');
    expect(params.get('filters')).toBeNull();
  });
});

describe('integration-tables: connected sources and field mappings', () => {
  test('connector rows read the API fields (last_sync, created_at)', () => {
    const row = tables.connectorSourceRow({ id: 'a1', name: 'Leadly', instance_name: 'Leadly', category: 'crm', status: 'connected', last_sync: '2026-10-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', sync_interval_minutes: 60 });
    expect(row).toMatchObject({ id: 'a1', name: 'Leadly', category: 'crm', status: 'connected', last_sync: '2026-10-01T00:00:00Z', records: null, schedule: 'hourly', created_at: '2026-01-01T00:00:00Z' });
    expect(tables.connectorSourceRow({ name: 'Sheets', instance_name: 'Intake', lastSync: 'x', records: '12', config: { sync_frequency: 'daily' } }))
      .toMatchObject({ name: 'Sheets · Intake', last_sync: 'x', records: 12, schedule: 'daily' });
    expect(tables.scheduleOf({})).toBe('manual');
  });

  test('connected source columns: Created present, actions unlabelled, schedule labels', () => {
    const cols = tables.connectorSourceColumns();
    expect(cols.find((c) => c.key === 'created_at')).toMatchObject({ label: 'Created', kind: 'created' });
    expect(cols.find((c) => c.key === 'actions').label).toBe('Actions');
    const kit = global.LanaRecordTableKit;
    const map = kit.filterOptionsFor({ columns: cols }, [{ schedule: 'hourly', category: 'crm', status: 'connected' }]);
    expect(map.schedule.options).toEqual([{ value: 'hourly', label: 'Every hour' }]);
    expect(map.records.match(null, ['none'])).toBe(true);
    expect(map.actions).toBeUndefined();
    expect(kit.renderersFor({ columns: cols }).actions('', { id: 'a1' })).toContain('data-row-action="sync"');
  });

  test('field mappings', () => {
    expect(tables.fieldMappingRow({ source: 'email', target: 'contact.email', enabled: true }, 0))
      .toMatchObject({ id: 'mapping-0', source: 'email', target: 'contact.email', enabled: 'enabled' });
    expect(tables.fieldMappingRow({ source_field: 'a', target_field: 'b' }, 1).enabled).toBe('disabled');
  });
});
