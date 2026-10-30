'use strict';

// Data Connectors (src/js/data_connectors.js) and third-party MCP servers:
// each server is its own row and opens the MCP server panel, never the
// generic viewer or wizard; the rows and the "Add MCP server" action show
// only when the MCP UI is visible (flag on, system_admin or org_admin).

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const SERVER = {
  id: '11111111-2222-4333-8444-555555555555', name: 'Research', url: 'https://mcp.example.com/mcp',
  auth_mode: 'oauth', auth_status: 'expired', server_info: { version: '0.4.1' }, created_at: '2026-10-30T00:00:00Z'
};

function fakeElement() {
  const attrs = { hidden: '' };
  return {
    innerHTML: '',
    classList: { add: () => {}, remove: () => {} },
    setAttribute: (name, value) => { attrs[name] = value; },
    removeAttribute: (name) => { delete attrs[name]; },
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
    addEventListener: () => {}
  };
}

function loadPage({ visible = false, wizardFlag = false, servers = [SERVER], installed = [], catalog = [] } = {}) {
  const win = { localStorage: { getItem: () => null, setItem: () => {} }, Intl, Date, setTimeout, clearTimeout };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/mcp-connect.model.js'))(win);
  win.ConnectorRegistry = { isConnectorInstalled: () => false, getCatalog: jest.fn(() => Promise.resolve({ connectors: catalog })) };
  win.LanaConfig = { CONNECT_WIZARD_ENABLED: wizardFlag, MCP_CONNECTORS_ENABLED: visible };
  win.Lex.Toast = { error: () => {}, warning: () => {} };
  win.Lex.ConnectWizard = { open: jest.fn() };
  win.Lex.McpConnect = { isVisible: () => visible, openPanel: jest.fn() };
  win.addEventListener = () => {};
  const tableRows = { rows: null };
  win.LanaConnectorTable = {
    sectionMarkup: () => '',
    mount: (config) => {
      tableRows.rows = config.rows;
      return Promise.resolve({ setRows: (rows) => { tableRows.rows = rows; } });
    }
  };
  const elements = {
    connectorsLoading: fakeElement(),
    connectorsContent: fakeElement(),
    availableConnectorsSection: fakeElement(),
    connectorTableMount: fakeElement(),
    addMcpServerBannerBtn: fakeElement()
  };
  const doc = { getElementById: (id) => elements[id] || null, querySelectorAll: () => [], addEventListener: () => {} };
  const connectors = {
    getAll: jest.fn(() => Promise.resolve({ connectors: installed })),
    mcpListServers: jest.fn(() => (servers instanceof Error ? Promise.reject(servers) : Promise.resolve(servers)))
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'ConnectorRegistry', 'Connectors', 'api', 'Lex', read('js/data_connectors.js'))(
    win, doc, win.ConnectorRegistry, connectors, {}, win.Lex
  );
  return { win, page: win.DataConnectorsTable, connectors, elements, tableRows };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('MCP rows on Data Connectors', () => {
  test('an MCP row always opens the MCP panel, never the viewer or the wizard', () => {
    for (const wizardFlag of [false, true]) {
      const { page } = loadPage({ visible: true, wizardFlag });
      expect(page.connectorOpenRoute({ id: SERVER.id, connector_id: 'mcp-server', status: 'not_connected' }, [])).toBe('mcp_panel');
      expect(page.connectorOpenRoute({ id: 'stripe', connector_id: 'stripe' }, [])).toBe(wizardFlag ? 'wizard' : 'viewer');
    }
  });

  test('a server row maps cleanly into the table: status, auth, category, no update button', () => {
    const { win, page } = loadPage({ visible: true });
    const raw = win.McpConnectModel.serverToConnectorRow(SERVER);
    const row = page.mapConnectorRow(raw, [], []);
    expect(row).toMatchObject({ id: SERVER.id, name: 'Research', status: 'disconnected', auth_type: 'oauth2', category: 'mcp', scope: 'org', update_slug: '', version: '0.4.1' });
    const cell = page.connectorActionsCell(row);
    expect(cell).toContain('openMcpServerPanel(');
    expect(cell).toContain('>Manage<');
    expect(cell).not.toContain('openConnectorManage');
    expect(cell).not.toContain('openConnectorUpdateModal');
    expect(cell).not.toContain('installConnector');
    expect(page.getConnectorStatusKey(win.McpConnectModel.serverToConnectorRow(Object.assign({}, SERVER, { auth_status: 'pending_authorization' })), [])).toBe('not_connected');
    expect(page.getConnectorStatusKey(win.McpConnectModel.serverToConnectorRow(Object.assign({}, SERVER, { auth_status: 'connected' })), [])).toBe('connected');
  });

  test('generic rows for the mcp-server package are left out', () => {
    const { page } = loadPage();
    expect(page.withoutMcpRows([{ connector_id: 'mcp-server' }, { connector_id: 'gmail' }, { connector_type: 'mcp-server' }]))
      .toEqual([{ connector_id: 'gmail' }]);
  });

  test('visible: the servers are listed as rows and the action is shown', async () => {
    const { connectors, elements, tableRows } = loadPage({
      visible: true,
      installed: [{ id: '22222222-2222-4333-8444-555555555555', connector_id: 'mcp-server', name: 'Stray row' }],
      catalog: [{ id: 'mcp-server', connector_id: 'mcp-server', name: 'MCP Server' }, { id: 'gmail', connector_id: 'gmail', name: 'Gmail' }]
    });
    await flush(); await flush();
    expect(connectors.mcpListServers).toHaveBeenCalled();
    expect(elements.addMcpServerBannerBtn.hasAttribute('hidden')).toBe(false);
    const names = tableRows.rows.map((r) => r.name);
    expect(names).toContain('Research');
    expect(names).toContain('Gmail');
    expect(names).not.toContain('Stray row');
    expect(names).not.toContain('MCP Server');
    expect(names.filter((n) => n === 'Research')).toHaveLength(1);
  });

  test('not visible: no MCP call, no MCP rows, the action stays hidden', async () => {
    const { connectors, elements, tableRows, page } = loadPage({
      visible: false,
      catalog: [{ id: 'mcp-server', connector_id: 'mcp-server', name: 'MCP Server' }, { id: 'gmail', connector_id: 'gmail', name: 'Gmail' }]
    });
    await flush(); await flush();
    expect(connectors.mcpListServers).not.toHaveBeenCalled();
    expect(elements.addMcpServerBannerBtn.hasAttribute('hidden')).toBe(true);
    expect(tableRows.rows.map((r) => r.name)).toEqual(['Gmail']);
    expect(page.isMcpVisible()).toBe(false);
  });

  test('opening an MCP row calls the panel with its source id', async () => {
    const { win } = loadPage({ visible: true });
    await flush(); await flush();
    win.handleConnectorRowSelection(SERVER.id);
    expect(win.Lex.McpConnect.openPanel).toHaveBeenCalledWith(expect.objectContaining({ sourceId: SERVER.id, serverName: 'Research' }));
    win.Lex.McpConnect.openPanel.mockClear();
    win.openConnectorManage(SERVER.id);
    expect(win.Lex.McpConnect.openPanel).toHaveBeenCalledTimes(1);
    expect(win.Lex.ConnectWizard.open).not.toHaveBeenCalled();
  });

  test('a failed server list keeps the rest of the page', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { tableRows } = loadPage({ visible: true, servers: new Error('Not found'), catalog: [{ id: 'gmail', connector_id: 'gmail', name: 'Gmail' }] });
    await flush(); await flush();
    expect(tableRows.rows.map((r) => r.name)).toEqual(['Gmail']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
