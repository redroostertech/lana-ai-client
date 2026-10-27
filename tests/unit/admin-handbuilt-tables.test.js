'use strict';

/**
 * Hand-built admin tables converted to lex-table (docs/TABLE-STANDARD.md):
 * Search Analytics, Settings heartbeat history, admin dashboard previews,
 * integrations API calls, block billing rules, Data Visualization connected
 * tables and the trace SSE events. Query mapping, raw rows, renderers and
 * header filters.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });
const NOW = new Date('2026-10-20T15:30:00.000Z');

function loadPage(rel) {
  const win = { localStorage: { getItem: () => STORED_USER }, Intl, Date };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-client-tables.js'))(win);
  win.Lex.Nav = { getParams: () => new URLSearchParams(''), go: () => {} };
  win.Lex.Toast = { error: () => {}, success: () => {} };

  const document = {
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null
  };
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) });
  const context = {
    window: win,
    document,
    Lex: win.Lex,
    LanaTime: win.LanaTime,
    api,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout
  };
  win.document = document;
  win.api = api;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return win;
}

const params = (search) => Object.fromEntries(new URLSearchParams(search.toString()));
const plain = (value) => JSON.parse(JSON.stringify(value));
const labels = (filter) => plain(filter.options).map((o) => o.label);

describe('AdminClientTables', () => {
  const win = loadPage('js/admin/admin-client-tables.js');
  const c = win.AdminClientTables;

  test('number ranges: min inclusive, max exclusive; empty cells never match', () => {
    const ranges = [{ value: 'lt100', label: 'Under 100', max: 100 }, { value: 'gte100', label: '100+', min: 100 }];
    const f = c.rangeFilter(ranges);
    expect(f.single).toBe(true);
    expect(f.match(99, ['lt100'])).toBe(true);
    expect(f.match(100, ['lt100'])).toBe(false);
    expect(f.match(100, ['gte100'])).toBe(true);
    expect(f.match(null, ['gte100'])).toBe(false);
    expect(f.match(5, ['unknown'])).toBe(true);
  });

  test('date filter matches by the shared ranges; value options are distinct, capitalised and sorted', () => {
    const f = c.dateFilter();
    expect(labels(f)).toEqual(['Today', 'Last 7 days', 'Last 30 days', 'Older than 30 days']);
    expect(f.match(new Date().toISOString(), ['7d'])).toBe(true);
    expect(f.match('2020-01-01T00:00:00Z', ['7d'])).toBe(false);
    expect(plain(c.valueOptions([{ t: 'semantic_search' }, { t: 'hybrid' }, { t: 'hybrid' }, { t: '' }], 't')))
      .toEqual([{ value: 'hybrid', label: 'Hybrid' }, { value: 'semantic_search', label: 'Semantic search' }]);
    expect(c.countText(1, ['rule', 'rules'])).toBe('1 rule');
  });
});

describe('Search Analytics tables', () => {
  const win = loadPage('js/admin/search-analytics-tables.js');
  const T = win.SearchAnalyticsTables;

  test('period params ask for the whole list for the period', () => {
    expect(params(T.periodParams(30))).toEqual({ limit: String(T.FETCH_LIMIT), days: '30' });
    expect(params(T.periodParams(7, '2026-10-01', '2026-10-10'))).toEqual({ limit: String(T.FETCH_LIMIT), startDate: '2026-10-01', endDate: '2026-10-10' });
    expect(T.capNote(T.FETCH_LIMIT)).toContain('first');
    expect(T.capNote(3)).toBe('');
  });

  test('rows keep raw values; renderers format them', () => {
    const top = T.mapTopQuery({ query_text: 'indemnity', query_type: 'hybrid_search', frequency: '12', avg_latency_ms: 87, zero_result_rate_percent: 8.333, ctr_percent: 50 }, 0);
    expect(top.frequency).toBe(12);
    expect(top.zero_result_rate_percent).toBe(8.333);
    const r = T.renderers.top();
    expect(r.zero_result_rate_percent(8.333)).toContain('8.3%');
    expect(r.query_type('hybrid_search')).toContain('label="Hybrid search"');

    const zero = T.mapZeroResult({ id: 'z1', query_text: 'x', user_id: 'u1', matter_id: 'MATT-1', created_at: '2026-01-20T20:16:00Z' }, 0);
    expect(zero.created_at).toBe('2026-01-20T20:16:00Z');
    const z = T.renderers.zero();
    expect(z.created_at(zero.created_at)).toContain('1/20/2026 3:16 PM');
    expect(z.matter_id('MATT-1')).toContain('data-matter-id="MATT-1"');
    expect(z.user('')).toContain('—');

    const slow = T.renderers.slow();
    expect(slow.latency_ms(650)).toContain('color="red"');
    expect(slow.latency_ms(150)).toContain('color="yellow"');
  });

  test('every column has a header filter', () => {
    const rows = [T.mapSlowQuery({ id: 's', query_text: 'q', query_type: 'semantic', latency_ms: 120, result_count: 0, matter_id: 'MATT-2', created_at: NOW.toISOString() }, 0)];
    const f = T.filters.slow(rows);
    expect(Object.keys(f).sort()).toEqual(['created_at', 'latency_ms', 'matter_id', 'query_text', 'query_type', 'result_count']);
    expect(f.query_text.text).toBe(true);
    expect(labels(f.query_type)).toEqual(['Semantic']);
    expect(f.result_count.match(0, ['0'])).toBe(true);
    expect(Object.keys(T.filters.top([])).length).toBe(6);
    expect(Object.keys(T.filters.zero([])).length).toBe(5);
  });
});

describe('Heartbeat run history', () => {
  const win = loadPage('js/admin/heartbeat-runs-table.js');
  const T = win.HeartbeatRunsTable;

  test('query maps to limit/offset, status and the sort/range names', () => {
    const p = params(T.toApiParams({
      page: 3, limit: 20, sortBy: 'duration_ms', sortDir: 'asc',
      filters: {
        status: { operator: 'in', value: ['failed'] },
        triggered_by: { operator: 'in', value: ['manual', 'interval'] },
        summary: { operator: 'contains', value: 'disk' },
        duration_ms: { operator: 'in', value: ['1-10s'] },
        created_at: { operator: 'in', value: ['7d'] }
      }
    }, NOW));
    expect(p).toEqual({
      limit: '20', offset: '40', sort_by: 'duration_ms', sort_order: 'asc', status: 'failed',
      triggered_by: 'manual,interval', search: 'disk', min_duration_ms: '1000', max_duration_ms: '10000',
      created_after: '2026-10-13T15:30:00.000Z'
    });
    expect(params(T.toApiParams({ page: 1, limit: 500, sortBy: 'created_at' }))).toMatchObject({ limit: '100', sort_by: 'started_at', sort_order: 'desc' });
  });

  test('rows are raw; renderers badge the status and label the trigger', () => {
    const row = T.mapRun({ id: 'r1', status: 'suppressed', triggered_by: 'interval', duration_ms: 2500, started_at: '2026-01-20T20:16:00Z', suppressed_reason: 'duplicate content' });
    expect(row).toMatchObject({ summary: 'duplicate content', duration_ms: 2500, created_at: '2026-01-20T20:16:00Z' });
    const r = T.cellRenderers();
    expect(r.status('suppressed')).toContain('label="Suppressed" color="yellow"');
    expect(r.triggered_by('interval')).toContain('Scheduled');
    expect(r.duration_ms(2500)).toContain('2.5 s');
    expect(r.created_at(row.created_at)).toContain('1/20/2026 3:16 PM');
    expect(Object.keys(T.filterOptions()).sort()).toEqual(['created_at', 'duration_ms', 'status', 'summary', 'triggered_by']);
    expect(T.detailHtml({ plugin_results: { db: { status: 'error', pluginName: 'Database', summary: '<b>down</b>' } } })).toContain('&lt;b&gt;down');
  });
});

describe('Admin dashboard previews', () => {
  const win = loadPage('js/admin/admin-dashboard-tables.js');
  const T = win.AdminDashboardTables;

  test('users and matters map to raw rows with status badges and workspace links', () => {
    const user = T.mapUser({ id: 1, first_name: 'Ann', last_name: 'Lee', email: 'a@x.io', is_active: false, created_at: '2026-01-20T20:16:00Z' });
    expect(user).toMatchObject({ name: 'Ann Lee', status: 'inactive' });
    expect(T.userRenderers().status('inactive')).toContain('label="Inactive"');
    const matter = T.mapMatter({ id: 'uuid-1', matter_id: 'MATT-9', name: 'Smith v. Jones', status: 'on_hold' });
    expect(T.matterRenderers().name(matter.name, matter)).toContain('data-matter-id="MATT-9"');
    expect(T.matterRenderers().status('on_hold')).toContain('label="On hold"');
    expect(Object.keys(T.matterFilters([matter])).sort()).toEqual(['created_at', 'name', 'organization_name', 'status']);
  });
});

describe('Integrations API calls', () => {
  const win = loadPage('js/admin/integrations-activity-table.js');
  const T = win.IntegrationsActivityTable;

  test('status codes group into classes for the badge and the filter', () => {
    expect(T.statusClass(204)).toBe('success');
    expect(T.statusClass(429)).toBe('client_error');
    expect(T.statusClass(503)).toBe('server_error');
    const row = T.mapActivity({ timestamp: '2026-01-20T20:16:00Z', service: 'clio', endpoint: '/v4/matters', status: 503, duration: 120 }, 0);
    expect(row).toMatchObject({ status: 503, status_class: 'server_error', duration_ms: 120, created_at: '2026-01-20T20:16:00Z' });
    expect(T.cellRenderers().status(503, row)).toContain('color="red"');
    const f = T.filterOptions([row]);
    expect(f.status.match(503, ['server_error'])).toBe(true);
    expect(f.status.match(200, ['server_error'])).toBe(false);
    expect(labels(f.service)).toEqual(['Clio']);
  });
});

describe('Block billing rules', () => {
  const win = loadPage('js/admin/block-billing-rules.js');
  const T = win.BlockBillingRulesTable;

  test('rules map to raw rows; types filter matches any selected type', () => {
    const row = T.mapRule({ id: 'b1', name: 'Review + email', required_activity_types: ['review', 'communication'], min_distinct_types: 2, composite_activity_type: 'contract review', priority: 10, max_gap_minutes: 15, is_active: false, created_at: '2026-01-20T20:16:00' });
    expect(row).toMatchObject({ status: 'inactive', priority: 10, max_gap_minutes: 15 });
    const r = T.cellRenderers();
    expect(r.required_activity_types(row.required_activity_types, row)).toContain('Review, Communication (min 2)');
    expect(r.composite_activity_type('contract review')).toContain('Contract review');
    expect(r.status('inactive')).toContain('label="Inactive"');
    expect(r.actions('', row)).not.toContain('bb-delete-btn');
    const f = T.filterOptions([row]);
    expect(f.required_activity_types.match(['review'], ['drafting', 'review'])).toBe(true);
    expect(f.required_activity_types.match(['review'], ['drafting'])).toBe(false);
    expect(Object.keys(f).sort()).toEqual(['billing_code', 'composite_activity_type', 'created_at', 'max_gap_minutes', 'name', 'priority', 'required_activity_types', 'status']);
  });
});

describe('Data Visualization connected tables', () => {
  const win = loadPage('js/admin/data-visualization.js');
  const t = win.DataVizTable;

  test('connected sections gain the view\'s Created column and its formats', () => {
    const conn = { view: 'mcp_tasks', filterField: 'matter_id', filterSource: 'matter_id', label: 'Tasks', columns: 'title,status,priority,due_date,assigned_to_name', labels: 'Title,Status,Priority,Due Date,Assigned To' };
    const cfg = t.connectedConfig(conn);
    expect(cfg.columns).toBe('title,status,priority,due_date,assigned_to_name,created_at');
    expect(cfg.labels.split(',').pop()).toBe('Created');
    expect(cfg.sortBy).toBe('created_at');
    expect(plain(cfg.format)).toMatchObject({ created_at: 'datetime', due_date: 'date', status: 'pill' });
  });

  test('connected params add the parent filter to the table query', () => {
    const conn = { view: 'mcp_documents', filterField: 'matter_id', filterSource: 'matter_id', label: 'Documents', columns: 'filename,status,created_at', labels: 'Filename,Status,Created' };
    const p = params(t.connectedParams({ page: 2, limit: 20, sortBy: 'filename', sortDir: 'asc', filters: { status: { operator: 'contains', value: 'processed' } } }, conn, { matter_id: 'MATT-7' }, NOW));
    expect(p).toEqual({ page: '2', limit: '20', sort_by: 'filename', sort_dir: 'asc', filter_status: 'processed', filter_matter_id: 'MATT-7' });
  });
});

describe('Trace SSE events', () => {
  const win = loadPage('js/admin/admin-traces.js');
  const t = win.AdminTracesTable;

  test('events keep the raw offset and timestamp; data is compact JSON', () => {
    const row = t.mapSseEvent({ event_id: 'e1', event_type: 'token_delta', event_data: '{ "a": 1 }', time_since_request_ms: 1500, event_timestamp: '2026-01-20T20:16:00Z' }, 0);
    expect(row).toMatchObject({ event_type: 'token_delta', event_data: '{"a":1}', time_since_request_ms: 1500, created_at: '2026-01-20T20:16:00Z' });
    const r = t.sseRenderers();
    expect(r.event_type('token_delta')).toContain('label="Token delta"');
    expect(r.time_since_request_ms(1500)).toContain('+1.50s');
    expect(r.created_at(row.created_at)).toContain('1/20/2026 3:16 PM');
    expect(Object.keys(t.sseFilterOptions([row])).sort()).toEqual(['created_at', 'event_data', 'event_type', 'time_since_request_ms']);
  });
});
