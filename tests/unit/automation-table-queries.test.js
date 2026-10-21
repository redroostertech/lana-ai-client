const path = require('path');

const Q = require(path.join(__dirname, '../../src/automation/js/shared/table-queries.js'));

const NOW = new Date('2026-10-21T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function paramsObject(params) {
  return Object.fromEntries(params.entries());
}

describe('automation table queries', () => {
  describe('Library (GET /api/automations)', () => {
    test('maps paging, the default sort and the toolbar search', () => {
      const params = paramsObject(Q.libraryParams({ page: 3, limit: 20, sortBy: 'updated_at', sortDir: 'desc', filters: {} }, 'intake'));
      expect(params).toEqual({ page: '3', limit: '20', sort_by: 'updated_at', sort_dir: 'desc', search: 'intake' });
    });

    test('maps each column to its API sort name, falling back to updated_at', () => {
      const sortOf = (sortBy) => Q.libraryParams({ sortBy, sortDir: 'asc' }).get('sort_by');
      expect(sortOf('name')).toBe('name');
      expect(sortOf('automation_type')).toBe('type');
      expect(sortOf('last_executed_at')).toBe('last_executed_at');
      expect(sortOf('created_at')).toBe('created_at');
      expect(sortOf('description')).toBe('updated_at');
      expect(Q.libraryParams({ sortBy: 'name', sortDir: 'asc' }).get('sort_dir')).toBe('asc');
    });

    test('caps the page size at 100', () => {
      expect(Q.libraryParams({ limit: 500 }).get('limit')).toBe('100');
    });

    test('maps every column filter to its API parameter', () => {
      const params = paramsObject(Q.libraryParams({
        page: 1,
        limit: 20,
        sortBy: 'name',
        sortDir: 'asc',
        filters: {
          name: { operator: 'contains', value: 'Lead ' },
          category: { operator: 'in', value: ['lead-management', 'billing'] },
          automation_type: { operator: 'in', value: ['scheduled'] },
          scope: { operator: 'in', value: ['matter'] },
          visibility: { operator: 'in', value: ['private', 'org_wide'] },
          state: { operator: 'in', value: ['active'] },
          last_executed_at: { operator: 'in', value: ['7d'] },
          updated_at: { operator: 'in', value: ['older'] },
          created_at: { operator: 'in', value: ['30d'] }
        }
      }, '', NOW));
      expect(params).toEqual({
        page: '1',
        limit: '20',
        sort_by: 'name',
        sort_dir: 'asc',
        name: 'Lead',
        category: 'lead-management,billing',
        automation_type: 'scheduled',
        scope: 'matter',
        visibility: 'private,org_wide',
        state: 'active',
        last_executed_after: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
        updated_before: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        created_after: new Date(NOW.getTime() - 30 * DAY_MS).toISOString()
      });
    });

    test('reads page-style pagination', () => {
      const response = { automations: [], pagination: { total: 45, page: 2, limit: 20, total_pages: 3 } };
      expect(Q.tablePagination(response, { page: 2, limit: 20 }, 20)).toEqual({ page: 2, limit: 20, total: 45, total_pages: 3 });
    });

    test('without a server total, the loaded rows are the total (older servers)', () => {
      expect(Q.tablePagination({ automations: [{}, {}] }, { page: 1, limit: 20 }, 2))
        .toEqual({ page: 1, limit: 20, total: 2, total_pages: 1 });
    });
  });

  describe('Run History (GET /api/executions)', () => {
    test('maps the page to limit/offset and the default sort', () => {
      const params = paramsObject(Q.runsParams({ page: 3, limit: 25, sortBy: 'started_at', sortDir: 'desc', filters: {} }, 'nightly'));
      expect(params).toEqual({ limit: '25', offset: '50', sort_by: 'started_at', sort_dir: 'desc', query: 'nightly' });
    });

    test('maps each column to its API sort name', () => {
      const sortOf = (sortBy) => Q.runsParams({ sortBy }).get('sort_by');
      expect(sortOf('automation_name')).toBe('name');
      expect(sortOf('matter')).toBe('matter');
      expect(sortOf('trigger_event_type')).toBe('trigger');
      expect(sortOf('scope')).toBe('scope');
      expect(sortOf('status')).toBe('status');
      expect(sortOf('duration')).toBe('duration');
      expect(sortOf('created_at')).toBe('created_at');
      expect(sortOf('unknown')).toBe('started_at');
    });

    test('maps every column filter to its API parameter', () => {
      const params = paramsObject(Q.runsParams({
        page: 1,
        limit: 20,
        sortBy: 'status',
        sortDir: 'asc',
        filters: {
          automation_name: { operator: 'contains', value: 'Intake' },
          scope: { operator: 'in', value: ['organization'] },
          matter: { operator: 'in', value: ['uuid-1', 'uuid-2'] },
          trigger_event_type: { operator: 'in', value: ['matter.created', 'manual'] },
          status: { operator: 'in', value: ['failed', 'completed'] },
          started_at: { operator: 'in', value: ['30d'] },
          created_at: { operator: 'in', value: ['older'] },
          duration: { operator: 'in', value: ['1s_10s'] }
        }
      }, '', NOW));
      expect(params).toEqual({
        limit: '20',
        offset: '0',
        sort_by: 'status',
        sort_dir: 'asc',
        automation_name: 'Intake',
        scope: 'organization',
        matter_ids: 'uuid-1,uuid-2',
        trigger_event_type: 'matter.created,manual',
        status: 'failed,completed',
        started_after: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        created_before: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        min_duration_ms: '1000',
        max_duration_ms: '10000'
      });
    });

    test('open-ended duration ranges send one bound', () => {
      const under = paramsObject(Q.runsParams({ filters: { duration: { operator: 'in', value: ['under_1s'] } } }));
      expect(under.max_duration_ms).toBe('1000');
      expect(under.min_duration_ms).toBeUndefined();
      const over = paramsObject(Q.runsParams({ filters: { duration: { operator: 'in', value: ['over_1m'] } } }));
      expect(over.min_duration_ms).toBe('60000');
      expect(over.max_duration_ms).toBeUndefined();
    });

    test('reads offset-style pagination into a page number', () => {
      const response = { data: [], pagination: { total: 120, limit: 20, offset: 40, has_more: true } };
      expect(Q.tablePagination(response, { page: 3, limit: 20 }, 20)).toEqual({ page: 3, limit: 20, total: 120, total_pages: 6 });
    });

    test('humanizes durations and event names', () => {
      expect(Q.humanizeDuration(850)).toBe('850 ms');
      expect(Q.humanizeDuration(4200)).toBe('4.2 s');
      expect(Q.humanizeDuration(210000)).toBe('3.5 min');
      expect(Q.humanizeDuration(null)).toBe('');
      expect(Q.humanizeEvent('matter.created')).toBe('Matter created');
      expect(Q.humanizeEvent('document_uploaded')).toBe('Document uploaded');
    });
  });

  describe('Approvals (GET /api/approvals/inbox)', () => {
    test('maps the page to limit/offset, search and the default sort', () => {
      const params = paramsObject(Q.approvalsParams({ page: 2, limit: 20, sortBy: 'created_at', sortDir: 'desc', filters: {} }, 'invoice'));
      expect(params).toEqual({ limit: '20', offset: '20', sort_by: 'created_at', sort_dir: 'desc', search: 'invoice' });
    });

    test('maps each column to its API sort name', () => {
      const sortOf = (sortBy) => Q.approvalsParams({ sortBy }).get('sort_by');
      expect(sortOf('priority')).toBe('priority');
      expect(sortOf('expires_at')).toBe('expires_at');
      expect(sortOf('source_type')).toBe('source_type');
      expect(sortOf('matter')).toBe('created_at');
    });

    test('maps every column filter to its API parameter', () => {
      const params = paramsObject(Q.approvalsParams({
        page: 1,
        limit: 20,
        filters: {
          title: { operator: 'contains', value: 'Release' },
          approval_type: { operator: 'in', value: ['document_review'] },
          priority: { operator: 'in', value: ['urgent', 'high'] },
          source_type: { operator: 'in', value: ['automation_execution'] },
          matter: { operator: 'in', value: ['uuid-9'] },
          created_at: { operator: 'in', value: ['7d'] },
          expires_at: { operator: 'in', value: ['older'] }
        }
      }, '', NOW));
      expect(params).toMatchObject({
        title: 'Release',
        approval_type: 'document_review',
        priority: 'urgent,high',
        source_type: 'automation_execution',
        matter_id: 'uuid-9',
        created_after: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
        expires_before: new Date(NOW.getTime() - 30 * DAY_MS).toISOString()
      });
    });

    test('ranks priorities low to urgent, not alphabetically', () => {
      const sorted = ['normal', 'urgent', 'low', 'high'].sort((a, b) => Q.priorityRank(a) - Q.priorityRank(b));
      expect(sorted).toEqual(['low', 'normal', 'high', 'urgent']);
    });
  });

  describe('labels and options', () => {
    test('humanizes slugs and capitalizes the first letter', () => {
      expect(Q.humanizeLabel('lead-management')).toBe('Lead management');
      expect(Q.humanizeLabel('automation_execution')).toBe('Automation execution');
      expect(Q.capitalizeFirst('under 1s')).toBe('Under 1s');
    });

    test('builds deduplicated filter options from values and facet rows', () => {
      expect(Q.optionsFromValues(['billing', 'billing', '', null, 'lead-management'])).toEqual([
        { value: 'billing', label: 'Billing' },
        { value: 'lead-management', label: 'Lead management' }
      ]);
      expect(Q.facetValues({ categories: [{ value: 'billing', count: 3 }, { value: 'intake', count: 1 }] }, 'categories'))
        .toEqual(['billing', 'intake']);
      expect(Q.facetValues({}, 'categories')).toEqual([]);
    });

    test('every option label starts uppercase', () => {
      const labels = [
        ...Q.SCOPE_OPTIONS, ...Q.VISIBILITY_OPTIONS, ...Q.STATE_OPTIONS, ...Q.durationOptions(),
        ...Q.optionsFromValues(Q.RUN_STATUSES), ...Q.optionsFromValues(Q.APPROVAL_TYPES),
        ...Q.optionsFromValues(Q.APPROVAL_SOURCE_TYPES), ...Q.optionsFromValues(Q.PRIORITIES)
      ].map((option) => option.label);
      labels.forEach((label) => expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase()));
    });
  });
});
