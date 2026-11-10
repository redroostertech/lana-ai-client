/*
 * SeatLimit - Chef's paid seat refusal, and who may add people and seats, in
 * one place for every screen that creates, activates or reactivates an account.
 *
 * Chef refuses with 409 problem+json, code SEAT_LIMIT_REACHED, a `detail`
 * written for a person, and the extension fields `seats` (the paid count) and
 * `billing_url` (the add-seats page). Chef decides the limit; this only shapes
 * what the screen shows and opens the add-seats page in the person's browser.
 *
 * Only a system_admin or org_admin adds people and seats (Michael, 2026-11-09).
 * They get Chef's detail with an "Add seats" button. The button asks Chef for
 * a signed-in portal link (POST /api/v1/billing/seats-session; Chef checks the
 * role and asks the control plane) and opens it in the browser. When Chef
 * cannot make one, it opens Chef's billing_url with a note that the portal may
 * ask them to sign in; a 403 says only an administrator can add seats.
 * Everyone else, including
 * a person on activate.html or accept-invite.html who is not signed in yet,
 * gets Chef's detail and "Ask your firm's administrator to add seats", with
 * no button.
 *
 * No DOM, no network: the modal, the role check and the open-external bridge
 * are passed in. A browser global (window.SeatLimit) and a CommonJS module
 * for Jest.
 */
