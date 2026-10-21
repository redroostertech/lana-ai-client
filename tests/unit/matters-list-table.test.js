'use strict';

/**
 * Matters page list view (matters.html #mattersListTable) on the table
 * standard (docs/TABLE-STANDARD.md): query mapping, raw rows, renderers,
 * header filters, and the page markup (toolbar, grid/list toggle, table).
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });
const NOW = new Date('2026-10-20T15:30:00.000Z');

function loadModule() {
  const win = { localStorage: { getItem: () => STORED_USER }, Intl, Date };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', read('js/shared/list-query-params.js'))(win, undefined);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/pages/matters-list-table.js'))(win);
  return win;
}

const params = (search) => Object.fromEntries(new URLSearchParams(search.toString()));
const plain = (value) => JSON.parse(JSON.stringify(value));

describe('Matters list table', () => {
  const win = loadModule();
  const table = win.MattersListTable;

  test('maps a server query to GET /api/v1/matters params', () => {
    const p = table.toApiParams({
      page: 3,
      limit: 20,
      sortBy: 'updated_at',
      sortDir: 'asc',
      filters: {
        name: { operator: 'contains', value: 'Smith' },
        client_name: { operator: 'contains', value: 'Acme' },
        matter_id: { operator: 'contains', value: 'MATT-1' },
        status: { operator: 'in', value: ['archived'] },
        matter_type: { operator: 'in', value: ['matter'] },
        created_at: { operator: 'in', value: ['7d'] }
      }
    }, { search: 'lease', includeAll: true, now: NOW });
    expect(params(p)).toEqual({
      page: '3',
      page_size: '20',
      sort_by: 'updated_at',
      sort_order: 'asc',
      exclude_pinned: 'true',
      include_all: 'true',
      search: 'lease',
      status: 'archived',
      include_archived: 'true',
      matter_type: 'matter',
      name: 'Smith',
      matter_id_contains: 'MATT-1',
      created_after: '2026-10-13T15:30:00.000Z',
      client_name: 'Acme'
    });
  });

  test('defaults: page 1, 20 rows, newest first; unknown sort columns fall back to created_at', () => {
    expect(params(table.toApiParams({ sortBy: 'actions' }, {}))).toEqual({
      page: '1',
      page_size: '20',
      sort_by: 'created_at',
      sort_order: 'desc',
      exclude_pinned: 'true',
      include_all: 'false'
    });
  });

  test('"Shared with me" becomes shared_only and never widens to the organization', () => {
    const query = { filters: { status: { operator: 'in', value: ['shared'] } } };
    const p = params(table.toApiParams(query, { includeAll: true }));
    expect(p.shared_only).toBe('true');
    expect(p.include_all).toBe('false');
    expect(p.status).toBeUndefined();
    expect(plain(table.pinnedFilters(query, { search: 'x', includeAll: true }))).toEqual({
      search: 'x', include_all: false, shared_only: true
    });
    expect(plain(table.pinnedFilters({ filters: { status: { value: ['archived'] }, matter_type: { value: ['workspace'] } } }, { includeAll: true }))).toEqual({
      search: '', include_all: true, status: 'archived', include_archived: true, matter_type: 'workspace'
    });
  });

  test('rows keep raw values and the record as _raw', () => {
    const raw = { matter_id: 'MATT-9', matter_name: 'Doe v. Roe', client_name: 'Doe', status: 'Active', matter_type: 'matter', created_at: '2026-01-20T20:16:00Z', updated_at: '2026-10-20T15:00:00Z', source: 'clio' };
    const row = table.mapMatter(raw);
    expect(row).toMatchObject({
      matter_id: 'MATT-9', name: 'Doe v. Roe', client_name: 'Doe', status: 'active',
      matter_type: 'matter', created_at: '2026-01-20T20:16:00Z', updated_at: '2026-10-20T15:00:00Z',
      source: 'clio', is_pinned: false
    });
    expect(row._raw).toBe(raw);
    expect(table.mapMatter({}).name).toBe('Untitled');
  });

  test('renderers: matter link, badges, Created date-time, muted dashes, row action buttons', () => {
    const r = table.cellRenderers();
    const row = table.mapMatter({ matter_id: 'MATT-9', name: 'Doe <v> Roe', description: 'Lease dispute', status: 'closed', matter_type: 'workspace' });
    const name = r.name(row.name, row);
    expect(name).toContain('data-matter-id="MATT-9"');
    expect(name).toContain('Doe &lt;v&gt; Roe');
    expect(name).toContain('Lease dispute');
    expect(r.status('closed')).toBe('<lex-badge label="Closed" color="blue" size="sm"></lex-badge>');
    expect(r.status('in_review')).toContain('label="In review"');
    expect(r.matter_type('matter')).toContain('label="Client matter"');
    expect(r.matter_type('workspace')).toContain('label="Workspace"');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.client_name('')).toBe('<span class="admin-table-muted">—</span>');
    expect(r.created_at('')).toBe('<span class="admin-table-muted">—</span>');
    const actions = r.actions('', row);
    expect(actions).toContain('data-action="pin"');
    expect(actions).toContain('data-action="edit"');
    expect(actions).toContain('data-action="delete"');
    // Action buttons must not carry data-matter-id, which the link handler opens.
    expect(actions).not.toContain('data-matter-id');
  });

  test('every data column has a header filter with capitalised labels', () => {
    const map = plain(table.filterOptions());
    expect(Object.keys(map).sort()).toEqual(['client_name', 'created_at', 'matter_id', 'matter_type', 'name', 'status', 'updated_at']);
    expect(map.name.text).toBe(true);
    expect(map.status.single).toBe(true);
    map.status.options.concat(map.matter_type.options, map.created_at.options).forEach((o) => {
      expect(o.label.charAt(0)).toBe(o.label.charAt(0).toUpperCase());
    });
    expect(map.created_at.single).toBe(true);
  });

  test('empty copy knows when the table was filtered empty', () => {
    expect(plain(table.emptyText(true))).toEqual({ text: 'No matching matters. Try a different search or clear the filters.', actionLabel: '' });
    expect(plain(table.emptyText(false))).toEqual({ text: 'No matters yet', actionLabel: 'New Matter' });
  });
});

describe('matters.html follows the table standard markup', () => {
  const html = read('matters.html');

  test('toolbar: lex-input search, Sort by, order toggle, Status filter, count, grid/list toggle', () => {
    expect(html).toMatch(/<lex-input id="searchInput"/);
    expect(html).toMatch(/<lex-select id="mattersSort"[^>]*"label":"Created"/);
    expect(html).toContain('id="mattersSortOrder"');
    expect(html).toMatch(/<lex-select id="statusFilter"[^>]*"label":"Shared with me"/);
    expect(html).toContain('id="mattersCount"');
    expect(html).toContain('id="gridViewBtn"');
    expect(html).toContain('id="listViewBtn"');
    expect(html).not.toMatch(/<select id="(statusFilter|matterTypeFilter)"/);
  });

  test('the list view is a standard server-paged lex-table with a Created column', () => {
    const tag = html.match(/<lex-table[\s\S]*?id="mattersListTable"[\s\S]*?><\/lex-table>/)[0];
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('server-paging');
    expect(tag).toContain('selectable');
    expect(tag).toContain('limit="20"');
    expect(tag).toContain('labels="Name,Client,Matter ID,Status,Type,Created,Last edited,Actions"');
    expect(tag).not.toMatch(/\s(searchable|filterable|compact)[\s=>]/);
    expect(html).toContain('<h2 id="mattersListHeading"');
    expect(html).toContain('id="mattersSectionCount"');
    expect(html).toContain('#mattersListTable table { min-width:');
  });

  test('loads the table scripts and uses no window.confirm/alert/prompt', () => {
    ['js/lex/components/data/lex-table.js', 'js/lex/components/form/lex-select.js', 'js/lex/components/foundation/lex-modal.js',
      'js/shared/list-query-params.js', 'js/admin/admin-table-kit.js', 'js/pages/matters-list-table.js'].forEach((src) => {
      expect(html).toContain(`<script src="${src}"></script>`);
    });
    expect(html).not.toMatch(/[^.\w](confirm|alert|prompt)\(/);
  });
});
