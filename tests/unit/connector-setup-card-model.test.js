'use strict';

// The chat connector setup card (src/js/lex/chat/connector-setup-card.model.js):
// live status from GET /connectors rows and the one action the card offers.

const fs = require('fs');
const path = require('path');
const model = require('../../src/js/lex/chat/connector-setup-card.model.js');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const stripe = model.normalizeCard({ card_type: 'connector_setup', connector_type: 'stripe', connector_name: 'Stripe', scope: 'org' });
const drive = model.normalizeCard({ card_type: 'connector_setup', connector_type: 'google-drive', connector_name: 'Google Drive', scope: 'user' });

describe('card descriptor', () => {
  test('keeps its four fields and rejects anything that is not a connector setup card', () => {
    expect(model.normalizeCard({ card_type: 'connector_setup', connector_type: ' stripe ', connector_name: '', scope: 'admin', api_key: 'x' }))
      .toEqual({ card_type: 'connector_setup', connector_type: 'stripe', connector_name: 'stripe', scope: 'org' });
    expect(model.normalizeCard({ card_type: 'other', connector_type: 'stripe' })).toBeNull();
    expect(model.normalizeCard({ card_type: 'connector_setup', connector_type: '' })).toBeNull();
  });
});

describe('live status', () => {
  test.each([
    ['no row', [], 'not_connected'],
    ['a connected row', [{ connector_type: 'stripe', status: 'connected' }], 'connected'],
    ['auth_status connected', [{ connector_id: 'stripe', auth_status: 'connected' }], 'connected'],
    ['a row with saved config', [{ connector_type: 'stripe', config: { account_id: 'acct_1' } }], 'connected'],
    ['a row with only operational config', [{ connector_type: 'stripe', config: { sync_frequency: 'manual', api_key_configured: true } }], 'not_connected'],
    ['a disconnected row', [{ connector_type: 'stripe', status: 'disconnected' }], 'disconnected'],
    ['another connector only', [{ connector_type: 'hubspot', status: 'connected' }], 'not_connected'],
    ['one of two instances connected', [{ connector_type: 'stripe', status: 'disconnected' }, { connector_type: 'stripe', status: 'connected' }], 'connected']
  ])('%s', (_label, rows, status) => {
    expect(model.connectorStatus(rows, 'stripe').status).toBe(status);
  });

  test('a list that could not be read is unknown, not "not connected"', () => {
    expect(model.connectorStatus(null, 'stripe')).toEqual({ status: 'unknown', row: null });
  });

  // Parity with the Data Connectors table: flag on, a connector the table
  // sends to the wizard is not connected here, one it opens in the viewer is
  // connected or disconnected here.
  test('agrees with the Data Connectors routing for the same rows', () => {
    const win = { localStorage: { getItem: () => null, setItem: () => {} }, Intl, Date, setTimeout, clearTimeout };
    // eslint-disable-next-line no-new-func
    new Function('window', read('js/time-utils.js'))(win);
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
    win.ConnectorRegistry = { isConnectorInstalled: () => false };
    win.LanaConfig = { CONNECT_WIZARD_ENABLED: true };
    win.Lex.Toast = { error: () => {}, warning: () => {} };
    win.Lex.ConnectWizard = { open: () => {} };
    win.addEventListener = () => {};
    const doc = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'ConnectorRegistry', 'Connectors', 'api', 'Lex', read('js/data_connectors.js'))(win, doc, win.ConnectorRegistry, {}, {}, win.Lex);
    const table = win.DataConnectorsTable;
    const rows = [
      { id: 'stripe', connector_id: 'stripe', name: 'Stripe' },
      { id: 'stripe', connector_id: 'stripe', name: 'Stripe', status: 'connected' },
      { id: 'stripe', connector_id: 'stripe', name: 'Stripe', config: { account_id: 'acct_1' } },
      { id: 'stripe', connector_id: 'stripe', name: 'Stripe', config: { sync_frequency: 'hourly' } },
      { id: 'stripe', connector_id: 'stripe', name: 'Stripe', status: 'disconnected' }
    ];
    rows.forEach((row) => {
      const route = table.connectorOpenRoute(row, []);
      const status = model.connectorStatus([row], 'stripe').status;
      expect([route, status]).toEqual(route === 'wizard' ? ['wizard', 'not_connected'] : ['viewer', expect.stringMatching(/^(connected|disconnected)$/)]);
    });
  });
});

describe('action', () => {
  test.each([
    ['not connected, admin, wizard on', stripe, 'not_connected', true, true, { action: 'setup', label: 'Set up Stripe' }],
    ['not connected, admin, wizard off', stripe, 'not_connected', true, false, { action: 'navigate', label: 'Set up Stripe' }],
    ['connected, admin', stripe, 'connected', true, true, { action: 'open', label: 'Open Stripe' }],
    ['disconnected, admin', stripe, 'disconnected', true, true, { action: 'open', label: 'Open Stripe' }],
    ['org connector, not an admin', stripe, 'not_connected', false, true, { action: 'ask_admin', label: '', note: 'Ask an admin to connect Stripe.' }],
    ['org connector connected, not an admin', stripe, 'connected', false, true, { action: 'none', label: '', note: 'Stripe is connected.' }],
    ['user connector, not an admin', drive, 'not_connected', false, true, { action: 'setup', label: 'Set up Google Drive' }],
    ['user connector connected, not an admin', drive, 'connected', false, true, { action: 'open', label: 'Open Google Drive' }],
    ['status unknown', stripe, 'unknown', true, true, { action: 'navigate', label: 'Open Data Connectors' }]
  ])('%s', (_label, card, status, canManage, wizardEnabled, expected) => {
    expect(model.cardView({ card, status, canManage, wizardEnabled })).toMatchObject(expected);
  });
});
