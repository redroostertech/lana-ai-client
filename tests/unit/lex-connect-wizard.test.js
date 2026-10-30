'use strict';

// <lex-stepper> (pure helpers and markup) and <lex-connect-wizard> (the
// Guided Connect flow against fake backend calls), in JSDOM.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const stepper = require(path.join(__dirname, '..', '..', 'src', 'js', 'lex', 'components', 'foundation', 'lex-stepper.js'));

const windows = [];
afterEach(() => {
  while (windows.length) windows.pop().close();
});

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/src/data-connectors.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  for (const rel of [
    'js/lex/lex.core.js',
    'js/lex/lex.icons.js',
    'js/lex/lex.forms.js',
    'js/lex/components/foundation/lex-spinner.js',
    'js/lex/components/foundation/lex-btn.js',
    'js/lex/components/form/lex-input.js',
    'js/lex/components/form/lex-select.js',
    'js/lex/components/form/lex-toggle.js',
    'js/lex/components/form/lex-radio.js',
    'js/lex/components/foundation/lex-stepper.js',
    'js/shared/connector-oauth-exchange.js',
    'js/connect-wizard.model.js',
    'js/lex/components/integrations/lex-connect-wizard.js'
  ]) {
    window.eval(read(rel));
  }
  windows.push(window);
  return window;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lex-stepper helpers', () => {
  const items = [
    { id: 'a', label: 'Before you start', state: 'done' },
    { id: 'b', label: 'Copy your key', state: 'current' },
    { id: 'c', label: 'Connect', state: 'bogus' }
  ];

  test('normalizes states and ids', () => {
    expect(stepper.normalizeItems(items).map((i) => i.state)).toEqual(['done', 'current', 'upcoming']);
    expect(stepper.normalizeItems([null, { label: 'x' }])).toEqual([{ id: '0', label: 'x', state: 'upcoming' }]);
    expect(stepper.normalizeItems('nope')).toEqual([]);
  });

  test('summary is "Step N of M: label" for the current step, else error, else last done', () => {
    expect(stepper.summary(items)).toBe('Step 2 of 3: Copy your key');
    expect(stepper.summary([{ label: 'A', state: 'done' }, { label: 'B', state: 'error' }])).toBe('Step 2 of 2: B');
    expect(stepper.summary([{ label: 'A', state: 'done' }, { label: 'B', state: 'done' }, { label: 'C' }])).toBe('Step 2 of 3: B');
    expect(stepper.summary([])).toBe('');
  });

  test('only done steps are selectable', () => {
    expect(stepper.isSelectable({ state: 'done' })).toBe(true);
    expect(stepper.isSelectable({ state: 'current' })).toBe(false);
    expect(stepper.isSelectable({ state: 'error' })).toBe(false);
    expect(stepper.isSelectable(null)).toBe(false);
  });
});

describe('<lex-stepper>', () => {
  test('renders an ordered list with aria-current and buttons only for done steps', async () => {
    const window = boot();
    const el = window.document.createElement('lex-stepper');
    window.document.body.appendChild(el);
    el.items = [
      { id: 'a', label: 'Intro <b>', state: 'done' },
      { id: 'b', label: 'Key', state: 'current' },
      { id: 'c', label: 'Connect', state: 'upcoming' }
    ];
    await flush();

    const lis = el.querySelectorAll('ol.lex-stepper-list > li');
    expect(lis).toHaveLength(3);
    expect(lis[1].getAttribute('aria-current')).toBe('step');
    expect(lis[0].getAttribute('aria-current')).toBeNull();
    expect(el.querySelectorAll('button[data-lex-step-index]')).toHaveLength(1);
    expect(el.innerHTML).toContain('Intro &lt;b&gt;');
    expect(el.querySelector('.lex-stepper-summary').textContent).toBe('Step 2 of 3: Key');

    const events = [];
    el.addEventListener('lex-step-select', (e) => events.push(e.detail));
    el.querySelector('button[data-lex-step-index]').click();
    expect(events).toEqual([{ index: 0, id: 'a' }]);
  });
});

