/**
 * First run: a person with no time zone of their own gets the computer's
 * zone, once, with no prompt. They can change it any time in Settings >
 * General (settings-v2.js). The zone is saved on the server
 * (PATCH /api/v1/users/me/preferences { regional: { timezone } }, stored as
 * users.time_zone), so it follows them to another computer; a zone the
 * server refuses is left unset and is not retried this session.
 *
 * Pure apart from the api call it is handed, so it is unit tested.
 */
(function (global) {
  'use strict';

  var attempted = {};

  /** The computer's IANA zone, or '' when it cannot be read. */
  function deviceTimeZone(intl) {
    try {
      var I = intl || global.Intl;
      var zone = new I.DateTimeFormat().resolvedOptions().timeZone;
      return typeof zone === 'string' ? zone : '';
    } catch (_error) {
      return '';
    }
  }

  /** Should the computer's zone be saved for this person now? */
  function shouldSet(user, zone) {
    if (!user || !user.id || !zone) return false;
    if (user.timezone) return false;
    return !attempted[user.id];
  }

  /**
   * Save the computer's zone for a person who has none.
   *
   * @param {{ user: Object, api: { updatePreferences: Function }, zone?: string,
   *   onSaved?: Function }} input - user is the profile-backed stored user
   *   (its `timezone` is the person's own zone, null when unset); onSaved
   *   gets the zone after the server took it
   * @returns {Promise<string|null>} the zone saved, or null when nothing was saved
   */
  function ensure(input) {
    var opts = input || {};
    var user = opts.user;
    var zone = opts.zone === undefined ? deviceTimeZone() : opts.zone;
    if (!shouldSet(user, zone) || !opts.api || typeof opts.api.updatePreferences !== 'function') {
      return Promise.resolve(null);
    }
    attempted[user.id] = true;
    return Promise.resolve()
      .then(function () { return opts.api.updatePreferences({ regional: { timezone: zone } }); })
      .then(function () {
        if (typeof opts.onSaved === 'function') opts.onSaved(zone);
        return zone;
      })
      .catch(function (error) {
        if (global.console) global.console.warn('[DeviceTimeZone] Could not save the computer time zone:', error && error.message);
        return null;
      });
  }

  /** Tests only: forget which people were tried this session. */
  function resetForTests() { attempted = {}; }

  var api = { deviceTimeZone: deviceTimeZone, shouldSet: shouldSet, ensure: ensure, resetForTests: resetForTests };
  global.LanaDeviceTimeZone = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
