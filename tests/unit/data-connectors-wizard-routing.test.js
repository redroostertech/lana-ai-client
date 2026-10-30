'use strict';

// Data Connectors (src/js/data_connectors.js): which surface opening a
// connector goes to. Flag off keeps the viewer path; flag on sends a
// connector that is not connected to the Guided Connect wizard; a connected
// connector opens the viewer as before.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function loadPage(config, withWizard) {
  const win = { localStorage: { getItem: () => null, setItem: () => {} }, Intl, Date, setTimeout, clearTimeout };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  win.ConnectorRegistry = { isConnectorInstalled: () => false };
  win.LanaConfig = config;
  win.Lex.Toast = { error: () => {}, warning: () => {} };
  if (withWizard) win.Lex.ConnectWizard = { open: jest.fn() };
  win.addEventListener = () => {};
  const doc = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'ConnectorRegistry', 'Connectors', 'api', 'Lex', read('js/data_connectors.js'))(
    win, doc, win.ConnectorRegistry, {}, {}, win.Lex
  );
  return win.DataConnectorsTable;
}

const notConnected = { id: 'stripe', connector_id: 'stripe', name: 'Stripe' };
const connected = { id: '11111111-2222-4333-8444-555555555555', connector_id: 'stripe', name: 'Stripe', status: 'connected' };
const configured = { id: 'leadly', name: 'Leadly', config: { location_id: 'abc' } };
const disconnected = { id: 'x', name: 'X', status: 'disconnected' };
const soon = { id: 'y', name: 'Y', status: 'coming_soon' };

describe('connector open route', () => {
  test('flag off: everything keeps the viewer path', () => {
    const page = loadPage({ CONNECT_WIZARD_ENABLED: false }, true);
    expect(page.connectorOpenRoute(notConnected, [])).toBe('viewer');
    expect(page.connectorOpenRoute(connected, [])).toBe('viewer');
    expect(page.connectorOpenRoute(soon, [])).toBe('details');
  });

  test('pages without the flag read it as off', () => {
    const page = loadPage(undefined, true);
    expect(page.connectorOpenRoute(notConnected, [])).toBe('viewer');
  });

  test('flag on and not connected: the wizard', () => {
    const page = loadPage({ CONNECT_WIZARD_ENABLED: true }, true);
    expect(page.connectorOpenRoute(notConnected, [])).toBe('wizard');
  });

  test('flag on and connected: the viewer, as today', () => {
    const page = loadPage({ CONNECT_WIZARD_ENABLED: true }, true);
    expect(page.connectorOpenRoute(connected, [])).toBe('viewer');
    expect(page.connectorOpenRoute(configured, [])).toBe('viewer');
    expect(page.connectorOpenRoute(disconnected, [])).toBe('viewer');
    expect(page.connectorOpenRoute(soon, [])).toBe('details');
  });

  test('flag on but the wizard script missing: the viewer', () => {
    const page = loadPage({ CONNECT_WIZARD_ENABLED: true }, false);
    expect(page.connectorOpenRoute(notConnected, [])).toBe('viewer');
  });
});

describe('connection evidence', () => {
  test('guided_connect_pending and sync settings are operational keys, not evidence', () => {
    const page = loadPage({ CONNECT_WIZARD_ENABLED: true }, true);
    expect(page.connectorHasMeaningfulConfig({ config: { guided_connect_pending: true, sync_frequency: 'manual' } })).toBe(false);
    expect(page.connectorOpenRoute({ id: 'z', name: 'Z', config: { guided_connect_pending: true, sync_frequency: 'manual' } }, [])).toBe('wizard');
    expect(page.connectorHasMeaningfulConfig({ config: { guided_connect_pending: true, subdomain: 'acme' } })).toBe(true);
  });
});
