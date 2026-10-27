'use strict';

/**
 * Management Boards tables on the table standard (docs/TABLE-STANDARD.md):
 * the server-paged custom boards table and the Team Performance
 * contributors table (query mapping, raw rows, renderers, header filters).
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
  win.Lex.Modal = { confirm: () => ({ style: { setProperty: () => {} } }), open: () => ({}) };

  const document = {
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) });
  const context = {
    window: win,
    document,
    Lex: win.Lex,
    LanaTime: win.LanaTime,
    api,
    ManagementBoardService: { baseUrl: '/api/v1/admin/management-boards' },
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout
  };
  win.document = document;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return win;
}

const params = (search) => Object.fromEntries(new URLSearchParams(search.toString()));
const plain = (value) => JSON.parse(JSON.stringify(value));

describe('Custom boards table', () => {
  const win = loadPage('js/pages/management-boards-main.js');
  const T = win.ManagementBoardsTable;

  test('maps the table query to the management boards API', () => {
    expect(params(T.toApiParams({ page: 2, limit: 20, sortBy: 'name', sortDir: 'asc', filters: {} }, ''))).toEqual({
      page: '2', page_size: '20', sort_by: 'name', sort_order: 'asc'
    });
    // Unknown sort columns fall back to created_at.
    expect(params(T.toApiParams({ sortBy: 'metrics_count' }, '')).sort_by).toBe('created_at');
  });

  test('sends every column filter under the standard names', () => {
    const p = params(T.toApiParams({
      page: 1,
      limit: 20,
      sortBy: 'created_at',
      sortDir: 'desc',
      filters: {
        name: { operator: 'contains', value: 'Intake' },
        board_type: { operator: 'in', value: ['revenue'] },
        review_frequency: { operator: 'in', value: ['weekly', 'monthly'] },
        access: { operator: 'in', value: ['admin'] },
        visibility: { operator: 'in', value: ['private'] },
        status: { operator: 'in', value: ['inactive'] },
        metrics_count: { operator: 'in', value: ['1-5'] },
        last_review_at: { operator: 'in', value: ['older'] },
        created_at: { operator: 'in', value: ['7d'] }
      }
    }, 'kpi', NOW));
    expect(p).toEqual({
      page: '1',
      page_size: '20',
      sort_by: 'created_at',
      sort_order: 'desc',
      search: 'kpi',
      name: 'Intake',
      board_type: 'revenue',
      review_frequency: 'weekly,monthly',
      access_level: 'admin',
      is_public: 'false',
      is_active: 'false',
      min_metrics: '1',
      max_metrics: '6',
      last_review_before: '2026-09-20T15:30:00.000Z',
      created_after: '2026-10-13T15:30:00.000Z'
    });
  });

  test('rows keep raw values and the record as _raw', () => {
    const board = {
      id: 'b1', name: 'Intake KPIs', description: 'Weekly intake', board_type: 'intake',
      review_frequency: 'weekly', metrics_count: 4, user_access_level: 'editor',
      is_public: true, is_active: true, last_review_at: null, created_at: '2026-01-20T20:16:00Z'
    };
    const row = T.mapBoard(board);
    expect(plain(Object.assign({}, row, { _raw: undefined }))).toEqual({
      id: 'b1', name: 'Intake KPIs', board_type: 'intake', review_frequency: 'weekly',
      metrics_count: 4, access: 'editor', visibility: 'public', status: 'active',
      last_review_at: '', created_at: '2026-01-20T20:16:00Z'
    });
    expect(row._raw).toBe(board);
    expect(T.mapBoard({ is_active: false }).status).toBe('inactive');
  });

  test('renderers format: badges, capitalised labels, Created date-time, muted dash', () => {
    const r = T.cellRenderers();
    const row = T.mapBoard({ name: 'Intake KPIs', description: 'Weekly intake' });
    expect(r.name('Intake KPIs', row)).toContain('Weekly intake');
    expect(r.board_type('caseload')).toBe('<lex-badge label="Caseload" color="purple" size="sm"></lex-badge>');
    expect(r.access('admin')).toBe('<lex-badge label="Admin" color="red" size="sm"></lex-badge>');
    expect(r.status('inactive')).toContain('label="Inactive"');
    expect(r.review_frequency('quarterly')).toContain('>Quarterly<');
    expect(r.visibility('public')).toContain('>Public<');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.last_review_at('')).toBe('<span class="admin-table-muted">—</span>');
  });

  test('every column has a header filter with capitalised labels', () => {
    const f = plain(T.filterOptions());
    expect(Object.keys(f).sort()).toEqual([
      'access', 'board_type', 'created_at', 'last_review_at', 'metrics_count',
      'name', 'review_frequency', 'status', 'visibility'
    ]);
    expect(f.name.text).toBe(true);
    expect(f.board_type.single).toBe(true);
    expect(f.board_type.options.map((o) => o.label)).toEqual(['Intake', 'Caseload', 'Revenue', 'Custom']);
    expect(f.created_at.options.map((o) => o.value)).toEqual(['today', '7d', '30d', 'older']);
  });
});

describe('Team Performance contributors table', () => {
  const win = loadPage('js/pages/management-boards-team-performance.js');
  const T = win.TeamContributorsTable;
  const board = new win.TeamPerformanceBoard('x');

  test('maps API top_users through transformApiResponse into raw rows', () => {
    const analytics = board.transformApiResponse({ data: { top_users: [
      { user_id: 'u1', first_name: 'Ann', last_name: 'Lee', email: 'ann@x.io', session_count: 12, avg_session_duration_seconds: 2400, last_active_at: '2026-10-20T14:00:00Z' }
    ] } });
    const row = T.mapContributor(analytics.topContributors[0]);
    expect(plain(Object.assign({}, row, { _raw: undefined }))).toEqual({
      id: 'u1', name: 'Ann Lee', email: 'ann@x.io', session_count: 12,
      avg_session_seconds: 2400, last_active_at: '2026-10-20T14:00:00Z'
    });
  });

  test('renderers format durations and relative last active', () => {
    const r = T.cellRenderers(board);
    expect(r.avg_session_seconds(3900)).toContain('>1h 5m<');
    expect(r.session_count(12)).toContain('>12<');
    expect(r.last_active_at('')).toBe('<span class="admin-table-muted">—</span>');
    expect(r.email('')).toBe('<span class="admin-table-muted">—</span>');
  });

  test('every column filters; number ranges match by predicate', () => {
    const f = T.filterOptions();
    expect(Object.keys(f).sort()).toEqual(['avg_session_seconds', 'email', 'last_active_at', 'name', 'session_count']);
    expect(f.session_count.match(12, ['10-49'])).toBe(true);
    expect(f.session_count.match(50, ['10-49'])).toBe(false);
    expect(f.session_count.match(50, ['50+'])).toBe(true);
    expect(f.avg_session_seconds.match(1800, ['30-60m'])).toBe(true);
    expect(f.avg_session_seconds.match(299, ['lt5m'])).toBe(true);
  });
});

describe('Management Boards markup follows the table standard', () => {
  const html = read('admin/management-boards.html');

  test('boards table: card + column filters + server paging, no grid or native selects in the toolbar', () => {
    const tag = html.match(/<lex-table[\s\S]*?id="boardsTable"[\s\S]*?><\/lex-table>/)[0];
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('server-paging');
    expect(tag).toContain('labels="Name,Type,Review frequency,Metrics,Access,Visibility,Status,Last review,Created"');
    expect(tag).not.toMatch(/\b(searchable|filterable|compact)\b/);
    expect(html).not.toContain('id="boardsGrid"');
    expect(html).not.toContain('id="boardTypeFilter"');
    expect(html).toContain('js/admin/admin-table-kit.js');
    expect(html).toContain('js/lex/components/data/lex-table.js');
  });

  test('page scripts use Lex.Modal instead of confirm', () => {
    const main = read('js/pages/management-boards-main.js');
    expect(main).not.toMatch(/[^.\w]confirm\(/);
    expect(main).toContain('Lex.Modal.confirm');
  });
});
