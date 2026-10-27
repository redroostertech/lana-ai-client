const path = require('path');

const SRC = path.join(__dirname, '../../src');

global.window = global;
global.LanaLibraryColumnFilters = require(path.join(SRC, 'js/shared/library-column-filters.js'));
global.LanaRecordTableKit = require(path.join(SRC, 'insights/js/record-table-kit.js'));
global.LanaIntegrationTables = require(path.join(SRC, 'integrations/js/integration-tables.js'));
const t = require(path.join(SRC, 'integrations/js/actionstep-tables.js'));
const kit = global.LanaRecordTableKit;

describe('actionstep-tables', () => {
  describe('entity specs', () => {
    test.each(t.ENTITY_TYPES)('%s: server-paged, Created column, every column filterable', (type) => {
      const spec = t.entitySpec(type);
      expect(spec.serverPaging).toBe(true);
      expect(spec.sortBy).toBe('created_at');
      expect(spec.sortDir).toBe('desc');
      const created = spec.columns.find((c) => c.key === 'created_at');
      expect(created).toMatchObject({ label: 'Created', kind: 'created' });
      expect(spec.columns.every((c) => c.label)).toBe(true);
      const filters = t.entityServerFilters(type);
      spec.columns.forEach((c) => expect(filters[c.key]).toBeTruthy());
      // every sortable column maps to an API sort name
      kit.sortOptionsFor(spec).forEach((o) => expect(t.SORT_BY_COLUMN[type][o.value]).toBeTruthy());
      expect(kit.markup(spec)).toContain('server-paging');
    });

    test('ids and toolbar can differ for the Output tab', () => {
      const spec = t.entitySpec('matters', { id: 'actionstepOutputTable', light: true });
      expect(spec.id).toBe('actionstepOutputTable');
      expect(spec.light).toBe(true);
      expect(spec.mainFilter.key).toBe('status');
    });
  });

  describe('rows keep raw values', () => {
    test('matters', () => {
      const row = t.entityRow('matters', { id: 'AS-1', matter_name: 'Smith', file_reference: 'F-9', action_type_name: 'Probate', assigned_to_name: 'Ann', status: 'Active', date_created: '2026-01-02T00:00:00Z', created_at: '2026-01-03T00:00:00Z' });
      expect(row).toMatchObject({ id: 'AS-1', name: 'Smith', reference: 'F-9', action_type: 'Probate', assigned_to: 'Ann', status: 'Active', created_at: '2026-01-02T00:00:00Z' });
      expect(row._raw.matter_name).toBe('Smith');
      // the old API's normalised fields still map
      expect(t.entityRow('matters', { id: 2, name: 'X', reference: 'R', created_at: 'c' })).toMatchObject({ id: '2', name: 'X', reference: 'R', created_at: 'c' });
    });

    test('participants', () => {
      expect(t.entityRow('participants', { id: 3, company_name: 'Acme', is_company: true, city: 'Austin', state_province: 'TX', as_created_at: 'a' }))
        .toMatchObject({ name: 'Acme', participant_type: 'company', location: 'Austin, TX', created_at: 'a' });
      expect(t.entityRow('participants', { id: 4, display_name: 'Bo' }).participant_type).toBe('person');
    });

    test('tasks flag overdue without changing the status value', () => {
      const row = t.entityRow('tasks', { id: 5, task_name: 'File', current_status: 'Pending', due_date: '2020-01-01' });
      expect(row.status).toBe('Pending');
      expect(row.due_date).toBe('2020-01-01');
      expect(row._overdue).toBe(true);
      expect(t.entityRow('tasks', { id: 6, due_date: '2020-01-01', completed_timestamp: 'x' })._overdue).toBe(false);
    });

    test('notes and documents', () => {
      expect(t.entityRow('notes', { id: 7, note_text: 'Called', note_timestamp: 'n', created_at: 'c', entered_by_name: 'Al' }))
        .toMatchObject({ note: 'Called', created_at: 'n', entered_by: 'Al' });
      expect(t.entityRow('documents', { id: 8, filename: 'a.pdf', file_size: '2048', status: 'completed', created_at: 'c' }))
        .toMatchObject({ name: 'a.pdf', size: 2048, status: 'completed', created_at: 'c' });
      expect(t.entityRecords('documents', { documents: [1] })).toEqual([1]);
      expect(t.entityRecords('matters', { records: [1, 2] })).toEqual([1, 2]);
      expect(t.entityRecords('matters', null)).toEqual([]);
    });
  });

  describe('entityParams', () => {
    const now = new Date('2026-10-21T12:00:00Z');

    test('paging, sort and search', () => {
      const p = t.entityParams('matters', { page: 3, limit: 25, sortBy: 'reference', sortDir: 'asc', search: ' smith ' });
      expect(p.get('page')).toBe('3');
      expect(p.get('limit')).toBe('25');
      expect(p.get('offset')).toBe('50');
      expect(p.get('sort_by')).toBe('file_reference');
      expect(p.get('sort_order')).toBe('asc');
      expect(p.get('search')).toBe('smith');
    });

    test('limit is capped and unknown sorts fall back to created', () => {
      const p = t.entityParams('notes', { limit: 500, sortBy: 'nope' });
      expect(p.get('limit')).toBe('100');
      expect(p.get('sort_by')).toBe('note_timestamp');
      expect(p.get('sort_order')).toBe('desc');
    });

    test('column filters become parameters', () => {
      const p = t.entityParams('matters', {
        filters: {
          name: { operator: 'contains', value: 'smi' },
          status: { operator: 'in', value: ['Active', 'Closed'] },
          created_at: { operator: 'in', value: ['older'] }
        }
      }, { now });
      expect(p.get('matter_name')).toBe('smi');
      expect(p.get('status')).toBe('Active,Closed');
      expect(p.get('created_before')).toBe(new Date(now.getTime() - 30 * 86400000).toISOString());
      expect(p.get('created_after')).toBeNull();
    });

    test('participant type, task due and document size filters', () => {
      expect(t.entityParams('participants', { filters: { participant_type: { operator: 'in', value: ['company'] } } }).get('is_company')).toBe('true');
      expect(t.entityParams('tasks', { filters: { due_date: { operator: 'in', value: ['overdue'] } } }).get('overdue')).toBe('true');
      expect(t.entityParams('tasks', { filters: { due_date: { operator: 'in', value: ['none'] } } }).get('has_due_date')).toBe('false');
      const docs = t.entityParams('documents', { filters: { size: { operator: 'in', value: ['1mb_10mb'] } } });
      expect(docs.get('min_size')).toBe(String(1024 * 1024));
      expect(docs.get('max_size')).toBe(String(10 * 1024 * 1024));
    });

    test('pagination reads the offset response', () => {
      expect(t.entityPagination({ pagination: { total: 70, limit: 20, offset: 20 } }, { page: 2, limit: 20 }, 20))
        .toEqual({ page: 2, limit: 20, total: 70 });
    });
  });

  describe('job history', () => {
    test('merges sync logs, document imports and finished processing jobs', () => {
      const rows = t.buildJobHistoryRows({
        logs: [{ id: 1, sync_type: 'full', status: 'success', records: { processed: 12 }, started_at: '2026-10-01T10:00:00Z', completed_at: '2026-10-01T10:00:30Z' }],
        documents: [{ id: 2, original_filename: 'a.pdf', status: 'completed', created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:05Z' }],
        processingJobs: [
          { id: 3, document_name: 'b.pdf', status: 'failed', progress_percentage: 40, queued_at: '2026-10-03T00:00:00Z' },
          { id: 4, document_name: 'c.pdf', status: 'processing' }
        ]
      });
      expect(rows.map((r) => r.id)).toEqual(['sync-1', 'doc-2', 'proc-3']);
      expect(rows[0]).toMatchObject({ name: 'Full sync', job_type: 'sync', status: 'completed', processed: 12, duration: 30, created_at: '2026-10-01T10:00:00Z' });
      expect(rows[0]._job._isSync).toBe(true);
      expect(rows[1]).toMatchObject({ job_type: 'document_import', duration: 5 });
      expect(rows[2]).toMatchObject({ job_type: 'document_processing', status: 'failed', processed: 40, created_at: '2026-10-03T00:00:00Z' });
    });

    test('spec: client-side, Created column, every column filterable', () => {
      const spec = t.jobHistorySpec();
      expect(spec.serverPaging).toBeFalsy();
      const map = kit.filterOptionsFor(spec, []);
      spec.columns.forEach((c) => expect(map[c.key]).toBeTruthy());
      expect(map.job_type.options.map((o) => o.label)).toEqual(['ActionStep sync', 'Document import', 'Document processing']);
    });

    test('fetchAllOffset reads every page and reports truncation', async () => {
      const all = Array.from({ length: 7 }, (_, i) => i);
      const calls = [];
      const result = await t.fetchAllOffset(async (limit, offset) => {
        calls.push(offset);
        return { rows: all.slice(offset, offset + limit), total: all.length };
      }, 3, 10);
      expect(result).toEqual({ rows: all, truncated: false });
      expect(calls).toEqual([0, 3, 6]);
      const capped = await t.fetchAllOffset(async (limit) => ({ rows: Array(limit).fill(0) }), 2, 2);
      expect(capped.truncated).toBe(true);
      expect(capped.rows).toHaveLength(4);
    });
  });

  test('file sizes', () => {
    expect(t.formatBytes(512)).toBe('512 B');
    expect(t.formatBytes(2048)).toBe('2 KB');
    expect(t.formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(t.formatBytes('x')).toBe('');
  });
});
