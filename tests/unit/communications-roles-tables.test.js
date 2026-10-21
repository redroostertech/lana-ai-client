'use strict';

/**
 * Communications (provider instances, routes) and Roles tables on the table
 * standard (docs/TABLE-STANDARD.md): raw rows, renderers and header filters.
 * Both APIs return the organization's whole (small) set, so the tables are
 * client-side; filters use match predicates for ranges.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });

function loadPage(rel, { admin = true } = {}) {
  const win = { localStorage: { getItem: () => STORED_USER }, Intl, Date };
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
  win.Lex.Auth = { isAdmin: () => admin, hasRole: () => admin };
  win.Lex.Redact = { on: () => {}, off: () => {} };

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
    api,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    Promise
  };
  win.document = document;
  win.api = api;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return win;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

describe('Communications provider instances table', () => {
  const win = loadPage('js/admin/admin-communications.js');
  const t = win.CommunicationsTables;

  const provider = {
    id: 'p1',
    provider_key: 'Outlook',
    display_name: 'Firm Outlook',
    channel: 'email',
    status: 'metadata_only',
    readiness: { ready: false, blockers: ['missing_route'] },
    created_at: '2026-01-20T20:16:00Z'
  };

  test('rows keep raw values and the record', () => {
    const row = t.mapProvider(provider);
    expect(plain(Object.assign({}, row, { _raw: undefined }))).toEqual({
      id: 'p1',
      name: 'Firm Outlook',
      provider_key: 'microsoft365',
      channel: 'email',
      status: 'metadata_only',
      readiness: 'not_ready',
      blockers: 1,
      auth_owner: 'connectors',
      created_at: '2026-01-20T20:16:00Z',
      actions: ''
    });
    expect(row._raw).toBe(provider);
    expect(t.mapProvider({ id: 'p2', provider_key: 'mailgun' }).readiness).toBe('unknown');
    expect(t.mapProvider({ id: 'p2', provider_key: 'mailgun' }).auth_owner).toBe('communications');
  });

  test('renderers: badges, capitalised labels, Created date-time, row actions', () => {
    const r = t.providerCellRenderers();
    const row = t.mapProvider(provider);
    expect(r.status(row.status)).toContain('label="Metadata only"');
    expect(r.channel('sms')).toContain('label="SMS"');
    expect(r.readiness('not_ready', row)).toContain('label="Not ready"');
    expect(r.readiness('not_ready', row)).toContain('1 blocker');
    expect(r.auth_owner('connectors')).toContain('label="Connector auth"');
    expect(r.provider_key('microsoft365')).toContain('Microsoft 365');
    expect(r.created_at(row.created_at)).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.created_at('')).toContain('—');
    const actions = r.actions('', row);
    expect(actions).toContain('data-provider-edit="p1"');
    expect(actions).toContain('data-provider-readiness="p1"');
  });

  test('every data column has a filter; Created filters by range', () => {
    const map = t.providerFilterOptions([t.mapProvider(provider)]);
    expect(Object.keys(map).sort()).toEqual(['auth_owner', 'channel', 'created_at', 'name', 'provider_key', 'readiness', 'status']);
    expect(map.name.text).toBe(true);
    expect(plain(map.channel.options)).toEqual([
      { value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }, { value: 'voice', label: 'Voice' }
    ]);
    expect(plain(map.status.options).map((o) => o.label)).toEqual(['Active', 'Inactive', 'Disabled']);
    expect(plain(map.provider_key.options).find((o) => o.value === 'microsoft365').label).toBe('Microsoft 365');
    expect(map.created_at.single).toBe(true);
    expect(map.created_at.match(new Date().toISOString(), ['today'])).toBe(true);
    expect(map.created_at.match('2020-01-01T00:00:00Z', ['today'])).toBe(false);
  });
});

describe('Communications routes table', () => {
  const win = loadPage('js/admin/admin-communications.js');
  const t = win.CommunicationsTables;
  const route = {
    id: 'r1',
    route_key: 'primary-email',
    display_name: 'Primary email',
    provider_id: 'p1',
    provider_display_name: 'Firm Outlook',
    channel: 'email',
    direction: 'bidirectional',
    is_enabled: false,
    readiness: { ready: true },
    identity_key: 'intake',
    created_at: '2026-01-20T20:16:00Z'
  };

  test('rows keep raw values; priority defaults to 100', () => {
    const row = t.mapRoute(route);
    expect(row.name).toBe('Primary email');
    expect(row.provider).toBe('p1');
    expect(row.provider_name).toBe('Firm Outlook');
    expect(row.enabled).toBe('disabled');
    expect(row.readiness).toBe('ready');
    expect(row.priority).toBe(100);
    expect(row.identity).toBe('intake');
    expect(t.mapRoute({ id: 'r2', priority: 5 }).priority).toBe(5);
  });

  test('renderers and filters', () => {
    const r = t.routeCellRenderers();
    const row = t.mapRoute(route);
    expect(r.name(row.name, row)).toContain('primary-email');
    expect(r.direction('bidirectional')).toContain('label="Bidirectional"');
    expect(r.enabled('disabled')).toContain('label="Disabled"');
    expect(r.identity('')).toContain('None');
    expect(r.actions('', row)).toContain('data-route-edit="r1"');

    const map = t.routeFilterOptions([row]);
    expect(Object.keys(map).sort()).toEqual(['channel', 'created_at', 'direction', 'enabled', 'identity', 'name', 'priority', 'provider', 'readiness']);
    expect(plain(map.provider.options)).toEqual([{ value: 'p1', label: 'Firm Outlook' }]);
    expect(map.priority.match(50, ['lt100'])).toBe(true);
    expect(map.priority.match(100, ['100'])).toBe(true);
    expect(map.priority.match(150, ['100'])).toBe(false);
    expect(map.priority.match(150, ['gt100'])).toBe(true);
  });
});

describe('Roles table', () => {
  const role = {
    id: 'role-1',
    name: 'senior_associate',
    display_name: 'Senior Associate',
    description: 'Handles matters',
    permissions: ['matters:read', 'matters:write'],
    level: 60,
    user_count: '3',
    is_active: true,
    created_at: '2026-01-20T20:16:00Z'
  };

  test('rows keep raw values and the record', () => {
    const win = loadPage('js/admin/roles.js');
    const t = win.RolesTable;
    const row = t.mapRole(role);
    expect(plain(Object.assign({}, row, { _raw: undefined }))).toEqual({
      id: 'role-1',
      name: 'Senior Associate',
      description: 'Handles matters',
      level: 60,
      permissions: 2,
      users: 3,
      status: 'active',
      created_at: '2026-01-20T20:16:00Z',
      actions: ''
    });
    expect(t.mapRole({ id: 'x', is_active: false }).status).toBe('inactive');
    expect(t.ROLES_FETCH_LIMIT).toBeGreaterThanOrEqual(500);
  });

  test('renderers: level badge, counts, Created, admin-only actions', () => {
    const win = loadPage('js/admin/roles.js');
    const t = win.RolesTable;
    const row = t.mapRole(role);
    const r = t.cellRenderers(true);
    expect(r.level(60)).toContain('label="Level 60"');
    expect(t.levelColor(95)).toBe('red');
    expect(t.levelColor(1)).toBe('gray');
    expect(r.permissions(2)).toContain('2 permissions');
    expect(r.users(1)).toContain('1 user');
    expect(r.status('inactive')).toContain('label="Inactive"');
    expect(r.created_at(row.created_at)).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.actions('', row)).toContain('data-action="edit-role"');
    expect(r.actions('', row)).toContain('data-action="delete-role"');
    expect(r.actions('', t.mapRole(Object.assign({}, role, { is_system: true })))).not.toContain('delete-role');
    expect(t.cellRenderers(false).actions('', row)).toBe('');
  });

  test('every data column has a filter', () => {
    const win = loadPage('js/admin/roles.js');
    const t = win.RolesTable;
    const rows = [t.mapRole(role), t.mapRole(Object.assign({}, role, { id: 'b', level: 10, permissions: [] }))];
    const map = t.filterOptions(rows);
    expect(Object.keys(map).sort()).toEqual(['created_at', 'level', 'name', 'permissions', 'status', 'users']);
    expect(plain(map.level.options)).toEqual([{ value: '60', label: 'Level 60' }, { value: '10', label: 'Level 10' }]);
    expect(map.permissions.match(0, ['0-1'])).toBe(true);
    expect(map.permissions.match(2, ['0-1'])).toBe(false);
    expect(map.users.match(3, ['1-5'])).toBe(true);
    expect(plain(map.status.options)).toEqual([{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]);
    expect(map.created_at.single).toBe(true);
  });
});

describe('Communications and Roles pages follow the table standard markup', () => {
  test.each([
    ['admin/communications.html', ['commProvidersTable', 'commRoutesTable']],
    ['admin/roles.html', ['rolesTable']]
  ])('%s', (rel, ids) => {
    const html = read(rel);
    expect(html).not.toMatch(/<select\b/);
    expect(html).toContain('admin-table-kit.js');
    expect(html).toContain('lex-table.js');
    ids.forEach((id) => {
      const tag = html.slice(html.indexOf('id="' + id + '"'), html.indexOf('</lex-table>', html.indexOf('id="' + id + '"')));
      expect(tag).toContain('lex-table--card');
      expect(tag).toContain('column-filters');
      expect(tag).toContain('limit="20"');
      expect(tag).toMatch(/labels="[^"]*Created/);
      expect(tag).not.toMatch(/\b(searchable|filterable|compact)\b/);
      expect(html).toContain('#' + id + ' table { min-width');
    });
  });
});
