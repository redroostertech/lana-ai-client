/*
 * ActivationFlow - the plain logic behind "Have an activation code?" on the
 * sign-in screen.
 *
 * A person gets one email with the Organization ID and a one-time activation
 * code (10 characters, shown as XXXXX-XXXXX). In the app they enter both with
 * their email, choose a password, and are signed in. The server decides whether
 * the code is good (POST /api/v1/auth/activate); this module only tidies what was
 * typed, shapes the request, and turns the server's answer into plain words.
 *
 * Plain module: no DOM, so it is tested directly.
 */
(function (global) {
  'use strict';

  var ACTIVATE_PATH = '/api/v1/auth/activate';
  var CODE_LENGTH = 10;
  // Crockford base32: no I, L, O or U.
  var CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  // Letters that are easy to misread in an email: Crockford reads them as digits.
  var LOOKALIKES = { O: '0', I: '1', L: '1' };

  // The existing password policy hints (same rules as Settings > Security).
  var PASSWORD_SPECIALS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  var PASSWORD_RULES = [
    { id: 'length', label: 'At least 8 characters' },
    { id: 'upper', label: 'One uppercase letter' },
    { id: 'lower', label: 'One lowercase letter' },
    { id: 'number', label: 'One number' },
    { id: 'special', label: 'One special character' }
  ];

  /** Upper case, dashes and spaces removed, lookalike letters read as digits. */
  function normalizeActivationCode(raw) {
    var out = '';
    var text = String(raw == null ? '' : raw).toUpperCase();
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '-' || /\s/.test(ch)) continue;
      out += LOOKALIKES[ch] || ch;
    }
    return out;
  }

  /** True when the code has 10 characters, all from the code alphabet. */
  function isCompleteCode(raw) {
    var code = normalizeActivationCode(raw);
    if (code.length !== CODE_LENGTH) return false;
    for (var i = 0; i < code.length; i++) {
      if (CODE_ALPHABET.indexOf(code.charAt(i)) === -1) return false;
    }
    return true;
  }

  /** XXXXX-XXXXX for display; a partial code keeps what was typed. */
  function formatActivationCode(raw) {
    var code = normalizeActivationCode(raw);
    if (code.length <= 5) return code;
    return code.slice(0, 5) + '-' + code.slice(5);
  }

  function checkPassword(password) {
    var text = String(password || '');
    var result = { length: text.length >= 8, upper: false, lower: false, number: false, special: false };
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch >= 'A' && ch <= 'Z') result.upper = true;
      if (ch >= 'a' && ch <= 'z') result.lower = true;
      if (ch >= '0' && ch <= '9') result.number = true;
      if (PASSWORD_SPECIALS.indexOf(ch) !== -1) result.special = true;
    }
    return result;
  }

  function passwordMeetsPolicy(password) {
    var checks = checkPassword(password);
    return PASSWORD_RULES.every(function (rule) { return checks[rule.id]; });
  }

  function looksLikeEmail(value) {
    var v = String(value || '').trim();
    var at = v.indexOf('@');
    if (at < 1 || v.indexOf(' ') !== -1) return false;
    var domain = v.slice(at + 1);
    var dot = domain.lastIndexOf('.');
    return dot > 0 && dot < domain.length - 1;
  }

  /**
   * Check the form before anything is sent.
   * @returns {{ ok: true } | { ok: false, field: string, message: string }}
   */
  function validateForm(values) {
    var v = values || {};
    if (!String(v.orgId || '').trim()) {
      return { ok: false, field: 'orgId', message: 'Enter your Organization ID.' };
    }
    if (!looksLikeEmail(v.email)) {
      return { ok: false, field: 'email', message: 'Enter the email address the activation email was sent to.' };
    }
    if (!isCompleteCode(v.code)) {
      return { ok: false, field: 'code', message: 'Enter the 10 character code from your activation email, like ABCDE-12345.' };
    }
    if (!passwordMeetsPolicy(v.password)) {
      return { ok: false, field: 'password', message: 'Choose a password that meets every requirement below.' };
    }
    if (String(v.password) !== String(v.confirm == null ? '' : v.confirm)) {
      return { ok: false, field: 'confirm', message: 'The two passwords do not match.' };
    }
    return { ok: true };
  }

  /** The request body for POST /api/v1/auth/activate. */
  function buildActivateRequest(values) {
    var v = values || {};
    return {
      path: ACTIVATE_PATH,
      body: {
        email: String(v.email || '').trim(),
        code: normalizeActivationCode(v.code),
        new_password: String(v.password || '')
      }
    };
  }

  /** Plain words for a failed activation (an ApiError from api.js). */
  function activationErrorMessage(error) {
    var code = error && error.code;
    var status = error && error.status;
    if (code === 'ACTIVATION_CODE_INVALID') {
      return 'That code did not work for this email address. Check both against your activation email. ' +
        'A code works once and expires after 7 days; if yours is used or expired, ask your administrator to send a new one.';
    }
    if (code === 'ACTIVATION_CODE_LOCKED') {
      return 'This code was entered wrong too many times and no longer works. ' +
        'Ask your administrator to send you a new activation email.';
    }
    if (code === 'PASSWORD_POLICY') {
      var detail = error && error.data && error.data.detail;
      return 'Your organization needs a stronger password.' + (detail ? ' ' + detail : ' Choose one that meets every requirement below.');
    }
    if (status === 429) {
      return 'Too many tries. Wait a few minutes, then try again.';
    }
    if (status === 0 || status === 408) {
      return 'LANA could not reach your organization\'s server. Check this computer\'s connection and try again.';
    }
    return 'Activation did not go through. Try again, or ask your administrator for a new activation email.';
  }

  var api = {
    ACTIVATE_PATH: ACTIVATE_PATH,
    CODE_LENGTH: CODE_LENGTH,
    CODE_ALPHABET: CODE_ALPHABET,
    PASSWORD_RULES: PASSWORD_RULES,
    normalizeActivationCode: normalizeActivationCode,
    isCompleteCode: isCompleteCode,
    formatActivationCode: formatActivationCode,
    checkPassword: checkPassword,
    passwordMeetsPolicy: passwordMeetsPolicy,
    validateForm: validateForm,
    buildActivateRequest: buildActivateRequest,
    activationErrorMessage: activationErrorMessage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.LanaActivationFlow = api;
  }
})(typeof window !== 'undefined' ? window : this);
