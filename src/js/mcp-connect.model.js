/*
 * McpConnectModel - pure view logic for third-party MCP servers as
 * connectors: the add-server steps, the sign in fields each discovery answer
 * needs, the create body, plain error messages, the tool review rows and the
 * Data Connectors row of a server.
 *
 * The backend (/api/v1/integrations/mcp-servers) is the source of truth. It
 * checks the URL, runs discovery again on create, refuses auth modes that do
 * not match, keeps every tool off until an admin approves it and asks for
 * approval on every call. This module only maps its answers to what the
 * screens show; it re-implements none of those rules.
 *
 * Secrets (token, client_secret) pass through buildCreatePayload only, the
 * request body. sanitizeForLog is the one way to put values into a log line.
 *
 * No DOM, no network. Loaded as a browser global (window.McpConnectModel)
 * and as a CommonJS module for Jest.
 */
(function (global) {
  'use strict';

  var MCP_CONNECTOR_ID = 'mcp-server';

  // The roles the backend accepts (mcp-servers.middleware.js). Lex.Auth's
  // isOrgAdmin() also counts organization_admin, which the backend refuses,
  // so visibility checks these two roles by name.
  var ADMIN_ROLES = ['system_admin', 'org_admin'];

  var SECRET_FIELDS = ['token', 'client_secret'];

  var TOOL_APPROVAL_NOTE = 'Every time LANA wants to use one of these tools, it will ask you first.';

  var TOKEN_METHODS = [
    { value: 'bearer', label: 'Bearer token', description: 'LANA sends the token as Authorization: Bearer.' },
    { value: 'header', label: 'Custom header', description: 'LANA sends the value in a header the server names.' }
  ];

  var ERROR_MESSAGES = {
    MCP_URL_REFUSED: 'LANA can only connect to public https addresses.',
    MCP_URL_ALLOWLIST: 'LANA can only connect to public https addresses.',
    MCP_CONNECT_FAILED: 'LANA could not reach the MCP server. Check the address and try again.',
    MCP_TIMEOUT: 'The MCP server did not answer in time. Try again in a moment.',
    MCP_UNAUTHORIZED: 'The MCP server did not accept the sign in.',
    MCP_FORBIDDEN: 'The MCP server refused access.',
    MCP_PROTOCOL_ERROR: 'The server did not answer like an MCP server. Check the address.',
    MCP_RESPONSE_TOO_LARGE: 'The MCP server sent more data than LANA accepts.',
    MCP_CREDENTIAL_MISSING: 'No sign in is saved for this server. Remove it and add it again.',
    MCP_REAUTHORIZE_REQUIRED: 'Sign in to this server again to keep using it.'
  };

  var STATUS_VIEWS = {
    connected: { label: 'Connected', color: 'green' },
    pending_authorization: { label: 'Waiting for sign in', color: 'yellow' },
    configured: { label: 'Not checked yet', color: 'gray' },
    expired: { label: 'Sign in again', color: 'red' },
    disconnected: { label: 'Disconnected', color: 'red' }
  };

  var AUTH_MODE_LABELS = {
    oauth: 'OAuth sign in',
    bearer: 'Bearer token',
    header: 'Custom header',
    none: 'No sign in'
  };

  // connector-table.js auth vocabulary for a server row.
  var TABLE_AUTH_TYPES = { oauth: 'oauth2', bearer: 'bearer', header: 'header', none: 'none' };

  function str(value) {
    return value == null ? '' : String(value);
  }

  function lower(value) {
    return str(value).trim().toLowerCase();
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function wizardModel() {
    if (global && global.ConnectWizardModel) return global.ConnectWizardModel;
    if (typeof require === 'function') {
      try {
        return require('./connect-wizard.model.js');
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  // ── Visibility ──────────────────────────────────────────────────────

  /**
   * Whether this user sees the MCP UI: the client flag is on and the user
   * holds a role the backend accepts. UI gating only; the backend enforces.
   * @param {Object} config - window.LanaConfig
   * @param {Object} auth - Lex.Auth (hasRole)
   */
  function isVisible(config, auth) {
    if (!config || config.MCP_CONNECTORS_ENABLED !== true) return false;
    if (!auth || typeof auth.hasRole !== 'function') return false;
    for (var i = 0; i < ADMIN_ROLES.length; i++) {
      if (auth.hasRole(ADMIN_ROLES[i])) return true;
    }
    return false;
  }

  function isMcpRow(connector) {
    var row = connector || {};
    return lower(row.connector_id || row.connector_type) === MCP_CONNECTOR_ID;
  }

  // ── Addresses ───────────────────────────────────────────────────────

  /** The host of a URL for display ('mcp.example.com'), or ''. */
  function hostLabel(url) {
    try {
      return new URL(str(url).trim()).host;
    } catch (_error) {
      return '';
    }
  }

  // ── Sign in ─────────────────────────────────────────────────────────

  /**
   * What the Sign in step needs, from the discovery answer.
   * @returns {{kind: 'oauth_dynamic'|'oauth_manual'|'token'|'none', signInHost: string}}
   */
  function signInPlan(discovery, serverUrl) {
    var found = discovery || {};
    var auth = lower(found.auth);
    var host = hostLabel(found.authorization_server) || hostLabel(serverUrl);
    if (auth === 'oauth') {
      return { kind: lower(found.registration) === 'manual' ? 'oauth_manual' : 'oauth_dynamic', signInHost: host };
    }
    if (auth === 'bearer_or_header') return { kind: 'token', signInHost: host };
    return { kind: 'none', signInHost: host };
  }

  /** The auth_mode the create body sends for a plan and token method. */
  function authModeFor(plan, method) {
    var kind = plan && plan.kind;
    if (kind === 'oauth_dynamic' || kind === 'oauth_manual') return 'oauth';
    if (kind === 'token') return method === 'header' ? 'header' : 'bearer';
    return 'none';
  }

  /**
   * The fields of the Sign in step. Secrets render as password inputs.
   * @returns {Array<{name, label, input, required, secret, help}>}
   */
  function signInFields(plan, method) {
    var kind = plan && plan.kind;
    if (kind === 'oauth_manual') {
      return [
        { name: 'client_id', label: 'Client ID', input: 'text', required: true, secret: false,
          help: 'From the server\'s administrator. This server does not let LANA register itself.' },
        { name: 'client_secret', label: 'Client secret', input: 'password', required: false, secret: true,
          help: 'Leave empty if the server did not give you one.' }
      ];
    }
    if (kind === 'token' && method === 'header') {
      return [
        { name: 'header_name', label: 'Header name', input: 'text', required: true, secret: false,
          help: 'The header the server reads, for example X-API-Key.' },
        { name: 'token', label: 'Header value', input: 'password', required: true, secret: true, help: '' }
      ];
    }
    if (kind === 'token') {
      return [{ name: 'token', label: 'Bearer token', input: 'password', required: true, secret: true, help: '' }];
    }
    return [];
  }

  function isBlank(value) {
    return value == null || str(value).trim() === '';
  }

  /** Labels of required fields that are still empty. */
  function missingFields(fields, values) {
    var supplied = values || {};
    return (fields || []).filter(function (field) {
      return field.required && isBlank(supplied[field.name]);
    }).map(function (field) { return field.label; });
  }

  // ── Steps ───────────────────────────────────────────────────────────

  /**
   * The add-server steps. Before discovery the Sign in step is shown as a
   * placeholder; a server that asks for no sign in drops it.
   * @param {Object|null} discovery
   * @param {string} [serverUrl]
   */
  function buildSteps(discovery, serverUrl) {
    var plan = discovery ? signInPlan(discovery, serverUrl) : null;
    var steps = [{ id: 'server', title: 'Server' }];
    if (!plan || plan.kind !== 'none') steps.push({ id: 'sign_in', title: 'Sign in' });
    steps.push(
      { id: 'connect', title: 'Connect' },
      { id: 'test', title: 'Test' },
      { id: 'review', title: 'Review tools' },
      { id: 'done', title: 'Done' }
    );
    return steps;
  }

  function stepIndex(steps, id) {
    for (var i = 0; i < (steps || []).length; i++) {
      if (steps[i].id === id) return i;
    }
    return -1;
  }

  /** The step to send the user back to for a create error on a field. */
  function stepForErrorField(field) {
    var name = lower(field);
    if (name === 'url' || name === 'name') return 'server';
    if (name === 'token' || name === 'header_name' || name === 'client_id' || name === 'client_secret' || name === 'auth_mode') {
      return 'sign_in';
    }
    return '';
  }

  /** Items for <lex-stepper>, the same shape the connect wizard uses. */
  function buildStepperItems(steps, currentIndex, errorIndex, furthestIndex) {
    var shared = wizardModel();
    if (shared && typeof shared.buildStepperItems === 'function') {
      return shared.buildStepperItems(steps, currentIndex, errorIndex, furthestIndex);
    }
    var furthest = Math.max(typeof furthestIndex === 'number' ? furthestIndex : currentIndex, currentIndex);
    return (steps || []).map(function (step, index) {
      var state = 'upcoming';
      if (index === errorIndex) state = 'error';
      else if (index === currentIndex) state = 'current';
      else if (index < furthest) state = 'done';
      return { id: step.id, label: step.title, state: state };
    });
  }

  // ── Create ──────────────────────────────────────────────────────────

  /**
   * POST /mcp-servers body. Sends only the fields the chosen mode uses.
   * @param {Object} params
   * @param {Object} params.values - name, url, client_id, client_secret, token, header_name
   * @param {Object} params.plan - signInPlan()
   * @param {string} [params.method] - 'bearer' | 'header' for a token plan
   */
  function buildCreatePayload(params) {
    var values = (params && params.values) || {};
    var plan = (params && params.plan) || { kind: 'none' };
    var mode = authModeFor(plan, params && params.method);
    var body = { name: str(values.name).trim(), url: str(values.url).trim(), auth_mode: mode };
    if (mode === 'oauth' && plan.kind === 'oauth_manual') {
      body.client_id = str(values.client_id).trim();
      if (!isBlank(values.client_secret)) body.client_secret = str(values.client_secret).trim();
    }
    if (mode === 'bearer' || mode === 'header') body.token = str(values.token).trim();
    if (mode === 'header') body.header_name = str(values.header_name).trim();
    return body;
  }

  /** A copy that is safe to log: secrets are replaced at any depth. */
  function sanitizeForLog(value) {
    var shared = wizardModel();
    if (shared && typeof shared.sanitizeForLog === 'function') return shared.sanitizeForLog(value, SECRET_FIELDS);
    if (!isObject(value)) return value;
    var out = {};
    Object.keys(value).forEach(function (key) {
      out[key] = SECRET_FIELDS.indexOf(key) !== -1 && !isBlank(value[key]) ? '[redacted]' : value[key];
    });
    return out;
  }

  // ── Errors ──────────────────────────────────────────────────────────

  function errorCode(error) {
    var e = error || {};
    var data = e.data || {};
    return str(e.code || data.code || (isObject(data.error) && data.error.code) || '');
  }

  function errorField(error) {
    var data = (error && error.data) || {};
    return str((isObject(data.error) && data.error.field) || data.field || '');
  }

  /**
   * What to show for a failed call: a plain message for known codes, plus
   * the backend's own message when it says more.
   * @returns {{message: string, detail: string, code: string, field: string}}
   */
  function describeError(error, fallback) {
    var e = error || {};
    var code = errorCode(e);
    var status = Number(e.status) || 0;
    var backend = str(e.message).trim();
    var plain = ERROR_MESSAGES[code] || '';
    if (!plain && status === 404 && !code.length) plain = 'MCP servers are not turned on for this LANA server.';
    if (!plain && status === 403) plain = 'Only system admins and org admins can connect MCP servers.';
    if (!plain) {
      return { message: backend || str(fallback || 'Something went wrong.'), detail: '', code: code, field: errorField(e) };
    }
    var detail = backend && backend !== plain && backend !== 'Not found' && backend !== 'Admin access required' ? backend : '';
    return { message: plain, detail: detail, code: code, field: errorField(e) };
  }

  function isReauthorizeError(error) {
    return errorCode(error) === 'MCP_REAUTHORIZE_REQUIRED';
  }

  /** A 409 on a tool toggle: the tool changed or is no longer listed. */
  function isToolConflict(error) {
    return Number(error && error.status) === 409 && !isReauthorizeError(error);
  }

  // ── Server status ───────────────────────────────────────────────────

  function statusView(server) {
    var status = lower(server && server.auth_status);
    return STATUS_VIEWS[status] || { label: status ? status.split('_').join(' ') : 'Unknown', color: 'gray' };
  }

  function authModeLabel(mode) {
    return AUTH_MODE_LABELS[lower(mode)] || 'Unknown';
  }

  /** Whether the panel offers Sign in again (OAuth servers only). */
  function needsReconnect(server) {
    var s = server || {};
    if (lower(s.auth_mode) !== 'oauth') return false;
    return lower(s.auth_status) !== 'connected';
  }

  /**
   * What a sign in poll compares, taken before authorize, so a reconnect of
   * a server that is already connected waits for the new sign in.
   */
  function oauthSnapshot(server) {
    var s = server || {};
    var credentials = s.credentials || {};
    return {
      auth_status: lower(s.auth_status),
      updated_at: str(s.updated_at),
      access_token_expires_at: str(credentials.access_token_expires_at)
    };
  }

  function signInFinished(before, server) {
    var now = oauthSnapshot(server);
    if (now.auth_status !== 'connected') return false;
    var was = before || {};
    if (was.auth_status !== 'connected') return true;
    return now.updated_at !== str(was.updated_at) || now.access_token_expires_at !== str(was.access_token_expires_at);
  }

  // ── Test result ─────────────────────────────────────────────────────

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function listLength(value) {
    return Array.isArray(value) ? value.length : (Number(value) || 0);
  }

  /** Lines describing what a re-check changed. Empty when nothing did. */
  function changesSummary(changes) {
    var c = changes || {};
    var lines = [];
    var added = listLength(c.added);
    var changed = listLength(c.disabled_changed);
    var gone = listLength(c.disabled_not_listed);
    var skipped = listLength(c.skipped_invalid);
    if (added) lines.push(plural(added, 'new tool, off until you turn it on.', 'new tools, off until you turn them on.'));
    if (changed) lines.push(plural(changed, 'tool was turned off because it changed since you approved it.', 'tools were turned off because they changed since you approved them.'));
    if (gone) lines.push(plural(gone, 'tool was turned off because the server no longer lists it.', 'tools were turned off because the server no longer lists them.'));
    if (skipped) lines.push(plural(skipped, 'tool was skipped because the server described it in a way LANA cannot use.', 'tools were skipped because the server described them in a way LANA cannot use.'));
    return lines;
  }

  /** The Test step and the panel's check result. */
  function testSummary(result) {
    var r = result || {};
    var server = r.server || {};
    var tools = Array.isArray(r.tools) ? r.tools : [];
    var count = tools.length;
    return {
      serverName: str(server.name),
      serverVersion: str(server.version),
      toolCount: count,
      toolCountText: count ? plural(count, 'tool', 'tools') + ' found.' : 'The server did not list any tools.',
      truncated: r.truncated === true,
      truncatedText: r.truncated === true ? 'The server listed more tools than LANA reads. Only the first ones are shown.' : '',
      changes: changesSummary(r.changes)
    };
  }

  // ── Tools ───────────────────────────────────────────────────────────

  /** Hints from the tool's annotations, phrased as what the server claims. */
  function toolHints(annotations) {
    var a = isObject(annotations) ? annotations : {};
    var hints = [];
    if (a.readOnlyHint === true) hints.push('Says it only reads');
    if (a.destructiveHint === true) hints.push('Says it can change or delete data');
    return hints;
  }

  function disabledNote(tool) {
    var reason = lower(tool && tool.disabled_reason);
    if (tool && tool.enabled) return '';
    if (reason === 'changed_since_approval') return 'Changed since you approved it. Review and turn on again.';
    if (reason === 'not_listed') return 'The server no longer lists this tool. Check tools again before turning it on.';
    return '';
  }

  /**
   * One review row. Every string here comes from the remote server and is
   * rendered as escaped text only.
   */
  function toolView(tool, serverName) {
    var t = tool || {};
    var title = str(t.title).trim() || str(t.tool_name);
    return {
      alias: str(t.alias),
      title: title,
      toolName: str(t.tool_name),
      showToolName: str(t.tool_name) !== '' && str(t.tool_name) !== title,
      description: str(t.description),
      providedBy: 'Provided by ' + (str(serverName).trim() || 'the server'),
      hints: toolHints(t.annotations),
      external: t.external !== false,
      enabled: t.enabled === true,
      note: disabledNote(t),
      canEnable: lower(t.disabled_reason) !== 'not_listed' && !!t.current_hash
    };
  }

  /** PATCH /tools/:alias body. Enabling approves exactly the hash reviewed. */
  function toolTogglePayload(tool, enabled) {
    if (!enabled) return { enabled: false };
    var body = { enabled: true };
    if (tool && tool.current_hash) body.expected_hash = str(tool.current_hash);
    return body;
  }

  function replaceTool(tools, updated) {
    var next = (tools || []).slice();
    for (var i = 0; i < next.length; i++) {
      if (next[i] && updated && next[i].alias === updated.alias) {
        next[i] = updated;
        return next;
      }
    }
    return next;
  }

  function enabledCount(tools) {
    return (tools || []).filter(function (t) { return t && t.enabled === true; }).length;
  }

  // ── Data Connectors row ─────────────────────────────────────────────

  /** Data Connectors status key for a server row. */
  function tableStatusKey(server) {
    var status = lower(server && server.auth_status);
    if (status === 'connected') return 'connected';
    if (status === 'expired' || status === 'disconnected') return 'disconnected';
    return 'not_connected';
  }

  /** A connector-shaped row for the Data Connectors table. */
  function serverToConnectorRow(server) {
    var s = server || {};
    var info = s.server_info || {};
    return {
      id: str(s.id),
      connector_id: MCP_CONNECTOR_ID,
      connector_type: MCP_CONNECTOR_ID,
      name: str(s.name) || 'MCP server',
      vendor: hostLabel(s.url),
      description: 'MCP server at ' + (hostLabel(s.url) || 'an unknown address'),
      category: 'mcp',
      auth_type: TABLE_AUTH_TYPES[lower(s.auth_mode)] || 'unknown',
      connector_scope: 'org',
      status: tableStatusKey(s),
      version: str(info.version),
      created_at: str(s.created_at),
      logo_url: null,
      mcp_server: true
    };
  }

  var api = {
    MCP_CONNECTOR_ID: MCP_CONNECTOR_ID,
    ADMIN_ROLES: ADMIN_ROLES,
    SECRET_FIELDS: SECRET_FIELDS,
    TOKEN_METHODS: TOKEN_METHODS,
    TOOL_APPROVAL_NOTE: TOOL_APPROVAL_NOTE,
    ERROR_MESSAGES: ERROR_MESSAGES,
    isVisible: isVisible,
    isMcpRow: isMcpRow,
    hostLabel: hostLabel,
    signInPlan: signInPlan,
    authModeFor: authModeFor,
    signInFields: signInFields,
    missingFields: missingFields,
    buildSteps: buildSteps,
    stepIndex: stepIndex,
    stepForErrorField: stepForErrorField,
    buildStepperItems: buildStepperItems,
    buildCreatePayload: buildCreatePayload,
    sanitizeForLog: sanitizeForLog,
    describeError: describeError,
    isReauthorizeError: isReauthorizeError,
    isToolConflict: isToolConflict,
    statusView: statusView,
    authModeLabel: authModeLabel,
    needsReconnect: needsReconnect,
    oauthSnapshot: oauthSnapshot,
    signInFinished: signInFinished,
    changesSummary: changesSummary,
    testSummary: testSummary,
    toolHints: toolHints,
    toolView: toolView,
    toolTogglePayload: toolTogglePayload,
    replaceTool: replaceTool,
    enabledCount: enabledCount,
    tableStatusKey: tableStatusKey,
    serverToConnectorRow: serverToConnectorRow
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.McpConnectModel = api;
  }
})(typeof window !== 'undefined' ? window : this);
