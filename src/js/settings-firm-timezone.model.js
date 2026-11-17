/**
 * Settings > General > Firm time zone: the words, and the stored user after a save. Pure: the
 * page controller is src/js/pages/settings-firm-timezone.js. The zone itself is checked by the
 * server (400 on a zone it does not know); nothing here decides what a valid zone is.
 */
(function (global) {
  'use strict';

  function zoneName(zone) {
    var Z = global.LanaTimeZoneOptions;
    return Z ? Z.optionLabel(zone) : zone;
  }

  /** From the settings GET or PUT: { value, set, note }. */
  function view(settings) {
    var s = settings || {};
    var set = s.firm_timezone_set === true && !!s.firm_timezone;
    return {
      value: set ? s.firm_timezone : '',
      set: set,
      note: set
        ? 'Reports count days and months in ' + zoneName(s.firm_timezone) + '.'
        : 'Not set yet. Reports use UTC until you choose one.',
    };
  }

  /** The stored user with the firm zone the server now has (the profile's firm_timezone fields). */
  function withFirmTimezone(user, settings) {
    var next = Object.assign({}, user || {});
    var v = view(settings);
    next.firm_timezone = v.set ? v.value : 'UTC';
    next.firm_timezone_set = v.set;
    return next;
  }

  var api = { view: view, withFirmTimezone: withFirmTimezone };
  global.LanaSettingsFirmTimezone = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
