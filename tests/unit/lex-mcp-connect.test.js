'use strict';

// Third-party MCP servers in JSDOM: the MCP steps of the connect wizard
// (<lex-mcp-connect-wizard>) for each sign in outcome, the tool review list
// (<lex-mcp-tool-review>), the server panel (<lex-mcp-server-panel>), the
// shared ConnectorOAuth.waitForSignIn and the Lex.McpConnect opener.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

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
    'js/lex/components/foundation/lex-badge.js',
    'js/lex/components/form/lex-input.js',
    'js/lex/components/form/lex-toggle.js',
    'js/lex/components/form/lex-radio.js',
    'js/lex/components/foundation/lex-stepper.js',
    'js/lex/components/foundation/lex-drawer.js',
    'js/shared/connector-oauth-exchange.js',
    'js/connect-wizard.model.js',
    'js/mcp-connect.model.js',
    'js/lex/components/integrations/lex-mcp-tool-review.js',
    'js/lex/components/integrations/lex-mcp-connect-wizard.js',
    'js/lex/components/integrations/lex-mcp-server-panel.js'
  ]) {
    window.eval(read(rel));
  }
  window.Lex.Toast = { success: jest.fn(), error: jest.fn() };
  windows.push(window);
  return window;
}

// The sign in poll's timer (ConnectorOAuth.waitForSignIn tick), not the
// style timers lex-input and lex-forms schedule on first render.
function nextPoll(ticks) {
  const index = ticks.findIndex((fn) => fn.name === 'tick');
  if (index === -1) throw new Error('No poll scheduled');
  return ticks.splice(index, 1)[0];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await flush(); };

const SOURCE_ID = '11111111-2222-4333-8444-555555555555';
const STATE = 'a'.repeat(64);

function tool(overrides) {
  return Object.assign({
    alias: 'research_search', tool_name: 'search', title: 'Search documents',
    description: 'Searches <img src=x onerror=alert(1)> the archive',
    annotations: { readOnlyHint: true }, external: true, enabled: false,
    approval_state: 'not_approved', disabled_reason: null, current_hash: 'f'.repeat(64)
  }, overrides || {});
}

function server(overrides) {
  return Object.assign({
    id: SOURCE_ID, name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'bearer',
    auth_status: 'configured', credentials: {}, server_info: {}, updated_at: 't0'
  }, overrides || {});
}

function apiError(status, code, message, field) {
  return Object.assign(new Error(message), { status, code, data: { error: { code, message, field } } });
}

function fakeServices(overrides) {
  const calls = [];
  const record = (name, value) => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve(typeof value === 'function' ? value(...args) : value);
  };
  const testResult = { server: { name: 'acme-mcp', version: '0.4.1' }, protocol_version: '2025-06-18', transport: 'streamable_http',
    truncated: false, tools: [tool()], changes: { added: ['research_search'], disabled_changed: [], disabled_not_listed: [], skipped_invalid: 0 } };
  const services = Object.assign({
    discover: record('discover', { auth: 'bearer_or_header', authorization_server: null, registration: null, resource: 'https://mcp.example.com/mcp', scope: null }),
    create: record('create', (body) => server({ name: body.name, auth_mode: body.auth_mode })),
    getServer: record('getServer', () => server({ tools: [tool()] })),
    authorize: record('authorize', { authorization_url: 'https://auth.example.com/authorize?state=' + STATE, redirect_uri: 'lana-ai://oauth/callback', provider: 'mcp-server', expires_in: 600 }),
    exchange: record('exchange', {}),
    redirectUri: record('redirectUri', { redirect_uri: 'https://lanaai.io/oauth/callback/mcp-server' }),
    test: record('test', testResult),
    setTool: record('setTool', (sourceId, alias, body) => tool({ enabled: body.enabled, approval_state: body.enabled ? 'approved' : 'disabled' })),
    remove: record('remove', { source_id: SOURCE_ID, tools_removed: 1 }),
    subscribeOAuth: () => null,
    openExternal: (url) => { calls.push(['openExternal', url]); }
  }, overrides || {});
  return { services, calls };
}

