/* Calendar - event drawer and drag saves for calendar.html.
   Create, edit and delete LANA events in #calEditDrawer (lex-drawer +
   lex-form), and save a drag-to-move or resize from the grid. Conflicts warn,
   never block: a save asks the server to check (check_conflicts), and a
   409 CALENDAR_CONFLICT shows what overlaps with "Book anyway", which repeats
   the save with override. Events from connected apps are never edited here
   (the agenda marks them read only).

   Repeating events (calendar part 6): the drawer has a repeat picker; a
   save, delete or drag of one occurrence asks "This event / This and
   following events / All events" (#calScopeModal) and sends that scope with
   the occurrence's original start. The backend builds the rule, expands the
   occurrences and words the rule.

   Form values and request bodies come from calendar-event-form.model.js and
   calendar-repeat.model.js (unit tested); this file only wires them to the
   Lex components.

     var drawer = LanaCalendarEventDrawer.create({ calendar, viewerId, timeZone: fn, onSaved: fn });
     drawer.openNew({ day, minutes });  drawer.openEdit(calendarEventId, occurrence);  drawer.move(item, start, end);
*/

(function () {
  'use strict';

  var Form = window.LanaCalendarEventForm;
  var Repeat = window.LanaCalendarRepeat;
  var NO_OCCURRENCE = 'Open the event from the calendar to change only this one or the following ones.';

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
    var state = { detail: null, pendingLinks: [], linkOptions: null, people: null, saving: false,
      repeatBefore: null, occurrenceStart: null, previewSequence: 0, previewTimer: null, savedText: '' };

    function isRepeating(detail) {
      return !!(detail && (detail.series_id || detail.recurrence_rule));
    }

    /**
     * Ask which occurrences a change is for. Resolves 'this', 'following',
     * 'all', or null when the person cancels.
     */
    function askScope(action) {
      var modal = el('calScopeModal');
      var choice = el('calScopeChoice');
      // Fail closed: without the question nothing is changed (never All events).
      if (!modal || !choice) {
        setError('This event repeats, and the question about which events to change could not open. Reload the page and try again.');
        toast('error', 'Nothing was changed. Reload the page and try again.');
        return Promise.resolve(null);
      }
      var words = Repeat.scopePrompt(action);
      modal.heading = words.heading;
      choice.value = 'this';
      return new Promise(function (resolve) {
        var settled = false;
        function finish(value) {
          if (settled) return;
          settled = true;
          modal.removeEventListener('lex-confirm', onConfirm);
          modal.removeEventListener('lex-cancel', onCancel);
          modal.removeEventListener('lex-close', onCancel);
          resolve(value);
        }
        function onConfirm() { finish(choice.value || 'this'); }
        function onCancel() { finish(null); }
        modal.addEventListener('lex-confirm', onConfirm);
        modal.addEventListener('lex-cancel', onCancel);
        modal.addEventListener('lex-close', onCancel);
        modal.open = true;
      });
    }

    function viewerZone() { return typeof opts.timeZone === 'function' ? opts.timeZone() : 'UTC'; }

    /** Ask before booking over busy time. Resolves true for "Book anyway". */
    function confirmConflicts(error) {
      var lines = Form.conflictLines(Form.conflictsOf(error), opts.viewerId, viewerZone());
      var first = Form.firstConflictText(error, viewerZone());
      var intro = first ? 'This time overlaps other events, first on ' + first + ':' : 'This time overlaps:';
      var html = '<p class="cal-conflict-intro">' + esc(intro) + '</p><ul class="cal-conflict-list">'
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
      });      // The times as opened: a save sends times only when they changed.
      state.draftTimes = readValues();
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

    // The repeat picker (calendar-repeat.model.js values).
    function setRepeat(values, text) {
      var presets = Repeat.PRESET_OPTIONS.slice();
      if (values.preset === 'keep') presets.push({ value: 'keep', label: text || 'Keep how it repeats now' });
      field('calFieldRepeat').options = presets;
      field('calFieldRepeat').value = values.preset;
      field('calFieldRepeatDays').value = values.weekdays;
      field('calFieldRepeatInterval').value = String(values.interval || 1);
      field('calFieldRepeatUnit').value = values.unit || 'weekly';
      field('calFieldRepeatEnds').value = values.ends || 'never';
      field('calFieldRepeatUntil').value = values.until || '';
      field('calFieldRepeatCount').value = String(values.count || 10);
      ['calFieldRepeatDays', 'calFieldRepeatInterval', 'calFieldRepeatUntil', 'calFieldRepeatCount'].forEach(function (id) { field(id).error = ''; });
      state.savedText = text || '';
      showRepeatText(state.savedText);
      syncRepeat();
    }

    function showRepeatText(text) {
      var note = el('calRepeatText');
      note.textContent = text ? 'Repeats: ' + text : '';
      show(note, !!text);
    }

    /**
     * The rule in words while the picker is edited, from the backend (the
     * same wording a saved event gets). Shown only for valid values; the
     * latest answer wins.
     */
    function refreshPreview() {
      var sequence = ++state.previewSequence;
      var picker = readRepeat();
      var values = readValues();
      if (picker.preset === 'keep') { showRepeatText(state.savedText); return Promise.resolve(); }
      var repeat = Repeat.toRepeat(picker, values.start_date);
      var payload = Form.toPayload(Object.assign({}, values, { title: values.title || 'preview' }));
      if (!repeat.repeat || payload.errors || typeof calendar.previewRepeat !== 'function') { showRepeatText(''); return Promise.resolve(); }
      return calendar.previewRepeat({ repeat: repeat.repeat, start_time: payload.body.start_time, timezone: payload.body.timezone })
        .then(function (result) {
          if (sequence === state.previewSequence) showRepeatText(result && result.text);
        })
        .catch(function () {
          if (sequence === state.previewSequence) showRepeatText('');
        });
    }

    function schedulePreview() {
      if (state.previewTimer) clearTimeout(state.previewTimer);
      state.previewTimer = setTimeout(function () { state.previewTimer = null; refreshPreview(); }, 250);
    }

    function readRepeat() {
      var days = field('calFieldRepeatDays').value;
      return {
        preset: field('calFieldRepeat').value || 'none',
        weekdays: Array.isArray(days) ? days : (days ? String(days).split(',') : []),
        interval: Number(field('calFieldRepeatInterval').value),
        unit: field('calFieldRepeatUnit').value || 'weekly',
        ends: field('calFieldRepeatEnds').value || 'never',
        until: field('calFieldRepeatUntil').value,
        count: Number(field('calFieldRepeatCount').value)
      };
    }

    function syncRepeat() {
      var parts = Repeat.visibleParts(readRepeat());
      show(field('calFieldRepeatDays'), parts.weekdays);
      show(el('calRepeatIntervalRow'), parts.interval);
      show(el('calRepeatEndsRow'), parts.ends);
      show(field('calFieldRepeatUntil'), parts.until);
      show(field('calFieldRepeatCount'), parts.count);
    }

    function syncAllDay() {
      var allDay = field('calFieldAllDay').checked === true;
      show(field('calFieldStartTime'), !allDay);
      show(field('calFieldEndTime'), !allDay);
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
      var draft = Form.draftForNew({ day: s.day, explicitDay: s.explicitDay === true, minutes: s.minutes === null ? undefined : s.minutes, allDay: s.allDay === true, timeZone: viewerZone() });
      setValues(draft);
      state.repeatBefore = null;
      state.occurrenceStart = null;
      setRepeat(Repeat.defaults(draft.start_date), '');
      openDrawer('New event', false);
    }

    /**
     * Edit an event. occurrence { start, end, occurrenceStart }: the
     * occurrence of a repeating event that was opened; its times fill the
     * form and a save asks which occurrences it is for.
     */
    function openEdit(calendarEventId, occurrence) {
      return calendar.getEvent(calendarEventId).then(function (detail) {
        state.detail = detail;
        state.pendingLinks = [];
        var repeating = isRepeating(detail);
        var draft = Form.draftFromEvent(detail, viewerZone(), repeating ? occurrence : null);
        setValues(draft);
        var picker = Repeat.fromRepeat(detail.repeat, draft.start_date);
        state.repeatBefore = Repeat.toRepeat(picker, '').repeat;
        state.occurrenceStart = repeating
          ? (detail.is_exception ? detail.occurrence_start : ((occurrence && occurrence.occurrenceStart) || null))
          : null;
        setRepeat(picker, detail.recurrence_text || '');
        // Delete only for someone the server says may delete (an invitee never).
        openDrawer(repeating ? 'Edit repeating event' : 'Edit event', draft.can_delete);
      }).catch(function () {
        toast('error', 'The event could not be opened. Try again.');
      });
    }

    // current: the event whose invitation rows are diffed (default: the one opened).
    function applyInvitations(id, wanted, current) {
      var detail = current || state.detail;
      var owner = detail && detail.calendar && detail.calendar.is_mine ? opts.viewerId : null;
      var changes = Form.attendeeChanges(wanted, detail ? detail.attendees : [], owner);
      var steps = [];
      if (changes.add.length) steps.push(calendar.invite(id, changes.add));
      changes.remove.forEach(function (attendeeId) { steps.push(calendar.removeAttendee(id, attendeeId)); });
      return Promise.all(steps);
    }

    function showRepeatErrors(errors) {
      var map = { weekdays: 'calFieldRepeatDays', interval: 'calFieldRepeatInterval', until: 'calFieldRepeatUntil', count: 'calFieldRepeatCount' };
      errors.forEach(function (e) { if (map[e.name]) field(map[e.name]).error = e.message; });
      setError(errors[0].message);
    }

    function save() {
      if (state.saving) return;
      var values = readValues();
      var result = Form.toPayload(values);
      setError('');
      if (result.errors) {
        result.errors.forEach(function (e) {
          var map = { title: 'calFieldTitle', start_date: 'calFieldStartDate', start_time: 'calFieldStartTime', end_date: 'calFieldEndDate', end_time: 'calFieldEndTime' };
          if (map[e.name]) field(map[e.name]).error = e.message;
        });
        setError(result.errors[0].message);
        return;
      }
      var repeat = Repeat.toRepeat(readRepeat(), values.start_date);
      if (repeat.errors) { showRepeatErrors(repeat.errors); return; }
      var existing = state.detail;
      var repeatChanged = repeat.repeat !== undefined && Repeat.changed(state.repeatBefore, repeat.repeat);
      var asked = existing && isRepeating(existing) ? askScope('edit') : Promise.resolve(null);
      asked.then(function (scope) {
        if (existing && isRepeating(existing) && !scope) return;
        if (scope && scope !== 'all' && !state.occurrenceStart) {
          setError(NO_OCCURRENCE);
          return;
        }
        if (scope === 'this' && repeatChanged) {
          setError('Change how it repeats for all events, or for this and following events.');
          return;
        }
        var body = Object.assign({}, result.body);
        if (existing && !Form.timesChanged(state.draftTimes, values)) {
          // Times are sent only when the person changed them.
          delete body.start_time;
          delete body.end_time;
          delete body.is_all_day;
          delete body.timezone;
        }
        if (scope) {
          body.scope = scope;
          if (state.occurrenceStart) body.occurrence_start = state.occurrenceStart;
        }
        if (existing ? repeatChanged : repeat.repeat) body.repeat = repeat.repeat;
        state.saving = true;
        var write = existing
          ? function (flags) { return calendar.updateEvent(existing.calendar_event_id, Object.assign({}, body, flags)); }
          : function (flags) {
            return calendar.createEvent(Object.assign({}, body, flags, {
              invitees: values.attendees.map(function (id) { return { user_id: id }; })
            }));
          };
        return withConflictCheck(write).then(function (event) {
          if (!event) return null;
          var id = event.calendar_event_id;
          // Invitation changes go to the row the save wrote. A new row (one
          // occurrence, or this and following) copied the invitations under its
          // own attendee rows, so those are read and diffed.
          var after = existing
            ? (id === existing.calendar_event_id
              ? applyInvitations(id, values.attendees)
              : calendar.getEvent(id).then(function (written) { return applyInvitations(id, values.attendees, written); }))
            : Promise.all(state.pendingLinks.map(function (link) {
              return calendar.addLink(id, { target_type: link.target_type, target_id: link.target_id });
            }));
          return after.then(function () {
            el('calEditDrawer').open = false;
            toast('success', existing ? 'Event saved.' : 'Event created.');
            if (typeof opts.onSaved === 'function') opts.onSaved();
          });
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
      if (isRepeating(detail)) {
        askScope('delete').then(function (scope) {
          if (!scope) return null;
          var occurrence = state.occurrenceStart;
          if (scope !== 'all' && !occurrence) {
            setError(NO_OCCURRENCE);
            return null;
          }
          var options = occurrence ? { scope: scope, occurrence_start: occurrence } : { scope: 'all' };
          return calendar.deleteEvent(detail.calendar_event_id, options).then(function () {
            el('calEditDrawer').open = false;
            toast('success', options.scope === 'this' ? 'Event deleted.' : 'Events deleted.');
            if (typeof opts.onSaved === 'function') opts.onSaved();
          });
        }).catch(function () { setError('The event could not be deleted. Try again.'); });
        return;
      }
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
      if (!item || item.readOnly || item.busy) return Promise.resolve();
      var id = item.eventId || item.id;
      if (item.recurring && !item.occurrenceStart) {
        toast('error', 'This repeating event could not be moved. Open it to change it.');
        return Promise.resolve();
      }
      var asked = item.recurring ? askScope('move') : Promise.resolve(null);
      return asked.then(function (scope) {
        if (item.recurring && !scope) return null;
        var body = { start_time: start, end_time: end };
        if (scope) { body.scope = scope; body.occurrence_start = item.occurrenceStart; }
        return withConflictCheck(function (flags) {
          return calendar.updateEvent(id, Object.assign({}, body, flags));
        });
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
      field('calFieldRepeatUnit').options = Repeat.UNIT_OPTIONS;
      field('calFieldRepeatDays').options = Repeat.WEEKDAY_OPTIONS;
      field('calFieldRepeatEnds').options = Repeat.ENDS_OPTIONS;
      ['calFieldRepeat', 'calFieldRepeatUnit', 'calFieldRepeatEnds'].forEach(function (id) {
        field(id).addEventListener('lex-change', syncRepeat);
      });
      // Any change that can change the words: the picker, the first day, time or zone.
      ['calFieldRepeat', 'calFieldRepeatUnit', 'calFieldRepeatEnds', 'calFieldRepeatDays', 'calFieldRepeatInterval', 'calFieldRepeatUntil',
        'calFieldRepeatCount', 'calFieldStartDate', 'calFieldStartTime', 'calFieldZone'].forEach(function (id) {
        field(id).addEventListener('lex-change', schedulePreview);
        field(id).addEventListener('lex-input', schedulePreview);
      });
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
    return { openNew: openNew, openEdit: openEdit, move: move, save: save, refreshPreview: refreshPreview };
  }

  var api = { create: create };
  window.LanaCalendarEventDrawer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
