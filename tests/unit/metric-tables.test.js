const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');

// The module reads window.LanaLibraryColumnFilters for the date ranges.
global.window = global;
global.LanaLibraryColumnFilters = require(path.join(SRC, 'js/shared/library-column-filters.js'));
const tables = require(path.join(SRC, 'js/shared/metric-tables.js'));

describe('metric-tables', () => {
  describe('labels', () => {
    test('humanizes codes, slugs and registry keys with a leading capital', () => {
      expect(tables.humanizeLabel('legal_operations')).toBe('Legal operations');
      expect(tables.humanizeLabel('lead-management')).toBe('Lead management');
      expect(tables.humanizeLabel('legal_firm.estate_planning')).toBe('Legal firm estate planning');
      expect(tables.humanizeLabel('')).toBe('');
      expect(tables.capitalizeFirst('organization-wide')).toBe('Organization-wide');
    });
  });

  describe('fetchAllPages', () => {
    test('reads every page up to the total instead of one capped page', async () => {
      const all = Array.from({ length: 7 }, (_, i) => ({ id: i }));
      const calls = [];
      const result = await tables.fetchAllPages(async (limit, offset) => {
        calls.push([limit, offset]);
        return { rows: all.slice(offset, offset + limit), total: all.length };
      }, 3, 10);
      expect(result.rows).toHaveLength(7);
      expect(calls).toEqual([[3, 0], [3, 3], [3, 6]]);
    });

    test('stops at maxPages and keeps the first response', async () => {
      const result = await tables.fetchAllPages(async (limit) => ({
        rows: new Array(limit).fill({}), total: 1000, summary: { total: 1000 }
      }), 2, 3);
      expect(result.rows).toHaveLength(6);
      expect(result.first.summary.total).toBe(1000);
    });
  });

  describe('catalog rows', () => {
    const metric = {
      key: 'core.intake.qualified_leads',
      title: 'Qualified Leads',
      domain: 'sales_intake',
      primaryAudience: 'department_marketing',
      status: 'active',
      executable: true,
      entities: ['Calendar Event', { 'Entity Type': 'calendar_event' }, { name: 'Matter' }],
      description: 'Leads qualified'
    };

    test('keeps raw codes, a boolean and entity keys; display name falls back to title', () => {
      const row = tables.mapCatalogMetric(metric);
      expect(row).toMatchObject({
        id: 'core.intake.qualified_leads',
        display_name: 'Qualified Leads',
        domain: 'sales_intake',
        audience: 'department_marketing',
        status: 'active',
        executable: true,
        entity_keys: ['calendar_event', 'matter'],
        last_run_status: 'never',
        last_run_value: null,
        goal_target: null
      });
      expect(row._raw).toBe(metric);
      expect(tables.mapCatalogMetric({ key: 'k', executable: 'yes' }).executable).toBe(false);
    });

    test('filter options cover every data column with readable labels', () => {
      const rows = [metric, { key: 'b', domain: 'finance', status: 'planned', entities: [] }].map(tables.mapCatalogMetric);
      const options = tables.catalogFilterOptions(rows);
      expect(options.display_name).toEqual({ text: true, placeholder: 'Name contains...' });
      expect(options.domain.options).toEqual([
        { value: 'finance', label: 'Finance' },
        { value: 'sales_intake', label: 'Sales intake' }
      ]);
      expect(options.status.options.map((o) => o.label)).toEqual(['Active', 'Planned']);
      expect(options.executable.options).toEqual([
        { value: 'true', label: 'Executable' }, { value: 'false', label: 'Planned' }
      ]);
      expect(options.last_run_status.options.map((o) => o.label)).toEqual(['Never run', 'Running', 'Pass', 'Fail']);
      expect(options.entity_keys.match(['matter', 'calendar_event'], ['matter'])).toBe(true);
      expect(options.entity_keys.match([], ['matter'])).toBe(false);
      expect(options.last_run_value.match(12, ['has_value'])).toBe(true);
      expect(options.last_run_value.match(null, ['no_value'])).toBe(true);
      expect(options.goal_target.match(null, ['has_value'])).toBe(false);
    });

    test('status colors and sortable run values', () => {
      expect(tables.catalogStatusColor('active')).toBe('green');
      expect(tables.catalogStatusColor('planned')).toBe('yellow');
      expect(tables.catalogStatusColor('deprecated')).toBe('gray');
      expect(tables.sortableRunValue('12.5')).toBe(12.5);
      expect(tables.sortableRunValue([1, 2, 3])).toBe(3);
      expect(tables.sortableRunValue({ total: 4 })).toBe(4);
      expect(tables.sortableRunValue('n/a')).toBeNull();
    });
  });

  describe('metric detail', () => {
    test('snapshots keep the capture time as Created and the raw number', () => {
      const row = tables.mapSnapshot({
        snapshot_id: 's1', captured_at: '2026-10-01T10:00:00Z', value_numeric: '42',
        calculation_status: 'success', period_start: '2026-09-01', period_end: '2026-09-30', format: 'currency'
      });
      expect(row).toMatchObject({
        id: 's1', created_at: '2026-10-01T10:00:00Z', value: 42, status: 'success',
        period_start: '2026-09-01', period_end: '2026-09-30', format: 'currency'
      });
      expect(tables.mapSnapshot({ value_numeric: null }, 3)).toMatchObject({ id: 'snapshot-3', value: null });
    });

    test('snapshot filters: date ranges on every date column, humanized statuses', () => {
      const rows = [{ status: 'historical_unverified' }, { status: 'success' }];
      const options = tables.snapshotFilterOptions(rows);
      expect(options.status.options).toEqual([
        { value: 'historical_unverified', label: 'Historical unverified' },
        { value: 'success', label: 'Success' }
      ]);
      ['created_at', 'period_start', 'period_end'].forEach((col) => {
        expect(options[col].single).toBe(true);
        expect(options[col].options).toBe(global.LanaLibraryColumnFilters.EDITED_RANGE_OPTIONS);
      });
      const now = new Date().toISOString();
      expect(options.created_at.match(now, ['7d'])).toBe(true);
      expect(options.created_at.match('2001-01-01T00:00:00Z', ['7d'])).toBe(false);
    });

    test('source rows: union of keys, created_at first as "Created", objects as JSON', () => {
      const model = tables.rawDataTable([
        { matter_name: 'Smith', amount: 10, created_at: '2026-01-01T00:00:00Z' },
        { matter_name: 'Jones', meta: { a: 1 }, _hidden: true }
      ]);
      expect(model.columns).toEqual(['created_at', 'matter_name', 'amount', 'meta']);
      expect(model.labels).toEqual(['Created', 'Matter name', 'Amount', 'Meta']);
      expect(model.dateColumns).toEqual(['created_at']);
      expect(model.rows[0]).toMatchObject({ amount: 10, meta: '' });
      expect(model.rows[1]).toMatchObject({ matter_name: 'Jones', meta: '{"a":1}' });
      expect(model.rows[1]._hidden).toBeUndefined();
      expect(tables.rawDataTable([5]).rows[0].value).toBe(5);
      expect(tables.rawDataTable([], 12).columns).toEqual([]);
    });
  });

  describe('dashboard library', () => {
    test('maps BI records with raw codes and ISO dates', () => {
      const row = tables.mapDashboardRecord({
        id: 'abc', name: 'Owner view', layout: { dashboard_type: 'owner', category: 'finance', visibility_label: 'owner only' },
        created_at: '2026-01-02T03:04:05Z', updated_at: '2026-02-02T03:04:05Z'
      }, 0);
      expect(row).toMatchObject({
        id: 'abc', row_id: 'abc', name: 'Owner view', audience: 'owner', category: 'finance',
        visibility: 'owner only', scope: 'Organization-wide', state: 'Active',
        created_at: '2026-01-02T03:04:05Z', updated_at: '2026-02-02T03:04:05Z',
        href: 'admin/dashboard-detail.html?id=abc'
      });
    });

    test('built-in catalog entries link by type and have no dates', () => {
      const row = tables.mapDashboardRecord({ key: 'owner', name: 'Owner Performance', audience: 'Owner' }, 0);
      expect(row).toMatchObject({ id: null, row_id: 'owner', created_at: '', href: 'admin/dashboard-detail.html?type=owner' });
    });

    test('filter options for every data column with capitalized labels', () => {
      const rows = [
        tables.mapDashboardRecord({ id: '1', name: 'A', layout: { dashboard_type: 'department_legal', category: 'operations' } }),
        tables.mapDashboardRecord({ id: '2', name: 'B', layout: { dashboard_type: 'owner', category: 'finance' } })
      ];
      const options = tables.dashboardFilterOptions(rows);
      expect(options.name.text).toBe(true);
      expect(options.audience.options).toEqual([
        { value: 'department_legal', label: 'Department legal' },
        { value: 'owner', label: 'Owner' }
      ]);
      expect(options.category.options.map((o) => o.label)).toEqual(['Finance', 'Operations']);
      ['scope', 'visibility', 'state', 'created_at', 'updated_at'].forEach((col) => expect(options[col]).toBeTruthy());
    });
  });

  describe('pages follow the table standard', () => {
    const pages = {
      'admin/metric-catalog.html': ['metricCatalogTable'],
      'admin/metric_detail.html': ['metricSnapshotsTable', 'metricRawDataTable'],
      'admin/dashboard-library.html': ['dashboardLibraryTable']
    };

    Object.entries(pages).forEach(([file, ids]) => {
      const html = fs.readFileSync(path.join(SRC, file), 'utf8');
      test(file + ' uses card tables with column filters and no legacy attributes', () => {
        ids.forEach((id) => {
          const match = html.match(new RegExp('<lex-table[^>]*id="' + id + '"[^>]*>', 's'));
          expect(match).not.toBeNull();
          const tag = match[0];
          expect(tag).toContain('lex-table--card');
          expect(tag).toContain('column-filters');
          expect(tag).toContain('limit="20"');
          expect(tag).not.toMatch(/\s(searchable|filterable|compact|sortable|paginated|page-size)[\s=>]/);
        });
        expect(html).not.toMatch(/<select[\s>]/);
        expect(html).toContain('js/shared/metric-tables.js');
        expect(html).toContain('js/lex/components/form/lex-select.js');
      });
    });

    test('Created labels are exactly "Created"', () => {
      expect(fs.readFileSync(path.join(SRC, 'admin/dashboard-library.html'), 'utf8')).toContain('State,Created,Last edited');
      expect(fs.readFileSync(path.join(SRC, 'admin/metric_detail.html'), 'utf8')).toContain('labels="Created,Value,Status');
    });

    test('the goal editor uses lex-select, not native selects', () => {
      const js = fs.readFileSync(path.join(SRC, 'js/admin/metric-catalog.js'), 'utf8');
      expect(js).not.toMatch(/<select[\s>]/);
      expect(js).toContain('<lex-select id="');
    });

    test('the dashboard library has no custom dropdown menu or window.confirm-only delete', () => {
      const js = fs.readFileSync(path.join(SRC, 'js/admin/dashboard-library.js'), 'utf8');
      expect(js).not.toContain('insights-action-menu');
      expect(js).toContain('Lex.Modal.confirm');
    });
  });
});
