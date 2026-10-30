/* Lex UI - MCP Connect Wizard
   The connect wizard's steps for a third-party MCP server: Server (name and
   address), Sign in (what discovery says the server needs), Connect (save,
   then OAuth sign in when the server uses it), Test (initialize and list
   tools), Review tools (each tool starts off) and Done.

   Opened in the connect wizard's drawer by
   Lex.ConnectWizard.open({ connectorType: 'mcp-server' }) through
   Lex.McpConnect.openWizard (js/mcp-connect.js), which also supplies the
   backend calls. It is a sibling of <lex-connect-wizard> rather than a mode
   of it: that wizard is built from a connector package's setup guide, while
   these steps come from the MCP server's discovery answer. Both share
   lex-stepper, the drawer opener, the stepper item builder and
   ConnectorOAuth.waitForSignIn (callback match, poll, time limit).

   Step and field logic: McpConnectModel (js/mcp-connect.model.js). Typed
   values stay in memory only; secrets are dropped once the server is saved
   and never logged.

   Usage (through the opener):
     Lex.ConnectWizard.open({ connectorType: 'mcp-server', onDone: refresh });

   Direct:
     const wizard = document.createElement('lex-mcp-connect-wizard');
     wizard.start({ services, flow: 'electron', onOpenServer, onClose });

   Styles: css/components/connect-wizard.css (shared step layout) and
   css/components/mcp-connect.css
*/

