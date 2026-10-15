/**
 * embed-host resolution contract (docs/EMBEDDED-APPS-SPEC.md).
 *
 * The generic embed host may only ever frame a URL that came from the
 * persisted discovery payload — the query string names an app id, nothing
 * else. These tests pin that: no query-smuggled URLs, fail-closed on every
 * malformed input, and internal (string-route) apps are not frameable.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// Both modules are browser IIFEs that attach to `window`. Load them into one
// shared stub global, catalog first (embed-host reads window.LanaClientApps).
function loadHost() {
  const sandbox = { window: {} };
  for (const rel of ['js/app-catalog.js', 'js/embed-host.js']) {
    const code = fs.readFileSync(path.join(SRC, rel), 'utf8');
    // eslint-disable-next-line no-new-func
    new Function('window', code)(sandbox.window);
  }
  return sandbox.window;
}

const win = loadHost();
const resolveEmbedApp = win.LanaEmbedHost.resolveEmbedApp;
const primeShell = win.LanaEmbedHost.primeShell;
const configureShell = win.LanaEmbedHost.configureShell;
const dashboardForApp = win.LanaEmbedHost.dashboardForApp;
const validateSession = win.LanaEmbedHost.validateSession;
const requestSession = win.LanaEmbedHost.requestSession;
const refreshDelay = win.LanaEmbedHost.refreshDelay;

const legalNsights = {
  id: 'legal-nsights',
  label: 'Legal NSights',
  description: 'Dashboards, reporting, and firm analytics',
  route: { type: 'embedded', url: 'https://legal.nsites.tech', meta: {} },
  colors: ['#9debd0', '#10b981', '#0f766e', '#111827']
};

function savedServer(enabledApps) {
  return JSON.stringify({ id: 'redrooster', enabledApps });
}

describe('LanaEmbedHost.resolveEmbedApp', () => {
  test('embed.html loads Lex core before shell components and host boot', () => {
    const html = fs.readFileSync(path.join(SRC, 'embed.html'), 'utf8');
    const hostJs = fs.readFileSync(path.join(SRC, 'js', 'embed-host.js'), 'utf8');
    const core = html.indexOf('js/lex/lex.core.js');
    const navigation = html.indexOf('js/navigation-helpers.js');
    const conversationSearch = html.indexOf('js/conversation-search-modal.js');
    const sidebar = html.indexOf('js/lex/components/layout/lex-sidebar.js');
    const app = html.indexOf('js/lex/components/layout/lex-app.js');
    const host = html.indexOf('js/embed-host.js');
    const prime = html.indexOf('LanaEmbedHost.primeShell');
    expect(core).toBeGreaterThan(-1);
    expect(navigation).toBeGreaterThan(-1);
    expect(conversationSearch).toBeGreaterThan(navigation);
    expect(conversationSearch).toBeLessThan(core);
    expect(sidebar).toBeGreaterThan(core);
    expect(app).toBeGreaterThan(sidebar);
    expect(host).toBeGreaterThan(-1);
    expect(host).toBeLessThan(prime);
    expect(prime).toBeLessThan(core);
    expect(hostJs).toContain("frame.setAttribute('allow', 'clipboard-write; microphone')");
  });

  test('resolves a valid embedded app by id from the persisted payload', () => {
    const app = resolveEmbedApp('?app=legal-nsights', savedServer([legalNsights]));
    expect(app).not.toBeNull();
    expect(app.id).toBe('legal-nsights');
    expect(app.embed.url).toBe('https://legal.nsites.tech');
  });

  test('applies the embedded app title and starts with the sidebar collapsed', () => {
    const sidebar = { collapsed: false };
    const shell = {
      setPage: jest.fn(),
      querySelector: jest.fn((selector) => selector === 'lex-sidebar' ? sidebar : null)
    };
    const doc = { title: 'Embedded App - LANA AI' };

    configureShell(shell, { label: 'Legal NSights' }, doc);

    expect(shell.setPage).toHaveBeenCalledWith({ title: 'Legal NSights' });
    expect(doc.title).toBe('Legal NSights - LANA AI');
    expect(sidebar.collapsed).toBe(true);
  });

  test('primes title and collapsed state before the shell custom element upgrades', () => {
    const attrs = {};
    const shell = { setAttribute: (name, value) => { attrs[name] = value; } };
    const app = { label: 'Legal NSights' };

    expect(primeShell(shell, app)).toBe(app);
    expect(attrs).toEqual({
      'page-title': 'Legal NSights',
      'sidebar-collapsed': ''
    });
  });

  test('resolves the normalized representation that login actually persists', () => {
    const persisted = win.LanaClientApps.normalizeApp(legalNsights);
    const app = resolveEmbedApp('?app=legal-nsights', savedServer([persisted]));
    expect(app).toEqual(persisted);
  });

  test('the query string cannot smuggle a URL — only the payload URL is framed', () => {
    const app = resolveEmbedApp(
      '?app=legal-nsights&url=https%3A%2F%2Fevil.example',
      savedServer([legalNsights])
    );
    expect(app.embed.url).toBe('https://legal.nsites.tech');
  });

  test('internal string-route apps are not frameable through the host', () => {
    // 'lana-works' resolves in the sidebar, but it has no .embed — the host
    // must refuse rather than frame an internal page id.
    expect(resolveEmbedApp('?app=lana-works', savedServer([
      { id: 'lana-works', label: 'LanaWorks' },
      legalNsights
    ]))).toBeNull();
  });

  test('fails closed on every malformed input', () => {
    expect(resolveEmbedApp('', savedServer([legalNsights]))).toBeNull();          // no app param
    expect(resolveEmbedApp('?app=', savedServer([legalNsights]))).toBeNull();     // empty id
    expect(resolveEmbedApp('?app=legal-nsights', null)).toBeNull();               // nothing persisted
    expect(resolveEmbedApp('?app=legal-nsights', '{not json')).toBeNull();        // corrupt payload
    expect(resolveEmbedApp('?app=legal-nsights', savedServer([]))).toBeNull();    // empty enabledApps
    expect(resolveEmbedApp('?app=some-other-app', savedServer([legalNsights]))).toBeNull(); // id not in payload
  });

  test('an entry that fails catalog validation cannot be resurrected here', () => {
    const httpEntry = Object.assign({}, legalNsights, {
      route: { type: 'embedded', url: 'http://legal.nsites.tech' }
    });
    expect(resolveEmbedApp('?app=legal-nsights', savedServer([httpEntry]))).toBeNull();
  });

  test('an unresolvable payload does not fall back to default apps', () => {
    // normalizeAppList's defaults fallback must not apply inside the host:
    // this page renders what discovery declared, or nothing.
    const app = resolveEmbedApp('?app=lana-works', savedServer([
      { id: '@voice', label: 'Voice', route: '/voice' }
    ]));
    expect(app).toBeNull();
  });

  test('requests a backend-minted dashboard session and validates its partner origin', async () => {
    const app = resolveEmbedApp('?app=legal-nsights', savedServer([legalNsights]));
    const response = {
      session: {
        app_id: 'legal-nsights',
        partner_origin: 'https://legal.nsites.tech',
        embed_url: 'https://legal.nsites.tech/embed/executive?token=signed.jwt.value',
        expires_at: '2026-07-15T05:10:00.000Z',
        refresh_after: '2026-07-15T05:09:00.000Z'
      }
    };
    const api = { post: jest.fn().mockResolvedValue(response) };

    await expect(requestSession(app, api)).resolves.toMatchObject(response.session);
    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/partner-embeds/legal-nsights/session',
      { dashboard: 'executive' }
    );
  });

  test('uses discovery metadata for a supported dashboard request', () => {
    expect(dashboardForApp({ embed: { meta: { dashboard: 'finance' } } })).toBe('finance');
    expect(dashboardForApp({ embed: { meta: {} } })).toBe('executive');
  });

  test('rejects session URLs that escape discovery origin or lack a signed token', () => {
    const app = resolveEmbedApp('?app=legal-nsights', savedServer([legalNsights]));
    const base = {
      app_id: 'legal-nsights',
      partner_origin: 'https://legal.nsites.tech'
    };
    expect(validateSession(app, Object.assign({}, base, {
      embed_url: 'https://evil.example/embed/executive?token=signed.jwt.value'
    }))).toBeNull();
    expect(validateSession(app, Object.assign({}, base, {
      embed_url: 'https://legal.nsites.tech/login'
    }))).toBeNull();
    expect(validateSession(app, Object.assign({}, base, {
      app_id: 'other-app',
      embed_url: 'https://legal.nsites.tech/embed/executive?token=signed.jwt.value'
    }))).toBeNull();
  });

  test('refreshes at the server-provided time with a safety minimum', () => {
    const now = Date.parse('2026-07-15T05:00:00.000Z');
    expect(refreshDelay({ refresh_after: '2026-07-15T05:09:00.000Z' }, now))
      .toBe(9 * 60 * 1000);
    expect(refreshDelay({ refresh_after: '2026-07-15T04:59:00.000Z' }, now))
      .toBe(5000);
  });
});
