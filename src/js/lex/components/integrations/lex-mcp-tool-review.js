/* Lex UI - MCP Tool Review
   The list of tools a third-party MCP server offers, with a switch per tool.
   Used by the MCP steps of the connect wizard (Review tools) and by the MCP
   server panel. Every tool starts off; turning one on approves exactly the
   version shown (expected_hash), and the backend refuses with a 409 when the
   server changed it since. Every call to an approved tool still asks the
   user for approval in chat.

   Everything a tool shows (title, name, description, annotations) comes
   from the remote server. It is untrusted: rendered as escaped text only,
   under a "Provided by <server>" label, and annotations are shown as what
   the server claims.

   Usage:
     const review = document.createElement('lex-mcp-tool-review');
     review.start({
       sourceId, serverName, tools,
       services: { setTool(sourceId, alias, body), getServer(sourceId) },
       onChange: function (tools) {}
     });
     review.setTools(tools);  // after "Check tools again"

   Rows come from McpConnectModel.toolView (js/mcp-connect.model.js).
   Styles: css/components/mcp-connect.css
*/

(function () {
  'use strict';

  var _lex = window.Lex;
  var LexElement = _lex.LexElement;
  var defineLex = _lex.defineLex;

  function Model() {
    return window.McpConnectModel;
  }

  class LexMcpToolReview extends LexElement {
    constructor() {
      super();
      this._ctx = null;
      this._tools = [];
      this._busy = {};
      this._errors = {};
      this._notice = '';
    }

    /**
     * @param {Object} ctx
     * @param {string} ctx.sourceId
     * @param {string} ctx.serverName
     * @param {Array} ctx.tools - tool shapes from the backend
     * @param {Object} ctx.services - setTool, getServer
     * @param {Function} [ctx.onChange] - (tools) after a tool changed
     */
    start(ctx) {
      this._ctx = ctx || {};
      this._tools = Array.isArray(this._ctx.tools) ? this._ctx.tools.slice() : [];
      this._busy = {};
      this._errors = {};
      this._notice = '';
      this._scheduleUpdate();
    }

    setTools(tools) {
      this._tools = Array.isArray(tools) ? tools.slice() : [];
      this._errors = {};
      this._scheduleUpdate();
    }

    get tools() {
      return this._tools.slice();
    }

    render() {
      var M = Model();
      var self = this;
      var serverName = (this._ctx && this._ctx.serverName) || '';
      var html = '<div class="lex-mcp-tools">' +
        '<p class="lex-mcp-note" role="note">' + this.escapeHtml(M.TOOL_APPROVAL_NOTE) + '</p>';
      if (this._notice) {
        html += '<div class="lex-cw-callout lex-cw-callout--warning" role="status">' +
          '<span class="lex-cw-callout-label">Changed</span>' +
          '<p class="lex-cw-callout-text">' + this.escapeHtml(this._notice) + '</p>' +
        '</div>';
      }
      if (!this._tools.length) {
        return html + '<p class="lex-cw-text lex-cw-muted">This server does not offer any tools yet.</p></div>';
      }
      html += '<ul class="lex-mcp-tool-list">' + this._tools.map(function (tool, index) {
        return self._renderTool(M.toolView(tool, serverName), index);
      }).join('') + '</ul>';
      return html + '</div>';
    }

    _renderTool(view, index) {
      var esc = this.escapeHtml.bind(this);
      var busy = !!this._busy[view.alias];
      var disabled = busy || (!view.enabled && !view.canEnable);
      var html = '<li class="lex-mcp-tool" data-mcp-tool="' + esc(view.alias) + '">' +
        '<div class="lex-mcp-tool-head">' +
          '<div class="lex-mcp-tool-names">' +
            '<span class="lex-mcp-tool-title">' + esc(view.title) + '</span>' +
            (view.showToolName ? '<code class="lex-mcp-tool-name">' + esc(view.toolName) + '</code>' : '') +
          '</div>' +
          (view.external ? '<lex-badge class="lex-mcp-external" label="External" color="blue" size="sm"></lex-badge>' : '') +
          '<div class="lex-mcp-tool-switch">' +
            '<lex-toggle data-mcp-toggle="' + index + '" aria-label="' + esc('Allow LANA to use ' + view.title) + '"' +
              (view.enabled ? ' checked' : '') + (disabled ? ' disabled' : '') + '></lex-toggle>' +
            '<span class="lex-mcp-tool-state">' + (busy ? 'Saving...' : (view.enabled ? 'On' : 'Off')) + '</span>' +
          '</div>' +
        '</div>';
      if (view.description) {
        html += '<div class="lex-mcp-provided">' +
          '<span class="lex-mcp-provided-label">' + esc(view.providedBy) + '</span>' +
          '<p class="lex-mcp-tool-desc">' + esc(view.description) + '</p>' +
        '</div>';
      }
      if (view.hints.length) {
        html += '<div class="lex-mcp-hints">' +
          '<span class="lex-mcp-provided-label">What the server says about it</span>' +
          '<ul class="lex-mcp-hint-list">' + view.hints.map(function (hint) {
            return '<li><lex-badge label="' + esc(hint) + '" color="gray" size="sm"></lex-badge></li>';
          }).join('') + '</ul>' +
        '</div>';
      }
      if (view.note) html += '<p class="lex-mcp-tool-note">' + esc(view.note) + '</p>';
      if (this._errors[view.alias]) {
        html += '<p class="lex-mcp-tool-error" role="alert">' + esc(this._errors[view.alias]) + '</p>';
      }
      return html + '</li>';
    }

    updated() {
      this.delegate('lex-change', '[data-mcp-toggle]', this._onToggle);
    }

    _onToggle(event, el) {
      var tool = this._tools[Number(el.getAttribute('data-mcp-toggle'))];
      if (!tool || this._busy[tool.alias]) return;
      var enabled = !!(event.detail && event.detail.value);
      this._setTool(tool, enabled);
    }

    _setTool(tool, enabled) {
      var M = Model();
      var self = this;
      var ctx = this._ctx || {};
      var services = ctx.services || {};
      var alias = tool.alias;
      this._busy[alias] = true;
      delete this._errors[alias];
      this._notice = '';
      this._scheduleUpdate();

      services.setTool(ctx.sourceId, alias, M.toolTogglePayload(tool, enabled)).then(function (updated) {
        delete self._busy[alias];
        if (updated && updated.alias) self._tools = M.replaceTool(self._tools, updated);
        self._changed();
      }).catch(function (error) {
        delete self._busy[alias];
        if (M.isToolConflict(error)) {
          self._refreshAfterConflict(tool);
          return;
        }
        self._errors[alias] = M.describeError(error, 'Could not save this tool.').message;
        self._scheduleUpdate();
      });
    }

    // The tool changed since the admin looked at it (or the server stopped
    // listing it): load the current list so what is shown is what the
    // backend would approve, and say why the switch did not stick.
    _refreshAfterConflict(tool) {
      var self = this;
      var ctx = this._ctx || {};
      var title = Model().toolView(tool, '').title;
      this._notice = title + ' changed since you looked at it, or the server no longer lists it. Review it again before you turn it on.';
      var load = ctx.services && typeof ctx.services.getServer === 'function'
        ? ctx.services.getServer(ctx.sourceId)
        : Promise.resolve(null);
      load.then(function (server) {
        if (server && Array.isArray(server.tools)) self._tools = server.tools.slice();
        self._changed();
      }).catch(function () {
        self._scheduleUpdate();
      });
    }

    _changed() {
      var ctx = this._ctx || {};
      this._scheduleUpdate();
      if (typeof ctx.onChange === 'function') ctx.onChange(this._tools.slice());
    }
  }

  defineLex('lex-mcp-tool-review', LexMcpToolReview);
})();
