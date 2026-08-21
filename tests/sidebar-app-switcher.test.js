/**
 * Narrow contracts for the app-switcher gates that sit after app-catalog
 * normalization. Load the browser component with a minimal Lex stub and call
 * its pure prototype helpers directly; no DOM rendering is needed here.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function loadSidebar() {
  let Sidebar;
  const window = {
    Lex: {
      LexElement: class {},
      Icons: {},
      defineLex: (_name, ctor) => { Sidebar = ctor; }
    },
    history: { state: null },
    location: { pathname: '/dashboard.html', search: '' }
  };
  const code = fs.readFileSync(
    path.join(SRC, 'js', 'lex', 'components', 'layout', 'lex-sidebar.js'),
    'utf8'
  );
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', 'requestAnimationFrame', code)(
    window,
    {},
    {},
    () => {}
  );
  return { Sidebar, window };
}

describe('LexSidebar app switcher gates', () => {
  test('fallback app list includes Document Library when app-catalog is absent', () => {
    const { Sidebar } = loadSidebar();
    const subject = {
      _getAppPrefix: () => '',
      _getDefaultAppItems: Sidebar.prototype._getDefaultAppItems,
      _getAppCatalog: Sidebar.prototype._getAppCatalog,
      _normalizeAppItem: Sidebar.prototype._normalizeAppItem
    };

    const items = Sidebar.prototype._getAppItems.call(subject);

    expect(items.map((item) => item.id)).toContain('document-library');
    expect(items.find((item) => item.id === 'document-library').href).toBe('document-library.html');
  });

  test('dynamic lists wait for API readiness before first request', async () => {
    const { Sidebar } = loadSidebar();
    const events = [];
    let resolveReady;
    const client = {
      _readyPromise: new Promise((resolve) => { resolveReady = resolve; })
    };
    const wait = Sidebar.prototype._waitForApiReady.call({}, client).then(() => {
      events.push('ready');
    });

    events.push('before');
    resolveReady();
    await wait;

    expect(events).toEqual(['before', 'ready']);
  });

  test('the click gate accepts every route emitted by the normalized item list', () => {
    const { Sidebar } = loadSidebar();
    const subject = {
      _getAppItems: () => [
        { id: 'lana-works', href: 'dashboard.html' },
        { id: 'document-library', href: 'document-library.html' },
        { id: 'legal-nsights', href: 'embed.html?app=legal-nsights' }
      ]
    };
    expect(Sidebar.prototype._isRenderableAppHref.call(subject, 'dashboard.html')).toBe(true);
    expect(Sidebar.prototype._isRenderableAppHref.call(subject, 'document-library.html')).toBe(true);
    expect(Sidebar.prototype._isRenderableAppHref.call(subject, 'embed.html?app=legal-nsights')).toBe(true);
    expect(Sidebar.prototype._isRenderableAppHref.call(subject, 'https://evil.example')).toBe(false);
  });

  test('the Document Library route selects Document Library as current', () => {
    const { Sidebar, window } = loadSidebar();
    window.location.pathname = '/document-library.html';
    const documentLibrary = { id: 'document-library', label: 'Document Library' };
    const subject = {
      _getAppItems: () => [
        { id: 'lana-works', label: 'LanaWorks' },
        documentLibrary
      ]
    };
    expect(Sidebar.prototype._getCurrentApp.call(subject)).toBe(documentLibrary);
  });

  test('the embed host route selects the embedded app as current', () => {
    const { Sidebar, window } = loadSidebar();
    window.location.pathname = '/embed.html';
    window.location.search = '?app=legal-nsights';
    const legalNsights = { id: 'legal-nsights', label: 'Legal NSights' };
    const subject = {
      _getAppItems: () => [
        { id: 'lana-works', label: 'LanaWorks' },
        legalNsights
      ]
    };
    expect(Sidebar.prototype._getCurrentApp.call(subject)).toBe(legalNsights);
  });
});
