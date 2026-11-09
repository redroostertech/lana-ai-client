/*
 * AppLinkPages - pure helpers for the pages app links open (accept-invite.html,
 * activate.html, shared-link.html; see electron-app-links.js for the links).
 *
 * Password rules, plain words for Chef's errors (problem+json carries a stable
 * `code` and a `detail` written for a person), where a redeemed share link
 * goes, and the sign-in address with the email filled in.
 *
 * Chef decides every rule; these only shape what the page shows. No DOM, no
 * network. A browser global (window.AppLinkPages) and a CommonJS module for Jest.
 */
(function (global) {
  'use strict';

  var MIN_PASSWORD_LENGTH = 8;

  /** The rules shown under the password fields, each with whether it is met. */
  function passwordRules(password, confirm) {
    var first = String(password == null ? '' : password);
    var second = String(confirm == null ? '' : confirm);
    return [
      { id: 'length', label: 'At least ' + MIN_PASSWORD_LENGTH + ' characters', met: first.length >= MIN_PASSWORD_LENGTH },
      { id: 'match', label: 'Both entries match', met: first.length > 0 && first === second }
    ];
  }

  function passwordReady(password, confirm) {
    return passwordRules(password, confirm).every(function (rule) { return rule.met; });
  }

  /** The error body (ApiError.data, or a parsed response), the code and status. */
  function problemOf(error) {
    var body = error && (error.data || error.body) ? (error.data || error.body) : null;
    var nested = body && body.error && typeof body.error === 'object' ? body.error : null;
    var code = String((body && body.code) || (nested && nested.code) || (error && error.code) || '').toUpperCase();
    var detail = (body && body.detail) || (nested && nested.message) || (body && typeof body.error === 'string' ? body.error : '') || (body && body.message) || '';
    var status = Number((error && error.status) || (body && body.status) || 0);
    return { code: code, detail: String(detail || '').trim(), status: status };
  }

  function has(code, part) { return code.indexOf(part) !== -1; }

  function lower(text) { return String(text || '').toLowerCase(); }

  /**
   * Plain words for a failed set-password call (accept-invite, activate).
   * kind is 'invite' or 'activate'.
   */
  function setPasswordError(error, kind) {
    var problem = problemOf(error);
    var what = kind === 'activate' ? 'activation code' : 'invitation';
    var text = lower(problem.detail);
    if (problem.status === 0) {
      return 'LANA could not reach your firm. Check your connection and try again.';
    }
    if (has(problem.code, 'EXPIRED') || text.indexOf('expired') !== -1) {
      return 'This ' + what + ' has expired. Ask your firm\'s administrator for a new one.';
    }
    if (has(problem.code, 'USED') || has(problem.code, 'ACCEPTED') || text.indexOf('already') !== -1) {
      return 'This ' + what + ' has already been used. Sign in with your email and password.';
    }
    if (has(problem.code, 'REVOKED') || text.indexOf('revoked') !== -1) {
      return 'This ' + what + ' was withdrawn. Ask your firm\'s administrator for a new one.';
    }
    if (has(problem.code, 'PASSWORD') || (text.indexOf('password') !== -1 && text.indexOf('character') !== -1)) {
      return problem.detail || 'Choose a password with at least ' + MIN_PASSWORD_LENGTH + ' characters.';
    }
    if (problem.status === 404 || has(problem.code, 'NOT_FOUND') || has(problem.code, 'INVALID') || text.indexOf('invalid') !== -1) {
      return 'This ' + what + ' is not valid. Open the link from your email again, or ask for a new one.';
    }
    if (problem.status === 429) {
      return 'Too many tries. Wait a few minutes and try again.';
    }
    return problem.detail || 'Something went wrong. Try again in a moment.';
  }

  /**
   * What a failed share-link redeem means for the page.
   * kind: password-required | password-wrong | expired | revoked | used-up | not-found | other
   */
  function sharedLinkOutcome(error) {
    var problem = problemOf(error);
    var code = problem.code;
    if (has(code, 'PASSWORD') && (has(code, 'REQUIRED') || has(code, 'MISSING'))) {
      return { kind: 'password-required', message: 'This link is protected. Enter the password you were given.' };
    }
    if (has(code, 'PASSWORD')) {
      return { kind: 'password-wrong', message: 'That password is not right. Check it and try again.' };
    }
    if (has(code, 'EXPIRED')) {
      return { kind: 'expired', message: 'This link has expired. Ask the person who shared it for a new one.' };
    }
    if (has(code, 'REVOKED')) {
      return { kind: 'revoked', message: 'This link was turned off by the person who shared it.' };
    }
    if (has(code, 'USED') || has(code, 'EXHAUSTED') || has(code, 'LIMIT')) {
      return { kind: 'used-up', message: 'This link has been used as many times as it allows. Ask for a new one.' };
    }
    if (problem.status === 404) {
      return { kind: 'not-found', message: 'This link was not found at your firm. It may belong to another firm or have been removed.' };
    }
    if (problem.status === 0) {
      return { kind: 'other', message: 'LANA could not reach your firm. Check your connection and try again.' };
    }
    return { kind: 'other', message: problem.detail || 'This link could not be opened. Try again in a moment.' };
  }

  function encode(value) { return encodeURIComponent(String(value)); }

  /**
   * The page a redeemed share link opens, the way the app opens that kind of
   * item elsewhere: a document in the file viewer, a matter in its workspace,
   * a folder in its matter's folder view (folder needs the folder's matter).
   * Null when the type is unknown or the folder's matter is not known.
   */
  function sharedResourcePage(redeemed, folder) {
    if (!redeemed || !redeemed.resource_id) return null;
    var id = String(redeemed.resource_id);
    switch (String(redeemed.resource_type || '').toLowerCase()) {
      case 'document':
        return 'file-viewer.html?id=' + encode(id);
      case 'matter':
        return 'workspace-details.html?id=' + encode(id);
      case 'folder': {
        var matterId = folder && (folder.matter_id || folder.matterId);
        if (!matterId) return null;
        var page = 'folder.html?matter_id=' + encode(matterId);
        var matterName = folder.matter_name || folder.matterName;
        if (matterName) page += '&matter_name=' + encode(matterName);
        return page + '&folder_id=' + encode(id);
      }
      default:
        return null;
    }
  }

  /** The folder object from GET /api/v1/storage/folders/:id, whichever envelope it comes in. */
  function folderFromResponse(response) {
    if (!response) return null;
    if (response.data && response.data.folder) return response.data.folder;
    if (response.folder) return response.folder;
    return null;
  }

  /** The email a set-password response names, if any. */
  function emailFromResponse(response) {
    if (!response) return '';
    var candidates = [
      response.email,
      response.user && response.user.email,
      response.data && response.data.email,
      response.data && response.data.user && response.data.user.email
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (typeof candidates[i] === 'string' && candidates[i].indexOf('@') > 0) return candidates[i].trim();
    }
    return '';
  }

  /** The sign-in page, with the email filled in when it is known. */
  function signInPage(email) {
    var value = String(email || '').trim();
    return value ? 'login.html?email=' + encode(value) : 'login.html';
  }

  /** The firm's name for headings ("Set your password to join Norton Law"). */
  function firmName(server) {
    var name = server && (server.orgName || server.orgId);
    return name ? String(name) : 'your firm';
  }

  var api = {
    MIN_PASSWORD_LENGTH: MIN_PASSWORD_LENGTH,
    passwordRules: passwordRules,
    passwordReady: passwordReady,
    problemOf: problemOf,
    setPasswordError: setPasswordError,
    sharedLinkOutcome: sharedLinkOutcome,
    sharedResourcePage: sharedResourcePage,
    folderFromResponse: folderFromResponse,
    emailFromResponse: emailFromResponse,
    signInPage: signInPage,
    firmName: firmName
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.AppLinkPages = api;
  }
})(typeof window !== 'undefined' ? window : this);
