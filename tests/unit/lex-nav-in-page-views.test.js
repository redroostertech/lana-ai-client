/**
 * A view opened inside a page (one report on the Reports list) is its own
 * history entry. The shell Back and the platform back gesture close the view
 * first and leave the page only after that; the router does not reload the
 * page for those steps.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function setup() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="lex-main-content"></div></body></html>', {
    url: 'http://localhost/app.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetched = [];
  w.fetch = async (url) => { w.fetched.push(String(url)); return { ok: true, text: async () => '<div id="lex-page-content"><p>page</p></div>' }; };
  w.api = { isAuthenticated: () => true, isTokenExpired: () => false, user: { roles: ['org_admin'] } };
  w.eval(read('js/lex/lex-nav.js'));
  w.eval(read('js/lex/lex-router.js'));
  w.LexRouter.setPageDescriptors({
    'admin/analytics.html': { title: 'Dashboard', scripts: [], stylesheets: [] },
    'admin/reporting.html': { title: 'Reports', scripts: [], stylesheets: [] }
  });
  return w;
}

function back(w) {
  return new Promise((resolve) => {
    w.addEventListener('popstate', function done() {
      w.removeEventListener('popstate', done);
      setTimeout(resolve, 20);
    });
    w.history.back();
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('in-page views and Back', () => {
  test('Back closes the open view first, then leaves the page', async () => {
    const w = setup();
    w.LexRouter.start('/admin/analytics.html');
    await settle();
    await w.Lex.Nav.go('admin/reporting.html');
    const views = [];
    w.Lex.Nav.onViewChange('admin/reporting.html', (view) => views.push(view));

    w.Lex.Nav.pushView('module:matter-aging-analysis');
    expect(w.Lex.Nav.getView()).toBe('module:matter-aging-analysis');
    const fetchesBefore = w.fetched.length;

    await back(w);
    expect(views).toEqual([null]);
    expect(w.history.state.path).toBe('/admin/reporting.html');
    expect(w.fetched.length).toBe(fetchesBefore);

    await back(w);
    await settle();
    expect(w.history.state.path).toBe('/admin/analytics.html');
    expect(w.fetched.length).toBe(fetchesBefore + 1);
  });

  test('a page opened on a view link goes back to its list, not the previous page', async () => {
    const w = setup();
    w.LexRouter.start('/admin/analytics.html');
    await settle();
    await w.Lex.Nav.go('admin/reporting.html?report=matter-aging-analysis');
    const views = [];
    w.Lex.Nav.onViewChange('admin/reporting.html', (view) => views.push(view));
    expect(w.Lex.Nav.getView()).toBeUndefined();

    w.Lex.Nav.pushView('module:matter-aging-analysis');
    const fetchesBefore = w.fetched.length;
    await back(w);
    expect(views).toEqual([null]);
    expect(w.Lex.Nav.getView()).toBeNull();
    expect(w.fetched.length).toBe(fetchesBefore);
  });

  test('coming back to a page keeps the view its entry recorded', async () => {
    const w = setup();
    w.LexRouter.start('/admin/reporting.html');
    await settle();
    w.Lex.Nav.pushView('module:matter-aging-analysis');
    await w.Lex.Nav.go('admin/analytics.html');
    await back(w);
    await settle();
    expect(w.history.state.path).toBe('/admin/reporting.html');
    expect(w.Lex.Nav.getView()).toBe('module:matter-aging-analysis');
  });

  test('a view listener hears only its own page, and stops when unsubscribed', async () => {
    const w = setup();
    w.LexRouter.start('/admin/reporting.html?report=document-count');
    await settle();
    const views = [];
    const stop = w.Lex.Nav.onViewChange('admin/reporting.html', (view) => views.push(view));
    expect(typeof stop).toBe('function');

    w.Lex.Nav.pushView('module:document-count');
    // An entry for another page that records a view is not this page's.
    w.history.pushState({ path: '/admin/analytics.html', view: 'tile:1' }, '');
    w.history.pushState({ path: '/admin/analytics.html', view: 'tile:2' }, '');
    await back(w);
    expect(views).toEqual([]);

    await back(w);
    expect(views).toEqual(['module:document-count']);
    await back(w);
    expect(views).toEqual(['module:document-count', null]);

    stop();
    w.Lex.Nav.pushView('module:document-count');
    await back(w);
    expect(views).toEqual(['module:document-count', null]);
  });

  test('closeView steps back off an open view, else calls the fallback', async () => {
    const w = setup();
    w.LexRouter.start('/admin/reporting.html');
    await settle();
    let fallbacks = 0;
    w.Lex.Nav.closeView(() => { fallbacks += 1; });
    expect(fallbacks).toBe(1);

    w.Lex.Nav.pushView('saved:r1');
    const views = [];
    w.Lex.Nav.onViewChange('admin/reporting.html', (view) => views.push(view));
    await new Promise((resolve) => {
      w.addEventListener('popstate', () => setTimeout(resolve, 20), { once: true });
      w.Lex.Nav.closeView(() => { fallbacks += 1; });
    });
    expect(fallbacks).toBe(1);
    expect(views).toEqual([null]);
    expect(w.Lex.Nav.getView()).toBeNull();
  });
});

describe('the Reports page uses in-page views', () => {
  const js = read('js/admin/reporting.js');

  test('opening a report pushes a view and the page follows view changes', () => {
    expect(js).toContain('Lex.Nav.pushView(');
    expect(js).toContain('Lex.Nav.onViewChange(');
    expect(js).toContain('Lex.Nav.getView()');
  });

  test('All reports and deleting the open saved report close the view through history; the page never rewrites the shell URL', () => {
    const fnBody = (name) => js.slice(js.indexOf(name), js.indexOf('\n  }\n', js.indexOf(name)));
    expect(fnBody('function closeReportView')).toContain('Lex.Nav.closeView(showReportsList)');
    expect(fnBody('function initReportSelect')).toContain("backBtn.addEventListener('click', closeReportView)");
    expect(fnBody('async function performDeleteImportedReport')).toContain('closeReportView()');
    expect(fnBody('async function performDeleteImportedReport')).not.toMatch(/\bshowReportsList\(\)/);
    expect(js).not.toContain('window.history.replaceState');
  });

  test('the page listens for its own views only while it is shown', () => {
    expect(js).toContain("Lex.Nav.onViewChange('admin/reporting.html'");
    expect(js).toMatch(/LexRouter\.registerView\(\{[\s\S]*?onLeave[\s\S]*?stopReportViews/);
  });
});