async function mountWizard(window, services, extra) {
  const wizard = window.document.createElement('lex-mcp-connect-wizard');
  window.document.body.appendChild(wizard);
  wizard.start(Object.assign({ services, flow: 'electron' }, extra || {}));
  await flush();
  return wizard;
}

function click(root, nav) {
  const el = root.querySelector('[data-mcp-nav="' + nav + '"]');
  if (!el) throw new Error('No button ' + nav + ' on step ' + (root.currentStep && root.currentStep.id));
  el.click();
}

function type(root, name, value) {
  const el = root.querySelector('[data-mcp-field="' + name + '"]');
  if (!el) throw new Error('No field ' + name);
  el.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent('lex-input', { bubbles: true, detail: { name, value } }));
}

async function fillServer(wizard) {
  type(wizard, 'name', 'Research');
  type(wizard, 'url', 'https://mcp.example.com/mcp');
  click(wizard, 'next');
  await settle();
}

describe('<lex-mcp-connect-wizard>', () => {
  test('server step needs a name and an address, then discovers', async () => {
    const window = boot();
    const { services, calls } = fakeServices();
    const wizard = await mountWizard(window, services);
    expect(wizard.currentStep.id).toBe('server');
    expect(wizard.querySelector('lex-stepper').items.map((i) => i.label)).toEqual(['Server', 'Sign in', 'Connect', 'Test', 'Review tools', 'Done']);

    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('server');
    expect(wizard.querySelector('.lex-cw-error-text').textContent).toContain('Name, Server address');

    await fillServer(wizard);
    expect(calls).toContainEqual(['discover', 'https://mcp.example.com/mcp']);
    expect(wizard.currentStep.id).toBe('sign_in');
  });

  test('a refused address shows the plain message and the backend detail', async () => {
    const window = boot();
    const { services } = fakeServices({
      discover: () => Promise.reject(apiError(400, 'MCP_URL_REFUSED', 'The URL points at a loopback address', 'url'))
    });
    const wizard = await mountWizard(window, services);
    await fillServer(wizard);
    expect(wizard.currentStep.id).toBe('server');
    const texts = Array.from(wizard.querySelectorAll('.lex-cw-error-text')).map((el) => el.textContent);
    expect(texts).toEqual(['LANA can only connect to public https addresses.', 'The URL points at a loopback address']);
  });

  test('bearer token: create with the token, test, review, done; the secret never reaches the DOM or a log', async () => {
    const window = boot();
    const logs = [];
    window.console.warn = (...args) => logs.push(args.map(String).join(' '));
    window.console.error = (...args) => logs.push(args.map(String).join(' '));
    const opened = [];
    const { services, calls } = fakeServices();
    const wizard = await mountWizard(window, services, { onOpenServer: (d) => opened.push(d) });
    await fillServer(wizard);

    expect(wizard.textContent).toContain('does not offer OAuth sign in');
    expect(wizard.querySelector('lex-input[data-mcp-field="token"]').getAttribute('type')).toBe('password');
    click(wizard, 'next'); await flush();
    expect(wizard.querySelector('.lex-cw-error-text').textContent).toContain('Bearer token');

    type(wizard, 'token', 'sk-live-SECRET');
    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('connect');
    expect(wizard.querySelector('[data-mcp-nav="connect"]').textContent).toBe('Connect');
    click(wizard, 'connect'); await settle();

    expect(calls).toContainEqual(['create', { name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'bearer', token: 'sk-live-SECRET' }]);
    expect(calls).toContainEqual(['test', SOURCE_ID]);
    expect(wizard.currentStep.id).toBe('test');
    expect(wizard.textContent).toContain('acme-mcp 0.4.1');
    expect(wizard.textContent).toContain('1 tool found.');
    // Saved: no way back to the sign in fields.
    expect(wizard.querySelector('[data-mcp-nav="back"]')).toBeNull();
    expect(wizard._values.token).toBeUndefined();

    click(wizard, 'next'); await settle();
    expect(wizard.currentStep.id).toBe('review');
    const review = wizard.querySelector('lex-mcp-tool-review');
    expect(review).not.toBeNull();
    expect(review.textContent).toContain('Every time LANA wants to use one of these tools, it will ask you first.');

    click(wizard, 'next'); await flush();
    expect(wizard.currentStep.id).toBe('done');
    expect(wizard.textContent).toContain('No tools are on yet');
    click(wizard, 'open-server');
    expect(opened).toEqual([{ sourceId: SOURCE_ID }]);

    expect(wizard.outerHTML).not.toContain('sk-live-SECRET');
    expect(logs.join('\n')).not.toContain('sk-live-SECRET');
  });

  test('custom header: header name and a password value', async () => {
    const window = boot();
    const { services, calls } = fakeServices();
    const wizard = await mountWizard(window, services);
    await fillServer(wizard);
    const radio = wizard.querySelector('[data-mcp-method]');
    radio.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { name: 'mcp-method', value: 'header' } }));
    await flush();
    expect(wizard.querySelector('lex-input[data-mcp-field="header_name"]').getAttribute('type')).toBe('text');
    expect(wizard.querySelector('lex-input[data-mcp-field="token"]').getAttribute('label')).toBe('Header value');
    expect(wizard.querySelector('lex-input[data-mcp-field="token"]').getAttribute('type')).toBe('password');
    type(wizard, 'header_name', 'X-Api-Key');
    type(wizard, 'token', 'hv-1');
    click(wizard, 'next'); await flush();
    click(wizard, 'connect'); await settle();
    expect(calls).toContainEqual(['create', { name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'header', token: 'hv-1', header_name: 'X-Api-Key' }]);
  });

  test('no sign in: the Sign in step is skipped', async () => {
    const window = boot();
    const { services, calls } = fakeServices({ discover: () => Promise.resolve({ auth: 'none' }) });
    const wizard = await mountWizard(window, services);
    await fillServer(wizard);
    expect(wizard.steps.map((s) => s.id)).toEqual(['server', 'connect', 'test', 'review', 'done']);
    expect(wizard.currentStep.id).toBe('connect');
    expect(wizard.textContent).toContain('It does not ask for a sign in.');
    click(wizard, 'connect'); await settle();
    expect(calls).toContainEqual(['create', { name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'none' }]);
    expect(wizard.currentStep.id).toBe('test');
  });

  test('a create validation error goes back to the field\'s step', async () => {
    const window = boot();
    window.console.warn = () => {};
    const { services } = fakeServices({
      create: () => Promise.reject(apiError(400, 'VALIDATION_ERROR', 'A token is required for this sign-in mode', 'token'))
    });
    const wizard = await mountWizard(window, services);
    await fillServer(wizard);
    type(wizard, 'token', 'x');
    click(wizard, 'next'); await flush();
    click(wizard, 'connect'); await settle();
    expect(wizard.currentStep.id).toBe('connect');
    expect(wizard.querySelector('.lex-cw-error-text').textContent).toBe('A token is required for this sign-in mode');
    click(wizard, 'error-back'); await flush();
    expect(wizard.currentStep.id).toBe('sign_in');
  });

  test('OAuth with dynamic registration: "Sign in with <host>", deep link callback through the exchange, then test', async () => {
    const window = boot();
    let callback = null;
    let exchanged = false;
    const { services, calls } = fakeServices({
      discover: () => Promise.resolve({ auth: 'oauth', registration: 'dynamic', authorization_server: 'https://auth.example.com', resource: 'https://mcp.example.com/mcp', scope: null }),
      create: (body) => { calls.push(['create', body]); return Promise.resolve(server({ auth_mode: 'oauth', auth_status: 'pending_authorization' })); },
      subscribeOAuth: (handler) => { callback = handler; return () => { callback = null; }; },
      exchange: (data, redirectUri) => { exchanged = true; calls.push(['exchange', data, redirectUri]); return Promise.resolve({}); },
      getServer: () => Promise.resolve(server({ auth_mode: 'oauth', auth_status: exchanged ? 'connected' : 'pending_authorization', updated_at: exchanged ? 't1' : 't0' }))
    });
    const wizard = await mountWizard(window, services);
    await fillServer(wizard);
    expect(wizard.currentStep.id).toBe('sign_in');
    expect(wizard.querySelectorAll('[data-mcp-field]')).toHaveLength(0);
    click(wizard, 'next'); await flush();
    expect(wizard.querySelector('[data-mcp-nav="connect"]').textContent).toBe('Sign in with auth.example.com');

    click(wizard, 'connect'); await settle();
    expect(calls).toContainEqual(['create', { name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'oauth' }]);
    expect(calls).toContainEqual(['authorize', SOURCE_ID, 'electron']);
    expect(calls).toContainEqual(['openExternal', 'https://auth.example.com/authorize?state=' + STATE]);
    expect(wizard.querySelector('[data-mcp-nav="cancel-oauth"]')).not.toBeNull();

    callback({ code: 'c0', state: 'other' }); await settle();
    expect(calls.filter((c) => c[0] === 'exchange')).toEqual([]);

    callback({ code: 'c1', state: STATE }); await settle(6);
    expect(calls).toContainEqual(['exchange', { code: 'c1', state: STATE }, 'lana-ai://oauth/callback']);
    expect(callback).toBeNull();
    expect(wizard.currentStep.id).toBe('test');
    expect(calls).toContainEqual(['test', SOURCE_ID]);
    wizard.remove();
  });

  test('OAuth with a manual client: client ID and secret, the redirect URL to copy, and the poll finishes', async () => {
    const window = boot();
    const ticks = [];
    window.setTimeout = (fn) => { ticks.push(fn); return ticks.length; };
    window.clearTimeout = () => {};
    let connected = false;
    const { services, calls } = fakeServices({
      discover: () => Promise.resolve({ auth: 'oauth', registration: 'manual', authorization_server: 'https://login.example.org', resource: 'r', scope: 'read' }),
      create: (body) => { calls.push(['create', body]); return Promise.resolve(server({ auth_mode: 'oauth', auth_status: 'pending_authorization' })); },
      getServer: () => Promise.resolve(server({ auth_mode: 'oauth', auth_status: connected ? 'connected' : 'pending_authorization' }))
    });
    const wizard = await mountWizard(window, services, { flow: 'web' });
    await fillServer(wizard);
    expect(wizard.querySelector('lex-input[data-mcp-field="client_secret"]').getAttribute('type')).toBe('password');
    expect(wizard.querySelector('.lex-cw-code').textContent).toBe('https://lanaai.io/oauth/callback/mcp-server');
    type(wizard, 'client_id', 'lana-client');
    type(wizard, 'client_secret', 'cs-SECRET');
    click(wizard, 'next'); await flush();
    click(wizard, 'connect'); await settle();
    expect(calls).toContainEqual(['create', { name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'oauth', client_id: 'lana-client', client_secret: 'cs-SECRET' }]);
    expect(calls).toContainEqual(['authorize', SOURCE_ID, 'web']);

    nextPoll(ticks)(); await settle();
    expect(wizard.currentStep.id).toBe('connect');
    connected = true;
    nextPoll(ticks)(); await settle(6);
    expect(wizard.currentStep.id).toBe('test');
    expect(wizard.outerHTML).not.toContain('cs-SECRET');
    wizard.remove();
  });

  test('the OAuth wait times out after two minutes with a way to try again', async () => {
    const window = boot();
    const ticks = [];
    window.setTimeout = (fn) => { ticks.push(fn); return ticks.length; };
    window.clearTimeout = () => {};
    let now = 1000;
    window.LanaTime = { nowMs: () => now };
    const { services } = fakeServices({
      discover: () => Promise.resolve({ auth: 'oauth', registration: 'dynamic', authorization_server: 'https://auth.example.com' }),
      create: () => Promise.resolve(server({ auth_mode: 'oauth', auth_status: 'pending_authorization' })),
      getServer: () => Promise.resolve(server({ auth_mode: 'oauth', auth_status: 'pending_authorization' }))
    });
    const wizard = await mountWizard(window, services);
    await fillServer(wizard);
    click(wizard, 'next'); await flush();
    click(wizard, 'connect'); await settle();
    now += 121000;
    nextPoll(ticks)(); await settle();
    expect(wizard.querySelector('.lex-cw-error-text').textContent).toContain('LANA did not hear back');
    expect(wizard.querySelector('[data-mcp-nav="connect"]')).not.toBeNull();
    wizard.remove();
  });
});

