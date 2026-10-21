const path = require('path');

const SRC = path.join(__dirname, '../../src');

global.window = global;
global.LanaLibraryColumnFilters = require(path.join(SRC, 'js/shared/library-column-filters.js'));
global.LanaRecordTableKit = require(path.join(SRC, 'insights/js/record-table-kit.js'));
global.LanaIntegrationTables = require(path.join(SRC, 'integrations/js/integration-tables.js'));
const viewer = require(path.join(SRC, 'integrations/js/connector-viewer-tables.js'));
const kit = global.LanaRecordTableKit;

describe('connector-viewer-tables: synced data', () => {
  const record = {
    id: 'r1', entity_type: 'contact', external_id: 42, matter_id: 'm-uuid', matter_name: 'Smith v Jones',
    source_created_at: '2026-10-01T10:00:00Z', synced_at: '2026-10-02T10:00:00Z',
    annotation_count: 2, has_corrections: true, has_flags: true, flag_count: 3
  };

  test('rows keep raw values', () => {
    expect(viewer.dataRow(record)).toMatchObject({
      id: 'r1', entity_type: 'contact', external_id: '42', matter_name: 'Smith v Jones', matter_id: 'm-uuid',
      health: 'flagged', annotation_count: 2, created_at: '2026-10-01T10:00:00Z', synced_at: '2026-10-02T10:00:00Z'
    });
    expect(viewer.dataRow({ id: 'x', has_corrections: true }).health).toBe('corrected');
    expect(viewer.dataRow({ id: 'y' }).health).toBe('clean');
  });

  test('params: sort, search, entity, column filters and field rules', () => {
    const params = viewer.dataParams({
      page: 3, limit: 20, sortBy: 'created_at', sortDir: 'asc', search: 'ann',
      filters: {
        entity_type: { operator: 'in', value: ['contact'] },
        external_id: { operator: 'contains', value: '42' },
        matter_name: { operator: 'in', value: ['m-1', 'm-2'] },
        health: { operator: 'in', value: ['clean'] },
        annotation_count: { operator: 'in', value: ['has'] }
      }
    }, { rules: [{ field: 'data.email', operator: 'contains', value: '@x.com' }] });
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('40');
    expect(params.get('sort_by')).toBe('source_created_at');
    expect(params.get('sort_dir')).toBe('asc');
    expect(params.get('q')).toBe('ann');
    expect(params.get('entity_type')).toBe('contact');
    expect(JSON.parse(params.get('filters'))).toEqual([
      { field: 'data.email', operator: 'contains', value: '@x.com' },
      { field: 'matter_id', operator: 'in', value: ['m-1', 'm-2'] },
      { field: 'has_corrections', operator: 'equals', value: 'false' },
      { field: 'has_flags', operator: 'equals', value: 'false' },
      { field: 'annotation_count', operator: 'not_equals', value: '0' },
      { field: 'external_id', operator: 'contains', value: '42' }
    ]);
  });

  test('Unassigned matter filter and other health/notes choices', () => {
    const rules = (filters) => JSON.parse(viewer.dataParams({ filters }).get('filters') || '[]');
    expect(rules({ matter_name: { operator: 'in', value: [viewer.UNASSIGNED] } }))
      .toEqual([{ field: 'matter_id', operator: 'not_exists' }]);
    // The API cannot OR unassigned with ids: the ids win.
    expect(rules({ matter_name: { operator: 'in', value: [viewer.UNASSIGNED, 'm-1'] } }))
      .toEqual([{ field: 'matter_id', operator: 'in', value: ['m-1'] }]);
    expect(rules({ health: { operator: 'in', value: ['flagged'] } }))
      .toEqual([{ field: 'has_flags', operator: 'equals', value: 'true' }]);
    expect(rules({ health: { operator: 'in', value: ['corrected'] } }))
      .toEqual([{ field: 'has_corrections', operator: 'equals', value: 'true' }]);
    expect(rules({ annotation_count: { operator: 'in', value: ['none'] } }))
      .toEqual([{ field: 'annotation_count', operator: 'equals', value: '0' }]);
    expect(viewer.dataParams({}).get('filters')).toBeNull();
    expect(viewer.dataParams({}).get('sort_by')).toBe('synced_at');
  });

  test('selection signature ignores paging and sort', () => {
    const a = viewer.dataParams({ page: 1, sortBy: 'synced_at', search: 'x' });
    const b = viewer.dataParams({ page: 4, sortBy: 'external_id', sortDir: 'asc', search: 'x' });
    const c = viewer.dataParams({ page: 1, search: 'y' });
    expect(viewer.selectionSignature(a)).toBe(viewer.selectionSignature(b));
    expect(viewer.selectionSignature(a)).not.toBe(viewer.selectionSignature(c));
  });

  test('filter options: entities humanized, matters with Unassigned first', () => {
    expect(viewer.entityOptions({ opportunity: 3, calendar_event: 1 })).toEqual([
      { value: 'calendar_event', label: 'Calendar event' },
      { value: 'opportunity', label: 'Opportunity' }
    ]);
    expect(viewer.matterOptions([{ id: 'b', name: 'Beta' }, { id: 'a', name: 'alpha' }, { name: 'no id' }])).toEqual([
      { value: viewer.UNASSIGNED, label: 'Unassigned' },
      { value: 'a', label: 'alpha' },
      { value: 'b', label: 'Beta' }
    ]);
    const map = viewer.dataServerFilters(['contact'], []);
    expect(Object.keys(map).sort()).toEqual(['annotation_count', 'entity_type', 'external_id', 'health', 'matter_name']);
    expect(map.health.single).toBe(true);
  });

  test('columns: checkbox and actions unlabelled; sortable list matches the API', () => {
    const selected = new Set(['r1']);
    const columns = viewer.dataColumns({ isSelected: (id) => selected.has(id), allFiltered: () => false, isOpen: (id) => id === 'r1' });
    expect(columns.filter((c) => !c.label).map((c) => c.key)).toEqual(['select']);
    expect(columns.find((c) => c.key === 'actions').label).toBe('Actions');
    expect(columns.find((c) => c.key === 'created_at')).toMatchObject({ label: 'Created', kind: 'created' });
    const spec = { id: 'connectorDataTable', columns, sortableColumns: viewer.DATA_SORTABLE };
    expect(kit.sortOptionsFor(spec).map((o) => o.value).sort()).toEqual(viewer.DATA_SORTABLE.split(',').sort());
    const renderers = kit.renderersFor(spec);
    const row = viewer.dataRow(record);
    expect(renderers.select('', row)).toContain('data-select-row="r1"');
    expect(renderers.select('', row)).toContain(' checked');
    expect(renderers.select('', row)).toContain('data-rtk-selected');
    expect(renderers.select('', viewer.dataRow({ id: 'r2' }))).not.toContain('checked');
    expect(renderers.health('flagged', row)).toContain('Flagged ×3');
    expect(renderers.health('clean', viewer.dataRow({ id: 'r2' }))).toContain('label="Clean"');
    expect(renderers.matter_name('Smith v Jones', row)).toContain('data-matter-id="m-uuid"');
    expect(renderers.actions('', row)).toContain('data-row-action="inspect"');
    expect(renderers.actions('', row)).toContain('data-row-action="flag"');
  });
});

