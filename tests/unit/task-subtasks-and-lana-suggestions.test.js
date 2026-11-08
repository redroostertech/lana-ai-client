/**
 * Task subtasks and LANA suggestions in the shared task drawer, and the LANA
 * button variant.
 *
 * Bug (2026-11-07): a task created with LANA subtasks showed "Subtasks 0"
 * in the matter's task drawer. The subtasks were saved, but the drawer never
 * asked the server for them, and adding or checking off a subtask there was
 * kept in memory only. Suggestions now arrive in the background, so the
 * drawer also shows them for review.
 *
 * The drawer is a browser IIFE; per repo convention it runs in a vm with the
 * minimal DOM it touches, driven through its real document listeners.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const DRAWER_PATH = path.join(__dirname, '../../src/js/components/task-detail-drawer.js');
const drawerSource = fs.readFileSync(DRAWER_PATH, 'utf8');

const TASK_UUID = '11111111-2222-4333-8444-555555555555';
const SUB_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SUB_B = 'aaaaaaaa-0000-4000-8000-000000000002';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function loadDrawer(api) {
  const listeners = {};
  const inputs = {};
  const contentStub = {
    innerHTML: '',
    querySelector: (selector) => {
      const m = /\[data-shared-task-input="([^"]+)"\]/.exec(selector);
      return m ? inputs[m[1]] || null : null;
    }
  };
  const registry = { sharedTaskDetailsContent: contentStub };
  const documentStub = {
    getElementById: (id) => registry[id] || null,
    createElement: () => ({ setAttribute() {} }),
    body: { appendChild: (el) => { if (el.id) registry[el.id] = el; } },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }
  };
  const Lex = { Auth: { user: { id: 'user-1', name: 'Test User' } }, Toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } };
  const windowStub = { Lex, api };
  vm.runInNewContext(drawerSource, {
    window: windowStub,
    document: documentStub,
    requestAnimationFrame: () => {},
    Lex,
    api,
    LanaTaskPriority: require('../../src/js/shared/task-priority.js'),
    LanaTime: { nowMs: () => 1, nowIso: () => '2026-11-07T00:00:00.000Z' },
    console: { warn() {}, log() {}, error() {} },
    setTimeout
  }, { filename: DRAWER_PATH });

  // Fire a document listener as if `attrs` were on the event target.
  function fire(type, attrs, extra) {
    const target = Object.assign({
      closest(selector) {
        if (selector === '#sharedTaskDetailsModal') return {};
        const m = /^\[([a-z-]+)\]$/.exec(selector);
        return m && Object.prototype.hasOwnProperty.call(attrs, m[1]) ? this : null;
      },
      getAttribute: (name) => attrs[name]
    }, extra || {});
    (listeners[type] || []).forEach((fn) => fn({ target, preventDefault() {}, stopPropagation() {} }));
  }

  return { drawer: windowStub.LanaTaskDetails, html: () => contentStub.innerHTML, fire, Lex, inputs };
}

function boardTask(overrides) {
  return Object.assign({ id: TASK_UUID, title: 'Review Employee Benefit Statement', matter_id: 'MATT-00017', source: 'lana', status: 'pending' }, overrides || {});
}

function apiStub(overrides) {
  return Object.assign({
    getResourceComments: jest.fn(async () => ({ data: { comments: [] } })),
    listSubtasks: jest.fn(async () => ({
      data: [
        { id: SUB_A, name: 'Verify the statement against the contract', status: 'pending' },
        { id: SUB_B, name: 'Identify discrepancies', status: 'completed' }
      ],
      metadata: { page: 1, limit: 100, total: 2, totalPages: 1 }
    })),
    updateSubtask: jest.fn(async () => ({ data: {} })),
    createSubtask: jest.fn(async (body) => ({ data: { id: 'aaaaaaaa-0000-4000-8000-000000000009', title: body.name, status: 'pending' } })),
    reviewTaskSuggestions: jest.fn()
  }, overrides || {});
}

describe('task drawer subtasks', () => {
  test('opening a LANA task loads its subtasks from the server, in LANA order', async () => {
    const api = apiStub();
    const { drawer, html } = loadDrawer(api);

    drawer.open(boardTask());
    await flush();

    expect(api.listSubtasks).toHaveBeenCalledWith({ parent_task_id: TASK_UUID, sort: 'order_index', order: 'asc', limit: 100 });
    expect(html()).toContain('Verify the statement against the contract');
    expect(html()).toContain('Identify discrepancies');
    expect(html()).toContain('<strong>1/2</strong>');
    expect(html()).not.toContain('No subtasks yet.');
  });

  test.each([
    ['a connector task', { source: 'connector' }],
    ['a task with no server id', { id: 'draft-task' }]
  ])('%s is not fetched (control)', async (_label, overrides) => {
    const api = apiStub();
    const { drawer, html } = loadDrawer(api);

    drawer.open(boardTask(overrides));
    await flush();

    expect(api.listSubtasks).not.toHaveBeenCalled();
    expect(html()).toContain('No subtasks yet.');
  });

  test('checking off a subtask saves it as completed; a failed save puts it back', async () => {
    const api = apiStub();
    const { drawer, fire, html, Lex } = loadDrawer(api);
    drawer.open(boardTask());
    await flush();

    fire('click', { 'data-shared-subtask-toggle': SUB_A });
    await flush();
    expect(api.updateSubtask).toHaveBeenLastCalledWith(SUB_A, { status: 'completed' });
    expect(html()).toContain('<strong>2/2</strong>');

    api.updateSubtask.mockRejectedValueOnce(new Error('offline'));
    fire('click', { 'data-shared-subtask-toggle': SUB_A });
    await flush();
    expect(api.updateSubtask).toHaveBeenLastCalledWith(SUB_A, { status: 'pending' });
    expect(Lex.Toast.error).toHaveBeenCalledWith('offline');
    expect(html()).toContain('<strong>2/2</strong>');
  });

  test('adding a subtask saves it under the task', async () => {
    const api = apiStub();
    const { drawer, fire, html, inputs } = loadDrawer(api);
    drawer.open(boardTask());
    await flush();

    inputs.subtask = { value: 'Call the client' };
    fire('click', { 'data-shared-task-add': 'subtask' });
    await flush();

    expect(api.createSubtask).toHaveBeenCalledWith({ name: 'Call the client', parent_task_id: TASK_UUID });
    expect(html()).toContain('Call the client');
    expect(html()).toContain('<strong>1/3</strong>');
  });

  test('a subtask added before the server list loads stays local (control)', async () => {
    const api = apiStub({ listSubtasks: jest.fn(() => new Promise(() => {})) });
    const { drawer, fire, html, inputs } = loadDrawer(api);
    drawer.open(boardTask());

    inputs.subtask = { value: 'Call the client' };
    fire('click', { 'data-shared-task-add': 'subtask' });
    await flush();

    expect(api.createSubtask).not.toHaveBeenCalled();
    expect(html()).toContain('Call the client');
  });
});

describe('task drawer keys', () => {
  test('shows the task key and each subtask key', async () => {
    const api = apiStub({ listSubtasks: jest.fn(async () => ({ data: [{ id: SUB_A, item_key: 'M17-4', name: 'Verify the statement', status: 'pending' }] })) });
    const { drawer, html } = loadDrawer(api);
    drawer.open(boardTask({ item_key: 'M17-3' }));
    await flush();
    expect(html()).toContain('<span class="my-task-issue__key">M17-3</span>');
    expect(html()).toContain('<span class="my-task-issue__key">M17-4</span> Verify the statement');
  });

  test('a saved subtask change refreshes the Board behind the drawer', async () => {
    const api = apiStub();
    const onRefresh = jest.fn();
    const { drawer, fire } = loadDrawer(api);
    drawer.open(boardTask(), { onRefresh });
    await flush();
    fire('click', { 'data-shared-subtask-toggle': SUB_A });
    await flush();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('task drawer LANA suggestions', () => {
  const ready = {
    status: 'ready',
    title: 'Review Employee Benefit Statement',
    subtasks: [
      { title: 'Check coverage amounts', description: 'Compare plans' },
      { title: 'Confirm dependents', description: '' },
      { title: 'Ask for missing pages', description: null }
    ]
  };

  test('while LANA works, the drawer says a notification is coming', async () => {
    const { drawer, html } = loadDrawer(apiStub());
    drawer.open(boardTask({ lana_suggestions: { status: 'generating' } }));
    await flush();
    expect(html()).toContain('LANA is suggesting subtasks. You will get a notification when they are ready.');
  });

  test.each([
    ['reviewed', { status: 'reviewed' }],
    ['failed', { status: 'failed' }],
    ['none', null]
  ])('%s suggestions show no panel', async (_label, state) => {
    const { drawer, html } = loadDrawer(apiStub());
    drawer.open(boardTask({ lana_suggestions: state }));
    await flush();
    expect(html()).not.toContain('my-task-suggestions');
  });

  test('Add selected sends the checked positions and shows the added subtasks', async () => {
    const api = apiStub({
      reviewTaskSuggestions: jest.fn(async () => ({
        data: {
          subtasks: [
            { id: 'bbbbbbbb-0000-4000-8000-000000000001', title: 'Check coverage amounts', status: 'pending' },
            { id: 'bbbbbbbb-0000-4000-8000-000000000003', title: 'Ask for missing pages', status: 'pending' }
          ],
          lana_suggestions: { status: 'reviewed' }
        }
      }))
    });
    const onRefresh = jest.fn();
    const { drawer, fire, html } = loadDrawer(api);
    drawer.open(boardTask({ lana_suggestions: ready }), { onRefresh });
    await flush();

    expect(html()).toContain('LANA suggested these subtasks');
    expect((html().match(/data-shared-suggestion-index="\d"/g) || []).length).toBe(3);

    // uncheck "Confirm dependents"
    fire('change', { 'data-shared-suggestion-index': '1' }, { checked: false });
    fire('click', { 'data-shared-suggestions-review': 'accept' });
    await flush();

    expect(api.reviewTaskSuggestions).toHaveBeenCalledWith(TASK_UUID, [0, 2]);
    expect(html()).not.toContain('LANA suggested these subtasks');
    expect(html()).toContain('Ask for missing pages');
    expect(html()).toContain('<strong>1/4</strong>');
    expect(onRefresh).toHaveBeenCalled();
  });

  test('Dismiss sends no positions', async () => {
    const api = apiStub({ reviewTaskSuggestions: jest.fn(async () => ({ data: { subtasks: [], lana_suggestions: { status: 'reviewed' } } })) });
    const { drawer, fire, html } = loadDrawer(api);
    drawer.open(boardTask({ lana_suggestions: ready }));
    await flush();

    fire('click', { 'data-shared-suggestions-review': 'dismiss' });
    await flush();

    expect(api.reviewTaskSuggestions).toHaveBeenCalledWith(TASK_UUID, []);
    expect(html()).not.toContain('my-task-suggestions');
  });

  test('a failed review keeps the suggestions on screen', async () => {
    const api = apiStub({ reviewTaskSuggestions: jest.fn(async () => { throw new Error('no access'); }) });
    const { drawer, fire, html, Lex } = loadDrawer(api);
    drawer.open(boardTask({ lana_suggestions: ready }));
    await flush();

    fire('click', { 'data-shared-suggestions-review': 'accept' });
    await flush();

    expect(Lex.Toast.error).toHaveBeenCalledWith('no access');
    expect(html()).toContain('LANA suggested these subtasks');
  });
});

describe('lex-btn variant="lana"', () => {
  function bootButtons() {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
    const { window } = dom;
    window.console.warn = () => {};
    ['time-utils.js', 'lex/lex.core.js', 'lex/lex.icons.js', 'lex/lex.utils.js', 'lex/components/foundation/lex-btn.js']
      .forEach((rel) => window.eval(fs.readFileSync(path.join(__dirname, '../../src/js', rel), 'utf8')));
    window.document.body.innerHTML = '<lex-btn id="gen" variant="lana">Generate suggestions</lex-btn><lex-btn id="plain" variant="primary">Create Task</lex-btn>';
    return window;
  }

  test('renders the LANA pill with its mark and the action as the label; primary does not', async () => {
    const window = bootButtons();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const gen = window.document.querySelector('#gen button.lex-btn-inner');
    const plain = window.document.querySelector('#plain button.lex-btn-inner');

    expect(gen.classList.contains('lex-btn-inner--lana')).toBe(true);
    expect(gen.querySelector('.lex-btn-lana-mark')).not.toBeNull();
    expect(gen.textContent.trim()).toBe('Generate suggestions');
    expect(gen.getAttribute('style')).toContain('linear-gradient');

    expect(plain.classList.contains('lex-btn-inner--lana')).toBe(false);
    expect(plain.querySelector('.lex-btn-lana-mark')).toBeNull();
  });
});

describe('Create Task modal', () => {
  // This page does not load whole into JSDOM; read the modal as text, as the
  // other workspace-details.html suites do.
  const html = fs.readFileSync(path.join(__dirname, '../../src/workspace-details.html'), 'utf8');
  const start = html.indexOf('<lex-modal id="taskModal"');
  const modal = html.slice(start, html.indexOf('</lex-modal>', start));
  const footerHtml = /footer-content='([\s\S]*?)'>/.exec(modal)[1];
  const footer = new JSDOM(footerHtml).window.document;

  test('offers a plain Create Task and a LANA "Generate suggestions" side by side', () => {
    const generate = footer.getElementById('taskGenerateBtn');
    const submit = footer.getElementById('taskSubmitBtn');
    expect(generate.getAttribute('variant')).toBe('lana');
    expect(generate.textContent.trim()).toBe('Generate suggestions');
    expect(generate.getAttribute('onclick')).toBe('createTaskWithSuggestions()');
    expect(submit.getAttribute('type')).toBe('submit');
    expect(submit.getAttribute('variant')).toBe('primary');
  });

  test('Generate suggestions sits on the left; Cancel then Create stay on the right', () => {
    const [left, right] = footer.body.firstElementChild.children;
    expect(left.querySelector('#taskGenerateBtn')).not.toBeNull();
    expect(Array.from(right.children).map((b) => b.textContent.trim() || b.id)).toEqual(['Cancel', 'Save Task']);
  });

  test('the blocking in-modal suggestion review is gone', () => {
    expect(start).toBeGreaterThan(-1);
    expect(modal).toContain('id="taskForm"');
    expect(modal).not.toContain('taskSuggestionsPanel');
  });
});
