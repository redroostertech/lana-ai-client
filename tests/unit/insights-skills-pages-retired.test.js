'use strict';

/**
 * The old Insights Reports page (insights/module-execution.html), the Module
 * Execution Dashboard (insights/dashboard.html), AI Predictions
 * (insights/predictions.html, an empty state with no data source), Management Boards
 * (admin/management-boards.html) and the Skills pages (skills.html,
 * skills-marketplace.html, matter-skills.html) are retired. An old link, a
 * saved last page or a lana-ai:// link opens the page that replaced each:
 * Reports (admin/reporting.html, ?module= becomes ?report=), the Insights
 * Dashboard (admin/analytics.html, also for Predictions), All dashboards
 * (admin/dashboard-library.html) and the Automate app (automation/index.html;
 * skills became automations and /api/v1/skills is gone). The workspace pages'
 * Skill Builder and Import Skill modals and their scripts (matter-skills.js,
 * skill-builder.js) went with them; nothing in src/ calls the skills API.
 *
 * model-pricing.html is a fragment of the app shell: a standalone page opens it
 * through app.html, and it is no lana-ai:// destination of its own.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const RETIRED = {
  'insights/module-execution.html': 'admin/reporting.html',
  'insights/dashboard.html': 'admin/analytics.html',
  'insights/predictions.html': 'admin/analytics.html',
  'admin/management-boards.html': 'admin/dashboard-library.html',
  'skills.html': 'automation/index.html',
  'skills-marketplace.html': 'automation/index.html',
  'matter-skills.html': 'automation/index.html'
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(html|js|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the pages and their own files are gone', () => {
  test.each([
    'src/insights/module-execution.html',
    'src/insights/dashboard.html',
    'src/insights/js/insights-overlays.js',
    'src/insights/js/insights-tables.js',
    'src/insights/js/metric-goal-cell.js',
    'src/insights/predictions.html',
    'src/insights/js/predictions-tables.js',
    'src/js/insights.js',
    'src/admin/management-boards.html',
    'src/js/pages/management-boards-main.js',
    'src/js/pages/management-boards-team-performance.js',
    'src/js/services/management-board-service.js',
    'src/js/components/management-board-components.js',
    'src/skills.html',
    'src/js/skills.js',
    'src/css/skills.css',
    'src/js/shared/skills-table.js',
    'src/skills-marketplace.html',
    'src/js/skills-marketplace.js',
    'src/css/skills-marketplace.css',
    'src/matter-skills.html',
    'src/js/matter-skills.js',
    'src/js/skill-builder.js'
  ])('%s', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
  });

  test('no page, script or route table points at them, except the redirects', () => {
    const pattern = /(^|[^/\w-])(insights\/module-execution|insights\/dashboard|insights\/predictions|admin\/management-boards|skills|skills-marketplace|matter-skills)\.html/;
    const files = new Set();
    for (const file of [...walk(SRC), path.join(ROOT, 'electron-main.js')]) {
      if (pattern.test(fs.readFileSync(file, 'utf8'))) files.add(path.relative(ROOT, file));
    }
    expect([...files].sort()).toEqual(['electron-main.js', 'src/js/lex/lex-nav.js']);
  });

  test('nothing in src/ calls the retired skills API', () => {
    const offenders = walk(SRC)
      .filter((file) => !file.includes(path.join('src', 'docs') + path.sep))
      .filter((file) => /\/api\/v1\/skills|\/api\/v1\/matters\/[^'"`\s]*\/skills/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  test('the workspace pages no longer carry the skill modals or their scripts', () => {
    ['src/workspace-details.html', 'src/workspaces.html'].forEach((rel) => {
      const html = read(rel);
      expect(html).not.toMatch(/createSkillModal|importSkillModal|matter-skills\.js|workflow-builder\.js|drawflow/);
    });
    const routed = read('src/js/lex/lex-router.pages.js');
    const details = routed.slice(routed.indexOf("'workspace-details.html': {"), routed.indexOf("\n    },\n", routed.indexOf("'workspace-details.html': {")));
    expect(details).not.toMatch(/matter-skills|drawflow|workflow-builder/);
  });

  test('the router no longer registers them; the Insights sidebar keeps Reports and All dashboards', () => {
    const pages = read('src/js/lex/lex-router.pages.js');
    Object.keys(RETIRED).forEach((page) => expect(pages).not.toContain(`'${page}': {`));
    const app = read('src/js/lex/components/layout/lex-app.js');
    expect(app).toContain("{ id: 'insights-reports', label: 'Reports', icon: 'bar-chart-2', href: 'admin/reporting.html' }");
    expect(app).toContain("{ id: 'insights-dashboards', label: 'All dashboards', icon: 'book-open', href: 'admin/dashboard-library.html' }");
  });
});

// ── In the renderer: Lex.Nav.go, link clicks and the saved last page (LexRouter.navigate) ──

function loadRenderer({ page = 'app.html', router = true } = {}) {
  const href = 'file:///app/src/' + page;
  const stored = {};
  const win = {
    location: { href, pathname: '/app/src/' + page, protocol: 'file:', origin: 'null' },
    addEventListener() {}
  };
  const context = {
    window: win,
    history: { replaceState() {}, pushState() {} },
    document: { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } },
    sessionStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
      setItem(key, value) { stored[key] = String(value); },
      removeItem(key) { delete stored[key]; }
    },
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
  return { win, stored };
}

describe('the renderer opens the replacement page', () => {
  test.each([
    ['/insights/module-execution.html', 'admin/reporting.html'],
    ['/insights/module-execution.html?module=growth_intake&id=7&matter_id=M1', 'admin/reporting.html?report=growth_intake'],
    ['/insights/dashboard.html?matter_id=M1&module=x&tab=y', 'admin/analytics.html'],
    ['/admin/management-boards.html?id=B1&board=team', 'admin/dashboard-library.html'],
    ['/skills.html?id=M1&category=x', 'automation/index.html'],
    ['/skills-marketplace.html?category=x', 'automation/index.html'],
    ['/matter-skills.html?matterSkillId=S1&tab=executions', 'automation/index.html']
  ])('LexRouter.navigate(%s), as the shell does for a saved last page', async (asked, landed) => {
    const { win } = loadRenderer();
    await win.LexRouter.navigate(asked);
    expect(win.location.href).toBe(landed);
  });

  test('Lex.Nav.go keeps the report key and drops the rest', async () => {
    const { win } = loadRenderer();
    await win.Lex.Nav.go('insights/module-execution.html', { params: { module: 'aging', matter_id: 'M1' } });
    expect(win.location.href).toBe('admin/reporting.html?report=aging');
  });

  test('Lex.Nav.go on a standalone page (no router)', () => {
    const { win } = loadRenderer({ page: 'admin/index.html', router: false });
    win.Lex.Nav.go('/admin/management-boards.html?id=B1');
    expect(win.location.href).toBe('../admin/dashboard-library.html');
  });

  test('report keys are passed as data, not markup', () => {
    const { win } = loadRenderer();
    expect(win.Lex.Nav.redirectPath('/insights/module-execution.html?module=' + encodeURIComponent('a&b=<x>')))
      .toBe('/admin/reporting.html?report=a%26b%3D%3Cx%3E');
  });

  test('the earlier retired pages and other pages are unchanged', async () => {
    const { win } = loadRenderer();
    expect(win.Lex.Nav.redirectPath('/admin/dashboard.html?id=42')).toBe('/admin/index.html');
    expect(win.Lex.Nav.redirectPath('/matters.html?matter_id=M1')).toBe('/workspace-details.html?id=M1');
    expect(win.Lex.Nav.redirectPath('/insights/predictions.html?type=revenue&matter_id=M1')).toBe('/admin/analytics.html');
    expect(win.Lex.Nav.redirectPath('/admin/analytics.html')).toBeNull();
    expect(win.Lex.Nav.redirectPath('/admin/reporting.html?report=x')).toBeNull();
  });

  test('the retired pages are gone from the deep-link registry', () => {
    const { win } = loadRenderer();
    const registry = win.Lex.Nav.getDeepLinkRegistry();
    Object.keys(RETIRED).forEach((page) => expect(registry[page]).toBeUndefined());
    expect(registry['model-pricing.html']).toBeUndefined();
  });
});

describe('model-pricing.html opens inside the app shell', () => {
  test('a standalone page sends it through app.html as the saved last page', () => {
    const { win, stored } = loadRenderer({ page: 'admin/index.html', router: false });
    win.Lex.Nav.go('model-pricing.html');
    expect(win.location.href).toBe('../app.html');
    expect(stored._lex_last_path).toBe('/model-pricing.html');
  });

  test('inside the shell the router loads its descriptor', () => {
    const pages = read('src/js/lex/lex-router.pages.js');
    expect(pages).toContain("'model-pricing.html': {");
  });

  test('every routed page that is only a fragment opens through the shell', () => {
    const pages = read('src/js/lex/lex-router.pages.js');
    const keys = [...pages.matchAll(/^ {4}'([\w/.-]+\.html)': \{/gm)].map((m) => m[1]);
    const fragments = keys.filter((key) => {
      const file = path.join(SRC, key);
      return fs.existsSync(file) && !/<!doctype html|<html[\s>]/i.test(fs.readFileSync(file, 'utf8').slice(0, 2000));
    });
    expect(fragments.sort()).toEqual(['model-pricing.html', 'open-source-licenses.html']);
    const nav = read('src/js/lex/lex-nav.js');
    fragments.forEach((key) => expect(nav).toContain(`'${key}': true`));
  });
});

// ── Outside the app: lana-ai:// links ──

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
    mainBlock(main, 'function retiredPageParams(route, params) {', '\n}'),
    mainBlock(main, 'function retiredMatterRoute(route, params) {', '\n}'),
    mainBlock(main, 'function sanitizeClientRoute(route) {', '\n}'),
    '({ sanitizeClientRoute, retiredMatterRoute, retiredPageParams, DEEP_LINK_CLIENT_ROUTES });'
  ].join('\n');
  return vm.runInNewContext(code, { URLSearchParams });
}

function open(route, query) {
  const { sanitizeClientRoute, retiredMatterRoute, retiredPageParams, DEEP_LINK_CLIENT_ROUTES } = loadDeepLinkRouting();
  const params = retiredPageParams(route, new URLSearchParams(query || ''));
  const landed = sanitizeClientRoute(retiredMatterRoute(route, params));
  const forwarded = {};
  DEEP_LINK_CLIENT_ROUTES[landed].forEach((key) => { if (params.get(key)) forwarded[key] = params.get(key); });
  return { landed, forwarded };
}

describe('electron-main deep links', () => {
  test.each(Object.entries(RETIRED))('%s opens %s', (route, replacement) => {
    expect(open(route).landed).toBe(replacement);
    expect(open('/' + route).landed).toBe(replacement);
  });

  test('the old Reports page keeps the report and drops its other params', () => {
    expect(open('insights/module-execution.html', 'module=aging&id=7&matter_id=M1'))
      .toEqual({ landed: 'admin/reporting.html', forwarded: { report: 'aging' } });
  });

  test('a board id is not forwarded as a dashboard id', () => {
    expect(open('admin/management-boards.html', 'id=B1&board=team'))
      .toEqual({ landed: 'admin/dashboard-library.html', forwarded: {} });
  });

  test('matters.html and other routes keep their params', () => {
    expect(open('matters.html', 'matter_id=M1&tab=files'))
      .toEqual({ landed: 'workspace-details.html', forwarded: { id: 'M1', tab: 'files' } });
    expect(open('admin/reporting.html', 'report=aging&id=x'))
      .toEqual({ landed: 'admin/reporting.html', forwarded: { id: 'x', report: 'aging' } });
  });

  test('lana-ai://insights views open the replacements', () => {
    const main = read('electron-main.js');
    expect(main).toContain("if (view === 'dashboard') route = 'insights/dashboard.html';");
    expect(main).toContain("else if (view === 'module-execution') route = 'insights/module-execution.html';");
    expect(main).toContain("else if (view === 'predictions') route = 'insights/predictions.html';");
    expect(open('insights/predictions.html', 'type=revenue&tab=x')).toEqual({ landed: 'admin/analytics.html', forwarded: {} });
  });

  test('the retired pages and model-pricing.html are no destinations of their own', () => {
    const { DEEP_LINK_CLIENT_ROUTES, sanitizeClientRoute } = loadDeepLinkRouting();
    Object.keys(RETIRED).forEach((page) => expect(Object.keys(DEEP_LINK_CLIENT_ROUTES)).not.toContain(page));
    expect(() => sanitizeClientRoute('model-pricing.html')).toThrow('Unsupported LANA destination');
  });
});
