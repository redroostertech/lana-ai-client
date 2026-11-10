'use strict';

// auth-guard.js routes Chef's session policy refusals (403) from any API call:
// PASSWORD_CHANGE_REQUIRED to change-password.html, MFA_ENROLLMENT_REQUIRED to
// mfa-setup.html, and IP_NOT_ALLOWED to one plain message. The refusal is
// re-thrown so the caller's own handling still runs.

const fs = require('node:fs');
const path = require('node:path');

const GUARD = fs.readFileSync(path.resolve(__dirname, '../../src/js/auth-guard.js'), 'utf8');
const { loadSessionGate } = require('./helpers/session-gate');

// The gate from api.js, as the page has it.
const GATE = loadSessionGate();

function refusal(code) {
  return Object.assign(new Error('refused'), { status: 403, code, data: { code } });
}

function guardOn(pageUrl, refusalCode) {
  const toasts = [];
  const document = { getElementById: () => ({}), querySelector: () => null, createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} };
  // A plain object: the guard assigns a relative href, as a browser accepts.
  const location = { href: pageUrl, pathname: new URL(pageUrl).pathname };
  const window = {
    location,
    lanaAuthToken: { get: () => 'token' },
    LanaSessionGate: GATE,
    Lex: { Toast: { error: (text) => toasts.push(text) } },
    api: { request: () => Promise.reject(refusal(refusalCode)) }
  };
  window.api.request = window.api.request.bind(window.api);
  const localStorage = { getItem: () => JSON.stringify({ id: 'u1' }) };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'localStorage', 'setTimeout', 'api', 'Lex', 'LanaSessionGate', GUARD)(window, document, localStorage, () => {}, window.api, window.Lex, GATE);
  return { window, toasts, location };
}

async function callOnce(guarded) {
  await expect(guarded.window.api.request('GET', '/api/v1/tasks')).rejects.toMatchObject({ status: 403 });
}

test('403 MFA_ENROLLMENT_REQUIRED opens mfa-setup.html', async () => {
  const guarded = guardOn('http://localhost/dashboard.html', 'MFA_ENROLLMENT_REQUIRED');
  await callOnce(guarded);
  expect(guarded.window.location.href).toBe('mfa-setup.html');
});

test('control: 403 PASSWORD_CHANGE_REQUIRED still opens change-password.html', async () => {
  const guarded = guardOn('http://localhost/dashboard.html', 'PASSWORD_CHANGE_REQUIRED');
  await callOnce(guarded);
  expect(guarded.window.location.href).toBe('change-password.html');
});

test('the enrollment and password pages are never redirected away from', async () => {
  for (const page of ['mfa-setup.html', 'change-password.html', 'login.html']) {
    const guarded = guardOn('http://localhost/' + page, 'MFA_ENROLLMENT_REQUIRED');
    await callOnce(guarded);
    expect(guarded.window.location.href).toBe('http://localhost/' + page);
  }
});

test('403 IP_NOT_ALLOWED shows one plain message and does not redirect', async () => {
  const guarded = guardOn('http://localhost/dashboard.html', 'IP_NOT_ALLOWED');
  await callOnce(guarded);
  await callOnce(guarded);
  expect(guarded.toasts).toEqual(['Your account can only be used from approved network addresses. Ask your administrator.']);
  expect(guarded.window.location.href).toBe('http://localhost/dashboard.html');
});

test('control: another 403 is passed on untouched', async () => {
  const guarded = guardOn('http://localhost/dashboard.html', 'AUTHORIZATION_ERROR');
  await callOnce(guarded);
  expect(guarded.window.location.href).toBe('http://localhost/dashboard.html');
  expect(guarded.toasts).toEqual([]);
});
