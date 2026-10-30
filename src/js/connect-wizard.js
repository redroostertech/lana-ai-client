/*
 * Lex.ConnectWizard - opens the Guided Connect wizard in a drawer.
 *
 *   Lex.ConnectWizard.open({
 *     connectorType: 'stripe',          // catalog slug (required)
 *     connectorName: 'Stripe',          // drawer heading while loading
 *     source: row,                      // GET /connectors item, when known
 *     newInstance: false,               // add another instance (multi instance)
 *     onDone: function () {},           // the drawer closed (refresh lists)
 *     onAdvanced: function ({ sourceId }) {},      // open the connector viewer
 *     onOpenConnector: function ({ sourceId }) {}  // "Open connector" on Done
 *   });
 *
 * connectorType 'mcp-server' (a third-party MCP server) opens the MCP steps
 * instead, through Lex.McpConnect.openWizard (js/mcp-connect.js); it takes
 * onDone and onOpenServer({ sourceId }).
 *
 * Loads what the wizard model needs (the connector package, the redirect URI,
 * LANA managed OAuth availability, the personal connection availability) and
 * hands <lex-connect-wizard> the backend calls. Used by Data Connectors and,
 * later, the chat connector card.
 *
 * Needs: api.js, connectors.js, connect-wizard.model.js,
 * shared/connector-oauth-exchange.js, lex-drawer, lex-stepper,
 * lex-connect-wizard (plus lex-btn, lex-input, lex-select, lex-toggle,
 * lex-radio, lex-spinner).
 */
