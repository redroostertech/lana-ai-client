/*
 * AccountStatus - classify a failed login so the client can route the user.
 *
 * Users are created with `pending` status and activate with a LANA-XXXX-XXXX-XXXX
 * code (docs/README.md). Logging in before that fails, and the user was left on
 * the login form with a generic error and no path forward. Those users belong on
 * activate.html.
 *
 * What the server actually sends for this case:
 *
 *   HTTP 401 {"error":{"message":"Account is not active","code":"AUTHENTICATION_ERROR"}}
 *
 * Note what is missing. The code is `AUTHENTICATION_ERROR` — byte-identical to a
 * wrong-password rejection — and there is no status field or is_active flag. The
 * message string is the only thing separating "activate your account" from "check
 * your password", which is why the message patterns below are load-bearing rather
 * than a fallback. If the API ever grows a dedicated code, add it to PENDING_CODES
 * and it will take priority automatically.
 *
 * That message also does not distinguish a never-activated account from one an
 * admin switched off; both read "Account is not active". Since activation is the
 * actionable case and the only one the user can resolve, ambiguous wording routes
 * to activation. 'account_disabled' is reserved for unambiguous signals — an
 * explicit `deactivated`/`suspended` status or a dedicated error code — where
 * sending someone to an activation form would be a dead end.
 *
 * Detection is layered: status string first, then error code, then message.
 * Classification never guesses — anything unrecognized returns 'unknown' and the
 * caller keeps its existing error handling.
 */
(function (global) {
  'use strict';

  var PENDING_STATUSES = ['pending', 'invited', 'pending_activation', 'unactivated', 'inactive'];
  var DISABLED_STATUSES = ['deactivated', 'disabled', 'suspended', 'locked'];

  var PENDING_CODES = [
    'ACCOUNT_NOT_ACTIVATED',
    'ACCOUNT_PENDING_ACTIVATION',
    'ACCOUNT_PENDING',
    'PENDING_ACTIVATION',
    'ACTIVATION_REQUIRED',
    'ACCOUNT_ACTIVATION_REQUIRED',
    'USER_NOT_ACTIVATED'
  ];
  var DISABLED_CODES = [
    'ACCOUNT_DISABLED',
    'ACCOUNT_DEACTIVATED',
    'ACCOUNT_SUSPENDED',
    'ACCOUNT_LOCKED',
    'USER_DEACTIVATED'
  ];

  // Message fallbacks. Activation wording wins over the vaguer "inactive"
  // wording so "your account is inactive, please activate it" routes to setup.
  var PENDING_PATTERNS = [
    // The live signal. /api/v1/auth/login answers an unactivated account with
    // HTTP 401 {"error":{"message":"Account is not active","code":"AUTHENTICATION_ERROR"}}
    // — the same code it uses for a wrong password, and with no status field, so
    // this wording is the only thing that distinguishes the two.
    /\bnot\s+active\b/i,
    /\b(account|user)\s+(is\s+)?inactive\b/i,
    /activat(e|ion)\s+(your\s+)?account/i,
    // Requires an explicit negation so a success message ("account activated")
    // is never classified as a failure needing activation.
    /account\s+(has\s+not\s+been|is\s+not|was\s+not|not)\s+activated/i,
    /(must|needs?\s+to|please)\s+activate/i,
    /pending\s+activation/i,
    /activation\s+(code|key)\s+(is\s+)?required/i
  ];
  var DISABLED_PATTERNS = [
    /deactivated/i,
    /disabled/i,
    /suspended/i,
    /locked/i
  ];

  function normalize(value) {
    return value ? String(value).trim().toLowerCase() : '';
  }

  function contains(list, value) {
    return list.indexOf(value) !== -1;
  }

  function matchesAny(patterns, text) {
    if (!text) return false;
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(text)) return true;
    }
    return false;
  }

  /**
   * Pull a status string out of whichever shape the error payload uses.
   */
  function extractStatus(err) {
    var data = err && err.data;
    if (!data) return '';
    var candidates = [
      data.status,
      data.account_status,
      data.user_status,
      data.user && data.user.status,
      data.error && data.error.status,
      data.error && data.error.account_status
    ];
    for (var i = 0; i < candidates.length; i++) {
      // `status` on the envelope root can be an HTTP number; only strings are
      // account states.
      if (typeof candidates[i] === 'string' && candidates[i]) return normalize(candidates[i]);
    }
    // Some payloads express it as a boolean instead of a string.
    if (data.is_active === false) return 'inactive';
    if (data.user && data.user.is_active === false) return 'inactive';
    return '';
  }

  function extractCode(err) {
    if (!err) return '';
    if (err.code) return String(err.code).toUpperCase();
    var data = err.data;
    if (!data) return '';
    var code = data.code || (data.error && data.error.code);
    return code ? String(code).toUpperCase() : '';
  }

  function extractMessage(err) {
    if (!err) return '';
    var data = err.data;
    var fromData = data && ((data.error && data.error.message) || data.message || data.detail);
    return String(fromData || err.message || '');
  }

  /**
   * Classify a login failure.
   * @param {Error} err rejected ApiError from api.login
   * @returns {'activation_required'|'account_disabled'|'unknown'}
   */
  function classifyLoginFailure(err) {
    if (!err) return 'unknown';

    // 1. Explicit status string is the most trustworthy signal.
    var status = extractStatus(err);
    if (status) {
      if (contains(PENDING_STATUSES, status)) return 'activation_required';
      if (contains(DISABLED_STATUSES, status)) return 'account_disabled';
    }

    // 2. Server error code.
    var code = extractCode(err);
    if (code) {
      if (contains(PENDING_CODES, code)) return 'activation_required';
      if (contains(DISABLED_CODES, code)) return 'account_disabled';
    }

    // 3. Human message, activation wording first.
    var message = extractMessage(err);
    if (matchesAny(PENDING_PATTERNS, message)) return 'activation_required';
    if (matchesAny(DISABLED_PATTERNS, message)) return 'account_disabled';

    return 'unknown';
  }

  function needsActivation(err) {
    return classifyLoginFailure(err) === 'activation_required';
  }

  function isDisabled(err) {
    return classifyLoginFailure(err) === 'account_disabled';
  }

  var api = {
    classifyLoginFailure: classifyLoginFailure,
    needsActivation: needsActivation,
    isDisabled: isDisabled
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.AccountStatus = api;
  }
})(typeof window !== 'undefined' ? window : this);
