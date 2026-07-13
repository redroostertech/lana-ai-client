/* ==========================================================================
   LANA One - Cloud relay settings: pure state logic

   All the decision logic for the Cloud relay section on the Account page,
   extracted from the DOM so it is unit-testable (see
   client/tests/unit/relay-settings-state.test.js).

   No DOM access. No network. No regex beyond simple whitespace checks.
   Exposed as window.LanaRelayState in the browser and via module.exports
   for jest (same pattern as js/billing/pricing-tiers.js).

   FUTURE (automated minting): when the desktop sign-in flow lands, a
   settings payload with source 'cloud_signin' renders as "Connected via
   sign-in" through deriveView below; no rework needed here.
   ========================================================================== */

(function () {
  'use strict';

  var DEFAULT_BASE_URL = 'https://one.lanaai.io/api/v1/relay';

  function isBlank(value) {
    return typeof value !== 'string' || value.trim().length === 0;
  }

  function hasWhitespace(value) {
    return value.indexOf(' ') !== -1 ||
           value.indexOf('\t') !== -1 ||
           value.indexOf('\n') !== -1 ||
           value.indexOf('\r') !== -1;
  }

  /** Validate an http(s) URL without regex. Returns normalized URL or null. */
  function normalizeBaseUrl(raw) {
    if (isBlank(raw)) return null;
    var trimmed = raw.trim();
    var parsed;
    try {
      parsed = new URL(trimmed);
    } catch (e) {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    while (trimmed.length > 0 && trimmed.charAt(trimmed.length - 1) === '/') {
      trimmed = trimmed.slice(0, -1);
    }
    return trimmed;
  }

  /**
   * Derive the view model for the section from the GET /settings/relay
   * response data. Never contains the token; only masked fields.
   *
   * @param {Object} settings backend data object (or null while loading)
   * @returns {Object} view model
   */
  function deriveView(settings) {
    if (!settings) {
      return {
        statusLabel: 'Loading',
        statusColor: 'gray',
        statusDetail: '',
        baseUrl: DEFAULT_BASE_URL,
        tokenPlaceholder: 'Paste your relay token',
        configured: false,
        canDisconnect: false,
        manualDisabled: true
      };
    }

    var baseUrl = settings.base_url || settings.default_base_url || DEFAULT_BASE_URL;

    if (settings.env_pinned) {
      return {
        statusLabel: 'Managed by environment',
        statusColor: 'blue',
        statusDetail: 'The relay is pinned by this deployment. Saved settings apply only when the environment key is removed.',
        baseUrl: baseUrl,
        tokenPlaceholder: 'Paste your relay token',
        configured: !!settings.configured,
        canDisconnect: !!settings.configured,
        manualDisabled: false
      };
    }

    if (settings.configured) {
      var last4 = settings.token_last4 || '';
      var viaSignin = settings.source === 'cloud_signin';
      return {
        statusLabel: viaSignin ? 'Connected via sign-in' : 'Configured',
        statusColor: 'green',
        statusDetail: last4
          ? 'Token ending in ' + last4 + ' is saved on this device.'
          : 'A relay token is saved on this device.',
        baseUrl: baseUrl,
        tokenPlaceholder: last4 ? 'Saved (....' + last4 + '). Paste to replace' : 'Saved. Paste to replace',
        configured: true,
        canDisconnect: true,
        manualDisabled: false
      };
    }

    return {
      statusLabel: 'Not configured',
      statusColor: 'gray',
      statusDetail: 'Paste a relay token to use cloud models through your LANA account.',
      baseUrl: baseUrl,
      tokenPlaceholder: 'Paste your relay token',
      configured: false,
      canDisconnect: false,
      manualDisabled: false
    };
  }

  /**
   * Validate the manual-entry inputs and build the PUT payload.
   * A token is required on first save; once a token is saved (tokenSet),
   * a URL-only save is allowed.
   *
   * @param {{baseUrl: string, token: string, tokenSet: boolean}} input
   * @returns {{ok: boolean, error?: string, payload?: Object}}
   */
  function validateSaveInput(input) {
    input = input || {};
    var normalizedUrl = normalizeBaseUrl(input.baseUrl);
    var tokenProvided = !isBlank(input.token);

    if (!isBlank(input.baseUrl) && !normalizedUrl) {
      return { ok: false, error: 'Enter a valid relay URL (https://...).' };
    }

    if (tokenProvided && hasWhitespace(input.token.trim())) {
      return { ok: false, error: 'The relay token cannot contain spaces.' };
    }

    if (!tokenProvided && !input.tokenSet) {
      return { ok: false, error: 'Paste a relay token to connect.' };
    }

    if (!tokenProvided && !normalizedUrl) {
      return { ok: false, error: 'Nothing to save.' };
    }

    var payload = {};
    if (normalizedUrl) payload.base_url = normalizedUrl;
    if (tokenProvided) payload.token = input.token.trim();
    return { ok: true, payload: payload };
  }

  /**
   * Build the POST /settings/relay/test payload from the current inputs.
   * Unsaved values are sent so a pasted token can be probed before saving;
   * blank fields are omitted so the backend falls back to stored/env values.
   */
  function buildTestPayload(input) {
    input = input || {};
    var payload = {};
    var normalizedUrl = normalizeBaseUrl(input.baseUrl);
    if (normalizedUrl) payload.base_url = normalizedUrl;
    if (!isBlank(input.token)) payload.token = input.token.trim();
    return payload;
  }

  /**
   * Map a test-connection response (backend data object) to UI feedback.
   *
   * @param {Object} data { ok, reason?, status?, models_count? }
   * @returns {{label: string, color: string, detail: string, ok: boolean}}
   */
  function mapTestResult(data) {
    if (data && data.ok) {
      var count = (typeof data.models_count === 'number') ? data.models_count : null;
      return {
        ok: true,
        label: 'Connected',
        color: 'green',
        detail: count !== null
          ? 'The relay responded with ' + count + ' available model' + (count === 1 ? '' : 's') + '.'
          : 'The relay responded successfully.'
      };
    }

    var reason = data && data.reason;
    if (reason === 'unauthorized') {
      return {
        ok: false,
        label: 'Unauthorized',
        color: 'red',
        detail: 'The relay rejected this token. Check the token or mint a new one from your LANA account.'
      };
    }
    if (reason === 'unreachable') {
      return {
        ok: false,
        label: 'Unreachable',
        color: 'yellow',
        detail: 'Could not reach the relay. Check the URL and your network connection.'
      };
    }
    if (reason === 'no_token') {
      return {
        ok: false,
        label: 'No token',
        color: 'gray',
        detail: 'Paste a relay token first, then test the connection.'
      };
    }
    var status = data && data.status;
    return {
      ok: false,
      label: 'Error',
      color: 'red',
      detail: status
        ? 'The relay returned an unexpected status (' + status + ').'
        : 'The connection test failed.'
    };
  }

  var api = {
    DEFAULT_BASE_URL: DEFAULT_BASE_URL,
    normalizeBaseUrl: normalizeBaseUrl,
    deriveView: deriveView,
    validateSaveInput: validateSaveInput,
    buildTestPayload: buildTestPayload,
    mapTestResult: mapTestResult
  };

  if (typeof window !== 'undefined') {
    window.LanaRelayState = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

})();
