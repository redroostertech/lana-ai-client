/**
 * Time zone choices for a searchable <lex-select>: every IANA zone this computer knows
 * (Intl.supportedValuesOf), grouped by region, each labeled "Eastern Time - New York".
 * A short list stands in when the computer cannot list its zones. Used by the person's own
 * time zone (settings-v2.js) and the firm time zone (pages/settings-firm-timezone.js).
 */
(function (global) {
  'use strict';

  var FALLBACK_ZONES = [
    'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'America/Phoenix', 'America/Toronto', 'America/Vancouver',
    'America/Mexico_City', 'America/Sao_Paulo', 'America/Buenos_Aires',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw',
    'Africa/Johannesburg', 'Africa/Cairo',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
  ];

  var REGION_ORDER = ['America', 'Europe', 'Africa', 'Asia', 'Australia', 'Pacific', 'Atlantic', 'Indian', 'Antarctica', 'Arctic', 'Etc', 'Other'];

  function now() {
    return global.LanaTime && typeof global.LanaTime.nowDate === 'function' ? global.LanaTime.nowDate() : new Date();
  }

  function cityLabel(value) {
    if (!value) return '';
    var parts = String(value).split('/');
    var city = parts[parts.length - 1] || value;
    return city.replace(/_/g, ' ');
  }

  function displayName(value) {
    if (!value) return '';
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: value,
        timeZoneName: 'longGeneric'
      }).formatToParts(now());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName' && parts[i].value) {
          return parts[i].value;
        }
      }
    } catch (e) {
      return cityLabel(value);
    }
    return cityLabel(value);
  }

  function optionLabel(value) {
    var display = displayName(value);
    var city = cityLabel(value);
    if (!display) return city || value;
    if (!city || display === city) return display;
    return display + ' - ' + city;
  }

  /** Every zone this computer knows, else the short list. */
  function zones() {
    var list = [];
    if (typeof Intl.supportedValuesOf === 'function') {
      try { list = Intl.supportedValuesOf('timeZone'); } catch (e) { list = []; }
    }
    return list.length ? list.slice() : FALLBACK_ZONES.slice();
  }

  /** [{ value, label, group }] by region; currentValue is kept even when the list lacks it. */
  function buildOptions(currentValue) {
    var list = zones();
    if (currentValue && list.indexOf(currentValue) === -1) list.push(currentValue);

    var groups = {};
    for (var i = 0; i < list.length; i++) {
      var zone = list[i];
      var slash = zone.indexOf('/');
      var region = slash === -1 ? 'Other' : zone.substring(0, slash);
      if (!groups[region]) groups[region] = [];
      groups[region].push(zone);
    }

    var seen = {};
    var ordered = [];
    for (var j = 0; j < REGION_ORDER.length; j++) {
      if (groups[REGION_ORDER[j]]) { ordered.push(REGION_ORDER[j]); seen[REGION_ORDER[j]] = true; }
    }
    var keys = Object.keys(groups).sort();
    for (var k = 0; k < keys.length; k++) {
      if (!seen[keys[k]]) ordered.push(keys[k]);
    }

    var options = [];
    for (var r = 0; r < ordered.length; r++) {
      var group = groups[ordered[r]].sort();
      for (var z = 0; z < group.length; z++) {
        options.push({ value: group[z], label: optionLabel(group[z]), group: ordered[r] });
      }
    }
    return options;
  }

  var api = { FALLBACK_ZONES: FALLBACK_ZONES, cityLabel: cityLabel, displayName: displayName, optionLabel: optionLabel, zones: zones, buildOptions: buildOptions };
  global.LanaTimeZoneOptions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
