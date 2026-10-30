/* ==========================================================================
   Lex UI: <lex-connector-setup-card>
   The chat card for "connect Stripe". The backend sends only
     { card_type: 'connector_setup', connector_type, connector_name, scope }
   and LexDynamicCardRenderer sets them as attributes. Everything else is
   read live when the card renders, on a live stream and on reload:
     - the connection status, from Connectors.getAll() (connectors.js)
     - whether the user may set up an organization connector, from
       Lex.Auth.canAccessAdminPages() (UI gating only; the backend enforces)
   connector-setup-card.model.js decides the status label and the action.

   Actions:
     "Set up {name}"  opens Lex.ConnectWizard over the chat (scripts load on
                      first use). With CONNECT_WIZARD_ENABLED off it opens
                      Data Connectors instead.
     "Open {name}"    opens Data Connectors for the connector.
     no button        "Ask an admin to connect {name}".
   When the wizard closes, the card reads the status again.

   Attributes: connector-type, connector-name, scope ('org' | 'user')
   Styles: css/components/lex-connector-setup-card.css
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex || !Lex.LexElement) { console.error('[lex-connector-setup-card] LexElement not loaded'); return; }
  const { LexElement, defineLex } = Lex;

  const STYLESHEET_NAME = 'lex-connector-setup-card.css';
  const SCRIPT_MARKER = 'js/lex/chat/lex-connector-setup-card.js';
  const scriptSrc = (document.currentScript && document.currentScript.src) || '';
  // js/ and the app root, read from where this script was loaded.
  const appBase = scriptSrc.lastIndexOf(SCRIPT_MARKER) === -1 ? '' : scriptSrc.slice(0, scriptSrc.lastIndexOf(SCRIPT_MARKER));
  const jsBase = appBase ? appBase + 'js/' : 'js/';

  // What the Guided Connect wizard needs, in load order. Each entry is skipped
  // when its element or global already exists on the page.
  const WIZARD_SCRIPTS = [
    { tag: 'lex-btn', src: 'lex/components/foundation/lex-btn.js' },
    { tag: 'lex-spinner', src: 'lex/components/foundation/lex-spinner.js' },
    { tag: 'lex-drawer', src: 'lex/components/foundation/lex-drawer.js' },
    { tag: 'lex-stepper', src: 'lex/components/foundation/lex-stepper.js' },
    { tag: 'lex-input', src: 'lex/components/form/lex-input.js' },
    { tag: 'lex-select', src: 'lex/components/form/lex-select.js' },
    { tag: 'lex-toggle', src: 'lex/components/form/lex-toggle.js' },
    { tag: 'lex-radio', src: 'lex/components/form/lex-radio.js' },
    { tag: 'lex-connect-wizard', src: 'lex/components/integrations/lex-connect-wizard.js' },
    { global: 'Connectors', src: 'connectors.js' },
    { global: 'ConnectorOAuth', src: 'shared/connector-oauth-exchange.js' },
    { global: 'ConnectWizardModel', src: 'connect-wizard.model.js' },
    { has: function () { return !!(global.Lex && global.Lex.ConnectWizard); }, src: 'connect-wizard.js' }
  ];

  const loads = {};
  function present(entry) {
    if (entry.tag) return !!(global.customElements && global.customElements.get(entry.tag));
    if (entry.global) return !!global[entry.global];
    return entry.has();
  }
  function loadScript(entry) {
    if (present(entry)) return Promise.resolve(true);
    if (!loads[entry.src]) {
      loads[entry.src] = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = jsBase + entry.src;
        script.onload = function () { resolve(true); };
        script.onerror = function () { delete loads[entry.src]; reject(new Error(entry.src + ' could not be loaded')); };
        document.head.appendChild(script);
      });
    }
    return loads[entry.src];
  }
  function loadInOrder(entries) {
    return entries.reduce(function (chain, entry) {
      return chain.then(function () { return loadScript(entry); });
    }, Promise.resolve(true));
  }

  let stylesheetAdded = false;
  function ensureStylesheet() {
    if (stylesheetAdded || !appBase) return;
    stylesheetAdded = true;
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute('href') || '';
      if (href.slice(-STYLESHEET_NAME.length) === STYLESHEET_NAME) return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = appBase + 'css/components/' + STYLESHEET_NAME;
    document.head.appendChild(link);
  }

  function model() { return global.ConnectorSetupCardModel; }

  function wizardEnabled() {
    return !!(global.LanaConfig && global.LanaConfig.CONNECT_WIZARD_ENABLED === true);
  }

  function canManage() {
    return !!(Lex.Auth && typeof Lex.Auth.canAccessAdminPages === 'function' && Lex.Auth.canAccessAdminPages());
  }

  class LexConnectorSetupCard extends LexElement {
    static get properties() {
      return {
        connectorType: { type: String, default: '', attribute: 'connector-type' },
        connectorName: { type: String, default: '', attribute: 'connector-name' },
        scope: { type: String, default: 'org' }
      };
    }

    constructor() {
      super();
      this._status = 'loading';
      this._row = null;
      this._busy = false;
      this._readSeq = 0;
    }

    _card() {
      return model() ? model().normalizeCard({
        card_type: 'connector_setup', connector_type: this.connectorType, connector_name: this.connectorName, scope: this.scope
      }) : null;
    }

    connected() {
      ensureStylesheet();
      this.refresh();
    }

    /** Read the live status again (on render, and when the wizard closes). */
    async refresh() {
      const seq = ++this._readSeq;
      let rows = null;
      try {
        await loadScript({ global: 'Connectors', src: 'connectors.js' });
        const data = await global.Connectors.getAll();
        rows = data && Array.isArray(data.connectors) ? data.connectors : [];
      } catch (error) {
        console.warn('[lex-connector-setup-card] Status could not be read:', error && error.message);
        rows = null;
      }
      if (seq !== this._readSeq || !model()) return;
      const live = model().connectorStatus(rows, this.connectorType);
      this._status = live.status;
      this._row = live.row;
      this._scheduleUpdate();
    }

    render() {
      const card = this._card();
      if (!card) return '';
      const name = this.escapeHtml(card.connector_name);
      const icon = Lex.Icons && Lex.Icons.has && Lex.Icons.has('plug') ? String(Lex.Icons.plug) : '';
      if (this._status === 'loading') {
        return `<div class="lex-csc" role="group" aria-label="Connect ${name}">
          <div class="lex-csc__icon" aria-hidden="true">${icon}</div>
          <div class="lex-csc__body"><div class="lex-csc__name">${name}</div>
          <div class="lex-csc__status" data-status="loading">Checking status...</div></div>
        </div>`;
      }
      const view = model().cardView({ card: card, status: this._status, canManage: canManage(), wizardEnabled: wizardEnabled() });
      const action = view.label
        ? `<lex-btn variant="${view.action === 'setup' || view.action === 'navigate' ? 'primary' : 'outline'}" size="sm" data-action="${this.escapeHtml(view.action)}"${this._busy ? ' loading="true"' : ''}>${this.escapeHtml(view.label)}</lex-btn>`
        : '';
      const note = view.note ? `<p class="lex-csc__note">${this.escapeHtml(view.note)}</p>` : '';
      return `<div class="lex-csc" role="group" aria-label="Connect ${name}">
        <div class="lex-csc__icon" aria-hidden="true">${icon}</div>
        <div class="lex-csc__body">
          <div class="lex-csc__name">${name}</div>
          <div class="lex-csc__status" data-status="${this.escapeHtml(this._status)}">${this.escapeHtml(view.statusLabel)}</div>
          ${note}
        </div>
        <div class="lex-csc__action">${action}</div>
      </div>`;
    }

    updated() {
      this.delegate('click', '[data-action]', this._onAction.bind(this));
    }

    _onAction(event, target) {
      if (this._busy) return;
      const action = target.getAttribute('data-action');
      if (action === 'setup') { this._openWizard(); return; }
      if (action === 'navigate' || action === 'open') { this._openDataConnectors(); }
    }

    _openDataConnectors(sourceId) {
      const params = { connector: this.connectorType };
      const source = sourceId || (this._row && this._row.id) || '';
      if (source && source !== this.connectorType) params.source = String(source);
      if (Lex.Nav && typeof Lex.Nav.go === 'function') Lex.Nav.go('data-connectors.html', { params: params });
    }

    async _openWizard() {
      const card = this._card();
      this._busy = true;
      this._scheduleUpdate();
      try {
        await loadInOrder(WIZARD_SCRIPTS);
      } catch (error) {
        console.warn('[lex-connector-setup-card] Setup could not be loaded:', error && error.message);
        this._busy = false;
        this._openDataConnectors();
        return;
      }
      this._busy = false;
      this._scheduleUpdate();
      const openViewer = (detail) => this._openDataConnectors(detail && detail.sourceId);
      Lex.ConnectWizard.open({
        connectorType: card.connector_type,
        connectorName: card.connector_name,
        onDone: () => { this.refresh(); },
        onAdvanced: openViewer,
        onOpenConnector: openViewer
      });
    }
  }

  defineLex('lex-connector-setup-card', LexConnectorSetupCard);
})(typeof window !== 'undefined' ? window : globalThis);