describe('<lex-mcp-tool-review>', () => {
  async function mountReview(window, services, tools) {
    const review = window.document.createElement('lex-mcp-tool-review');
    window.document.body.appendChild(review);
    review.start({ sourceId: SOURCE_ID, serverName: 'Research', tools: tools || [tool()], services });
    await flush();
    return review;
  }

  function toggle(window, review, index, value) {
    const el = review.querySelectorAll('[data-mcp-toggle]')[index];
    el.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value } }));
  }

  test('server text is escaped, labelled as provided by the server, hints are claims, External badge', async () => {
    const window = boot();
    const { services } = fakeServices();
    const review = await mountReview(window, services, [
      tool({ title: '<script>x</script>Search', annotations: { readOnlyHint: true, destructiveHint: true } })
    ]);
    expect(review.querySelector('img')).toBeNull();
    expect(review.querySelector('script')).toBeNull();
    expect(review.querySelector('.lex-mcp-tool-desc').textContent).toBe('Searches <img src=x onerror=alert(1)> the archive');
    expect(review.querySelector('.lex-mcp-provided-label').textContent).toBe('Provided by Research');
    expect(review.querySelector('.lex-mcp-tool-title').textContent).toBe('<script>x</script>Search');
    expect(review.querySelector('.lex-mcp-tool-name').textContent).toBe('search');
    expect(review.querySelector('lex-badge.lex-mcp-external').getAttribute('label')).toBe('External');
    const hints = Array.from(review.querySelectorAll('.lex-mcp-hint-list lex-badge')).map((b) => b.getAttribute('label'));
    expect(hints).toEqual(['Says it only reads', 'Says it can change or delete data']);
    expect(review.textContent).toContain('What the server says about it');
    expect(review.textContent).toContain('Every time LANA wants to use one of these tools, it will ask you first.');
  });

  test('turning a tool on sends the reviewed hash; off sends enabled false', async () => {
    const window = boot();
    const { services, calls } = fakeServices();
    const changes = [];
    const review = await mountReview(window, services);
    review._ctx.onChange = (tools) => changes.push(tools);
    toggle(window, review, 0, true); await settle();
    expect(calls).toContainEqual(['setTool', SOURCE_ID, 'research_search', { enabled: true, expected_hash: 'f'.repeat(64) }]);
    expect(review.tools[0].enabled).toBe(true);
    expect(review.querySelector('.lex-mcp-tool-state').textContent).toBe('On');
    expect(changes).toHaveLength(1);
    toggle(window, review, 0, false); await settle();
    expect(calls).toContainEqual(['setTool', SOURCE_ID, 'research_search', { enabled: false }]);
  });

  test('a 409 reloads the list and explains that the tool changed', async () => {
    const window = boot();
    const changed = tool({ description: 'Now it also deletes things', current_hash: 'e'.repeat(64), disabled_reason: 'changed_since_approval' });
    const { services, calls } = fakeServices({
      setTool: () => Promise.reject(apiError(409, 'CONFLICT', 'The tool changed since you reviewed it. Review it again.')),
      getServer: () => { calls.push(['getServer']); return Promise.resolve(server({ tools: [changed] })); }
    });
    const review = await mountReview(window, services);
    toggle(window, review, 0, true); await settle();
    expect(calls).toContainEqual(['getServer']);
    expect(review.textContent).toContain('Search documents changed since you looked at it');
    expect(review.querySelector('.lex-mcp-tool-desc').textContent).toBe('Now it also deletes things');
    expect(review.querySelector('.lex-mcp-tool-note').textContent).toBe('Changed since you approved it. Review and turn on again.');
    expect(review.tools[0].current_hash).toBe('e'.repeat(64));
  });

  test('a tool the server no longer lists cannot be turned on', async () => {
    const window = boot();
    const { services } = fakeServices();
    const review = await mountReview(window, services, [tool({ disabled_reason: 'not_listed' })]);
    expect(review.querySelector('[data-mcp-toggle]').hasAttribute('disabled')).toBe(true);
    expect(review.querySelector('.lex-mcp-tool-note').textContent).toContain('no longer lists this tool');
  });

  test('another failure shows the message on that tool', async () => {
    const window = boot();
    const { services } = fakeServices({ setTool: () => Promise.reject(apiError(404, 'NOT_FOUND', 'MCP tool not found')) });
    const review = await mountReview(window, services);
    toggle(window, review, 0, true); await settle();
    expect(review.querySelector('.lex-mcp-tool-error').textContent).toBe('MCP tool not found');
    expect(review.tools[0].enabled).toBe(false);
  });
});