function stripeCatalog() {
  return {
    connector: {
      id: 'stripe',
      metadata: { name: 'Stripe' },
      auth: { type: 'api_key', api_key_field: 'api_key' },
      configuration: { required_fields: [{ name: 'api_key', label: 'Stripe Secret Key', type: 'password' }] },
      documentation: {
        setup_guide: {
          intro: 'Copy a key.',
          prerequisites: [],
          steps: [{ title: 'Open the keys page', body: 'Go.', instructions: ['Click.'], external_link: { label: 'Open Stripe', url: 'https://dashboard.stripe.com/apikeys' }, code: { label: 'Example', value: 'sk_test_x' } }]
        }
      }
    },
    metadata: { connectorType: 'stripe' }
  };
}

function fakeServices(overrides) {
  const calls = [];
  const record = (name, value) => (...args) => { calls.push([name, ...args]); return Promise.resolve(typeof value === 'function' ? value(...args) : value); };
  const services = Object.assign({
    configure: record('configure', { success: true, connector_id: 'src-1' }),
    createInstance: record('createInstance', { data: { id: 'src-2' } }),
    patchConfig: record('patchConfig', {}),
    test: record('test', { success: true, verified: true, identity: { label: 'Connected as', value: 'Acme Ltd' } }),
    authorize: record('authorize', { authorization_url: 'https://auth.example/authorize?state=abc', redirect_uri: 'https://lanaai.io/oauth/callback/x' }),
    authStatus: record('authStatus', { auth_status: 'configured' }),
    exchange: record('exchange', {}),
    updateSync: record('updateSync', {}),
    userConnect: record('userConnect', { data: { authorizationUrl: 'https://accounts.example/o?state=s1', state: 's1' } }),
    userComplete: record('userComplete', { data: { integrationSourceId: 'user-src' } }),
    userConnections: record('userConnections', { connections: [] }),
    userSync: record('userSync', {}),
    subscribeOAuth: () => null,
    openExternal: (url) => { calls.push(['openExternal', url]); }
  }, overrides || {});
  return { services, calls };
}

async function mountWizard(window, input, services, extra) {
  const wizard = window.document.createElement('lex-connect-wizard');
  window.document.body.appendChild(wizard);
  const ctx = Object.assign({ input, services }, extra || {});
  wizard.start(ctx);
  await flush();
  return wizard;
}

function click(wizard, nav) {
  const el = wizard.querySelector('[data-cw-nav="' + nav + '"]');
  if (!el) throw new Error('No button ' + nav + ' on step ' + wizard.currentStep.id);
  el.click();
}

function type(wizard, name, value) {
  const el = wizard.querySelector('[data-cw-field="' + name + '"]');
  el.dispatchEvent(new wizard.ownerDocument.defaultView.CustomEvent('lex-input', { bubbles: true, detail: { name, value } }));
}

