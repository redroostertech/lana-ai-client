'use strict';

/**
 * matters.html is retired. workspaces.html (js/workspace.js) is the one
 * matters list. Nothing links to the old page any more, and an old link, a
 * saved last page, a lana-ai:// link or a voice-agent destination opens
 * workspaces.html, or the matter's own page when the link names one matter.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(html|js|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the page and its own files are gone', () => {
  test.each(['src/matters.html', 'src/js/pages/matters-list-table.js'])('%s', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
  });

  test('no page, script or route table points at it, except the redirects', () => {
    const files = new Set();
    for (const file of [...walk(SRC), path.join(ROOT, 'electron-main.js')]) {
      if (/(^|[^/\w])matters\.html/.test(fs.readFileSync(file, 'utf8'))) files.add(path.relative(ROOT, file));
    }
    expect([...files].sort()).toEqual(['electron-main.js', 'src/js/lex/lex-nav.js']);
  });

  test('the Matters menu items and the dashboard open workspaces.html', () => {
    const menu = read('src/js/menu.js');
    expect(menu.match(/label: 'Matters', href: '\/workspaces\.html'/g)).toHaveLength(6);
    // The list page highlights the Matters item (lex-app active-nav-id="workspaces").
    expect(menu).toContain("{ id: 'workspaces', label: 'Matters', href: '/workspaces.html', icon: 'matters' }");
    expect(read('src/workspaces.html')).toContain('active-nav-id="workspaces"');
    // The Workspaces hero: Open workspaces, the loop's Open step and the walkthrough.
    const dash = read('src/js/dashboard/dashboard.js');
    const hero = dash.slice(dash.indexOf('function wireWorkspacesHero('), dash.indexOf('showFirstRun(\'workspaces\')'));
    expect(hero.match(/Lex\.Nav\.go\('workspaces\.html'\)/g)).toHaveLength(3);
  });
});

// ── In the renderer: Lex.Nav.go, link clicks and the saved last page (LexRouter.navigate) ──

function loadRenderer({ page = 'app.html', router = true } = {}) {
  const href = 'file:///app/src/' + page;
  const win = {
    location: { href, pathname: '/app/src/' + page, protocol: 'file:', origin: 'null' },
    addEventListener() {}
  };
  const context = {
    window: win,
    history: { replaceState() {}, pushState() {} },
    document: { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    console: { log() {}, warn() {}, error() {} },
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('src/js/lex/lex-nav.js'), context);
  if (router) vm.runInContext(read('src/js/lex/lex-router.js'), context);
  return win;
}

describe('the renderer opens the Workspaces page for the retired page', () => {
  test.each([
    ['/matters.html', 'workspaces.html'],
    ['matters.html?status=active&sort_by=name', 'workspaces.html?status=active&sort_by=name'],
    ['/matters.html?status=closed&sort_by=updated_at&sort_order=asc&q=x', 'workspaces.html?status=closed&sort_by=updated_at&sort_order=asc'],
    ['/matters.html?action=create', 'workspaces.html?action=create'],
    ['/matters.html?matter_id=M1', 'workspace-details.html?id=M1'],
    ['/matters.html?open=M2&tab=files', 'workspace-details.html?id=M2&tab=files']
  ])('LexRouter.navigate(%s), as the shell does for a saved last page', async (asked, landed) => {
    const win = loadRenderer();
    await win.LexRouter.navigate(asked);
    expect(win.location.href).toBe(landed);
  });

  test('Lex.Nav.go with a matter id opens that matter', async () => {
    const win = loadRenderer();
    await win.Lex.Nav.go('matters.html', { params: { matter_id: 'M1', tab: 'notes' } });
    expect(win.location.href).toBe('workspace-details.html?id=M1&tab=notes');
  });

  test('Lex.Nav.go without one opens the list and keeps action, status and sort', async () => {
    const win = loadRenderer();
    await win.Lex.Nav.go('matters.html', { params: { action: 'create', sort_by: 'name', sort_order: 'asc', status: 'active', tab: 'x' } });
    expect(win.location.href).toBe('workspaces.html?action=create&status=active&sort_by=name&sort_order=asc');
  });

  test('workspaces.html declares the carried params in the deep-link registry', () => {
    const win = loadRenderer();
    expect(win.Lex.Nav.getDeepLinkRegistry()['workspaces.html']).toEqual(expect.objectContaining({ status: 'string', sort_by: 'string', sort_order: 'string' }));
  });

  test('Lex.Nav.go on a standalone page (no router)', () => {
    const win = loadRenderer({ page: 'dashboard.html', router: false });
    win.Lex.Nav.go('/matters.html?matter_id=M3');
    expect(win.location.href).toBe('workspace-details.html?id=M3');
  });

  test('matter ids are passed as data, not markup', () => {
    const win = loadRenderer();
    expect(win.Lex.Nav.redirectPath('/matters.html?matter_id=' + encodeURIComponent('a&b=<x>')))
      .toBe('/workspace-details.html?id=a%26b%3D%3Cx%3E');
  });

  test('the earlier retired page and other pages are unchanged', async () => {
    const win = loadRenderer();
    expect(win.Lex.Nav.redirectPath('/admin/dashboard.html?id=42')).toBe('/admin/index.html');
    expect(win.Lex.Nav.redirectPath('/workspaces.html?action=create')).toBeNull();
    await win.LexRouter.navigate('/workspaces.html');
    expect(win.location.href).toBe('workspaces.html');
  });
});

// ── Outside the app: lana-ai:// links and the voice agent ──

function mainBlock(source, start, end) {
  const i = source.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  const j = source.indexOf(end, i);
  expect(j).toBeGreaterThan(i);
  return source.slice(i, j + end.length);
}

function loadDeepLinkRouting() {
  const main = read('electron-main.js');
  const code = [
    mainBlock(main, 'const DEEP_LINK_CLIENT_ROUTES = Object.freeze({', '\n});'),
    mainBlock(main, 'function stripLeadingSlashes(value) {', '\n}'),
    mainBlock(main, 'const RETIRED_CLIENT_ROUTES = Object.freeze({', '\n});'),
    mainBlock(main, 'function retiredRecordRoute(route, params) {', '\n}'),
    mainBlock(main, 'function sanitizeClientRoute(route) {', '\n}'),
    '({ sanitizeClientRoute, retiredRecordRoute, DEEP_LINK_CLIENT_ROUTES });'
  ].join('\n');
  return vm.runInNewContext(code, {});
}

describe('electron-main deep links', () => {
  test.each(['matters.html', '/matters.html'])('%s opens workspaces.html', (route) => {
    expect(loadDeepLinkRouting().sanitizeClientRoute(route)).toBe('workspaces.html');
  });

  test.each([
    ['matter_id=M1&tab=files', { id: 'M1', tab: 'files' }],
    ['open=M2', { id: 'M2' }]
  ])('matters.html?%s opens the matter page', (query, expected) => {
    const { sanitizeClientRoute, retiredRecordRoute, DEEP_LINK_CLIENT_ROUTES } = loadDeepLinkRouting();
    const params = new URLSearchParams(query);
    const route = sanitizeClientRoute(retiredRecordRoute('matters.html', params));
    expect(route).toBe('workspace-details.html');
    const forwarded = {};
    DEEP_LINK_CLIENT_ROUTES[route].forEach((key) => { if (params.get(key)) forwarded[key] = params.get(key); });
    expect(forwarded).toEqual(expected);
  });

  test('matters.html?status=&sort_by=&sort_order= keeps them on workspaces.html', () => {
    const { sanitizeClientRoute, retiredRecordRoute, DEEP_LINK_CLIENT_ROUTES } = loadDeepLinkRouting();
    const params = new URLSearchParams('status=archived&sort_by=name&sort_order=asc&matter=zz');
    const route = sanitizeClientRoute(retiredRecordRoute('matters.html', params));
    expect(route).toBe('workspaces.html');
    const forwarded = {};
    DEEP_LINK_CLIENT_ROUTES[route].forEach((key) => { if (params.get(key)) forwarded[key] = params.get(key); });
    expect(forwarded).toEqual({ status: 'archived', sort_by: 'name', sort_order: 'asc' });
  });

  test('matters.html is no longer an allowed destination of its own', () => {
    const { DEEP_LINK_CLIENT_ROUTES, retiredRecordRoute } = loadDeepLinkRouting();
    expect(Object.keys(DEEP_LINK_CLIENT_ROUTES)).not.toContain('matters.html');
    expect(DEEP_LINK_CLIENT_ROUTES['workspaces.html']).toEqual(['action', 'search', 'status', 'sort_by', 'sort_order']);
    expect(retiredRecordRoute('workspaces.html', new URLSearchParams('matter_id=M1'))).toBe('workspaces.html');
  });
});

describe('voice agent destinations', () => {
  function loadNavigator() {
    const main = read('electron-main.js');
    const loaded = [];
    const mainWindow = {
      isDestroyed: () => false,
      isMinimized: () => false,
      show() {},
      focus() {},
      loadURL: async (u) => { loaded.push(u); }
    };
    const context = {
      mainWindow,
      URL,
      path,
      __dirname: '/app',
      appPageUrl: require('../../electron-app-protocol').appPageUrl
    };
    const navigate = vm.runInNewContext(
      mainBlock(main, 'const SCREEN_VOICE_CLIENT_ROUTES = new Set([', '\n]);') + '\n'
      + mainBlock(main, 'async function navigateScreenVoiceClient(input = {}) {', '\n}') + '\nnavigateScreenVoiceClient;',
      context
    );
    return { navigate, loaded };
  }

  test('matters.html opens the list, or the matter page for a matter id', async () => {
    const { navigate, loaded } = loadNavigator();
    await navigate({ route: 'matters.html' });
    await navigate({ route: 'matters.html', matterId: 'M1' });
    expect(loaded).toEqual([
      'lana-app://app/public_html/workspaces.html',
      'lana-app://app/public_html/workspace-details.html?id=M1'
    ]);
  });

  test('unknown destinations are still refused', async () => {
    const { navigate } = loadNavigator();
    await expect(navigate({ route: 'admin/users.html' })).rejects.toThrow('Unsupported LANA destination');
  });
});

// ── On workspaces.html: a link's status and sort set the toolbar and the first load ──

describe('workspaces.html applies a link\'s status and sort', () => {
  const helpers = require('../../src/js/shared/list-query-params.js');
  const js = read('src/js/workspace.js');

  function extract(name) {
    const start = js.indexOf('function ' + name + '(');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = js.indexOf('{', start); i < js.length; i++) {
      if (js[i] === '{') depth += 1;
      else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
    }
    throw new Error('unbalanced ' + name);
  }

  // applyLinkState with the real helpers, a stand-in table and toolbar.
  function apply(query) {
    const controls = {
      statusFilter: { value: 'all' },
      mattersSort: { value: 'created_at' },
      mattersSortOrder: { dataset: { order: 'desc' } }
    };
    const table = { sortBy: 'created_at', sortDir: 'desc', limit: '20', restored: null, restoreQuery(q) { this.restored = q; } };
    const context = {
      window: { LanaListQueryParams: helpers },
      document: { getElementById: (id) => controls[id] || null },
      mattersTable: () => table,
      URLSearchParams
    };
    vm.createContext(context);
    vm.runInContext(extract('syncToolbarSort') + '\n' + extract('applyLinkState') + '\napplyLinkState(new URLSearchParams(' + JSON.stringify(query) + '));', context);
    return { table, controls };
  }

  test('runs before the first load', () => {
    const init = js.slice(js.indexOf('(async function init() {'));
    expect(init.indexOf('applyLinkState(new URLSearchParams(window.location.search));'))
      .toBeLessThan(init.indexOf('await loadMatters();'));
  });

  test('valid values set the Status dropdown, Sort by, the order and the table query', () => {
    const { table, controls } = apply('status=Closed&sort_by=name&sort_order=ASC');
    expect(table.restored).toEqual({
      sortBy: 'name', sortDir: 'asc', filters: { status: { operator: 'in', value: ['closed'] } }, limit: 20
    });
    expect(controls.statusFilter.value).toBe('closed');
    expect(controls.mattersSort.value).toBe('name');
    expect(controls.mattersSortOrder.dataset.order).toBe('asc');
  });

  test('"Shared with me" is accepted; a sort alone keeps the default status', () => {
    expect(apply('status=shared').table.restored.filters).toEqual({ status: { operator: 'in', value: ['shared'] } });
    const { table, controls } = apply('sort_by=updated_at');
    expect(table.restored).toEqual({ sortBy: 'updated_at', sortDir: 'desc', filters: {}, limit: 20 });
    expect(controls.statusFilter.value).toBe('all');
  });

  test('values the toolbar does not offer are ignored', () => {
    const none = apply('status=deleted&sort_by=client_name&sort_order=sideways');
    expect(none.table.restored).toBeNull();
    expect(none.controls.statusFilter.value).toBe('all');
    expect(none.controls.mattersSort.value).toBe('created_at');
    expect(none.controls.mattersSortOrder.dataset.order).toBe('desc');
    // A bad value next to a good one: only the good one is used.
    const mixed = apply('status=<b>x</b>&sort_by=matter_type&sort_order=1;drop');
    expect(mixed.table.restored).toEqual({ sortBy: 'matter_type', sortDir: 'desc', filters: {}, limit: 20 });
    expect(mixed.controls.statusFilter.value).toBe('all');
  });

  test('the accepted values are exactly what the toolbar offers', () => {
    const html = read('src/workspaces.html');
    const options = (id) => JSON.parse(html.match(new RegExp('id="' + id + '"\\s*options=\'([^\']+)\''))[1]).map((o) => o.value);
    options('statusFilter').forEach((v) => {
      expect(helpers.mattersLinkState({ status: v }).status).toBe(v);
    });
    options('mattersSort').forEach((v) => {
      expect(helpers.mattersLinkState({ sort_by: v }).sortBy).toBe(v);
    });
    expect(options('statusFilter').length).toBe(6);
    expect(Object.keys(helpers.MATTER_SORT_BY_COLUMN).sort()).toEqual(options('mattersSort').sort());
  });
});
