'use strict';

// <lex-connector-setup-card> through LexDynamicCardRenderer, in JSDOM: the
// card reads the live status, picks its button, opens the wizard (or Data
// Connectors with the flag off) and reads the status again when the wizard
// closes.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const windows = [];
afterEach(() => { while (windows.length) windows.pop().close(); });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const CARD = { card_type: 'connector_setup', connector_type: 'stripe', connector_name: 'Stripe', scope: 'org' };

function boot({ rows = [], admin = true, wizard = true } = {}) {
  const dom = new JSDOM('<!doctype html><head></head><body><div id="thread"></div></body>', {
    url: 'http://localhost/src/index.html', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  for (const rel of ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/foundation/lex-btn.js',
    'js/lex/chat/lex-dynamic-card.renderer.js', 'js/lex/chat/connector-setup-card.model.js', 'js/lex/chat/lex-connector-setup-card.js']) {
    window.eval(read(rel));
  }
  // The wizard's scripts are already on the page, so the card loads none.
  ['lex-spinner', 'lex-drawer', 'lex-stepper', 'lex-input', 'lex-select', 'lex-toggle', 'lex-radio', 'lex-connect-wizard'].forEach((tag) => {
    if (!window.customElements.get(tag)) window.customElements.define(tag, class extends window.HTMLElement {});
  });
  const state = { rows };
  window.Connectors = { getAll: jest.fn(async () => ({ connectors: state.rows })) };
  window.ConnectorOAuth = {};
  window.ConnectWizardModel = {};
  window.LanaConfig = { CONNECT_WIZARD_ENABLED: wizard };
  window.Lex.Auth = { canAccessAdminPages: () => admin };
  window.Lex.Nav = { go: jest.fn() };
  window.Lex.ConnectWizard = { open: jest.fn() };
  windows.push(window);
  const container = window.document.getElementById('thread');
  return { window, container, state };
}

async function render(env, descriptor = CARD) {
  const el = env.window.LexDynamicCardRenderer.renderCard(descriptor, env.container);
  await flush();
  await flush();
  return el;
}

const button = (el) => el.querySelector('lex-btn[data-action]');

describe('renderer', () => {
  test('a connector_setup card becomes the card element with only its fields as attributes', async () => {
    const env = boot();
    const el = await render(env, { ...CARD, api_key: 'sk_live_x', props: { onclick: 'x' } });
    expect(el.tagName.toLowerCase()).toBe('lex-connector-setup-card');
    expect(el.getAttributeNames().sort()).toEqual(['card-type', 'connector-name', 'connector-type', 'scope']);
    expect(el.outerHTML).not.toContain('sk_live_x');
  });

  test('an unknown card type and a typed name used as a tag are both skipped', async () => {
    const env = boot();
    const warn = jest.spyOn(env.window.console, 'warn').mockImplementation(() => {});
    expect(env.window.LexDynamicCardRenderer.renderCard({ card_type: 'lex-script' }, env.container)).toBeNull();
    expect(env.window.LexDynamicCardRenderer.renderCard({ type: 'connector_setup' }, env.container)).toBeNull();
    expect(env.container.children).toHaveLength(0);
    warn.mockRestore();
  });

  test('the name is escaped', async () => {
    const env = boot();
    const el = await render(env, { ...CARD, connector_name: '<img src=x onerror=alert(1)>' });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('button choice', () => {
  test('not connected: "Set up Stripe" opens the wizard; when it closes the card reads the status again', async () => {
    const env = boot();
    const el = await render(env);
    expect(el.querySelector('.lex-csc__status').textContent).toBe('Not connected');
    expect(button(el).textContent).toBe('Set up Stripe');
    button(el).click();
    await flush(); await flush();
    expect(env.window.Lex.ConnectWizard.open).toHaveBeenCalledWith(expect.objectContaining({ connectorType: 'stripe', connectorName: 'Stripe' }));
    env.state.rows = [{ connector_type: 'stripe', status: 'connected', id: 'src-1' }];
    env.window.Lex.ConnectWizard.open.mock.calls[0][0].onDone();
    await flush(); await flush();
    expect(env.window.Connectors.getAll).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.lex-csc__status').textContent).toBe('Connected');
    expect(button(el).textContent).toBe('Open Stripe');
  });

  test('wizard flag off: the button opens Data Connectors instead', async () => {
    const env = boot({ wizard: false });
    const el = await render(env);
    expect(button(el).textContent).toBe('Set up Stripe');
    button(el).click();
    expect(env.window.Lex.ConnectWizard.open).not.toHaveBeenCalled();
    expect(env.window.Lex.Nav.go).toHaveBeenCalledWith('data-connectors.html', { params: { connector: 'stripe' } });
  });

  test('connected: "Open Stripe" opens Data Connectors for its source', async () => {
    const env = boot({ rows: [{ connector_type: 'stripe', status: 'connected', id: 'src-1' }] });
    const el = await render(env);
    button(el).click();
    expect(env.window.Lex.Nav.go).toHaveBeenCalledWith('data-connectors.html', { params: { connector: 'stripe', source: 'src-1' } });
  });

  test('an organization connector for a user who is not an admin: ask an admin, no button', async () => {
    const env = boot({ admin: false });
    const el = await render(env);
    expect(button(el)).toBeNull();
    expect(el.textContent).toContain('Ask an admin to connect Stripe.');
  });
});

describe('logo', () => {
  test('uses the row logo the Data Connectors table shows, and keeps the plug for unsafe URLs', async () => {
    const safe = boot({ rows: [{ id: 'src-1', connector_id: 'stripe', status: 'connected', manifest: { icon: 'https://cdn.example/stripe.svg' } }] });
    const el = await render(safe);
    expect(el.querySelector('img.lex-csc__logo').getAttribute('src')).toBe('https://cdn.example/stripe.svg');

    const unsafe = boot({ rows: [{ id: 'src-1', connector_id: 'stripe', status: 'connected', logo_url: 'javascript:alert(1)' }] });
    const el2 = await render(unsafe);
    expect(el2.querySelector('img')).toBeNull();
  });
});