describe('<lex-connect-wizard>', () => {
  test('API key flow: guide, details, save, test, result, sync, done', async () => {
    const window = boot();
    const { services, calls } = fakeServices();
    const opened = [];
    const logs = [];
    window.console.error = (...args) => logs.push(args.join(' '));
    window.console.log = (...args) => logs.push(args.join(' '));
    const wizard = await mountWizard(window, { catalog: stripeCatalog(), capability: { canManageCredentials: true } }, services, {
      onOpenConnector: (detail) => opened.push(detail)
    });

    expect(wizard.currentStep.id).toBe('before_you_start');
    expect(wizard.querySelector('lex-stepper').items[0].state).toBe('current');
    expect(wizard.querySelector('[data-cw-nav="advanced"]')).not.toBeNull();

    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('guide_1');
    expect(wizard.querySelector('.lex-cw-code').textContent).toBe('sk_test_x');
    wizard.querySelector('[data-cw-link]').click();
    expect(calls).toContainEqual(['openExternal', 'https://dashboard.stripe.com/apikeys']);

    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('secure_it');
    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('details');
    const input = wizard.querySelector('lex-input[data-cw-field="api_key"]');
    expect(input.getAttribute('type')).toBe('password');

    // Next with the required field empty stays and says why.
    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('details');
    expect(wizard.querySelector('.lex-cw-error').textContent).toContain('Stripe Secret Key');

    type(wizard, 'api_key', 'sk_live_SECRET');
    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('connect');

    click(wizard, 'connect'); await flush(); await flush();
    expect(calls).toContainEqual(['configure', { api_key: 'sk_live_SECRET' }]);
    expect(calls).toContainEqual(['test', 'src-1']);
    expect(wizard.currentStep.id).toBe('result');
    expect(wizard.textContent).toContain('Stripe is connected.');
    expect(wizard.textContent).toContain('Connected as Acme Ltd');

    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('sync');
    click(wizard, 'sync-on'); await flush(); await flush();
    expect(calls).toContainEqual(['updateSync', 'src-1', { sync_frequency: 'daily', scheduled_sync_time: '08:00:00' }]);
    expect(wizard.currentStep.id).toBe('done');

    click(wizard, 'open-connector');
    expect(opened).toEqual([{ connectorType: 'stripe', scope: 'org', sourceId: 'src-1' }]);

    // Typed secrets never reach the DOM attributes or a log line.
    expect(wizard.outerHTML).not.toContain('sk_live_SECRET');
    expect(logs.join('\n')).not.toContain('sk_live_SECRET');
  });

  test('a failed test shows the backend message and a way back to the fields', async () => {
    const window = boot();
    const { services } = fakeServices({ test: () => Promise.resolve({ success: false, message: 'Invalid API Key provided' }) });
    const wizard = await mountWizard(window, { catalog: stripeCatalog(), capability: { canManageCredentials: true } }, services);
    wizard._values.api_key = 'bad';
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'connect'));
    await flush();
    click(wizard, 'connect'); await flush(); await flush();

    expect(wizard.currentStep.id).toBe('connect');
    expect(wizard.querySelector('.lex-cw-error-text').textContent).toBe('Invalid API Key provided');
    const back = wizard.querySelector('[data-cw-nav="error-back"]');
    const detailsIndex = wizard.model.steps.findIndex((s) => s.id === 'details');
    expect(back.textContent).toContain('Back to step ' + (detailsIndex + 1));
    expect(wizard.querySelector('lex-stepper').items[wizard.model.steps.findIndex((s) => s.id === 'connect')].state).toBe('error');
    back.click(); await flush();
    expect(wizard.currentStep.id).toBe('details');
  });

  test('a save error (for example a 403) shows the backend message', async () => {
    const window = boot();
    const { services } = fakeServices({ configure: () => Promise.reject(new Error('Insufficient connector permission')) });
    const wizard = await mountWizard(window, { catalog: stripeCatalog(), capability: { canManageCredentials: true } }, services);
    wizard._values.api_key = 'sk';
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'connect'));
    await flush();
    click(wizard, 'connect'); await flush(); await flush();
    expect(wizard.querySelector('.lex-cw-error-text').textContent).toBe('Insufficient connector permission');
  });

  test('TEST_NOT_DEFINED saves without verifying', async () => {
    const window = boot();
    const { services } = fakeServices({ test: () => Promise.resolve({ success: true, code: 'TEST_NOT_DEFINED' }) });
    const wizard = await mountWizard(window, { catalog: stripeCatalog(), capability: { canManageCredentials: true } }, services);
    wizard._values.api_key = 'sk';
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'connect'));
    await flush();
    click(wizard, 'connect'); await flush(); await flush();
    expect(wizard.currentStep.id).toBe('result');
    expect(wizard.textContent).toContain('Saved. LANA will verify on the first sync.');
  });

  test('"Not now" leaves an org source on manual sync without a call', async () => {
    const window = boot();
    const { services, calls } = fakeServices();
    const wizard = await mountWizard(window, { catalog: stripeCatalog(), capability: { canManageCredentials: true } }, services);
    wizard._sourceId = 'src-1';
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'sync'));
    await flush();
    click(wizard, 'sync-later'); await flush();
    expect(wizard.currentStep.id).toBe('done');
    expect(calls.filter((c) => c[0] === 'updateSync')).toEqual([]);
  });

  test('a member on an org connector sees "Ask an admin" and no Next', async () => {
    const window = boot();
    const { services } = fakeServices();
    const wizard = await mountWizard(window, { catalog: stripeCatalog(), capability: { canManageCredentials: false } }, services);
    expect(wizard.textContent).toContain('Ask an admin to connect Stripe');
    expect(wizard.querySelector('[data-cw-nav="next"]')).toBeNull();
    expect(wizard.querySelector('[data-cw-nav="advanced"]')).not.toBeNull();
  });

  test('org OAuth: save, authorize, open the browser, finish on the deep link callback', async () => {
    const window = boot();
    let callback = null;
    let exchanged = false;
    const { services, calls } = fakeServices({
      subscribeOAuth: (handler) => { callback = handler; return () => { callback = null; }; },
      exchange: (data, redirectUri) => { exchanged = true; calls.push(['exchange', data, redirectUri]); return Promise.resolve({}); },
      authStatus: () => Promise.resolve({ auth_status: exchanged ? 'connected' : 'configured' })
    });
    const catalog = {
      connector: { id: 'hubspot', metadata: { name: 'HubSpot' }, auth: { type: 'oauth2' }, configuration: { required_fields: [] } },
      metadata: { connectorType: 'hubspot' }
    };
    const wizard = await mountWizard(window, {
      catalog, capability: { canManageCredentials: true }, oauthApp: { lana_managed_available: true }
    }, services);
    expect(wizard.querySelector('[data-cw-own-app]')).not.toBeNull();
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'connect'));
    await flush();
    click(wizard, 'connect'); await flush(); await flush();

    expect(calls).toContainEqual(['configure', {}]);
    expect(calls).toContainEqual(['authorize', 'src-1']);
    expect(calls).toContainEqual(['openExternal', 'https://auth.example/authorize?state=abc']);
    expect(wizard.querySelector('[data-cw-nav="cancel-oauth"]')).not.toBeNull();

    // A callback for another flow is ignored.
    callback({ code: 'c0', state: 'other' }); await flush();
    expect(calls.filter((c) => c[0] === 'exchange')).toEqual([]);

    callback({ code: 'c1', state: 'abc' }); await flush(); await flush(); await flush();
    expect(calls).toContainEqual(['exchange', { code: 'c1', state: 'abc' }, 'https://lanaai.io/oauth/callback/x']);
    expect(wizard.currentStep.id).toBe('result');
    expect(callback).toBeNull();
    wizard.remove();
  });

  test('personal OAuth goes through /me/connections and never calls configure', async () => {
    const window = boot();
    let callback = null;
    const { services, calls } = fakeServices({
      subscribeOAuth: (handler) => { callback = handler; return () => { callback = null; }; }
    });
    const catalog = {
      connector: { id: 'gmail', metadata: { name: 'Gmail' }, connector_scope: 'user', auth: { type: 'oauth2' }, configuration: { required_fields: [{ name: 'client_id' }, { name: 'client_secret' }] } },
      metadata: { connectorType: 'gmail' }
    };
    const wizard = await mountWizard(window, {
      catalog, capability: { canManageCredentials: false }, userConnection: { status: 'available' }
    }, services);
    expect(wizard.model.saveMode).toBe('user_oauth');
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'connect'));
    await flush();
    click(wizard, 'connect'); await flush(); await flush();
    expect(calls).toContainEqual(['openExternal', 'https://accounts.example/o?state=s1']);

    callback({ code: 'code-1', state: 's1' }); await flush(); await flush();
    expect(calls).toContainEqual(['userComplete', { code: 'code-1', state: 's1' }]);
    expect(calls.filter((c) => c[0] === 'configure' || c[0] === 'authorize')).toEqual([]);
    expect(wizard.currentStep.id).toBe('result');

    click(wizard, 'next'); await flush();
    click(wizard, 'sync-later'); await flush(); await flush();
    expect(calls).toContainEqual(['userSync', 'user-src', { sync_frequency: 'manual' }]);
    wizard.remove();
  });

  test('personal OAuth reconnect: an already connected row does not finish the poll', async () => {
    const window = boot();
    const ticks = [];
    window.setTimeout = (fn) => { ticks.push(fn); return ticks.length; };
    window.clearTimeout = () => {};
    let rows = [{ id: 'user-src', connector_id: 'gmail', status: 'connected', auth_status: 'connected', updated_at: '2026-10-01T00:00:00Z' }];
    const { services } = fakeServices({ userConnections: () => Promise.resolve({ connections: rows }) });
    const catalog = {
      connector: { id: 'gmail', metadata: { name: 'Gmail' }, connector_scope: 'user', auth: { type: 'oauth2' }, configuration: { required_fields: [] } },
      metadata: { connectorType: 'gmail' }
    };
    const wizard = await mountWizard(window, {
      catalog, capability: { canManageCredentials: false }, userConnection: { status: 'connected' }
    }, services);
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'connect'));
    await flush();
    click(wizard, 'connect'); await flush(); await flush();

    ticks.shift()(); await flush(); await flush();
    expect(wizard.currentStep.id).toBe('connect');

    rows = [Object.assign({}, rows[0], { updated_at: '2026-10-30T12:00:00Z' })];
    ticks.shift()(); await flush(); await flush();
    expect(wizard.currentStep.id).toBe('result');
    wizard.remove();
  });

  test('multi instance: creates the instance, then saves by id', async () => {
    const window = boot();
    const { services, calls } = fakeServices();
    const catalog = {
      connector: {
        id: 'postgresql', metadata: { name: 'PostgreSQL' },
        auth: { type: 'connection_params', connection_fields: { host: { required: true } }, proxy_auth: { api_key_field: 'proxy_api_key' } },
        configuration: { required_fields: [{ name: 'proxy_api_key', type: 'password' }] }
      },
      metadata: { connectorType: 'postgresql' }
    };
    const wizard = await mountWizard(window, {
      catalog,
      capability: { canManageCredentials: true },
      source: { id: 'src-0', status: 'connected', multi_instance: { enabled: true } }
    }, services);
    expect(wizard.model.saveMode).toBe('create_instance');
    Object.assign(wizard._values, { instance_key: 'Reporting DB', host: 'db', proxy_api_key: 'pk' });
    wizard._goTo(wizard.model.steps.findIndex((s) => s.id === 'connect'));
    await flush();
    click(wizard, 'connect'); await flush(); await flush(); await flush();
    expect(calls).toContainEqual(['createInstance', 'reporting-db']);
    expect(calls).toContainEqual(['patchConfig', 'src-2', { host: 'db', proxy_api_key: 'pk', sync_frequency: 'manual', guided_connect_pending: true }]);
    expect(calls.filter((c) => c[0] === 'configure')).toEqual([]);
    expect(calls).toContainEqual(['test', 'src-2']);
  });

  test('Advanced setup with no row creates one through the guided configure first', async () => {
    const window = boot();
    const { services, calls } = fakeServices();
    const advanced = [];
    const wizard = await mountWizard(window, { catalog: stripeCatalog(), capability: { canManageCredentials: true } }, services, {
      onAdvanced: (detail) => advanced.push(detail)
    });
    click(wizard, 'advanced'); await flush(); await flush();
    expect(calls).toContainEqual(['configure', {}]);
    expect(advanced).toEqual([{ connectorType: 'stripe', scope: 'org', sourceId: 'src-1' }]);
  });
});

