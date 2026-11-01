/**
 * pending-submit.js
 * Pending-submit recovery for server-recorded changes (design 7.2).
 *
 * A submit gets a request_id before it is sent. The request id and the exact
 * values are kept (sessionStorage when available, memory otherwise) until the
 * server confirms the change. If the app closes or the network drops before
 * the answer arrives, the same request is sent again and the server replays
 * its recorded result instead of recording twice.
 *
 * Public API (window.LanaPendingSubmit, or module.exports in Node):
 *   - scopedStore(storage, prefix, parts) -> { read, write, clear } | null
 *   - formScope(server, user, matterId, target) -> scope parts | null
 *   - createSubmitSession({ store, makeId, isConfirmed?, retryDelays?, wait? }) -> session (below)
 *   - classifyError(error) -> 'stale' | 'reused' | 'in_progress' | 'refused' | 'retryable'
 *   - RESULT_STATUSES, IN_PROGRESS_RETRY_DELAYS
 *
 * Session: pending(), busy(), persisted(), submit(body, send), resend(send),
 * discard(). `send(requestBody)` performs the HTTP call and resolves with the
 * server result `{ status: 'recorded' | 'replayed', record_ref, message }`.
 * `isConfirmed(result)` overrides that check for calls with another answer
 * shape (a task action start).
 *
 * Error answers (error.submitOutcome after a failed send):
 *   stale        409 FORM_STALE: the record changed; reload the form
 *   reused       409 REQUEST_ID_REUSED: the id was spent on other content
 *   in_progress  an answer marked `error.retryable: true` (409
 *                FORM_IN_PROGRESS): the same request is still being recorded.
 *                It is sent again after each of `retryDelays`; the change is
 *                kept if it is still in progress after the last one.
 *   refused      any other 400, 403, 404, 409, 422: the server refused it
 *   retryable    no answer (network, 5xx): the change is kept
 * stale, reused and refused drop the saved change; the others keep it.
 */

