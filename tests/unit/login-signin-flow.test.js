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
const { loadSessionGate } = require('./helpers/session-gate');

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

function loadLogin({ fetch, electronAPI = undefined, reachability = null }) {
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
    ServerReachability: reachability || { buildUnreachableMessage: () => 'Server did not answer.', buildCertificateMessage: () => '' },
    electronAPI,
    AccountStatus: { classifyLoginFailure: () => 'unknown' },
    LanaSessionGate: loadSessionGate(),
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

// A hardware box's Chef (electron-chef-pin.js): the control plane's pin is set
// in the main process before the page probes the box, carried into the saved
// server, and a refused certificate is explained rather than "not reachable".
describe('Step 1: a hardware box with a pinned certificate', () => {
  const PIN = 'ab'.repeat(32);
  const reachability = require(path.join(ROOT, 'src/js/shared/server-reachability.js'));

  function boxFetch(probe, order) {
    return async (url) => {
      if (String(url).includes('/api/health/discovery')) { order.push('probe ' + url); return probe(); }
      return { ok: true, status: 200, json: async () => ({ status: 'healthy', chef_cert_sha256: PIN, discovery: { static_ip: '10.0.0.5', port: 8080, chef_cert_sha256: PIN }, server: { org_id: 'smithlaw', org_name: 'Smith Law' } }) };
    };
  }
  function electron(order, refusal = null) {
    const saved = [];
    return {
      saved,
      api: {
        getConfig: async () => ({}),
        saveSettings: async (settings) => { saved.push(settings); return { success: true }; },
        chefPin: {
          prepare: async (server) => { order.push('prepare ' + server.url + ' ' + server.chefCertSha256); return { success: true, pinned: true }; },
          refusal: async () => ({ success: true, reason: refusal })
        }
      }
    };
  }

  test('the pin is prepared before the probe, the box is reached over https, and the pin is saved', async () => {
    const order = [];
    const app = electron(order);
    const page = loadLogin({ fetch: boxFetch(async () => ({ ok: true, status: 200, json: async () => ({ status: 'healthy' }) }), order), electronAPI: app.api, reachability });
    page.el('orgId').value = 'smithlaw';
    page.el('serverUrl').value = 'smithlaw.lanaai.io';
    await page.el('discoveryForm')._handlers.submit[0]({ preventDefault() {} });
    await flush();
    expect(order).toEqual(['prepare https://10.0.0.5:8080 ' + PIN, 'probe https://10.0.0.5:8080/api/health/discovery']);
    expect(app.saved[0]).toMatchObject({ url: 'https://10.0.0.5:8080', chefCertSha256: PIN });
  });

  test('a certificate that is not the pinned one is named, not reported as unreachable', async () => {
    const order = [];
    const app = electron(order, 'mismatch');
    const page = loadLogin({ fetch: boxFetch(async () => { throw new TypeError('Failed to fetch'); }, order), electronAPI: app.api, reachability });
    page.el('orgId').value = 'smithlaw';
    page.el('serverUrl').value = 'smithlaw.lanaai.io';
    await page.el('discoveryForm')._handlers.submit[0]({ preventDefault() {} });
    await flush();
    expect(page.el('discoveryErrorDetail').textContent).toMatch(/did not present the security certificate on record for Smith Law/);
    expect(app.saved).toEqual([]);
  });

  test('plain HTTP to a box with no pin (403 HTTPS_REQUIRED) says a secure connection is needed', async () => {
    const order = [];
    const app = electron(order);
    const fetch = async (url) => {
      if (String(url).includes('/api/health/discovery')) return { ok: false, status: 403, json: async () => ({ error: 'HTTPS required', code: 'HTTPS_REQUIRED' }) };
      return { ok: true, status: 200, json: async () => ({ status: 'healthy', discovery: { static_ip: '10.0.0.5', port: 8080 }, server: { org_id: 'smithlaw', org_name: 'Smith Law' } }) };
    };
    const page = loadLogin({ fetch, electronAPI: app.api, reachability });
    page.el('orgId').value = 'smithlaw';
    page.el('serverUrl').value = 'smithlaw.lanaai.io';
    await page.el('discoveryForm')._handlers.submit[0]({ preventDefault() {} });
    await flush();
    expect(page.el('discoveryErrorDetail').textContent).toMatch(/needs a secure connection, and LANA has no security certificate on record/);
  });
});
