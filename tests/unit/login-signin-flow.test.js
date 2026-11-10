/**
 * login.html wiring for self-serve onboarding:
 * - when the organization cannot be found or reached, Step 1 shows what to
 *   check, a retry and the support address (before: one toast, then stuck).
 *
 * Runs the REAL login.html inline script with js/shared/org-discovery.js in a
 * vm sandbox and a hand-built DOM stub (repo convention: no jsdom).
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

function loadLogin({ fetch }) {
  const loginHtml = fs.readFileSync(path.join(ROOT, 'src/login.html'), 'utf8');
  const inlineScripts = [...loginHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const mainScript = inlineScripts.reduce((a, b) => (b.length > a.length ? b : a));

  const toasts = [];
  const logins = [];
  const elements = new Map();
  const doc = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    addEventListener() {},
    readyState: 'complete',
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: doc,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    setTimeout: () => 0,
    clearTimeout() {},
    fetch,
    AbortSignal: { timeout: () => undefined },
    URL,
    URLSearchParams,
    Event: function Event(type) { this.type = type; },
    navigator: { platform: 'MacIntel' },
    ServerReachability: { buildUnreachableMessage: () => 'Server did not answer.' },
    AccountStatus: { classifyLoginFailure: () => 'unknown' },
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
      login: async (email, password) => {
        logins.push({ email, password });
        return { token: 't', user: { id: 'u1', email } };
      },
    },
    location: { href: '', search: '', replace() {} },
    Date,
    JSON,
    Promise,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/shared/org-discovery.js'), 'utf8'), sandbox);
  vm.runInContext(mainScript, sandbox, { filename: 'login-inline.js' });

  return { sandbox, elements, el: (id) => doc.getElementById(id), toasts, logins };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Step 1: the organization cannot be found or reached', () => {
  test.each([
    ['not found', async () => ({ ok: false, status: 404, json: async () => ({ error: 'Organization not found or inactive' }) }), 'We could not find that organization'],
    ['no network', async () => { throw new TypeError('Failed to fetch'); }, 'LANA could not reach the sign-in service'],
  ])('%s shows what to check, a retry and support', async (_label, fetch, title) => {
    const page = loadLogin({ fetch });
    page.el('orgId').value = 'smithlaw';
    page.el('serverUrl').value = 'smithlaw.lanaai.io';

    await page.el('discoveryForm')._handlers.submit[0]({ preventDefault() {} });
    await flush();

    expect(page.el('discoveryError').classList.contains('hidden')).toBe(false);
    expect(page.el('discoveryErrorTitle').textContent).toBe(title);
    expect(page.el('discoveryErrorSupport').textContent).toContain('support@redroostertec.com');
    expect(page.el('discoveryRetryBtn')._handlers.click).toHaveLength(1);
    expect(page.el('connectBtn').disabled).toBe(false);
  });

  test('a later successful Connect hides the failure', async () => {
    let fail = true;
    const fetch = async (url) => {
      if (fail) throw new TypeError('Failed to fetch');
      if (String(url).includes('/api/health/discovery')) return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'healthy',
          discovery: { static_ip: '10.0.0.5', port: 8080 },
          server: { org_id: 'smithlaw', org_name: 'Smith Law' },
        }),
      };
    };
    const page = loadLogin({ fetch });
    page.el('orgId').value = 'smithlaw';
    page.el('serverUrl').value = 'smithlaw.lanaai.io';
    const submit = page.el('discoveryForm')._handlers.submit[0];

    await submit({ preventDefault() {} });
    expect(page.el('discoveryError').classList.contains('hidden')).toBe(false);

    fail = false;
    await submit({ preventDefault() {} });
    await flush();
    expect(page.el('discoveryError').classList.contains('hidden')).toBe(true);
    expect(page.sandbox.api.baseUrl).toBe('http://10.0.0.5:8080');
  });
});
