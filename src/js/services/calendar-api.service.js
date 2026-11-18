/**
 * Calendar API calls (/api/v1/calendars): the agenda, the people a viewer may
 * pick, and the firm's coworker free/busy switch. Every call goes through the
 * shared api client (window.api) and returns the unwrapped `data`. The
 * backend decides what each viewer sees; this only asks.
 *
 *   var calendar = LanaCalendarApi.create(window.api);
 *   calendar.agenda({ from, to, userIds: [...] });
 */
(function (global) {
  'use strict';

  var BASE = '/api/v1/calendars';

  function unwrap(response) {
    return response && response.data !== undefined && response.data !== null ? response.data : response;
  }

  function create(client) {
    function api() {
      var c = client || global.api;
      if (!c || typeof c.get !== 'function') throw new Error('The API client is unavailable.');
      return c;
    }

    return {
      /** GET /agenda: from and to are ISO instants; userIds are coworkers (the viewer is always included). */
      agenda: function (input) {
        var opts = input || {};
        var params = 'from=' + encodeURIComponent(opts.from) + '&to=' + encodeURIComponent(opts.to);
        var ids = (opts.userIds || []).filter(Boolean);
        if (ids.length) params += '&user_ids=' + encodeURIComponent(ids.join(','));
        return Promise.resolve(api().get(BASE + '/agenda?' + params)).then(unwrap);
      },
      people: function () {
        return Promise.resolve(api().get(BASE + '/people')).then(unwrap);
      },
      policy: function () {
        return Promise.resolve(api().get(BASE + '/policy')).then(unwrap);
      },
      setFreeBusyVisible: function (visible) {
        return Promise.resolve(api().patch(BASE + '/policy', { freebusy_visible_to_members: visible === true })).then(unwrap);
      }
    };
  }

  var exported = { BASE: BASE, create: create, unwrap: unwrap };
  global.LanaCalendarApi = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