describe('ConnectorOAuth', () => {
  test('state from the authorization URL and the exchange body', async () => {
    const window = boot();
    const C = window.ConnectorOAuth;
    expect(C.stateFromAuthorizationUrl('https://x.example/a?client_id=1&state=xyz')).toBe('xyz');
    expect(C.stateFromAuthorizationUrl('not a url')).toBe('');
    const posts = [];
    await C.exchangeCode({ post: (url, body) => { posts.push([url, body]); return Promise.resolve({}); } }, {
      data: { code: 'c', state: 's', realm_id: 'r' }, connectorType: 'quickbooks-online'
    });
    expect(posts).toEqual([['/api/v1/integrations/oauth/exchange', {
      code: 'c', state: 's', provider: 'quickbooks-online', connectorId: 'quickbooks-online', redirectUri: 'lana-ai://oauth/callback', realmId: 'r'
    }]]);
  });

  test('one IPC listener, many subscribers, unsubscribe works', () => {
    const window = boot();
    const listeners = [];
    window.electronAPI = { onOAuthCallback: (fn) => listeners.push(fn) };
    const seen = [];
    const off1 = window.ConnectorOAuth.subscribe((d) => seen.push(['a', d.code]));
    window.ConnectorOAuth.subscribe((d) => seen.push(['b', d.code]));
    expect(listeners).toHaveLength(1);
    listeners[0]({ code: '1' });
    off1();
    listeners[0]({ code: '2' });
    expect(seen).toEqual([['a', '1'], ['b', '1'], ['b', '2']]);
    delete window.electronAPI;
    expect(window.ConnectorOAuth.subscribe(() => {})).toBeNull();
  });
});

