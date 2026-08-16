/**
 * Regression tests — shared task detail drawer comment actions (SCRUM-236).
 *
 * Bug: the workspace task-details modal rendered like / react / edit buttons
 * on comments (data-shared-comment-action) but handleCommentAction only
 * implemented reply / cancel-reply / post-reply, so those buttons did
 * nothing. Replies were also stored but never rendered.
 *
 * task-detail-drawer.js is a browser IIFE; per repo convention we avoid
 * jsdom and hand-build the minimal DOM surface each method touches, driving
 * clicks through the drawer's real document click listener.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_PATH = path.join(__dirname, '../../src/js/components/task-detail-drawer.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

function loadDrawer() {
  const listeners = {};
  const editTargets = {};
  const contentStub = {
    innerHTML: '',
    querySelector: (selector) => {
      const match = /\[data-shared-comment-content="([^"]+)"\]/.exec(selector);
      if (match) return editTargets[match[1]] || null;
      return null;
    },
  };
  const registry = { sharedTaskDetailsContent: contentStub };
  const documentStub = {
    getElementById: (id) => registry[id] || null,
    createElement: () => ({ setAttribute() {} }),
    body: { appendChild: (el) => { if (el.id) registry[el.id] = el; } },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const Lex = {
    Auth: { user: { id: 'user-1', name: 'Test User' } },
    Toast: { warning: jest.fn(), success: jest.fn(), error: jest.fn() },
  };
  const windowStub = { Lex };
  const sandbox = {
    window: windowStub,
    document: documentStub,
    requestAnimationFrame: () => {},
    Lex,
    LanaTime: { nowMs: () => 1755300000000, nowIso: () => '2026-08-16T00:00:00.000Z' },
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: SOURCE_PATH });
  return { drawer: windowStub.LanaTaskDetails, listeners, contentStub, editTargets, Lex };
}

function makeTask(comments) {
  return { id: 'task-1', title: 'Wednesday Lana Demo', metadata: { comments } };
}

function ownComment(overrides) {
  return Object.assign({
    id: 'c1',
    author_name: 'Test User',
    author_id: 'user-1',
    content: 'Original content',
    created_at: '2026-08-16T00:00:00.000Z',
  }, overrides);
}

function clickAction(listeners, action, commentId, closestMap) {
  const actionEl = {
    getAttribute: (name) => {
      if (name === 'data-shared-comment-action') return action;
      if (name === 'data-comment-id') return String(commentId);
      return null;
    },
    closest: (selector) => (closestMap && closestMap[selector]) || null,
  };
  const event = {
    preventDefault() {},
    target: {
      closest: (selector) => {
        if (selector === '#sharedTaskDetailsModal') return {};
        if (selector === '[data-shared-comment-action]') return actionEl;
        return null;
      },
    },
  };
  (listeners.click || []).forEach((fn) => fn(event));
}

describe('shared drawer comment action contract', () => {
  test('every rendered data-shared-comment-action has a handler branch', () => {
    const rendered = new Set();
    for (const m of source.matchAll(/data-shared-comment-action="([a-z-]+)"/g)) rendered.add(m[1]);
    expect(rendered.size).toBeGreaterThanOrEqual(7);

    const handlerBody = source.slice(source.indexOf('function handleCommentAction'));
    const handled = new Set();
    for (const m of handlerBody.matchAll(/action === '([a-z-]+)'/g)) handled.add(m[1]);

    const unhandled = [...rendered].filter((a) => !handled.has(a));
    expect(unhandled).toEqual([]);
  });
});

describe('shared drawer comment actions', () => {
  test('renders like/react counts, active state, and nested replies', () => {
    const { drawer, contentStub } = loadDrawer();
    drawer.open(makeTask([ownComment({
      liked: true,
      like_count: 2,
      reaction_count: 3,
      replies: [{ id: 'r1', author_name: 'Ron', author_id: 'user-2', content: 'A nested reply', created_at: '2026-08-16T01:00:00.000Z' }],
    })]));
    const html = contentStub.innerHTML;
    expect(html).toContain('is-active');
    expect(html).toContain('data-shared-comment-action="like"');
    expect(html).toContain('<span>2</span>');
    expect(html).toContain('<span>3</span>');
    expect(html).toContain('my-task-comment-replies');
    expect(html).toContain('A nested reply');
  });

  test('edit button renders only for the comment author', () => {
    const { drawer, contentStub } = loadDrawer();
    drawer.open(makeTask([
      ownComment(),
      { id: 'c2', author_name: 'Ron', author_id: 'user-2', content: 'Someone else', created_at: '2026-08-16T01:00:00.000Z' },
    ]));
    const html = contentStub.innerHTML;
    expect(html).toContain('data-shared-comment-action="edit" data-comment-id="c1"');
    expect(html).not.toContain('data-shared-comment-action="edit" data-comment-id="c2"');
  });

  test('like toggles the active state and count', () => {
    const { drawer, listeners, contentStub } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    expect(contentStub.innerHTML).not.toContain('is-active');

    clickAction(listeners, 'like', 'c1');
    expect(contentStub.innerHTML).toContain('is-active');
    expect(contentStub.innerHTML).toContain('<span>1</span>');

    clickAction(listeners, 'like', 'c1');
    expect(contentStub.innerHTML).not.toContain('is-active');
    expect(contentStub.innerHTML).not.toContain('<span>1</span>');
  });

  test('react increments the reaction count', () => {
    const { drawer, listeners, contentStub } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    clickAction(listeners, 'react', 'c1');
    expect(contentStub.innerHTML).toContain('<span>1</span>');
    clickAction(listeners, 'react', 'c1');
    expect(contentStub.innerHTML).toContain('<span>2</span>');
  });

  test('edit opens the inline editor seeded with the comment content', () => {
    const { drawer, listeners, editTargets } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    const textarea = { value: '', focus: jest.fn(), setSelectionRange: jest.fn() };
    editTargets.c1 = {
      innerHTML: '',
      querySelector: (sel) => (sel === 'textarea' ? textarea : null),
    };
    clickAction(listeners, 'edit', 'c1');
    expect(editTargets.c1.innerHTML).toContain('my-task-comment-edit');
    expect(editTargets.c1.innerHTML).toContain('Original content');
    expect(editTargets.c1.innerHTML).toContain('data-shared-comment-action="save-edit"');
    expect(editTargets.c1.innerHTML).toContain('data-shared-comment-action="cancel-edit"');
    expect(textarea.focus).toHaveBeenCalled();
  });

  test('save-edit updates the comment and marks it edited', () => {
    const { drawer, listeners, contentStub } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    const editBox = { querySelector: (sel) => (sel === 'textarea' ? { value: 'Updated content' } : null) };
    clickAction(listeners, 'save-edit', 'c1', { '.my-task-comment-edit': editBox });
    expect(contentStub.innerHTML).toContain('Updated content');
    expect(contentStub.innerHTML).not.toContain('Original content');
    expect(contentStub.innerHTML).toContain('<span>edited</span>');
  });

  test('save-edit with empty content warns and keeps the original', () => {
    const { drawer, listeners, contentStub, Lex } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    const editBox = { querySelector: (sel) => (sel === 'textarea' ? { value: '   ' } : null) };
    clickAction(listeners, 'save-edit', 'c1', { '.my-task-comment-edit': editBox });
    expect(Lex.Toast.warning).toHaveBeenCalled();
    expect(contentStub.innerHTML).toContain('Original content');
    expect(contentStub.innerHTML).not.toContain('<span>edited</span>');
  });
});
