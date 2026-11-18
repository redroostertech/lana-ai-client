/**
 * connector-health-view.js
 * Plain, DOM-free view logic for the Data Connectors page
 * (data-connectors.html): the "Needs attention" summary, the Google
 * permission notices and the Add instance form.
 *
 * The backend decides health and re-auth. This module only maps its
 * payloads to short copy and markup:
 *   - GET /api/v1/integrations/connectors/health   -> healthView(payload),
 *     rowAttention (the row badge reason) and viewerNotice (the viewer notice)
 *   - write_access on rows of GET /connectors       -> reauthNotices(rows, dismissed)
 *   - POST /connectors/:slug/instances              -> validateInstanceKey, submitInstance
 *
 * Classic script (window.LanaConnectorHealthView, or module.exports in Node)
 * so Jest can require it, like connector-table.js.
 */
(function (global) {
  'use strict';

  // ── Connection health ───────────────────────────────────────────────

  // The backend reason code picks the copy (connector-health.model). Not
  // signed in is one of: auth_expired (OAuth: sign in again),
  // api_key_invalid (check the API key), credentials_invalid (check the
  // connection details), firm_app_credentials_invalid (the firm's own OAuth
  // app: fix it in Configuration, then sign in again),
  // app_credentials_invalid (LANA's OAuth app: contact support) or
  // not_connected (the kind is unknown: neutral copy).
  var REASON_COPY = {
    auth_expired: 'Not signed in. Sign in again to keep syncing.',
    api_key_invalid: 'The API key is missing or was not accepted.',
    credentials_invalid: 'The connection details are missing or were not accepted.',
    firm_app_credentials_invalid: 'Your OAuth app credentials for this connector were not accepted.',
    app_credentials_invalid: 'The app credentials for this connector need fixing. Signing in again will not help.',
    not_connected: 'This connection is not connected.',
    inactive: 'This connection is turned off.',
    sync_disabled: 'Syncing is turned off.',
    provider_unavailable: 'The provider was unavailable for several syncs, so syncing paused.',
    sync_error: 'The last sync failed.',
    stale_sync: 'No successful sync in the last day.',
    recent_failures: 'Some syncs failed today.',
    // The last sync skipped data the calendar needs (team members, events)
    // because the sign-in predates the permission it needs.
    calendar_people_need_reconnect: 'Reconnect to link calendar people.'
  };
  // What to do next, in the words of the connector viewer's tabs. The backend
  // lists reasons in precedence order, so the first one picks the step.
  var NEXT_STEP_COPY = {
    auth_expired: 'Go to Configuration and sign in again.',
    api_key_invalid: 'Go to Configuration and check the API key.',
    credentials_invalid: 'Go to Configuration and check the connection details.',
    firm_app_credentials_invalid: 'Fix the app credentials in Configuration, then sign in again.',
    app_credentials_invalid: 'Contact support to fix the app credentials.',
    not_connected: 'Go to Configuration and check the connection.',
    inactive: 'Go to Configuration and turn the connection back on.',
    sync_disabled: 'Go to Configuration and turn syncing back on.',
    provider_unavailable: 'Run a sync from the Run tab once the provider is back.',
    sync_error: 'Open Execution Logs to see what failed, then run a sync from Run.',
    stale_sync: 'Run a sync from the Run tab.',
    recent_failures: 'Open Execution Logs to see what failed.',
    calendar_people_need_reconnect: 'Go to Configuration and sign in again, or use a new key that allows reading users, so the calendar can link its people.'
  };
  var NOT_SIGNED_IN = ['auth_expired', 'api_key_invalid', 'credentials_invalid',
    'firm_app_credentials_invalid', 'app_credentials_invalid', 'not_connected'];
  // The summary button for the action the admin can take from the viewer;
  // every other reason opens it.
  var ACTION_COPY = {
    auth_expired: 'Sign in again',
    api_key_invalid: 'Check the API key',
    credentials_invalid: 'Check the connection details',
    firm_app_credentials_invalid: 'Fix the app credentials',
    not_connected: 'Check the connection',
    calendar_people_need_reconnect: 'Reconnect'
  };
  var FALLBACK_REASON = 'Something needs a look.';
  var ATTENTION_LIST_MAX = 5;

  function reasonText(code) {
    return REASON_COPY[String(code || '')] || FALLBACK_REASON;
  }

  /** Short copy for each reason code, without repeats. */
  function reasonList(codes) {
    var out = [];
    var list = Array.isArray(codes) ? codes : [];
    // Any not-signed-in reason already explains why nothing synced; do not
    // say both.
    var notSignedIn = NOT_SIGNED_IN.some(function (code) { return list.indexOf(code) !== -1; });
    list.forEach(function (code) {
      if (notSignedIn && code === 'stale_sync') return;
      var text = reasonText(code);
      if (out.indexOf(text) === -1) out.push(text);
    });
    return out.length ? out : [FALLBACK_REASON];
  }

  /** The summary button label for a list of reason codes. */
  function actionText(codes) {
    var list = Array.isArray(codes) ? codes : [];
    for (var i = 0; i < list.length; i += 1) {
      if (ACTION_COPY[list[i]]) return ACTION_COPY[list[i]];
    }
    return 'Open';
  }

  /** The next step for a list of reason codes, or '' when none is known. */
  function nextStepText(codes) {
    var list = Array.isArray(codes) ? codes : [];
    for (var i = 0; i < list.length; i += 1) {
      if (NEXT_STEP_COPY[list[i]]) return NEXT_STEP_COPY[list[i]];
    }
    return '';
  }

  /**
   * The health payload ({ success, data } or data) as what the page shows.
   * Only connections the backend marked needs_attention become items.
   */
  function healthView(payload) {
    var data = payload && payload.data && typeof payload.data === 'object' ? payload.data : (payload || {});
    var connections = Array.isArray(data.connections) ? data.connections : [];
    var summary = data.summary || {};
    var items = connections.filter(function (c) {
      return c && c.id && c.status === 'needs_attention';
    }).map(function (c) {
      var reasons = Array.isArray(c.reasons) ? c.reasons : [];
      var copy = reasonList(reasons);
      return {
        id: String(c.id),
        connectorId: c.connector_id || '',
        name: c.name || c.connector_id || 'Connection',
        scope: c.scope === 'personal' ? 'personal' : 'organization',
        reasons: copy,
        reasonText: copy.join(' '),
        nextStep: nextStepText(reasons),
        action: actionText(reasons)
      };
    });
    var attention = {};
    var byId = {};
    items.forEach(function (item) {
      attention[item.id] = true;
      byId[item.id] = item;
    });
    var needsAttention = typeof summary.needs_attention === 'number' ? summary.needs_attention : items.length;
    return {
      total: typeof summary.total === 'number' ? summary.total : connections.length,
      healthy: typeof summary.healthy === 'number' ? summary.healthy : connections.length - items.length,
      needsAttention: needsAttention,
      items: items,
      attention: attention,
      byId: byId,
      checkedAt: data.checked_at || null
    };
  }

  /** True when a connector row's source is in the needs_attention list. */
  function rowNeedsAttention(view, ids) {
    if (!view || !view.attention) return false;
    return (ids || []).some(function (id) { return id != null && view.attention[String(id)] === true; });
  }

  /** The flagged item for a connector row (its reasonText, nextStep), or null. */
  function rowAttention(view, ids) {
    if (!view || !view.byId) return null;
    var list = ids || [];
    for (var i = 0; i < list.length; i += 1) {
      var id = list[i];
      if (id != null && view.byId[String(id)]) return view.byId[String(id)];
    }
    return null;
  }

  /** What the connector viewer shows for its source: { name, reason, nextStep } or null when healthy. */
  function viewerNotice(view, sourceId) {
    if (!sourceId) return null;
    var item = rowAttention(view, [sourceId]);
    if (!item) return null;
    return { name: item.name, reason: item.reasonText, nextStep: item.nextStep };
  }

  // ── Google write permission (write_access.needs_reauth) ────────────

  var CAPABILITY_COPY = {
    send_email: 'send email',
    create_calendar_events: 'create calendar events',
    write_sheets: 'edit Sheets'
  };

  function capabilityText(capability) {
    return CAPABILITY_COPY[String(capability || '')] || 'make changes';
  }

  function reauthKey(row) {
    var access = row && row.write_access;
    return String(row && row.id) + ':' + String(access && access.capability || '');
  }

  function rowName(row) {
    return row.name || row.source_name || row.connector_name || row.connector_id || 'This connection';
  }

  /**
   * One notice per row whose write_access.needs_reauth is exactly true and
   * that this viewer has not dismissed. false and null show nothing.
   */
  function reauthNotices(rows, dismissed) {
    var hidden = Array.isArray(dismissed) ? dismissed : [];
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row && row.id && row.write_access && row.write_access.needs_reauth === true &&
        hidden.indexOf(reauthKey(row)) === -1;
    }).map(function (row) {
      var name = rowName(row);
      return {
        key: reauthKey(row),
        id: String(row.id),
        name: name,
        text: name + ' needs permission to ' + capabilityText(row.write_access.capability) +
          '. Automations that do this will fail until you reconnect.'
      };
    });
  }

  var DISMISS_STORAGE_KEY = 'lana_dc_dismissed_reauth';

  function storageOf(storage) {
    if (storage) return storage;
    try {
      return global && global.localStorage ? global.localStorage : null;
    } catch (_error) {
      return null;
    }
  }

  /** Dismissed notice keys for this viewer ([] when storage is missing or blocked). */
  function readDismissed(storage) {
    try {
      var store = storageOf(storage);
      var raw = store ? store.getItem(DISMISS_STORAGE_KEY) : null;
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (k) { return typeof k === 'string' && k; }) : [];
    } catch (_error) {
      return [];
    }
  }

  /** Remember one dismissed key. Returns the new list, even if saving fails. */
  function rememberDismissed(key, storage) {
    var list = readDismissed(storage);
    if (key && list.indexOf(key) === -1) list.push(key);
    try {
      var store = storageOf(storage);
      if (store) store.setItem(DISMISS_STORAGE_KEY, JSON.stringify(list));
    } catch (_error) {
      // Private window or blocked storage: the notice stays hidden for this visit only.
    }
    return list;
  }

  // ── Add instance ────────────────────────────────────────────────────

  /** Same rules as the server: 1 to 100 letters, numbers or hyphens, starts with a letter or number, not "default". */
  function validateInstanceKey(value) {
    var key = String(value == null ? '' : value).trim();
    if (!key) return { ok: false, key: key, error: 'Enter a name.' };
    if (key.length > 100) return { ok: false, key: key, error: 'Use 100 characters or fewer.' };
    if (!/^[A-Za-z0-9]/.test(key)) return { ok: false, key: key, error: 'Start with a letter or number.' };
    if (!/^[A-Za-z0-9-]+$/.test(key)) return { ok: false, key: key, error: 'Use only letters, numbers and hyphens.' };
    if (key.toLowerCase() === 'default') return { ok: false, key: key, error: 'That name is saved for the first one. Pick another.' };
    return { ok: true, key: key, error: '' };
  }

  /** A failed create as one plain sentence. */
  function instanceErrorText(error) {
    var status = error && error.status;
    var data = (error && error.data) || {};
    if (status === 409) {
      return data.instance_key
        ? 'That name is already used. Pick another.'
        : 'Connect this tool once first. Then you can add another.';
    }
    if (status === 403) return 'Only admins can add another one.';
    if (status === 400) return (error && error.message) || 'That name did not work. Try another.';
    return 'Could not add it. Try again.';
  }

  /**
   * Validate, then call Connectors.createInstance(slug, key).
   * Resolves { ok: true, key, result } or { ok: false, error }.
   */
  function submitInstance(connectors, slug, rawKey) {
    var check = validateInstanceKey(rawKey);
    if (!check.ok) return Promise.resolve({ ok: false, error: check.error });
    if (!connectors || typeof connectors.createInstance !== 'function' || !slug) {
      return Promise.resolve({ ok: false, error: 'Could not add it. Try again.' });
    }
    return Promise.resolve()
      .then(function () { return connectors.createInstance(slug, check.key); })
      .then(function (result) { return { ok: true, key: check.key, result: result }; })
      .catch(function (error) { return { ok: false, error: instanceErrorText(error) }; });
  }

  /** Copy for the Add instance form, from the connector's multi_instance manifest. */
  function instanceForm(name, multi) {
    var m = multi || {};
    return {
      heading: 'Add another ' + (name || 'connection'),
      label: m.instance_label || 'Name',
      help: m.instance_helper_text || 'Use letters, numbers and hyphens. No spaces.',
      placeholder: m.instance_placeholder || 'second-account'
    };
  }

  // ── Markup ──────────────────────────────────────────────────────────

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * The "Needs attention" summary, or '' when nothing needs attention.
   * options.expanded shows every item; otherwise the first ATTENTION_LIST_MAX
   * show and the rest wait behind "Show all".
   */
  function attentionMarkup(view, options) {
    if (!view || !view.needsAttention || !view.items.length) return '';
    var count = view.items.length;
    var expanded = Boolean(options && options.expanded);
    // A long list would push the connectors far down, so it starts short.
    var more = Math.max(0, count - ATTENTION_LIST_MAX);
    var rows = view.items.map(function (item, index) {
      var hidden = !expanded && index >= ATTENTION_LIST_MAX ? ' hidden' : '';
      return '<li class="dc-attention-item"' + hidden + '>' +
        '<div class="dc-attention-text"><strong class="dc-attention-name">' + esc(item.name) + '</strong>' +
        '<span class="dc-attention-reason">' + esc(item.reasons.join(' ')) + '</span></div>' +
        '<lex-btn variant="secondary" size="sm" data-dc-health-open="' + esc(item.id) + '"' +
        ' data-dc-health-connector="' + esc(item.connectorId) + '">' + esc(item.action) + '</lex-btn>' +
        '</li>';
    }).join('');
    return '<div class="dc-attention-head">' +
      '<lex-badge label="Needs attention" color="yellow" size="sm"></lex-badge>' +
      '<span class="dc-attention-count">' + count + (count === 1 ? ' connection needs a look.' : ' connections need a look.') + '</span>' +
      '</div><ul class="dc-attention-list">' + rows + '</ul>' +
      (more > 0
        ? '<div class="dc-attention-more">' +
          (expanded ? '' : '<span>And ' + more + ' more.</span>') +
          '<lex-btn variant="ghost" size="sm" data-dc-attention-toggle aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
          (expanded ? 'Show fewer' : 'Show all ' + count) + '</lex-btn></div>'
        : '');
  }

  /** The connector viewer's notice for a flagged source, or ''. */
  function viewerNoticeMarkup(notice) {
    if (!notice) return '';
    return '<div class="connector-health-notice" role="status">' +
      '<lex-badge label="Needs attention" color="yellow" size="sm"></lex-badge>' +
      '<div class="connector-health-notice-text">' +
      '<p class="connector-health-notice-reason">' + esc(notice.reason || FALLBACK_REASON) + '</p>' +
      (notice.nextStep ? '<p class="connector-health-notice-step">' + esc(notice.nextStep) + '</p>' : '') +
      '</div></div>';
  }

  /** The permission notices, or '' when there are none. */
  function reauthMarkup(notices) {
    if (!notices || !notices.length) return '';
    return notices.map(function (notice) {
      return '<div class="dc-reauth" role="status">' +
        '<lex-badge label="Permission needed" color="yellow" size="sm"></lex-badge>' +
        '<p class="dc-reauth-text">' + esc(notice.text) + '</p>' +
        '<div class="dc-reauth-actions">' +
        '<lex-btn variant="secondary" size="sm" data-dc-reauth-open="' + esc(notice.id) + '">Reconnect</lex-btn>' +
        '<lex-btn variant="ghost" size="sm" data-dc-reauth-dismiss="' + esc(notice.key) + '">Dismiss</lex-btn>' +
        '</div></div>';
    }).join('');
  }

  var moduleApi = {
    REASON_COPY: REASON_COPY,
    NEXT_STEP_COPY: NEXT_STEP_COPY,
    CAPABILITY_COPY: CAPABILITY_COPY,
    DISMISS_STORAGE_KEY: DISMISS_STORAGE_KEY,
    reasonText: reasonText,
    reasonList: reasonList,
    healthView: healthView,
    rowNeedsAttention: rowNeedsAttention,
    rowAttention: rowAttention,
    nextStepText: nextStepText,
    actionText: actionText,
    viewerNotice: viewerNotice,
    viewerNoticeMarkup: viewerNoticeMarkup,
    capabilityText: capabilityText,
    reauthNotices: reauthNotices,
    readDismissed: readDismissed,
    rememberDismissed: rememberDismissed,
    validateInstanceKey: validateInstanceKey,
    instanceErrorText: instanceErrorText,
    submitInstance: submitInstance,
    instanceForm: instanceForm,
    attentionMarkup: attentionMarkup,
    reauthMarkup: reauthMarkup
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaConnectorHealthView = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