describe('Lex.ConnectWizard.open', () => {
  function bootOpener(connectors, user) {
    const window = boot();
    for (const rel of ['js/lex/components/foundation/lex-drawer.js', 'js/connect-wizard.js']) window.eval(read(rel));
    window.Lex.Auth = { canAccessAdminPages: () => user.admin };
    window.Connectors = Object.assign({ helpers: { looksLikeUuid: (v) => String(v).length === 36 } }, connectors);
    window.api = { getUserConnections: () => Promise.resolve({ available: [{ connector_id: 'gmail', status: 'awaiting_admin_configuration' }] }) };
    return window;
  }

  const drive = {
    connector: { id: 'google-drive', metadata: { name: 'Google Drive' }, connector_scope: 'org', auth: { type: 'oauth2' }, configuration: { required_fields: [] } },
    metadata: { connectorType: 'google-drive' }
  };

  test('loads the package, the redirect URI (403 hides it), managed OAuth and the existing row', async () => {
    const sourceRow = { id: '11111111-2222-4333-8444-555555555555', connector_id: 'google-drive', status: 'not_connected' };
    const window = bootOpener({
      getCatalogPackage: jest.fn(() => Promise.resolve(drive)),
      getRedirectUri: jest.fn(() => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))),
      getBridgeConfig: jest.fn(() => Promise.resolve({ lana_managed_available: true, credential_source: 'lana' })),
      getAll: jest.fn(() => Promise.resolve({ connectors: [sourceRow] }))
    }, { admin: true });
    const onDone = jest.fn();
    const drawer = window.Lex.ConnectWizard.open({ connectorType: 'google-drive', connectorName: 'google-drive', onDone });
    await flush(); await flush(); await flush();

    expect(window.Connectors.getRedirectUri).toHaveBeenCalledWith('google-drive', 'web', 'org');
    const wizard = drawer.querySelector('lex-connect-wizard');
    expect(wizard.model.redirect.status).toBe('forbidden');
    expect(wizard.model.managedOAuth).toBe(true);
    expect(wizard.model.sourceId).toBe(sourceRow.id);
    expect(drawer.heading).toBe('Connect Google Drive');

    drawer.dispatchEvent(new window.CustomEvent('lex-close', { bubbles: true }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(window.document.querySelector('lex-drawer')).toBeNull();
  });

  test('a personal connector reads its availability from /me/connections', async () => {
    const gmail = {
      connector: { id: 'gmail', metadata: { name: 'Gmail' }, connector_scope: 'user', auth: { type: 'oauth2' }, configuration: {} },
      metadata: { connectorType: 'gmail' }
    };
    const window = bootOpener({
      getCatalogPackage: () => Promise.resolve(gmail),
      getRedirectUri: () => Promise.resolve({ redirect_uri: 'https://lanaai.io/oauth/callback/gmail', mode: 'standard' }),
      getBridgeConfig: jest.fn(),
      getAll: () => Promise.resolve({ connectors: [] })
    }, { admin: false });
    const drawer = window.Lex.ConnectWizard.open({ connectorType: 'gmail' });
    await flush(); await flush(); await flush();
    const wizard = drawer.querySelector('lex-connect-wizard');
    expect(window.Connectors.getBridgeConfig).not.toHaveBeenCalled();
    expect(wizard.model.blocked.reason).toContain('An admin has to finish setting up Gmail');
  });

  test('a catalog failure shows the backend message in the drawer', async () => {
    const window = bootOpener({
      getCatalogPackage: () => Promise.reject(new Error('Connector "nope" not found')),
      getAll: () => Promise.resolve({ connectors: [] })
    }, { admin: true });
    window.console.error = () => {};
    const drawer = window.Lex.ConnectWizard.open({ connectorType: 'nope' });
    await flush(); await flush();
    expect(drawer.querySelector('.lex-cw-error-text').textContent).toBe('Connector "nope" not found');
  });

  test('isEnabled reads CONNECT_WIZARD_ENABLED', () => {
    const window = bootOpener({}, { admin: true });
    expect(window.Lex.ConnectWizard.isEnabled()).toBe(false);
    window.LanaConfig = { CONNECT_WIZARD_ENABLED: true };
    expect(window.Lex.ConnectWizard.isEnabled()).toBe(true);
  });
});
