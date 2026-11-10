'use strict';

/**
 * Chef's paid seat refusal (409 problem+json SEAT_LIMIT_REACHED) and who may
 * add people and seats (src/js/shared/seat-limit.model.js).
 */

const S = require('../../src/js/shared/seat-limit.model');
const AppLinkPages = require('../../src/js/shared/app-link-pages.model');

const BILLING = 'https://lanaai.io/lana-ai/portal/billing/seats';
const DETAIL = `Your firm is using all 5 of its paid seats. An administrator can add seats here: ${BILLING}`;

/** The refusal as Chef sends it (seat-limit.service.js), shaped as api.js or a page's fetch rejects. */
function seatError(overrides = {}) {
  return {
    status: 409,
    data: Object.assign({
      type: 'urn:lana:problem:SEAT_LIMIT_REACHED', title: 'No seats left', status: 409,
      code: 'SEAT_LIMIT_REACHED', detail: DETAIL, seats: 5, billing_url: BILLING
    }, overrides)
  };
}

function fakeBridge() {
  const opened = [];
  return { opened, openExternal: (url) => { opened.push(url); return Promise.resolve(true); } };
}

function fakeUi(confirmAnswer = true) {
  const calls = { confirm: [], alert: [], info: [], error: [] };
  return {
    calls,
    modal: {
      confirmAsync: (heading, message, opts) => { calls.confirm.push({ heading, message, opts }); return Promise.resolve(confirmAnswer); },
      alertAsync: (heading, message, opts) => { calls.alert.push({ heading, message, opts }); return Promise.resolve(); }
    },
    toast: { info: (m) => calls.info.push(m), error: (m) => calls.error.push(m) }
  };
}

describe('refusal', () => {
  test('the exact code: Chef\'s detail, the seat count and the add-seats address for an administrator', () => {
    expect(S.refusal(seatError(), { canAddSeats: true })).toEqual({
      heading: 'No seats left', detail: DETAIL, message: DETAIL, seats: 5, canAddSeats: true, billingUrl: BILLING
    });
  });

  test('everyone else: Chef\'s detail plus "ask your administrator", and no address for a button', () => {
    for (const opts of [{ canAddSeats: false }, undefined]) {
      const found = S.refusal(seatError(), opts);
      expect(found.message).toBe(`${DETAIL} Ask your firm's administrator to add seats.`);
      expect(found.canAddSeats).toBe(false);
      expect(found.billingUrl).toBe('');
    }
  });

  test('the code nested under error (another envelope) is the same refusal', () => {
    const found = S.refusal({ status: 409, data: { error: { code: 'SEAT_LIMIT_REACHED', message: 'No seats.' } } }, { canAddSeats: true });
    expect(found.detail).toBe('No seats.');
  });

  test('lookalike codes and other errors are not the refusal', () => {
    for (const code of ['seat_limit_reached', 'SEAT_LIMIT_REACHED_SOON', ' SEAT_LIMIT_REACHED', 'SEAT_LIMIT', 'INVITE_EXPIRED', '']) {
      expect(S.refusal(seatError({ code }), { canAddSeats: true })).toBeNull();
    }
    expect(S.refusal({ status: 409, data: null }, { canAddSeats: true })).toBeNull();
    expect(S.refusal({ status: 0, data: null })).toBeNull();
    expect(S.refusal(null)).toBeNull();
    // A message that mentions the code is not the code.
    expect(S.refusal({ status: 400, data: { detail: 'SEAT_LIMIT_REACHED' } }, { canAddSeats: true })).toBeNull();
  });

  test('missing billing_url: no fallback address; missing detail: a sentence from the seat count', () => {
    expect(S.refusal(seatError({ billing_url: null }), { canAddSeats: true }).billingUrl).toBe('');
    expect(S.refusal(seatError({ billing_url: undefined }), { canAddSeats: true }).billingUrl).toBe('');
    expect(S.refusal(seatError({ detail: '' }), { canAddSeats: true }).detail).toBe('Your firm is using all 5 of its paid seats.');
    expect(S.refusal(seatError({ detail: '', seats: 1 }), { canAddSeats: true }).detail).toBe('Your firm is using its 1 paid seat.');
    expect(S.refusal(seatError({ detail: '', seats: '5' }), { canAddSeats: true })).toMatchObject({ seats: null, detail: 'Your firm is using all of its paid seats.' });
  });

  test('an address that is not absolute http(s) is refused', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://lanaai.io/x', '/portal/billing/seats', 'lanaai.io/billing', 'data:text/html,hi', 42]) {
      expect(S.refusal(seatError({ billing_url: url }), { canAddSeats: true }).billingUrl).toBe('');
    }
    expect(S.safeBillingUrl('http://localhost:3000/billing')).toBe('http://localhost:3000/billing');
  });
});

