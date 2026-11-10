/**
 * Activation on the sign-in screen: code tidying, form checks, request shape
 * and the plain words for each server answer (js/shared/activation-flow.js).
 */
'use strict';

const path = require('path');
const flow = require(path.join(__dirname, '../../src/js/shared/activation-flow.js'));

describe('normalizeActivationCode', () => {
  test('ignores case, dashes and spaces', () => {
    expect(flow.normalizeActivationCode('k7m2q-9xr4t')).toBe('K7M2Q9XR4T');
    expect(flow.normalizeActivationCode(' K7M2Q 9XR4T ')).toBe('K7M2Q9XR4T');
    expect(flow.normalizeActivationCode('k7m2q - 9x r4t\n')).toBe('K7M2Q9XR4T');
  });

  test('reads lookalike letters as the digits the code uses', () => {
    expect(flow.normalizeActivationCode('o1lI0-ABCDE')).toBe('01110ABCDE');
  });

  test('copes with empty input', () => {
    expect(flow.normalizeActivationCode(null)).toBe('');
    expect(flow.normalizeActivationCode(undefined)).toBe('');
    expect(flow.normalizeActivationCode('')).toBe('');
  });
});

describe('isCompleteCode', () => {
  test('accepts 10 code characters however they were typed', () => {
    expect(flow.isCompleteCode('K7M2Q-9XR4T')).toBe(true);
    expect(flow.isCompleteCode('k7m2q9xr4t')).toBe(true);
  });

  test('rejects short, long and out-of-alphabet codes', () => {
    expect(flow.isCompleteCode('K7M2Q-9XR4')).toBe(false);
    expect(flow.isCompleteCode('K7M2Q-9XR4TT')).toBe(false);
    expect(flow.isCompleteCode('K7M2Q-9XR4U')).toBe(false);
    expect(flow.isCompleteCode('K7M2Q-9XR4!')).toBe(false);
  });
});

describe('formatActivationCode', () => {
  test('shows XXXXX-XXXXX', () => {
    expect(flow.formatActivationCode('k7m2q9xr4t')).toBe('K7M2Q-9XR4T');
    expect(flow.formatActivationCode('k7m 2q')).toBe('K7M2Q');
    expect(flow.formatActivationCode('k7m2q9')).toBe('K7M2Q-9');
  });
});

describe('password policy hints', () => {
  test('one hint per rule, the same five as Settings', () => {
    expect(flow.PASSWORD_RULES.map((r) => r.id)).toEqual(['length', 'upper', 'lower', 'number', 'special']);
  });

  test('checks each rule', () => {
    expect(flow.checkPassword('Harbor7')).toEqual({ length: false, upper: true, lower: true, number: true, special: false });
    expect(flow.passwordMeetsPolicy('Harbor7!view')).toBe(true);
    expect(flow.passwordMeetsPolicy('harbor7!view')).toBe(false);
  });
});

describe('validateForm', () => {
  const good = { orgId: 'smithlaw', email: 'dana@smithlaw.com', code: 'k7m2q 9xr4t', password: 'Harbor7!view', confirm: 'Harbor7!view' };

  test('passes a complete form', () => {
    expect(flow.validateForm(good)).toEqual({ ok: true });
  });

  test.each([
    ['orgId', { orgId: '  ' }],
    ['email', { email: 'dana' }],
    ['code', { code: 'K7M2' }],
    ['password', { password: 'short', confirm: 'short' }],
    ['confirm', { confirm: 'Harbor7!View' }]
  ])('names the %s field when it is wrong', (field, change) => {
    const result = flow.validateForm(Object.assign({}, good, change));
    expect(result.ok).toBe(false);
    expect(result.field).toBe(field);
    expect(result.message).toEqual(expect.any(String));
  });
});

describe('buildActivateRequest', () => {
  test('matches the contract: { email, code, new_password } with the code normalized', () => {
    expect(flow.buildActivateRequest({ email: ' dana@smithlaw.com ', code: 'k7m2q-9xr4t', password: 'Harbor7!view' })).toEqual({
      path: '/api/v1/auth/activate',
      body: { email: 'dana@smithlaw.com', code: 'K7M2Q9XR4T', new_password: 'Harbor7!view' }
    });
  });
});

describe('activationErrorMessage', () => {
  const err = (code, status, data) => ({ code, status, data: data || { code } });

  test('a wrong, used or expired code gets one answer', () => {
    const msg = flow.activationErrorMessage(err('ACTIVATION_CODE_INVALID', 400));
    expect(msg).toMatch(/did not work/);
    expect(msg).toMatch(/new one/);
  });

  test('a locked code says to ask for a new email', () => {
    expect(flow.activationErrorMessage(err('ACTIVATION_CODE_LOCKED', 423))).toMatch(/too many times.*new activation email/);
  });

  test('a password policy refusal carries the server detail', () => {
    const msg = flow.activationErrorMessage(err('PASSWORD_POLICY', 400, { code: 'PASSWORD_POLICY', detail: 'Use at least 12 characters.' }));
    expect(msg).toMatch(/stronger password/);
    expect(msg).toContain('Use at least 12 characters.');
  });

  test('rate limit, no connection and anything else have plain words', () => {
    expect(flow.activationErrorMessage({ status: 429 })).toMatch(/Too many tries/);
    expect(flow.activationErrorMessage({ status: 0 })).toMatch(/could not reach/);
    expect(flow.activationErrorMessage({ status: 500 })).toMatch(/did not go through/);
    expect(flow.activationErrorMessage(null)).toMatch(/did not go through/);
  });

  test('no message has a dash used as punctuation', () => {
    ['ACTIVATION_CODE_INVALID', 'ACTIVATION_CODE_LOCKED', 'PASSWORD_POLICY'].forEach((code) => {
      expect(flow.activationErrorMessage(err(code, 400))).not.toMatch(/[\u2013\u2014]/);
    });
  });
});
