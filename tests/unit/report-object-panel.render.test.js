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
  w.eval(read('js/shared/report-object-panel.js'));
  return { w, opened };
}

test('opens a wide, expandable drawer and loads the object for the page dates', async () => {
  const { w, opened } = boot();
  w.LanaRecordPanel.open({ object: 'deal', id: 'd-1' }, { period: { start: '2026-11-01', end: '2026-11-30' } });
  await settle();
  expect(opened).toHaveLength(1);
  expect(opened[0].options).toMatchObject({ width: 'lg', expandable: true });
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
