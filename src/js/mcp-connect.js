/*
 * Lex.McpConnect - third-party MCP servers as connectors: opens the MCP
 * steps of the connect wizard and the server panel, each in a lex-drawer,
 * and hands them the backend calls.
 *
 *   Lex.ConnectWizard.open({ connectorType: 'mcp-server', onDone, onOpenServer })
 *     (connect-wizard.js forwards to Lex.McpConnect.openWizard)
 *
 *   Lex.McpConnect.openPanel({
 *     sourceId: '...',                // the server's integration source id
 *     serverName: 'Research server',  // drawer heading while loading
 *     onChanged: function () {}       // a tool, the sign in or the server changed
 *   });
 *
 *   Lex.McpConnect.isVisible()  // MCP_CONNECTORS_ENABLED and system_admin / org_admin
 *
 * OAuth: on the desktop the lana-ai:// deep link callback goes through
 * ConnectorOAuth.exchangeCode (POST /api/v1/integrations/oauth/exchange),
 * unchanged; the backend hands MCP states to the MCP completion. Outside
 * Electron there is no deep link: the backend's web callback finishes the
 * sign in, and a callback payload handed to the screens there is finished
 * with POST /mcp-servers/oauth/complete. Either way the screens poll
 * GET /mcp-servers/:sourceId until the server reports the new sign in, up
 * to two minutes.
 *
 * Needs: api.js, connectors.js, connect-wizard.js (drawer helpers),
 * connect-wizard.model.js, mcp-connect.model.js,
 * shared/connector-oauth-exchange.js, lex-drawer, lex-stepper, lex-modal,
 * lex-badge, lex-mcp-tool-review, lex-mcp-connect-wizard,
 * lex-mcp-server-panel (plus lex-btn, lex-input, lex-radio, lex-toggle,
 * lex-spinner).
 */
(function () {
  'use strict';

  var MCP_STYLESHEET = 'mcp-connect.css';
  var WIZARD_STYLESHEET = 'connect-wizard.css';

  function Model() {
    return window.McpConnectModel;
  }

  function helpers() {
    var wizard = window.Lex && window.Lex.ConnectWizard;
    return (wizard && wizard.helpers) || {};
  }

  function isVisible() {
    return !!(Model() && Model().isVisible(window.LanaConfig, window.Lex && window.Lex.Auth));
  }

  function flowName() {
    var h = helpers();
    var electron = typeof h.isElectronFlow === 'function'
      ? h.isElectronFlow()
      : Boolean(window.isElectron || window.electronAPI || window.location.protocol === 'file:');
    return electron ? 'electron' : 'web';
  }

  function openExternal(url) {
    var h = helpers();
    if (typeof h.openExternal === 'function') {
      h.openExternal(url);
      return;
    }
    if (url) window.open(url, '_blank', 'noopener');
  }

  function ensureStylesheets() {
    var h = helpers();
    if (typeof h.ensureStylesheet !== 'function') return;
    h.ensureStylesheet(WIZARD_STYLESHEET);
    h.ensureStylesheet(MCP_STYLESHEET);
  }

  /** The backend calls the MCP screens use. */
  function buildServices(flow) {
    var C = window.Connectors;
    var api = window.api;
    return {
      discover: function (url) { return C.mcpDiscover(url); },
      create: function (body) { return C.mcpCreateServer(body); },
      getServer: function (sourceId) { return C.mcpGetServer(sourceId); },
      authorize: function (sourceId, which) { return C.mcpAuthorize(sourceId, which || flow); },
      exchange: function (data, redirectUri) {
        if (flow === 'electron') {
          return window.ConnectorOAuth.exchangeCode(api, {
            data: data,
            connectorType: Model().MCP_CONNECTOR_ID,
            redirectUri: redirectUri
          });
        }
        return C.mcpCompleteOAuth(data.code, data.state);
      },
      redirectUri: function () {
        return typeof C.getRedirectUri === 'function'
          ? C.getRedirectUri(Model().MCP_CONNECTOR_ID, flow, 'org')
          : Promise.resolve(null);
      },
      test: function (sourceId) { return C.mcpTestServer(sourceId); },
      setTool: function (sourceId, alias, body) { return C.mcpSetTool(sourceId, alias, body); },
      remove: function (sourceId) { return C.mcpDeleteServer(sourceId); },
      subscribeOAuth: function (handler) {
        return window.ConnectorOAuth ? window.ConnectorOAuth.subscribe(handler) : null;
      },
      openExternal: openExternal
    };
  }

  function showMessage(drawer, message) {
    var root = drawer.contentRoot || drawer;
    root.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'lex-cw-error';
    box.setAttribute('role', 'alert');
    var text = document.createElement('p');
    text.className = 'lex-cw-error-text';
    text.textContent = message;
    box.appendChild(text);
    root.appendChild(box);
  }

  var NOT_ALLOWED = 'Only system admins and org admins can connect MCP servers, and only when MCP servers are turned on.';

  function openDrawer(heading, onClose) {
    var state = { closed: false, drawer: null };
    state.drawer = window.Lex.Drawer.open({
      heading: heading,
      width: 'lg',
      closeOnOverlay: false,
      onClose: function () {
        state.closed = true;
        if (typeof onClose === 'function') onClose();
      }
    });
    state.close = function () {
      if (state.drawer && !state.closed) state.drawer.dispatchEvent(new CustomEvent('lex-close', { bubbles: true }));
    };
    return state;
  }

  /**
   * The MCP steps of the connect wizard. Returns the drawer element.
   * @param {Object} opts - { onDone, onOpenServer({ sourceId }) }
   */
  function openWizard(opts) {
    opts = opts || {};
    ensureStylesheets();
    var state = openDrawer('Add an MCP server', opts.onDone);
    if (!isVisible()) {
      showMessage(state.drawer, NOT_ALLOWED);
      return state.drawer;
    }
    var flow = flowName();
    var wizard = document.createElement('lex-mcp-connect-wizard');
    (state.drawer.contentRoot || state.drawer).appendChild(wizard);
    wizard.start({
      services: buildServices(flow),
      flow: flow,
      onClose: state.close,
      onOpenServer: function (detail) {
        state.close();
        if (typeof opts.onOpenServer === 'function') opts.onOpenServer(detail);
        else if (detail && detail.sourceId) openPanel({ sourceId: detail.sourceId });
      }
    });
    return state.drawer;
  }

  /**
   * The panel for one connected server. Returns the drawer element.
   * @param {Object} opts - { sourceId, serverName, onChanged, onClose }
   */
  function openPanel(opts) {
    opts = opts || {};
    if (!opts.sourceId) throw new Error('sourceId is required');
    ensureStylesheets();
    var state = openDrawer(opts.serverName || 'MCP server', opts.onClose);
    if (!isVisible()) {
      showMessage(state.drawer, NOT_ALLOWED);
      return state.drawer;
    }
    var flow = flowName();
    var panel = document.createElement('lex-mcp-server-panel');
    (state.drawer.contentRoot || state.drawer).appendChild(panel);
    panel.start({
      sourceId: opts.sourceId,
      services: buildServices(flow),
      flow: flow,
      onChanged: function () { if (typeof opts.onChanged === 'function') opts.onChanged(); },
      onClose: state.close
    }).then(function () {
      if (!state.closed && panel.server && panel.server.name) state.drawer.heading = panel.server.name;
    });
    return state.drawer;
  }

  window.Lex = window.Lex || {};
  window.Lex.McpConnect = {
    isVisible: isVisible,
    openWizard: openWizard,
    openPanel: openPanel,
    buildServices: buildServices
  };
})();
