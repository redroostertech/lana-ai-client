/**
 * Chef's session policy on the client (src/js/api.js LanaSessionGate and the
 * api client): required MFA enrollment holds off the session services, a
 * wrong MFA code does not end the session, an idle sign out says so, and MFA
 * setup works whatever the client's MFA_ENABLED flag says.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_PATH = path.join(__dirname, '../../src/js/api.js');
const API_SOURCE = fs.readFileSync(API_PATH, 'utf8');

function memoryStorage() {
  const data = {};
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; }
  };
}

function loadApi({ fetchImpl = jest.fn(), electronAPI = null, storedUser = null, token = null, config = {} } = {}) {
  const localStorage = memoryStorage();
  if (storedUser) localStorage.setItem('user', JSON.stringify(storedUser));
  let held = token;
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} }, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, URL, Headers,
    FormData: class FormData {}, fetch: fetchImpl,
    localStorage,
    sessionStorage: memoryStorage(),
    document: { addEventListener: jest.fn(), body: {}, getElementById: jest.fn(() => null) },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/dashboard.html', href: 'http://client.test/dashboard.html' },
    lanaAuthToken: { get: () => held, set: (t) => { held = t; }, clear: () => { held = null; } },
    LanaConfig: config, LanaTime: { nowMs: jest.fn(() => 1000), millisecondsSince: jest.fn(() => 0), MS_PER_MINUTE: 60000, MS_PER_HOUR: 3600000 }
  };
  if (electronAPI) context.electronAPI = electronAPI;
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(API_SOURCE, context, { filename: API_PATH });
  const api = context.window.api;
  api.baseUrl = 'https://chef.example.test';
  return { api, context, gate: context.window.LanaSessionGate };
}

function answer(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => text, json: async () => body };
}

// A JWT whose exp is far away, so startTokenRefresh schedules (and does not refresh at once).
const TOKEN = 'h.' + Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url') + '.s';
const USER = { id: 'u1', email: 'p@firm.test', mustChangePassword: false };

describe('LanaSessionGate', () => {
  const { gate, context } = loadApi();
  const apiError = (message, status, data) => new context.window.ApiErrorForTests(message, status, data);
  beforeAll(() => {
    // ApiError is a class declaration in api.js; reach it through a fresh context.
    vm.runInContext('window.ApiErrorForTests = ApiError;', context);
  });

  test('sign in goes to the password change first, then enrollment, else on', () => {
    expect(gate.nextStepAfterSignIn({ user: { mustChangePassword: true, mfaEnrollmentRequired: true }, state: 'mfa_enrollment_required' })).toBe('change-password');
    expect(gate.nextStepAfterSignIn({ user: { mfaEnrollmentRequired: false }, state: 'mfa_enrollment_required', mfaEnrollmentRequired: true })).toBe('mfa-setup');
    expect(gate.nextStepAfterSignIn({ user: { mfaEnrollmentRequired: true } })).toBe('mfa-setup');
    expect(gate.nextStepAfterSignIn({ user: { mustChangePassword: false, mfaEnrollmentRequired: false } })).toBe('continue');
    expect(gate.nextStepAfterSignIn({ user: { mustChangePassword: 'true' } })).toBe('continue');
    expect(gate.nextStepAfterSignIn(null)).toBe('continue');
  });

  test('the session is held only for a user flagged to enroll', () => {
    expect(gate.holdsSession({ mfaEnrollmentRequired: true })).toBe(true);
    expect(gate.holdsSession({ mfaEnrollmentRequired: false })).toBe(false);
    expect(gate.holdsSession({})).toBe(false);
    expect(gate.holdsSession(null)).toBe(false);
  });

  test('refusal codes are read from both body shapes and from ApiError', () => {
    expect(gate.refusalKind({ error: 'Two-step sign in required', code: 'MFA_ENROLLMENT_REQUIRED' })).toBe('mfa_enrollment_required');
    expect(gate.refusalKind({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } })).toBe('password_change_required');
    expect(gate.refusalKind(apiError('x', 401, { code: 'SESSION_IDLE_TIMEOUT' }))).toBe('idle_timeout');
    expect(gate.refusalKind(apiError('x', 403, { code: 'IP_NOT_ALLOWED' }))).toBe('ip_not_allowed');
    expect(gate.refusalKind(apiError('x', 403, { code: 'AUTHORIZATION_ERROR' }))).toBe(null);
    expect(gate.refusalKind(null)).toBe(null);
  });

  test('an MFA code at sign in is recognised by its code, not by any message', () => {
    expect(gate.isMfaCodeRequired(apiError('anything', 401, { error: { code: 'MFA_TOKEN_REQUIRED' } }))).toBe(true);
    // Chef 8b50ffbda: the generic code with this one message.
    expect(gate.isMfaCodeRequired(apiError('MFA token required', 401, { error: { code: 'AUTHENTICATION_ERROR', message: 'MFA token required' } }))).toBe(true);
    expect(gate.isMfaCodeRequired(apiError('Invalid email or password', 401, { error: { code: 'AUTHENTICATION_ERROR' } }))).toBe(false);
    // The message alone, with no code, is not enough.
    expect(gate.isMfaCodeRequired(apiError('MFA token required', 401, null))).toBe(false);
    expect(gate.isMfaCodeRequired(new Error('MFA token required'))).toBe(false);
  });

  test('a wrong MFA code is an answer, not a signed-out session', () => {
    expect(gate.isWrongCodeAnswer({ code: 'INVALID_CODE', message: 'Invalid MFA code' })).toBe(true);
    expect(gate.isWrongCodeAnswer({ error: { code: 'AUTHENTICATION_ERROR' } })).toBe(false);
  });

  test('the sign-out note is read once and only for known reasons', () => {
    const storage = memoryStorage();
    gate.rememberSignOutNote(storage, 'idle_timeout');
    expect(gate.takeSignOutNote(storage)).toBe('You were signed out after a period of inactivity. Sign in again.');
    expect(gate.takeSignOutNote(storage)).toBe('');
    gate.rememberSignOutNote(storage, 'made_up');
    expect(gate.takeSignOutNote(storage)).toBe('');
    expect(gate.takeSignOutNote(null)).toBe('');
    expect(gate.message('ip_not_allowed')).toMatch(/approved network addresses/);
  });
});

describe('sign in and the session services', () => {
  function electron() {
    return { invoke: jest.fn(async () => ({ success: true })), getSavedServer: jest.fn(async () => ({ success: true, server: { url: 'https://chef.example.test' } })) };
  }

  test('required enrollment: the token is kept and refresh, activity and tracking wait', async () => {
    const electronAPI = electron();
    const fetchImpl = jest.fn(async () => answer(200, { token: TOKEN, user: { ...USER, mfaEnrollmentRequired: true }, state: 'mfa_enrollment_required', mfaEnrollmentRequired: true }));
    const { api, context } = loadApi({ fetchImpl, electronAPI });
    const refresh = jest.spyOn(api, 'startTokenRefresh');
    const activity = jest.spyOn(api, 'setupActivityListener');
    await api.login('p@firm.test', 'pw');
    expect(context.lanaAuthToken.get()).toBe(TOKEN);
    expect(JSON.parse(context.localStorage.getItem('user')).mfaEnrollmentRequired).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(activity).not.toHaveBeenCalled();
    expect(electronAPI.invoke).not.toHaveBeenCalled();

    // Enrollment done: the flag clears and everything starts.
    await api.completeMfaEnrollment();
    expect(JSON.parse(context.localStorage.getItem('user')).mfaEnrollmentRequired).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledTimes(1);
    expect(electronAPI.invoke.mock.calls.map((c) => c[0])).toEqual(['session-tracker:initialize', 'session-tracker:start']);
    api.stopTokenRefresh();
    api.cleanupActivityListener();
  });

  test('control: an ordinary sign in starts them at once', async () => {
    const electronAPI = electron();
    const fetchImpl = jest.fn(async () => answer(200, { token: TOKEN, user: { ...USER, mfaEnrollmentRequired: false } }));
    const { api } = loadApi({ fetchImpl, electronAPI });
    const refresh = jest.spyOn(api, 'startTokenRefresh');
    await api.login('p@firm.test', 'pw');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(electronAPI.invoke.mock.calls.map((c) => c[0])).toEqual(['session-tracker:initialize', 'session-tracker:start']);
    api.stopTokenRefresh();
    api.cleanupActivityListener();
  });

  test('a page opened with a stored token of a user still to enroll holds them too', async () => {
    const electronAPI = electron();
    const { api } = loadApi({ electronAPI, token: TOKEN, storedUser: { ...USER, mfaEnrollmentRequired: true } });
    await Promise.resolve(api._readyPromise);
    await new Promise((resolve) => setImmediate(resolve));
    expect(api.refreshTimer || null).toBe(null);
    expect(electronAPI.invoke).not.toHaveBeenCalled();
  });
});

describe('MFA calls and refusals', () => {
  test('setup and verify are sent even when the client config turns MFA off', async () => {
    const fetchImpl = jest.fn(async () => answer(200, { status: 'success' }));
    const { api } = loadApi({ fetchImpl, config: { MFA_ENABLED: false } });
    api.user = { id: 'u1' };
    api.token = TOKEN;
    await api.setupMfa();
    await api.verifyMfa('123456');
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://chef.example.test/api/v1/users/me/security/mfa/setup',
      'https://chef.example.test/api/v1/users/me/security/mfa/verify'
    ]);
  });

  test('a 401 INVALID_CODE does not open the session-expired notice', async () => {
    const fetchImpl = jest.fn(async () => answer(401, { code: 'INVALID_CODE', message: 'Invalid MFA code' }));
    const { api } = loadApi({ fetchImpl });
    api.user = { id: 'u1' };
    const expired = jest.spyOn(api, 'showSessionExpiredModal').mockImplementation(() => {});
    await expect(api.verifyMfa('000000')).rejects.toMatchObject({ status: 401, code: 'INVALID_CODE' });
    expect(expired).not.toHaveBeenCalled();
  });

  test('a 401 SESSION_IDLE_TIMEOUT signs out with the inactivity note', async () => {
    const fetchImpl = jest.fn(async () => answer(401, { error: 'Signed out after inactivity', code: 'SESSION_IDLE_TIMEOUT', message: 'You were signed out because this session was not used for a while. Sign in again.' }));
    const { api, context } = loadApi({ fetchImpl });
    const expired = jest.spyOn(api, 'showSessionExpiredModal').mockImplementation(() => {});
    await expect(api.get('/api/v1/tasks')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledWith({ reason: 'idle_timeout' });
    expect(context.window.LanaSessionGate.takeSignOutNote(context.sessionStorage)).toMatch(/inactivity/);
  });

  test('control: any other 401 opens the plain session-expired notice', async () => {
    const fetchImpl = jest.fn(async () => answer(401, { error: { code: 'AUTHENTICATION_ERROR', message: 'Session expired' } }));
    const { api, context } = loadApi({ fetchImpl });
    const expired = jest.spyOn(api, 'showSessionExpiredModal').mockImplementation(() => {});
    await expect(api.get('/api/v1/tasks')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledWith(undefined);
    expect(context.window.LanaSessionGate.takeSignOutNote(context.sessionStorage)).toBe('');
  });
});
