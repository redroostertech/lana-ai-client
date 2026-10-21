const path = require('path');

const SRC = path.join(__dirname, '../../src');

global.window = global;
global.LanaLibraryColumnFilters = require(path.join(SRC, 'js/shared/library-column-filters.js'));
global.LanaRecordTableKit = require(path.join(SRC, 'insights/js/record-table-kit.js'));
global.LanaIntegrationTables = require(path.join(SRC, 'integrations/js/integration-tables.js'));
const leadly = require(path.join(SRC, 'integrations/js/leadly-tables.js'));
const kit = global.LanaRecordTableKit;

describe('leadly-tables', () => {
  describe('output tables', () => {
    test('every output table is a server-paged standard table with a Created column', () => {
      Object.keys(leadly.OUTPUT_TYPES).forEach((type) => {
        const config = leadly.OUTPUT_TYPES[type];
        const spec = config.spec;
        expect(spec.serverPaging).toBe(true);
        expect(spec.columns[0].kind).toBe('name');
        expect(spec.columns[spec.columns.length - 1]).toMatchObject({ key: 'created_at', label: 'Created', kind: 'created' });
        const html = kit.markup(spec);
        expect(html).toContain('server-paging');
        expect(html).toContain('lex-table--card');
        // Every column has a server filter.
        const filters = config.serverFilters();
        spec.columns.forEach((column) => expect(filters[column.key]).toBeTruthy());
      });
    });

    test('row mappers keep raw values', () => {
      expect(leadly.contactRow({ id: 1, first_name: 'Ann', last_name: 'Lee', email: 'a@b.c', date_added: '2026-01-01T00:00:00Z' }))
        .toMatchObject({ id: '1', name: 'Ann Lee', email: 'a@b.c', created_at: '2026-01-01T00:00:00Z' });
      expect(leadly.opportunityRow({ id: 2, name: 'Deal', status: 'Won', monetary_value: '1500' }))
        .toMatchObject({ status: 'won', monetary_value: 1500 });
      expect(leadly.opportunityRow({ id: 3 }).monetary_value).toBeNull();
      expect(leadly.pipelineRow({ id: 4, name: 'P', stages: [{ opportunity_count: 2, total_value: 100 }, { opportunity_count: 3, total_value: 50 }] }))
        .toMatchObject({ stage_count: 2, opportunity_count: 5, total_value: 150 });
      expect(leadly.funnelRow({ id: 5, steps: { a: 1, b: 2 }, is_active: false })).toMatchObject({ step_count: 2, status: 'inactive' });
    });

    test('query params: paging, search, sort and every column filter', () => {
      const now = new Date('2026-10-21T12:00:00Z');
      const params = leadly.outputParams('opportunities', {
        page: 3, limit: 20, search: ' smith ', sortBy: 'monetary_value', sortDir: 'asc',
        filters: {
          name: { operator: 'contains', value: 'acme' },
          status: { operator: 'in', value: ['open', 'won'] },
          monetary_value: { operator: 'in', value: ['1k_10k'] },
          stage_name: { operator: 'contains', value: 'Intake' },
          created_at: { operator: 'in', value: ['older'] }
        }
      }, { now });
      expect(params.get('page')).toBe('3');
      expect(params.get('limit')).toBe('20');
      expect(params.get('search')).toBe('smith');
      expect(params.get('sort_by')).toBe('monetary_value');
      expect(params.get('sort_order')).toBe('asc');
      expect(params.get('name')).toBe('acme');
      expect(params.get('status')).toBe('open,won');
      expect(params.get('min_value')).toBe('1000');
      expect(params.get('max_value')).toBe('10000');
      expect(params.get('stage_name')).toBe('Intake');
      expect(params.get('created_before')).toBe(new Date(now.getTime() - 30 * 86400000).toISOString());
      expect(params.get('created_after')).toBeNull();
    });

    test('query params default to newest first and cap the limit', () => {
      const params = leadly.outputParams('contacts', { limit: 1000, sortBy: 'bogus' });
      expect(params.get('limit')).toBe('100');
      expect(params.get('page')).toBe('1');
      expect(params.get('sort_by')).toBe('created_at');
      expect(params.get('sort_order')).toBe('desc');
      expect(params.get('search')).toBeNull();
    });

    test('count ranges map to min/max per column', () => {
      const params = leadly.outputParams('pipelines', { filters: { stage_count: { operator: 'in', value: ['over_100'] } } });
      expect(params.get('min_stage_count')).toBe('101');
      expect(params.get('max_stage_count')).toBeNull();
    });

    test('results map rows and the pagination total', () => {
      const result = leadly.outputResult('funnel', { funnels: [{ id: 1, is_active: true }], pagination: { page: 2, limit: 20, total: 41 } }, { page: 2, limit: 20 });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].status).toBe('active');
      expect(result.pagination).toEqual({ page: 2, limit: 20, total: 41 });
      expect(leadly.outputResult('contacts', {}, { page: 1, limit: 20 })).toEqual({ rows: [], pagination: { page: 1, limit: 20, total: 0 } });
    });
  });

  describe('job history', () => {
    test('merges sync logs and documents and drops active jobs', () => {
      const rows = leadly.jobHistoryRows(
        [
          { id: 1, sync_type: 'incremental', status: 'completed', started_at: '2026-10-01T10:00:00Z', completed_at: '2026-10-01T10:00:30Z', records_processed: 12 },
          { id: 2, status: 'running', started_at: '2026-10-02T10:00:00Z' }
        ],
        [{ id: 9, original_filename: 'intake.pdf', status: 'failed', created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:01:00Z', matter_id: 'MATT-1', error_message: 'Bad file' }]
      );
      expect(rows.map((r) => r.id)).toEqual(['sync-1', 'doc-9']);
      expect(rows[0]).toMatchObject({ name: 'Incremental sync', type: 'sync', status: 'completed', processed: 12, duration: 30, created_at: '2026-10-01T10:00:00Z' });
      expect(rows[0]._job).toMatchObject({ job_type: 'Leadly CRM Sync', _isSync: true });
      expect(rows[1]).toMatchObject({ name: 'intake.pdf', type: 'document', status: 'failed', duration: 60, error_message: 'Bad file' });
      expect(rows[1]._job.details.matter_id).toBe('MATT-1');
    });

    test('spec: client-side, status main filter, every column filterable', () => {
      const spec = leadly.jobHistorySpec();
      expect(spec.serverPaging).toBeFalsy();
      expect(spec.mainFilter.key).toBe('status');
      const map = kit.filterOptionsFor(spec, []);
      spec.columns.forEach((column) => expect(map[column.key]).toBeTruthy());
      expect(map.type.options).toEqual(leadly.JOB_TYPE_OPTIONS);
      const render = kit.renderersFor(spec);
      expect(render.name('Full sync', { error_message: '<x>' })).toContain('&lt;x&gt;');
      expect(render.duration(65)).toContain('1m 5s');
    });

    test('fetchAllOffsetPages reads every page and stops when offset is ignored', async () => {
      const all = Array.from({ length: 7 }, (_, i) => ({ id: i }));
      const result = await leadly.fetchAllOffsetPages(async (limit, offset) => all.slice(offset, offset + limit), 3, 10);
      expect(result).toEqual({ rows: all, truncated: false });

      let calls = 0;
      const ignored = await leadly.fetchAllOffsetPages(async () => { calls += 1; return all.slice(0, 3); }, 3, 10);
      expect(ignored.rows).toHaveLength(3);
      expect(calls).toBe(2);

      const capped = await leadly.fetchAllOffsetPages(async (limit, offset) => Array.from({ length: limit }, (_, i) => ({ id: offset + i })), 2, 3);
      expect(capped.truncated).toBe(true);
      expect(capped.rows).toHaveLength(6);
    });
  });
});