(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var RESULT_STATUSES = ['recorded', 'replayed'];
  var IN_PROGRESS_RETRY_DELAYS = [1000, 2000, 4000];
  var KEEPS_PENDING = ['in_progress', 'retryable'];

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  // One key per server, organization, user, matter and form target, so a
  // pending change is never replayed for another account or record.
  function scopedStore(storage, prefix, parts) {
    if (!storage || !prefix || !Array.isArray(parts) || parts.length === 0) return null;
    if (parts.some(function (part) { return part === null || part === undefined || part === ''; })) return null;
    var key = prefix + ':' + parts.map(function (part) { return encodeURIComponent(String(part)); }).join(':');
    return {
      key: key,
      read: function () { var text = storage.getItem(key); return text ? JSON.parse(text) : null; },
      write: function (value) { storage.setItem(key, JSON.stringify(value)); },
      clear: function () { storage.removeItem(key); }
    };
  }

  function formScope(server, user, matterId, target) {
    var organizationId = user && (user.organizationId || user.organization_id);
    if (!server || !user || !user.id || !organizationId || !matterId || !target) return null;
    return [server, organizationId, user.id, matterId, target];
  }

  // The server marks an answer that is worth sending again unchanged
  // (src/shared/errors/error-handler.js: `error.retryable`).
  function isRetryableAnswer(error) {
    var body = error && error.data;
    return Boolean(body && body.error && body.error.retryable === true);
  }

  function classifyError(error) {
    var status = error && error.status;
    if (!status) return 'retryable';
    if (isRetryableAnswer(error)) return 'in_progress';
    if (status === 409 && error.code === 'FORM_STALE') return 'stale';
    if (status === 409 && error.code === 'REQUEST_ID_REUSED') return 'reused';
    // The server answered and refused this exact request: nothing was recorded.
    if (status === 400 || status === 403 || status === 404 || status === 409 || status === 422) return 'refused';
    return 'retryable';
  }

  function isPendingShape(value) {
    return Boolean(value) && value.schema_version === SCHEMA_VERSION &&
      typeof value.request_id === 'string' && value.request_id !== '' &&
      Boolean(value.values) && typeof value.values === 'object';
  }

  function defaultId() { return global.crypto.randomUUID(); }

  function createSubmitSession(options) {
    var opts = options || {};
    var store = opts.store || null;
    var makeId = opts.makeId || defaultId;
    var isConfirmed = opts.isConfirmed || function (result) { return Boolean(result) && RESULT_STATUSES.indexOf(result.status) !== -1; };
    var retryDelays = Array.isArray(opts.retryDelays) ? opts.retryDelays : IN_PROGRESS_RETRY_DELAYS;
    var wait = opts.wait || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    var pending = null;
    var busy = false;
    var persisted = Boolean(store);

    try {
      var saved = store ? store.read() : null;
      if (isPendingShape(saved)) pending = clone(saved);
      else if (saved) safeClear();
    } catch (error) {
      // Unreadable saved state cannot be replayed exactly; drop it.
      safeClear();
    }

    function safeClear() {
      if (!store) return;
      try { store.clear(); } catch (error) { /* a stale key is still an exact replay */ }
    }

    function safeWrite(value) {
      if (!store) { persisted = false; return; }
      try { store.write(value); persisted = true; } catch (error) { persisted = false; }
    }

    function requestBody(entry) {
      var body = { request_id: entry.request_id, values: clone(entry.values) };
      if (entry.subject) body.subject = entry.subject;
      if (entry.binding) body.binding = clone(entry.binding);
      return body;
    }

    async function dispatch(send) {
      if (busy) throw new Error('A request is already in progress.');
      if (!pending) throw new Error('There is no saved change to send.');
      safeWrite(pending);
      busy = true;
      try {
        var result;
        for (var attempt = 0; ; attempt++) {
          try {
            result = await send(requestBody(pending));
            break;
          } catch (sendError) {
            if (classifyError(sendError) !== 'in_progress' || attempt >= retryDelays.length) throw sendError;
            await wait(retryDelays[attempt]);
          }
        }
        if (!isConfirmed(result)) {
          throw new Error('The server did not confirm this change. Your entries are kept; send them again to recover it.');
        }
        pending = null;
        safeClear();
        return { status: result.status, replayed: result.status === 'replayed', record_ref: result.record_ref || null, message: result.message || '', response: result };
      } catch (error) {
        var outcome = classifyError(error);
        if (KEEPS_PENDING.indexOf(outcome) === -1) { pending = null; safeClear(); }
        if (error && typeof error === 'object') error.submitOutcome = outcome;
        throw error;
      } finally {
        busy = false;
      }
    }

    return {
      pending: function () { return clone(pending); },
      busy: function () { return busy; },
      persisted: function () { return persisted; },
      submit: function (body, send) {
        if (busy) return Promise.reject(new Error('A request is already in progress.'));
        if (pending) return Promise.reject(new Error('Send or discard the saved change first.'));
        var input = body || {};
        pending = {
          schema_version: SCHEMA_VERSION,
          request_id: makeId(),
          subject: input.subject || null,
          binding: input.binding ? clone(input.binding) : null,
          values: clone(input.values || {}),
          saved_at: new Date().toISOString()
        };
        return dispatch(send);
      },
      resend: dispatch,
      discard: function () {
        if (busy) return;
        pending = null;
        safeClear();
      }
    };
  }

  var moduleApi = {
    RESULT_STATUSES: RESULT_STATUSES.slice(),
    IN_PROGRESS_RETRY_DELAYS: IN_PROGRESS_RETRY_DELAYS.slice(),
    scopedStore: scopedStore,
    formScope: formScope,
    createSubmitSession: createSubmitSession,
    classifyError: classifyError
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaPendingSubmit = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
