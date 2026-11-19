'use strict';

/**
 * calendar.html wiring (js/calendar/calendar-page.js) against a stubbed api:
 * the agenda is asked for the viewed week in the viewer's zone, coworkers go
 * in user_ids, busy blocks draw as Busy, the firm switch shows only to people
 * who can manage it, and a 403 explains the firm setting.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const VIEWER = '11111111-1111-1111-1111-111111111111';
const COWORKER = '22222222-2222-2222-2222-222222222222';

const opened = [];
afterEach(() => { opened.splice(0).forEach((w) => w.close()); });

const settle = async (w) => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => w.setTimeout(resolve, 0)); };

async function setup({ canManage = false, agendaError = null, editorCalls = null, heldDetails = null } = {}) {
  const page = read('calendar.html');
  const template = page.slice(page.indexOf('<template id="page-content">') + '<template id="page-content">'.length, page.indexOf('</template>'));
  const dom = new JSDOM(`<!doctype html><html><body><div id="lex-main-content">${template}</div></body></html>`, {
    url: 'http://localhost/calendar.html?view=week&date=2026-11-18', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  opened.push(w);
  const calls = [];
  w.eval('window.api = {};');
  w.api.user = { id: VIEWER, timezone: 'America/New_York' };
  w.api.updatePreferences = () => Promise.resolve({});
  w.api.get = (url) => {
    calls.push(['get', url]);
    if (url.startsWith('/api/v1/calendars/agenda')) {
      if (agendaError) return Promise.reject(agendaError);
      return Promise.resolve({ data: {
        time_zone: 'America/New_York', time_zone_source: 'user', complete: true,
        people: [{ user_id: VIEWER, name: 'Me', is_viewer: true }, { user_id: COWORKER, name: 'Sam' }],
        events: [
          { busy_only: false, id: 'EVENT-1', title: 'Client call', start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z',
            is_all_day: false, source: { kind: 'lana', label: 'LANA' }, editable: true, status: 'confirmed', user_ids: [VIEWER] },
          { busy_only: true, id: null, title: null, start: '2026-11-18T16:00:00Z', end: '2026-11-18T17:00:00Z', is_all_day: false, user_ids: [COWORKER] }
        ]
      } });
    }
    if (url === '/api/v1/calendars/people') {
      return Promise.resolve({ data: { members: [{ user_id: VIEWER, name: 'Me' }, { user_id: COWORKER, name: 'Sam' }],
        unlinked: [{ id: 'i1', name: 'Pat Intake', label: 'not linked to a LANA user' }], freebusy_visible: true, can_manage: canManage } });
    }
    // heldDetails: detail calls wait until the test resolves them, by id.
    if (heldDetails && url.startsWith('/api/v1/calendar-events/')) {
      const id = url.split('/').pop();
      return new Promise((resolve) => { heldDetails[id] = () => resolve({ data: { calendar_event_id: id, title: id, location: 'Room of ' + id, links: [] } }); });
    }
    if (url === '/api/v1/calendar-events/EVENT-1') {
      return Promise.resolve({ data: { calendar_event_id: 'EVENT-1', title: 'Client call', location: 'Conference room A',
        links: [
          { target_type: 'matter', target_id: 'm1', label: 'Rivera Estate Plan' },
          { target_type: 'workspace', target_id: 'w1', label: 'Rivera signing workspace' },
          { target_type: 'task', target_id: 't1', label: 'Prepare signing packet' }
        ] } });
    }
    if (url === '/api/v1/calendars/policy') return Promise.resolve({ data: { freebusy_visible_to_members: true } });
    return Promise.reject(new Error('unexpected ' + url));
  };
  w.api.patch = (url, body) => { calls.push(['patch', url, body]); return Promise.resolve({ data: body }); };
  [
    'js/time-utils.js', 'js/shared/safe-url.js', 'js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/lex.utils.js', 'js/lex/lex.forms.js',
    'js/lex/lex-nav.js',
    'js/lex/components/foundation/lex-btn.js', 'js/lex/components/foundation/lex-banner.js', 'js/lex/components/foundation/lex-badge.js',
    'js/lex/components/foundation/lex-drawer.js', 'js/lex/components/form/lex-select.js', 'js/lex/components/form/lex-segmented.js',
    'js/lex/components/form/lex-toggle.js', 'js/calendar/calendar-layout.js', 'js/lex/components/data/lex-calendar-grid.js',
    'js/shared/device-time-zone.js', 'js/services/calendar-api.service.js', 'js/calendar/calendar-page.model.js', 'js/calendar/calendar-event-form.model.js', 'js/calendar/calendar-page.js'
  ].forEach((rel) => {
    // Stand in for the event drawer before the page creates its editor.
    if (editorCalls && rel === 'js/calendar/calendar-page.js') {
      w.LanaCalendarEventDrawer = { create: () => ({ openNew: (slot) => editorCalls.push(slot), openEdit() {}, move() {} }) };
    }
    w.eval(read(rel));
  });
  await settle(w);
  return { w, calls, doc: w.document };
}

describe('calendar page', () => {
  test('asks for the viewed week in the viewer zone and draws events and busy blocks', async () => {
    const { calls, doc } = await setup();
    const agendaCall = calls.find((c) => c[1].startsWith('/api/v1/calendars/agenda'));
    expect(agendaCall[1]).toBe('/api/v1/calendars/agenda?from=' + encodeURIComponent('2026-11-15T05:00:00.000Z')
      + '&to=' + encodeURIComponent('2026-11-22T05:00:00.000Z'));
    expect(doc.getElementById('calRangeTitle').textContent).toBe('Nov 15 to 21, 2026');
    const titles = [...doc.querySelectorAll('#calGrid .lex-cal-event-title')].map((n) => n.textContent);
    expect(titles.sort()).toEqual(['Busy', 'Client call']);
    expect(doc.getElementById('calZoneNote').textContent).toBe('Times are shown in your time zone, America/New_York.');
  });

  test('chosen coworkers go in user_ids; unlinked people are listed but never sent', async () => {
    const { w, calls, doc } = await setup();
    const picker = doc.getElementById('calCoworkers');
    expect(picker.options.map((o) => o.label || (o.divider && '---'))).toEqual(['Sam', '---', 'Pat Intake']);
    expect(picker.options[2].disabled).toBe(true);
    picker.dispatchEvent(new w.CustomEvent('lex-change', { detail: { value: [COWORKER, 'unlinked:i1'] }, bubbles: true }));
    await settle(w);
    const last = calls.filter((c) => c[1].startsWith('/api/v1/calendars/agenda')).pop();
    expect(last[1]).toContain('&user_ids=' + encodeURIComponent(COWORKER));
    expect(last[1]).not.toContain('unlinked');
  });

  test('the firm switch shows only to people who can manage it, and saves', async () => {
    const member = await setup({ canManage: false });
    expect(member.doc.getElementById('calFirmSettings').classList.contains('hidden')).toBe(true);
    const admin = await setup({ canManage: true });
    expect(admin.doc.getElementById('calFirmSettings').classList.contains('hidden')).toBe(false);
    const toggle = admin.doc.getElementById('calFreeBusyToggle');
    toggle.dispatchEvent(new admin.w.CustomEvent('lex-change', { detail: { value: false }, bubbles: true }));
    await settle(admin.w);
    expect(admin.calls.find((c) => c[0] === 'patch')).toEqual(['patch', '/api/v1/calendars/policy', { freebusy_visible_to_members: false }]);
  });

  test('a 403 for coworkers explains the firm setting', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    const { w, doc } = await setup({ agendaError: err });
    doc.getElementById('calCoworkers').dispatchEvent(new w.CustomEvent('lex-change', { detail: { value: [COWORKER] }, bubbles: true }));
    await settle(w);
    expect(doc.getElementById('calNotice').textContent).toBe('Your firm shows each person only their own calendar, so coworkers cannot be added.');
  });

  test('the details panel reads a LANA event in full and shows its location; a busy block shows none', async () => {
    const { w, calls, doc } = await setup();
    const grid = doc.getElementById('calGrid');
    const item = (title) => grid.items.find((i) => i.title === title);
    grid.dispatchEvent(new w.CustomEvent('lex-calendar-open', { detail: { item: item('Client call') }, bubbles: true }));
    await settle(w);
    expect(calls.some((c) => c[1] === '/api/v1/calendar-events/EVENT-1')).toBe(true);
    expect(doc.getElementById('calDetailLocation').textContent).toBe('Conference room A');
    expect(doc.getElementById('calDetailLocationRow').classList.contains('hidden')).toBe(false);
    expect([...doc.querySelectorAll('#calDetailLinks li')].map((n) => n.textContent)).toEqual([
      'Matter: Rivera Estate Plan', 'Workspace: Rivera signing workspace', 'Task: Prepare signing packet'
    ]);

    const before = calls.length;
    grid.dispatchEvent(new w.CustomEvent('lex-calendar-open', { detail: { item: item('Busy') }, bubbles: true }));
    await settle(w);
    expect(calls.slice(before).some((c) => c[1].startsWith('/api/v1/calendar-events/'))).toBe(false);
    expect(doc.getElementById('calDetailLocation').textContent).toBe('');
    expect(doc.getElementById('calDetailLocationRow').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('calDetailLinksRow').classList.contains('hidden')).toBe(true);
  });

  test('a day clicked on the grid opens New event on that day (explicitDay); the New button does not', async () => {
    const editorCalls = [];
    const { w, doc } = await setup({ editorCalls });
    doc.getElementById('calGrid').dispatchEvent(new w.CustomEvent('lex-calendar-create', { detail: { day: '2026-11-21', minutes: null, allDay: false }, bubbles: true }));
    doc.getElementById('calNewBtn').click();
    expect(editorCalls[0]).toMatchObject({ day: '2026-11-21', explicitDay: true, minutes: null });
    expect(editorCalls[1].explicitDay).toBeUndefined();
  });

  test('a slow detail for an event no longer shown never replaces the open one', async () => {
    const heldDetails = {};
    const { w, doc } = await setup({ heldDetails });
    const grid = doc.getElementById('calGrid');
    const base = grid.items.find((i) => i.title === 'Client call');
    const open = (item) => grid.dispatchEvent(new w.CustomEvent('lex-calendar-open', { detail: { item }, bubbles: true }));
    open({ ...base, id: 'EVENT-A', title: 'A' });
    open({ ...base, id: 'EVENT-B', title: 'B' });
    heldDetails['EVENT-B']();
    await settle(w);
    expect(doc.getElementById('calDetailLocation').textContent).toBe('Room of EVENT-B');
    heldDetails['EVENT-A']();
    await settle(w);
    expect(doc.getElementById('calDetailLocation').textContent).toBe('Room of EVENT-B');
  });
});

