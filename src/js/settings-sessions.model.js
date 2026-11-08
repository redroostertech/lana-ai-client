/**
 * Settings > Profile > Active sessions: view helpers for the signed-in session
 * list (GET /api/v1/auth/session). The server names each session (client, os,
 * device, is_current); this only arranges and words it. Pure, no DOM.
 *
 * window.LanaSettingsSessions (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  var MINUTE = 60 * 1000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;

  function known(value) {
    return value && value !== 'Unknown' ? String(value) : '';
  }

  /** "LANA app on macOS", "Safari on iOS", "Command line"; a session the server could not name is a "Signed-in device". */
  function title(session) {
    var client = known(session && session.client);
    var os = known(session && session.os);
    if (client && os) return client + ' on ' + os;
    return client || os || 'Signed-in device';
  }

  /** Lex icon for the session's kind of device. */
  function icon(session) {
    var client = session && session.client;
    if (client === 'Command line') return 'terminal';
    var device = session && session.device;
    if (device === 'Mobile' || device === 'Tablet') return 'smartphone';
    return 'laptop';
  }

  function toDate(value) {
    if (!value) return null;
    var date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  /** "Nov 8, 2026" in the given zone (undefined: this computer's zone). */
  function day(value, timeZone) {
    var date = toDate(value);
    if (!date) return '';
    var opts = { month: 'short', day: 'numeric', year: 'numeric' };
    if (timeZone) opts.timeZone = timeZone;
    try {
      return new Intl.DateTimeFormat('en-US', opts).format(date);
    } catch (_) {
      delete opts.timeZone;
      return new Intl.DateTimeFormat('en-US', opts).format(date);
    }
  }

  /** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then the date. */
  function ago(value, now, timeZone) {
    var date = toDate(value);
    if (!date) return '';
    var diff = Math.max(0, (now || new Date()).getTime() - date.getTime());
    if (diff < MINUTE) return 'just now';
    if (diff < HOUR) {
      var minutes = Math.floor(diff / MINUTE);
      return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    }
    if (diff < DAY) {
      var hours = Math.floor(diff / HOUR);
      return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    }
    if (diff < 7 * DAY) {
      var days = Math.floor(diff / DAY);
      return days + (days === 1 ? ' day ago' : ' days ago');
    }
    return day(date, timeZone);
  }

  /** "Last seen 5 minutes ago · Signed in Nov 8, 2026 · 10.0.0.12" */
  function details(session, now, timeZone) {
    var parts = [];
    var seen = ago(session && (session.last_accessed || session.updated_at), now, timeZone);
    if (seen) parts.push('Last seen ' + seen);
    var signedIn = day(session && session.created_at, timeZone);
    if (signedIn) parts.push('Signed in ' + signedIn);
    var ip = session && session.ip_address ? String(session.ip_address).replace(/\/(32|128)$/, '') : '';
    if (ip) parts.push(ip);
    return parts.join(' · ');
  }

  /** This device first, then the most recently seen. */
  function sorted(sessions) {
    return (Array.isArray(sessions) ? sessions.slice() : []).sort(function (a, b) {
      if (Boolean(a.is_current) !== Boolean(b.is_current)) return a.is_current ? -1 : 1;
      var at = toDate(a.last_accessed || a.created_at);
      var bt = toDate(b.last_accessed || b.created_at);
      return (bt ? bt.getTime() : 0) - (at ? at.getTime() : 0);
    });
  }

  /** "1 device is signed in to your account." */
  function summary(count) {
    if (!count) return 'No devices are signed in to your account.';
    return count === 1 ? '1 device is signed in to your account.' : count + ' devices are signed in to your account.';
  }

  var api = { title: title, icon: icon, ago: ago, day: day, details: details, sorted: sorted, summary: summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LanaSettingsSessions = api;
})(typeof window !== 'undefined' ? window : this);
