/* Calendar - page controller for calendar.html.
   Standalone page (not routed). Day, work week, week and month views of the viewer's agenda
   (LANA events and connected-app appointments), with chosen coworkers' busy
   time on top. The backend decides what each viewer may see: a coworker's
   event the viewer could not open arrives as a busy block with no title.

   Layout math lives in js/calendar/calendar-layout.js (drawn by
   lex-calendar-grid), payload mapping in js/calendar/calendar-page.model.js
   and the calls in js/services/calendar-api.service.js; this file only wires
   them to the Lex components on the page. Creating, editing, moving and
   deleting LANA events is in js/calendar/calendar-event-drawer.js.

   Pattern: IIFE + direct init() call.
*/

(function () {
  'use strict';

  var Model = window.LanaCalendarPageModel;
  var Form = window.LanaCalendarEventForm;
  var Layout = window.LanaCalendarLayout;
  var WorkHours = window.LanaCalendarWorkHours;
  var T = window.LanaTime;
  var Calendar = window.LanaCalendarApi.create(window.api);
  var editor = null;

  var state = {
    view: 'week',
    day: '',
    timeZone: '',
    coworkers: [],
    viewerId: '',
    canManage: false,
    loadSequence: 0,
    detailSequence: 0,
    agenda: null,
    workHours: null      // GET /firm-handbook/work-hours (firm zone)
  };

  // The days the view shows: the work week follows the firm's work hours.
  function shownDays() {
    return Layout.viewDays(state.view, state.day, WorkHours ? WorkHours.workWeekdays(state.workHours) : null);
  }

  function el(id) { return document.getElementById(id); }

  function show(node, visible) {
    if (node) node.classList.toggle('hidden', !visible);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value || '';
  }

  function storedUser() {
    return (window.api && window.api.user) || (window.Lex && window.Lex.Auth && window.Lex.Auth.user) || {};
  }

  function isAdmin() {
    return !!(window.Lex && window.Lex.Auth && typeof window.Lex.Auth.isAdmin === 'function' && window.Lex.Auth.isAdmin());
  }

  // The zone days are laid out in: the agenda's (the viewer's own zone, else
  // the firm's), and before the first agenda the stored person's zone.
  function currentZone() {
    if (state.timeZone) return state.timeZone;
    var utils = window.Lex && window.Lex.Utils;
    return (utils && typeof utils.getOrganizationTimezone === 'function' && utils.getOrganizationTimezone()) || T.SYSTEM_TIME_ZONE;
  }

  function notice(message) {
    setText('calNotice', message);
    show(el('calNotice'), !!message);
  }

  function readParams() {
    var params = window.Lex && window.Lex.Nav ? window.Lex.Nav.getParams() : new URLSearchParams(window.location.search);
    state.view = Model.normalizeView(params.get('view'));
    var day = params.get('date') || '';
    state.day = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : T.dayInTimeZone(T.nowDate(), currentZone());
  }

  function writeParams() {
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.updateParams === 'function') {
      window.Lex.Nav.updateParams({ view: state.view, date: state.day });
    }
  }

  function renderLegend(agenda) {
    var legend = el('calLegend');
    if (!legend) return;
    var people = (agenda && agenda.people) || [];
    if (people.length < 2) { legend.innerHTML = ''; show(legend, false); return; }
    var slots = Model.peopleIndex(people, state.viewerId);
    var esc = window.Lex.Utils.escapeHtml;
    legend.innerHTML = people.map(function (person) {
      var label = person.user_id === state.viewerId ? 'You' : (person.name || person.email || 'Coworker');
      return '<span class="cal-legend-item lex-cal-person-' + (slots[person.user_id] || 0) + '">'
        + '<span class="cal-legend-swatch" aria-hidden="true"></span>' + esc(label) + '</span>';
    }).join('');
    show(legend, true);
  }

  function render(agenda) {
    var grid = el('calGrid');
    var days = shownDays();
    setText('calRangeTitle', Model.rangeTitle(days, currentZone(), state.view, state.day));
    if (!grid) return;
    grid.timeZone = currentZone();
    grid.view = state.view;
    grid.days = days;
    var hours = WorkHours && state.view !== 'month' ? WorkHours.segmentsForDays(state.workHours, days, currentZone()) : null;
    grid.workHours = hours;
    grid.scrollMinutes = hours ? WorkHours.scrollMinutes(hours, days, currentZone()) : null;
    grid.items = agenda ? Model.toGridItems(agenda, state.viewerId) : [];
    renderLegend(agenda);
    setText('calZoneNote', agenda ? Model.zoneNote(agenda) : '');
  }

  function load() {
    var sequence = ++state.loadSequence;
    var days = shownDays();
    var window_ = Layout.windowFor(days, currentZone());
    var grid = el('calGrid');
    if (grid) grid.loading = true;
    render(state.agenda);
    return Calendar.agenda({ from: window_.from, to: window_.to, userIds: state.coworkers })
      .then(function (agenda) {
        if (sequence !== state.loadSequence) return;
        var zoneChanged = agenda && agenda.time_zone && agenda.time_zone !== state.timeZone;
        state.agenda = agenda;
        if (zoneChanged) {
          // Days are the viewer's own: reload once in the zone the server named.
          state.timeZone = agenda.time_zone;
          var expected = Layout.windowFor(days, state.timeZone);
          if (expected.from !== window_.from || expected.to !== window_.to) { load(); return; }
        }
        notice(agenda && agenda.complete === false
          ? 'Some events in this range are not shown. Narrow the range or the people to see them all.' : '');
        render(agenda);
      })
      .catch(function (error) {
        if (sequence !== state.loadSequence) return;
        state.agenda = null;
        render(null);
        notice(error && error.status === 403 && state.coworkers.length
          ? 'Your firm shows each person only their own calendar, so coworkers cannot be added.'
          : 'The calendar could not be loaded. Try again in a moment.');
      })
      .then(function () {
        if (sequence === state.loadSequence && grid) grid.loading = false;
      });
  }

  function loadPeople() {
    return Calendar.people().then(function (people) {
      var picker = el('calCoworkers');
      state.canManage = people && people.can_manage === true;
      if (picker) {
        picker.options = Model.coworkerOptions(people, state.viewerId);
        show(picker.closest('.cal-people'), people.freebusy_visible !== false || state.canManage);
      }
      return state.canManage ? Calendar.policy() : null;
    }).then(function (policy) {
      var section = el('calFirmSettings');
      show(section, !!policy);
      var toggle = el('calFreeBusyToggle');
      if (policy && toggle) toggle.checked = policy.freebusy_visible_to_members !== false;
    }).catch(function () {
      // The picker stays empty; the viewer's own calendar still loads.
    });
  }

  function formatWhen(item) {
    var zone = currentZone();
    if (item.is_all_day) {
      var dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
      var first = item.start_date || T.dayInTimeZone(item.start, zone);
      return 'All day, ' + dayFmt.format(new Date(first + 'T12:00:00Z'));
    }
    var fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
    var start = new Date(item.start);
    var end = new Date(item.end);
    var sameDay = T.dayInTimeZone(start, zone) === T.dayInTimeZone(end, zone);
    return fmt.format(start) + ' to ' + (sameDay ? timeFmt.format(end) : fmt.format(end));
  }

  var STATUS_LABELS = { scheduled: 'Scheduled', confirmed: 'Confirmed', no_show: 'No show', completed: 'Completed' };

  function openEvent(item) {
    var drawer = el('calEventDrawer');
    if (!drawer || !item) return;
    drawer.heading = item.title;
    setText('calDetailWhen', formatWhen(item));
    setText('calDetailSource', item.busy ? 'Not shared with you' : (item.badge ? item.badge.label : 'LANA'));
    // A repeating event: its rule in words, from the agenda.
    setText('calDetailRepeat', item.recurrenceText || '');
    show(el('calDetailRepeatRow'), !!item.recurrenceText);
    setText('calDetailStatus', STATUS_LABELS[item.status] || '');
    show(el('calDetailStatusRow'), !!STATUS_LABELS[item.status]);
    setText('calDetailOrganizer', item.organizer);
    show(el('calDetailOrganizerRow'), !!item.organizer);
    renderDetailExtras(item, null);

    var readOnlyNote = el('calDetailReadOnly');
    var target = Model.openTargetFor(item.busy ? { busy_only: true } : { source: item.source }, {
      isAdmin: isAdmin(),
      safeHttpUrl: window.LanaSafeUrl && window.LanaSafeUrl.safeHttpUrl
    });
    if (item.busy) {
      setText('calDetailReadOnly', 'This time is busy on a coworker\'s calendar. Only they can see what it is.');
    } else if (item.readOnly && item.source && item.source.kind === 'connector') {
      setText('calDetailReadOnly', 'This event comes from ' + (item.badge ? item.badge.label : 'a connected app') + '. Change it there.');
    } else {
      setText('calDetailReadOnly', '');
    }
    show(readOnlyNote, !!(readOnlyNote && readOnlyNote.textContent));
    state.openTarget = target;
    state.openItem = item;
    show(el('calOpenSourceBtn'), !!target);
    // A LANA event the viewer may change opens for editing.
    show(el('calEditBtn'), !item.busy && !item.readOnly && (!item.source || item.source.kind !== 'connector'));
    drawer.open = true;
    // The agenda carries no location or links: a LANA event the viewer can
    // read is fetched in full. Only the answer for the event still shown lands.
    var sequence = ++state.detailSequence;
    var id = Form.detailId(item);
    if (!id) return;
    Calendar.getEvent(id).then(function (detail) {
      if (sequence === state.detailSequence && state.openItem === item) renderDetailExtras(item, detail);
    }).catch(function () {
      // The panel keeps what the agenda gave.
    });
  }

  // Rows that come from the event detail (GET /calendar-events/:id).
  function renderDetailExtras(item, detail) {
    var location = Form.detailLocation(item, detail);
    setText('calDetailLocation', location);
    show(el('calDetailLocationRow'), !!location);
    var links = Form.detailLinks(item, detail);
    var list = el('calDetailLinks');
    if (list) {
      var esc = window.Lex.Utils.escapeHtml;
      list.innerHTML = links.map(function (text) { return '<li>' + esc(text) + '</li>'; }).join('');
    }
    show(el('calDetailLinksRow'), links.length > 0);
  }

  function openSource() {
    var target = state.openTarget;
    if (!target) return;
    if (target.type === 'external') {
      // Only an http(s) link from the source app (LanaSafeUrl), parsed again here.
      var safeUrl = window.LanaSafeUrl ? window.LanaSafeUrl.safeHttpUrl(target.url) : '';
      if (!safeUrl) return;
      if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
        window.electronAPI.openExternal(safeUrl);
      } else {
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (target.type === 'app' && window.Lex && window.Lex.Nav) window.Lex.Nav.go(target.href);
  }

  function saveFreeBusy(visible) {
    var toggle = el('calFreeBusyToggle');
    Calendar.setFreeBusyVisible(visible).then(function (policy) {
      if (toggle) toggle.checked = !policy || policy.freebusy_visible_to_members !== false;
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.success(visible ? 'Coworkers can now see each other\'s free/busy.' : 'Each person now sees only their own calendar.');
      return loadPeople().then(load);
    }).catch(function () {
      if (toggle) toggle.checked = !visible;
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('The setting could not be saved. Try again.');
    });
  }

  function bind() {
    var page = el('calendarPage');
    if (!page || page.dataset.bound === 'true') return;
    page.dataset.bound = 'true';
    el('calTodayBtn').addEventListener('click', function () {
      state.day = T.dayInTimeZone(T.nowDate(), currentZone());
      writeParams();
      load();
    });
    el('calPrevBtn').addEventListener('click', function () {
      state.day = Model.shiftDay(state.day, state.view, -1);
      writeParams();
      load();
    });
    el('calNextBtn').addEventListener('click', function () {
      state.day = Model.shiftDay(state.day, state.view, 1);
      writeParams();
      load();
    });
    el('calViewToggle').addEventListener('lex-change', function (e) {
      state.view = Model.normalizeView(e.detail && e.detail.value);
      writeParams();
      load();
    });
    el('calCoworkers').addEventListener('lex-change', function (e) {
      state.coworkers = Model.selectedUserIds(e.detail && e.detail.value);
      load();
    });
    el('calGrid').addEventListener('lex-calendar-open', function (e) {
      openEvent(e.detail && e.detail.item);
    });
    el('calOpenSourceBtn').addEventListener('click', openSource);
    el('calEditBtn').addEventListener('click', function () {
      var item = state.openItem;
      el('calEventDrawer').open = false;
      if (item && editor) {
        editor.openEdit(item.eventId || item.id, item.recurring ? { start: item.start, end: item.end, occurrenceStart: item.occurrenceStart } : null);
      }
    });
    el('calNewBtn').addEventListener('click', function () {
      if (editor) editor.openNew({ day: state.view === 'month' ? T.dayInTimeZone(T.nowDate(), currentZone()) : state.day });
    });
    el('calGrid').addEventListener('lex-calendar-create', function (e) {
      // A day the person clicked is kept (the New button may move after hours).
      if (editor && e.detail) editor.openNew({ day: e.detail.day, explicitDay: true, minutes: e.detail.minutes, allDay: e.detail.allDay });
    });
    el('calGrid').addEventListener('lex-calendar-move', function (e) {
      var d = e.detail || {};
      if (editor && d.item && !d.item.readOnly) editor.move(d.item, d.start, d.end);
    });
    el('calGrid').addEventListener('lex-calendar-day', function (e) {
      if (!e.detail || !e.detail.day) return;
      state.view = 'day';
      state.day = e.detail.day;
      var toggle = el('calViewToggle');
      if (toggle) toggle.value = 'day';
      writeParams();
      load();
    });
    el('calFreeBusyToggle').addEventListener('lex-change', function (e) {
      saveFreeBusy(!!(e.detail && e.detail.value));
    });
  }

  function init() {
    if (!el('calendarPage')) return;
    var user = storedUser();
    state.viewerId = user.id || '';
    state.agenda = null;
    state.timeZone = '';
    readParams();
    if (window.LanaCalendarEventDrawer) {
      editor = window.LanaCalendarEventDrawer.create({ calendar: Calendar, viewerId: state.viewerId, timeZone: currentZone, onSaved: load });
    }
    var toggle = el('calViewToggle');
    if (toggle) toggle.value = state.view;
    bind();
    // A person with no time zone of their own gets the computer's, once.
    if (window.LanaDeviceTimeZone && window.api) {
      window.LanaDeviceTimeZone.ensure({
        user: user,
        api: window.api,
        onSaved: function (zone) {
          if (typeof window.api.rememberUserTimezone === 'function') window.api.rememberUserTimezone(zone);
          load();
        }
      });
    }
    loadPeople();
    // The firm's work hours (once): the work week's days and the shading.
    if (typeof Calendar.workHours === 'function') {
      Calendar.workHours().then(function (hours) {
        state.workHours = hours || null;
        load();
      }).catch(function () {
        // No shading; the work week stays Monday to Friday.
      });
    }
    load();
  }

  if (window.LexRouter && typeof window.LexRouter.registerPageInit === 'function') {
    window.LexRouter.registerPageInit('calendar.html', init);
  }
  init();
})();
