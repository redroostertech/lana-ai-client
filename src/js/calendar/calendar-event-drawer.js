/* Calendar - event drawer and drag saves for calendar.html.
   Create, edit and delete LANA events in #calEditDrawer (lex-drawer +
   lex-form), and save a drag-to-move or resize from the grid. Conflicts warn,
   never block: a save asks the server to check (check_conflicts), and a
   409 CALENDAR_CONFLICT shows what overlaps with "Book anyway", which repeats
   the save with override. Events from connected apps are never edited here
   (the agenda marks them read only).

   Form values and request bodies come from calendar-event-form.model.js
   (unit tested); this file only wires them to the Lex components.

     var drawer = LanaCalendarEventDrawer.create({ calendar, viewerId, timeZone: fn, onSaved: fn });
     drawer.openNew({ day, minutes });  drawer.openEdit(calendarEventId);  drawer.move(item, start, end);
*/

(function () {
  'use strict';

  var Form = window.LanaCalendarEventForm;

  function el(id) { return document.getElementById(id); }
  function show(node, visible) { if (node) node.classList.toggle('hidden', !visible); }
  function toast(kind, message) {
    if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast[kind] === 'function') window.Lex.Toast[kind](message);
  }
  function esc(value) { return window.Lex.Utils.escapeHtml(String(value == null ? '' : value)); }

  function zoneOptions(current) {
    var zones = [];
    try {
      if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone');
    } catch (_error) { zones = []; }
    if (current && zones.indexOf(current) === -1) zones = [current].concat(zones);
    if (zones.indexOf('UTC') === -1) zones.push('UTC');
    return zones.map(function (zone) { return { value: zone, label: zone.replace(/_/g, ' ') }; });
  }

  function create(options) {
    var opts = options || {};
    var calendar = opts.calendar;
    var state = { detail: null, pendingLinks: [], linkOptions: null, people: null, saving: false };

    function viewerZone() { return typeof opts.timeZone === 'function' ? opts.timeZone() : 'UTC'; }

    /** Ask before booking over busy time. Resolves true for "Book anyway". */
    function confirmConflicts(error) {
      var lines = Form.conflictLines(Form.conflictsOf(error), opts.viewerId, viewerZone());
      var html = '<p class="cal-conflict-intro">This time overlaps:</p><ul class="cal-conflict-list">'
        + lines.map(function (line) { return '<li>' + esc(line) + '</li>'; }).join('') + '</ul>';
      return window.Lex.Modal.confirmAsync('Time conflict', html, {
        html: true, confirmText: 'Book anyway', cancelText: 'Pick another time', variant: 'default'
      });
    }

    /** Run a write with check_conflicts; on a conflict ask, then repeat with override. */
    function withConflictCheck(write) {
      return write({ check_conflicts: true }).catch(function (error) {
        if (!Form.isConflict(error)) throw error;
        return confirmConflicts(error).then(function (book) {
          if (!book) return null;
          return write({ check_conflicts: true, override: true });
        });
      });
    }

    function field(id) { return el(id); }

    function setValues(values) {
      field('calFieldTitle').value = values.title;
      field('calFieldLocation').value = values.location || '';
      field('calFieldAllDay').checked = values.is_all_day;
      field('calFieldStartDate').value = values.start_date;
      field('calFieldStartTime').value = values.start_time;
      field('calFieldEndDate').value = values.end_date;
      field('calFieldEndTime').value = values.end_time;
      var zone = field('calFieldZone');
      zone.options = zoneOptions(values.time_zone);
      zone.value = values.time_zone;
      field('calFieldAttendees').value = values.attendees;
      field('calFieldVisibility').value = values.visibility;
      field('calFieldDescription').value = values.description;
      syncAllDay();
      ['calFieldTitle', 'calFieldStartDate', 'calFieldStartTime', 'calFieldEndDate', 'calFieldEndTime'].forEach(function (id) {
        field(id).error = '';
      });
    }

    function readValues() {
      var attendees = field('calFieldAttendees').value;
      return {
        title: field('calFieldTitle').value,
        location: field('calFieldLocation').value,
        is_all_day: field('calFieldAllDay').checked === true,
        start_date: field('calFieldStartDate').value,
        start_time: field('calFieldStartTime').value,
        end_date: field('calFieldEndDate').value,
        end_time: field('calFieldEndTime').value,
        time_zone: field('calFieldZone').value || viewerZone(),
        attendees: Array.isArray(attendees) ? attendees : [],
        visibility: field('calFieldVisibility').value,
        description: field('calFieldDescription').value
      };
    }

    function syncAllDay() {
      var allDay = field('calFieldAllDay').checked === true;
      show(field('calFieldStartTime'), !allDay);
      show(field('calFieldEndTime'), !allDay);
    }

    // A repeating event's times cannot be changed here yet: the time fields
    // are read only and a save sends only the details.
    function setTimesLocked(locked) {
      ['calFieldAllDay', 'calFieldStartDate', 'calFieldStartTime', 'calFieldEndDate', 'calFieldEndTime', 'calFieldZone'].forEach(function (id) {
        field(id).disabled = locked;
      });
      show(el('calRecurringNote'), locked);
    }

    function setError(message) {
      var node = el('calEditError');
      node.textContent = message || '';
      show(node, !!message);
    }

    function currentLinks() {
      return state.detail ? (state.detail.links || []) : state.pendingLinks;
    }

    function renderLinks() {
      var list = el('calLinkList');
      var links = currentLinks();
      list.innerHTML = links.map(function (link, i) {
        return '<li class="cal-link-item"><span>' + esc(Form.linkText(link)) + '</span>'
          + '<lex-btn variant="ghost" size="sm" icon leading-icon="x" data-link-index="' + i + '" aria-label="'
          + esc('Remove ' + Form.linkText(link)) + '"></lex-btn></li>';
      }).join('');
      show(el('calLinkEmpty'), !links.length);
    }

    function loadPickers() {
      if (!state.people) {
        state.people = calendar.people().catch(function () { return null; });
      }
      state.people.then(function (people) {
        field('calFieldAttendees').options = Form.attendeeOptions(people, opts.viewerId);
      });
      if (!state.linkOptions) {
        var matters = window.api && typeof window.api.getMatters === 'function'
          ? Promise.resolve(window.api.getMatters(1, 100)).catch(function () { return null; }) : Promise.resolve(null);
        var tasks = window.api && typeof window.api.getMyTasks === 'function'
          ? Promise.resolve(window.api.getMyTasks({ limit: 100 })).catch(function () { return null; }) : Promise.resolve(null);
        state.linkOptions = Promise.all([matters, tasks]).then(function (results) {
          var rows = function (response, key) {
            if (Array.isArray(response)) return response;
            if (!response) return [];
            if (Array.isArray(response.data)) return response.data;
            if (response.data && Array.isArray(response.data[key])) return response.data[key];
            return Array.isArray(response[key]) ? response[key] : [];
          };
          return Form.linkOptions(rows(results[0], 'matters'), rows(results[1], 'tasks'));
        });
      }
      return state.linkOptions.then(syncLinkTargets);
    }

    function syncLinkTargets() {
      return state.linkOptions.then(function (options) {
        var type = field('calLinkType').value || 'matter';
        var target = field('calLinkTarget');
        target.options = options[type] || [];
        target.value = '';
      });
    }

    function openDrawer(heading, isExisting) {
      var drawer = el('calEditDrawer');
      drawer.heading = heading;
      show(el('calDeleteBtn'), isExisting);
      setError('');
      renderLinks();
      loadPickers();
      drawer.open = true;
      setTimeout(function () { var t = field('calFieldTitle'); if (t && typeof t.focus === 'function') t.focus(); }, 0);
    }

    function openNew(slot) {
      var s = slot || {};
      state.detail = null;
      state.pendingLinks = [];
      setValues(Form.draftForNew({ day: s.day, explicitDay: s.explicitDay === true, minutes: s.minutes === null ? undefined : s.minutes, allDay: s.allDay === true, timeZone: viewerZone() }));
      setTimesLocked(false);
      openDrawer('New event', false);
    }

    function openEdit(calendarEventId) {
      return calendar.getEvent(calendarEventId).then(function (detail) {
        state.detail = detail;
        state.pendingLinks = [];
        var draft = Form.draftFromEvent(detail, viewerZone());
        setValues(draft);
        setTimesLocked(draft.recurring);
        // Delete only for someone the server says may delete (an invitee never).
        openDrawer('Edit event', draft.can_delete);
      }).catch(function () {
        toast('error', 'The event could not be opened. Try again.');
      });
    }

    function applyInvitations(id, wanted) {
      var detail = state.detail;
      var owner = detail && detail.calendar && detail.calendar.is_mine ? opts.viewerId : null;
      var changes = Form.attendeeChanges(wanted, detail ? detail.attendees : [], owner);
      var steps = [];
      if (changes.add.length) steps.push(calendar.invite(id, changes.add));
      changes.remove.forEach(function (attendeeId) { steps.push(calendar.removeAttendee(id, attendeeId)); });
      return Promise.all(steps);
    }

    function save() {
      if (state.saving) return;
      var values = readValues();
      var result = Form.toPayload(values, { keepTimes: !!(state.detail && state.detail.recurrence_rule) });
      setError('');
      if (result.errors) {
        result.errors.forEach(function (e) {
          var map = { title: 'calFieldTitle', start_date: 'calFieldStartDate', start_time: 'calFieldStartTime', end_date: 'calFieldEndDate', end_time: 'calFieldEndTime' };
          if (map[e.name]) field(map[e.name]).error = e.message;
        });
        setError(result.errors[0].message);
        return;
      }
      state.saving = true;
      var existing = state.detail;
      var write = existing
        ? function (flags) { return calendar.updateEvent(existing.calendar_event_id, Object.assign({}, result.body, flags)); }
        : function (flags) {
          return calendar.createEvent(Object.assign({}, result.body, flags, {
            invitees: values.attendees.map(function (id) { return { user_id: id }; })
          }));
        };
      withConflictCheck(write).then(function (event) {
        if (!event) return null;
        var id = event.calendar_event_id;
        var after = existing
          ? applyInvitations(id, values.attendees)
          : Promise.all(state.pendingLinks.map(function (link) {
            return calendar.addLink(id, { target_type: link.target_type, target_id: link.target_id });
          }));
        return after.then(function () {
          el('calEditDrawer').open = false;
          toast('success', existing ? 'Event saved.' : 'Event created.');
          if (typeof opts.onSaved === 'function') opts.onSaved();
        });
      }).catch(function (error) {
        setError(error && error.status === 403
          ? 'You cannot change this event.'
          : ((error && error.message) || 'The event could not be saved. Try again.'));
      }).then(function () { state.saving = false; });
    }

    function remove() {
      var detail = state.detail;
      if (!detail) return;
      window.Lex.Modal.confirmAsync('Delete event', 'Delete "' + (detail.title || 'this event') + '"? People invited lose it from their calendars.',
        { variant: 'danger', confirmText: 'Delete' }).then(function (yes) {
        if (!yes) return null;
        return calendar.deleteEvent(detail.calendar_event_id).then(function () {
          el('calEditDrawer').open = false;
          toast('success', 'Event deleted.');
          if (typeof opts.onSaved === 'function') opts.onSaved();
        });
      }).catch(function () { setError('The event could not be deleted. Try again.'); });
    }

    function addLink() {
      var type = field('calLinkType').value || 'matter';
      var targetId = field('calLinkTarget').value;
      if (!targetId) return;
      state.linkOptions.then(function (options) {
        var chosen = (options[type] || []).filter(function (o) { return o.value === targetId; })[0];
        var link = { target_type: type, target_id: targetId, label: chosen ? chosen.label : '' };
        if (!state.detail) {
          if (!state.pendingLinks.some(function (l) { return l.target_type === type && l.target_id === targetId; })) state.pendingLinks.push(link);
          renderLinks();
          return null;
        }
        return calendar.addLink(state.detail.calendar_event_id, { target_type: type, target_id: targetId }).then(function (result) {
          state.detail.links = (result && result.links) || state.detail.links;
          renderLinks();
          if (typeof opts.onSaved === 'function') opts.onSaved();
        });
      }).catch(function (error) {
        setError(error && error.status === 404 ? 'You cannot link to that.' : 'The link could not be added. Try again.');
      });
    }

    function removeLink(index) {
      var links = currentLinks();
      var link = links[index];
      if (!link) return;
      if (!state.detail) {
        state.pendingLinks.splice(index, 1);
        renderLinks();
        return;
      }
      calendar.removeLink(state.detail.calendar_event_id, { target_type: link.target_type, target_id: link.target_id })
        .then(function (result) {
          state.detail.links = (result && result.links) || [];
          renderLinks();
          if (typeof opts.onSaved === 'function') opts.onSaved();
        }).catch(function () { setError('The link could not be removed. Try again.'); });
    }

    /** Save a drag on the grid (move or resize). Reloads either way, so a refused move snaps back. */
    function move(item, start, end) {
      if (!item || item.readOnly || item.recurring) return Promise.resolve();
      return withConflictCheck(function (flags) {
        return calendar.updateEvent(item.id, Object.assign({ start_time: start, end_time: end }, flags));
      }).then(function (event) {
        if (event) toast('success', 'Event moved.');
      }).catch(function (error) {
        toast('error', error && error.status === 403 ? 'You cannot change this event.' : 'The event could not be moved. Try again.');
      }).then(function () {
        if (typeof opts.onSaved === 'function') opts.onSaved();
      });
    }

    function bind() {
      var drawer = el('calEditDrawer');
      if (!drawer || drawer.dataset.bound === 'true') return;
      drawer.dataset.bound = 'true';
      drawer.addEventListener('lex-confirm', save);
      drawer.addEventListener('lex-cancel', function () { drawer.open = false; });
      field('calEventForm').addEventListener('lex-submit', function (e) { e.preventDefault && e.preventDefault(); save(); });
      field('calFieldAllDay').addEventListener('lex-change', syncAllDay);
      field('calLinkType').addEventListener('lex-change', syncLinkTargets);
      el('calLinkAddBtn').addEventListener('click', addLink);
      // Keep the link controls in view above the drawer footer while used.
      var linksSection = el('calLinkTarget').closest('.cal-links');
      if (linksSection) {
        linksSection.addEventListener('focusin', function (e) {
          var target = e.target && e.target.closest && e.target.closest('lex-segmented, lex-select, lex-btn');
          if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' });
        });
      }
      el('calDeleteBtn').addEventListener('click', remove);
      el('calLinkList').addEventListener('click', function (e) {
        var button = e.target.closest && e.target.closest('[data-link-index]');
        if (button) removeLink(Number(button.getAttribute('data-link-index')));
      });
    }

    bind();
    return { openNew: openNew, openEdit: openEdit, move: move, save: save };
  }

  var api = { create: create };
  window.LanaCalendarEventDrawer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
