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

const IDS = ['calEditDrawer', 'calEventForm', 'calFieldTitle', 'calFieldAllDay', 'calFieldStartDate', 'calFieldStartTime', 'calFieldEndDate',
  'calFieldEndTime', 'calFieldZone', 'calFieldAttendees', 'calFieldVisibility', 'calFieldDescription', 'calLinkList', 'calLinkEmpty',
  'calLinkType', 'calLinkTarget', 'calLinkAddBtn', 'calEditError', 'calDeleteBtn', 'calRecurringNote'];

function setup({ confirm = true, detail = null } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${IDS.map((id) => `<div id="${id}"></div>`).join('')}</body>`, {
    runScripts: 'outside-only', virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  w.eval(read('js/time-utils.js'));
  w.eval(read('js/calendar/calendar-event-form.model.js'));
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
    data: { code: 'CALENDAR_CONFLICT', conflicts: [{ user_id: 'u2', name: 'Ben', private: true, title: null, start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z' }] }
  });
  const calls = [];
  const calendar = {
    people: () => Promise.resolve({ members: [] }),
    createEvent: (body) => { calls.push(['create', body]); return calls.length === 1 ? Promise.reject(conflict) : Promise.resolve({ calendar_event_id: 'CAL-9' }); },
    updateEvent: (id, body) => { calls.push(['update', id, body]); return calls.length === 1 ? Promise.reject(conflict) : Promise.resolve({ calendar_event_id: id }); },
    addLink: () => Promise.resolve({ links: [] }),
    getEvent: () => Promise.resolve(detail)
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

  test('a repeating event: time fields locked, a save sends only the details, and a drag saves nothing (review C5)', async () => {
    const { w, drawer, calls } = setup({ detail: existing({ recurrence_rule: 'FREQ=WEEKLY' }) });
    await drawer.openEdit('CAL-5');
    await settle();
    const doc = w.document;
    expect(doc.getElementById('calFieldStartTime').disabled).toBe(true);
    expect(doc.getElementById('calRecurringNote').classList.contains('hidden')).toBe(false);
    drawer.save();
    await settle();
    const body = calls.filter((c) => c[0] === 'update').pop()[2];
    expect(body).not.toHaveProperty('start_time');
    expect(body).not.toHaveProperty('end_time');
    expect(body).toMatchObject({ title: 'Weekly sync' });
    const before = calls.length;
    await drawer.move({ id: 'CAL-5', recurring: true }, '2026-11-19T14:00:00.000Z', '2026-11-19T15:00:00.000Z');
    expect(calls).toHaveLength(before);
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
});
