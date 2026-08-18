/*
 * RequestRetry - rate-limit and transient-failure policy for API calls.
 *
 * Opening a workspace fans out ten parallel requests (matter, permissions,
 * activity, conversations, files, orphans, tasks, comments, pinned chats,
 * workspace state) while the sidebar polls its own task list. That burst trips
 * the server's per-tier limiter, which answers:
 *
 *   429 {"error":{"message":"Too many requests. Please try again in 10 seconds.",
 *                 "code":"RATE_LIMIT_EXCEEDED"}}
 *
 * Nothing in the client handled 429, so the burst simply failed and the caller
 * treated a temporary throttle as a permanent error.
 *
 * The server sends no RateLimit-* headers on success and does not always send
 * Retry-After, so the delay hint has to be read from whichever source is present:
 * the Retry-After header first, then the seconds in the message, then a default.
 * Retries are jittered because the ten calls are throttled at the same instant;
 * without jitter they would all wake together and trip the limiter again.
 */
(function (global) {
  'use strict';

  var DEFAULT_DELAY_MS = 1000;
  var MAX_DELAY_MS = 15000;
  var MAX_ATTEMPTS = 2;
  var JITTER_RATIO = 0.25;

  // Statuses worth retrying or, at minimum, worth not treating as fatal.
  // 0 is the client's own "network error" sentinel, 408 its timeout sentinel.
  var TRANSIENT_STATUSES = [0, 408, 429, 500, 502, 503, 504];

  function statusOf(err) {
    if (!err) return null;
    return typeof err.status === 'number' ? err.status : null;
  }

  function codeOf(err) {
    if (!err) return '';
    if (err.code) return String(err.code).toUpperCase();
    var data = err.data;
    var code = data && (data.code || (data.error && data.error.code));
    return code ? String(code).toUpperCase() : '';
  }

  function messageOf(err) {
    if (!err) return '';
    var data = err.data;
    var fromData = data && ((data.error && data.error.message) || data.message || data.detail);
    return String(fromData || err.message || '');
  }

  /**
   * @returns {boolean} true when the server throttled this request.
   */
  function isRateLimited(err) {
    if (statusOf(err) === 429) return true;
    if (codeOf(err) === 'RATE_LIMIT_EXCEEDED') return true;
    return /too many requests/i.test(messageOf(err));
  }

  /**
   * Transient failures are worth retrying and must never be shown to the user as
   * a permanent "this does not exist" outcome. A 403/404 is emphatically NOT
   * transient — those mean the caller should stop and route elsewhere.
   * @returns {boolean}
   */
  function isTransient(err) {
    if (!err) return false;
    if (isRateLimited(err)) return true;
    var status = statusOf(err);
    if (status === null) return false;
    return TRANSIENT_STATUSES.indexOf(status) !== -1;
  }

  /**
   * Read the server's own retry hint.
   *
   * @param {{get: function}|null} headers fetch Headers (or null)
   * @param {object|null} body parsed JSON body
   * @returns {number} milliseconds to wait, clamped to a sane ceiling
   */
  function parseRetryDelayMs(headers, body) {
    // 1. Retry-After, the standard channel. Seconds or an HTTP date.
    var retryAfter = null;
    if (headers && typeof headers.get === 'function') {
      try { retryAfter = headers.get('Retry-After'); } catch (e) { retryAfter = null; }
    }
    if (retryAfter) {
      var seconds = Number(retryAfter);
      if (isFinite(seconds) && seconds >= 0) return clamp(seconds * 1000);
      var when = Date.parse(retryAfter);
      // Date.parse gives an absolute instant; convert to a delay without using
      // Date.now() indirectly through a helper the tests cannot control.
      if (!isNaN(when)) {
        var delta = when - new Date().getTime();
        return clamp(delta > 0 ? delta : DEFAULT_DELAY_MS);
      }
    }

    // 2. The message carries the hint on this API: "try again in 10 seconds".
    var message = '';
    if (body) {
      message = String((body.error && body.error.message) || body.message || body.detail || '');
    }
    var match = message.match(/in\s+(\d+(?:\.\d+)?)\s*(seconds?|s\b|ms|milliseconds?)/i);
    if (match) {
      var value = parseFloat(match[1]);
      var unit = match[2].toLowerCase();
      var ms = (unit.indexOf('m') === 0) ? value : value * 1000;
      if (isFinite(ms) && ms >= 0) return clamp(ms);
    }

    return DEFAULT_DELAY_MS;
  }

  function clamp(ms) {
    if (!isFinite(ms) || ms < 0) return DEFAULT_DELAY_MS;
    return Math.min(ms, MAX_DELAY_MS);
  }

  /**
   * Spread simultaneous retries so a throttled burst does not wake in lockstep.
   * @param {number} delayMs
   * @param {number} [randomValue] injectable for tests; defaults to Math.random()
   * @returns {number}
   */
  function jitter(delayMs, randomValue) {
    var r = (typeof randomValue === 'number') ? randomValue : Math.random();
    // Map [0,1) onto [-JITTER_RATIO, +JITTER_RATIO).
    var factor = 1 + ((r * 2) - 1) * JITTER_RATIO;
    return Math.max(0, Math.round(delayMs * factor));
  }

  /**
   * @param {number} attempt 1-based count of retries already performed
   * @returns {boolean}
   */
  function shouldRetry(err, attempt) {
    if (attempt >= MAX_ATTEMPTS) return false;
    return isRateLimited(err);
  }

  /**
   * The server refused on authorization grounds, not availability.
   *
   * Matter-scoped routes answer in two shapes, both 403:
   *   {"error":{"message":"You do not have access to this matter",
   *             "code":"AUTHORIZATION_ERROR"}}
   *   {"success":false,"message":"Access denied to matter"}
   *
   * Retrying is pointless and bouncing the user elsewhere hides the reason, so
   * callers should say plainly that access is missing.
   * @returns {boolean}
   */
  function isAccessDenied(err) {
    if (!err) return false;
    if (statusOf(err) === 403) return true;
    if (codeOf(err) === 'AUTHORIZATION_ERROR') return true;
    return /do not have access|access denied|permission required/i.test(messageOf(err));
  }

  var api = {
    isRateLimited: isRateLimited,
    isAccessDenied: isAccessDenied,
    isTransient: isTransient,
    parseRetryDelayMs: parseRetryDelayMs,
    jitter: jitter,
    shouldRetry: shouldRetry,
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    MAX_DELAY_MS: MAX_DELAY_MS,
    DEFAULT_DELAY_MS: DEFAULT_DELAY_MS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.RequestRetry = api;
  }
})(typeof window !== 'undefined' ? window : this);
