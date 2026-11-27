'use strict';

/**
 * The record side panel (js/shared/report-object-panel.js) in JSDOM with a
 * stub Lex.Drawer: it opens on the side and can expand (the drawer's own
 * expand), loads GET /api/v1/report-objects/:object/:id with the page
 * dates, renders the one shape for every object, links people and deals to
 * each other with a Back stack, never renders secrets, and falls back to
 * the row's fields with a calm message when the record cannot load.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const samples = require(path.join(__dirname, '../fixtures/report-objects/samples.json'));

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };

function boot(getReportObject) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  const opened = [];
  w.Lex = { Drawer: { open(options) {
    const drawer = w.document.createElement('div');
    drawer.className = 'stub-drawer';
    drawer.heading = options.heading;
    drawer.options = options;
    Object.defineProperty(drawer, 'contentRoot', { get() { return drawer; } });
    w.document.body.appendChild(drawer);
    opened.push(drawer);
    return drawer;
  } } };
  w.api = { getReportObject: getReportObject || jest.fn((object) => Promise.resolve({ data: samples[object] })) };
  w.eval(read('js/shared/report-objects.js'));
  w.eval(read('js/shared/data-fixes.js'));
  w.eval(read('js/shared/report-object-panel.js'));
  return { w, opened };
}

test('opens a wide, expandable drawer and loads the object for the page dates', async () => {
  const { w, opened } = boot();
  w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, { period: { start: '2026-11-01', end: '2026-11-30' } });
  await settle();
  expect(opened).toHaveLength(1);
  // A heading from the start, so lex-drawer draws its header (close and expand).
  expect(opened[0].options).toMatchObject({ width: 'lg', expandable: true, heading: 'Deal' });
  expect(w.api.getReportObject).toHaveBeenCalledWith('deal', 'd-1', { start: '2026-11-01', end: '2026-11-30' });
  const panel = opened[0];
  expect(panel.heading).toBe('Smith Estate Plan');
  expect(panel.textContent).toContain('$4,500');
  expect(panel.querySelectorAll('.rp-timeline li')).toHaveLength(3);
  expect(panel.querySelector('.rp-owner').textContent).toBe('Owner');
});

test('people and deals link to each other in the same panel, with Back', async () => {
  const { w, opened } = boot();
  w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, {});
  await settle();
  const panel = opened[0];
  panel.querySelector('.rp-contributors [data-record-ref]').click();
  await settle();
  expect(opened).toHaveLength(1);
  expect(panel.heading).toBe('Avery Stone');
  expect(panel.textContent).toContain('Invited, not signed in yet');
  expect(panel.textContent).toContain('Matched by email');
  expect(panel.innerHTML).not.toContain('never-show');
  expect(panel.textContent).not.toContain('Password hash');
  panel.querySelector('[data-rp-back]').click();
  await settle();
  expect(panel.heading).toBe('Smith Estate Plan');
  expect(panel.querySelector('[data-rp-back]')).toBeNull();
});

test('a record that cannot load says so calmly and shows the row\'s own fields', async () => {
  const { w, opened } = boot(jest.fn(() => Promise.reject(Object.assign(new Error('x'), { status: 404 }))));
  w.LanaRecordPanel.open({ object: 'deal', id: 'gone' }, { row: { client_name: 'Jordan Smith', amount: 4500, api_token: 'nope' } });
  await settle();
  const panel = opened[0];
  expect(panel.querySelector('.rp-error').textContent).toBe('Not found, or you don\'t have access to this record.');
  expect(panel.textContent).toContain('Jordan Smith');
  expect(panel.textContent).not.toContain('nope');
});

test('everything clickable is a real button, so the keyboard works; closing resets the stack', async () => {
  const { w, opened } = boot();
  w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, {});
  await settle();
  const panel = opened[0];
  panel.querySelectorAll('[data-record-ref]').forEach((el) => expect(el.tagName).toBe('BUTTON'));
  panel.dispatchEvent(new w.CustomEvent('lex-close'));
  w.LanaRecordPanel.open({ object: 'contact', id: 'c-1' }, {});
  await settle();
  expect(opened).toHaveLength(2);
  expect(opened[1].querySelector('[data-rp-back]')).toBeNull();
});

test('rows wire up: a click or Enter on [data-record-ref] anywhere opens the panel', async () => {
  const { w, opened } = boot();
  w.document.body.insertAdjacentHTML('beforeend', '<table><tr data-record-ref="' + 'person|p-1|' + '" tabindex="0"><td>Avery</td></tr></table>');
  w.LanaRecordPanel.bindRows(w.document.body, () => ({ start: '2026-11-01', end: '2026-11-30' }));
  w.document.querySelector('tr').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  expect(opened).toHaveLength(1);
  expect(w.api.getReportObject).toHaveBeenCalledWith('person', 'p-1', { start: '2026-11-01', end: '2026-11-30' });
});

test('a deal opened from a row with fix hints shows "Fix in LANA" when the person may correct', async () => {
  const { w, opened } = boot();
  const row = { record_id: 'd-1', edit: { record_id: 'd-1', standard_key: 'amount', current_value: null, editable: true }, outcome_edit: { record_id: 'd-1', editable: true, allowed_values: ['won', 'lost'] } };
  w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, { row, permissions: { can_correct: true } });
  await settle();
  expect(opened[0].querySelector('.rp-fix')).not.toBeNull();
  expect(opened[0].querySelector('[data-dfix-action="amount"]')).not.toBeNull();
  const { w: w2, opened: opened2 } = boot();
  w2.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, { row, permissions: { can_correct: false } });
  await settle();
  expect(opened2[0].querySelector('.rp-fix')).toBeNull();
});

test('final contract: activity dates and note, null activity, timeline details and people, contributor pills, owner and follower', async () => {
  const { w, opened } = boot();
  w.LanaRecordPanel.open({ object: 'person', id: 'p-1' }, {});
  await settle();
  const person = opened[0];
  expect(person.textContent).toContain('Activity for Nov 1, 2026 to Nov 30, 2026');
  expect(person.textContent).toContain('Not available yet');
  expect(person.querySelector('.rp-note').textContent).toBe('Messages show once message history has synced.');
  expect(person.textContent).toContain('Leadly (Main office)');
  expect(person.textContent).toContain('avery@leadly.example');
  w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, {});
  await settle();
  const deal = opened[0];
  expect(deal.querySelector('.rp-detail').textContent).toBe('Referred by a past client');
  expect(deal.textContent).toContain('Not recorded');
  const items = deal.querySelectorAll('.rp-timeline li');
  expect(items[1].querySelectorAll('[data-record-ref]').length).toBe(3);
  expect(deal.querySelectorAll('.rp-pill')).toHaveLength(3);
  expect(deal.querySelector('.rp-follower').textContent).toBe('Follower');
});

describe('long deal timelines', () => {
  const event = (i, extra) => Object.assign({ occurred_at: new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString(), label: 'Event ' + i, actor: null, actor_kind: 'team', actor_label: 'Avery',
    refs: [{ object: 'message', id: 'm-' + i }, { object: 'deal', id: 'd-1' }] }, extra || {});
  const first = { object: 'deal', id: 'd-1', title: 'Long Deal', facts: [], timeline_total: 30, timeline_note: 'Some messages came before the deal was created.',
    timeline: Array.from({ length: 25 }, (_, i) => event(29 - i)) };
  const more = { object: 'deal', id: 'd-1', title: 'Long Deal', facts: [], timeline_total: 30,
    timeline: Array.from({ length: 5 }, (_, i) => event(4 - i, i >= 3 ? { before_deal: true } : {})) };

  test('newest 10 first, then "Show all N" pages with timeline_offset', async () => {
    const getReportObject = jest.fn((object, id, period, options) => Promise.resolve({ data: options && options.timeline_offset ? more : first }));
    const { w, opened } = boot(getReportObject);
    w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, { period: { start: '2026-10-01', end: '2026-10-31' } });
    await settle();
    const panel = opened[0];
    expect(panel.querySelector('.rp-note').textContent).toBe('Some messages came before the deal was created.');
    expect(panel.querySelectorAll('.rp-timeline li.rp-event-row')).toHaveLength(10);
    expect(panel.querySelector('.rp-timeline li .rp-event').textContent).toBe('Event 29');
    const show = panel.querySelector('[data-rp-more]');
    expect(show.textContent).toBe('Show all 30');
    show.click();
    await settle();
    expect(getReportObject).toHaveBeenLastCalledWith('deal', 'd-1', { start: '2026-10-01', end: '2026-10-31' }, { timeline_offset: 25, timeline_limit: 50 });
    expect(panel.querySelectorAll('.rp-timeline li.rp-event-row')).toHaveLength(30);
    expect(panel.querySelector('.rp-divider').textContent).toBe('Before this deal was created');
    expect(panel.querySelector('[data-rp-more]')).toBeNull();
  });

  test('the event label is the link to its message; the deal itself is not listed', async () => {
    const { w, opened } = boot(jest.fn(() => Promise.resolve({ data: first })));
    w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, {});
    await settle();
    const row = opened[0].querySelector('.rp-timeline li.rp-event-row');
    expect(row.querySelector('.rp-event').getAttribute('data-record-ref')).toBe('message|m-29|');
    expect(row.textContent).not.toContain('Deal');
  });
});

test('api.getReportObject sends timeline paging options', () => {
  const src = read('js/api.js');
  expect(src).toContain("if (options && options.timeline_limit !== undefined) query.set('timeline_limit', String(options.timeline_limit));");
  expect(src).toContain("if (options && options.timeline_offset !== undefined) query.set('timeline_offset', String(options.timeline_offset));");
});

describe('deal timeline filters', () => {
  const ev = (i, kind, actorKind) => ({ occurred_at: new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString(), label: 'Event ' + i, event_kind: kind, actor: null, actor_kind: actorKind, actor_label: 'X', refs: [] });
  const deal = { object: 'deal', id: 'd-1', title: 'Deal', facts: [], timeline_total: 3,
    timeline: [ev(3, 'meeting_held', 'team'), ev(2, 'message_received', 'client'), ev(1, 'meeting_held', 'team')] };

  test('chips for the event kinds present and for team or client, wired to the timeline params', async () => {
    const getReportObject = jest.fn(() => Promise.resolve({ data: deal }));
    const { w, opened } = boot(getReportObject);
    w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, { period: { start: '2026-10-01', end: '2026-10-31' } });
    await settle();
    const panel = opened[0];
    const chips = Array.from(panel.querySelectorAll('.rp-chip')).map((c) => c.textContent);
    expect(chips).toEqual(['All', 'Meeting held', 'Message received', 'By team', 'By client']);
    panel.querySelector('[data-rp-kind="meeting_held"]').click();
    await settle();
    expect(getReportObject).toHaveBeenLastCalledWith('deal', 'd-1', { start: '2026-10-01', end: '2026-10-31' }, { timeline_event_kind: 'meeting_held', timeline_limit: 50 });
    expect(panel.querySelector('[data-rp-kind="meeting_held"]').getAttribute('aria-pressed')).toBe('true');
    panel.querySelector('[data-rp-actor="client"]').click();
    await settle();
    expect(getReportObject).toHaveBeenLastCalledWith('deal', 'd-1', { start: '2026-10-01', end: '2026-10-31' },
      { timeline_event_kind: 'meeting_held', timeline_actor: 'client', timeline_limit: 50 });
    panel.querySelector('[data-rp-kind=""]').click();
    await settle();
    expect(getReportObject).toHaveBeenLastCalledWith('deal', 'd-1', { start: '2026-10-01', end: '2026-10-31' }, { timeline_actor: 'client', timeline_limit: 50 });
  });
});

test('api.getReportObject sends the timeline filters', () => {
  const src = read('js/api.js');
  expect(src).toContain("if (options && options.timeline_event_kind) query.set('timeline_event_kind', String(options.timeline_event_kind));");
  expect(src).toContain("if (options && options.timeline_actor) query.set('timeline_actor', String(options.timeline_actor));");
});

test('a filter that matches nothing keeps its chips and says so', async () => {
  const deal = { object: 'deal', id: 'd-1', title: 'Deal', facts: [], timeline_total: 1,
    timeline: [{ occurred_at: '2026-10-01T00:00:00Z', label: 'Met', event_kind: 'meeting_held', actor_kind: 'team', actor_label: 'X', refs: [] }] };
  const getReportObject = jest.fn((o, i, p, opts) => Promise.resolve({ data: opts && opts.timeline_actor ? Object.assign({}, deal, { timeline: [], timeline_total: 0 }) : deal }));
  const { w, opened } = boot(getReportObject);
  w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, {});
  await settle();
  opened[0].querySelector('[data-rp-actor="client"]').click();
  await settle();
  expect(opened[0].querySelector('.rp-chips')).not.toBeNull();
  expect(opened[0].textContent).toContain('No events match this filter.');
});