describe('canAddPeople', () => {
  test('only when Lex.Auth says system_admin or org_admin', () => {
    expect(S.canAddPeople({ canAccessAdminPages: () => true })).toBe(true);
    expect(S.canAddPeople({ canAccessAdminPages: () => false })).toBe(false);
    expect(S.canAddPeople({})).toBe(false);
    expect(S.canAddPeople(null)).toBe(false);
  });
});

describe('openAddSeats', () => {
  test('hands an http(s) address to the open-external bridge, nothing else', () => {
    const bridge = fakeBridge();
    expect(S.openAddSeats(BILLING, bridge)).toBe(true);
    expect(S.openAddSeats('javascript:alert(1)', bridge)).toBe(false);
    expect(S.openAddSeats('', bridge)).toBe(false);
    expect(bridge.opened).toEqual([BILLING]);
  });

  test('without the bridge nothing opens (never inside the app window)', () => {
    expect(S.openAddSeats(BILLING, null)).toBe(false);
    expect(S.openAddSeats(BILLING, {})).toBe(false);
  });
});

describe('addSeats (Chef vouches for the portal link)', () => {
  const SESSION = 'https://lanaai.io/lana-ai/portal/billing/seats?session=abc';

  function run(startSeatsSession, billingUrl = BILLING) {
    const ui = fakeUi();
    const bridge = fakeBridge();
    return S.addSeats(billingUrl, { startSeatsSession, bridge, modal: ui.modal, toast: ui.toast }).then((outcome) => ({ outcome, ui, bridge }));
  }

  test('success: opens the link Chef returned, not billing_url', async () => {
    const start = jest.fn().mockResolvedValue({ url: SESSION, expires_at: '2026-11-09T21:00:00Z' });
    const { outcome, ui, bridge } = await run(start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('session');
    expect(bridge.opened).toEqual([SESSION]);
    expect(ui.calls.info).toEqual([]);
  });

  test.each([
    ['503', { status: 503, data: { code: 'CONTROL_PLANE_UNAVAILABLE' } }],
    ['500', { status: 500, data: null }],
    ['network', { status: 0, data: null }]
  ])('Chef cannot make one (%s): opens billing_url with the sign-in note', async (_name, error) => {
    const { outcome, ui, bridge } = await run(() => Promise.reject(error));
    expect(outcome).toBe('fallback');
    expect(bridge.opened).toEqual([BILLING]);
    expect(ui.calls.info).toEqual([S.PORTAL_NOTE]);
  });

  test('a link that is not http(s) is never opened; billing_url is', async () => {
    const { outcome, bridge } = await run(() => Promise.resolve({ url: 'javascript:alert(1)' }));
    expect(outcome).toBe('fallback');
    expect(bridge.opened).toEqual([BILLING]);
  });

  test('403: "Only an administrator can add seats", nothing opens', async () => {
    const { outcome, ui, bridge } = await run(() => Promise.reject({ status: 403, data: { code: 'AUTHORIZATION_ERROR' } }));
    expect(outcome).toBe('refused');
    expect(ui.calls.alert.map((a) => a.heading)).toEqual(['Only an administrator can add seats']);
    expect(bridge.opened).toEqual([]);
  });

  test('401: nothing opens (api.js already shows the session-expired dialog)', async () => {
    const { outcome, bridge } = await run(() => Promise.reject({ status: 401, data: null }));
    expect(outcome).toBe('signed-out');
    expect(bridge.opened).toEqual([]);
  });

  test('Chef fails and there is no billing_url: a plain error, nothing opens', async () => {
    const { outcome, ui, bridge } = await run(() => Promise.reject({ status: 503 }), '');
    expect(outcome).toBe('failed');
    expect(ui.calls.error).toEqual([S.OPEN_FAILED]);
    expect(bridge.opened).toEqual([]);
  });
});

describe('presentToAdmin', () => {
  test('any other error: resolves false and shows nothing', async () => {
    const ui = fakeUi();
    const handled = await S.presentToAdmin({ status: 400, data: { error: { code: 'VALIDATION_ERROR', message: 'Email exists' } } }, { modal: ui.modal, toast: ui.toast, canAddSeats: true });
    expect(handled).toBe(false);
    expect(ui.calls).toEqual({ confirm: [], alert: [], info: [], error: [] });
  });

  test('administrator: Chef\'s detail with Add seats; choosing it asks Chef and opens the link', async () => {
    const ui = fakeUi(true);
    const bridge = fakeBridge();
    const start = jest.fn().mockResolvedValue({ url: BILLING + '?s=1' });
    const handled = await S.presentToAdmin(seatError(), { modal: ui.modal, toast: ui.toast, bridge, canAddSeats: true, startSeatsSession: start });
    expect(handled).toBe(true);
    expect(ui.calls.confirm).toEqual([{ heading: 'No seats left', message: DETAIL, opts: { confirmText: 'Add seats', cancelText: 'Close' } }]);
    expect(bridge.opened).toEqual([BILLING + '?s=1']);
  });

  test('administrator who closes the modal: Chef is not asked, nothing opens', async () => {
    const ui = fakeUi(false);
    const bridge = fakeBridge();
    const start = jest.fn();
    await S.presentToAdmin(seatError(), { modal: ui.modal, toast: ui.toast, bridge, canAddSeats: true, startSeatsSession: start });
    expect(start).not.toHaveBeenCalled();
    expect(bridge.opened).toEqual([]);
  });

  test('everyone else: Chef\'s detail and "ask your administrator", Close only, no Add seats', async () => {
    const ui = fakeUi(true);
    const start = jest.fn();
    const handled = await S.presentToAdmin(seatError(), { modal: ui.modal, toast: ui.toast, bridge: fakeBridge(), canAddSeats: false, startSeatsSession: start });
    expect(handled).toBe(true);
    expect(ui.calls.confirm).toEqual([]);
    expect(ui.calls.alert).toEqual([{ heading: 'No seats left', message: `${DETAIL} ${S.ASK_ADMIN}`, opts: { confirmText: 'Close' } }]);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('the activation and invitation pages (app-link-pages.model.js)', () => {
  test.each(['activate', 'invite'])('%s: Chef\'s detail and "ask your administrator"; never a sign-in offer', (kind) => {
    expect(AppLinkPages.setPasswordProblem(seatError(), kind)).toEqual({ message: `${DETAIL} ${S.ASK_ADMIN}`, signIn: false });
  });

  test('other refusals keep their words', () => {
    expect(AppLinkPages.setPasswordProblem(seatError({ code: 'INVITE_EXPIRED' }), 'invite').message)
      .toBe('This invitation has expired. Ask your firm\'s administrator for a new one.');
    expect(AppLinkPages.setPasswordProblem(seatError({ code: 'seat_limit_reached', detail: 'Code not found.' }), 'activate').message)
      .toBe('Code not found.');
  });
});
