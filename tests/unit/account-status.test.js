/**
 * Regression: a user whose account was created but never activated must be
 * routed to activate.html instead of being left on the login form with a
 * generic "Login failed" toast.
 *
 * The counterpart matters just as much: a deactivated account must NOT be sent
 * to activation, because an activation code cannot reopen an account an admin
 * turned off.
 */
const fs = require('fs');
const path = require('path');

const accountStatus = require(path.join(__dirname, '../../src/js/shared/account-status.js'));

/** Build an ApiError-shaped rejection like api.request throws. */
function apiError(message, status, data) {
  const err = new Error(message);
  err.status = status;
  err.data = data || null;
  err.code = (data && (data.code || (data.error && data.error.code))) || null;
  return err;
}

describe('classifyLoginFailure - the live server response', () => {
  // Captured from /api/v1/auth/login against lana-ai-chef. The error code is
  // identical to a wrong-password rejection and there is no status field, so the
  // message is the only discriminator. This is the case that must route.
  const LIVE_INACTIVE_RESPONSE = {
    error: { message: 'Account is not active', code: 'AUTHENTICATION_ERROR' }
  };

  test('routes the real "Account is not active" 401 to activation', () => {
    const err = apiError('Account is not active', 401, LIVE_INACTIVE_RESPONSE);

    expect(accountStatus.classifyLoginFailure(err)).toBe('activation_required');
    expect(accountStatus.needsActivation(err)).toBe(true);
  });

  test('does not confuse it with the wrong-password 401 sharing the same code', () => {
    const wrongPassword = apiError('Invalid email or password', 401, {
      error: { message: 'Invalid email or password', code: 'AUTHENTICATION_ERROR' }
    });

    expect(accountStatus.classifyLoginFailure(wrongPassword)).toBe('unknown');
  });
});

describe('classifyLoginFailure - accounts needing activation', () => {
  test.each([
    'Account is not active',
    'This account is not active',
    'User account is inactive',
    'Account is inactive'
  ])('treats ambiguous "not active" wording as activation: %s', (message) => {
    expect(accountStatus.classifyLoginFailure(apiError(message, 401, null)))
      .toBe('activation_required');
  });

  test('detects a pending status on the payload', () => {
    const err = apiError('Login failed', 403, { status: 'pending' });

    expect(accountStatus.classifyLoginFailure(err)).toBe('activation_required');
    expect(accountStatus.needsActivation(err)).toBe(true);
  });

  test('detects an invited user', () => {
    expect(accountStatus.classifyLoginFailure(apiError('nope', 403, { user: { status: 'invited' } })))
      .toBe('activation_required');
  });

  test.each([
    'ACCOUNT_NOT_ACTIVATED',
    'ACCOUNT_PENDING_ACTIVATION',
    'PENDING_ACTIVATION',
    'ACTIVATION_REQUIRED',
    'USER_NOT_ACTIVATED'
  ])('detects the %s server error code', (code) => {
    const err = apiError('Login failed', 403, { error: { message: 'Login failed', code } });

    expect(accountStatus.classifyLoginFailure(err)).toBe('activation_required');
  });

  test.each([
    'Please activate your account before signing in.',
    'Account has not been activated',
    'You must activate your account first',
    'Account pending activation',
    'Activation code is required'
  ])('falls back to the message: %s', (message) => {
    const err = apiError(message, 403, { error: { message, code: 'AUTHENTICATION_ERROR' } });

    expect(accountStatus.classifyLoginFailure(err)).toBe('activation_required');
  });

  test('activation wording wins over the vaguer inactive wording', () => {
    const message = 'Your account is inactive. Please activate your account to continue.';

    expect(accountStatus.classifyLoginFailure(apiError(message, 403, null)))
      .toBe('activation_required');
  });
});

describe('classifyLoginFailure - deactivated accounts must not be sent to activation', () => {
  test.each(['deactivated', 'disabled', 'suspended', 'locked'])(
    'status %s classifies as disabled, not activation',
    (status) => {
      const err = apiError('Login failed', 403, { status });

      expect(accountStatus.classifyLoginFailure(err)).toBe('account_disabled');
      expect(accountStatus.needsActivation(err)).toBe(false);
    }
  );

  test.each(['ACCOUNT_DISABLED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_SUSPENDED', 'USER_DEACTIVATED'])(
    'code %s classifies as disabled',
    (code) => {
      expect(accountStatus.classifyLoginFailure(apiError('no', 403, { error: { code } })))
        .toBe('account_disabled');
    }
  );

  test('an explicitly deactivated status still avoids the activation page', () => {
    // The one case where sending the user to activate.html would be a dead end:
    // an activation code cannot reopen an account an admin switched off.
    const err = apiError('Account has been deactivated', 401, { status: 'deactivated' });

    expect(accountStatus.classifyLoginFailure(err)).toBe('account_disabled');
    expect(accountStatus.needsActivation(err)).toBe(false);
  });

  test('is_active === false routes to activation, matching the ambiguous wording', () => {
    // Same ambiguity as "Account is not active": the flag says the account is off
    // but not why, so the actionable path wins.
    const err = apiError('Login failed', 401, { user: { is_active: false } });

    expect(accountStatus.classifyLoginFailure(err)).toBe('activation_required');
  });
});

describe('classifyLoginFailure - everything else stays on the login form', () => {
  test('wrong password is unknown, so existing handling is preserved', () => {
    // The exact envelope the live API returns for a bad credential.
    const err = apiError('Invalid email or password', 401, {
      error: { message: 'Invalid email or password', code: 'AUTHENTICATION_ERROR' }
    });

    expect(accountStatus.classifyLoginFailure(err)).toBe('unknown');
    expect(accountStatus.needsActivation(err)).toBe(false);
    expect(accountStatus.isDisabled(err)).toBe(false);
  });

  test('MFA prompt is not mistaken for an account state', () => {
    expect(accountStatus.classifyLoginFailure(apiError('MFA token required', 401, null)))
      .toBe('unknown');
  });

  test('an HTTP status number on the envelope root is not read as an account state', () => {
    // `status: 403` is the HTTP code, not an account state — it must not match.
    expect(accountStatus.classifyLoginFailure(apiError('Forbidden', 403, { status: 403 })))
      .toBe('unknown');
  });

  test('handles missing and malformed errors without throwing', () => {
    expect(accountStatus.classifyLoginFailure(null)).toBe('unknown');
    expect(accountStatus.classifyLoginFailure(undefined)).toBe('unknown');
    expect(accountStatus.classifyLoginFailure(apiError('', 500, {}))).toBe('unknown');
    expect(() => accountStatus.classifyLoginFailure({})).not.toThrow();
  });
});

describe('login.html wires the activation redirect', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/login.html'), 'utf8');

  test('loads the account-status module', () => {
    expect(source).toContain('js/shared/account-status.js');
  });

  test('routes activation_required to activate.html', () => {
    expect(source).toContain('AccountStatus.classifyLoginFailure');
    expect(source).toContain("activation_required");
    expect(source).toContain("window.location.href = 'activate.html'");
  });
});
