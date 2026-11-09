'use strict';

/**
 * The words and destinations of the pages app links open
 * (src/js/shared/app-link-pages.model.js): password rules, Chef's
 * problem+json errors in plain words, where a redeemed share link goes, and
 * the sign-in address with the email filled in.
 */

const M = require('../../src/js/shared/app-link-pages.model');

function problem(status, code, detail) {
  return { status, data: { type: `urn:lana:problem:${code}`, title: 'x', status, detail, code } };
}

describe('passwordRules', () => {
  test('activate (basic): length and match, each with whether it is met', () => {
    expect(M.passwordRules('short', 'short')).toEqual([
      { id: 'length', label: 'At least 8 characters', met: false },
      { id: 'match', label: 'Both entries match', met: true }
    ]);
    expect(M.passwordReady('long enough', 'long enough')).toBe(true);
    expect(M.passwordReady('long enough', 'long enougH')).toBe(false);
    expect(M.passwordReady('', '')).toBe(false);
  });

  test('accept-invite (strong): Chef\'s user-creation rule is shown rule by rule', () => {
    const rules = M.passwordRules('abcdefgh', 'abcdefgh', 'strong');
    expect(rules.map((r) => [r.id, r.met])).toEqual([
      ['length', true], ['upper', false], ['lower', true], ['number', false], ['special', false], ['match', true]
    ]);
    expect(M.passwordReady('abcdefgh', 'abcdefgh', 'strong')).toBe(false);
    expect(M.passwordReady('Abcdefg1!', 'Abcdefg1!', 'strong')).toBe(true);
    // Only the characters Chef counts as special.
    expect(M.passwordReady('Abcdefg1~', 'Abcdefg1~', 'strong')).toBe(false);
    expect(M.passwordReady('Abcdefg1[', 'Abcdefg1[', 'strong')).toBe(true);
    // Uppercase means A to Z, as Chef checks it.
    expect(M.passwordRules('ÉBCDEFG1!', '', 'strong').find((r) => r.id === 'lower').met).toBe(false);
  });
});

describe('setPasswordProblem (accept-invite codes)', () => {
  test.each([
    [problem(404, 'INVITE_NOT_FOUND', 'x'), 'This invitation was not found. Open the link from your email again, or ask for a new one.', false],
    [problem(410, 'INVITE_EXPIRED', 'x'), 'This invitation has expired. Ask your firm\'s administrator for a new one.', false],
    [problem(410, 'INVITE_CANCELLED', 'x'), 'This invitation was withdrawn by your firm\'s administrator.', false],
    [problem(409, 'INVITE_ALREADY_ACCEPTED', 'x'), 'This invitation has already been used. Sign in with your email and password.', true],
    [problem(409, 'INVITE_EMAIL_IN_USE', 'x'), 'You already have an account with this email. Sign in with your email and password.', true],
    [problem(409, 'INVITE_NO_LONGER_VALID', 'x'), 'This invitation is no longer valid. Ask your firm\'s administrator for a new one.', false],
    [problem(409, 'INVITE_ROLE_UNAVAILABLE', 'x'), 'The role in this invitation is no longer available. Ask your firm\'s administrator for a new invitation.', false],
    [problem(400, 'PASSWORD_TOO_WEAK', 'Password must contain at least one uppercase letter and number.'), 'Password must contain at least one uppercase letter and number.', false],
    [{ status: 400, data: { error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } } }, 'Password must be at least 8 characters', false],
    [problem(429, 'TOO_MANY_ATTEMPTS', 'x'), 'Too many tries. Wait a few minutes and try again.', false],
    [{ status: 0, data: null }, 'LANA could not reach your firm. Check your connection and try again.', false]
  ])('%#: plain words', (error, message, signIn) => {
    expect(M.setPasswordProblem(error, 'invite')).toEqual({ message, signIn });
  });

  test('an unknown code shows Chef\'s own sentence, never a guess from its name', () => {
    expect(M.setPasswordError(problem(422, 'INVITE_EXPIRED_SOMEHOW', 'Your firm has no free seats.'), 'invite')).toBe('Your firm has no free seats.');
    expect(M.setPasswordError(problem(500, 'X', ''), 'invite')).toBe('Something went wrong. Try again in a moment.');
  });

  test('activate has no codes: Chef\'s plain message is shown as is', () => {
    expect(M.setPasswordError({ status: 400, data: { error: { message: 'This activation code has expired', code: 'VALIDATION_ERROR' } } }, 'activate'))
      .toBe('This activation code has expired');
    // An invite code on the activate page is not treated as an invite.
    expect(M.setPasswordError(problem(410, 'INVITE_EXPIRED', 'Plain words.'), 'activate')).toBe('Plain words.');
  });
});