describe('<lex-mcp-server-panel>', () => {
  async function mountPanel(window, services, extra) {
    const panel = window.document.createElement('lex-mcp-server-panel');
    window.document.body.appendChild(panel);
    await panel.start(Object.assign({ sourceId: SOURCE_ID, services, flow: 'electron' }, extra || {}));
    await settle();
    return panel;
  }

  test('shows the server, its status and its tools', async () => {
    const window = boot();
    const { services } = fakeServices({
      getServer: () => Promise.resolve(server({ auth_status: 'connected', server_info: { name: 'acme-mcp', version: '0.4.1' }, tools: [tool()] }))
    });
    const panel = await mountPanel(window, services);
    expect(panel.querySelector('.lex-mcp-panel-title').textContent).toBe('Research');
    expect(panel.textContent).toContain('https://mcp.example.com/mcp');
    expect(panel.textContent).toContain('Bearer token');
    expect(panel.textContent).toContain('acme-mcp 0.4.1');
    expect(Array.from(panel.querySelectorAll('lex-badge')).map((b) => b.getAttribute('label'))).toContain('Connected');
    expect(panel.querySelector('lex-mcp-tool-review .lex-mcp-tool-title').textContent).toBe('Search documents');
    expect(panel.querySelector('[data-mcp-action="reconnect"]')).toBeNull();
  });

  test('Check tools again shows what changed and refreshes the list', async () => {
    const window = boot();
    const { services, calls } = fakeServices({
      test: () => { calls.push(['test']); return Promise.resolve({ server: { name: 'acme-mcp' }, truncated: true, tools: [tool({ enabled: false, disabled_reason: 'changed_since_approval' })],
        changes: { added: [], disabled_changed: ['research_search'], disabled_not_listed: [], skipped_invalid: 0 } }); }
    });
    const changed = jest.fn();
    const panel = await mountPanel(window, services, { onChanged: changed });
    panel.querySelector('[data-mcp-action="check"]').click(); await settle(6);
    expect(calls).toContainEqual(['test']);
    const status = panel.querySelector('.lex-mcp-check');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain('1 tool was turned off because it changed since you approved it.');
    expect(status.textContent).toContain('more tools than LANA reads');
    expect(changed).toHaveBeenCalled();
  });

  test('MCP_REAUTHORIZE_REQUIRED offers Sign in again, which waits for the new sign in', async () => {
    const window = boot();
    const ticks = [];
    window.setTimeout = (fn) => { ticks.push(fn); return ticks.length; };
    window.clearTimeout = () => {};
    let signedIn = false;
    const { services, calls } = fakeServices({
      getServer: () => Promise.resolve(server({ auth_mode: 'oauth', auth_status: 'connected', updated_at: signedIn ? 't2' : 't1', tools: [tool()] })),
      test: () => Promise.reject(apiError(409, 'MCP_REAUTHORIZE_REQUIRED', 'The MCP server needs to be signed in again'))
    });
    const panel = await mountPanel(window, services);
    expect(panel.querySelector('[data-mcp-action="reconnect"]')).toBeNull();
    panel.querySelector('[data-mcp-action="check"]').click(); await settle();
    expect(panel.querySelector('.lex-cw-error-text').textContent).toBe('Sign in to this server again to keep using it.');
    panel.querySelector('[data-mcp-action="reconnect"]').click(); await settle();
    expect(calls).toContainEqual(['authorize', SOURCE_ID, 'electron']);
    expect(calls).toContainEqual(['openExternal', 'https://auth.example.com/authorize?state=' + STATE]);
    expect(panel.querySelector('[data-mcp-action="cancel-oauth"]')).not.toBeNull();

    // Still the old connected row: keep waiting.
    nextPoll(ticks)(); await settle();
    expect(panel.querySelector('[data-mcp-action="cancel-oauth"]')).not.toBeNull();
    signedIn = true;
    nextPoll(ticks)(); await settle();
    expect(panel.querySelector('[data-mcp-action="cancel-oauth"]')).toBeNull();
    expect(panel.querySelector('[data-mcp-action="reconnect"]')).toBeNull();
    expect(window.Lex.Toast.success).toHaveBeenCalledWith('Signed in to Research again.');
    panel.remove();
  });

  test('an expired OAuth server shows Sign in again on load', async () => {
    const window = boot();
    const { services } = fakeServices({ getServer: () => Promise.resolve(server({ auth_mode: 'oauth', auth_status: 'expired', tools: [] })) });
    const panel = await mountPanel(window, services);
    expect(panel.querySelector('[data-mcp-action="reconnect"]')).not.toBeNull();
  });

  test('Disconnect asks first; cancel does nothing, confirm deletes and closes', async () => {
    const window = boot();
    const answers = [false, true];
    const asked = [];
    window.Lex.Modal = { confirmAsync: (title, message, options) => { asked.push([title, message, options]); return Promise.resolve(answers.shift()); } };
    const { services, calls } = fakeServices();
    const closed = jest.fn();
    const changed = jest.fn();
    const panel = await mountPanel(window, services, { onClose: closed, onChanged: changed });

    panel.querySelector('[data-mcp-action="disconnect"]').click(); await settle();
    expect(asked[0][0]).toBe('Disconnect Research?');
    expect(asked[0][1]).toContain('the one tool');
    expect(asked[0][2]).toEqual({ variant: 'danger', confirmText: 'Disconnect' });
    expect(calls.filter((c) => c[0] === 'remove')).toEqual([]);

    panel.querySelector('[data-mcp-action="disconnect"]').click(); await settle();
    expect(calls).toContainEqual(['remove', SOURCE_ID]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalled();
    expect(window.Lex.Toast.success).toHaveBeenCalledWith('Disconnected Research.');
  });

  test('a load failure shows the message', async () => {
    const window = boot();
    const { services } = fakeServices({ getServer: () => Promise.reject(apiError(404, 'NOT_FOUND', 'MCP server not found')) });
    const panel = await mountPanel(window, services);
    expect(panel.querySelector('.lex-cw-error-text').textContent).toBe('MCP server not found');
  });
});

describe('ConnectorOAuth.waitForSignIn', () => {
  test('a callback error stops the wait and reports it', async () => {
    const window = boot();
    let handler = null;
    const onError = jest.fn();
    const handle = window.ConnectorOAuth.waitForSignIn({
      url: 'https://x.example/a?state=s', expectedState: 's',
      subscribe: (fn) => { handler = fn; return () => { handler = null; }; },
      openExternal: jest.fn(), onCallback: jest.fn(), poll: () => Promise.resolve(null),
      onFinished: jest.fn(), onError, onTimeout: jest.fn()
    });
    handler({ error: 'access_denied', state: 's' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('access_denied');
    expect(handle.isActive()).toBe(false);
    expect(handler).toBeNull();
  });
});

describe('Lex.McpConnect opener', () => {
  function bootOpener(roles, flag) {
    const window = boot();
    for (const rel of ['js/connect-wizard.js', 'js/mcp-connect.js']) window.eval(read(rel));
    window.LanaConfig = { MCP_CONNECTORS_ENABLED: flag };
    window.Lex.Auth = { hasRole: (role) => roles.includes(role), canAccessAdminPages: () => true };
    window.Connectors = {
      mcpDiscover: jest.fn(() => Promise.resolve({ auth: 'none' })),
      mcpGetServer: jest.fn(() => Promise.resolve(server({ tools: [] }))),
      mcpCompleteOAuth: jest.fn(() => Promise.resolve({}))
    };
    window.api = { post: jest.fn(() => Promise.resolve({})) };
    return window;
  }

  test('Lex.ConnectWizard.open with mcp-server mounts the MCP steps in the drawer', async () => {
    const window = bootOpener(['org_admin'], true);
    const onDone = jest.fn();
    const drawer = window.Lex.ConnectWizard.open({ connectorType: 'mcp-server', onDone });
    await flush();
    expect(drawer.heading).toBe('Add an MCP server');
    expect(drawer.querySelector('lex-mcp-connect-wizard')).not.toBeNull();
    expect(drawer.querySelector('lex-connect-wizard')).toBeNull();
    drawer.dispatchEvent(new window.CustomEvent('lex-close', { bubbles: true }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['flag off', ['system_admin'], false],
    ['organization_admin', ['organization_admin'], true],
    ['member', ['member'], true]
  ])('%s: the drawer explains who can connect MCP servers', async (_label, roles, flag) => {
    const window = bootOpener(roles, flag);
    const drawer = window.Lex.ConnectWizard.open({ connectorType: 'mcp-server' });
    await flush();
    expect(drawer.querySelector('lex-mcp-connect-wizard')).toBeNull();
    expect(drawer.querySelector('.lex-cw-error-text').textContent).toContain('Only system admins and org admins');
    expect(window.Lex.McpConnect.isVisible()).toBe(false);
  });

  test('services: the desktop exchange uses the unchanged oauth/exchange path; web uses oauth/complete', async () => {
    const window = bootOpener(['system_admin'], true);
    await window.Lex.McpConnect.buildServices('electron').exchange({ code: 'c', state: STATE }, 'lana-ai://oauth/callback');
    expect(window.api.post).toHaveBeenCalledWith('/api/v1/integrations/oauth/exchange', expect.objectContaining({
      code: 'c', state: STATE, provider: 'mcp-server', connectorId: 'mcp-server', redirectUri: 'lana-ai://oauth/callback'
    }));
    await window.Lex.McpConnect.buildServices('web').exchange({ code: 'c2', state: STATE }, '');
    expect(window.Connectors.mcpCompleteOAuth).toHaveBeenCalledWith('c2', STATE);
  });

  test('openPanel mounts the server panel', async () => {
    const window = bootOpener(['system_admin'], true);
    const drawer = window.Lex.McpConnect.openPanel({ sourceId: SOURCE_ID, serverName: 'Research' });
    await settle();
    expect(drawer.heading).toBe('Research');
    expect(drawer.querySelector('lex-mcp-server-panel').server.id).toBe(SOURCE_ID);
  });
});

describe('<lex-mcp-connect-wizard> first check fails', () => {
  test('a rejected key: Remove and start over deletes the row and returns to Sign in', async () => {
    const window = boot();
    const { services, calls } = fakeServices({
      test: () => Promise.reject(apiError(502, 'MCP_UNAUTHORIZED', 'The MCP server rejected the credentials'))
    });
    const wizard = await mountWizard(window, services);
    await fillServer(wizard);
    type(wizard, 'token', 'wrong');
    click(wizard, 'next'); await flush();
    click(wizard, 'connect'); await settle();
    expect(wizard.currentStep.id).toBe('test');
    expect(wizard.querySelector('.lex-cw-error-text').textContent).toBe('The MCP server did not accept the sign in.');
    click(wizard, 'start-over'); await settle();
    expect(calls).toContainEqual(['remove', SOURCE_ID]);
    expect(wizard.currentStep.id).toBe('sign_in');
    expect(wizard.server).toBeNull();
    expect(wizard.querySelector('lex-input[data-mcp-field="token"]')).not.toBeNull();
  });
});
