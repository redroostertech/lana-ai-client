'use strict';

// McpConnectModel (src/js/mcp-connect.model.js): the pure view logic for
// third-party MCP servers as connectors.

const path = require('path');
const M = require(path.join(__dirname, '..', '..', 'src', 'js', 'mcp-connect.model.js'));

const auth = (roles) => ({ hasRole: (role) => roles.includes(role) });

describe('visibility', () => {
  test('needs the flag and a role the backend accepts', () => {
    expect(M.isVisible({ MCP_CONNECTORS_ENABLED: true }, auth(['system_admin']))).toBe(true);
    expect(M.isVisible({ MCP_CONNECTORS_ENABLED: true }, auth(['org_admin']))).toBe(true);
    expect(M.isVisible({ MCP_CONNECTORS_ENABLED: false }, auth(['system_admin']))).toBe(false);
    expect(M.isVisible(undefined, auth(['system_admin']))).toBe(false);
    expect(M.isVisible({ MCP_CONNECTORS_ENABLED: true }, null)).toBe(false);
  });

  test.each(['organization_admin', 'admin', 'owner', 'member'])('%s does not see the MCP UI (the backend refuses it)', (role) => {
    expect(M.isVisible({ MCP_CONNECTORS_ENABLED: true }, auth([role]))).toBe(false);
  });

  test('MCP rows are keyed on connector_id mcp-server', () => {
    expect(M.isMcpRow({ connector_id: 'mcp-server' })).toBe(true);
    expect(M.isMcpRow({ connector_type: 'MCP-Server' })).toBe(true);
    expect(M.isMcpRow({ connector_id: 'stripe' })).toBe(false);
    expect(M.isMcpRow(null)).toBe(false);
  });
});

describe('steps per discovery outcome', () => {
  const ids = (steps) => steps.map((s) => s.id);

  test('before discovery the Sign in step is a placeholder', () => {
    expect(ids(M.buildSteps(null))).toEqual(['server', 'sign_in', 'connect', 'test', 'review', 'done']);
  });

  test('oauth with dynamic registration: just "Sign in with <host>"', () => {
    const discovery = { auth: 'oauth', registration: 'dynamic', authorization_server: 'https://auth.example.com/' };
    const plan = M.signInPlan(discovery, 'https://mcp.example.com/mcp');
    expect(plan).toEqual({ kind: 'oauth_dynamic', signInHost: 'auth.example.com' });
    expect(M.signInFields(plan)).toEqual([]);
    expect(M.authModeFor(plan)).toBe('oauth');
    expect(ids(M.buildSteps(discovery))).toContain('sign_in');
  });

  test('oauth with manual registration: client ID and a password secret', () => {
    const plan = M.signInPlan({ auth: 'oauth', registration: 'manual', authorization_server: null }, 'https://mcp.example.com/mcp');
    expect(plan).toEqual({ kind: 'oauth_manual', signInHost: 'mcp.example.com' });
    const fields = M.signInFields(plan);
    expect(fields.map((f) => [f.name, f.input, f.required])).toEqual([['client_id', 'text', true], ['client_secret', 'password', false]]);
  });

  test('bearer_or_header: bearer token, or header name plus a password value', () => {
    const plan = M.signInPlan({ auth: 'bearer_or_header' }, 'https://mcp.example.com');
    expect(plan.kind).toBe('token');
    expect(M.signInFields(plan, 'bearer').map((f) => [f.name, f.input])).toEqual([['token', 'password']]);
    expect(M.signInFields(plan, 'header').map((f) => [f.name, f.input])).toEqual([['header_name', 'text'], ['token', 'password']]);
    expect(M.authModeFor(plan, 'bearer')).toBe('bearer');
    expect(M.authModeFor(plan, 'header')).toBe('header');
  });

  test('none: no Sign in step and no fields', () => {
    const discovery = { auth: 'none' };
    expect(ids(M.buildSteps(discovery))).toEqual(['server', 'connect', 'test', 'review', 'done']);
    expect(M.signInFields(M.signInPlan(discovery))).toEqual([]);
    expect(M.authModeFor(M.signInPlan(discovery))).toBe('none');
  });

  test('missing fields are reported by label', () => {
    const fields = M.signInFields(M.signInPlan({ auth: 'bearer_or_header' }), 'header');
    expect(M.missingFields(fields, { header_name: '  ' })).toEqual(['Header name', 'Header value']);
    expect(M.missingFields(fields, { header_name: 'X-Key', token: 't' })).toEqual([]);
  });

  test('a create error on a field goes back to its step', () => {
    expect(M.stepForErrorField('url')).toBe('server');
    expect(M.stepForErrorField('token')).toBe('sign_in');
    expect(M.stepForErrorField('client_id')).toBe('sign_in');
    expect(M.stepForErrorField('')).toBe('');
  });

  test('stepper items match the connect wizard shape', () => {
    const items = M.buildStepperItems(M.buildSteps(null), 1, -1, 2);
    expect(items.slice(0, 3)).toEqual([
      { id: 'server', label: 'Server', state: 'done' },
      { id: 'sign_in', label: 'Sign in', state: 'current' },
      { id: 'connect', label: 'Connect', state: 'upcoming' }
    ]);
  });
});

