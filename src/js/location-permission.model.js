/**
 * Settings > General > Location: this computer's approximate location. Pure, no DOM.
 *
 * LANA will use it to work out the office's city and state (on the backend, later). Only an
 * approximate reading ever leaves the preload: latitude and longitude are rounded to one
 * decimal place (about 11 km) right where the position is read, and the exact numbers are
 * never logged, stored or returned.
 *
 *   roundCoordinate(value)         one decimal place, or null when it is not a number
 *   statusFromError(error)         a GeolocationPositionError as 'denied' or 'unavailable'
 *   buildReading({ allowed, supported, coords, error })
 *       { status: 'granted'|'denied'|'unavailable'|'prompt', approx: { lat, lon } | null, accuracyKm }
 *   permissionView(status)         the badge, the button and the note for the Settings row
 *
 * Copy rules: words a 6th grader can follow, "computer" and never a brand of device.
 *
 * window.LanaLocationPermission (browser) / module.exports (preload and tests).
 */
(function (root) {
  'use strict';

  var node = typeof module !== 'undefined' && module.exports;

  /** One decimal place of latitude is about 11 km, so a reading is never closer than this. */
  var ROUNDING_KM = 11;

  // GeolocationPositionError codes.
  var PERMISSION_DENIED = 1;

  function roundCoordinate(value) {
    if (typeof value !== 'number' || !isFinite(value)) {return null;}
    var rounded = Math.round(value * 10) / 10;
    return rounded === 0 ? 0 : rounded; // no -0
  }

  function statusFromError(error) {
    return error && error.code === PERMISSION_DENIED ? 'denied' : 'unavailable';
  }

  /** How far off the reading may be: the rounding, or the computer's own guess when worse. */
  function accuracyKm(coords) {
    var meters = coords && coords.accuracy;
    var own = typeof meters === 'number' && isFinite(meters) && meters > 0 ? Math.ceil(meters / 1000) : 0;
    return Math.max(ROUNDING_KM, own);
  }

  /**
   * The reading the preload hands to the page. coords is GeolocationPosition.coords; only the
   * rounded values are copied out of it.
   * @param {Object} input
   * @param {boolean} input.allowed - the person turned Location on in Settings
   * @param {boolean} [input.supported] - false when this computer has no location service
   * @param {Object} [input.coords]
   * @param {Object} [input.error]
   */
  function buildReading(input) {
    var options = input || {};
    if (!options.allowed) {return { status: 'prompt', approx: null, accuracyKm: null };}
    if (options.supported === false) {return { status: 'unavailable', approx: null, accuracyKm: null };}
    if (options.error || !options.coords) {
      return { status: options.error ? statusFromError(options.error) : 'unavailable', approx: null, accuracyKm: null };
    }
    var lat = roundCoordinate(options.coords.latitude);
    var lon = roundCoordinate(options.coords.longitude);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { status: 'unavailable', approx: null, accuracyKm: null };
    }
    return { status: 'granted', approx: { lat: lat, lon: lon }, accuracyKm: accuracyKm(options.coords) };
  }

  var VIEWS = {
    checking: { label: 'Checking', color: 'gray', action: null, actionLabel: '', note: '' },
    prompt: { label: 'Off', color: 'gray', action: 'allow', actionLabel: 'Allow', note: '' },
    granted: { label: 'Allowed', color: 'green', action: 'turn_off', actionLabel: 'Turn off', note: 'LANA rounds your location to about 11 km (7 miles) before it uses it.' },
    denied: { label: 'Denied', color: 'red', action: 'retry', actionLabel: 'Try again', note: 'Your computer is not letting LANA see its location. Turn on location for LANA in your computer\'s privacy settings, then try again.' },
    unavailable: { label: 'Unavailable', color: 'gray', action: 'retry', actionLabel: 'Try again', note: 'LANA could not find this computer\'s location right now.' }
  };

  /** @param {string|null} status - a reading's status, or null while it is being read */
  function permissionView(status) {
    var view = VIEWS[status || 'checking'] || VIEWS.unavailable;
    return {
      label: view.label,
      color: view.color,
      action: view.action,
      actionLabel: view.actionLabel,
      note: view.note,
      canTurnOff: status === 'granted' || status === 'denied' || status === 'unavailable'
    };
  }

  var api = {
    ROUNDING_KM: ROUNDING_KM,
    roundCoordinate: roundCoordinate,
    statusFromError: statusFromError,
    buildReading: buildReading,
    permissionView: permissionView
  };
  if (node) {module.exports = api;}
  else {root.LanaLocationPermission = api;}
})(typeof window !== 'undefined' ? window : this);
