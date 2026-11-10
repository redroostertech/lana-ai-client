/*
 * LanaMfaEnrollment - set up two-step sign in (TOTP) for the signed-in user.
 *
 * Shared by Settings (settings-v2.js, the Two-Factor Authentication card) and
 * the required-enrollment page (mfa-setup.html, js/pages/mfa-setup.js).
 *
 * Chef (LANA-AI user-profile.controller.js):
 *   POST /api/v1/users/me/security/mfa/setup
 *     200 { status, secret, qr_code (data:image/png URL), backup_codes [], provisioning_uri }
 *   POST /api/v1/users/me/security/mfa/verify { code }
 *     200 { status: 'success' }   enrollment is on
 *     401 { code: 'INVALID_CODE' } wrong code; the session is not ended
 *     400 { detail }               code not 6 to 8 characters
 *
 * Plain module: no DOM. The api client is passed in (api.setupMfa / api.verifyMfa).
 */
(function (global) {
  'use strict';

  var MESSAGES = {
    codeMissing: 'Enter the 6-digit code from your authenticator app.',
    codeShape: 'The code is the 6 digits your authenticator app shows.',
    wrongCode: 'That code did not work. Enter the newest code your app shows.',
    setupFailed: 'LANA could not start two-step sign in. Try again.'
  };

  /** The code as typed, without spaces or dashes. */
  function normalizeCode(value) {
    return String(value == null ? '' : value).replace(/[\s-]+/g, '');
  }

  /** An error message for a code that cannot be sent, or null when it can. */
  function codeError(value) {
    var code = normalizeCode(value);
    if (!code) return MESSAGES.codeMissing;
    if (!/^[0-9]{6}$/.test(code)) return MESSAGES.codeShape;
    return null;
  }

  /**
   * The setup answer shaped for the screen. The QR code is shown only as an
   * inline image (data:image/...), never loaded from an address.
   * @returns {{ qrCode: string|null, secret: string, backupCodes: string[], provisioningUri: string|null }}
   */
  function readSetup(result) {
    var body = result || {};
    var qr = typeof body.qr_code === 'string' && /^data:image\/(png|svg\+xml|jpeg|gif);base64,/i.test(body.qr_code) ? body.qr_code : null;
    var codes = Array.isArray(body.backup_codes)
      ? body.backup_codes.filter(function (c) { return typeof c === 'string' && c; })
      : [];
    return {
      qrCode: qr,
      secret: typeof body.secret === 'string' ? body.secret : '',
      backupCodes: codes,
      provisioningUri: typeof body.provisioning_uri === 'string' ? body.provisioning_uri : null
    };
  }

  /** The secret in groups of four, easier to type into an app by hand. */
  function groupSecret(secret) {
    return String(secret || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }

  /** What to say when verifying failed. */
  function verifyErrorMessage(err) {
    var data = err && err.data;
    var code = (err && err.code) || (data && data.code) || '';
    if (code === 'INVALID_CODE' || (err && (err.status === 401 || err.status === 400))) return MESSAGES.wrongCode;
    return (err && err.message) || MESSAGES.wrongCode;
  }

  function setupErrorMessage(err) {
    return (err && err.message) || MESSAGES.setupFailed;
  }

  /** Backup codes as plain text, one per line, for copying. */
  function backupCodesText(codes) {
    return (codes || []).join('\n');
  }

  /** Start enrollment: a new secret, QR code and backup codes. */
  function start(api) {
    return api.setupMfa().then(readSetup);
  }

  /**
   * Send the code. Resolves { ok: true } or { ok: false, message }; rejects never.
   */
  function verify(api, value) {
    var problem = codeError(value);
    if (problem) return Promise.resolve({ ok: false, message: problem });
    return api.verifyMfa(normalizeCode(value)).then(function () {
      return { ok: true };
    }, function (err) {
      return { ok: false, message: verifyErrorMessage(err) };
    });
  }

  var api = {
    MESSAGES: MESSAGES,
    normalizeCode: normalizeCode,
    codeError: codeError,
    readSetup: readSetup,
    groupSecret: groupSecret,
    verifyErrorMessage: verifyErrorMessage,
    setupErrorMessage: setupErrorMessage,
    backupCodesText: backupCodesText,
    start: start,
    verify: verify
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.LanaMfaEnrollment = api;
  }
})(typeof window !== 'undefined' ? window : this);
