/**
 * Calendar page model: maps the agenda and people payloads
 * (GET /api/v1/calendars/agenda, /api/v1/calendars/people) to what the page
 * and lex-calendar-grid draw. Pure, so it is unit tested. The backend decides
 * who sees what (busy blocks carry no title); nothing here widens that.
 */
(function (global) {
  'use strict';

  var UNLINKED_LABEL = 'not linked to a LANA user';
  var BUSY_LABEL = 'Busy';
  var VIEWS = ['day', 'week'];
  var PERSON_COLORS = 6; // CSS defines --cal-person-0 .. --cal-person-5

  function personName(person) {
    return (person && (person.name || person.email)) || 'Unknown person';
  }

  /** The shown people with a stable color slot each (the viewer first, slot 0). */
  function peopleIndex(people, viewerId) {
    var list = (people || []).slice().sort(function (a, b) {
      if (a.user_id === viewerId) return -1;
      if (b.user_id === viewerId) return 1;
      return 0;
    });
    var index = {};
    list.forEach(function (person, i) { index[person.user_id] = i % PERSON_COLORS; });
    return index;
  }

  function badgeFor(source) {
    if (!source || source.kind !== 'connector') return { label: 'LANA', kind: 'lana' };
    return { label: source.label || source.connector_id || 'Connected app', kind: 'connector' };
  }

  function organizerText(organizer) {
    if (!organizer) return '';
    if (organizer.kind === 'source_person') {
      return personName(organizer) + ' (' + (organizer.label || UNLINKED_LABEL) + ')';
    }
    return personName(organizer);
  }

  /**
   * Where a read-only connector event opens: its source in the browser when
   * the agenda gives a safe http(s) link, else the connector's records in
   * the app for people who can open that page (admins), else nowhere.
   *
   * @param {Object} event - agenda event
   * @param {{ isAdmin?: boolean, safeHttpUrl?: Function }} [options]
   */
  function openTargetFor(event, options) {
    var opts = options || {};
    if (!event || event.busy_only) return null;
    var source = event.source || {};
    if (source.kind !== 'connector') return null;
    var url = source.open_url && typeof opts.safeHttpUrl === 'function' ? opts.safeHttpUrl(source.open_url) : '';
    if (url) return { type: 'external', url: url };
    if (opts.isAdmin && source.integration_source_id) {
      var params = 'sourceId=' + encodeURIComponent(source.integration_source_id)
        + (source.connector_id ? '&connectorId=' + encodeURIComponent(source.connector_id) : '')
        + '&tab=data';
      return { type: 'app', href: 'integrations/connector-viewer.html?' + params };
    }
    return null;
  }

  /**
   * One grid item per agenda event. `variant` is 'mine' (it occupies the
   * viewer), 'coworker' (only coworkers', with details) or 'busy' (a busy
   * block: no title, no source).
   */
  function toGridItems(agenda, viewerId) {
    var data = agenda || {};
    var colors = peopleIndex(data.people, viewerId);
    return (data.events || []).map(function (event, i) {
      var users = Array.isArray(event.user_ids) ? event.user_ids : [];
      var mine = users.indexOf(viewerId) !== -1;
      var firstOther = users.filter(function (id) { return id !== viewerId; })[0];
      var busy = event.busy_only === true;
      var badge = busy ? null : badgeFor(event.source);
      return {
        id: event.id || ('busy-' + i),
        start: event.start,
        end: event.end,
        is_all_day: event.is_all_day === true,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        title: busy ? BUSY_LABEL : (event.title || '(No title)'),
        variant: busy ? 'busy' : (mine ? 'mine' : 'coworker'),
        colorSlot: mine ? (colors[viewerId] || 0) : (colors[firstOther] !== undefined ? colors[firstOther] : 0),
        badge: badge,
        readOnly: busy || event.editable !== true,
        status: busy ? null : (event.status || null),
        organizer: busy ? '' : organizerText(event.organizer),
        matter: busy ? null : (event.matter || null),
        userIds: users,
        busy: busy,
        source: busy ? null : (event.source || null)
      };
    });
  }

  /**
   * Options for the coworker picker (lex-select multiple): members other
   * than the viewer, then people from connected apps who are not linked to a
   * LANA user, shown with that label and not selectable in this stage.
   */
  function coworkerOptions(people, viewerId) {
    var data = people || {};
    var members = (data.members || []).filter(function (m) { return m.user_id !== viewerId; })
      .map(function (m) { return { value: m.user_id, label: personName(m), description: m.email || undefined }; });
    var unlinked = (data.unlinked || []).map(function (p) {
      return { value: 'unlinked:' + p.id, label: personName(p), description: p.label || UNLINKED_LABEL, disabled: true, group: 'From connected apps' };
    });
    if (!unlinked.length) return members;
    return members.concat([{ divider: true }], unlinked);
  }

  /** Selected coworker ids from the picker value (unlinked entries are never sent). */
  function selectedUserIds(value) {
    var list = Array.isArray(value) ? value : (value ? String(value).split(',') : []);
    return list.map(function (v) { return String(v).trim(); })
      .filter(function (v) { return v && v.indexOf('unlinked:') !== 0; })
      .slice(0, 24);
  }

  function normalizeView(value) {
    return VIEWS.indexOf(value) !== -1 ? value : 'week';
  }

  /** The day to move to from `day` by `step` views (prev -1, next +1). */
  function shiftDay(day, view, step) {
    var T = global.LanaTime;
    return T.addPlainDays(day, (normalizeView(view) === 'week' ? 7 : 1) * step);
  }

  /** The heading for the shown range, e.g. "Nov 15 to 21, 2026". */
  function rangeTitle(days, timeZone) {
    if (!days || !days.length) return '';
    var T = global.LanaTime;
    function fmt(day, options) {
      // Noon of the plain day in the zone: the label never slips a day.
      var instant = new Date(T.startOfDayInTimeZone(day, timeZone).getTime() + 12 * T.MS_PER_HOUR);
      return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: timeZone }, options)).format(instant);
    }
    if (days.length === 1) return fmt(days[0], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    var first = days[0];
    var last = days[days.length - 1];
    var sameMonth = first.slice(0, 7) === last.slice(0, 7);
    var sameYear = first.slice(0, 4) === last.slice(0, 4);
    if (!sameYear) {
      var full = { month: 'short', day: 'numeric', year: 'numeric' };
      return fmt(first, full) + ' to ' + fmt(last, full);
    }
    return fmt(first, { month: 'short', day: 'numeric' }) + ' to '
      + (sameMonth ? fmt(last, { day: 'numeric' }) : fmt(last, { month: 'short', day: 'numeric' }))
      + ', ' + last.slice(0, 4);
  }

  /** The plain-text note under the grid about the zone in use. */
  function zoneNote(agenda) {
    var data = agenda || {};
    var zone = data.time_zone || 'UTC';
    if (data.time_zone_source === 'user') return 'Times are shown in your time zone, ' + zone + '.';
    if (data.time_zone_source === 'firm') return 'Times are shown in your firm time zone, ' + zone + '. You can set your own in Settings.';
    return 'Times are shown in ' + zone + '. You can set your time zone in Settings.';
  }

  var api = {
    UNLINKED_LABEL: UNLINKED_LABEL,
    BUSY_LABEL: BUSY_LABEL,
    peopleIndex: peopleIndex,
    toGridItems: toGridItems,
    openTargetFor: openTargetFor,
    coworkerOptions: coworkerOptions,
    selectedUserIds: selectedUserIds,
    normalizeView: normalizeView,
    shiftDay: shiftDay,
    rangeTitle: rangeTitle,
    zoneNote: zoneNote
  };
  global.LanaCalendarPageModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
