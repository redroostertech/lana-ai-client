'use strict';

/**
 * The connector catalog table shared by Data Connectors and the automation
 * app's Connectors view (js/shared/connector-table.js, docs/TABLE-STANDARD.md):
 * labels, header filters, renderers, markup, query snapshots, the toolbar
 * wiring, and the Data Connectors row mapping.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });

function baseWindow() {
  const win = { localStorage: { getItem: () => STORED_USER, setItem: () => {} }, Intl, Date, setTimeout, clearTimeout };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/connector-table.js'))(win);
  return win;
}

describe('LanaConnectorTable labels', () => {
  const T = baseWindow().LanaConnectorTable;

  test('auth, category, scope and version labels are readable and capitalised', () => {
    expect(T.authLabel('oauth2')).toBe('OAuth 2.0');
    expect(T.authLabel('api_key')).toBe('API key');
    expect(T.authLabel('service_account')).toBe('Service account');
    expect(T.categoryLabel('crm')).toBe('CRM');
    expect(T.categoryLabel('case_management')).toBe('Case management');
    expect(T.categoryLabel('unknown')).toBe('Other');
    expect(T.scopeLabel('user')).toBe('Personal');
    expect(T.scopeLabel('org')).toBe('Firm');
    expect(T.versionLabel('1.2.0')).toBe('v1.2.0');
    expect(T.versionLabel('v2.0.0')).toBe('v2.0.0');
    expect(T.versionLabel('')).toBe('');
  });

  test('automation readiness maps raw statuses onto one vocabulary', () => {
    expect(T.automationStatusKey('connected')).toBe('ready');
    expect(T.automationStatusKey('ACTIVE')).toBe('ready');
    expect(T.automationStatusKey('installed')).toBe('ready');
    expect(T.automationStatusKey('syncing')).toBe('syncing');
    expect(T.automationStatusKey('error')).toBe('error');
    expect(T.automationStatusKey('coming_soon')).toBe('coming_soon');
    expect(T.automationStatusKey('disconnected')).toBe('not_installed');
    expect(T.automationStatusKey('')).toBe('not_installed');
  });

  test('counts and empty copy', () => {
    expect(T.countText(1)).toBe('1 connector');
    expect(T.countText(3)).toBe('3 connectors');
    expect(T.emptyText(true)).toMatch(/^No matching connectors/);
    expect(T.emptyText(false)).toBe('No connectors available yet');
  });
});

describe('LanaConnectorTable header filters', () => {
  const T = baseWindow().LanaConnectorTable;
  const statuses = { connected: { label: 'Connected', color: 'green' }, not_connected: { label: 'Not connected', color: 'gray' } };
  const rows = [
    { name: 'Gmail', category: 'communications', auth_type: 'oauth2', scope: 'user', status: 'connected', version: '2.0.0', created_at: '2026-10-20T12:00:00Z' },
    { name: 'Leadly', category: 'crm', auth_type: 'api_key', scope: 'org', status: 'weird_state', version: '1.0.0', created_at: '' },
    { name: 'Sheets', category: 'crm', auth_type: 'oauth2', scope: 'org', status: 'not_connected', version: '' }
  ];
  const options = T.columnFilterOptions(rows, statuses);

  test('every labelled column has a filter', () => {
    T.COLUMNS.forEach((col, i) => {
      if (T.LABELS[i]) expect(options[col]).toBeDefined();
    });
    expect(options.name).toEqual({ text: true, placeholder: 'Name contains...' });
  });

  test('value lists are distinct, labelled and sorted by label', () => {
    expect(options.category.options).toEqual([
      { value: 'communications', label: 'Communications' },
      { value: 'crm', label: 'CRM' }
    ]);
    expect(options.auth_type.options).toEqual([
      { value: 'api_key', label: 'API key' },
      { value: 'oauth2', label: 'OAuth 2.0' }
    ]);
    expect(options.version.options.map((o) => o.label)).toEqual(['v1.0.0', 'v2.0.0']);
    expect(options.scope.options).toEqual([{ value: 'org', label: 'Firm' }, { value: 'user', label: 'Personal' }]);
  });

  test('status options keep the vocabulary order and add unknown values humanized', () => {
    expect(options.status.options).toEqual([
      { value: 'connected', label: 'Connected' },
      { value: 'not_connected', label: 'Not connected' },
      { value: 'weird_state', label: 'Weird state' }
    ]);
  });

  test('Created filters by range on the client', () => {
    expect(options.created_at.single).toBe(true);
    expect(options.created_at.options.map((o) => o.value)).toEqual(['today', '7d', '30d', 'older']);
    expect(options.created_at.match(new Date().toISOString(), ['7d'])).toBe(true);
    expect(options.created_at.match('2020-01-01T00:00:00Z', ['7d'])).toBe(false);
    expect(options.created_at.match('', ['7d'])).toBe(false);
  });
});

describe('LanaConnectorTable renderers', () => {
  const T = baseWindow().LanaConnectorTable;
  const renderers = T.cellRenderers({
    statuses: { connected: { label: 'Connected', color: 'green' } },
    actionsCell: (row) => `<lex-btn data-x="${row.id}">Open</lex-btn>`
  });
  const row = { id: 'gmail', pin_key: 'gmail', pinned: 'yes', name: 'Gmail <b>', vendor: 'Google', logo_url: '' };

  test('name is semibold, escaped, with the vendor and an initial', () => {
    const html = renderers.name('Gmail <b>', row);
    expect(html).toContain('connector-table-name');
    expect(html).toContain('Gmail &lt;b&gt;');
    expect(html).toContain('Google');
    expect(html).not.toContain('<b>');
  });

  test('status and scope are badges; unknown values are humanized', () => {
    expect(renderers.status('connected')).toBe('<lex-badge label="Connected" color="green" size="sm"></lex-badge>');
    expect(renderers.status('in_review')).toContain('label="In review"');
    expect(renderers.scope('user')).toContain('label="Personal" color="blue"');
    expect(renderers.scope('org')).toContain('label="Firm" color="gray"');
  });

  test('labels, versions and dates format raw values; empties are a muted dash', () => {
    expect(renderers.category('case_management')).toContain('Case management');
    expect(renderers.auth_type('oauth2')).toContain('OAuth 2.0');
    expect(renderers.version('1.0.0')).toContain('v1.0.0');
    expect(renderers.version('')).toContain('connector-table-muted');
    expect(renderers.created_at('')).toContain('—');
    const created = renderers.created_at('2026-10-20T19:16:00Z');
    expect(created).toContain('datetime="2026-10-20T19:16:00Z"');
    expect(created).toContain('10/20/2026 3:16 PM');
  });

  test('pin and actions cells', () => {
    const pin = renderers.pin(undefined, row);
    expect(pin).toContain('data-connector-pin="gmail"');
    expect(pin).toContain('aria-pressed="true"');
    expect(renderers.pin(undefined, { ...row, pinned: 'no' })).toContain('aria-pressed="false"');
    expect(renderers.actions(undefined, row)).toContain('<lex-btn data-x="gmail">Open</lex-btn>');
  });
});

describe('LanaConnectorTable markup', () => {
  const T = baseWindow().LanaConnectorTable;

  test('standard lex-table attributes, no legacy ones', () => {
    const html = T.sectionMarkup({ prefix: 'c', tableId: 'cTable', title: 'Connectors' });
    expect(html).toContain('class="connector-table lex-table--card"');
    expect(html).toContain(' column-filters');
    expect(html).toContain('columns="pin,name,category,auth_type,scope,status,version,created_at,actions"');
    expect(html).toContain('labels=",Name,Category,Auth,Scope,Status,Version,Created,"');
    expect(html).toContain('sort-by="created_at" sort-dir="desc"');
    expect(html).toContain('limit="20"');
    expect(html).toContain('search-keys="name,vendor,description,category,auth_type"');
    expect(html).not.toMatch(/\s(searchable|filterable|compact|server-paging)[\s>]/);
    expect(html).toContain('id="cSearch"');
    expect(html).toContain('id="cSectionCount"');
    expect(html).not.toContain('<select');
  });

  test('a stored query restores sort, search, page size and the Show filter', () => {
    const html = T.sectionMarkup({
      prefix: 'c', tableId: 'cTable', title: 'Connectors',
      query: { sortBy: 'name', sortDir: 'asc', search: 'gm"ail', limit: 50, filters: { pinned: { operator: 'in', value: ['yes'] } } }
    });
    expect(html).toContain('sort-by="name" sort-dir="asc"');
    expect(html).toContain('limit="50"');
    expect(html).toContain('value="gm&quot;ail"');
    expect(html).toMatch(/id="cPinned"[^>]*value="yes"/);
  });

  test('snapshot copies the table query', () => {
    const query = { search: 'g', sortBy: 'status', sortDir: 'asc', filters: { status: { operator: 'in', value: ['connected'] } }, page: 2, limit: 50 };
    const snap = T.snapshot({ dataSource: { query } });
    expect(snap).toEqual(query);
    expect(snap.filters).not.toBe(query.filters);
    expect(T.snapshot(null)).toBeNull();
  });
});

describe('LanaConnectorTable.mount', () => {
  function fakeEl(extra) {
    const listeners = {};
    return Object.assign({
      dataset: {},
      value: '',
      textContent: '',
      addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
      fire: (name, event) => (listeners[name] || []).forEach((fn) => fn(event)),
      listeners
    }, extra);
  }

  function setup() {
    const win = baseWindow();
    const state = { search: '', sortBy: 'created_at', sortDir: 'desc', filters: {}, page: 1, limit: 20 };
    const table = fakeEl({
      sortBy: 'created_at',
      sortDir: 'desc',
      rows: [],
      setCellRenderers: jest.fn(),
      setColumnFilterOptions: jest.fn(),
      setData(rows) { this.rows = rows; },
      restoreQuery: jest.fn((q) => Object.assign(state, { filters: {} }, q)),
      addFilter: jest.fn((col, op, value) => { state.filters[col] = { operator: op, value }; }),
      removeFilter: jest.fn((col) => { delete state.filters[col]; })
    });
    // Object.assign would freeze getters into values: define them on the fake.
    Object.defineProperties(table, {
      dataSource: { get: () => ({ query: { ...state, filters: { ...state.filters } } }) },
      searchText: { get: () => state.search },
      filteredRows: {
        get: () => table.rows.filter((r) => !state.search || r.name.toLowerCase().includes(state.search))
          .filter((r) => !state.filters.pinned || r.pinned === 'yes')
      }
    });
    const els = {
      cTable: table,
      cSearch: fakeEl(),
      cSort: fakeEl({ value: 'created_at' }),
      cSortOrder: fakeEl({ dataset: { order: 'desc' } }),
      cPinned: fakeEl({ value: 'all' }),
      cCount: fakeEl(),
      cSectionCount: fakeEl()
    };
    win.document = { getElementById: (id) => els[id] || null };
    const rows = [
      { id: 'a', name: 'Gmail', pinned: 'yes' },
      { id: 'b', name: 'Leadly', pinned: 'no' }
    ];
    const store = {};
    const onRowClick = jest.fn();
    return { win, table, els, rows, store, state, onRowClick };
  }

  test('fills the table, counts rows, and wires search, sort, Show and row clicks', async () => {
    jest.useFakeTimers();
    const { win, table, els, rows, store, state, onRowClick } = setup();
    const controller = await win.LanaConnectorTable.mount({
      prefix: 'c', tableId: 'cTable', rows, statuses: {}, store, onRowClick, actionsCell: () => ''
    });
    expect(table.setCellRenderers).toHaveBeenCalled();
    expect(table.setColumnFilterOptions).toHaveBeenCalled();
    expect(els.cCount.textContent).toBe('2 connectors');
    expect(els.cSectionCount.textContent).toBe('2 connectors');
    expect(store.query.sortBy).toBe('created_at');

    els.cSearch.fire('lex-input', { detail: { value: 'gma' } });
    jest.advanceTimersByTime(400);
    expect(state.search).toBe('gma');
    expect(els.cCount.textContent).toBe('1 connector');
    expect(table.emptyText).toMatch(/^No matching connectors/);

    els.cSort.fire('lex-change', { detail: { value: 'name' } });
    expect(state.sortBy).toBe('name');
    els.cSortOrder.fire('click', {});
    expect(els.cSortOrder.dataset.order).toBe('asc');
    expect(state.sortDir).toBe('asc');

    els.cPinned.fire('lex-change', { detail: { value: 'yes' } });
    expect(table.addFilter).toHaveBeenCalledWith('pinned', 'in', ['yes']);
    els.cPinned.fire('lex-change', { detail: { value: 'all' } });
    expect(table.removeFilter).toHaveBeenCalledWith('pinned');

    table.fire('row-click', { detail: { row: rows[1] } });
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);

    // New rows keep the query.
    controller.setRows(rows.concat({ id: 'c', name: 'Gmail two', pinned: 'no' }));
    expect(state.search).toBe('gma');
    expect(els.cCount.textContent).toBe('2 connectors');
    jest.useRealTimers();
  });

  test('pin clicks go to onPinClick when the page owns them', async () => {
    const { win, table, rows, store } = setup();
    const onPinClick = jest.fn();
    await win.LanaConnectorTable.mount({ prefix: 'c', tableId: 'cTable', rows, statuses: {}, store, onPinClick });
    const pin = { getAttribute: () => 'gmail' };
    const event = { target: { closest: (sel) => (sel === '[data-connector-pin]' ? pin : null) }, preventDefault: jest.fn(), stopPropagation: jest.fn() };
    table.fire('click', event);
    expect(onPinClick).toHaveBeenCalledWith('gmail');
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});

describe('Data Connectors row mapping', () => {
  function loadPage() {
    const win = baseWindow();
    win.ConnectorRegistry = { isConnectorInstalled: () => false };
    const doc = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} };
    win.addEventListener = () => {};
    win.Lex.Toast = { error: () => {}, warning: () => {} };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'ConnectorRegistry', 'Connectors', 'api', 'Lex', read('js/data_connectors.js'))(
      win, doc, win.ConnectorRegistry, {}, {}, win.Lex
    );
    return win.DataConnectorsTable;
  }

  test('rows keep raw values; status, scope, pin and Created come from the record', () => {
    const page = loadPage();
    const installed = {
      id: 'src-1', connector_id: 'gmail', name: 'Gmail', category: 'case', auth_type: 'OAuth2',
      connector_scope: 'user', status: 'connected', version: 'v2.1.0', created_at: '2026-10-01T10:00:00Z', vendor: 'Google'
    };
    const row = page.mapConnectorRow(installed, [installed], ['src-1']);
    expect(row).toMatchObject({
      id: 'src-1', pin_key: 'src-1', pinned: 'yes', name: 'Gmail', vendor: 'Google',
      category: 'case_management', auth_type: 'oauth2', scope: 'user', status: 'connected',
      version: '2.1.0', created_at: '2026-10-01T10:00:00Z', update_slug: 'gmail'
    });
    expect(row._raw).toBe(installed);

    const catalog = page.mapConnectorRow({ id: 'leadly', name: 'Leadly', category: 'crm', authType: 'api_key' }, [], []);
    expect(catalog).toMatchObject({ pinned: 'no', status: 'not_connected', scope: 'org', created_at: '', version: '1.0.0' });
  });

  test('actions keep the existing handlers', () => {
    const page = loadPage();
    const connected = page.mapConnectorRow({ id: 'src-1', connector_id: 'gmail', name: 'Gmail', status: 'connected' }, [], []);
    const html = page.connectorActionsCell(connected);
    expect(html).toContain("openConnectorManage('src-1')");
    expect(html).toContain("showConnectorDetails('src-1', event)");
    expect(html).toContain("openConnectorUpdateModal('src-1', event)");

    const notConnected = page.mapConnectorRow({ id: 'leadly', name: 'Leadly' }, [], []);
    expect(page.connectorActionsCell(notConnected)).toContain("installConnector('leadly', event)");

    const soon = page.mapConnectorRow({ id: 'x', name: 'X', status: 'coming_soon' }, [], []);
    const soonHtml = page.connectorActionsCell(soon);
    expect(soonHtml).toContain('View details');
    expect(soonHtml).not.toContain('installConnector');
  });

  test('status vocabulary labels are capitalised', () => {
    const page = loadPage();
    Object.values(page.CONNECTOR_STATUSES).forEach((s) => {
      expect(s.label.charAt(0)).toBe(s.label.charAt(0).toUpperCase());
    });
  });
});
