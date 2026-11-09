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
  test('length and match are each shown with whether they are met', () => {
    expect(M.passwordRules('short', 'short')).toEqual([
      { id: 'length', label: 'At least 8 characters', met: false },
      { id: 'match', label: 'Both entries match', met: true }
    ]);
    expect(M.passwordReady('long enough', 'long enough')).toBe(true);
    expect(M.passwordReady('long enough', 'long enougH')).toBe(false);
    expect(M.passwordReady('', '')).toBe(false);
  });
});

describe('setPasswordError', () => {
  test.each([
    [problem(410, 'INVITE_EXPIRED', 'The invitation expired.'), 'invite', 'This invitation has expired. Ask your firm\'s administrator for a new one.'],
    [problem(409, 'INVITE_ALREADY_ACCEPTED', 'x'), 'invite', 'This invitation has already been used. Sign in with your email and password.'],
    [problem(404, 'INVITE_NOT_FOUND', 'x'), 'invite', 'This invitation is not valid. Open the link from your email again, or ask for a new one.'],
    [{ status: 400, data: { error: { message: 'This activation code has expired', code: 'VALIDATION_ERROR' } } }, 'activate', 'This activation code has expired. Ask your firm\'s administrator for a new one.'],
    [{ status: 400, data: { error: { message: 'Invalid activation code', code: 'VALIDATION_ERROR' } } }, 'activate', 'This activation code is not valid. Open the link from your email again, or ask for a new one.'],
    [{ status: 0, data: null }, 'invite', 'LANA could not reach your firm. Check your connection and try again.'],
    [problem(429, 'RATE_LIMITED', ''), 'invite', 'Too many tries. Wait a few minutes and try again.']
  ])('%#: plain words', (error, kind, expected) => {
    expect(M.setPasswordError(error, kind)).toBe(expected);
  });

  test('an unknown problem shows Chef\'s own sentence', () => {
    expect(M.setPasswordError(problem(422, 'SEAT_LIMIT', 'Your firm has no free seats.'), 'invite')).toBe('Your firm has no free seats.');
  });
});

describe('sharedLinkOutcome', () => {
  test.each([
    [problem(401, 'SHARE_LINK_PASSWORD_REQUIRED', 'x'), 'password-required'],
    [problem(403, 'SHARE_LINK_PASSWORD_INVALID', 'x'), 'password-wrong'],
    [problem(410, 'SHARE_LINK_EXPIRED', 'x'), 'expired'],
    [problem(410, 'SHARE_LINK_REVOKED', 'x'), 'revoked'],
    [problem(410, 'SHARE_LINK_USED_UP', 'x'), 'used-up'],
    [{ status: 404, data: { error: 'Not found' } }, 'not-found'],
    [{ status: 0, data: null }, 'other']
  ])('%#: %s', (error, kind) => {
    const outcome = M.sharedLinkOutcome(error);
    expect(outcome.kind).toBe(kind);
    expect(outcome.message).toEqual(expect.any(String));
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
