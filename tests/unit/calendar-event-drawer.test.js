'use strict';

/**
 * Calendar event drawer wiring (js/calendar/calendar-event-drawer.js):
 * a save asks the server to check conflicts; a 409 CALENDAR_CONFLICT asks
 * the person, and only "Book anyway" repeats the save with override. A drag
 * save works the same way. The Lex components are stood in for by plain
 * elements carrying the properties the drawer reads.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const IDS = ['calEditDrawer', 'calEventForm', 'calFieldTitle', 'calFieldLocation', 'calFieldAllDay', 'calFieldStartDate', 'calFieldStartTime', 'calFieldEndDate',
  'calFieldEndTime', 'calFieldZone', 'calFieldAttendees', 'calFieldVisibility', 'calFieldDescription', 'calLinkList', 'calLinkEmpty',
  'calLinkType', 'calLinkTarget', 'calLinkAddBtn', 'calEditError', 'calDeleteBtn',
  'calFieldRepeat', 'calFieldRepeatDays', 'calFieldRepeatInterval', 'calFieldRepeatUnit', 'calFieldRepeatEnds', 'calFieldRepeatUntil',
  'calFieldRepeatCount', 'calRepeatText', 'calRepeatIntervalRow', 'calRepeatEndsRow', 'calScopeModal', 'calScopeChoice'];

function setup({ confirm = true, detail = null, newRow = null, firstConflictDate = undefined, withoutScopeModal = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${IDS.map((id) => `<div id="${id}"></div>`).join('')}</body>`, {
    runScripts: 'outside-only', virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  if (withoutScopeModal) w.document.getElementById('calScopeModal').remove();
  w.eval(read('js/time-utils.js'));
  w.eval(read('js/calendar/calendar-event-form.model.js'));
  w.eval(read('js/calendar/calendar-repeat.model.js'));
  const confirms = [];
  const toasts = [];
  w.Lex = {
    Utils: { escapeHtml: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) },
    Modal: { confirmAsync: (title, html, options) => { confirms.push({ title, html, options }); return Promise.resolve(confirm); } },
    Toast: { success: (m) => toasts.push(['success', m]), error: (m) => toasts.push(['error', m]) }
  };
  w.eval(read('js/calendar/calendar-event-drawer.js'));
  const conflict = Object.assign(new Error('This time overlaps other events'), {
    status: 409, code: 'CALENDAR_CONFLICT',
    data: { code: 'CALENDAR_CONFLICT', first_conflict_date: firstConflictDate,
      conflicts: [{ user_id: 'u2', name: 'Ben', private: true, title: null, start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z' }] }
  });
  const calls = [];
  const calendar = {
    people: () => Promise.resolve({ members: [] }),
    createEvent: (body) => { calls.push(['create', body]); return calls.length === 1 ? Promise.reject(conflict) : Promise.resolve({ calendar_event_id: 'CAL-9' }); },
    updateEvent: (id, body) => {
      calls.push(['update', id, body]);
      if (calls.length === 1) return Promise.reject(conflict);
      return Promise.resolve({ calendar_event_id: newRow ? newRow.calendar_event_id : id });
    },
    previewRepeat: (body) => { calls.push(['preview', body]); return Promise.resolve({ text: `words for ${body.repeat.frequency}` }); },
    invite: (id, invitees) => { calls.push(['invite', id, invitees]); return Promise.resolve({ added: [] }); },
    removeAttendee: (id, attendeeId) => { calls.push(['remove', id, attendeeId]); return Promise.resolve({}); },
    addLink: () => Promise.resolve({ links: [] }),
    deleteEvent: (id, options) => { calls.push(['delete', id, options]); return Promise.resolve(); },
    getEvent: (id) => Promise.resolve(newRow && id === newRow.calendar_event_id ? newRow : detail)
  };
  let saved = 0;
  const drawer = w.LanaCalendarEventDrawer.create({ calendar, viewerId: 'me', timeZone: () => 'America/New_York', onSaved: () => { saved += 1; } });
  return { w, drawer, calls, confirms, toasts, saved: () => saved };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle() { for (let i = 0; i < 10; i += 1) await flush(); }

describe('calendar event drawer', () => {
  test('a new event over busy time warns; "Book anyway" saves it with override', async () => {
    const { w, drawer, calls, confirms, saved } = setup({ confirm: true });
    drawer.openNew({ day: '2026-11-18', minutes: 9 * 60 });
    w.document.getElementById('calFieldTitle').value = 'Consult';
    drawer.save();
    await settle();
    expect(calls.map((c) => [c[0], c[1].check_conflicts, c[1].override])).toEqual([['create', true, undefined], ['create', true, true]]);
    expect(calls[1][1]).toMatchObject({ title: 'Consult', start_time: '2026-11-18T14:00:00.000Z', end_time: '2026-11-18T15:00:00.000Z', timezone: 'America/New_York' });
    expect(confirms[0].options.confirmText).toBe('Book anyway');
    // The private block is named busy, with no title.
    expect(confirms[0].html).toContain('Ben: busy');
    expect(w.document.getElementById('calEditDrawer').open).toBe(false);
    expect(saved()).toBe(1);
  });

  test('choosing another time saves nothing more and keeps the drawer open', async () => {
    const { w, drawer, calls, saved } = setup({ confirm: false });
    drawer.openNew({ day: '2026-11-18', minutes: 9 * 60 });
    w.document.getElementById('calFieldTitle').value = 'Consult';
    drawer.save();
    await settle();
    expect(calls).toHaveLength(1);
    expect(w.document.getElementById('calEditDrawer').open).toBe(true);
    expect(saved()).toBe(0);
  });

  test('a form error is shown and nothing is sent', async () => {
    const { w, drawer, calls } = setup();
    drawer.openNew({ day: '2026-11-18', minutes: 9 * 60 });
    drawer.save();
    await settle();
    expect(calls).toHaveLength(0);
    expect(w.document.getElementById('calEditError').textContent).toBe('Give the event a title.');
  });

  test('a drag save checks conflicts and books anyway when asked; the calendar reloads', async () => {
    const { drawer, calls, saved } = setup({ confirm: true });
    await drawer.move({ id: 'CAL-1' }, '2026-11-18T15:00:00.000Z', '2026-11-18T16:00:00.000Z');
    expect(calls.map((c) => [c[0], c[1], c[2].override])).toEqual([['update', 'CAL-1', undefined], ['update', 'CAL-1', true]]);
    expect(saved()).toBe(1);
  });

  const existing = (overrides) => ({ calendar_event_id: 'CAL-5', title: 'Weekly sync', start_time: '2026-11-18T14:00:00.000Z',
    end_time: '2026-11-18T15:00:00.000Z', timezone: 'America/New_York', visibility: 'public', attendees: [], links: [],
    calendar: { is_mine: true }, can_edit: true, can_delete: true, ...overrides });

  // The scope prompt (#calScopeModal): answer it as the person would.
  const answer = (w, scope) => {
    const modal = w.document.getElementById('calScopeModal');
    expect(modal.open).toBe(true);
    if (scope) {
      w.document.getElementById('calScopeChoice').value = scope;
      modal.dispatchEvent(new w.Event('lex-confirm'));
    } else {
      modal.dispatchEvent(new w.Event('lex-cancel'));
    }
  };
  const weekly = () => existing({ series_id: 'CAL-5', recurrence_text: 'Every Wednesday', location: 'Room 4',
    repeat: { frequency: 'weekly', interval: 1, weekdays: ['WE'], ends: { type: 'never' }, editable: true } });
  const occurrence = { start: '2026-11-25T14:00:00.000Z', end: '2026-11-25T15:00:00.000Z', occurrenceStart: '2026-11-25T14:00:00.000Z' };

  test('a repeating event opens on the occurrence chosen; a save asks which occurrences and sends that scope', async () => {
    const { w, drawer, calls } = setup({ detail: weekly() });
    await drawer.openEdit('CAL-5', occurrence);
    await settle();
    const doc = w.document;
    expect([doc.getElementById('calFieldStartDate').value, doc.getElementById('calFieldStartTime').value]).toEqual(['2026-11-25', '09:00']);
    expect(doc.getElementById('calFieldRepeat').value).toBe('weekly');
    expect(doc.getElementById('calRepeatText').textContent).toBe('Repeats: Every Wednesday');
    doc.getElementById('calFieldStartTime').value = '10:00';
    doc.getElementById('calFieldEndTime').value = '11:00';
    drawer.save();
    await settle();
    answer(w, 'following');
    await settle();
    const body = calls.filter((c) => c[0] === 'update').pop()[2];
    expect(body).toMatchObject({ scope: 'following', occurrence_start: occurrence.occurrenceStart,
      start_time: '2026-11-25T15:00:00.000Z', end_time: '2026-11-25T16:00:00.000Z', location: 'Room 4' });
    // The repeat was not touched: it is not sent.
    expect(body).not.toHaveProperty('repeat');
  });

  test('cancelling the question sends nothing; a new repeat for this event only is refused', async () => {
    const { w, drawer, calls } = setup({ detail: weekly() });
    await drawer.openEdit('CAL-5', occurrence);
    await settle();
    drawer.save();
    await settle();
    answer(w, null);
    await settle();
    expect(calls).toHaveLength(0);
    w.document.getElementById('calFieldRepeat').value = 'daily';
    drawer.save();
    await settle();
    answer(w, 'this');
    await settle();
    expect(calls).toHaveLength(0);
    expect(w.document.getElementById('calEditError').textContent).toMatch(/for all events, or for this and following/);
    drawer.save();
    await settle();
    answer(w, 'all');
    await settle();
    expect(calls.filter((c) => c[0] === 'update').pop()[2]).toMatchObject({ scope: 'all', repeat: { frequency: 'daily', interval: 1 } });
  });

  test('dragging an occurrence asks too; delete asks and sends the occurrence', async () => {
    const { w, drawer, calls } = setup({ confirm: true, detail: weekly() });
    const moving = drawer.move({ id: 'CAL-5@2026-11-25T14:00:00.000Z', eventId: 'CAL-5', recurring: true, occurrenceStart: occurrence.occurrenceStart },
      '2026-11-26T14:00:00.000Z', '2026-11-26T15:00:00.000Z');
    await settle();
    answer(w, 'all');
    await moving;
    expect(calls.pop()).toEqual(['update', 'CAL-5', expect.objectContaining({ scope: 'all', occurrence_start: occurrence.occurrenceStart,
      start_time: '2026-11-26T14:00:00.000Z' })]);
    await drawer.openEdit('CAL-5', occurrence);
    await settle();
    w.document.getElementById('calDeleteBtn').dispatchEvent(new w.Event('click'));
    await settle();
    answer(w, 'this');
    await settle();
    expect(calls.pop()).toEqual(['delete', 'CAL-5', { scope: 'this', occurrence_start: occurrence.occurrenceStart }]);
  });

  test('invitation edits reach the new row a save created (one occurrence, or this and following)', async () => {
    const series = weekly();
    series.attendees = [{ id: 'att-ben', user_id: 'ben' }];
    // The exception row copied Ben's invitation under its own attendee row id.
    const newRow = { ...series, calendar_event_id: 'CAL-77', attendees: [{ id: 'att-ben-77', user_id: 'ben' }] };
    const { w, drawer, calls } = setup({ confirm: true, detail: series, newRow });
    await drawer.openEdit('CAL-5', occurrence);
    await settle();
    w.document.getElementById('calFieldAttendees').value = ['cara'];
    drawer.save();
    await settle();
    answer(w, 'this');
    await settle();
    expect(calls.filter((c) => c[0] === 'invite' || c[0] === 'remove')).toEqual([
      ['invite', 'CAL-77', [{ user_id: 'cara' }]],
      ['remove', 'CAL-77', 'att-ben-77']
    ]);
  });

  test('the repeat picker shows the backend\'s words while it is edited; none or an invalid repeat shows none', async () => {
    const { w, drawer, calls } = setup();
    drawer.openNew({ day: '2026-11-18', minutes: 9 * 60 });
    const doc = w.document;
    const note = doc.getElementById('calRepeatText');
    doc.getElementById('calFieldRepeat').value = 'weekdays';
    await drawer.refreshPreview();
    expect(note.textContent).toBe('Repeats: words for weekly');
    expect(calls.pop()).toEqual(['preview', { repeat: { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], ends: { type: 'never' } },
      start_time: '2026-11-18T14:00:00.000Z', timezone: 'America/New_York' }]);
    doc.getElementById('calFieldRepeat').value = 'weekly';
    doc.getElementById('calFieldRepeatDays').value = [];
    await drawer.refreshPreview();
    expect(note.classList.contains('hidden')).toBe(true);
    doc.getElementById('calFieldRepeat').value = 'none';
    await drawer.refreshPreview();
    expect(note.textContent).toBe('');
    expect(calls.filter((c) => c[0] === 'preview')).toHaveLength(0);
  });

  describe('review fixes', () => {
    // Wednesday's 9:00 occurrence was moved on its own to 11:00 (an exception row).
    const movedDetail = () => ({ ...weekly(), calendar_event_id: 'CAL-6', is_exception: true, occurrence_start: '2026-11-25T14:00:00.000Z',
      start_time: '2026-11-25T16:00:00.000Z', end_time: '2026-11-25T17:00:00.000Z' });
    const movedOccurrence = { start: '2026-11-25T16:00:00.000Z', end: '2026-11-25T17:00:00.000Z', occurrenceStart: '2026-11-25T14:00:00.000Z' };
    const lastUpdate = (calls) => calls.filter((c) => c[0] === 'update').pop();

    test('a title fix on a moved occurrence sends no times, so All events cannot move the series', async () => {
      const { w, drawer, calls } = setup({ detail: movedDetail() });
      await drawer.openEdit('CAL-6', movedOccurrence);
      await settle();
      w.document.getElementById('calFieldTitle').value = 'Weekly sync, fixed';
      drawer.save();
      await settle();
      answer(w, 'all');
      await settle();
      const body = lastUpdate(calls)[2];
      expect(body).toMatchObject({ title: 'Weekly sync, fixed', scope: 'all', occurrence_start: '2026-11-25T14:00:00.000Z' });
      for (const name of ['start_time', 'end_time', 'is_all_day', 'timezone']) expect(body).not.toHaveProperty(name);
    });

    test('control: a changed time is sent', async () => {
      const { w, drawer, calls } = setup({ detail: movedDetail() });
      await drawer.openEdit('CAL-6', movedOccurrence);
      await settle();
      w.document.getElementById('calFieldStartTime').value = '12:00';
      w.document.getElementById('calFieldEndTime').value = '13:00';
      drawer.save();
      await settle();
      answer(w, 'all');
      await settle();
      expect(lastUpdate(calls)[2]).toMatchObject({ start_time: '2026-11-25T17:00:00.000Z', end_time: '2026-11-25T18:00:00.000Z' });
    });

    test('with no occurrence known, This event never becomes All events: nothing is sent or deleted', async () => {
      const { w, drawer, calls } = setup({ detail: weekly() });
      await drawer.openEdit('CAL-5');
      await settle();
      drawer.save();
      await settle();
      answer(w, 'this');
      await settle();
      expect(calls).toHaveLength(0);
      expect(w.document.getElementById('calEditError').textContent).toMatch(/Open the event from the calendar/);
      w.document.getElementById('calDeleteBtn').dispatchEvent(new w.Event('click'));
      await settle();
      answer(w, 'this');
      await settle();
      expect(calls.filter((c) => c[0] === 'delete')).toHaveLength(0);
    });

    test('a This event delete sends that occurrence only', async () => {
      const { w, drawer, calls } = setup({ detail: weekly() });
      await drawer.openEdit('CAL-5', occurrence);
      await settle();
      w.document.getElementById('calDeleteBtn').dispatchEvent(new w.Event('click'));
      await settle();
      answer(w, 'this');
      await settle();
      expect(calls).toEqual([['delete', 'CAL-5', { scope: 'this', occurrence_start: occurrence.occurrenceStart }]]);
    });

    test('with no scope question on the page, nothing is sent (never All events)', async () => {
      const { w, drawer, calls } = setup({ detail: weekly(), withoutScopeModal: true });
      await drawer.openEdit('CAL-5', occurrence);
      await settle();
      drawer.save();
      await settle();
      expect(calls).toHaveLength(0);
      expect(w.document.getElementById('calEditError').textContent).not.toBe('');
      await drawer.move({ id: 'k', eventId: 'CAL-5', recurring: true, occurrenceStart: occurrence.occurrenceStart }, '2026-11-26T14:00:00.000Z', '2026-11-26T15:00:00.000Z');
      expect(calls).toHaveLength(0);
    });

    test('dragging a repeating event with no occurrence known sends nothing', async () => {
      const { drawer, calls, toasts } = setup({ detail: weekly() });
      await drawer.move({ id: 'k', eventId: 'CAL-5', recurring: true, occurrenceStart: null }, '2026-11-26T14:00:00.000Z', '2026-11-26T15:00:00.000Z');
      expect(calls).toHaveLength(0);
      expect(toasts.pop()[0]).toBe('error');
    });

    test('the conflict warning names the first clashing date and the date of each clash', async () => {
      const { w, drawer, confirms } = setup({ confirm: false, firstConflictDate: '2027-12-28' });
      drawer.openNew({ day: '2026-11-18', minutes: 9 * 60 });
      w.document.getElementById('calFieldTitle').value = 'Weekly';
      drawer.save();
      await settle();
      expect(confirms[0].html).toContain('first on Tue, Dec 28, 2027');
      expect(confirms[0].html).toContain('Ben: busy, Wed, Nov 18, 9:00 AM to 10:00 AM');
    });
  });

  test('a new event with a repeat sends it; a single event is never asked', async () => {
    const { w, drawer, calls } = setup({ confirm: true });
    drawer.openNew({ day: '2026-11-18', minutes: 9 * 60 });
    const doc = w.document;
    doc.getElementById('calFieldTitle').value = 'Standup';
    doc.getElementById('calFieldRepeat').value = 'weekdays';
    doc.getElementById('calFieldRepeatEnds').value = 'after';
    doc.getElementById('calFieldRepeatCount').value = '5';
    drawer.save();
    await settle();
    expect(doc.getElementById('calScopeModal').open).not.toBe(true);
    expect(calls.pop()[1]).toMatchObject({ title: 'Standup',
      repeat: { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], ends: { type: 'after', count: 5 } } });
  });

  test('Delete shows only when the server says the viewer may delete (review C6)', async () => {
    const asInvitee = setup({ detail: existing({ can_delete: false, calendar: { is_mine: false } }) });
    await asInvitee.drawer.openEdit('CAL-5');
    await settle();
    expect(asInvitee.w.document.getElementById('calDeleteBtn').classList.contains('hidden')).toBe(true);
    const asOwner = setup({ detail: existing({}) });
    await asOwner.drawer.openEdit('CAL-5');
    await settle();
    expect(asOwner.w.document.getElementById('calDeleteBtn').classList.contains('hidden')).toBe(false);
  });

  test('a clicked month date keeps its day after hours; the New button moves to the next work day', () => {
    const { w, drawer } = setup();
    w.LanaTime.nowDate = () => new Date('2026-11-21T23:30:00Z'); // Saturday 6:30 PM New York
    const value = (id) => w.document.getElementById(id).value;
    drawer.openNew({ day: '2026-11-21', minutes: null, explicitDay: true });
    expect([value('calFieldStartDate'), value('calFieldStartTime')]).toEqual(['2026-11-21', '09:00']);
    drawer.openNew({ day: '2026-11-21' });
    expect([value('calFieldStartDate'), value('calFieldStartTime')]).toEqual(['2026-11-23', '09:00']);
  });
});

