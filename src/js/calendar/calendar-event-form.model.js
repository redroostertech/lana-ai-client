/**
 * Calendar event drawer model: the form values for a new or existing LANA
 * event, the request body they become, which invitations changed, and the
 * words for a conflict warning. Pure, so it is unit tested. The backend
 * decides who may change what and answers 409 CALENDAR_CONFLICT; nothing
 * here widens that.
 *
 * Times: the form holds a plain day and a wall time ("HH:MM") in the event's
 * own time zone; the request carries ISO instants plus that zone. An all-day
 * event runs from the first day's local midnight to the midnight after its
 * last day.
 */
(function (global) {
  'use strict';

  var DEFAULT_MINUTES = 60;
  var LINK_TYPES = ['matter', 'workspace', 'task'];

  function time() {
    var T = global.LanaTime;
    if (!T) throw new Error('LanaTime (js/time-utils.js) must load before calendar-event-form.model.js');
    return T;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** "HH:MM" for minutes after midnight (rounded down to the minute). */
  function hhmm(minutes) {
    var m = Math.max(0, Math.min(24 * 60 - 1, Math.floor(Number(minutes) || 0)));
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /** Minutes after midnight from "HH:MM", or NaN. */
  function minutesOf(text) {
    var match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
    if (!match) return NaN;
    var h = Number(match[1]);
    var m = Number(match[2]);
    return h < 24 && m < 60 ? h * 60 + m : NaN;
  }

  function wallOf(instant, zone) {
    return time().wallClockInTimeZone(instant, zone);
  }

  /**
   * Values for a new event starting at `minutes` on `day` (the clicked slot,
   * else the next half hour), one hour long, in the viewer's zone.
   */
  function draftForNew(input) {
    var opts = input || {};
    var zone = opts.timeZone || 'UTC';
    var T = time();
    var day = opts.day || T.dayInTimeZone(T.nowDate(), zone);
    var start = Number.isFinite(opts.minutes) ? opts.minutes : Math.min(23 * 60, Math.ceil(((wallOf(T.nowDate(), zone) || {}).minutes || 540) / 30) * 30);
    var end = Math.min(24 * 60 - 1, start + DEFAULT_MINUTES);
    return {
      id: null,
      title: '',
      is_all_day: opts.allDay === true,
      start_date: day,
      start_time: hhmm(start),
      end_date: day,
      end_time: hhmm(end),
      time_zone: zone,
      attendees: [],
      visibility: 'public',
      description: '',
      links: []
    };
  }

  /** Values for an existing event (GET /calendar-events/:id) in its own zone. */
  function draftFromEvent(detail, fallbackZone) {
    var event = detail || {};
    var zone = event.timezone || fallbackZone || 'UTC';
    var T = time();
    var start = wallOf(event.start_time, zone) || { day: '', minutes: 0 };
    var end = event.end_time ? wallOf(event.end_time, zone) : null;
    if (!end) end = wallOf(new Date(new Date(event.start_time).getTime() + DEFAULT_MINUTES * 60000), zone) || start;
    var endDate = end.day;
    if (event.is_all_day) {
      // Stored end is the exclusive midnight after the last day.
      endDate = end.minutes === 0 && end.day > start.day ? T.addPlainDays(end.day, -1) : end.day;
    }
    return {
      id: event.calendar_event_id || null,
      title: event.title || '',
      is_all_day: event.is_all_day === true,
      start_date: start.day,
      start_time: hhmm(start.minutes),
      end_date: endDate,
      end_time: hhmm(end.minutes),
      time_zone: zone,
      attendees: (event.attendees || []).filter(function (a) { return a.user_id; }).map(function (a) { return a.user_id; }),
      visibility: event.visibility === 'private' ? 'private' : 'public',
      description: event.description || '',
      links: (event.links || []).slice(),
      recurring: !!event.recurrence_rule,
      can_delete: event.can_delete === true
    };
  }

  /**
   * The create/update body for form values, or { errors } naming what is
   * wrong. Only the fields the drawer edits; invitations and links go
   * through their own calls.
   */
  function toPayload(values, options) {
    var v = values || {};
    var keepTimes = !!(options && options.keepTimes);
    if (keepTimes) {
      // A repeating event: only the details change; its times are left as
      // stored until repeating events can be edited (stage 2 part 6).
      var keptTitle = String(v.title || '').trim();
      if (!keptTitle) return { errors: [{ name: 'title', message: 'Give the event a title.' }] };
      return { body: { title: keptTitle, visibility: v.visibility === 'private' ? 'private' : 'public', description: String(v.description || '') } };
    }
    var T = time();
    var errors = [];
    var title = String(v.title || '').trim();
    if (!title) errors.push({ name: 'title', message: 'Give the event a title.' });
    var zone = v.time_zone || 'UTC';
    var startDay = v.start_date;
    var endDay = v.end_date || v.start_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDay || ''))) errors.push({ name: 'start_date', message: 'Choose a start date.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(endDay || ''))) errors.push({ name: 'end_date', message: 'Choose an end date.' });
    var start;
    var end;
    if (!errors.length) {
      if (v.is_all_day) {
        if (endDay < startDay) errors.push({ name: 'end_date', message: 'The last day cannot be before the first.' });
        start = T.startOfDayInTimeZone(startDay, zone);
        end = T.startOfDayInTimeZone(T.addPlainDays(endDay, 1), zone);
      } else {
        var startMinutes = minutesOf(v.start_time);
        var endMinutes = minutesOf(v.end_time);
        if (!Number.isFinite(startMinutes)) errors.push({ name: 'start_time', message: 'Choose a start time.' });
        if (!Number.isFinite(endMinutes)) errors.push({ name: 'end_time', message: 'Choose an end time.' });
        if (!errors.length) {
          start = T.instantFromWallClock(startDay, startMinutes, zone);
          end = T.instantFromWallClock(endDay, endMinutes, zone);
          if (!(end.getTime() > start.getTime())) errors.push({ name: 'end_time', message: 'The end must be after the start.' });
        }
      }
    }
    if (errors.length) return { errors: errors };
    return {
      body: {
        title: title,
        is_all_day: v.is_all_day === true,
        timezone: zone,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        visibility: v.visibility === 'private' ? 'private' : 'public',
        description: String(v.description || '')
      }
    };
  }

  /**
   * Invitations to add and remove: `wanted` user ids from the form against
   * the event's current attendee rows. The organizer's own calendar is never
   * an invitation.
   */
  function attendeeChanges(wanted, current, ownerId) {
    var want = (wanted || []).filter(function (id) { return id && id !== ownerId; });
    var rows = (current || []).filter(function (row) { return row.user_id; });
    var have = rows.map(function (row) { return row.user_id; });
    return {
      add: want.filter(function (id) { return have.indexOf(id) === -1; }).map(function (id) { return { user_id: id }; }),
      remove: rows.filter(function (row) { return want.indexOf(row.user_id) === -1; }).map(function (row) { return row.id; })
    };
  }

  /** Attendee picker options: active members other than the viewer. */
  function attendeeOptions(people, viewerId) {
    return ((people && people.members) || []).filter(function (m) { return m.user_id !== viewerId; })
      .map(function (m) { return { value: m.user_id, label: m.name || m.email || 'Member', description: m.email || undefined }; });
  }

  /** Link picker options from the matters list and the person's tasks, by link type. */
  function linkOptions(matters, tasks) {
    var rows = Array.isArray(matters) ? matters : [];
    var option = function (row) { return { value: String(row.id), label: row.name || row.matter_id || 'Untitled', description: row.matter_id || undefined }; };
    var isUuid = function (value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')); };
    return {
      matter: rows.filter(function (row) { return isUuid(row.id) && row.matter_type !== 'workspace'; }).map(option),
      workspace: rows.filter(function (row) { return isUuid(row.id) && row.matter_type === 'workspace'; }).map(option),
      task: (Array.isArray(tasks) ? tasks : []).filter(function (t) { return isUuid(t.id); })
        .map(function (t) { return { value: String(t.id), label: t.title || 'Untitled task' }; })
    };
  }

  var LINK_LABELS = { matter: 'Matter', workspace: 'Workspace', task: 'Task' };

  function linkText(link) {
    return (LINK_LABELS[link.target_type] || 'Link') + ': ' + (link.label || 'Untitled');
  }

  /**
   * The warning shown for a 409 CALENDAR_CONFLICT: one line per overlapping
   * block, in the viewer's zone. A block the viewer may not read says Busy.
   */
  function conflictLines(conflicts, viewerId, zone) {
    var fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone || 'UTC', weekday: 'short', hour: 'numeric', minute: '2-digit' });
    var timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: zone || 'UTC', hour: 'numeric', minute: '2-digit' });
    return (conflicts || []).map(function (c) {
      var who = c.user_id === viewerId ? 'You' : (c.name || 'A coworker');
      var what = c.private || !c.title ? 'busy' : c.title;
      var when = c.is_all_day ? 'all day' : fmt.format(new Date(c.start)) + ' to ' + timeFmt.format(new Date(c.end));
      return who + ': ' + what + ', ' + when;
    });
  }

  /** True when an API error is the conflict warning. */
  function isConflict(error) {
    return !!(error && error.status === 409 && (error.code === 'CALENDAR_CONFLICT' || (error.data && error.data.code === 'CALENDAR_CONFLICT')));
  }

  function conflictsOf(error) {
    return (error && error.data && Array.isArray(error.data.conflicts)) ? error.data.conflicts : [];
  }

  var api = {
    DEFAULT_MINUTES: DEFAULT_MINUTES,
    LINK_TYPES: LINK_TYPES,
    hhmm: hhmm,
    minutesOf: minutesOf,
    draftForNew: draftForNew,
    draftFromEvent: draftFromEvent,
    toPayload: toPayload,
    attendeeChanges: attendeeChanges,
    attendeeOptions: attendeeOptions,
    linkOptions: linkOptions,
    linkText: linkText,
    conflictLines: conflictLines,
    isConflict: isConflict,
    conflictsOf: conflictsOf
  };
  global.LanaCalendarEventForm = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
