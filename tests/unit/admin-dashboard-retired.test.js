'use strict';

/**
 * admin/dashboard.html is retired. Its inline script never ran (isSystemAdmin
 * declared twice next to menu.js), so Create Organization, Create Matter and
 * the stats never worked. Nothing links to it any more, and an old link or a
 * saved last page opens Administration (admin/index.html) instead of a
 * missing page.
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
  test.each(['src/admin/dashboard.html', 'src/js/admin/admin-dashboard-tables.js'])('%s', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
  });

  test('no page, script or route table points at it, except the redirects', () => {
    const hits = [];
    for (const file of [...walk(SRC), path.join(ROOT, 'electron-main.js')]) {
      const rel = path.relative(ROOT, file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // admin/dashboard.html written out, or "dashboard.html" linked from a page inside admin/.
        const named = /admin\/dashboard\.html/.test(line);
        const relative = rel.startsWith('src/admin/') && /["'(]dashboard\.html/.test(line);
        if (named || relative) hits.push(`${rel}:${i + 1}`);
      });
    }
    // Only the two redirect tables (renderer and main process) still name it.
    expect([...new Set(hits.map((h) => h.split(':')[0]))].sort()).toEqual(['electron-main.js', 'src/js/lex/lex-nav.js']);
  });

  test('the Administration page it redirects to exists and is what the account menu opens', () => {
    expect(fs.existsSync(path.join(SRC, 'admin/index.html'))).toBe(true);
    expect(read('src/js/menu.js')).toContain("id: 'administration',\n            label: 'Administration',\n            href: '/admin/index.html'");
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

describe('the renderer opens Administration for the retired page', () => {
  test.each([
    '/admin/dashboard.html',
    'admin/dashboard.html',
    '/admin/dashboard.html?id=42'
  ])('LexRouter.navigate(%s), as the shell does for a saved last page', async (asked) => {
    const win = loadRenderer();
    await win.LexRouter.navigate(asked);
    expect(win.location.href).toBe('admin/index.html');
  });

  test('Lex.Nav.go inside the app shell', async () => {
    const win = loadRenderer();
    await win.Lex.Nav.go('admin/dashboard.html', { params: { id: '42' } });
    expect(win.location.href).toBe('admin/index.html?id=42');
  });

  test.each([
    ['dashboard.html', 'admin/dashboard.html', 'admin/index.html'],
    ['admin/users.html', '/admin/dashboard.html?id=42', '../admin/index.html']
  ])('Lex.Nav.go on the standalone page %s (no router)', (page, asked, landed) => {
    const win = loadRenderer({ page, router: false });
    win.Lex.Nav.go(asked);
    expect(win.location.href).toBe(landed);
  });

  test('other pages are left alone', async () => {
    const win = loadRenderer();
    await win.LexRouter.navigate('/admin/users.html');
    expect(win.location.href).toBe('admin/users.html');
    expect(win.Lex.Nav.replacementFor('admin/users.html')).toBeNull();
  });
});

// ── Outside the app: an old lana-ai:// link with route=admin/dashboard.html ──

function mainBlock(source, start, end) {
  const i = source.indexOf(start);
  expect(i).toBeGreaterThan(-1);
  const j = source.indexOf(end, i);
  expect(j).toBeGreaterThan(i);
  return source.slice(i, j + end.length);
}

function loadSanitizer() {
  const main = read('electron-main.js');
  const code = [
    mainBlock(main, 'const DEEP_LINK_CLIENT_ROUTES = Object.freeze({', '\n});'),
    mainBlock(main, 'function stripLeadingSlashes(value) {', '\n}'),
    mainBlock(main, 'const RETIRED_CLIENT_ROUTES = Object.freeze({', '\n});'),
    mainBlock(main, 'function sanitizeClientRoute(route) {', '\n}'),
    'sanitizeClientRoute;'
  ].join('\n');
  return vm.runInNewContext(code, {});
}

describe('electron-main deep links', () => {
  test.each(['admin/dashboard.html', '/admin/dashboard.html'])('%s opens admin/index.html', (route) => {
    expect(loadSanitizer()(route)).toBe('admin/index.html');
  });

  test('admin/dashboard.html is no longer an allowed destination of its own', () => {
    const main = read('electron-main.js');
    const routes = mainBlock(main, 'const DEEP_LINK_CLIENT_ROUTES = Object.freeze({', '\n});');
    expect(routes).not.toContain("'admin/dashboard.html'");
    expect(routes).toContain("'admin/index.html': ['tab']");
  });

  test('an unknown route is still refused', () => {
    expect(() => loadSanitizer()('admin/nope.html')).toThrow('Unsupported LANA destination');
  });
});
