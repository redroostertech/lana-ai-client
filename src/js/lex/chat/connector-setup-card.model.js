/* ==========================================================================
   Connector setup card model (pure, unit tested)

   The backend's chat answer to "connect Stripe" carries a card descriptor:
     { card_type: 'connector_setup', connector_type, connector_name, scope }
   It names a connector and nothing else. This module turns that descriptor
   plus the live GET /api/v1/integrations/connectors list into what the card
   shows: a status and one action.

   Status mirrors getConnectorStatusKey in data_connectors.js (a row that says
   connected, or carries meaningful config, is connected; a row that says
   disconnected is disconnected; otherwise not connected), so the card and
   the Data Connectors table never disagree. The parity is pinned by
   tests/unit/connector-setup-card-model.test.js.

   Actions:
     setup      "Set up {name}"  opens the Guided Connect wizard
     navigate   "Set up {name}"  wizard flag off: opens Data Connectors
     open       "Open {name}"    connected or disconnected: opens Data Connectors
     ask_admin  text only        organization connector, user is not an admin
     none       text only        status could not be read, connected org
                                 connector for a non admin
   The backend still authorizes every call the wizard makes.
   ========================================================================== */

(function (global) {
  'use strict';

  var CARD_TYPE = 'connector_setup';
  // Config keys that do not show a connection (data_connectors.js
  // connectorHasMeaningfulConfig).
  var OPERATIONAL_KEYS = {
    sync_frequency: true,
    scheduled_sync_time: true,
    sync_interval_minutes: true,
    last_sync: true,
    guided_connect_pending: true
  };

  function lower(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  /** The card descriptor, or null when it is not a usable connector setup card. */
  function normalizeCard(descriptor) {
    if (!descriptor || descriptor.card_type !== CARD_TYPE) return null;
    var type = typeof descriptor.connector_type === 'string' ? descriptor.connector_type.trim() : '';
    if (!type) return null;
    var name = typeof descriptor.connector_name === 'string' && descriptor.connector_name.trim()
      ? descriptor.connector_name.trim() : type;
    return { card_type: CARD_TYPE, connector_type: type, connector_name: name, scope: descriptor.scope === 'user' ? 'user' : 'org' };
  }

  function hasMeaningfulConfig(row) {
    var config = row && row.config && typeof row.config === 'object' ? row.config : {};
    return Object.keys(config).some(function (key) {
      if (!key || key.slice(-11) === '_configured' || OPERATIONAL_KEYS[key]) return false;
      var value = config[key];
      if (value == null) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    });
  }

  /** One row's status, as getConnectorStatusKey reads it. */
  function rowStatus(row) {
    var raw = lower(row && (row.status || row.auth_status));
    if (raw === 'connected') return 'connected';
    if (raw === 'disconnected') return 'disconnected';
    if (hasMeaningfulConfig(row)) return 'connected';
    return 'not_connected';
  }

  function rowsFor(rows, connectorType) {
    var wanted = lower(connectorType);
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      if (!row) return false;
      return lower(row.connector_type) === wanted || lower(row.connector_id) === wanted || lower(row.id) === wanted;
    });
  }

  /**
   * The live status of the card's connector.
   * @param {Array|null} rows - GET /connectors list; null when it could not be read
   * @param {string} connectorType
   * @returns {{ status: string, row: Object|null }} status is connected,
   *   disconnected, not_connected or unknown
   */
  function connectorStatus(rows, connectorType) {
    if (!Array.isArray(rows)) return { status: 'unknown', row: null };
    var matches = rowsFor(rows, connectorType);
    var order = ['connected', 'disconnected', 'not_connected'];
    var best = { status: 'not_connected', row: null };
    matches.forEach(function (row) {
      var status = rowStatus(row);
      if (best.row === null || order.indexOf(status) < order.indexOf(best.status)) best = { status: status, row: row };
    });
    return best;
  }

  var STATUS_LABELS = {
    connected: 'Connected',
    disconnected: 'Disconnected',
    not_connected: 'Not connected',
    unknown: 'Status unavailable'
  };

  /**
   * What the card shows for this status and user.
   * @param {Object} input
   * @param {Object} input.card - normalizeCard() output
   * @param {string} input.status - connectorStatus().status
   * @param {boolean} input.canManage - the user may set up organization connectors
   * @param {boolean} input.wizardEnabled - LanaConfig.CONNECT_WIZARD_ENABLED
   * @returns {{ statusLabel: string, action: string, label: string, note: string }}
   */
  function cardView(input) {
    var card = input.card;
    var name = card.connector_name;
    var view = { statusLabel: STATUS_LABELS[input.status] || STATUS_LABELS.unknown, action: 'none', label: '', note: '' };
    var adminOnly = card.scope === 'org' && input.canManage !== true;
    if (input.status === 'connected' || input.status === 'disconnected') {
      if (adminOnly) {
        view.note = input.status === 'connected' ? name + ' is connected.' : 'Ask an admin to reconnect ' + name + '.';
        return view;
      }
      view.action = 'open';
      view.label = 'Open ' + name;
      return view;
    }
    if (adminOnly) {
      view.action = 'ask_admin';
      view.note = 'Ask an admin to connect ' + name + '.';
      return view;
    }
    if (input.status === 'unknown') {
      view.action = 'navigate';
      view.label = 'Open Data Connectors';
      return view;
    }
    view.action = input.wizardEnabled === true ? 'setup' : 'navigate';
    view.label = 'Set up ' + name;
    return view;
  }

  var api = {
    CARD_TYPE: CARD_TYPE,
    normalizeCard: normalizeCard,
    rowStatus: rowStatus,
    connectorStatus: connectorStatus,
    cardView: cardView
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ConnectorSetupCardModel = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
