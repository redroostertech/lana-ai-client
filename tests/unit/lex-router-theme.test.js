/**
 * SPA fragments share the shell's <html>: lex-router turns the shared theme on for a
 * fragment marked themed: true and leaves the others light.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function setup(dark) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="lex-main-content"></div></body></html>', {
    url: 'http://localhost/app.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: dark, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, text: async () => '<div id="lex-page-content"><p>page</p></div>' });
  w.api = { isAuthenticated: () => true, isTokenExpired: () => false };
  w.eval(read('js/lex/lex.theme.js'));
  w.eval(read('js/lex/lex-nav.js'));
  w.eval(read('js/lex/lex-router.js'));
  w.LexRouter.setPageDescriptors({
    'ready.html': { title: 'Ready', themed: true, scripts: [], stylesheets: [] },
    'light-only.html': { title: 'Light only', scripts: [], stylesheets: [] }
  });
  return w;
}

describe('lex-router and the theme', () => {
  test('a themed fragment puts the theme on <html>; an unthemed one takes it off', async () => {
    const w = setup(true);
    const root = w.document.documentElement;
    await w.LexRouter.navigate('ready.html');
    expect(root.getAttribute('data-lex-theme')).toBe('dark');
    expect(w.LexTheme.rootThemed()).toBe(true);
    await w.LexRouter.navigate('light-only.html');
    expect(root.hasAttribute('data-lex-theme')).toBe(false);
    expect(w.LexTheme.rootThemed()).toBe(false);
  });

  test('no fragment is marked themed yet (the batches add the flag page by page)', () => {
    expect(read('js/lex/lex-router.pages.js').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/themed:\s*true/);
  });
});