(function (global) {
  'use strict';

  var CODE = 'SEAT_LIMIT_REACHED';
  var HEADING = 'No seats left';
  var ADD_SEATS = 'Add seats';
  var ASK_ADMIN = 'Ask your firm\'s administrator to add seats.';
  var NOT_ADMIN = 'Only an administrator can add people';
  var NOT_ADMIN_DETAIL = 'Ask your firm\'s administrator to add them.';
  var NOT_ADMIN_SEATS = 'Only an administrator can add seats';
  var PORTAL_NOTE = 'The billing page opened in your browser. You may need to sign in to the LANA portal first.';
  var OPEN_FAILED = 'LANA could not open the billing page. Try again in a moment.';

  /**
   * Whether the signed-in person may add people and seats: system_admin or
   * org_admin, read through Lex.Auth.canAccessAdminPages (exactly those two
   * roles, the ones Chef lets create users).
   */
  function canAddPeople(auth) {
    return Boolean(auth && typeof auth.canAccessAdminPages === 'function' && auth.canAccessAdminPages());
  }

  /** The problem body of a failed call: ApiError.data, or { status, data } from a page's own fetch. */
  function bodyOf(error) {
    var body = error && (error.data || error.body) ? (error.data || error.body) : null;
    return body && typeof body === 'object' ? body : null;
  }

  /** The add-seats address, only when it is an absolute http or https URL; otherwise ''. */
  function safeBillingUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    var parsed;
    try { parsed = new URL(value.trim()); } catch (_e) { return ''; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.href;
  }

  function fallbackDetail(seats) {
    if (seats === 1) return 'Your firm is using its 1 paid seat.';
    if (typeof seats === 'number' && seats > 1) return 'Your firm is using all ' + seats + ' of its paid seats.';
    return 'Your firm is using all of its paid seats.';
  }

  /**
   * The refusal, or null when the error is anything else.
   * opts.canAddSeats: the person is a system_admin or org_admin. Everyone
   * else is also told to ask their administrator and gets no button.
   *
   * @returns {null|{ heading: string, detail: string, message: string,
   *   seats: number|null, canAddSeats: boolean, billingUrl: string }}
   *   canAddSeats decides the button. billingUrl (the fallback address) is ''
   *   for someone who cannot add seats, and when Chef sent no address or one
   *   that is not http(s).
   */
  function refusal(error, opts) {
    var body = bodyOf(error);
    var nested = body && body.error && typeof body.error === 'object' ? body.error : null;
    var code = (body && body.code) || (nested && nested.code) || '';
    if (code !== CODE) return null;
    var canAddSeats = Boolean(opts && opts.canAddSeats);
    var seats = body && Number.isInteger(body.seats) ? body.seats : null;
    var detail = String((body && typeof body.detail === 'string' && body.detail) || (nested && typeof nested.message === 'string' && nested.message) || '').trim();
    if (!detail) detail = fallbackDetail(seats);
    return {
      heading: HEADING,
      detail: detail,
      message: canAddSeats ? detail : detail + ' ' + ASK_ADMIN,
      seats: seats,
      canAddSeats: canAddSeats,
      billingUrl: canAddSeats ? safeBillingUrl(body && body.billing_url) : ''
    };
  }

  /**
   * Open the add-seats page in the person's browser through the preload
   * bridge (electronAPI.openExternal). Never inside the app window: without
   * the bridge, or for an address that is not http(s), nothing opens.
   * @returns {boolean} whether it was handed to the browser
   */
  function openAddSeats(url, bridge) {
    var target = safeBillingUrl(url);
    if (!target || !bridge || typeof bridge.openExternal !== 'function') return false;
    var opened = bridge.openExternal(target);
    if (opened && typeof opened.catch === 'function') opened.catch(function () { /* the browser did not open */ });
    return true;
  }

  /**
   * "Add seats": open the portal link Chef vouches for, or fall back.
   * deps: { startSeatsSession: () => Promise<{ url, expires_at }> (api.createSeatsSession),
   *         bridge, modal, toast }
   * Resolves to what happened:
   *   'session'    Chef's link opened
   *   'fallback'   Chef could not make one (5xx, network, an unusable link);
   *                billingUrl opened with a note about signing in
   *   'refused'    403: "Only an administrator can add seats"
   *   'signed-out' 401: api.js already shows the session-expired dialog
   *   'failed'     nothing could be opened (no bridge, no usable address)
   */
  function addSeats(billingUrl, deps) {
    function fallback() {
      if (openAddSeats(billingUrl, deps.bridge)) {
        deps.toast.info(PORTAL_NOTE);
        return 'fallback';
      }
      deps.toast.error(OPEN_FAILED);
      return 'failed';
    }
    return Promise.resolve().then(function () { return deps.startSeatsSession(); }).then(function (session) {
      if (session && openAddSeats(session.url, deps.bridge)) return 'session';
      return fallback();
    }, function (error) {
      var status = Number(error && error.status) || 0;
      if (status === 403) {
        return Promise.resolve(deps.modal.alertAsync(NOT_ADMIN_SEATS, ASK_ADMIN, { confirmText: 'Close' })).then(function () { return 'refused'; });
      }
      if (status === 401) return 'signed-out';
      return fallback();
    });
  }

  /**
   * Admin screens: when the error is the seat refusal, show it in a Lex modal
   * and resolve true (after "Add seats", once that has run); otherwise
   * resolve false and change nothing. "Add seats" only for someone who can
   * add seats; everyone else gets Close and the line to ask their administrator.
   * deps: { modal: Lex.Modal, toast: Lex.Toast, bridge: window.electronAPI,
   *         canAddSeats: boolean, startSeatsSession: api.createSeatsSession }
   */
  function presentToAdmin(error, deps) {
    var found = refusal(error, { canAddSeats: deps && deps.canAddSeats });
    if (!found) return Promise.resolve(false);
    var modal = deps.modal;
    if (!found.canAddSeats) {
      return Promise.resolve(modal.alertAsync(found.heading, found.message, { confirmText: 'Close' })).then(function () { return true; });
    }
    return Promise.resolve(modal.confirmAsync(found.heading, found.message, { confirmText: ADD_SEATS, cancelText: 'Close' })).then(function (chosen) {
      if (!chosen) return true;
      return addSeats(found.billingUrl, deps).then(function () { return true; });
    });
  }

  /** The plain message for someone who is not an administrator and reached an add-people control anyway. */
  function showNotAdmin(modal) {
    return Promise.resolve(modal.alertAsync(NOT_ADMIN, NOT_ADMIN_DETAIL, { confirmText: 'Close' }));
  }

  var api = {
    CODE: CODE,
    ADD_SEATS: ADD_SEATS,
    ASK_ADMIN: ASK_ADMIN,
    NOT_ADMIN: NOT_ADMIN,
    NOT_ADMIN_SEATS: NOT_ADMIN_SEATS,
    PORTAL_NOTE: PORTAL_NOTE,
    OPEN_FAILED: OPEN_FAILED,
    canAddPeople: canAddPeople,
    safeBillingUrl: safeBillingUrl,
    refusal: refusal,
    openAddSeats: openAddSeats,
    addSeats: addSeats,
    presentToAdmin: presentToAdmin,
    showNotAdmin: showNotAdmin
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SeatLimit = api;
  }
})(typeof window !== 'undefined' ? window : this);