describe('create body and secrets', () => {
  const values = { name: ' Research ', url: ' https://mcp.example.com/mcp ', token: ' sk-1 ', header_name: ' X-Key ', client_id: ' cid ', client_secret: 'shh' };

  test('only the fields the chosen mode uses', () => {
    expect(M.buildCreatePayload({ values, plan: { kind: 'oauth_dynamic' } }))
      .toEqual({ name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'oauth' });
    expect(M.buildCreatePayload({ values, plan: { kind: 'oauth_manual' } }))
      .toEqual({ name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'oauth', client_id: 'cid', client_secret: 'shh' });
    expect(M.buildCreatePayload({ values: Object.assign({}, values, { client_secret: '' }), plan: { kind: 'oauth_manual' } }))
      .not.toHaveProperty('client_secret');
    expect(M.buildCreatePayload({ values, plan: { kind: 'token' }, method: 'bearer' }))
      .toEqual({ name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'bearer', token: 'sk-1' });
    expect(M.buildCreatePayload({ values, plan: { kind: 'token' }, method: 'header' }))
      .toEqual({ name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'header', token: 'sk-1', header_name: 'X-Key' });
    expect(M.buildCreatePayload({ values, plan: { kind: 'none' } }))
      .toEqual({ name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'none' });
  });

  test('sanitizeForLog hides the token and the client secret', () => {
    const body = M.buildCreatePayload({ values, plan: { kind: 'oauth_manual' } });
    const logged = JSON.stringify(M.sanitizeForLog(Object.assign({}, body, { token: 'sk-1' })));
    expect(logged).not.toContain('shh');
    expect(logged).not.toContain('sk-1');
    expect(logged).toContain('cid');
  });
});

describe('errors', () => {
  const apiError = (status, code, message, field) => Object.assign(new Error(message), {
    status, code, data: { error: { code, message, field } }
  });

  test('known codes get a plain message, with the backend message as detail', () => {
    const d = M.describeError(apiError(400, 'MCP_URL_REFUSED', 'The URL points at a private address'));
    expect(d.message).toBe('LANA can only connect to public https addresses.');
    expect(d.detail).toBe('The URL points at a private address');
    expect(M.describeError(apiError(502, 'MCP_TIMEOUT', 'The MCP server did not answer in time')).message)
      .toBe('The MCP server did not answer in time. Try again in a moment.');
  });

  test('a validation error shows the backend message and its field', () => {
    const d = M.describeError(apiError(400, 'VALIDATION_ERROR', 'A token is required for this sign-in mode', 'token'));
    expect(d).toEqual({ message: 'A token is required for this sign-in mode', detail: '', code: 'VALIDATION_ERROR', field: 'token' });
  });

  test('flag off (404 without a code) and non-admin (403)', () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404, data: { success: false, error: 'NOT_FOUND', message: 'Not found' } });
    expect(M.describeError(notFound)).toMatchObject({ message: 'MCP servers are not turned on for this LANA server.', detail: '' });
    const forbidden = Object.assign(new Error('Admin access required'), { status: 403, data: { error: 'FORBIDDEN' } });
    expect(M.describeError(forbidden)).toMatchObject({ message: 'Only system admins and org admins can connect MCP servers.', detail: '' });
    const missing = apiError(404, 'NOT_FOUND', 'MCP server not found');
    expect(M.describeError(missing).message).toBe('MCP server not found');
  });

  test('reauthorize vs tool conflict', () => {
    const reauth = apiError(409, 'MCP_REAUTHORIZE_REQUIRED', 'The MCP server needs to be signed in again');
    const conflict = apiError(409, 'CONFLICT', 'The tool changed since you reviewed it. Review it again.');
    expect(M.isReauthorizeError(reauth)).toBe(true);
    expect(M.isToolConflict(reauth)).toBe(false);
    expect(M.isToolConflict(conflict)).toBe(true);
    expect(M.isToolConflict(apiError(400, 'VALIDATION_ERROR', 'x'))).toBe(false);
  });
});