describe('sharedLinkOutcome (redeem codes)', () => {
  test.each([
    [problem(404, 'SHARE_LINK_NOT_FOUND', 'x'), 'not-found'],
    [problem(410, 'SHARE_LINK_REVOKED', 'x'), 'revoked'],
    [problem(410, 'SHARE_LINK_EXPIRED', 'x'), 'expired'],
    [problem(410, 'SHARE_LINK_USED_UP', 'x'), 'used-up'],
    [problem(410, 'SHARE_LINK_UNAVAILABLE', 'x'), 'unavailable'],
    [problem(400, 'SHARE_LINK_PASSWORD_REQUIRED', 'x'), 'password-required'],
    [problem(403, 'SHARE_LINK_PASSWORD_INCORRECT', 'x'), 'password-wrong'],
    [{ status: 401, data: { error: { code: 'AUTHENTICATION_ERROR', message: 'Not authenticated' } } }, 'signed-out'],
    [{ status: 404, data: { error: 'Not found' } }, 'not-found'],
    [{ status: 0, data: null }, 'other']
  ])('%#: %s', (error, kind) => {
    const outcome = M.sharedLinkOutcome(error);
    expect(outcome.kind).toBe(kind);
    expect(outcome.message).toEqual(expect.any(String));
  });

  test('codes match exactly: a lookalike falls back to Chef\'s message', () => {
    expect(M.sharedLinkOutcome(problem(410, 'SHARE_LINK_EXPIRED_V2', 'Chef says so.'))).toEqual({ kind: 'other', message: 'Chef says so.' });
    expect(M.sharedLinkOutcome(problem(403, 'SHARE_LINK_PASSWORD_WRONG', 'Nope.'))).toEqual({ kind: 'other', message: 'Nope.' });
  });

  test('the ApiError shape (code lifted to the error) is read too', () => {
    expect(M.sharedLinkOutcome({ status: 410, code: 'SHARE_LINK_EXPIRED', data: null }).kind).toBe('expired');
  });
});

describe('sharedResourcePage', () => {
  test('opens each type the way the app opens it elsewhere', () => {
    expect(M.sharedResourcePage({ resource_type: 'document', resource_id: 'd 1' })).toBe('file-viewer.html?id=d%201');
    expect(M.sharedResourcePage({ resource_type: 'matter', resource_id: 'm1' })).toBe('workspace-details.html?id=m1');
    expect(M.sharedResourcePage({ resource_type: 'folder', resource_id: 'f1' }, { matter_id: 'm1', matter_name: 'Estate of A & B' }))
      .toBe('folder.html?matter_id=m1&matter_name=Estate%20of%20A%20%26%20B&folder_id=f1');
  });

  test('null for an unknown type, or a folder whose matter is not known', () => {
    expect(M.sharedResourcePage({ resource_type: 'calendar', resource_id: 'c1' })).toBeNull();
    expect(M.sharedResourcePage({ resource_type: 'folder', resource_id: 'f1' }, null)).toBeNull();
    expect(M.sharedResourcePage(null)).toBeNull();
  });

  test('folderFromResponse reads either envelope', () => {
    expect(M.folderFromResponse({ status: 'success', data: { folder: { id: 'f' } } })).toEqual({ id: 'f' });
    expect(M.folderFromResponse({ folder: { id: 'g' } })).toEqual({ id: 'g' });
    expect(M.folderFromResponse(null)).toBeNull();
  });
});

describe('sign in afterwards', () => {
  test('the email is filled in when Chef returns it', () => {
    expect(M.emailFromResponse({ user: { email: 'pat@norton.law' } })).toBe('pat@norton.law');
    expect(M.emailFromResponse({ data: { email: 'pat@norton.law' } })).toBe('pat@norton.law');
    expect(M.emailFromResponse({ message: 'ok' })).toBe('');
    expect(M.signInPage('pat+1@norton.law')).toBe('login.html?email=pat%2B1%40norton.law');
    expect(M.signInPage('')).toBe('login.html');
  });

  test('firmName falls back to plain words', () => {
    expect(M.firmName({ orgName: 'Norton Law' })).toBe('Norton Law');
    expect(M.firmName(null)).toBe('your firm');
  });
});
