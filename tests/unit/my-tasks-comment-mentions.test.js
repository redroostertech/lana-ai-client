'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_PATH = path.join(__dirname, '../../src/js/pages/my-tasks.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

const TASK_UUID = '11111111-2222-4333-8444-555555555555';
const USER_UUID = '23732961-1c8b-4594-8a2e-2f57e88b7dc5';
const SECOND_USER_UUID = '2524c078-5af8-447d-a802-00581742576e';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeElement(overrides) {
  return Object.assign({
    innerHTML: '',
    value: '',
    open: false,
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, handler) {
      this.listeners = this.listeners || {};
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  }, overrides || {});
}

function makeTextarea() {
  const textarea = makeElement({
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    dispatched: [],
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    setRangeText(text, start, end, selectionMode) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      const caret = selectionMode === 'end' ? start + text.length : start;
      this.selectionStart = caret;
      this.selectionEnd = caret;
    },
    dispatchEvent(event) {
      this.dispatched.push(event.type);
    },
  });
  return textarea;
}

function loadMyTasks(options = {}) {
  const listeners = {};
  const textarea = makeTextarea();
  const commentInput = makeElement({
    value: '',
    querySelector(selector) {
      return selector === 'textarea' ? textarea : null;
    },
  });
  const mentionPicker = makeElement({
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      toggle() {},
      contains() { return false; },
    },
  });
  const content = makeElement({
    querySelector(selector) {
      if (selector === '[data-task-input="comment"]') return commentInput;
      if (selector === '[data-task-input="comment"] textarea') return textarea;
      if (selector === '[data-task-mention-picker]') return mentionPicker;
      if (selector === '.my-task-comment-composer') return makeElement();
      if (selector === '.my-task-activity-tabs') return null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  });
  const modal = makeElement({
    querySelector() {
      return null;
    },
  });
  const registry = {
    myTaskDetailsContent: content,
    myTaskDetailsModal: modal,
    myTasksTable: makeElement({
      setData: jest.fn(),
      dataSource: { pagination: { total: 0 } },
    }),
  };
  const documentStub = {
    getElementById(id) {
      return registry[id] || null;
    },
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    createElement() {
      return makeElement();
    },
    body: { appendChild() {} },
  };
  const Lex = {
    Auth: { user: { id: 'current-user', name: 'Ron VanPelt' } },
    Utils: {
      escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      },
      formatDate(value) { return String(value || ''); },
      setLexButtonText() {},
    },
    Toast: { warning: jest.fn(), error: jest.fn(), success: jest.fn() },
    Modal: { confirm: jest.fn() },
    Nav: { go: jest.fn() },
  };
  const api = Object.assign({
    getMyTasks: jest.fn().mockResolvedValue([]),
    getMentionableUsers: jest.fn().mockResolvedValue({ data: { users: [] } }),
    getResourceComments: jest.fn().mockResolvedValue({ data: { comments: [] } }),
    createResourceComment: jest.fn().mockResolvedValue({
      data: {
        id: 'comment-1',
        author_name: 'Ron VanPelt',
        author_id: 'current-user',
        content: '',
      },
    }),
  }, options.api || {});
  const sandbox = {
    window: { Lex, api, location: { search: '' } },
    document: documentStub,
    Lex,
    api,
    LanaTime: { nowMs: () => 1787609400000, nowIso: () => '2026-08-24T22:10:00.000Z' },
    requestAnimationFrame: (fn) => fn(),
    Event: function Event(type) { this.type = type; this.bubbles = true; },
    URLSearchParams,
    console,
    setTimeout,
  };
  vm.runInNewContext(source, sandbox, { filename: SOURCE_PATH });
  return { window: sandbox.window, listeners, content, commentInput, textarea, mentionPicker, api };
}

function clickMention(target, id, name) {
  const option = {
    getAttribute(attr) {
      if (attr === 'data-task-mention-id') return id;
      if (attr === 'data-task-mention-name') return name;
      return null;
    },
  };
  const event = {
    preventDefault() {},
    target: {
      closest(selector) {
        if (selector === '[data-task-mention-id]') return option;
        if (selector === '[data-task-comment-template]') return null;
        if (selector === '[data-task-compose-cancel]') return null;
        if (selector === '[data-task-comment-tool]') return null;
        return null;
      },
    },
  };
  ((target.listeners && target.listeners.click) || []).forEach((handler) => handler(event));
}

function clickComment(target) {
  const addButton = {
    getAttribute(attr) {
      return attr === 'data-task-add' ? 'comment' : null;
    },
  };
  const event = {
    preventDefault() {},
    target: {
      closest(selector) {
        if (selector === '[data-task-add]') return addButton;
        return null;
      },
    },
  };
  ((target.listeners && target.listeners.click) || []).forEach((handler) => handler(event));
}

