/* Lex UI - Connect Wizard
   Guided Connect: walks a user through a connector's setup guide, saves and
   tests the credentials (or runs OAuth), offers auto sync, and hands off to
   the connector viewer. Shown inside a lex-drawer by Lex.ConnectWizard.open
   (js/connect-wizard.js), which also supplies the backend calls.

   The steps come from ConnectWizardModel (js/connect-wizard.model.js). This
   component renders the current step and runs the connect flow; it holds the
   typed values only in memory and never logs them.

   Usage (through the opener):
     Lex.ConnectWizard.open({ connectorType: 'stripe', onDone: refresh });

   Direct:
     const wizard = document.createElement('lex-connect-wizard');
     wizard.start({ input, services, onAdvanced, onOpenConnector, onClose });

   Styles: css/components/connect-wizard.css
   Events: none (callbacks on the start context).
*/

(function () {
  'use strict';

  var _lex = window.Lex;
  var LexElement = _lex.LexElement;
  var defineLex = _lex.defineLex;

  var POLL_INTERVAL_MS = 2000;
  var POLL_LIMIT_MS = 120000;
  var TITLE_SEQUENCE = 0;

  function Model() {
    return window.ConnectWizardModel;
  }

  function nowMs() {
    return window.LanaTime && typeof window.LanaTime.nowMs === 'function' ? window.LanaTime.nowMs() : Date.now();
  }

  class LexConnectWizard extends LexElement {
    constructor() {
      super();
      this._ctx = null;
      this._model = null;
      this._options = {};
      this._values = {};
      this._index = 0;
      this._furthest = 0;
      this._error = null;
      this._busy = false;
      this._result = null;
      this._sourceId = '';
      this._createdInstanceId = '';
      this._oauth = null;
      this._syncFrequency = 'daily';
      this._copyValues = [];
      this._links = [];
      this._focusTitle = false;
      this._titleId = 'lex-cw-title-' + (++TITLE_SEQUENCE);
    }

    // ── Public API ────────────────────────────────────────────────────

    /**
     * @param {Object} ctx
     * @param {Object} ctx.input - ConnectWizardModel.buildWizard input (no options)
     * @param {Object} ctx.services - backend calls (see connect-wizard.js)
     * @param {Function} [ctx.onAdvanced] - ({ sourceId }) open the connector viewer
     * @param {Function} [ctx.onOpenConnector] - ({ sourceId }) after done
     * @param {Function} [ctx.onClose] - close the wizard
     */
    start(ctx) {
      this._ctx = ctx || {};
      this._options = Object.assign({}, (ctx && ctx.options) || {});
      this._buildModel();
      this._sourceId = this._model.sourceId || '';
      this._index = 0;
      this._furthest = 0;
      this._scheduleUpdate();
    }

    get model() {
      return this._model;
    }

    get currentStep() {
      return this._model ? this._model.steps[this._index] : null;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────

    disconnected() {
      this._stopOAuth();
    }

    render() {
      if (!this._model) {
        return '<div class="lex-cw"><lex-spinner size="sm" label="Loading setup guide..."></lex-spinner></div>';
      }
      var step = this.currentStep;
      this._copyValues = [];
      this._links = [];

      return '<div class="lex-cw">' +
        '<lex-stepper class="lex-cw-stepper"></lex-stepper>' +
        '<section class="lex-cw-step" aria-labelledby="' + this._titleId + '">' +
          '<h4 class="lex-cw-title" id="' + this._titleId + '" tabindex="-1">' + this.escapeHtml(step.title) + '</h4>' +
          this._renderStep(step) +
        '</section>' +
        this._renderError() +
        this._renderFooter(step) +
      '</div>';
    }

    updated() {
      if (!this._model) return;
      var self = this;

      var stepper = this.querySelector('lex-stepper');
      if (stepper) {
        stepper.items = Model().buildStepperItems(
          this._model.steps,
          this._index,
          this._error ? this._index : -1,
          this._furthest
        );
      }

      this.querySelectorAll('[data-cw-field]').forEach(function (el) {
        var name = el.getAttribute('data-cw-field');
        var field = self._model.fields[name];
        if (field && field.input === 'select') el.options = field.options;
        if (!Object.prototype.hasOwnProperty.call(self._values, name)) return;
        if (field && field.input === 'toggle') el.checked = !!self._values[name];
        else el.value = self._values[name];
      });

      var frequency = this.querySelector('[data-cw-sync-frequency]');
      if (frequency) {
        frequency.options = this._model.steps[this._index].frequencies || [];
        frequency.value = this._syncFrequency;
      }

      var method = this.querySelector('[data-cw-method]');
      if (method) {
        method.options = this.currentStep.options || [];
        method.value = this._model.method;
      }

      var ownApp = this.querySelector('[data-cw-own-app]');
      if (ownApp) ownApp.checked = !!this._model.useOwnApp;

      this.delegate('lex-input', '[data-cw-field]', this._onFieldInput);
      this.delegate('lex-change', '[data-cw-field]', this._onFieldInput);
      this.delegate('lex-change', '[data-cw-method]', this._onMethodChange);
      this.delegate('lex-change', '[data-cw-own-app]', this._onOwnAppChange);
      this.delegate('lex-change', '[data-cw-sync-frequency]', function (event) {
        this._syncFrequency = String((event.detail && event.detail.value) || 'daily');
      });
      this.delegate('click', '[data-cw-nav]', this._onNav);
      this.delegate('click', '[data-cw-copy]', this._onCopy);
      this.delegate('click', '[data-cw-link]', this._onLink);
      this.listen(stepper, 'lex-step-select', function (event) {
        self._goTo(event.detail.index);
      });

      if (this._focusTitle) {
        this._focusTitle = false;
        var title = this.querySelector('.lex-cw-title');
        if (title && typeof title.focus === 'function') title.focus();
      }
    }

    // ── Rendering ─────────────────────────────────────────────────────

    _renderStep(step) {
      switch (step.kind) {
        case 'before_you_start': return this._renderIntro(step);
        case 'choose_method': return this._renderMethod();
        case 'guide': return this._renderGuide(step);
        case 'secure_it': return this._renderSecure(step);
        case 'details': return this._renderDetails(step);
        case 'connect': return this._renderConnect(step);
        case 'result': return this._renderResult();
        case 'sync': return this._renderSync();
        case 'done': return this._renderDone();
        default: return '';
      }
    }

    _p(text, cls) {
      return text ? '<p class="' + (cls || 'lex-cw-text') + '">' + this.escapeHtml(text) + '</p>' : '';
    }

    _callout(kind, text) {
      if (!text) return '';
      var label = kind === 'warning' ? 'Warning' : (kind === 'danger' ? 'Error' : 'Tip');
      return '<div class="lex-cw-callout lex-cw-callout--' + kind + '" role="' + (kind === 'danger' ? 'alert' : 'note') + '">' +
        '<span class="lex-cw-callout-label">' + label + '</span>' +
        '<p class="lex-cw-callout-text">' + this.escapeHtml(text) + '</p>' +
      '</div>';
    }

    _copyBlock(label, value, cls) {
      var index = this._copyValues.push(String(value)) - 1;
      return '<div class="lex-cw-copy ' + (cls || '') + '">' +
        (label ? '<span class="lex-cw-copy-label">' + this.escapeHtml(label) + '</span>' : '') +
        '<div class="lex-cw-copy-row">' +
          '<pre class="lex-cw-code"><code>' + this.escapeHtml(value) + '</code></pre>' +
          '<lex-btn variant="secondary" size="sm" leading-icon="clipboard" data-cw-copy="' + index + '">Copy</lex-btn>' +
        '</div>' +
      '</div>';
    }

    _renderIntro(step) {
      var html = this._p(step.intro) + this._p(step.audienceNote, 'lex-cw-text lex-cw-muted');
      if (step.prerequisites && step.prerequisites.length) {
        html += '<h5 class="lex-cw-subtitle">You will need</h5><ul class="lex-cw-list">' +
          step.prerequisites.map(function (item) { return '<li>' + this.escapeHtml(item) + '</li>'; }, this).join('') +
        '</ul>';
      }
      if (step.blocked) {
        html += this._callout('warning', step.blocked.reason);
      }
      if (!step.blocked && this._model.canUseOwnApp) {
        html += '<div class="lex-cw-managed">' +
          this._p('LANA already has an app for ' + this._model.connectorName + ', so there is nothing to create. If your firm uses its own app, turn this on to follow its setup steps.') +
          '<lex-toggle data-cw-own-app label="Use your own app"></lex-toggle>' +
        '</div>';
      }
      return html;
    }

    _renderMethod() {
      return '<lex-radio data-cw-method name="cw-method" label="How do you want to connect?"></lex-radio>';
    }

    _renderGuide(step) {
      var self = this;
      var html = this._p(step.body);
      if (step.instructions.length) {
        html += '<ol class="lex-cw-list lex-cw-list--numbered">' +
          step.instructions.map(function (line) { return '<li>' + self.escapeHtml(line) + '</li>'; }).join('') +
        '</ol>';
      }
      if (step.link) {
        var linkIndex = this._links.push(step.link.url) - 1;
        html += '<div class="lex-cw-link-row">' +
          '<lex-btn variant="secondary" size="sm" trailing-icon="external-link" data-cw-link="' + linkIndex + '">' +
            this.escapeHtml(step.link.label) +
          '</lex-btn>' +
        '</div>';
      }
      if (step.image) {
        html += '<img class="lex-cw-image" src="' + this.escapeHtml(step.image.url) + '" alt="' + this.escapeHtml(step.image.alt) + '" loading="lazy">';
      }
      if (step.code) html += this._copyBlock(step.code.label, step.code.value);
      if (step.showRedirectUri) html += this._copyBlock('Redirect URL', this._model.redirect.uri, 'lex-cw-copy--redirect');
      if (step.redirectUnavailable) {
        html += this._callout('warning', 'Ask an admin for the LANA redirect URL. Only admins can see it.');
      }
      html += this._callout('tip', step.tip) + this._callout('warning', step.warning);
      html += this._renderFields(step.fields);
      return html;
    }

    _renderSecure(step) {
      var self = this;
      return this._p(step.body) +
        (step.points && step.points.length
          ? '<ul class="lex-cw-list">' + step.points.map(function (p) { return '<li>' + self.escapeHtml(p) + '</li>'; }).join('') + '</ul>'
          : '');
    }

    _renderDetails(step) {
      return this._p(step.body) + this._renderFields(step.fields);
    }

    _renderFields(fields) {
      var self = this;
      if (!fields || !fields.length) return '';
      return '<div class="lex-cw-fields">' + fields.map(function (field) {
        var common = ' data-cw-field="' + self.escapeHtml(field.name) + '"' +
          ' name="' + self.escapeHtml(field.name) + '"' +
          ' label="' + self.escapeHtml(field.label) + '"' +
          (field.help ? ' help="' + self.escapeHtml(field.help) + '"' : '') +
          (field.required ? ' required' : '');
        if (field.input === 'select') return '<lex-select' + common + '></lex-select>';
        if (field.input === 'toggle') return '<lex-toggle' + common + '></lex-toggle>';
        return '<lex-input' + common +
          ' type="' + self.escapeHtml(field.input) + '"' +
          (field.placeholder ? ' placeholder="' + self.escapeHtml(field.placeholder) + '"' : '') +
          (field.secret ? ' autocomplete="off"' : '') +
        '></lex-input>';
      }).join('') + '</div>';
    }

    _renderConnect(step) {
      var name = this._model.connectorName;
      if (this._oauth && this._oauth.waiting) {
        return this._p('Finish signing in to ' + name + ' in your browser. This step moves on by itself when you are done.') +
          '<div class="lex-cw-waiting"><lex-spinner size="sm" label="Waiting for ' + this.escapeHtml(name) + '"></lex-spinner></div>' +
          '<div class="lex-cw-link-row"><lex-btn variant="ghost" size="sm" data-cw-nav="reopen-oauth">Open the sign in page again</lex-btn></div>';
      }
      if (step.branch === 'oauth') {
        return this._p('LANA opens ' + name + ' in your browser. Sign in there and approve access, then come back here.');
      }
      if (step.branch === 'none') {
        return this._p('LANA saves these settings for ' + name + '.');
      }
      return this._p('LANA saves your details for ' + name + ', then checks that they work.');
    }

    _renderResult() {
      var result = this._result || { outcome: 'unverified', message: '' };
      var html = '';
      if (result.outcome === 'connected') {
        html += '<p class="lex-cw-result lex-cw-result--ok">' + this.escapeHtml(this._model.connectorName + ' is connected.') + '</p>';
        if (result.identity) {
          html += '<p class="lex-cw-text">' + this.escapeHtml(result.identity.label + ' ' + result.identity.value) + '</p>';
        }
      } else {
        html += '<p class="lex-cw-result">' + this.escapeHtml(result.message || 'Saved.') + '</p>';
      }
      return html;
    }

    _renderSync() {
      return this._p('LANA can keep ' + this._model.connectorName + ' up to date on its own. Until you turn this on, LANA syncs only when you ask it to.') +
        '<lex-select data-cw-sync-frequency name="cw-sync-frequency" label="How often"></lex-select>';
    }

    _renderDone() {
      return this._p(this._model.connectorName + ' is set up. Open the connector to see its data, change settings or run a sync.');
    }

    _renderError() {
      if (!this._error) return '';
      var back = typeof this._error.backIndex === 'number' && this._error.backIndex >= 0 && this._error.backIndex !== this._index
        ? '<lex-btn variant="secondary" size="sm" data-cw-nav="error-back">Back to step ' + (this._error.backIndex + 1) + '</lex-btn>'
        : '';
      return '<div class="lex-cw-error" role="alert">' +
        '<p class="lex-cw-error-text">' + this.escapeHtml(this._error.message) + '</p>' +
        back +
      '</div>';
    }

    _renderFooter(step) {
      var busy = this._busy ? ' loading' : '';
      var buttons = '';
      var first = this._index === 0;
      var waiting = this._oauth && this._oauth.waiting;

      if (!first && step.kind !== 'done' && step.kind !== 'result' && !waiting) {
        buttons += '<lex-btn variant="secondary" data-cw-nav="back"' + (this._busy ? ' disabled' : '') + '>Back</lex-btn>';
      }

      if (step.kind === 'connect') {
        buttons += waiting
          ? '<lex-btn variant="secondary" data-cw-nav="cancel-oauth">Cancel</lex-btn>'
          : '<lex-btn variant="primary" data-cw-nav="connect"' + busy + '>' + this.escapeHtml(step.buttonLabel) + '</lex-btn>';
      } else if (step.kind === 'sync') {
        buttons += '<lex-btn variant="secondary" data-cw-nav="sync-later"' + (this._busy ? ' disabled' : '') + '>Not now</lex-btn>' +
          '<lex-btn variant="primary" data-cw-nav="sync-on"' + busy + '>Turn on auto sync</lex-btn>';
      } else if (step.kind === 'done') {
        buttons += '<lex-btn variant="secondary" data-cw-nav="close">Close</lex-btn>' +
          '<lex-btn variant="primary" data-cw-nav="open-connector">Open connector</lex-btn>';
      } else if (!(step.kind === 'before_you_start' && step.blocked)) {
        buttons += '<lex-btn variant="primary" data-cw-nav="next">Next</lex-btn>';
      }

      return '<div class="lex-cw-footer">' +
        '<lex-btn variant="ghost" size="sm" class="lex-cw-advanced" data-cw-nav="advanced">Advanced setup</lex-btn>' +
        '<div class="lex-cw-footer-actions">' + buttons + '</div>' +
      '</div>';
    }

    // ── Events ────────────────────────────────────────────────────────

    _onFieldInput(event, el) {
      var name = el.getAttribute('data-cw-field');
      var detail = event.detail || {};
      this._values[name] = detail.value;
    }

    _onMethodChange(event) {
      var value = event.detail && event.detail.value;
      if (!value || value === this._model.method) return;
      this._options.method = String(value);
      this._rebuild();
    }

    _onOwnAppChange(event) {
      this._options.useOwnApp = !!(event.detail && event.detail.value);
      this._rebuild();
    }

    _onCopy(event, el) {
      var value = this._copyValues[Number(el.getAttribute('data-cw-copy'))];
      if (value == null) return;
      var clipboard = window.navigator && window.navigator.clipboard;
      var done = function () { if (window.Lex.Toast) window.Lex.Toast.success('Copied.'); };
      if (clipboard && typeof clipboard.writeText === 'function') {
        clipboard.writeText(value).then(done).catch(function () {
          if (window.Lex.Toast) window.Lex.Toast.error('Could not copy. Select the text and copy it instead.');
        });
      }
    }

    _onLink(event, el) {
      var url = this._links[Number(el.getAttribute('data-cw-link'))];
      if (url) this._services().openExternal(url);
    }

    _onNav(event, el) {
      var action = el.getAttribute('data-cw-nav');
      if (this._busy && action !== 'advanced') return;
      switch (action) {
        case 'back': this._goTo(this._index - 1); break;
        case 'next': this._next(); break;
        case 'error-back': this._goTo(this._error.backIndex); break;
        case 'connect': this._connect(); break;
        case 'reopen-oauth': if (this._oauth && this._oauth.url) this._services().openExternal(this._oauth.url); break;
        case 'cancel-oauth': this._stopOAuth(); this._scheduleUpdate(); break;
        case 'sync-on': this._saveSync(true); break;
        case 'sync-later': this._saveSync(false); break;
        case 'open-connector': this._call('onOpenConnector', { sourceId: this._sourceId }); break;
        case 'close': this._call('onClose', {}); break;
        case 'advanced': this._advanced(); break;
        default: break;
      }
    }

    // ── Navigation ────────────────────────────────────────────────────

    _services() {
      return (this._ctx && this._ctx.services) || {};
    }

    _call(name, detail) {
      var fn = this._ctx && this._ctx[name];
      if (typeof fn === 'function') fn(Object.assign({ connectorType: this._model.connectorType, scope: this._model.scope }, detail));
    }

    _buildModel() {
      var input = Object.assign({}, this._ctx.input || {}, { options: this._options });
      this._model = Model().buildWizard(input);
    }

    _rebuild() {
      var currentId = this.currentStep && this.currentStep.id;
      this._buildModel();
      var index = Model().stepIndex(this._model, currentId);
      this._index = index === -1 ? Math.min(this._index, this._model.steps.length - 1) : index;
      this._furthest = Math.min(this._furthest, this._model.steps.length - 1);
      this._error = null;
      this._scheduleUpdate();
    }

    _goTo(index) {
      if (!this._model || index < 0 || index >= this._model.steps.length) return;
      this._index = index;
      this._furthest = Math.max(this._furthest, index);
      this._error = null;
      this._focusTitle = true;
      this._scheduleUpdate();
    }

    _next() {
      var step = this.currentStep;
      var missing = Model().missingRequiredFields(this._model, this._values, [step.id]);
      if (missing.length) {
        this._showError('Fill in ' + this._fieldLabels(missing) + ' to continue.', -1);
        return;
      }
      this._goTo(this._index + 1);
    }

    _fieldLabels(names) {
      var fields = this._model.fields;
      return names.map(function (n) { return fields[n] ? fields[n].label : n; }).join(', ');
    }

    _showError(message, backIndex) {
      this._busy = false;
      this._error = { message: String(message || 'Something went wrong.'), backIndex: backIndex };
      this._scheduleUpdate();
    }

    _errorMessage(error, fallback) {
      return (error && error.message) || fallback;
    }

    // ── Connect ───────────────────────────────────────────────────────

    _connect() {
      var M = Model();
      var missing = M.missingRequiredFields(this._model, this._values);
      if (missing.length) {
        this._showError('Fill in ' + this._fieldLabels(missing) + ' first.', M.stepIndexForField(this._model, missing[0]));
        return;
      }
      if (this._model.saveMode === 'create_instance' && !this._createdInstanceId) {
        var key = M.normalizeInstanceKey(this._values.instance_key);
        if (!M.isValidInstanceKey(key)) {
          this._showError('Use only letters, numbers and dashes for the instance name, and do not use "default".',
            M.stepIndexForField(this._model, 'instance_key'));
          return;
        }
      }
      this._busy = true;
      this._error = null;
      this._scheduleUpdate();

      var run = this._model.saveMode === 'user_oauth'
        ? this._runUserOAuth()
        : (this._model.branch === 'oauth' ? this._runOrgOAuth() : this._runCredentials());
      var self = this;
      run.catch(function (error) {
        self._showError(self._errorMessage(error, 'Could not connect.'), M.firstFieldStepIndex(self._model));
      });
    }

    _save() {
      var M = Model();
      var services = this._services();
      var config = M.buildConfigPayload(this._model, this._values);
      var self = this;
      var mode = this._model.saveMode;

      if (mode === 'configure') {
        return services.configure(config).then(function (res) {
          self._sourceId = (res && res.connector_id) || self._sourceId;
          if (!self._sourceId) throw new Error('The connector was not saved. Try again.');
          return self._sourceId;
        });
      }
      if (mode === 'patch_existing') {
        return services.patchConfig(this._model.sourceId, config).then(function () {
          self._sourceId = self._model.sourceId;
          return self._sourceId;
        });
      }
      if (mode === 'create_instance') {
        var created = this._createdInstanceId
          ? Promise.resolve(this._createdInstanceId)
          : services.createInstance(M.normalizeInstanceKey(this._values.instance_key)).then(function (res) {
            var id = res && res.data && res.data.id;
            if (!id) throw new Error('The new instance was not created. Try again.');
            self._createdInstanceId = id;
            return id;
          });
        return created.then(function (id) {
          return services.patchConfig(id, config).then(function () {
            self._sourceId = id;
            return id;
          });
        });
      }
      return Promise.reject(new Error('This connector cannot be saved here. Use Advanced setup.'));
    }

    _runCredentials() {
      var M = Model();
      var self = this;
      var services = this._services();
      return this._save().then(function (sourceId) {
        if (self._model.branch === 'none' || self._model.testKind === 'none') {
          return { code: 'TEST_NOT_DEFINED' };
        }
        return services.test(sourceId);
      }).then(function (res) {
        var outcome = M.interpretTestResult(res);
        if (outcome.outcome === 'failed') {
          self._showError(outcome.message, M.firstFieldStepIndex(self._model));
          return;
        }
        self._succeed(outcome);
      });
    }

    _runOrgOAuth() {
      var self = this;
      var services = this._services();
      return this._save().then(function (sourceId) {
        return services.authorize(sourceId);
      }).then(function (auth) {
        var url = auth && auth.authorization_url;
        if (!url) throw new Error('The sign in link was not returned. Try again.');
        self._beginOAuth({
          url: url,
          expectedState: window.ConnectorOAuth ? window.ConnectorOAuth.stateFromAuthorizationUrl(url) : '',
          onCallback: function (data) {
            return services.exchange(data, auth.redirect_uri).then(function () {
              return services.authStatus(self._sourceId);
            }).then(function (status) {
              if (Model().isAuthorized(status)) self._oauthConnected(self._sourceId);
            });
          },
          poll: function () {
            return services.authStatus(self._sourceId).then(function (status) {
              return Model().isAuthorized(status) ? self._sourceId : '';
            });
          }
        });
      });
    }

    _runUserOAuth() {
      var self = this;
      var services = this._services();
      var type = this._model.connectorType;
      return services.userConnect().then(function (res) {
        var data = (res && res.data) || res || {};
        if (!data.authorizationUrl) throw new Error('The sign in link was not returned. Try again.');
        self._beginOAuth({
          url: data.authorizationUrl,
          expectedState: data.state || '',
          onCallback: function (callback) {
            return services.userComplete({ code: callback.code, state: callback.state }).then(function (done) {
              var payload = (done && done.data) || done || {};
              self._oauthConnected(payload.integrationSourceId || '');
            });
          },
          poll: function () {
            return services.userConnections().then(function (payload) {
              var list = (payload && payload.connections) || [];
              for (var i = 0; i < list.length; i++) {
                var row = list[i] || {};
                if (row.connector_id === type && Model().isAuthorized(row)) return row.id || '';
              }
              return '';
            });
          }
        });
      });
    }

    _beginOAuth(flow) {
      var self = this;
      var services = this._services();
      this._stopOAuth();
      this._oauth = { waiting: true, url: flow.url, startedAt: nowMs(), timer: null, unsubscribe: null };

      var unsubscribe = services.subscribeOAuth ? services.subscribeOAuth(function (data) {
        if (!self._oauth || !window.ConnectorOAuth || !window.ConnectorOAuth.isCallbackPayload(data)) return;
        if (flow.expectedState && data.state && data.state !== flow.expectedState) return;
        if (data.error) {
          self._stopOAuth();
          self._showError(data.error_description || data.error, Model().firstFieldStepIndex(self._model));
          return;
        }
        flow.onCallback(data).catch(function (error) {
          self._stopOAuth();
          self._showError(self._errorMessage(error, 'Could not finish signing in.'), Model().firstFieldStepIndex(self._model));
        });
      }) : null;
      this._oauth.unsubscribe = unsubscribe;

      var tick = function () {
        if (!self._oauth) return;
        if (nowMs() - self._oauth.startedAt > POLL_LIMIT_MS) {
          self._stopOAuth();
          self._showError('LANA did not hear back from ' + self._model.connectorName + '. If you finished signing in, connect again to check.', -1);
          return;
        }
        flow.poll().then(function (sourceId) {
          if (sourceId && self._oauth) self._oauthConnected(sourceId);
          else if (self._oauth) self._oauth.timer = setTimeout(tick, POLL_INTERVAL_MS);
        }).catch(function () {
          if (self._oauth) self._oauth.timer = setTimeout(tick, POLL_INTERVAL_MS);
        });
      };
      this._oauth.timer = setTimeout(tick, POLL_INTERVAL_MS);

      this._busy = false;
      services.openExternal(flow.url);
      this._scheduleUpdate();
    }

    _stopOAuth() {
      if (!this._oauth) return;
      if (this._oauth.timer) clearTimeout(this._oauth.timer);
      if (typeof this._oauth.unsubscribe === 'function') this._oauth.unsubscribe();
      this._oauth = null;
    }

    _oauthConnected(sourceId) {
      if (!this._oauth) return;
      this._stopOAuth();
      if (sourceId) this._sourceId = sourceId;
      this._succeed({ outcome: 'connected', message: '', identity: null });
    }

    _succeed(outcome) {
      this._busy = false;
      this._result = outcome;
      this._goTo(Model().stepIndex(this._model, 'result'));
    }

    // ── Sync ──────────────────────────────────────────────────────────

    _saveSync(turnOn) {
      var self = this;
      var services = this._services();
      var userScope = this._model.saveMode === 'user_oauth';
      var doneIndex = Model().stepIndex(this._model, 'done');
      var settings = { sync_frequency: turnOn ? this._syncFrequency : 'manual' };
      if (turnOn && (settings.sync_frequency === 'daily' || settings.sync_frequency === 'weekly')) {
        settings.scheduled_sync_time = '08:00:00';
      }

      // Org rows from the wizard already start on manual sync.
      if (!turnOn && !userScope) {
        this._goTo(doneIndex);
        return;
      }
      if (!this._sourceId) {
        this._showError('LANA could not find the connection to update. Use Advanced setup to set sync.', -1);
        return;
      }
      this._busy = true;
      this._scheduleUpdate();
      var call = userScope ? services.userSync(this._sourceId, settings) : services.updateSync(this._sourceId, settings);
      call.then(function () {
        self._busy = false;
        self._goTo(doneIndex);
      }).catch(function (error) {
        self._showError(self._errorMessage(error, 'Could not save the sync setting.'), -1);
      });
    }

    // ── Advanced setup ────────────────────────────────────────────────

    _advanced() {
      var self = this;
      var sourceId = this._sourceId || this._model.sourceId;
      this._stopOAuth();
      if (sourceId || this._model.blocked || this._model.saveMode !== 'configure') {
        this._call('onAdvanced', { sourceId: sourceId || '' });
        return;
      }
      // No row yet: create one on manual sync so the viewer has a source.
      this._busy = true;
      this._scheduleUpdate();
      this._services().configure({}).then(function (res) {
        self._busy = false;
        self._sourceId = (res && res.connector_id) || '';
        self._call('onAdvanced', { sourceId: self._sourceId });
      }).catch(function (error) {
        self._showError(self._errorMessage(error, 'Could not open the connector page.'), -1);
      });
    }
  }

  defineLex('lex-connect-wizard', LexConnectWizard);
})();
