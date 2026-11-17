'use strict';

// The generic step settings renderer, driven by a FAKE step declaration that
// no client code knows: it renders the declared tab, keeps edits made in the
// form, runs declared operations only after their confirm and shows the
// step's summary, asks for a declared required reason before a row action,
// and shows a read-only form with no save when the server says can_edit is
// false. The client view code names no step or automation (scan).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src', 'automation');
const F = require(path.join(SRC, 'js/shared/step-settings-form.js'));

const declaration = {
  action_id: 'remind', label: 'Reminder rules',
  settings: {
    can_edit: true,
    fields: [
      { key: 'days', type: 'number', label: 'Days before' },
      { key: 'rules', type: 'group_list', label: 'Rules', item_label: 'name', add_label: 'Add rule', new_item: { name: '', when: {} },
        fields: [{ key: 'name', type: 'text', label: 'Name', required: true },
          { key: 'when', type: 'condition', label: 'When', fields: [{ value: 'tier', label: 'Tier', options: { source: 'tiers' } }] }] }
    ],
    values: { days: 3, rules: [{ name: 'Gold', when: { tier: 'gold' } }] }
  },
  operations: [{ key: 'send', label: 'Send now', confirm: true, confirm_title: 'Send reminders now?', confirm_text: 'They go out right away.', can_run: true }],
  views: [{ key: 'sent', label: 'Sent reminders', columns: [{ key: 'to', label: 'To' }],
    row_actions: [{ key: 'cancel', label: 'Cancel', reason: { required: true, label: 'Reason' }, confirm_title: 'Cancel this reminder?' }] }]
};

// The real shared date helpers (js/shared/utils.js) over the real Lex.Utils, in UTC.
function realUtils(window) {
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'time-utils.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'lex', 'lex.utils.js'), 'utf8'));
  window.localStorage.setItem('user', JSON.stringify({ timezone: 'UTC' }));
  const source = fs.readFileSync(path.join(SRC, 'js/shared/utils.js'), 'utf8').replace(/^export /gm, '');
  const context = { window, localStorage: window.localStorage, LanaTime: window.LanaTime, Intl, Date, JSON, Number, String, Object, module: { exports: {} } };
  vm.runInNewContext(`${source}\nmodule.exports = { formatDateOnly, formatTimeOnly };`, context);
  return context.module.exports;
}

