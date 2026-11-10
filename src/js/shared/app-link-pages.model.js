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

  // Chef's paid seat refusal (seat-limit.model.js, loaded before this file).
  var SeatLimit = (typeof module !== 'undefined' && module.exports)
    ? require('./seat-limit.model')
    : global && global.SeatLimit;

  var MIN_PASSWORD_LENGTH = 8;
  // The special characters Chef's user-creation rule counts (admin-users.service.js).
  var SPECIAL_CHARACTERS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  function hasCharBetween(text, low, high) {
    for (var i = 0; i < text.length; i += 1) {
      if (text.charAt(i) >= low && text.charAt(i) <= high) return true;
    }
    return false;
  }

  function hasSpecial(text) {
    for (var i = 0; i < text.length; i += 1) {
      if (SPECIAL_CHARACTERS.indexOf(text.charAt(i)) !== -1) return true;
    }
    return false;
  }

  /**
   * The rules shown under the password fields, each with whether it is met.
   * policy 'basic' (activate): 8 characters. policy 'strong' (accept-invite,
   * which uses Chef's user-creation rule): also an uppercase letter, a
   * lowercase letter, a number and a special character.
   */
  function passwordRules(password, confirm, policy) {
    var first = String(password == null ? '' : password);
    var second = String(confirm == null ? '' : confirm);
    var rules = [
      { id: 'length', label: 'At least ' + MIN_PASSWORD_LENGTH + ' characters', met: first.length >= MIN_PASSWORD_LENGTH }
    ];
    if (policy === 'strong') {
      rules.push(
        { id: 'upper', label: 'An uppercase letter', met: hasCharBetween(first, 'A', 'Z') },
        { id: 'lower', label: 'A lowercase letter', met: hasCharBetween(first, 'a', 'z') },
        { id: 'number', label: 'A number', met: hasCharBetween(first, '0', '9') },
        { id: 'special', label: 'A special character, such as ! ? # or @', met: hasSpecial(first) }
      );
    }
    rules.push({ id: 'match', label: 'Both entries match', met: first.length > 0 && first === second });
    return rules;
  }

  function passwordReady(password, confirm, policy) {
    return passwordRules(password, confirm, policy).every(function (rule) { return rule.met; });
  }

  /** The error body (ApiError.data, or a parsed response), the code and status. */
  function problemOf(error) {
    var body = error && (error.data || error.body) ? (error.data || error.body) : null;
    var nested = body && body.error && typeof body.error === 'object' ? body.error : null;
    var code = String((body && body.code) || (nested && nested.code) || (error && error.code) || '');
    var detail = (body && body.detail) || (nested && nested.message) || (body && typeof body.error === 'string' ? body.error : '') || (body && body.message) || '';
    var status = Number((error && error.status) || (body && body.status) || 0);
    return { code: code, detail: String(detail || '').trim(), status: status };
  }

  var UNREACHABLE = 'LANA could not reach your firm. Check your connection and try again.';
  var TOO_MANY = 'Too many tries. Wait a few minutes and try again.';
  var FALLBACK = 'Something went wrong. Try again in a moment.';

  // POST /api/v1/auth/accept-invite refusals. signIn: offer sign in instead.
  var INVITE_PROBLEMS = {
    INVITE_NOT_FOUND: { message: 'This invitation was not found. Open the link from your email again, or ask for a new one.' },
    INVITE_EXPIRED: { message: 'This invitation has expired. Ask your firm\'s administrator for a new one.' },
    INVITE_CANCELLED: { message: 'This invitation was withdrawn by your firm\'s administrator.' },
    INVITE_ALREADY_ACCEPTED: { message: 'This invitation has already been used. Sign in with your email and password.', signIn: true },
    INVITE_EMAIL_IN_USE: { message: 'You already have an account with this email. Sign in with your email and password.', signIn: true },
    INVITE_NO_LONGER_VALID: { message: 'This invitation is no longer valid. Ask your firm\'s administrator for a new one.' },
    INVITE_ROLE_UNAVAILABLE: { message: 'The role in this invitation is no longer available. Ask your firm\'s administrator for a new invitation.' },
    TOO_MANY_ATTEMPTS: { message: TOO_MANY }
  };

  /**
   * Plain words for a failed set-password call, and whether to offer sign in.
   * kind 'invite': Chef's accept-invite codes. kind 'activate': the activate
   * endpoint has no codes; its messages are already plain sentences.
   * Unknown codes show Chef's own message. Every paid seat in use
   * (SEAT_LIMIT_REACHED, either kind): the seats in use, that this account
   * or invitation cannot go ahead yet, and to ask the firm's administrator;
   * the person is not signed in, so no add-seats button.
   */
  function setPasswordProblem(error, kind) {
    var problem = problemOf(error);
    if (problem.status === 0) return { message: UNREACHABLE, signIn: false };
    var seatLimit = SeatLimit ? SeatLimit.refusal(error, { canAddSeats: false, context: kind === 'invite' ? 'invite' : 'activate' }) : null;
    if (seatLimit) return { message: seatLimit.message, signIn: false };
    if (kind === 'invite' && Object.prototype.hasOwnProperty.call(INVITE_PROBLEMS, problem.code)) {
      var known = INVITE_PROBLEMS[problem.code];
      return { message: known.message, signIn: Boolean(known.signIn) };
    }
    if (problem.code === 'PASSWORD_TOO_WEAK') {
      return { message: problem.detail || 'Choose a stronger password.', signIn: false };
    }
    if (problem.status === 429) return { message: TOO_MANY, signIn: false };
    return { message: problem.detail || FALLBACK, signIn: false };
  }

  function setPasswordError(error, kind) {
    return setPasswordProblem(error, kind).message;
  }

  // POST /api/v1/sharing/links/:token/redeem refusals.
  var SHARE_PROBLEMS = {
    SHARE_LINK_NOT_FOUND: { kind: 'not-found', message: 'This link was not found at your firm. It may belong to another firm or have been removed.' },
    SHARE_LINK_REVOKED: { kind: 'revoked', message: 'This link was turned off by the person who shared it.' },
    SHARE_LINK_EXPIRED: { kind: 'expired', message: 'This link has expired. Ask the person who shared it for a new one.' },
    SHARE_LINK_USED_UP: { kind: 'used-up', message: 'This link has been used as many times as it allows. Ask for a new one.' },
    SHARE_LINK_UNAVAILABLE: { kind: 'unavailable', message: 'This item can no longer be shared through this link. It may have been removed, or the person who shared it no longer can.' },
    SHARE_LINK_PASSWORD_REQUIRED: { kind: 'password-required', message: 'This link is protected. Enter the password you were given.' },
    SHARE_LINK_PASSWORD_INCORRECT: { kind: 'password-wrong', message: 'That password is not right. Check it and try again.' }
  };

  /**
   * What a failed share-link redeem means for the page.
   * kind: password-required | password-wrong | expired | revoked | used-up |
   *       unavailable | not-found | signed-out | other
   */
  function sharedLinkOutcome(error) {
    var problem = problemOf(error);
    if (Object.prototype.hasOwnProperty.call(SHARE_PROBLEMS, problem.code)) {
      var known = SHARE_PROBLEMS[problem.code];
      return { kind: known.kind, message: known.message };
    }
    if (problem.status === 401) {
      return { kind: 'signed-out', message: 'Your session has ended. Sign in again to open this link.' };
    }
    if (problem.status === 404) return { kind: 'not-found', message: SHARE_PROBLEMS.SHARE_LINK_NOT_FOUND.message };
    if (problem.status === 0) return { kind: 'other', message: UNREACHABLE };
    if (problem.status === 429) return { kind: 'other', message: TOO_MANY };
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
    setPasswordProblem: setPasswordProblem,
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