(function () {
  'use strict';

  var STYLESHEET_NAME = 'connect-wizard.css';
  var MCP_CONNECTOR_ID = 'mcp-server';
  var scriptSrc = (document.currentScript && document.currentScript.src) || '';

  function isEnabled() {
    return !!(window.LanaConfig && window.LanaConfig.CONNECT_WIZARD_ENABLED === true);
  }

  // Pages that do not link a css/components stylesheet get it from the
  // css folder next to this script's js folder.
  function ensureStylesheet(name) {
    var file = name || STYLESHEET_NAME;
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.slice(-file.length) === file) return;
    }
    var marker = 'js/connect-wizard.js';
    var at = scriptSrc.lastIndexOf(marker);
    if (at === -1) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = scriptSrc.slice(0, at) + 'css/components/' + file;
    document.head.appendChild(link);
  }

  function isElectronFlow() {
    return Boolean(window.isElectron || window.electronAPI || window.location.protocol === 'file:');
  }

  function openExternal(url) {
    if (!url) return;
    if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
      window.electronAPI.invoke('open-external-url', url).catch(function (error) {
        console.error('[ConnectWizard] Failed to open external URL:', error && error.message);
      });
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function canManageCredentials() {
    // The client has no read of the connector policy, so admin pages access
    // stands in for connectors:credentials_manage. The backend still enforces.
    return !!(window.Lex && window.Lex.Auth && window.Lex.Auth.canAccessAdminPages && window.Lex.Auth.canAccessAdminPages());
  }

  function scopeOf(connector) {
    return window.ConnectWizardModel.normalizeScope(
      connector.connector_scope || connector.scope || (connector.metadata && connector.metadata.scope)
    );
  }

  function needsRedirect(connector) {
    var auth = connector.auth || {};
    var type = String(auth.type || '').toLowerCase();
    if (type === 'oauth2' || type === 'oauth2_or_api_key') return true;
    var text = JSON.stringify((connector.documentation && connector.documentation.setup_guide) || {});
    return text.indexOf(window.ConnectWizardModel.REDIRECT_TOKEN) !== -1;
  }

  function findSource(connectorType, list) {
    var rows = Array.isArray(list) ? list : [];
    var type = String(connectorType || '').toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var slug = String(row.connector_id || row.connector_type || '').toLowerCase();
      if (slug === type && row.id && window.Connectors.helpers.looksLikeUuid(row.id)) return row;
    }
    return null;
  }

  function loadInput(opts) {
    var type = opts.connectorType;
    var flow = isElectronFlow() ? 'electron' : 'web';

    return window.Connectors.getCatalogPackage(type).then(function (catalog) {
      var connector = (catalog && catalog.connector) || {};
      var scope = scopeOf(connector);
      var canManage = canManageCredentials();
      var authType = String((connector.auth && connector.auth.type) || '').toLowerCase();
      var oauthLike = authType === 'oauth2' || authType === 'oauth2_or_api_key';

      var redirect = needsRedirect(connector)
        ? window.Connectors.getRedirectUri(type, flow, scope).catch(function (error) {
          return error && error.status === 403 ? { status: 'forbidden' } : { status: 'error' };
        })
        : Promise.resolve(null);

      var oauthApp = scope === 'org' && oauthLike && canManage
        ? window.Connectors.getBridgeConfig(type).then(function (config) {
          return {
            lana_managed_available: !!(config && config.lana_managed_available),
            credential_source: (config && config.credential_source) || ''
          };
        }).catch(function () { return null; })
        : Promise.resolve(null);

      var userConnection = scope === 'user'
        ? window.api.getUserConnections().then(function (payload) {
          var available = (payload && payload.available) || [];
          for (var i = 0; i < available.length; i++) {
            if (available[i] && available[i].connector_id === type) return available[i];
          }
          return null;
        }).catch(function () { return null; })
        : Promise.resolve(null);

      var source = opts.source && opts.source.id && window.Connectors.helpers.looksLikeUuid(opts.source.id)
        ? Promise.resolve(opts.source)
        : window.Connectors.getAll().then(function (data) {
          return findSource(type, data && data.connectors);
        }).catch(function () { return null; });

      return Promise.all([redirect, oauthApp, userConnection, source]).then(function (results) {
        return {
          catalog: catalog,
          redirect: results[0],
          oauthApp: results[1],
          userConnection: results[2],
          source: results[3],
          capability: { canManageCredentials: canManage, scope: scope },
          flow: flow
        };
      });
    });
  }

  function buildServices(connectorType, flow) {
    var C = window.Connectors;
    var api = window.api;
    return {
      configure: function (config) { return C.configureGuided(connectorType, config); },
      createInstance: function (key) { return C.createInstance(connectorType, key); },
      patchConfig: function (sourceId, config) { return C.patchSourceConfig(sourceId, config); },
      test: function (sourceId) { return C.testSourceConnection(sourceId); },
      authorize: function (sourceId) {
        return C.authorizeSource(sourceId, flow, flow === 'web' ? window.location.href : '');
      },
      authStatus: function (sourceId) { return C.getAuthStatus(sourceId); },
      exchange: function (data, redirectUri) {
        return window.ConnectorOAuth.exchangeCode(api, { data: data, connectorType: connectorType, redirectUri: redirectUri });
      },
      updateSync: function (sourceId, settings) { return C.updateSyncSettings(sourceId, settings); },
      userConnect: function () { return api.connectUserConnection(connectorType); },
      userComplete: function (data) { return api.completeUserConnection(connectorType, data); },
      userConnections: function () { return api.getUserConnections(); },
      userSync: function (sourceId, settings) { return api.updateUserConnectionSyncSettings(sourceId, settings); },
      subscribeOAuth: function (handler) {
        return window.ConnectorOAuth ? window.ConnectorOAuth.subscribe(handler) : null;
      },
      openExternal: openExternal
    };
  }

  function showLoadError(drawer, message) {
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

  /**
   * Open the wizard. Returns the drawer element.
   * @param {Object} opts - see the file header
   */
  function open(opts) {
    opts = opts || {};
    if (!opts.connectorType) throw new Error('connectorType is required');
    // A third-party MCP server runs its own steps (Server, Sign in, Connect,
    // Test, Review tools) in the same drawer: js/mcp-connect.js.
    if (opts.connectorType === MCP_CONNECTOR_ID) {
      if (!window.Lex.McpConnect) throw new Error('MCP servers are not available on this page.');
      return window.Lex.McpConnect.openWizard(opts);
    }
    ensureStylesheet();

    var drawer = null;
    var closed = false;

    function closeDrawer() {
      if (drawer && !closed) drawer.dispatchEvent(new CustomEvent('lex-close', { bubbles: true }));
    }

    function advanced(detail) {
      closeDrawer();
      if (typeof opts.onAdvanced === 'function') {
        opts.onAdvanced(detail);
      } else if (typeof window.openConnectorManage === 'function') {
        window.openConnectorManage(opts.connectorType);
      }
    }

    drawer = window.Lex.Drawer.open({
      heading: 'Connect ' + (opts.connectorName || opts.connectorType),
      width: 'lg',
      closeOnOverlay: false,
      onClose: function () {
        closed = true;
        if (typeof opts.onDone === 'function') opts.onDone();
      }
    });

    var wizard = document.createElement('lex-connect-wizard');
    (drawer.contentRoot || drawer).appendChild(wizard);

    loadInput(opts).then(function (loaded) {
      if (closed) return;
      wizard.start({
        input: {
          catalog: loaded.catalog,
          source: loaded.source,
          capability: loaded.capability,
          redirect: loaded.redirect,
          oauthApp: loaded.oauthApp,
          userConnection: loaded.userConnection
        },
        options: { newInstance: opts.newInstance === true },
        services: buildServices(opts.connectorType, loaded.flow),
        onAdvanced: advanced,
        onOpenConnector: function (detail) {
          closeDrawer();
          if (typeof opts.onOpenConnector === 'function') opts.onOpenConnector(detail);
          else advanced(detail);
        },
        onClose: closeDrawer
      });
      if (wizard.model && drawer) drawer.heading = 'Connect ' + wizard.model.connectorName;
    }).catch(function (error) {
      if (closed) return;
      console.error('[ConnectWizard] Failed to load the setup guide:', error && error.message);
      showLoadError(drawer, (error && error.message) || 'The setup guide could not be loaded.');
    });

    return drawer;
  }

  window.Lex = window.Lex || {};
  window.Lex.ConnectWizard = {
    open: open,
    isEnabled: isEnabled,
    // Shared with js/mcp-connect.js.
    helpers: {
      ensureStylesheet: ensureStylesheet,
      isElectronFlow: isElectronFlow,
      openExternal: openExternal
    }
  };
})();