function load(window) {
  const utils = realUtils(window);
  const source = fs.readFileSync(path.join(SRC, 'js/views/step-settings-view.js'), 'utf8');
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
  const context = {
    window, document: window.document, CSS: { escape: (v) => String(v) }, setTimeout, URLSearchParams, Promise, JSON, Object, Array, String, Boolean, Number, encodeURIComponent,
    emptyState: (message) => message, surface: ({ title, body }) => `<section><h3>${title}</h3>${body}</section>`,
    escapeHtml: escape, escapeAttribute: escape, formatDateOnly: utils.formatDateOnly, formatTimeOnly: utils.formatTimeOnly,
    module: { exports: {} }
  };
  const body = source.replace(/^import [\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  vm.runInNewContext(`${body}\nmodule.exports = { loadStepUi, stepTabs, renderStepTab, afterStepTabRender, stepModalSpecs, handleStepClick, handleStepInput };`, context);
  return context.module.exports;
}

let viewRows = [{ id: 'r-1', to: 'a', _actions: ['cancel'] }];
const saveConflict = { on: false };

function setup({ canEdit = true } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.AutomationStepSettings = F;
  const view = load(dom.window);
  const described = JSON.parse(JSON.stringify(declaration));
  described.settings.can_edit = canEdit;
  described.settings.version = '2026-11-16T09:00:00.000Z';
  const fetchJson = jest.fn(async (url, options = {}) => {
    if (url.endsWith('/steps')) return { steps: [JSON.parse(JSON.stringify(described))] };
    if (pageDelays[url]) return pageDelays[url]();
    if (url.includes('/operations/send/result')) return { status: 'done', summary: { title: 'Sent', lines: ['4 sent'] } };
    if (url.includes('/operations/send')) return { enqueued_at: '2026-11-16T10:00:00.000Z' };
    if (url.includes('/views/sent/rows/')) return { message: 'Cancelled.' };
    if (url.includes('/views/sent')) return { rows: viewRows, total: 30 };
    if (url.includes('/options')) return { options: [{ value: 'gold', label: 'Gold' }] };
    if (url.includes('/settings')) {
      if (saveConflict.on) { const error = new Error('This automation was changed since you opened it.'); error.status = 409; throw error; }
      return { step: { ...described, settings: { ...described.settings, values: JSON.parse(options.body).values } } };
    }
    return {};
  });
  const context = {
    state: { libraryDetail: { automationId: 'a-1' } },
    fetchJson, authHeaders: () => ({}), flash: jest.fn(), renderCurrentView: jest.fn()
  };
  const pageDelays = {};
  const host = dom.window.document.getElementById('host');
  const show = () => { host.innerHTML = view.renderStepTab(context, 'remind'); return host; };
  const click = async (selector) => view.handleStepClick(context, { target: host.querySelector(selector) || dom.window.document.querySelector(selector) });
  return { dom, view, context, fetchJson, host, show, click, described, pageDelays };
}

beforeEach(() => { jest.useFakeTimers(); saveConflict.on = false; viewRows = [{ id: 'r-1', to: 'a', _actions: ['cancel'] }]; });
afterEach(() => jest.useRealTimers());

test('renders the declared tab from the declaration alone', async () => {
  const { view, context, show } = setup();
  await view.loadStepUi(context);
  expect(view.stepTabs(context)).toEqual([{ id: 'step:remind', label: 'Reminder rules' }]);
  const html = show().innerHTML;
  for (const text of ['Days before', 'Rules', 'Gold', 'When', 'is one of', 'Send now', 'Sent reminders', 'Save settings', 'Add rule']) expect(html).toContain(text);
});

test('edits made in the form survive a re-render and are what is saved', async () => {
  const { view, context, show, click, fetchJson, host } = setup();
  await view.loadStepUi(context);
  show();
  const name = host.querySelector('[data-ss-path=\'["rules",0,"name"]\']');
  name.value = 'Platinum';
  await view.handleStepInput(context, { type: 'input', target: name });
  const days = host.querySelector('[data-ss-path=\'["days"]\']');
  days.value = '7';
  await view.handleStepInput(context, { type: 'input', target: days });
  expect(show().innerHTML).toContain('Platinum');
  await click('[data-ss-save]');
  const saved = fetchJson.mock.calls.find(([url]) => url.endsWith('/settings'));
  expect(JSON.parse(saved[1].body)).toEqual({ values: { days: 7, rules: [{ name: 'Platinum', when: { tier: 'gold' } }] }, version: '2026-11-16T09:00:00.000Z' });
});

test('a declared operation runs only from its confirm, then shows the step\'s summary', async () => {
  const { view, context, show, click, fetchJson } = setup();
  await view.loadStepUi(context);
  show();
  await click('[data-ss-op="send"]');
  expect(fetchJson.mock.calls.some(([url]) => url.includes('/operations/'))).toBe(false);
  const spec = view.stepModalSpecs(context).stepConfirm;
  expect(spec.heading).toBe('Send reminders now?');
  const host = show();
  host.insertAdjacentHTML('beforeend', spec.footer);
  const run = click('[data-ss-op-confirm="send"]');
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(2600);
  await run;
  expect(fetchJson.mock.calls.find(([url]) => url.includes('/operations/send/result'))[0]).toContain('enqueued_at=2026-11-16T10%3A00%3A00.000Z');
  expect(show().innerHTML).toContain('4 sent');
});

test('a row action with a required reason is not sent without one (control: with one it is)', async () => {
  const { view, context, show, click, fetchJson, dom } = setup();
  await view.loadStepUi(context);
  const host = show();
  host.insertAdjacentHTML('beforeend', '<lex-btn data-ss-step="remind" data-ss-view-action="sent" data-ss-row="r-1" data-ss-action="cancel"></lex-btn>');
  await click('[data-ss-view-action]');
  host.insertAdjacentHTML('beforeend', view.stepModalSpecs(context).stepRowAction.footer);
  await click('[data-ss-action-confirm]');
  expect(fetchJson.mock.calls.some(([url]) => url.includes('/rows/'))).toBe(false);
  expect(view.stepModalSpecs(context).stepRowAction.body).toContain('Reason is required.');

  host.insertAdjacentHTML('beforeend', '<textarea data-ss-reason>Wrong person</textarea>');
  await view.handleStepClick(context, { target: host.querySelector('[data-ss-action-confirm]') });
  const sent = fetchJson.mock.calls.find(([url]) => url.includes('/rows/'));
  expect(sent[0]).toContain('/views/sent/rows/r-1/actions/cancel');
  expect(JSON.parse(sent[1].body)).toEqual({ reason: 'Wrong person' });
  void dom;
});

test('when the server says can_edit is false the form is read-only with no save', async () => {
  const { view, context, show } = setup({ canEdit: false });
  await view.loadStepUi(context);
  const html = show().innerHTML;
  expect(html).not.toContain('Save settings');
  expect(html).not.toContain('Add rule');
  expect(html).toMatch(/data-ss-path="\[&quot;days&quot;\]"[^>]*disabled/);
});

test('the automation views name no step or automation', () => {
  const files = ['js/views/step-settings-view.js', 'js/views/library-detail.js', 'js/shared/step-settings-form.js', 'app.js'];
  const banned = /matter\.createFromSourceRecords|createFromSourceRecords|matter-intake|matter_intake|opportunity-won|resolve-matters|matter_types|Matter intake/i;
  for (const file of files) {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    expect({ file, found: (source.match(banned) || [null])[0] }).toEqual({ file, found: null });
  }
});

test('a reload of the automation keeps unsaved edits and fetches the open step\'s lists again', async () => {
  const { view, context, show, fetchJson, host } = setup();
  await view.loadStepUi(context);
  show();
  const days = host.querySelector('[data-ss-path=\'["days"]\']');
  days.value = '9';
  await view.handleStepInput(context, { type: 'input', target: days });
  const before = fetchJson.mock.calls.length;
  await view.loadStepUi(context);
  expect(show().querySelector('[data-ss-path=\'["days"]\']').getAttribute('value')).toBe('9');
  const again = fetchJson.mock.calls.slice(before).map(([url]) => url);
  expect(again.some((url) => url.includes('/options?'))).toBe(true);
  expect(again.some((url) => url.includes('/views/sent?'))).toBe(true);
});

test('view tables page on the server and escape every cell and row action', async () => {
  viewRows = [{ id: 'r-"1', to: '<img src=x onerror=alert(1)>', _actions: ['cancel'] }];
  const { view, context, show, dom } = setup();
  await view.loadStepUi(context);
  show();
  // A second load refreshes the open step's views, as opening the tab does.
  await view.loadStepUi(context);
  const table = dom.window.document.createElement('lex-table');
  table.setAttribute('data-ss-table', '');
  table.dataset.ssStep = 'remind';
  table.dataset.ssView = 'sent';
  const calls = {};
  table.setCellRenderers = (renderers) => { calls.renderers = renderers; };
  table.setServerData = (rows, page) => { calls.rows = rows; calls.page = page; };
  dom.window.document.body.appendChild(table);
  view.afterStepTabRender(context, 'remind');
  expect(calls.page).toEqual({ page: 1, limit: 20, total: 30, totalPages: 2 });
  const cell = calls.renderers.to(viewRows[0].to, viewRows[0]);
  expect(cell).not.toContain('<img');
  expect(cell).toContain('&lt;img');
  const actions = calls.renderers.actions(undefined, viewRows[0]);
  expect(actions).toContain('data-ss-row="r-&quot;1"');
  expect(actions).not.toContain('r-"1');
});

test('the views table uses lex-table\'s actions column and keeps declared labels whole', async () => {
  const { view, context, show } = setup();
  context.state.libraryDetail.stepUi = undefined;
  await view.loadStepUi(context);
  context.state.libraryDetail.stepUi.steps[0].views[0].columns[0].label = 'To, or cc';
  const html = show().innerHTML;
  expect(html).toMatch(/columns="to,actions"/);
  expect(html).toMatch(/labels="To  or cc,Actions"/);
  expect(html).toContain('server-paging');
});

test('a failed result is shown as an error', async () => {
  const { view, context, show } = setup();
  await view.loadStepUi(context);
  context.state.libraryDetail.stepUi.byStep.remind.op = { key: 'send', label: 'Send now', status: 'failed', summary: { title: 'The run did not finish', lines: ['Refused'] } };
  const panel = show().querySelector('[data-ss-run-status]');
  expect(panel.dataset.ssRunStatus).toBe('failed');
  expect(panel.classList.contains('ss-run-panel--error')).toBe(true);
});

test('view cells show the declared value labels and keep dates on one line', async () => {
  viewRows = [{ id: 'r-1', to: 'a', state: 'sent', sent_at: '2026-11-16T06:02:00Z', _actions: [] }];
  const { view, context, show, dom, described } = setup();
  described.views[0].columns = [{ key: 'state', label: 'State', labels: { sent: 'Sent <b>' } }, { key: 'to', label: 'To' }, { key: 'sent_at', label: 'Sent', format: 'date' }];
  await view.loadStepUi(context);
  show();
  await view.loadStepUi(context);
  const table = dom.window.document.createElement('lex-table');
  table.setAttribute('data-ss-table', '');
  table.dataset.ssStep = 'remind';
  table.dataset.ssView = 'sent';
  const calls = {};
  table.setCellRenderers = (renderers) => { calls.renderers = renderers; };
  table.setServerData = () => {};
  dom.window.document.body.appendChild(table);
  view.afterStepTabRender(context, 'remind');
  expect(calls.renderers.state('sent', viewRows[0])).toBe('Sent &lt;b&gt;');
  expect(calls.renderers.state('other', viewRows[0])).toBe('other');
  expect(calls.renderers.to('a', viewRows[0])).toBe('a');
  expect(calls.renderers.sent_at('2026-11-16T06:02:00Z', viewRows[0])).toBe('<span class="ss-date">11/16/2026</span><span class="ss-time">6:02 AM</span>'); // real Lex.Utils formatters, in UTC
});

test('a reload keeps a dirty form\'s own version, so its save is checked against what the person opened', async () => {
  const { view, context, show, host, fetchJson, described, click } = setup();
  await view.loadStepUi(context);
  show();
  const days = host.querySelector('[data-ss-path=\'["days"]\']');
  days.value = '8';
  await view.handleStepInput(context, { type: 'input', target: days });
  described.settings.version = 'newer-elsewhere';
  described.settings.values.days = 4;
  await view.loadStepUi(context);
  show();
  await click('[data-ss-save]');
  const saved = fetchJson.mock.calls.filter(([url]) => url.endsWith('/settings')).pop();
  expect(JSON.parse(saved[1].body)).toMatchObject({ values: { days: 8 }, version: '2026-11-16T09:00:00.000Z' });
});

test('an untouched form takes the reloaded values and version', async () => {
  const { view, context, show, fetchJson, described, click } = setup();
  await view.loadStepUi(context);
  described.settings.version = 'v2';
  described.settings.values.days = 4;
  await view.loadStepUi(context);
  show();
  await click('[data-ss-save]');
  const saved = fetchJson.mock.calls.filter(([url]) => url.endsWith('/settings')).pop();
  expect(JSON.parse(saved[1].body)).toMatchObject({ values: { days: 4 }, version: 'v2' });
});

test('a page that answers after a newer page request is dropped', async () => {
  const { view, context, show, dom, pageDelays } = setup();
  await view.loadStepUi(context);
  show();
  const table = dom.window.document.createElement('lex-table');
  table.setAttribute('data-ss-table', '');
  table.dataset.ssStep = 'remind';
  table.dataset.ssView = 'sent';
  const landed = [];
  table.setCellRenderers = () => {};
  table.setServerData = (rows, page) => landed.push(page.page);
  dom.window.document.body.appendChild(table);
  await view.loadStepUi(context);
  view.afterStepTabRender(context, 'remind');
  landed.length = 0;
  let releaseSlow;
  pageDelays['/api/v1/automations/a-1/steps/remind/views/sent?limit=20&offset=20'] = () => new Promise((resolve) => { releaseSlow = () => resolve({ rows: [{ id: 'p2' }], total: 60 }); });
  table.dispatchEvent(new dom.window.CustomEvent('lex-query-change', { detail: { page: 2, limit: 20 } }));
  table.dispatchEvent(new dom.window.CustomEvent('lex-query-change', { detail: { page: 3, limit: 20 } }));
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  releaseSlow();
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  expect(landed).toEqual([3]);
  expect(context.state.libraryDetail.stepUi.byStep.remind.views.sent.page).toBe(3);
});

test('a save refused because someone else changed the settings offers Load latest, which takes their settings and version (no repeat 409)', async () => {
  const { view, context, show, host, fetchJson, described, click } = setup();
  await view.loadStepUi(context);
  show();
  const days = host.querySelector('[data-ss-path=\'["days"]\']');
  days.value = '8';
  await view.handleStepInput(context, { type: 'input', target: days });
  described.settings.version = 'theirs';
  described.settings.values.days = 5;
  saveConflict.on = true;
  await click('[data-ss-save]');
  const html = show().innerHTML;
  expect(html).toContain('Someone else changed these settings');
  expect(html).toContain('data-ss-load-latest');
  saveConflict.on = false;
  await click('[data-ss-load-latest]');
  expect(show().querySelector('[data-ss-path=\'["days"]\']').getAttribute('value')).toBe('5');
  expect(show().innerHTML).not.toContain('data-ss-load-latest');
  await click('[data-ss-save]');
  const saved = fetchJson.mock.calls.filter(([url]) => url.endsWith('/settings')).pop();
  expect(JSON.parse(saved[1].body).version).toBe('theirs');
});

test('the shared date and time helpers both give empty text for a value that is not a date', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const utils = realUtils(dom.window);
  expect([utils.formatDateOnly('not a date'), utils.formatTimeOnly('not a date')]).toEqual(['', '']);
  expect([utils.formatDateOnly('2026-11-16T06:02:00Z'), utils.formatTimeOnly('2026-11-16T06:02:00Z')]).toEqual(['11/16/2026', '6:02 AM']);
});