function dispatchCommentInput(target, commentInput) {
  const event = {
    target: {
      closest(selector) {
        return selector === '[data-task-input="comment"]' ? commentInput : null;
      },
    },
  };
  ((target.listeners && target.listeners.input) || []).forEach((handler) => handler(event));
}

describe('my tasks comment mentions (SCRUM-235)', () => {
  test('selected task mentions display without ids while submitted payload keeps the mention id token', async () => {
    const { window, content, commentInput, textarea, api } = loadMyTasks();
    window.LanaTaskDetails.open({
      id: TASK_UUID,
      title: 'Coordinate expert witness retention',
      matter_id: 'matter-1',
      metadata: {},
    });
    await flush();

    textarea.value = 'Hey @Mi have we finished this up yet?';
    textarea.selectionStart = 'Hey @Mi'.length;
    textarea.selectionEnd = textarea.selectionStart;
    commentInput.value = textarea.value;

    clickMention(content, USER_UUID, 'Michael Westbrooks');

    expect(textarea.value).toBe('Hey @Michael Westbrooks have we finished this up yet?');
    expect(commentInput.value).toBe(textarea.value);
    expect(textarea.value).not.toContain(USER_UUID);

    clickComment(content);
    await flush();

    expect(api.createResourceComment).toHaveBeenCalledWith(
      'task',
      TASK_UUID,
      {
        content: 'Hey @[Michael Westbrooks](' + USER_UUID + ') have we finished this up yet?',
        mentions: [USER_UUID],
      }
    );
  });

  test('manual same-name text before a selected mention is not converted to the selected user id', async () => {
    const { window, content, commentInput, textarea, api } = loadMyTasks();
    window.LanaTaskDetails.open({
      id: TASK_UUID,
      title: 'Coordinate expert witness retention',
      matter_id: 'matter-1',
      metadata: {},
    });
    await flush();

    textarea.value = 'Plain @Michael Westbrooks then selected @Mi';
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.selectionStart;
    commentInput.value = textarea.value;

    clickMention(content, USER_UUID, 'Michael Westbrooks');
    clickComment(content);
    await flush();

    expect(api.createResourceComment).toHaveBeenCalledWith(
      'task',
      TASK_UUID,
      {
        content: 'Plain @Michael Westbrooks then selected @[Michael Westbrooks](' + USER_UUID + ')',
        mentions: [USER_UUID],
      }
    );
  });

  test('deleted selected mention text does not submit a stale mention id', async () => {
    const { window, content, commentInput, textarea, api } = loadMyTasks();
    window.LanaTaskDetails.open({
      id: TASK_UUID,
      title: 'Coordinate expert witness retention',
      matter_id: 'matter-1',
      metadata: {},
    });
    await flush();

    textarea.value = 'Hey @Mi';
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.selectionStart;
    commentInput.value = textarea.value;

    clickMention(content, USER_UUID, 'Michael Westbrooks');

    textarea.value = 'Hey ';
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.selectionStart;
    commentInput.value = textarea.value;
    dispatchCommentInput(content, commentInput);

    textarea.value = 'Hey @Michael Westbrooks';
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.selectionStart;
    commentInput.value = textarea.value;
    dispatchCommentInput(content, commentInput);

    clickComment(content);
    await flush();

    expect(api.createResourceComment).toHaveBeenCalledWith(
      'task',
      TASK_UUID,
      {
        content: 'Hey @Michael Westbrooks',
      }
    );
  });

  test('duplicate display names keep the selected user ids bound to their own inserted ranges', async () => {
    const { window, content, commentInput, textarea, api } = loadMyTasks();
    window.LanaTaskDetails.open({
      id: TASK_UUID,
      title: 'Coordinate expert witness retention',
      matter_id: 'matter-1',
      metadata: {},
    });
    await flush();

    textarea.value = '@Al';
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.selectionStart;
    commentInput.value = textarea.value;
    clickMention(content, USER_UUID, 'Alex Kim');

    textarea.value += '@Al';
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.selectionStart;
    commentInput.value = textarea.value;
    clickMention(content, SECOND_USER_UUID, 'Alex Kim');

    expect(textarea.value).toBe('@Alex Kim @Alex Kim ');
    clickComment(content);
    await flush();

    expect(api.createResourceComment).toHaveBeenCalledWith(
      'task',
      TASK_UUID,
      {
        content: '@[Alex Kim](' + USER_UUID + ') @[Alex Kim](' + SECOND_USER_UUID + ')',
        mentions: [USER_UUID, SECOND_USER_UUID],
      }
    );
  });
});
