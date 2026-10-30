/* Lex UI - MCP Server Panel
   Manages one connected third-party MCP server: what it is, whether its sign
   in still works (with Sign in again for OAuth servers), "Check tools again"
   with a summary of what changed, the tool review list and Disconnect.

   Data Connectors opens this for MCP server rows instead of the generic
   connector viewer, which does not handle MCP rows. Shown in a lex-drawer by
   Lex.McpConnect.openPanel (js/mcp-connect.js), which supplies the backend
   calls.

   Usage (through the opener):
     Lex.McpConnect.openPanel({ sourceId, serverName, onChanged });

   Direct:
     const panel = document.createElement('lex-mcp-server-panel');
     panel.start({ sourceId, services, flow, onChanged, onClose });

   View logic: McpConnectModel (js/mcp-connect.model.js).
   Styles: css/components/connect-wizard.css (shared callouts and errors) and
   css/components/mcp-connect.css
*/

(function () {
  'use strict';

  var _lex = window.Lex;
  var LexElement = _lex.LexElement;
  var defineLex = _lex.defineLex;

  var POLL_INTERVAL_MS = 2000;
  var POLL_LIMIT_MS = 120000;

  function Model() {
    return window.McpConnectModel;
  }

  function formatTime(value) {
    if (!value) return 'Never';
    var utils = window.Lex && window.Lex.Utils;
    if (utils && typeof utils.formatDateTime === 'function') return utils.formatDateTime(value);
    return String(value);
  }

  class LexMcpServerPanel extends LexElement {
    constructor() {
      super();
      this._ctx = null;
      this._server = null;
      this._loading = false;
      this._loadError = null;
      this._checking = false;
      this._checkLines = null;
      this._reauth = false;
      this._error = null;
      this._busy = false;
      this._oauth = null;
      this._review = null;
    }

    /**
     * @param {Object} ctx
     * @param {string} ctx.sourceId
     * @param {Object} ctx.services - backend calls (see mcp-connect.js)
     * @param {string} [ctx.flow] - 'electron' | 'web'
     * @param {Function} [ctx.onChanged] - something changed (refresh lists)
     * @param {Function} [ctx.onClose] - close the panel
     */
    start(ctx) {
      this._ctx = ctx || {};
      return this._load();
    }

    get server() {
      return this._server;
    }

    disconnected() {
      if (!this.isConnected) this._stopOAuth();
    }

    // ── Rendering ─────────────────────────────────────────────────────

    render() {
      if (this._loading && !this._server) {
        return '<div class="lex-mcp-panel"><lex-spinner size="sm" label="Loading the server..."></lex-spinner></div>';
      }
      if (this._loadError && !this._server) {
        return '<div class="lex-mcp-panel">' + this._errorBox(this._loadError) + '</div>';
      }
      if (!this._server) return '<div class="lex-mcp-panel"></div>';
      return '<div class="lex-mcp-panel">' +
        this._renderServer() +
        this._renderTools() +
        this._renderDisconnect() +
        (this._error ? this._errorBox(this._error) : '') +
      '</div>';
    }

    updated() {
      var slot = this.querySelector('[data-mcp-review-slot]');
      if (slot && this._review) slot.appendChild(this._review);
      this.delegate('click', '[data-mcp-action]', this._onAction);
    }

    _errorBox(error) {
      return '<div class="lex-cw-error" role="alert">' +
        '<p class="lex-cw-error-text">' + this.escapeHtml(error.message) + '</p>' +
        (error.detail ? '<p class="lex-cw-error-text lex-mcp-error-detail">' + this.escapeHtml(error.detail) + '</p>' : '') +
      '</div>';
    }

    _renderServer() {
      var M = Model();
      var s = this._server;
      var status = M.statusView(s);
      var info = s.server_info || {};
      var claims = [info.name, info.version].filter(Boolean).join(' ');
      var esc = this.escapeHtml.bind(this);
      var html = '<section class="lex-mcp-panel-section" aria-label="Server">' +
        '<div class="lex-mcp-panel-head">' +
          '<h4 class="lex-mcp-panel-title">' + esc(s.name || 'MCP server') + '</h4>' +
          '<lex-badge class="lex-mcp-external" label="External" color="blue" size="sm"></lex-badge>' +
          '<lex-badge label="' + esc(status.label) + '" color="' + esc(status.color) + '" size="sm"></lex-badge>' +
        '</div>' +
        '<dl class="lex-mcp-kv">' +
          '<dt>Address</dt><dd class="lex-mcp-kv-url">' + esc(s.url || '') + '</dd>' +
          '<dt>Sign in</dt><dd>' + esc(M.authModeLabel(s.auth_mode)) + '</dd>' +
          (claims ? '<dt>The server calls itself</dt><dd>' + esc(claims) + '</dd>' : '') +
          '<dt>Last checked</dt><dd>' + esc(formatTime(s.last_tested_at || s.last_listed_at)) + '</dd>' +
        '</dl>';
      html += this._renderSignInAgain();
      return html + '</section>';
    }

    _renderSignInAgain() {
      var M = Model();
      var s = this._server;
      if (this._oauth) {
        return '<div class="lex-mcp-reauth">' +
          '<p class="lex-cw-text">Finish signing in to ' + this.escapeHtml(s.name || 'the server') + ' in your browser. This panel updates by itself when you are done.</p>' +
          '<div class="lex-cw-waiting"><lex-spinner size="sm" label="Waiting for the sign in"></lex-spinner></div>' +
          '<div class="lex-cw-link-row">' +
            '<lex-btn variant="ghost" size="sm" data-mcp-action="reopen-oauth">Open the sign in page again</lex-btn>' +
            '<lex-btn variant="secondary" size="sm" data-mcp-action="cancel-oauth">Cancel</lex-btn>' +
          '</div>' +
        '</div>';
      }
      var oauth = String(s.auth_mode || '') === 'oauth';
      if (!(this._reauth || M.needsReconnect(s))) return '';
      if (!oauth) {
        return '<div class="lex-cw-callout lex-cw-callout--warning" role="note">' +
          '<span class="lex-cw-callout-label">Sign in</span>' +
          '<p class="lex-cw-callout-text">The server no longer accepts the saved key. Disconnect it and add it again with a new key.</p>' +
        '</div>';
      }
      return '<div class="lex-cw-callout lex-cw-callout--warning lex-mcp-reauth" role="note">' +
        '<span class="lex-cw-callout-label">Sign in</span>' +
        '<p class="lex-cw-callout-text">Sign in to this server again to keep using its tools.</p>' +
        '<div class="lex-cw-link-row"><lex-btn variant="primary" size="sm" data-mcp-action="reconnect"' + (this._busy ? ' loading' : '') + '>Sign in again</lex-btn></div>' +
      '</div>';
    }

    _renderTools() {
      var self = this;
      var html = '<section class="lex-mcp-panel-section" aria-label="Tools">' +
        '<div class="lex-mcp-panel-head">' +
          '<h4 class="lex-mcp-panel-title">Tools</h4>' +
          '<lex-btn variant="secondary" size="sm" leading-icon="refresh-cw" data-mcp-action="check"' +
            (this._checking ? ' loading' : '') + (this._oauth ? ' disabled' : '') + '>Check tools again</lex-btn>' +
        '</div>';
      if (this._checkLines) {
        html += '<div class="lex-mcp-check" role="status">' + (this._checkLines.length
          ? '<ul class="lex-cw-list">' + this._checkLines.map(function (line) { return '<li>' + self.escapeHtml(line) + '</li>'; }).join('') + '</ul>'
          : '<p class="lex-cw-text">Nothing changed since the last check.</p>') +
        '</div>';
      }
      return html + '<div data-mcp-review-slot></div></section>';
    }

    _renderDisconnect() {
      return '<section class="lex-mcp-panel-section lex-mcp-panel-danger" aria-label="Disconnect">' +
        '<p class="lex-cw-text lex-cw-muted">Disconnecting removes the sign in and every tool of this server. LANA stops using it.</p>' +
        '<div class="lex-cw-link-row"><lex-btn variant="danger" size="sm" data-mcp-action="disconnect"' + (this._busy ? ' disabled' : '') + '>Disconnect</lex-btn></div>' +
      '</section>';
    }

    // ── Events ────────────────────────────────────────────────────────

    _onAction(event, el) {
      var action = el.getAttribute('data-mcp-action');
      switch (action) {
        case 'check': if (!this._checking && !this._oauth) this._check(); break;
        case 'reconnect': if (!this._busy) this._reconnect(); break;
        case 'reopen-oauth': if (this._oauth && this._oauth.handle) this._oauth.handle.reopen(); break;
        case 'cancel-oauth': this._stopOAuth(); this._scheduleUpdate(); break;
        case 'disconnect': if (!this._busy) this._disconnect(); break;
        default: break;
      }
    }

    _services() {
      return (this._ctx && this._ctx.services) || {};
    }

    _changed() {
      var fn = this._ctx && this._ctx.onChanged;
      if (typeof fn === 'function') fn();
    }

    _setServer(server) {
      this._server = server;
      var services = this._services();
      if (!this._review) this._review = document.createElement('lex-mcp-tool-review');
      var self = this;
      this._review.start({
        sourceId: server.id,
        serverName: server.name,
        tools: Array.isArray(server.tools) ? server.tools : [],
        services: { setTool: services.setTool, getServer: services.getServer },
        onChange: function () { self._changed(); }
      });
    }

    _load() {
      var self = this;
      this._loading = true;
      this._scheduleUpdate();
      return this._services().getServer(this._ctx.sourceId).then(function (server) {
        self._loading = false;
        self._loadError = null;
        if (!server) throw new Error('This MCP server was not found.');
        self._setServer(server);
        self._scheduleUpdate();
      }).catch(function (error) {
        self._loading = false;
        self._loadError = Model().describeError(error, 'Could not load the server.');
        self._scheduleUpdate();
      });
    }

    _check() {
      var self = this;
      var M = Model();
      this._checking = true;
      this._error = null;
      this._checkLines = null;
      this._scheduleUpdate();
      return this._services().test(this._server.id).then(function (result) {
        self._checking = false;
        self._reauth = false;
        var summary = M.testSummary(result);
        self._checkLines = summary.changes.concat(summary.truncatedText ? [summary.truncatedText] : []);
        if (self._review) self._review.setTools((result && result.tools) || []);
        // The check can change the server's status and last checked time.
        return self._services().getServer(self._server.id).then(function (server) {
          if (server) self._server = server;
        }, function () { /* keep what the check returned */ });
      }).then(function () {
        self._scheduleUpdate();
        self._changed();
      }).catch(function (error) {
        self._checking = false;
        var described = M.describeError(error, 'LANA could not check the server.');
        // OAuth: Sign in again. A key the server stopped accepting: say how to replace it.
        if (M.isReauthorizeError(error) || described.code === 'MCP_UNAUTHORIZED') self._reauth = true;
        self._error = described;
        self._scheduleUpdate();
      });
    }

    _reconnect() {
      var self = this;
      var M = Model();
      var services = this._services();
      var server = this._server;
      var before = M.oauthSnapshot(server);
      var flow = (this._ctx && this._ctx.flow) || 'electron';
      this._busy = true;
      this._error = null;
      this._scheduleUpdate();

      return services.authorize(server.id, flow).then(function (auth) {
        var url = auth && auth.authorization_url;
        if (!url) throw new Error('The sign in link was not returned. Try again.');
        var finished = function (latest) { return M.signInFinished(before, latest) ? latest : null; };
        var oauth = { handle: null };
        self._stopOAuth();
        self._oauth = oauth;
        oauth.handle = window.ConnectorOAuth.waitForSignIn({
          url: url,
          expectedState: window.ConnectorOAuth.stateFromAuthorizationUrl(url),
          subscribe: services.subscribeOAuth,
          openExternal: function (target) { services.openExternal(target); },
          intervalMs: POLL_INTERVAL_MS,
          limitMs: POLL_LIMIT_MS,
          onCallback: function (data) {
            return services.exchange(data, auth.redirect_uri).then(function () {
              return services.getServer(server.id);
            }).then(finished);
          },
          poll: function () {
            return services.getServer(server.id).then(finished);
          },
          onFinished: function (latest) {
            if (self._oauth !== oauth) return;
            self._oauth = null;
            self._reauth = false;
            self._setServer(latest);
            self._scheduleUpdate();
            self._changed();
            if (window.Lex.Toast) window.Lex.Toast.success('Signed in to ' + (latest.name || 'the server') + ' again.');
          },
          onError: function (error) {
            if (self._oauth !== oauth) return;
            self._oauth = null;
            self._error = M.describeError(error, 'Could not finish signing in.');
            self._scheduleUpdate();
          },
          onTimeout: function () {
            if (self._oauth !== oauth) return;
            self._oauth = null;
            self._error = { message: 'LANA did not hear back from the server. If you finished signing in, sign in again to check.', detail: '' };
            self._scheduleUpdate();
          }
        });
        self._busy = false;
        self._scheduleUpdate();
      }).catch(function (error) {
        self._busy = false;
        self._error = M.describeError(error, 'Could not start the sign in.');
        self._scheduleUpdate();
      });
    }

    _stopOAuth() {
      if (!this._oauth) return;
      var oauth = this._oauth;
      this._oauth = null;
      if (oauth.handle) oauth.handle.stop();
    }

    _disconnect() {
      var self = this;
      var server = this._server;
      var count = this._review ? this._review.tools.length : 0;
      var name = server.name || 'this server';
      var modal = window.Lex && window.Lex.Modal;
      var ask = modal && typeof modal.confirmAsync === 'function'
        ? modal.confirmAsync(
          'Disconnect ' + name + '?',
          'LANA removes the sign in and ' + (count === 1 ? 'the one tool' : 'all ' + count + ' tools') +
            ' of this server, and chat can no longer use them. You can add the server again later.',
          { variant: 'danger', confirmText: 'Disconnect' })
        : Promise.resolve(false);
      return ask.then(function (confirmed) {
        if (!confirmed) return null;
        self._stopOAuth();
        self._busy = true;
        self._error = null;
        self._scheduleUpdate();
        return self._services().remove(server.id).then(function () {
          self._busy = false;
          if (window.Lex.Toast) window.Lex.Toast.success('Disconnected ' + name + '.');
          self._changed();
          var close = self._ctx && self._ctx.onClose;
          if (typeof close === 'function') close();
        });
      }).catch(function (error) {
        self._busy = false;
        self._error = Model().describeError(error, 'Could not disconnect the server.');
        self._scheduleUpdate();
      });
    }
  }

  defineLex('lex-mcp-server-panel', LexMcpServerPanel);
})();
