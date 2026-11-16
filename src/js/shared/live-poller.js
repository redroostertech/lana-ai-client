/**
 * live-poller.js
 * One light refresh loop for run lists that have no stream of their own
 * (the automations Runs table, the agents run lists and the Agents home).
 * Shared so both apps refresh the same way:
 *   - one refresh at a time (a slow answer never stacks requests);
 *   - pauses while the window is hidden, refreshes at once when it returns;
 *   - a faster interval while something is live, a slower one while idle;
 *   - stops itself once its view is gone (isActive answers false).
 *
 * Classic script (window.LanaLivePoller) so Jest can require it.
 */
(function (global) {
  'use strict';

  function createLivePoller(options) {
    var refresh = options.refresh;
    var intervalMs = options.intervalMs || 5000;
    var idleIntervalMs = options.idleIntervalMs || intervalMs;
    var isActive = options.isActive || function () { return true; };
    var isLive = options.isLive || function () { return true; };
    var doc = options.doc || (typeof document !== 'undefined' ? document : null);
    var timer = null;
    var inFlight = false;
    var api = { running: false };

    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    function schedule() {
      clear();
      if (!api.running) return;
      timer = setTimeout(tick, isLive() ? intervalMs : idleIntervalMs);
    }

    function tick() {
      timer = null;
      if (!api.running) return;
      if (!isActive()) { stop(); return; }
      if (doc && doc.hidden) { schedule(); return; }
      if (inFlight) { schedule(); return; }
      inFlight = true;
      var done = function () { inFlight = false; schedule(); };
      try {
        Promise.resolve(refresh()).then(done, done);
      } catch (_error) {
        done();
      }
    }

    function onVisibility() {
      if (api.running && doc && !doc.hidden && !inFlight) { clear(); tick(); }
    }

    function start() {
      if (api.running) return api;
      api.running = true;
      if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisibility);
      schedule();
      return api;
    }

    function stop() {
      api.running = false;
      clear();
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
    }

    /** Refresh now (for example after a stream event), then keep the rhythm. */
    function poke() {
      if (api.running && !inFlight) { clear(); tick(); }
    }

    api.start = start;
    api.stop = stop;
    api.poke = poke;
    return api;
  }

  /**
   * One poller per slot on a holder (a view's state): kept while it runs for
   * the same subject (a run id, a tab), replaced when the subject changes or
   * when it stopped itself because its view went away and came back.
   */
  function ensurePoller(holder, slot, key, create) {
    var current = holder[slot];
    if (current && current.running && holder[slot + 'Key'] === key) return current;
    if (current && typeof current.stop === 'function') current.stop();
    holder[slot] = create();
    holder[slot + 'Key'] = key;
    return holder[slot];
  }

  /**
   * The run (or other subject) the person asked for, recorded at the moment
   * they ask: open records it, close clears it. An answer is applied only
   * when its subject is still the requested one, so a background refresh
   * for run A that started after a click on run B, or an answer that lands
   * after the drawer closed, resolves to requestedSubject.STALE and is
   * dropped. A refresh checks isRequested before it starts. Failures of the
   * requested subject still reject.
   */
  var STALE = { stale: true };
  function requestedSubject() {
    var requested = null;
    return {
      STALE: STALE,
      request: function (id) { requested = id; },
      clear: function () { requested = null; },
      current: function () { return requested; },
      isRequested: function (id) { return requested !== null && requested === id; },
      guard: function (id, promise) {
        return Promise.resolve(promise).then(function (value) {
          return requested === id ? value : STALE;
        }, function (error) {
          if (requested !== id) return STALE;
          throw error;
        });
      }
    };
  }
  requestedSubject.STALE = STALE;

  var moduleApi = { createLivePoller: createLivePoller, ensurePoller: ensurePoller, requestedSubject: requestedSubject };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaLivePoller = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
