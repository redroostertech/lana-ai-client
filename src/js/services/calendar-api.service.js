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
  var EVENTS = '/api/v1/calendar-events';

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
      },
      // LANA events (calendar stage 2). A create or edit that asks
      // check_conflicts rejects with status 409, code CALENDAR_CONFLICT and
      // data.conflicts when the time overlaps busy time; repeat with
      // override: true to book it anyway.
      getEvent: function (id) {
        return Promise.resolve(api().get(EVENTS + '/' + encodeURIComponent(id))).then(unwrap);
      },
      createEvent: function (body) {
        return Promise.resolve(api().post(EVENTS, body)).then(unwrap);
      },
      updateEvent: function (id, body) {
        return Promise.resolve(api().patch(EVENTS + '/' + encodeURIComponent(id), body)).then(unwrap);
      },
      deleteEvent: function (id) {
        return Promise.resolve(api().delete(EVENTS + '/' + encodeURIComponent(id))).then(unwrap);
      },
      invite: function (id, invitees) {
        return Promise.resolve(api().post(EVENTS + '/' + encodeURIComponent(id) + '/attendees', { invitees: invitees })).then(unwrap);
      },
      removeAttendee: function (id, attendeeId) {
        return Promise.resolve(api().delete(EVENTS + '/' + encodeURIComponent(id) + '/attendees/' + encodeURIComponent(attendeeId))).then(unwrap);
      },
      addLink: function (id, link) {
        return Promise.resolve(api().post(EVENTS + '/' + encodeURIComponent(id) + '/links', link)).then(unwrap);
      },
      removeLink: function (id, link) {
        return Promise.resolve(api().delete(EVENTS + '/' + encodeURIComponent(id) + '/links', link)).then(unwrap);
      }
    };
  }

  var exported = { BASE: BASE, EVENTS: EVENTS, create: create, unwrap: unwrap };
  global.LanaCalendarApi = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
