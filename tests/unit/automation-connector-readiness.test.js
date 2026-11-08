'use strict';

// Automate's connector readiness helpers (countReadyConnectors,
// connectorCompact, connectorDisplayName) live in
// src/automation/js/shared/connectors.js now that Automate's own Connectors
// view is gone. Home and the builder import them from there.
//
// The automation app is ES modules that Jest cannot require, so the shared
// modules are evaluated inside jsdom with their import lines removed.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const AUTOMATION = path.join(__dirname, '..', '..', 'src', 'automation');
const read = (rel) => fs.readFileSync(path.join(AUTOMATION, rel), 'utf8');
const strip = (source) => source.split('\n').filter((line) => !/^import /.test(line)).join('\n').replace(/^export /gm, '');

function loadShared() {
  const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const modules = ['js/constants.js', 'js/shared/utils.js', 'js/shared/ui.js', 'js/shared/connectors.js'].map((rel) => strip(read(rel)));
  window.eval(`(function () {\n${modules.join('\n')}\nwindow.__shared = { countReadyConnectors, connectorCompact, connectorDisplayName, isConnectorReady, connectorReadiness, getConnectorList };\n})();`);
  return window.__shared;
}

function context() {
  return {
    state: {
      connectors: [
        { id: 'gmail', metadata: { name: 'gmail', description: 'Email CRM connector' }, auth: { type: 'oauth2' } },
        { id: 'clio', status: 'connected' },
        { id: 'x' }
      ],
      connectorIndex: [
        { id: 'u1', connector_id: 'gmail', status: 'active', instance_key: 'default', connector_scope: 'user' },
        { id: 'u2', connector_type: 'clio', status: 'error' }
      ],
      connectorHealth: [{ connector_id: 'gmail', status_reason: 'Synced an hour ago' }]
    },
    getTemplateLibrary: () => [
      { name: 'Lead follow-up', connectorHints: ['CRM connector'] },
      { name: 'Inbox triage', connectorHints: ['email'] }
    ]
  };
}

describe('automation connector readiness (shared/connectors.js)', () => {
  const S = loadShared();

  test('countReadyConnectors counts catalog rows whose installed status is ready', () => {
    // gmail is active through its installed row; clio's installed row says error.
    expect(S.countReadyConnectors(context())).toBe(1);
    expect(S.countReadyConnectors({ state: {} })).toBe(0);
    expect(S.countReadyConnectors({ state: { connectors: [], connectorIndex: [{ status: 'installed' }, { status: 'syncing' }] } })).toBe(1);
  });

  test('readiness labels', () => {
    expect(S.connectorReadiness(null, { status: 'connected' })).toEqual({ label: 'Ready', tone: 'success' });
    expect(S.connectorReadiness(null, { status: 'syncing' })).toEqual({ label: 'Syncing', tone: 'info' });
    expect(S.connectorReadiness(null, { _raw: { status: 'ERROR' } })).toEqual({ label: 'Error', tone: 'error' });
    expect(S.connectorReadiness(null, {})).toEqual({ label: 'Not Installed', tone: '' });
    expect(S.isConnectorReady({ status: 'installed' })).toBe(true);
    expect(S.isConnectorReady({ status: 'disconnected' })).toBe(false);
  });

  test('connectorDisplayName formats the name and adds a non-default instance key', () => {
    expect(S.connectorDisplayName({ metadata: { name: 'google_calendar' } })).toBe('Google Calendar');
    expect(S.connectorDisplayName({ name: 'Sheets', instance_key: 'work' })).toBe('Sheets (work)');
    expect(S.connectorDisplayName({ id: 'clio', instance_key: 'default' })).toBe('Clio');
    expect(S.connectorDisplayName({})).toBe('Connector');
  });

  test('connectorCompact renders readiness, scope, auth, matching templates and the health note', () => {
    const ctx = context();
    const merged = S.getConnectorList(ctx)[0];
    const html = S.connectorCompact(ctx, merged);
    expect(html).toContain('<lex-badge label="Ready" color="green"></lex-badge>');
    expect(html).toContain('<lex-badge label="Personal" color="blue"></lex-badge>');
    expect(html).toContain('<lex-badge label="oauth2" color="gray"></lex-badge>');
    expect(html).toContain('<strong>Gmail</strong>');
    expect(html).toContain('<p>Email CRM connector</p>');
    expect(html).toContain('label="Lead follow-up"');
    expect(html).toContain('label="Inbox triage"');
    expect(html).toContain('<p>Synced an hour ago</p>');

    const bare = S.connectorCompact(ctx, { id: 'x' });
    expect(bare).toContain('<lex-badge label="Not Installed" color="gray"></lex-badge>');
    expect(bare).toContain('No connector description available.');
  });

  test('Home and the builder import the helpers from the shared module', () => {
    expect(read('js/views/home.js')).toContain("import { countReadyConnectors } from '../shared/connectors.js';");
    expect(read('js/views/builder.js')).toContain("import { connectorCompact, connectorDisplayName, countReadyConnectors } from '../shared/connectors.js';");
    expect(fs.existsSync(path.join(AUTOMATION, 'js/views/connectors.js'))).toBe(false);
    expect(fs.existsSync(path.join(AUTOMATION, 'js/views/connector-detail.js'))).toBe(false);
  });
});

describe('Automate sends connector entry points to Data Connectors', () => {
  const app = read('app.js');
  const constants = read('js/constants.js');

  test('old #connectors and #connector-detail hashes are not views any more, so they fall back to the Library', () => {
    expect(constants).not.toMatch(/^\s*connectors: \{/m);
    expect(constants).not.toContain("'connector-detail'");
    expect(app).toContain("parseAutomationRouteFromLocation() || { view: 'library' }");
    expect(app).not.toMatch(/setView\('connector/);
  });

  test('Check data, the builder link and the Home checklist all go to Data Connectors', () => {
    expect(app).toMatch(/function openDataConnectorsPage\(\) \{[\s\S]*?window\.Lex\.Nav\.go\('data-connectors\.html'\)/);
    expect(app).toMatch(/\[data-check-data-go\][\s\S]{0,80}openDataConnectorsPage\(\)/);
    expect(app).toMatch(/\[data-open-data-connectors\][\s\S]{0,40}openDataConnectorsPage\(\)/);
    expect(read('js/views/builder.js')).toContain('data-open-data-connectors>Open Data Connectors</lex-btn>');
    expect(read('js/views/home.js')).toContain("view: 'data-connectors'");
  });
});
