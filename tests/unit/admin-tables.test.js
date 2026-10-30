'use strict';

/**
 * Admin list tables on the table standard (docs/TABLE-STANDARD.md):
 * query mapping, raw rows, renderers and header filters for Users, Sessions,
 * Audit, Traces, User details sessions and Data Visualization.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Deterministic timezone for formatted dates: the stored user's profile.
const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });
const NOW = new Date('2026-10-20T15:30:00.000Z');

function loadPage(rel, extra, opts = {}) {
  const win = { localStorage: { getItem: () => STORED_USER }, Intl, Date, location: { search: opts.search || '' } };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  win.Lex.Nav = { getParams: () => new URLSearchParams(''), go: () => {} };
  win.Lex.Toast = { error: () => {}, success: () => {} };

  const document = {
    getElementById: (id) => (opts.elements && opts.elements[id]) || null,
    addEventListener: () => {},
    querySelector: () => null
  };
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) });
  const context = Object.assign({
    window: win,
    document,
    Lex: win.Lex,
    LanaTime: win.LanaTime,
    api,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => {}
  }, extra || {});
  win.document = document;
  win.api = api;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return win;
}

const params = (search) => Object.fromEntries(new URLSearchParams(search.toString()));
const plain = (value) => JSON.parse(JSON.stringify(value));

describe('AdminTableKit', () => {
  const win = loadPage('js/admin/admin-table-kit.js');
  const kit = win.AdminTableKit;

  test('filter values, date ranges and paging', () => {
    expect(plain(kit.filterValues({ operator: 'in', value: ['a', ' b '] }))).toEqual(['a', 'b']);
    expect(kit.firstFilterValue({ name: { operator: 'contains', value: 'Ann' } }, 'name')).toBe('Ann');
    const p = new URLSearchParams();
    kit.setRange(p, { created_at: { operator: 'in', value: ['7d'] } }, 'created_at', 'created_after', 'created_before', NOW);
    expect(params(p)).toEqual({ created_after: '2026-10-13T15:30:00.000Z' });
    expect(plain(kit.pageOffset({ page: 3, limit: 20 }))).toEqual({ limit: 20, offset: 40 });
  });

  test('Created cells use Lex.Utils.formatDateTime; empty cells are a muted dash', () => {
    expect(kit.timeCell('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
    expect(kit.timeCell('')).toBe('<span class="admin-table-muted">—</span>');
    expect(kit.matterLink('MATT-1', 'Smith v. Jones')).toContain('data-matter-id="MATT-1"');
    expect(kit.badge('Active', 'green')).toBe('<lex-badge label="Active" color="green" size="sm"></lex-badge>');
    expect(plain(kit.labelOptions(['in_progress', 'lead-management']))).toEqual([
      { value: 'in_progress', label: 'In progress' },
      { value: 'lead-management', label: 'Lead management' }
    ]);
  });
});

describe('Users page deep link', () => {
  // "Invite your team" in the onboarding tour links to admin/users.html?action=create.
  const modalOpenedFor = (search) => {
    const modal = { open: false, addEventListener: () => {} };
    loadPage('js/admin/admin-users.js', { AdminUsersPagination: require('../../src/js/admin/admin-users.pagination') }, { search, elements: { userModal: modal } });
    return modal.open;
  };

  test('?action=create opens the Add User modal; other visits leave it closed', () => {
    expect(modalOpenedFor('?action=create')).toBe(true);
    expect(modalOpenedFor('')).toBe(false);
    expect(modalOpenedFor('?action=edit')).toBe(false);
  });
});

describe('Users table', () => {
  const win = loadPage('js/admin/admin-users.js', { AdminUsersPagination: require('../../src/js/admin/admin-users.pagination') });
  const t = win.AdminUsersTable;

  test('maps the query to the admin users API', () => {
    const query = {
      page: 2, limit: 20, sortBy: 'email', sortDir: 'asc',
      filters: {
        name: { operator: 'contains', value: 'ann' },
        status: { operator: 'in', value: ['active'] },
        role: { operator: 'in', value: ['r1', 'r2'] },
        created_at: { operator: 'in', value: ['older'] }
      }
    };
    expect(params(t.toApiParams(query, 'smith', NOW))).toEqual({
      page: '2', page_size: '20', sort_by: 'email', sort_order: 'asc', search: 'smith',
      name: 'ann', status_filter: 'active', role_id_filter: 'r1,r2', created_before: '2026-09-20T15:30:00.000Z'
    });
    expect(params(t.toApiParams({ sortBy: 'name' }, ''))).toMatchObject({ sort_by: 'created_at', sort_order: 'desc', page: '1' });
  });

  test('rows keep raw values; renderers format them', () => {
    const row = t.mapUser({ id: 7, first_name: 'Ann', last_name: 'Lee', email: 'a@x.io', username: 'alee', role_id: 'r1', role_name: 'org_admin', status: 'active', created_at: '2026-01-20T20:16:00Z' });
    expect(row.created_at).toBe('2026-01-20T20:16:00Z');
    expect(row.status).toBe('active');
    const r = t.cellRenderers();
    expect(r.created_at(row.created_at)).toContain('1/20/2026 3:16 PM');
    expect(r.status('active')).toContain('label="Active"');
    expect(r.role(row.role, row)).toContain('Org admin');
    expect(r.name(row.name, row)).toContain('admin-table-name');
  });

  test('every column has a header filter', () => {
    const map = t.filterOptions([{ id: 'r1', name: 'org_admin' }]);
    expect(Object.keys(map).sort()).toEqual(['created_at', 'email', 'name', 'role', 'status', 'username']);
    expect(plain(map.role.options)).toEqual([{ value: 'r1', label: 'Org admin' }]);
    expect(map.status.options[0]).toMatchObject({ value: 'active', label: 'Active' });
    expect(map.created_at.single).toBe(true);
  });
});

describe('Sessions table', () => {
  const win = loadPage('js/admin/admin-sessions.js');
  const t = win.AdminSessionsTable;

  test('maps the query; unsortable columns fall back to Created', () => {
    const query = { page: 1, limit: 50, sortBy: 'last_activity', sortDir: 'desc', filters: {
      device: { operator: 'in', value: ['Mobile'] },
      ip_address: { operator: 'contains', value: '10.0.0.3' },
      status: { operator: 'in', value: ['idle'] },
      expires_at: { operator: 'in', value: ['30d'] }
    } };
    expect(params(t.toApiParams(query, '', NOW))).toEqual({
      page: '1', page_size: '50', sort_by: 'created_at', sort_order: 'desc',
      device_filter: 'Mobile', ip_address_filter: '10.0.0.3', activity_status: 'idle',
      expires_after: '2026-09-20T15:30:00.000Z'
    });
  });

  test('status is worked out from last activity; rows stay raw', () => {
    const nowMs = Date.parse('2026-10-20T15:30:00Z');
    const active = t.mapSession({ session_id: 's1', user_email: 'a@x.io', last_activity: '2026-10-20T15:28:00Z', created_at: '2026-10-20T14:00:00Z' }, nowMs);
    const idle = t.mapSession({ session_id: 's2', last_activity: '2026-10-20T15:00:00Z' }, nowMs);
    expect(active.status).toBe('active');
    expect(idle.status).toBe('idle');
    expect(active.created_at).toBe('2026-10-20T14:00:00Z');
    const r = t.cellRenderers();
    expect(r.status('idle')).toContain('label="Idle"');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('1/20/2026 3:16 PM');
    expect(Object.keys(t.filterOptions()).sort()).toEqual(['created_at', 'device', 'expires_at', 'ip_address', 'last_activity', 'status', 'user']);
  });
});

describe('Audit table', () => {
  const win = loadPage('js/admin/admin-audit.js', {
    EventDisplayNames: { getEventDisplayName: (t) => String(t).replace(/[._]/g, ' ') }
  });
  const t = win.AdminAuditTable;

  test('builds the query body: paging, dates, ip, event types', () => {
    const body = t.toQueryBody({ page: 2, limit: 20, sortDir: 'desc', filters: {
      event_type: { operator: 'in', value: ['user.login'] },
      ip_address: { operator: 'contains', value: '1.2.3.4' },
      user_email: { operator: 'contains', value: 'ann' },
      created_at: { operator: 'in', value: ['7d'] }
    } }, 'login', [], NOW);
    expect(plain(body)).toEqual({
      limit: 20, offset: 20, sort_by: 'created_at', sort_order: 'desc',
      event_types: ['user.login'], ip_addresses: ['1.2.3.4'], user_email: 'ann', search: 'login',
      start_date: '2026-10-13T15:30:00.000Z'
    });
  });

  test('categories are server-side: category types, intersection, Other from statistics', () => {
    const security = t.toQueryBody({ filters: { category: { operator: 'in', value: ['security'] } } }, '', []);
    expect(security.event_types).toContain('auth.failed');
    expect(security.event_types).not.toContain('user.login');
    const both = t.toQueryBody({ filters: {
      category: { operator: 'in', value: ['security'] },
      event_type: { operator: 'in', value: ['auth.failed', 'user.login'] }
    } }, '', []);
    expect(plain(both.event_types)).toEqual(['auth.failed']);
    const other = t.toQueryBody({ filters: { category: { operator: 'in', value: ['other'] } } }, '', ['custom.thing']);
    expect(plain(other.event_types)).toEqual(['custom.thing']);
    expect(t.toQueryBody({ filters: { category: { operator: 'in', value: ['other'] } } }, '', [])).toBeNull();
  });

  test('rows use the event timestamp as Created; every column filters', () => {
    const row = t.mapLog({ id: 'l1', event_type: 'user.login', timestamp: '2026-01-20T20:16:00Z', user_email: 'a@x.io' });
    expect(row.created_at).toBe('2026-01-20T20:16:00Z');
    const r = t.cellRenderers();
    expect(r.created_at(row.created_at)).toContain('1/20/2026 3:16 PM');
    expect(r.event_type('user.login')).toContain('User login');
    const map = t.filterOptions(['user.login', 'auth.failed']);
    expect(Object.keys(map).sort()).toEqual(['created_at', 'event_type', 'ip_address', 'user_email']);
    expect(map.event_type.options.map((o) => o.label)).toEqual(['Auth failed', 'User login']);
  });
});

describe('Traces table', () => {
  const win = loadPage('js/admin/admin-traces.js');
  const t = win.AdminTracesTable;

  test('maps the query to the traces API (limit/offset, camelCase sort)', () => {
    const options = t.toApiOptions({ page: 3, limit: 20, sortBy: 'duration', sortDir: 'asc', filters: {
      status: { operator: 'in', value: ['failed'] },
      chat_mode: { operator: 'in', value: ['rag', 'agentic'] },
      duration: { operator: 'in', value: ['5s_30s'] },
      llm_calls: { operator: 'in', value: ['none'] },
      user_message: { operator: 'contains', value: 'lease' },
      created_at: { operator: 'in', value: ['30d'] }
    } }, 'indemnity', NOW);
    expect(plain(options)).toEqual({
      limit: 20, offset: 40, sortBy: 'total_duration_ms', sortOrder: 'asc', search: 'indemnity',
      message: 'lease', status: 'failed', chatMode: 'rag,agentic',
      minDurationMs: 5000, maxDurationMs: 30000, maxLlmCalls: 1,
      createdAfter: '2026-09-20T15:30:00.000Z'
    });
  });

  test('a pasted id filters by conversation, session or trace', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const options = t.toApiOptions({ filters: {} }, id);
    expect(options.conversationId).toBe(id);
    expect(options.search).toBeUndefined();
  });

  test('rows stay raw; renderers badge status and route', () => {
    const row = t.mapTrace({ trace_id: 't1', status: 'completed', chat_mode: 'text_transform', total_duration_ms: 1500, llm_call_count: 2, created_at: '2026-01-20T20:16:00Z' });
    expect(row.duration).toBe(1500);
    const r = t.cellRenderers();
    expect(r.status('completed')).toContain('label="Completed"');
    expect(r.chat_mode('text_transform')).toContain('label="Text transform"');
    expect(r.duration(1500)).toContain('1.50s');
    expect(r.created_at(row.created_at)).toContain('1/20/2026 3:16 PM');
    expect(Object.keys(t.filterOptions()).sort()).toEqual(['chat_mode', 'created_at', 'duration', 'llm_calls', 'status', 'user_message']);
  });
});

describe('User details sessions table', () => {
  const win = loadPage('js/admin/admin-user-details.js');
  const t = win.AdminUserSessionsTable;

  test('maps the query to the user sessions API', () => {
    expect(params(t.toApiParams({ page: 1, limit: 20, sortBy: 'last_activity', sortDir: 'asc', filters: {
      ip_address: { operator: 'contains', value: '10.0.0.1' },
      created_at: { operator: 'in', value: ['older'] }
    } }, 'chrome', NOW))).toEqual({
      page: '1', page_size: '20', sort_by: 'last_activity', sort_order: 'asc', search: 'chrome',
      ip_address_filter: '10.0.0.1', created_before: '2026-09-20T15:30:00.000Z'
    });
  });

  test('rows stay raw; every column filters', () => {
    const row = t.mapSession({ session_id: 's1', user_agent: 'Mozilla', created_at: '2026-01-20T20:16:00Z', expires_at: '2026-01-21T20:16:00Z' });
    expect(row.created_at).toBe('2026-01-20T20:16:00Z');
    expect(t.cellRenderers().created_at(row.created_at)).toContain('1/20/2026 3:16 PM');
    expect(Object.keys(t.filterOptions()).sort()).toEqual(['created_at', 'device', 'expires_at', 'ip_address', 'last_activity']);
  });
});

describe('Data Visualization table', () => {
  const win = loadPage('js/admin/data-visualization.js');
  const t = win.DataVizTable;
  const matters = t.VIEW_CONFIG.mcp_client_matters;

  test('maps the query to mcp-data: exact column filters, date ranges, sort fallback', () => {
    expect(params(t.toApiParams({ page: 2, limit: 50, sortBy: 'matter_name', sortDir: 'asc', filters: {
      status: { operator: 'contains', value: 'open' },
      is_active_matter: { operator: 'in', value: ['true'] },
      created_at: { operator: 'in', value: ['7d'] },
      not_a_column: { operator: 'in', value: ['x'] }
    } }, matters, 'smith', NOW))).toEqual({
      page: '2', limit: '50', sort_by: 'matter_name', sort_dir: 'asc', search: 'smith',
      filter_status: 'open', filter_is_active_matter: 'true', created_after: '2026-10-13T15:30:00.000Z'
    });
    expect(params(t.toApiParams({ sortBy: 'bogus' }, matters, ''))).toMatchObject({ sort_by: 'created_at', sort_dir: 'desc' });
    expect(t.rangeBase('due_date')).toBe('due_date');
  });

  test('matter names link to workspace-details by ?id=, values render through renderers', () => {
    const row = t.mapRow({ id: 'u1', matter_id: 'MATT-9', matter_name: 'Smith', status: 'in_progress', is_active_matter: true, created_at: '2026-01-20T20:16:00Z' }, 0);
    expect(row._key).toBe('u1');
    expect(row.created_at).toBe('2026-01-20T20:16:00Z');
    const r = t.cellRenderers(matters);
    expect(r.matter_name(row.matter_name, row)).toContain('data-matter-id="MATT-9"');
    expect(r.status(row.status)).toContain('label="In progress"');
    expect(r.is_active_matter(true)).toContain('Yes');
    expect(r.created_at(row.created_at)).toContain('1/20/2026 3:16 PM');
    const actions = t.getRecordActions('mcp_client_matters', { matter_id: 'MATT-9' });
    expect(actions[0].href).toBe('../workspace-details.html?id=MATT-9');
  });

  test('every column of every view has a header filter', () => {
    Object.keys(t.VIEW_CONFIG).forEach((view) => {
      const config = t.VIEW_CONFIG[view];
      const cols = config.columns.split(',');
      const map = t.filterOptions(config);
      expect(Object.keys(map).sort()).toEqual(cols.slice().sort());
    });
  });
});

describe('Admin pages follow the table standard markup', () => {
  const pages = {
    'admin/users.html': 'usersTable',
    'admin/sessions.html': 'sessionsTable',
    'admin/audit.html': 'auditTable',
    'admin/traces.html': 'tracesTable',
    'admin/user-details.html': 'userSessionsTable',
    'admin/data-visualization.html': 'dataVizTable'
  };

  test.each(Object.entries(pages))('%s: card table, column filters, server paging, no outside pager', (page, id) => {
    const html = read(page);
    const tag = html.slice(html.indexOf('id="' + id + '"'), html.indexOf('</lex-table>', html.indexOf('id="' + id + '"')));
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('server-paging');
    expect(tag).toContain('limit="20"');
    expect(tag).not.toMatch(/\bsearchable\b|\bfilterable\b|\bcompact\b/);
    expect(html).not.toContain('<lex-pagination');
    expect(html).not.toContain('<select');
    expect(html).not.toMatch(/Created (At|On|Date)/);
    expect(html).toContain('js/admin/admin-table-kit.js');
    expect(html).toContain('js/shared/library-column-filters.js');
    expect(html).toContain('css/admin/admin-tables.css');
  });

  test('controllers no longer patch cells with a MutationObserver', () => {
    ['admin-users.js', 'admin-sessions.js', 'admin-audit.js', 'admin-traces.js', 'admin-user-details.js', 'data-visualization.js'].forEach((file) => {
      const js = read('js/admin/' + file);
      expect(js).not.toContain('MutationObserver');
      expect(js).toContain('setCellRenderers');
    });
  });

  test('audit has no separate Apply/Clear filter card', () => {
    const html = read('admin/audit.html');
    expect(html).not.toContain('applyFiltersBtn');
    expect(html).not.toContain('clearFiltersBtn');
  });
});