describe('server status and sign in', () => {
  test('status labels and Data Connectors keys', () => {
    expect(M.statusView({ auth_status: 'connected' })).toEqual({ label: 'Connected', color: 'green' });
    expect(M.statusView({ auth_status: 'expired' })).toEqual({ label: 'Sign in again', color: 'red' });
    expect(M.tableStatusKey({ auth_status: 'connected' })).toBe('connected');
    expect(M.tableStatusKey({ auth_status: 'expired' })).toBe('disconnected');
    expect(M.tableStatusKey({ auth_status: 'pending_authorization' })).toBe('not_connected');
    expect(M.tableStatusKey({})).toBe('not_connected');
  });

  test('Sign in again is offered for OAuth servers that are not connected', () => {
    expect(M.needsReconnect({ auth_mode: 'oauth', auth_status: 'expired' })).toBe(true);
    expect(M.needsReconnect({ auth_mode: 'oauth', auth_status: 'connected' })).toBe(false);
    expect(M.needsReconnect({ auth_mode: 'bearer', auth_status: 'expired' })).toBe(false);
  });

  test('a reconnect waits for a new sign in, not the old connected state', () => {
    const before = M.oauthSnapshot({ auth_status: 'connected', updated_at: 't1', credentials: { access_token_expires_at: 'e1' } });
    expect(M.signInFinished(before, { auth_status: 'connected', updated_at: 't1', credentials: { access_token_expires_at: 'e1' } })).toBe(false);
    expect(M.signInFinished(before, { auth_status: 'connected', updated_at: 't2', credentials: { access_token_expires_at: 'e1' } })).toBe(true);
    const fresh = M.oauthSnapshot({ auth_status: 'pending_authorization', updated_at: 't1' });
    expect(M.signInFinished(fresh, { auth_status: 'pending_authorization' })).toBe(false);
    expect(M.signInFinished(fresh, { auth_status: 'connected', updated_at: 't1' })).toBe(true);
  });

  test('a server row for the connector table', () => {
    const row = M.serverToConnectorRow({ id: 'abc', name: 'Research', url: 'https://mcp.example.com/mcp', auth_mode: 'bearer',
      auth_status: 'connected', server_info: { version: '1.2.0' }, created_at: '2026-10-30T00:00:00Z' });
    expect(row).toMatchObject({ id: 'abc', connector_id: 'mcp-server', name: 'Research', vendor: 'mcp.example.com', category: 'mcp',
      auth_type: 'bearer', connector_scope: 'org', status: 'connected', version: '1.2.0', mcp_server: true });
  });
});

describe('test result and tools', () => {
  test('summary: name, version, tool count, truncated warning, changes', () => {
    const s = M.testSummary({ server: { name: 'acme-mcp', version: '0.4' }, truncated: true, tools: [{}, {}],
      changes: { added: ['a'], disabled_changed: ['b', 'c'], disabled_not_listed: [], skipped_invalid: 1 } });
    expect(s.serverName).toBe('acme-mcp');
    expect(s.toolCountText).toBe('2 tools found.');
    expect(s.truncatedText).toContain('more tools than LANA reads');
    expect(s.changes).toEqual([
      '1 new tool, off until you turn it on.',
      '2 tools were turned off because they changed since you approved them.',
      '1 tool was skipped because the server described it in a way LANA cannot use.'
    ]);
    expect(M.testSummary({ tools: [] }).toolCountText).toBe('The server did not list any tools.');
    expect(M.changesSummary({ added: [], disabled_changed: [], disabled_not_listed: [], skipped_invalid: 0 })).toEqual([]);
  });

  test('a tool row: title, name, provided by, hints as claims, notes', () => {
    const view = M.toolView({ alias: 'r_search', tool_name: 'search', title: 'Search docs', description: 'Finds <b>docs</b>',
      annotations: { readOnlyHint: true, destructiveHint: true }, enabled: false, disabled_reason: 'changed_since_approval', current_hash: 'h' }, 'Research');
    expect(view).toMatchObject({ title: 'Search docs', toolName: 'search', showToolName: true, providedBy: 'Provided by Research',
      hints: ['Says it only reads', 'Says it can change or delete data'], external: true, enabled: false, canEnable: true,
      note: 'Changed since you approved it. Review and turn on again.' });
    expect(M.toolView({ tool_name: 'x', disabled_reason: 'not_listed', current_hash: 'h' }).canEnable).toBe(false);
    expect(M.toolView({ tool_name: 'x' }).showToolName).toBe(false);
  });

  test('enabling sends the reviewed hash; disabling does not', () => {
    expect(M.toolTogglePayload({ current_hash: 'abc' }, true)).toEqual({ enabled: true, expected_hash: 'abc' });
    expect(M.toolTogglePayload({ current_hash: 'abc' }, false)).toEqual({ enabled: false });
    expect(M.toolTogglePayload({}, true)).toEqual({ enabled: true });
  });

  test('replace and count', () => {
    const tools = [{ alias: 'a', enabled: false }, { alias: 'b', enabled: true }];
    const next = M.replaceTool(tools, { alias: 'a', enabled: true });
    expect(M.enabledCount(next)).toBe(2);
    expect(M.enabledCount(tools)).toBe(1);
  });
});
