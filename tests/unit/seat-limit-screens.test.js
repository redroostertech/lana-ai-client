'use strict';

/**
 * Every screen that can meet Chef's paid seat refusal (409 problem+json
 * SEAT_LIMIT_REACHED), and who sees the add-people controls:
 *   activate.html, accept-invite.html  (not signed in: Chef's words, ask the administrator, no button)
 *   admin/users.html                   (Add User; create)
 *   admin/user-details.html            (Edit, Activate, Regenerate Activation Key)
 * plus api.js: the seats-session call, and no session-expired dialog for the 409.
 *
 * The page scripts run for real against their real markup (app-link pages,
 * in jsdom) or a small element fake (admin pages, as admin-tables.test.js).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const BILLING = 'https://lanaai.io/lana-ai/portal/billing/seats';
const DETAIL = `Your firm is using all 5 of its paid seats. An administrator can add seats here: ${BILLING}`;
const ASK = 'Ask your firm\'s administrator to add seats.';
const ADMIN_MSG = 'Your firm is using all 5 of its paid seats. Add seats to add more people.';
const ACTIVATE_MSG = `Your firm is using all 5 of its paid seats, so this account cannot be activated yet. ${ASK}`;
const INVITE_MSG = `Your firm is using all 5 of its paid seats, so this invitation cannot be accepted yet. ${ASK}`;
const SEAT_BODY = { type: 'urn:lana:problem:SEAT_LIMIT_REACHED', title: 'No seats left', status: 409, code: 'SEAT_LIMIT_REACHED', detail: DETAIL, seats: 5, billing_url: BILLING };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── App-link pages (jsdom, real markup, real model + kit + page script) ──

function appLinkPage(html, scripts, { status, body, search = '' }) {
  const markup = read(html).replace(/<script\b[^>]*><\/script>/g, '');
  const dom = new JSDOM(markup, { url: 'http://client.test/' + html + search, runScripts: 'outside-only' });
  const { window } = dom;
  const opened = [];
  const posts = [];
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.electronAPI = {
    getSavedServer: () => Promise.resolve({ success: true, server: { url: 'https://firm.test', orgName: 'Norton Law' } }),
    openExternal: (url) => { opened.push(url); return Promise.resolve(true); }
  };
  window.fetch = (url, init) => {
    posts.push(url);
    return Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
  };
  scripts.forEach((rel) => window.eval(read(rel)));
  const text = (id) => window.document.getElementById(id).textContent.trim();
  const shown = (id) => !window.document.getElementById(id).hidden;
  return { window, opened, posts, text, shown };
}

const KIT = ['js/shared/seat-limit.model.js', 'js/shared/app-link-pages.model.js', 'js/shared/app-link-page-kit.js'];

async function submitActivate(response) {
  const page = appLinkPage('activate.html', ['js/app-catalog.js', 'js/shared/org-discovery.js', 'js/shared/activate-flow.js', ...KIT, 'js/pages/activate.js'], { ...response, search: '?code=LANA-AAAA-BBBB-CCCC' });
  await tick();
  const doc = page.window.document;
  doc.getElementById('acPassword').value = 'long enough';
  doc.getElementById('acConfirm').value = 'long enough';
  doc.getElementById('acForm').dispatchEvent(new page.window.CustomEvent('lex-submit'));
  await tick(); await tick(); await tick();
  return page;
}

async function submitInvite(response) {
  const page = appLinkPage('accept-invite.html', [...KIT, 'js/pages/accept-invite.js'], { ...response, search: '?token=tok' });
  await tick();
  const doc = page.window.document;
  doc.getElementById('aiPassword').value = 'Abcdefg1!';
  doc.getElementById('aiConfirm').value = 'Abcdefg1!';
  doc.getElementById('aiForm').dispatchEvent(new page.window.CustomEvent('lex-submit'));
  await tick(); await tick(); await tick();
  return page;
}

describe('activate.html', () => {
  test('409 SEAT_LIMIT_REACHED: the seats in use, cannot be activated yet, ask your administrator; no button, no address', async () => {
    const page = await submitActivate({ status: 409, body: SEAT_BODY });
    expect(page.posts).toEqual(['https://firm.test/api/v1/auth/activate']);
    expect(page.shown('acError')).toBe(true);
    expect(page.text('acError')).toBe(ACTIVATE_MSG);
    expect(page.window.document.body.textContent).not.toContain('Add seats');
    expect(page.window.document.body.textContent).not.toContain('https://');
    expect(page.shown('acDoneView')).toBe(false);
    expect(page.opened).toEqual([]);
  });

  test('another refusal: the page words it as before', async () => {
    const page = await submitActivate({ status: 400, body: { detail: 'This activation code has expired.' } });
    expect(page.text('acError')).toBe('This activation code has expired.');
  });
});

describe('accept-invite.html', () => {
  test('409 SEAT_LIMIT_REACHED: the seats in use, cannot be accepted yet, ask your administrator; no sign-in offer, no button', async () => {
    const page = await submitInvite({ status: 409, body: SEAT_BODY });
    expect(page.posts).toEqual(['https://firm.test/api/v1/auth/accept-invite']);
    expect(page.text('aiError')).toBe(INVITE_MSG);
    expect(page.window.document.body.textContent).not.toContain('https://');
    expect(page.shown('aiErrorSignIn')).toBe(false);
    expect(page.window.document.body.textContent).not.toContain('Add seats');
    expect(page.opened).toEqual([]);
  });

  test('another refusal: the page words it as before', async () => {
    const page = await submitInvite({ status: 409, body: { code: 'INVITE_EMAIL_IN_USE', detail: 'x' } });
    expect(page.text('aiError')).toBe('You already have an account with this email. Sign in with your email and password.');
    expect(page.shown('aiErrorSignIn')).toBe(true);
  });
});

// ── Admin pages (element fakes, real page script) ──

function element(extra = {}) {
  const listeners = {};
  return Object.assign({
    listeners,
    hidden: false,
    open: false,
    classList: { add() {}, remove() {} },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: (type, detail) => (listeners[type] || []).forEach((fn) => fn({ detail, preventDefault() {} })),
    querySelector: () => null,
    reset() {}
  }, extra);
}

function adminPage(rel, { canAddPeople = true, api: apiOverrides = {}, confirmAnswer = true, search = '', user } = {}) {
  const calls = { confirm: [], alert: [], toastError: [], toastInfo: [], opened: [], session: 0, confirmModal: [] };
  const elements = {
    addUserBtn: element(),
    userModal: element(),
    userForm: element(),
    userBanner: element(),
    userActionsDropdown: element({
      options: [
        { value: 'edit', label: 'Edit User' }, { value: 'toggle-status', label: 'Activate User' },
        { value: 'reset-pw', label: 'Reset Password' }, { value: 'regen-key', label: 'Regenerate Activation Key' },
        { value: 'delete', label: 'Delete User' }
      ]
    })
  };
  const pending = () => new Promise(() => {});
  const api = Object.assign({
    getUser: () => (user ? Promise.resolve({ user }) : pending()),
    getRoles: pending,
    get: pending,
    createSeatsSession: () => { calls.session += 1; return Promise.resolve({ url: BILLING + '?session=1', expires_at: 'x' }); }
  }, apiOverrides);
  const apiProxy = new Proxy(api, { get: (t, k) => (k in t ? t[k] : pending) });
  const win = { localStorage: { getItem: () => null }, Intl, Date, location: { search } };
  new Function('window', read('js/time-utils.js'))(win);
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  win.Lex.Nav = { getParams: () => new URLSearchParams('userId=u-9'), go: () => {} };
  win.Lex.Toast = { error: (m) => calls.toastError.push(m), success: () => {}, info: (m) => calls.toastInfo.push(m) };
  win.Lex.Redact = { on() {}, off() {} };
  win.Lex.Auth = { canAccessAdminPages: () => canAddPeople };
  win.Lex.Modal = {
    confirmAsync: (heading, message, opts) => { calls.confirm.push({ heading, message, opts }); return Promise.resolve(confirmAnswer); },
    alertAsync: (heading, message) => { calls.alert.push({ heading, message }); return Promise.resolve(); },
    // The page's own "Are you sure?" confirm: answer yes at once.
    confirm: (heading, _message, onConfirm) => { calls.confirmModal.push(heading); onConfirm(); },
    open: () => {}
  };
  win.electronAPI = { openExternal: (url) => { calls.opened.push(url); return Promise.resolve(true); } };
  win.SeatLimit = require('../../src/js/shared/seat-limit.model');
  const document = { getElementById: (id) => elements[id] || null, addEventListener: () => {}, querySelector: () => null };
  const context = {
    window: win, document, Lex: win.Lex, LanaTime: win.LanaTime, api: apiProxy, URLSearchParams, console: { error() {}, warn() {}, log() {} },
    setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(),
    AdminUsersPagination: require('../../src/js/admin/admin-users.pagination')
  };
  win.document = document;
  win.api = apiProxy;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return { elements, calls };
}

const seatRejection = () => Promise.reject({ status: 409, message: DETAIL, data: SEAT_BODY });
const otherRejection = () => Promise.reject({ status: 400, message: 'Email address already in use', data: { error: { code: 'VALIDATION_ERROR', message: 'Email address already in use' } } });
const CREATE_VALUES = { first_name: 'Pat', last_name: 'Lee', email: 'pat@firm.test', username: 'plee', role_id: 'r1', password: 'Abcdefg1!' };
const settle = async () => { for (let i = 0; i < 6; i += 1) await tick(); };

describe('admin/users.html', () => {
  test('create refused for seats: the seats in use with Add seats; Add seats asks Chef and opens its link', async () => {
    const page = adminPage('js/admin/admin-users.js', { api: { createUser: seatRejection } });
    page.elements.addUserBtn.fire('click');
    expect(page.elements.userModal.open).toBe(true);
    page.elements.userForm.fire('lex-submit', { valid: true, values: CREATE_VALUES });
    await settle();
    expect(page.calls.confirm).toEqual([{ heading: 'No seats left', message: ADMIN_MSG, opts: { confirmText: 'Add seats', cancelText: 'Close' } }]);
    expect(page.calls.session).toBe(1);
    expect(page.calls.opened).toEqual([BILLING + '?session=1']);
    expect(page.calls.toastError).toEqual([]);
    // The Add User form stays open with what was typed.
    expect(page.elements.userModal.open).toBe(true);
  });

  test('Chef cannot make a portal link: billing_url opens with the sign-in note', async () => {
    const page = adminPage('js/admin/admin-users.js', { api: { createUser: seatRejection, createSeatsSession: () => Promise.reject({ status: 503, data: null }) } });
    page.elements.userForm.fire('lex-submit', { valid: true, values: CREATE_VALUES });
    await settle();
    expect(page.calls.opened).toEqual([BILLING]);
    expect(page.calls.toastInfo).toEqual(['The billing page opened in your browser. You may need to sign in to the LANA portal first.']);
  });

  test('Chef answers 403: "Only an administrator can add seats", nothing opens', async () => {
    const page = adminPage('js/admin/admin-users.js', { api: { createUser: seatRejection, createSeatsSession: () => Promise.reject({ status: 403, data: null }) } });
    page.elements.userForm.fire('lex-submit', { valid: true, values: CREATE_VALUES });
    await settle();
    expect(page.calls.alert.map((a) => a.heading)).toEqual(['Only an administrator can add seats']);
    expect(page.calls.opened).toEqual([]);
  });

  test('any other create error: the same toast as before, no seat modal', async () => {
    const page = adminPage('js/admin/admin-users.js', { api: { createUser: otherRejection } });
    page.elements.userForm.fire('lex-submit', { valid: true, values: CREATE_VALUES });
    await settle();
    expect(page.calls.toastError).toEqual(['Email address already in use']);
    expect(page.calls.confirm).toEqual([]);
    expect(page.calls.alert).toEqual([]);
  });

  test('Add User shows for system_admin / org_admin only', () => {
    expect(adminPage('js/admin/admin-users.js', { canAddPeople: true }).elements.addUserBtn.hidden).toBe(false);
    const page = adminPage('js/admin/admin-users.js', { canAddPeople: false });
    expect(page.elements.addUserBtn.hidden).toBe(true);
  });

  test('someone else reaching the Add User form gets the plain message, not the form', async () => {
    const page = adminPage('js/admin/admin-users.js', { canAddPeople: false });
    page.elements.addUserBtn.fire('click');
    await settle();
    expect(page.calls.alert.map((a) => a.heading)).toEqual(['Only an administrator can add people']);
    expect(page.elements.userModal.open).toBe(false);
  });
});

describe('admin/user-details.html', () => {
  const INACTIVE = { id: 'u-9', first_name: 'Pat', last_name: 'Lee', email: 'pat@firm.test', status: 'inactive' };
  const ACTIVE = { ...INACTIVE, status: 'active' };
  const actions = (page) => page.elements.userActionsDropdown.options.map((o) => o.value + ':' + o.label);

  test('Activate refused for seats: the seats in use with Add seats', async () => {
    const page = adminPage('js/admin/admin-user-details.js', { user: INACTIVE, confirmAnswer: false, api: { activateUser: seatRejection } });
    await settle();
    page.elements.userBanner.fire('lex-select', { value: 'toggle-status' });
    await settle();
    expect(page.calls.confirmModal).toEqual(['Activate User']);
    expect(page.calls.confirm).toEqual([{ heading: 'No seats left', message: ADMIN_MSG, opts: { confirmText: 'Add seats', cancelText: 'Close' } }]);
    expect(page.calls.toastError).toEqual([]);
    expect(page.calls.session).toBe(0);
  });

  test('Regenerate Activation Key refused for seats: the same modal; other errors keep their toast', async () => {
    const seat = adminPage('js/admin/admin-user-details.js', { user: INACTIVE, confirmAnswer: false, api: { regenerateActivationKey: seatRejection } });
    await settle();
    seat.elements.userBanner.fire('lex-select', { value: 'regen-key' });
    await settle();
    expect(seat.calls.confirm.map((c) => c.heading)).toEqual(['No seats left']);

    const other = adminPage('js/admin/admin-user-details.js', { user: INACTIVE, api: { regenerateActivationKey: otherRejection } });
    await settle();
    other.elements.userBanner.fire('lex-select', { value: 'regen-key' });
    await settle();
    expect(other.calls.toastError).toEqual(['Email address already in use']);
    expect(other.calls.confirm).toEqual([]);
  });

  test('Edit refused for seats: the same modal instead of the toast', async () => {
    const page = adminPage('js/admin/admin-user-details.js', { user: ACTIVE, confirmAnswer: false, api: { updateUser: seatRejection } });
    await settle();
    page.elements.userForm.fire('lex-submit', { valid: true, values: CREATE_VALUES });
    await settle();
    expect(page.calls.confirm.map((c) => c.heading)).toEqual(['No seats left']);
    expect(page.calls.toastError).toEqual([]);
  });

  test('administrator: every action stays in the menu', async () => {
    const page = adminPage('js/admin/admin-user-details.js', { user: INACTIVE });
    await settle();
    expect(actions(page)).toEqual(['edit:Edit User', 'toggle-status:Activate User', 'reset-pw:Reset Password', 'regen-key:Regenerate Activation Key', 'delete:Delete User']);
  });

  test('someone else: no Activate and no new activation key; Deactivate stays for an active user', async () => {
    const inactive = adminPage('js/admin/admin-user-details.js', { user: INACTIVE, canAddPeople: false });
    await settle();
    expect(actions(inactive)).toEqual(['edit:Edit User', 'reset-pw:Reset Password', 'delete:Delete User']);

    const active = adminPage('js/admin/admin-user-details.js', { user: ACTIVE, canAddPeople: false });
    await settle();
    expect(actions(active)).toEqual(['edit:Edit User', 'toggle-status:Deactivate User', 'reset-pw:Reset Password', 'delete:Delete User']);
  });

  test('someone else: an action hidden for one status comes back when the user reloads with the other', async () => {
    const answers = [INACTIVE, ACTIVE];
    const page = adminPage('js/admin/admin-user-details.js', { canAddPeople: false, api: { getUser: () => Promise.resolve({ user: answers.shift() }), updateUser: () => Promise.resolve({}) } });
    await settle();
    expect(actions(page)).not.toContain('toggle-status:Activate User');
    // Saving an edit reloads the user, now active.
    page.elements.userForm.fire('lex-submit', { valid: true, values: CREATE_VALUES });
    await settle();
    expect(actions(page)).toContain('toggle-status:Deactivate User');
  });

  test('someone else reaching Activate or a new key anyway gets the plain message and nothing is sent', async () => {
    const activateUser = jest.fn(seatRejection);
    const regenerateActivationKey = jest.fn(seatRejection);
    const page = adminPage('js/admin/admin-user-details.js', { user: INACTIVE, canAddPeople: false, api: { activateUser, regenerateActivationKey } });
    await settle();
    page.elements.userBanner.fire('lex-select', { value: 'toggle-status' });
    page.elements.userBanner.fire('lex-select', { value: 'regen-key' });
    await settle();
    expect(page.calls.alert.map((a) => a.heading)).toEqual(['Only an administrator can add people', 'Only an administrator can add people']);
    expect(activateUser).not.toHaveBeenCalled();
    expect(regenerateActivationKey).not.toHaveBeenCalled();
  });
});

// ── Each page loads the seat module before the script that uses it ──

describe('script order', () => {
  test.each([
    ['activate.html', 'js/shared/seat-limit.model.js', 'js/shared/app-link-pages.model.js'],
    ['accept-invite.html', 'js/shared/seat-limit.model.js', 'js/shared/app-link-pages.model.js'],
    ['admin/users.html', '../js/shared/seat-limit.model.js', '../js/admin/admin-users.js'],
    ['admin/user-details.html', '../js/shared/seat-limit.model.js', '../js/admin/admin-user-details.js']
  ])('%s', (page, first, then) => {
    const html = read(page);
    const a = html.indexOf(`<script src="${first}"></script>`);
    const b = html.indexOf(`<script src="${then}"></script>`);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });
});

// ── api.js ──

function loadApi() {
  const context = {
    console: { log() {}, warn() {}, error() {} }, URLSearchParams, AbortController, Headers, FormData: class FormData {},
    setTimeout, clearTimeout, setInterval, clearInterval, fetch: jest.fn(),
    localStorage: { getItem: jest.fn(() => null), setItem: jest.fn(), removeItem: jest.fn() },
    document: { addEventListener: jest.fn(), body: {}, getElementById: jest.fn(() => null) },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/admin/users.html' },
    LanaConfig: {},
    LanaTime: { nowMs: jest.fn(() => 1000), millisecondsSince: jest.fn((start) => 1000 - start), MS_PER_MINUTE: 60000 }
  };
  context.window = context;
  context.globalThis = context;
  const apiPath = path.join(SRC, 'js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
  return { api: context.window.api, context };
}

describe('api.js', () => {
  test('createSeatsSession: POST /api/v1/billing/seats-session', async () => {
    const { api } = loadApi();
    api.post = jest.fn().mockResolvedValue({ url: BILLING, expires_at: 'x' });
    await expect(api.createSeatsSession()).resolves.toEqual({ url: BILLING, expires_at: 'x' });
    expect(api.post).toHaveBeenCalledWith('/api/v1/billing/seats-session', {});
  });

  test('a 409 SEAT_LIMIT_REACHED is not a signed-out session: no dialog, Chef\'s body kept on the error', async () => {
    const { api, context } = loadApi();
    api.showSessionExpiredModal = jest.fn();
    context.fetch.mockResolvedValue({ ok: false, status: 409, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(SEAT_BODY)) });
    const error = await api.request('POST', '/api/v1/admin/users', { email: 'pat@firm.test' }).catch((e) => e);
    expect(api.showSessionExpiredModal).not.toHaveBeenCalled();
    expect(error.status).toBe(409);
    expect(error.data.billing_url).toBe(BILLING);
    expect(require('../../src/js/shared/seat-limit.model').refusal(error, { canAddSeats: true }).billingUrl).toBe(BILLING);
  });
});
