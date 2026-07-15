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
  test('the click gate accepts every route emitted by the normalized item list', () => {
    const { Sidebar } = loadSidebar();
    const subject = {
      _getAppItems: () => [
        { id: 'lana-works', href: 'dashboard.html' },
        { id: 'legal-nsights', href: 'embed.html?app=legal-nsights' }
      ]
    };
    expect(Sidebar.prototype._isRenderableAppHref.call(subject, 'dashboard.html')).toBe(true);
    expect(Sidebar.prototype._isRenderableAppHref.call(subject, 'embed.html?app=legal-nsights')).toBe(true);
    expect(Sidebar.prototype._isRenderableAppHref.call(subject, 'https://evil.example')).toBe(false);
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