describe('connector-viewer-tables: groups and logs', () => {
  test('group rows and columns (no cap, every column filters)', () => {
    const row = viewer.groupRow({
      group_key: 's1::Sheet1', group_type: 'source_collection', sheet_name: 'Sheet1', entity_type: 'contact',
      row_count: '12', assigned_count: 4, assigned_matter_id: 'm-1', assigned_matter_name: 'Smith', last_synced_at: '2026-10-01T00:00:00Z'
    }, 0);
    expect(row).toMatchObject({ id: 's1::Sheet1', name: 'Sheet1', group_type: 'source_collection', row_count: 12, assigned_count: 4, matter: 'Smith', matter_id: 'm-1' });
    const columns = viewer.groupColumns();
    const map = kit.filterOptionsFor({ columns }, [row]);
    expect(Object.keys(map).sort()).toEqual(['assigned_count', 'entity_type', 'group_type', 'last_synced_at', 'matter', 'name', 'row_count']);
    expect(map.group_type.options).toEqual([{ value: 'source_collection', label: 'Source collection' }]);
    expect(kit.renderersFor({ columns }).actions('', row)).toContain('data-row-action="assign-group"');
  });

  test('loadAllLogs reads every page up to the total', async () => {
    const all = Array.from({ length: 230 }, (_, i) => ({ id: String(i) }));
    const calls = [];
    const result = await viewer.loadAllLogs(async (limit, offset) => {
      calls.push(offset);
      return { logs: all.slice(offset, offset + limit), pagination: { total: all.length } };
    }, 100, 20);
    expect(calls).toEqual([0, 100, 200]);
    expect(result).toMatchObject({ total: 230, truncated: false });
    expect(result.logs).toHaveLength(230);
  });

  test('loadAllLogs stops at the page bound and reports truncation', async () => {
    const result = await viewer.loadAllLogs(async (limit) => ({
      logs: Array.from({ length: limit }, (_, i) => ({ id: String(i) })), pagination: { total: 999 }
    }), 10, 3);
    expect(result).toMatchObject({ total: 999, truncated: true });
    expect(result.logs).toHaveLength(30);
  });

  test('log columns end with Created and mark the open log', () => {
    const columns = viewer.logColumns({ isOpen: (id) => id === '7' });
    const last = columns[columns.length - 1];
    expect(last).toMatchObject({ key: 'created_at', label: 'Created' });
    expect(last.render('', { id: '7' })).toContain('data-rtk-selected');
    expect(last.render('', { id: '8' })).not.toContain('data-rtk-selected');
    expect(columns.every((c) => c.label)).toBe(true);
  });
});
