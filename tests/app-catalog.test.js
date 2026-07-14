/**
 * app-catalog resolution contract.
 *
 * The app switcher renders whatever normalizeApp returns. If it returns an app
 * whose route is not a real file in this bundle, the user gets a BLANK PAGE.
 * These tests pin that contract, including the legacy @-prefixed payloads that
 * older control-plane releases persisted into electron-storage.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// app-catalog.js is a browser IIFE that assigns to `window`. Load it into a
// stub global rather than duplicating the catalog here.
function loadCatalog() {
  const code = fs.readFileSync(path.join(SRC, 'js', 'app-catalog.js'), 'utf8');
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', code)(sandbox.window);
  return sandbox.window.LanaClientApps;
}

const Apps = loadCatalog();

describe('LanaClientApps.normalizeApp', () => {
  test('every catalog id resolves to a route that EXISTS on disk', () => {
    const ids = Object.keys(Apps.catalog);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const app = Apps.normalizeApp(id);
      expect(app).not.toBeNull();
      const file = path.join(SRC, app.route);
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  test('every alias resolves to a catalog entry with a real file', () => {
    for (const alias of Object.keys(Apps.aliases)) {
      const app = Apps.normalizeApp(alias);
      expect(app).not.toBeNull();
      expect(fs.existsSync(path.join(SRC, app.route))).toBe(true);
    }
  });

  // The bug: '@insights' missed every alias, base fell back to {}, and the
  // control plane's own label+route satisfied the guard -> tile rendered ->
  // href '/insights' -> blank page.
  test('legacy @-prefixed ids resolve to the client surface, not a URL path', () => {
    const insights = Apps.normalizeApp({
      id: '@insights',
      label: 'Insights',
      description: 'Governed BI & reporting surface',
      route: '/insights',
      colors: ['#14b8a6', '#22c55e']
    });
    expect(insights).not.toBeNull();
    expect(insights.id).toBe('lana-insights');
    // The poison: the control plane's route must NOT win.
    expect(insights.route).toBe('admin/analytics.html');
    expect(fs.existsSync(path.join(SRC, insights.route))).toBe(true);

    const agents = Apps.normalizeApp({ id: '@agents', label: 'Agents', route: '/agents' });
    expect(agents.id).toBe('lana-agents');
    expect(agents.route).toBe('agents/index.html');
  });

  test('backend-only apps with no client page are rejected, not rendered', () => {
    for (const id of ['@voice', '@automation', '@heartbeat', '@meet', '@communications']) {
      expect(Apps.normalizeApp({ id, label: 'X', route: '/x' })).toBeNull();
    }
  });

  test('an unknown app cannot conjure itself into the switcher', () => {
    // Previously label+route was enough to pass the guard.
    expect(Apps.normalizeApp({ id: 'not-a-real-app', label: 'Fake', route: 'evil.html' })).toBeNull();
  });

  test('control plane may override presentation but never route or id', () => {
    const app = Apps.normalizeApp({
      id: 'insights',
      label: 'Firm Analytics',
      description: 'Custom copy',
      route: '/somewhere-else',
      colors: ['#000000']
    });
    expect(app.label).toBe('Firm Analytics');
    expect(app.description).toBe('Custom copy');
    expect(app.colors).toEqual(['#000000']);
    expect(app.route).toBe('admin/analytics.html');
    expect(app.id).toBe('lana-insights');
  });
});

describe('LanaClientApps.normalizeAppList', () => {
  test('drops unresolvable entries and keeps the resolvable ones', () => {
    const list = Apps.normalizeAppList([
      { id: '@insights', label: 'Insights', route: '/insights' },
      { id: '@voice', label: 'Voice', route: '/voice' },
      { id: '@agents', label: 'Agents', route: '/agents' }
    ]);
    expect(list.map((a) => a.id)).toEqual(['lana-insights', 'lana-agents']);
  });

  test('a fully unresolvable legacy payload falls back instead of emptying the switcher', () => {
    // A cached enabled_apps holding ONLY backend-only ids must not strand the
    // user with no way back to the workspace.
    const list = Apps.normalizeAppList([
      { id: '@voice', label: 'Voice', route: '/voice' },
      { id: '@automation', label: 'Automation', route: '/automation' }
    ]);
    expect(list.length).toBeGreaterThan(0);
    for (const app of list) {
      expect(fs.existsSync(path.join(SRC, app.route))).toBe(true);
    }
  });

  test('deduplicates ids that alias to the same surface', () => {
    const list = Apps.normalizeAppList([{ id: '@insights' }, { id: 'insights' }, { id: 'lana-insights' }]);
    expect(list).toHaveLength(1);
  });

  test('no app can ever render with an unresolvable route', () => {
    const list = Apps.normalizeAppList([
      { id: '@insights', route: '/insights' },
      { id: 'lana-works', route: '/works' },
      { id: 'garbage', label: 'G', route: 'nope.html' }
    ]);
    for (const app of list) {
      expect(fs.existsSync(path.join(SRC, app.route))).toBe(true);
    }
  });
});
