/**
 * One header title switcher. The shell title becomes a searchable Lex select on the matter page,
 * the admin pages, a report and a dashboard, and they all use the same component
 * (js/shared/title-switcher.js) and the same styles (css/title-switcher.css), so they look alike.
 * The switcher belongs to the page that drew it: when the app moves to another page, the plain
 * title comes back.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(SRC, rel));

const SHARED_JS = 'js/shared/title-switcher.js';
const SHARED_CSS = 'css/title-switcher.css';
const USERS = ['js/admin/admin-switcher.js', 'js/workspace-switcher.js', 'js/admin/report.js', 'js/admin/dashboard-detail.js'];

describe('one title switcher', () => {
  test.each(USERS)('%s draws its switcher through TitleSwitcher, with no wrapper of its own', (file) => {
    const src = read(file);
    expect(src).toMatch(/TitleSwitcher\.render\(/);
    expect(src).not.toMatch(/heading\.replaceWith|admin-flow-switcher|className = 'workspace-switcher'/);
  });

  test('the old per-page switcher styles are gone; the shared sheet styles .title-switcher', () => {
    expect(exists('css/admin/admin-switcher.css')).toBe(false);
    expect(exists('css/workspace-switcher.css')).toBe(false);
    expect(read(SHARED_CSS)).toMatch(/\.title-switcher \.lex-select-trigger \{/);
    expect(read('css/detail-page.css')).not.toMatch(/title-switcher/);
  });

  test('on a narrow window the switcher shrinks instead of crowding the header buttons', () => {
    const css = read(SHARED_CSS);
    expect(css).toMatch(/\.title-switcher \{[^}]*min-width: 0;[^}]*max-width: min\(28rem, calc\(100vw - 640px\)\)/);
    expect(css).toMatch(/@media \(max-width: 1100px\)/);
  });

  // Every page that draws a switcher loads the component (before the page's script) and the sheet,
  // as a standalone page and in its shell route.
  const htmlFiles = (dir) => fs.readdirSync(path.join(SRC, dir)).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f));
  const pages = [...htmlFiles('.'), ...htmlFiles('admin')]
    .filter((rel) => USERS.some((user) => read(rel).includes(path.basename(user) + '"')));

  test('the pages are found', () => {
    expect(pages).toEqual(expect.arrayContaining(['admin/users.html', 'workspace-details.html', 'admin/report.html', 'admin/dashboard-detail.html']));
    expect(pages.length).toBeGreaterThan(15);
  });

  test.each(pages)('%s loads the shared switcher and its styles', (rel) => {
    const html = read(rel);
    const prefix = rel.includes('/') ? '../' : '';
    expect(html).toContain(`<link rel="stylesheet" href="${prefix}${SHARED_CSS}">`);
    const shared = html.indexOf(`<script src="${prefix}${SHARED_JS}"></script>`);
    expect(shared).toBeGreaterThan(-1);
    const user = USERS.map((u) => html.indexOf(path.basename(u) + '"')).filter((i) => i > -1);
    user.forEach((i) => expect(shared).toBeLessThan(i));
    expect(html).not.toMatch(/admin-switcher\.css|workspace-switcher\.css/);
  });

  test.each(['workspace-details.html', 'admin/report.html', 'admin/dashboard-detail.html'])('shell route %s loads both', (page) => {
    const routes = read('js/lex/lex-router.pages.js');
    const start = routes.indexOf("'" + page + "': {");
    expect(start).toBeGreaterThan(-1);
    const entry = routes.slice(start, routes.indexOf('\n    },', start));
    expect(entry).toContain(`'${SHARED_JS}'`);
    expect(entry).toContain(`'${SHARED_CSS}'`);
    expect(entry.indexOf(`'${SHARED_JS}'`)).toBeLessThan(entry.search(/'js\/(workspace-details|admin\/report|admin\/dashboard-detail)\.js'/));
    expect(entry).not.toMatch(/workspace-switcher\.css/);
  });
});

describe('the switcher belongs to the page that drew it', () => {
  function load(pathName) {
    const { JSDOM, VirtualConsole } = require('jsdom');
    const dom = new JSDOM('<!doctype html><body><lex-topbar><h1 class="lex-topbar-heading">Report</h1></lex-topbar></body>',
      { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    const w = dom.window;
    w.history.replaceState({ path: pathName }, '');
    w.eval(read(SHARED_JS));
    w.document.querySelector('lex-topbar').heading = 'Report';
    return w;
  }
  const opts = { id: 'reportSwitcher', placeholder: 'Search reports...', value: 'a', options: [{ value: 'a', label: 'A' }], onPick() {} };
  const ready = (w, p) => w.document.dispatchEvent(new w.CustomEvent('lex-page-ready', { detail: { path: p } }));

  test('moving to another page puts the plain title back, with the new page title', () => {
    const w = load('/admin/report.html');
    w.TitleSwitcher.render(opts);
    expect(w.document.querySelector('lex-topbar .title-switcher lex-select#reportSwitcher')).not.toBeNull();
    w.document.querySelector('lex-topbar').heading = 'Reports';
    ready(w, '/admin/reports-list.html');
    expect(w.document.querySelector('lex-topbar .title-switcher')).toBeNull();
    expect(w.document.querySelector('lex-topbar .lex-topbar-heading').textContent).toBe('Reports');
  });

  test('the same page again (another report) keeps it', () => {
    const w = load('/admin/report.html?report=a');
    w.TitleSwitcher.render(opts);
    ready(w, '/admin/report.html?report=b');
    expect(w.document.querySelector('lex-topbar .title-switcher')).not.toBeNull();
  });

  test('restore() puts the title back on demand, and is harmless without a switcher', () => {
    const w = load('/workspace-details.html');
    w.TitleSwitcher.restore();
    expect(w.document.querySelectorAll('lex-topbar .lex-topbar-heading')).toHaveLength(1);
    w.TitleSwitcher.render(opts);
    w.TitleSwitcher.restore();
    expect(w.document.querySelector('lex-topbar .title-switcher')).toBeNull();
    expect(w.document.querySelector('lex-topbar .lex-topbar-heading').textContent).toBe('Report');
  });
});