(function () {
  'use strict';

  var _lex = window.Lex;
  var LexElement = _lex.LexElement;
  var defineLex = _lex.defineLex;

  var POLL_INTERVAL_MS = 2000;
  var POLL_LIMIT_MS = 120000;
  var TITLE_SEQUENCE = 0;

  var SERVER_FIELDS = [
    { name: 'name', label: 'Name', input: 'text', required: true, secret: false,
      help: 'So you can tell your MCP servers apart.', placeholder: 'Firm research server' },
    { name: 'url', label: 'Server address', input: 'url', required: true, secret: false,
      help: 'The https address the server\'s provider gave you.', placeholder: 'https://mcp.example.com/mcp' }
  ];

  function Model() {
    return window.McpConnectModel;
  }

  class LexMcpConnectWizard extends LexElement {
    constructor() {
      super();
      this._ctx = null;
      this._values = {};
      this._method = 'bearer';
      this._discovery = null;
      this._discoveredUrl = '';
      this._steps = [];
      this._index = 0;
      this._furthest = 0;
      this._error = null;
      this._busy = false;
      this._server = null;
      this._oauth = null;
      this._testing = false;
      this._testResult = null;
      this._redirect = null;
      this._review = null;
      this._focusTitle = false;
      this._titleId = 'lex-mcp-cw-title-' + (++TITLE_SEQUENCE);
    }

    // ── Public API ────────────────────────────────────────────────────

    /**
     * @param {Object} ctx
     * @param {Object} ctx.services - backend calls (see mcp-connect.js)
     * @param {string} [ctx.flow] - 'electron' | 'web'
     * @param {Function} [ctx.onOpenServer] - ({ sourceId }) "Manage server" on Done
     * @param {Function} [ctx.onClose]
     */
    start(ctx) {
      this._ctx = ctx || {};
      this._steps = Model().buildSteps(null);
      this._index = 0;
      this._furthest = 0;
      this._scheduleUpdate();
    }

    get currentStep() {
      return this._steps[this._index] || null;
    }

    get steps() {
      return this._steps.slice();
    }

    get server() {
      return this._server;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    disconnected() {
      // Detaching the review list on re-render also lands here; only a real
      // removal (no parent) stops a sign in that is still waiting.
      if (!this.isConnected) this._stopOAuth();
    }

    render() {
      if (!this._ctx) {
        return '<div class="lex-cw"><lex-spinner size="sm" label="Loading..."></lex-spinner></div>';
      }
      var step = this.currentStep;
      return '<div class="lex-cw lex-mcp-cw">' +
        '<lex-stepper class="lex-cw-stepper"></lex-stepper>' +
        '<section class="lex-cw-step" aria-labelledby="' + this._titleId + '">' +
          '<h4 class="lex-cw-title" id="' + this._titleId + '" tabindex="-1">' + this.escapeHtml(this._stepTitle(step)) + '</h4>' +
          this._renderStep(step) +
        '</section>' +
        this._renderError() +
        this._renderFooter(step) +
      '</div>';
    }

    updated() {
      if (!this._ctx) return;
      var self = this;
      var M = Model();

      var stepper = this.querySelector('lex-stepper');
      if (stepper) {
        stepper.items = M.buildStepperItems(this._steps, this._index, this._error ? this._index : -1, this._furthest);
      }

      this.querySelectorAll('[data-mcp-field]').forEach(function (el) {
        var name = el.getAttribute('data-mcp-field');
        if (Object.prototype.hasOwnProperty.call(self._values, name)) el.value = self._values[name];
      });

      var method = this.querySelector('[data-mcp-method]');
      if (method) {
        method.options = M.TOKEN_METHODS;
        method.value = this._method;
      }

      var slot = this.querySelector('[data-mcp-review-slot]');
      if (slot && this._review) slot.appendChild(this._review);

      this.delegate('lex-input', '[data-mcp-field]', this._onFieldInput);
      this.delegate('lex-change', '[data-mcp-field]', this._onFieldInput);
      this.delegate('lex-change', '[data-mcp-method]', this._onMethodChange);
      this.delegate('click', '[data-mcp-nav]', this._onNav);
      this.delegate('click', '[data-mcp-copy]', this._onCopy);
      this.listen(stepper, 'lex-step-select', function (event) {
        self._selectStep(event.detail.index);
      });

      if (this._focusTitle) {
        this._focusTitle = false;
        var title = this.querySelector('.lex-cw-title');
        if (title && typeof title.focus === 'function') title.focus();
      }
    }

    // ── Rendering ─────────────────────────────────────────────────────

    _plan() {
      return this._discovery ? Model().signInPlan(this._discovery, this._discoveredUrl) : null;
    }

    _serverName() {
      return (this._server && this._server.name) || String(this._values.name || '').trim() || 'the server';
    }

    _stepTitle(step) {
      switch (step.id) {
        case 'server': return 'Add an MCP server';
        case 'sign_in': return 'How ' + this._serverName() + ' signs in';
        case 'connect': return 'Connect ' + this._serverName();
        case 'test': return 'Check ' + this._serverName();
        case 'review': return 'Choose the tools LANA may use';
        case 'done': return this._serverName() + ' is connected';
        default: return step.title;
      }
    }

    _renderStep(step) {
      switch (step.id) {
        case 'server': return this._renderServer();
        case 'sign_in': return this._renderSignIn();
        case 'connect': return this._renderConnect();
        case 'test': return this._renderTest();
        case 'review': return '<div data-mcp-review-slot></div>';
        case 'done': return this._renderDone();
        default: return '';
      }
    }

    _p(text, cls) {
      return text ? '<p class="' + (cls || 'lex-cw-text') + '">' + this.escapeHtml(text) + '</p>' : '';
    }

    _callout(kind, label, text) {
      if (!text) return '';
      return '<div class="lex-cw-callout lex-cw-callout--' + kind + '" role="note">' +
        '<span class="lex-cw-callout-label">' + this.escapeHtml(label) + '</span>' +
        '<p class="lex-cw-callout-text">' + this.escapeHtml(text) + '</p>' +
      '</div>';
    }

    _renderFields(fields) {
      var self = this;
      if (!fields || !fields.length) return '';
      return '<div class="lex-cw-fields">' + fields.map(function (field) {
        return '<lex-input data-mcp-field="' + self.escapeHtml(field.name) + '"' +
          ' name="' + self.escapeHtml(field.name) + '"' +
          ' label="' + self.escapeHtml(field.label) + '"' +
          ' type="' + self.escapeHtml(field.input) + '"' +
          (field.help ? ' help="' + self.escapeHtml(field.help) + '"' : '') +
          (field.placeholder ? ' placeholder="' + self.escapeHtml(field.placeholder) + '"' : '') +
          (field.required ? ' required' : '') +
          (field.secret ? ' autocomplete="off"' : '') +
        '></lex-input>';
      }).join('') + '</div>';
    }

    _renderServer() {
      return this._p('Paste the address of the MCP server. LANA checks how the server signs in before anything is saved.') +
        this._renderFields(SERVER_FIELDS) +
        this._callout('warning', 'Before you add it', 'When LANA uses one of this server\'s tools, it sends the tool\'s inputs to the server. Add only servers your firm trusts.');
    }

    _renderSignIn() {
      var plan = this._plan();
      if (!plan) return this._p('LANA checks the server first. Go back and enter its address.');
      var host = plan.signInHost || 'the server';
      if (plan.kind === 'oauth_dynamic') {
        return this._p('This server uses OAuth. In the next step you sign in with ' + host + ' in your browser and approve access. LANA registers itself with the server, so there is nothing to copy.');
      }
      if (plan.kind === 'oauth_manual') {
        var html = this._p('This server uses OAuth but does not let LANA register itself. Ask its administrator to create an OAuth app for LANA and give you the client ID, and the secret if they issue one.');
        if (this._redirect && this._redirect.uri) html += this._copyBlock('Redirect URL for the OAuth app', this._redirect.uri);
        return html + this._renderFields(Model().signInFields(plan, this._method));
      }
      if (plan.kind === 'token') {
        return this._p('This server does not offer OAuth sign in. Use the key its administrator gave you.') +
          '<lex-radio data-mcp-method name="mcp-method" label="How does the server take the key?"></lex-radio>' +
          this._renderFields(Model().signInFields(plan, this._method));
      }
      return '';
    }

    _copyBlock(label, value) {
      return '<div class="lex-cw-copy lex-cw-copy--redirect">' +
        '<span class="lex-cw-copy-label">' + this.escapeHtml(label) + '</span>' +
        '<div class="lex-cw-copy-row">' +
          '<pre class="lex-cw-code"><code>' + this.escapeHtml(value) + '</code></pre>' +
          '<lex-btn variant="secondary" size="sm" leading-icon="clipboard" data-mcp-copy>Copy</lex-btn>' +
        '</div>' +
      '</div>';
    }

    _renderConnect() {
      var plan = this._plan() || { kind: 'none', signInHost: '' };
      var host = plan.signInHost || 'the server';
      if (this._oauth) {
        return this._p('Finish signing in with ' + host + ' in your browser. This step moves on by itself when you are done.') +
          '<div class="lex-cw-waiting"><lex-spinner size="sm" label="' + this.escapeHtml('Waiting for ' + host) + '"></lex-spinner></div>' +
          '<div class="lex-cw-link-row"><lex-btn variant="ghost" size="sm" data-mcp-nav="reopen-oauth">Open the sign in page again</lex-btn></div>';
      }
      var mode = Model().authModeFor(plan, this._method);
      if (mode === 'oauth') {
        return this._p('LANA saves the server, then opens ' + host + ' in your browser. Sign in there and approve access, then come back here.');
      }
      if (mode === 'none') {
        return this._p('LANA saves the server. It does not ask for a sign in.');
      }
      return this._p('LANA saves the server and your key. The key is encrypted on your firm\'s LANA server, is never shown to LANA\'s AI and is not shown again after you save it.');
    }

    _renderTest() {
      var name = this._serverName();
      if (this._testing) {
        return '<div class="lex-cw-waiting"><lex-spinner size="sm" label="' + this.escapeHtml('Checking ' + name) + '"></lex-spinner></div>';
      }
      if (!this._testResult) {
        return this._p('LANA asks the server what it is and which tools it offers.');
      }
      var summary = Model().testSummary(this._testResult);
      var html = '<p class="lex-cw-result lex-cw-result--ok">' + this.escapeHtml('LANA reached ' + name + '.') + '</p>';
      if (summary.serverName) {
        html += '<dl class="lex-mcp-kv">' +
          '<dt>The server calls itself</dt><dd>' + this.escapeHtml(summary.serverName + (summary.serverVersion ? ' ' + summary.serverVersion : '')) + '</dd>' +
        '</dl>';
      }
      html += this._p(summary.toolCountText);
      html += this._callout('warning', 'Not every tool', summary.truncatedText);
      return html;
    }

    _renderDone() {
      var tools = this._review ? this._review.tools : ((this._testResult && this._testResult.tools) || []);
      var on = Model().enabledCount(tools);
      var text = on
        ? on + ' of ' + tools.length + ' tools are on. LANA asks you before every use.'
        : 'No tools are on yet. Turn tools on from Data Connectors when you are ready.';
      return this._p(text) + this._p('You can change which tools are on, check the server again or disconnect it from Data Connectors.', 'lex-cw-text lex-cw-muted');
    }

    _renderError() {
      if (!this._error) return '';
      var back = typeof this._error.backIndex === 'number' && this._error.backIndex >= 0 && this._error.backIndex !== this._index
        ? '<lex-btn variant="secondary" size="sm" data-mcp-nav="error-back">Back to step ' + (this._error.backIndex + 1) + '</lex-btn>'
        : '';
      return '<div class="lex-cw-error" role="alert">' +
        '<p class="lex-cw-error-text">' + this.escapeHtml(this._error.message) + '</p>' +
        (this._error.detail ? '<p class="lex-cw-error-text lex-mcp-error-detail">' + this.escapeHtml(this._error.detail) + '</p>' : '') +
        back +
      '</div>';
    }

    _renderFooter(step) {
      var busy = this._busy ? ' loading' : '';
      var disabled = this._busy ? ' disabled' : '';
      var buttons = '';
      var locked = !!this._server;
      var canBack = this._index > 0 && !this._oauth && !locked && step.id !== 'done';

      if (canBack) buttons += '<lex-btn variant="secondary" data-mcp-nav="back"' + disabled + '>Back</lex-btn>';

      if (step.id === 'connect') {
        if (this._oauth) {
          buttons += '<lex-btn variant="secondary" data-mcp-nav="cancel-oauth">Cancel</lex-btn>';
        } else {
          buttons += '<lex-btn variant="primary" data-mcp-nav="connect"' + busy + '>' + this.escapeHtml(this._connectLabel()) + '</lex-btn>';
        }
      } else if (step.id === 'test') {
        // A saved server that fails its first check (a wrong key, say) can be
        // removed and set up again; the backend has no way to edit its key.
        if (!this._testing && !this._testResult && this._error) {
          buttons += '<lex-btn variant="ghost" data-mcp-nav="start-over"' + disabled + '>Remove and start over</lex-btn>';
        }
        if (!this._testing) buttons += '<lex-btn variant="secondary" data-mcp-nav="retest"' + disabled + '>Test again</lex-btn>';
        if (this._testResult && !this._testing) buttons += '<lex-btn variant="primary" data-mcp-nav="next">Next</lex-btn>';
      } else if (step.id === 'done') {
        buttons += '<lex-btn variant="secondary" data-mcp-nav="close">Close</lex-btn>' +
          '<lex-btn variant="primary" data-mcp-nav="open-server">Manage server</lex-btn>';
      } else {
        buttons += '<lex-btn variant="primary" data-mcp-nav="next"' + busy + '>Next</lex-btn>';
      }

      return '<div class="lex-cw-footer lex-mcp-cw-footer">' +
        '<div class="lex-cw-footer-actions">' + buttons + '</div>' +
      '</div>';
    }

    _connectLabel() {
      var plan = this._plan() || { kind: 'none', signInHost: '' };
      if (Model().authModeFor(plan, this._method) === 'oauth') {
        return 'Sign in with ' + (plan.signInHost || 'the server');
      }
      return 'Connect';
    }

    // ── Events ────────────────────────────────────────────────────────

    _onFieldInput(event, el) {
      var detail = event.detail || {};
      this._values[el.getAttribute('data-mcp-field')] = detail.value;
    }

    _onMethodChange(event) {
      var value = event.detail && event.detail.value;
      if (!value || value === this._method) return;
      this._method = String(value);
      this._error = null;
      this._scheduleUpdate();
    }

    _onCopy() {
      var value = this._redirect && this._redirect.uri;
      var clipboard = window.navigator && window.navigator.clipboard;
      if (!value || !clipboard || typeof clipboard.writeText !== 'function') return;
      clipboard.writeText(value).then(function () {
        if (window.Lex.Toast) window.Lex.Toast.success('Copied.');
      }).catch(function () {
        if (window.Lex.Toast) window.Lex.Toast.error('Could not copy. Select the text and copy it instead.');
      });
    }

    _onNav(event, el) {
      var action = el.getAttribute('data-mcp-nav');
      if (this._busy) return;
      switch (action) {
        case 'back': this._goTo(this._index - 1); break;
        case 'next': this._next(); break;
        case 'error-back': this._goTo(this._error.backIndex); break;
        case 'connect': this._connect(); break;
        case 'reopen-oauth': if (this._oauth && this._oauth.handle) this._oauth.handle.reopen(); break;
        case 'cancel-oauth': this._stopOAuth(); this._scheduleUpdate(); break;
        case 'retest': this._runTest(); break;
        case 'start-over': this._startOver(); break;
        case 'open-server': this._call('onOpenServer', { sourceId: this._server ? this._server.id : '' }); break;
        case 'close': this._call('onClose', {}); break;
        default: break;
      }
    }

    // ── Navigation ────────────────────────────────────────────────────

    _services() {
      return (this._ctx && this._ctx.services) || {};
    }

    _call(name, detail) {
      var fn = this._ctx && this._ctx[name];
      if (typeof fn === 'function') fn(detail);
    }

    _goTo(index) {
      if (index < 0 || index >= this._steps.length) return;
      this._index = index;
      this._furthest = Math.max(this._furthest, index);
      this._error = null;
      this._focusTitle = true;
      this._scheduleUpdate();
    }

    _goToId(id) {
      this._goTo(Model().stepIndex(this._steps, id));
    }

    // Once the server is saved, the steps before Connect are history.
    _selectStep(index) {
      if (this._busy || this._oauth) return;
      if (this._server && index <= Model().stepIndex(this._steps, 'connect')) return;
      this._goTo(index);
    }

    _showError(error, fallback, backIndex) {
      var described = Model().describeError(error, fallback);
      this._busy = false;
      this._error = { message: described.message, detail: described.detail, backIndex: backIndex };
      this._scheduleUpdate();
      return described;
    }

    _next() {
      var step = this.currentStep;
      var M = Model();
      if (step.id === 'server') {
        var missing = M.missingFields(SERVER_FIELDS, this._values);
        if (missing.length) {
          this._showError(new Error('Fill in ' + missing.join(', ') + ' to continue.'), '', -1);
          return;
        }
        this._discover();
        return;
      }
      if (step.id === 'sign_in') {
        var needed = M.missingFields(M.signInFields(this._plan(), this._method), this._values);
        if (needed.length) {
          this._showError(new Error('Fill in ' + needed.join(', ') + ' to continue.'), '', -1);
          return;
        }
      }
      this._goTo(this._index + 1);
    }

    _discover() {
      var self = this;
      var M = Model();
      var url = String(this._values.url || '').trim();
      if (this._discovery && this._discoveredUrl === url) {
        this._goTo(this._index + 1);
        return;
      }
      this._busy = true;
      this._error = null;
      this._scheduleUpdate();
      this._services().discover(url).then(function (found) {
        self._busy = false;
        self._discovery = found || { auth: 'none' };
        self._discoveredUrl = url;
        self._steps = M.buildSteps(self._discovery, url);
        self._furthest = 0;
        self._loadRedirect();
        self._goTo(1);
      }).catch(function (error) {
        self._showError(error, 'LANA could not check this server.', -1);
      });
    }

    // A server without dynamic registration needs LANA's redirect URL in its
    // OAuth app. Shown when the backend answers; skipped otherwise.
    _loadRedirect() {
      var self = this;
      var plan = this._plan();
      this._redirect = null;
      var services = this._services();
      if (!plan || plan.kind !== 'oauth_manual' || typeof services.redirectUri !== 'function') return;
      services.redirectUri().then(function (res) {
        var uri = res && (res.redirect_uri || res.redirectUri);
        if (uri) {
          self._redirect = { uri: String(uri) };
          self._scheduleUpdate();
        }
      }).catch(function () { /* the admin can still ask the server's provider */ });
    }

    // ── Connect ───────────────────────────────────────────────────────

    _connect() {
      var self = this;
      var M = Model();
      var plan = this._plan();
      if (!plan) {
        this._showError(new Error('Check the server first.'), '', 0);
        return;
      }
      var mode = M.authModeFor(plan, this._method);
      this._busy = true;
      this._error = null;
      this._scheduleUpdate();

      var saved = this._server ? Promise.resolve(this._server) : this._create(plan);
      saved.then(function (server) {
        if (!server) return;
        if (mode === 'oauth') return self._startOAuth();
        self._busy = false;
        self._goToId('test');
        self._runTest();
        return null;
      }).catch(function (error) {
        if (M.isReauthorizeError(error)) {
          self._showError(error, '', -1);
          return;
        }
        self._showError(error, 'Could not connect.', -1);
      });
    }

    _create(plan) {
      var self = this;
      var M = Model();
      var body = M.buildCreatePayload({ values: this._values, plan: plan, method: this._method });
      return this._services().create(body).then(function (server) {
        if (!server || !server.id) throw new Error('The server was not saved. Try again.');
        self._server = server;
        // The backend holds the secrets now; the wizard does not keep them.
        M.SECRET_FIELDS.forEach(function (name) { delete self._values[name]; });
        return server;
      }, function (error) {
        var described = M.describeError(error, 'Could not save the server.');
        var stepId = M.stepForErrorField(described.field);
        var back = stepId ? M.stepIndex(self._steps, stepId) : -1;
        if (window.console) console.warn('[McpConnect] Saving the server failed:', described.code || 'error', M.sanitizeForLog(body));
        self._showError(error, 'Could not save the server.', back);
        return null;
      });
    }

    _startOAuth() {
      var self = this;
      var M = Model();
      var services = this._services();
      var server = this._server;
      var before = M.oauthSnapshot(server);
      var flow = (this._ctx && this._ctx.flow) || 'electron';

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
            self._server = latest;
            self._goToId('test');
            self._runTest();
          },
          onError: function (error) {
            if (self._oauth !== oauth) return;
            self._oauth = null;
            self._showError(error, 'Could not finish signing in.', -1);
          },
          onTimeout: function () {
            if (self._oauth !== oauth) return;
            self._oauth = null;
            self._showError(new Error('LANA did not hear back from the server. If you finished signing in, sign in again to check.'), '', -1);
          }
        });
        self._busy = false;
        self._scheduleUpdate();
      });
    }

    _stopOAuth() {
      if (!this._oauth) return;
      var oauth = this._oauth;
      this._oauth = null;
      if (oauth.handle) oauth.handle.stop();
    }

    // ── Test and review ───────────────────────────────────────────────

    _runTest() {
      var self = this;
      var M = Model();
      if (!this._server || this._testing) return;
      this._testing = true;
      this._error = null;
      this._scheduleUpdate();
      this._services().test(this._server.id).then(function (result) {
        self._testing = false;
        self._testResult = result || {};
        self._mountReview((result && result.tools) || []);
        self._scheduleUpdate();
      }).catch(function (error) {
        self._testing = false;
        var back = M.isReauthorizeError(error) ? M.stepIndex(self._steps, 'connect') : -1;
        if (back !== -1) self._server = Object.assign({}, self._server, { auth_status: 'expired' });
        self._showError(error, 'LANA could not check the server.', back);
      });
    }

    _startOver() {
      var self = this;
      if (!this._server) return;
      this._busy = true;
      this._scheduleUpdate();
      this._services().remove(this._server.id).then(function () {
        self._busy = false;
        self._server = null;
        self._testResult = null;
        var signIn = Model().stepIndex(self._steps, 'sign_in');
        self._goTo(signIn !== -1 ? signIn : 0);
      }).catch(function (error) {
        self._showError(error, 'Could not remove the server.', -1);
      });
    }

    _mountReview(tools) {
      var services = this._services();
      var server = this._server;
      if (!this._review) this._review = document.createElement('lex-mcp-tool-review');
      this._review.start({
        sourceId: server.id,
        // The name the admin gave the server, not the name the server claims.
        serverName: server.name,
        tools: tools,
        services: { setTool: services.setTool, getServer: services.getServer }
      });
    }
  }

  defineLex('lex-mcp-connect-wizard', LexMcpConnectWizard);
})();
