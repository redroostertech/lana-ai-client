/**
 * A routed page's script runs its own init() when it first loads, then the
 * router calls the registered init. Both must see the route being opened:
 * the router writes the history entry (state.path, which Lex.Nav.getParams
 * reads) before it runs the page's scripts, not after.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// The documented page pattern (LEX-COMPONENT-RULES.md): register, then init().
const PAGE_SCRIPT = `(function () {
  function init() { window.seen.push(Lex.Nav.getParams().get('report')); }
  LexRouter.registerPageInit('admin/report.html', init);
  init();
})();`;

function setup({ fetchOk = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="lex-main-content"></div></body></html>', {
    url: 'http://localhost/app.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  w.seen = [];
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = async (url) => (fetchOk || !String(url).includes('report.html')
    ? { ok: true, text: async () => '<div id="lex-page-content"><p>page</p></div>' }
    : { ok: false, status: 500, text: async () => '' });
  w.api = { isAuthenticated: () => true, isTokenExpired: () => false, user: { roles: ['org_admin'] } };
  // Run a page script when the router adds its tag, then report it loaded.
  const append = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = (node) => {
    if (node.tagName === 'SCRIPT' && node.src.endsWith('/js/test-page.js')) {
      w.eval(PAGE_SCRIPT);
      setTimeout(() => node.onload(), 0);
      return node;
    }
    return append(node);
  };
  w.eval(read('js/lex/lex-nav.js'));
  w.eval(read('js/lex/lex-router.js'));
  w.LexRouter.setPageDescriptors({
    'admin/analytics.html': { title: 'Dashboard', scripts: [], stylesheets: [] },
    'admin/report.html': { title: 'Report', scripts: ['js/test-page.js'], stylesheets: [] }
  });
  return w;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('a page script\'s own init and the registered init both see the route being opened', async () => {
  const w = setup();
  w.LexRouter.start('/admin/analytics.html');
  await settle();
  await w.Lex.Nav.go('admin/report.html?report=aging');
  await settle();
  expect(w.seen).toEqual(['aging', 'aging']);
  expect(w.history.state.path).toBe('/admin/report.html?report=aging');
});

test('a later visit runs the registered init once (the script is cached), with its own params', async () => {
  const w = setup();
  w.LexRouter.start('/admin/analytics.html');
  await settle();
  await w.Lex.Nav.go('admin/report.html?report=aging');
  await settle();
  await w.Lex.Nav.go('admin/analytics.html');
  await settle();
  await w.Lex.Nav.go('admin/report.html?report=growth');
  await settle();
  expect(w.seen).toEqual(['aging', 'aging', 'growth']);
});

test('a page that could not load leaves history on the page you were on', async () => {
  const w = setup({ fetchOk: false });
  w.LexRouter.start('/admin/analytics.html');
  await settle();
  const length = w.history.length;
  await w.Lex.Nav.go('admin/report.html?report=aging');
  await settle();
  expect(w.history.length).toBe(length);
  expect(w.history.state.path).toBe('/admin/analytics.html');
  expect(w.seen).toEqual([]);
});
