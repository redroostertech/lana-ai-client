/**
 * Regression tests — SCRUM-234: noisy toasts after login.
 *
 * Bug: every successful login stacked three toasts ("Login successful!
 * Redirecting...", "Checking desktop notification permission...",
 * "Desktop notifications enabled." / blocked-permission guidance) and,
 * when permission was granted (always, in Electron), also fired an
 * OS-level "test notification".
 *
 * Fix: the login success path shows exactly one toast and ensures the
 * desktop notification permission quietly via
 * DesktopNotifications.enableFromUserGesture() — the same silent path the
 * notification bell uses — logging the outcome to the console only.
 *
 * These tests execute the REAL login.html inline script plus the REAL
 * js/notifications.js in a vm sandbox with a hand-built DOM stub (per repo
 * convention we avoid jsdom), simulate a successful login, and record
 * every Toast call and OS Notification constructed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function makeElement(id) {
  const classes = new Set(['hidden']);
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    type: 'password',
    checked: false,
    disabled: false,
    readOnly: true,
    placeholder: '',
    dataset: {},
    _handlers: {},
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    addEventListener(event, handler) {
      (this._handlers[event] = this._handlers[event] || []).push(handler);
    },
    focus() {},
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

async function runLoginScenario({ permission }) {
  const loginHtml = fs.readFileSync(path.join(ROOT, 'src/login.html'), 'utf8');
  const notificationsJs = fs.readFileSync(
    path.join(ROOT, 'src/js/notifications.js'),
    'utf8'
  );

  // The page's main inline script is its longest <script> block without src.
  const inlineScripts = [...loginHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1]
  );
  expect(inlineScripts.length).toBeGreaterThan(0);
  const mainScript = inlineScripts.reduce((a, b) => (b.length > a.length ? b : a));

  const toasts = [];
  const osNotifications = [];
  const timeouts = [];
  let permissionRequests = 0;

  const elements = new Map();
  const doc = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    addEventListener() {},
    readyState: 'complete',
  };

  const localStorage = makeStorage();
  const sessionStorage = makeStorage();

  // Pre-seed a saved server so the script lands directly on Step 2 with
  // resolvedServerInfo set (a returning user opening the app).
  localStorage.setItem(
    'lana_saved_server',
    JSON.stringify({
      url: 'http://127.0.0.1:3001',
      orgId: 'testorg',
      orgName: 'Test Org',
      domain: 'testorg.lanaai.io',
    })
  );

  function NotificationStub(title, opts) {
    osNotifications.push({ title, body: opts && opts.body });
    this.close = () => {};
  }
  NotificationStub.permission = permission;
  NotificationStub.requestPermission = async () => {
    permissionRequests += 1;
    NotificationStub.permission = permission === 'default' ? 'granted' : permission;
    return NotificationStub.permission;
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: doc,
    localStorage,
    sessionStorage,
    setTimeout: (fn, ms) => timeouts.push({ fn, ms }),
    clearTimeout() {},
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    AbortSignal: { timeout: () => undefined },
    URL,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    navigator: { platform: 'MacIntel' },
    Notification: NotificationStub,
    Toast: {
      success: (m) => toasts.push({ level: 'success', message: m }),
      info: (m) => toasts.push({ level: 'info', message: m }),
      error: (m) => toasts.push({ level: 'error', message: m }),
    },
    api: {
      baseUrl: null,
      token: null,
      user: null,
      isAuthenticated: () => false,
      isTokenExpired: () => true,
      login: async () => ({ token: 't', user: { id: 'u1', email: 'qa@example.com' } }),
    },
    location: { href: '', replace() {} },
    Date,
    JSON,
    Promise,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(notificationsJs, sandbox, { filename: 'notifications.js' });
  vm.runInContext(mainScript, sandbox, { filename: 'login-inline.js' });

  const loginForm = elements.get('loginForm');
  expect(loginForm && loginForm._handlers.submit).toBeTruthy();

  doc.getElementById('email').value = 'qa@example.com';
  doc.getElementById('password').value = 'hunter2!';
  doc.getElementById('mfaToken').value = '';

  await loginForm._handlers.submit[0]({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  return { toasts, osNotifications, timeouts, localStorage, permissionRequests: () => permissionRequests };
}

describe('SCRUM-234: successful login shows exactly one toast', () => {
  test.each(['granted', 'denied', 'default'])(
    'permission=%s → only the login-success toast, no OS test notification',
    async (permission) => {
      const result = await runLoginScenario({ permission });

      expect(result.toasts).toEqual([
        { level: 'success', message: 'Login successful! Redirecting...' },
      ]);
      expect(result.osNotifications).toEqual([]);
      // Redirect to the dashboard is still scheduled.
      expect(result.timeouts.some((t) => t.ms === 500)).toBe(true);
    }
  );

  test('permission is still ensured silently (feature not removed)', async () => {
    const granted = await runLoginScenario({ permission: 'granted' });
    expect(granted.localStorage.getItem('lana.desktopNotifications.enabled')).toBe('true');

    const prompted = await runLoginScenario({ permission: 'default' });
    expect(prompted.permissionRequests()).toBe(1);
  });

  test('source contract: login success path has no notification-status toasts', () => {
    const loginHtml = fs.readFileSync(path.join(ROOT, 'src/login.html'), 'utf8');
    expect(loginHtml).not.toContain('Checking desktop notification permission');
    expect(loginHtml).not.toContain('Desktop notifications enabled.');
    expect(loginHtml).not.toContain('requestPermissionAndTest');
    expect(loginHtml).toContain('DesktopNotifications.enableFromUserGesture');
  });
});
