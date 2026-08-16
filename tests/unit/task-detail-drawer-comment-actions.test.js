/**
 * Regression tests — shared task detail drawer comment actions (SCRUM-236).
 *
 * Bug 1: the workspace task-details modal rendered like / react / edit
 * buttons on comments but handleCommentAction only implemented the reply
 * flow, so those buttons did nothing. Replies were also stored but never
 * rendered.
 * Bug 2 (verification feedback): the message-circle button incremented a
 * meaningless counter instead of opening a reply composer, delete used the
 * system window.confirm, and comments vanished on refresh because nothing
 * persisted. Comments now sync through the generic /api/v1/comments
 * service (resource_type "task"), delete confirms via Lex.Modal, and the
 * message-circle button toggles the reply editor.
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

const TASK_UUID = '11111111-2222-4333-8444-555555555555';
const COMMENT_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeClassList(initiallyHidden) {
  const classes = new Set(initiallyHidden ? ['hidden'] : []);
  return {
    toggle: (cls) => (classes.has(cls) ? classes.delete(cls) : classes.add(cls)),
    add: (cls) => classes.add(cls),
    contains: (cls) => classes.has(cls),
  };
}

function loadDrawer(options = {}) {
  const listeners = {};
  const editTargets = {};
  const replyEditors = {};
  const contentStub = {
    innerHTML: '',
    querySelector: (selector) => {
      let match = /\[data-shared-comment-content="([^"]+)"\]/.exec(selector);
      if (match) return editTargets[match[1]] || null;
      match = /\[data-shared-reply-editor="([^"]+)"\]/.exec(selector);
      if (match) return replyEditors[match[1]] || null;
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
    Modal: { confirm: jest.fn((title, message, onConfirm) => onConfirm && onConfirm()) },
  };
  const windowStub = { Lex, api: options.api };
  const sandbox = {
    window: windowStub,
    document: documentStub,
    requestAnimationFrame: () => {},
    Lex,
    api: options.api,
    LanaTime: { nowMs: () => 1755300000000, nowIso: () => '2026-08-16T00:00:00.000Z' },
    console,
    setTimeout,
  };
  vm.runInNewContext(source, sandbox, { filename: SOURCE_PATH });
  return { drawer: windowStub.LanaTaskDetails, listeners, contentStub, editTargets, replyEditors, Lex };
}

function makeTask(comments, id) {
  return { id: id || 'task-1', title: 'Wednesday Lana Demo', metadata: { comments } };
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

describe('shared drawer comment actions (local fallback)', () => {
  test('renders like count, active state, reply count, and nested replies', () => {
    const { drawer, contentStub } = loadDrawer();
    drawer.open(makeTask([ownComment({
      liked: true,
      like_count: 2,
      replies: [{ id: 'r1', author_name: 'Ron', author_id: 'user-2', content: 'A nested reply', created_at: '2026-08-16T01:00:00.000Z' }],
    })]));
    const html = contentStub.innerHTML;
    expect(html).toContain('is-active');
    expect(html).toContain('data-shared-comment-action="like"');
    expect(html).toContain('<span>2</span>');
    expect(html).toContain('data-shared-comment-action="reply"');
    expect(html).toContain('<span>1</span>');
    expect(html).toContain('my-task-comment-replies');
    expect(html).toContain('A nested reply');
  });

  test('edit and delete buttons render only for the comment author', () => {
    const { drawer, contentStub } = loadDrawer();
    drawer.open(makeTask([
      ownComment(),
      { id: 'c2', author_name: 'Ron', author_id: 'user-2', content: 'Someone else', created_at: '2026-08-16T01:00:00.000Z' },
    ]));
    const html = contentStub.innerHTML;
    expect(html).toContain('data-shared-comment-action="edit" data-comment-id="c1"');
    expect(html).toContain('data-shared-comment-action="delete" data-comment-id="c1"');
    expect(html).not.toContain('data-shared-comment-action="edit" data-comment-id="c2"');
    expect(html).not.toContain('data-shared-comment-action="delete" data-comment-id="c2"');
  });

  test('the message-circle reply button toggles the reply editor', () => {
    const { drawer, listeners, replyEditors } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    const textarea = { focus: jest.fn(), value: '' };
    replyEditors.c1 = {
      classList: makeClassList(true),
      querySelector: (sel) => (sel === 'textarea' ? textarea : null),
    };
    clickAction(listeners, 'reply', 'c1');
    expect(replyEditors.c1.classList.contains('hidden')).toBe(false);
    expect(textarea.focus).toHaveBeenCalled();
    clickAction(listeners, 'reply', 'c1');
    expect(replyEditors.c1.classList.contains('hidden')).toBe(true);
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

  test('save-edit updates the comment and marks it edited', async () => {
    const { drawer, listeners, contentStub } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    const editBox = { querySelector: (sel) => (sel === 'textarea' ? { value: 'Updated content' } : null) };
    clickAction(listeners, 'save-edit', 'c1', { '.my-task-comment-edit': editBox });
    await flush();
    expect(contentStub.innerHTML).toContain('Updated content');
    expect(contentStub.innerHTML).not.toContain('Original content');
    expect(contentStub.innerHTML).toContain('<span>edited</span>');
  });

  test('save-edit with empty content warns and keeps the original', async () => {
    const { drawer, listeners, contentStub, Lex } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    const editBox = { querySelector: (sel) => (sel === 'textarea' ? { value: '   ' } : null) };
    clickAction(listeners, 'save-edit', 'c1', { '.my-task-comment-edit': editBox });
    await flush();
    expect(Lex.Toast.warning).toHaveBeenCalled();
    expect(contentStub.innerHTML).toContain('Original content');
    expect(contentStub.innerHTML).not.toContain('<span>edited</span>');
  });

  test('delete confirms through Lex.Modal (no system confirm) and removes the comment', async () => {
    const { drawer, listeners, contentStub, Lex } = loadDrawer();
    drawer.open(makeTask([ownComment()]));
    clickAction(listeners, 'delete', 'c1');
    await flush();
    expect(Lex.Modal.confirm).toHaveBeenCalledWith(
      'Delete Comment',
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({ variant: 'danger' })
    );
    expect(contentStub.innerHTML).not.toContain('Original content');
  });
});

describe('shared drawer comment persistence', () => {
  function makeApi(overrides) {
    return Object.assign({
      getResourceComments: jest.fn().mockResolvedValue({
        status: 'success',
        data: {
          comments: [{
            id: COMMENT_UUID,
            author_name: 'Test User',
            author_id: 'user-1',
            content: 'Server comment',
            created_at: '2026-08-16T02:00:00.000Z',
            replies: [],
          }],
          total: 1,
          hasMore: false,
        },
      }),
      createResourceComment: jest.fn().mockResolvedValue({
        status: 'success',
        data: { id: COMMENT_UUID, author_name: 'Test User', author_id: 'user-1', content: 'Posted comment', created_at: '2026-08-16T03:00:00.000Z' },
      }),
      replyToComment: jest.fn().mockResolvedValue({
        status: 'success',
        data: { id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', author_name: 'Test User', author_id: 'user-1', content: 'Server reply', created_at: '2026-08-16T04:00:00.000Z' },
      }),
      updateComment: jest.fn().mockResolvedValue({ status: 'success' }),
      deleteComment: jest.fn().mockResolvedValue({ status: 'success' }),
      likeComment: jest.fn().mockResolvedValue({
        status: 'success',
        data: { comment_id: COMMENT_UUID, liked: true, like_count: 5 },
      }),
      unlikeComment: jest.fn().mockResolvedValue({
        status: 'success',
        data: { comment_id: COMMENT_UUID, liked: false, like_count: 4 },
      }),
    }, overrides);
  }

  test('open loads server comments for UUID task ids and replaces local state', async () => {
    const api = makeApi();
    const { drawer, contentStub } = loadDrawer({ api });
    drawer.open(makeTask([ownComment({ content: 'Stale metadata comment' })], TASK_UUID));
    await flush();
    expect(api.getResourceComments).toHaveBeenCalledWith('task', TASK_UUID, expect.objectContaining({ include_replies: true }));
    expect(contentStub.innerHTML).toContain('Server comment');
    expect(contentStub.innerHTML).not.toContain('Stale metadata comment');
  });

  test('open does not call the API for non-UUID task ids', async () => {
    const api = makeApi();
    const { drawer } = loadDrawer({ api });
    drawer.open(makeTask([ownComment()], 'task-1'));
    await flush();
    expect(api.getResourceComments).not.toHaveBeenCalled();
  });

  test('a failed load keeps local comments and stays functional', async () => {
    const api = makeApi({ getResourceComments: jest.fn().mockRejectedValue(new Error('offline')) });
    const { drawer, contentStub } = loadDrawer({ api });
    drawer.open(makeTask([ownComment()], TASK_UUID));
    await flush();
    expect(contentStub.innerHTML).toContain('Original content');
  });

  test('save-edit persists through api.updateComment for synced comments', async () => {
    const api = makeApi();
    const { drawer, listeners, contentStub } = loadDrawer({ api });
    drawer.open(makeTask([], TASK_UUID));
    await flush();
    const editBox = { querySelector: (sel) => (sel === 'textarea' ? { value: 'Edited server comment' } : null) };
    clickAction(listeners, 'save-edit', COMMENT_UUID, { '.my-task-comment-edit': editBox });
    await flush();
    expect(api.updateComment).toHaveBeenCalledWith(COMMENT_UUID, { content: 'Edited server comment' });
    expect(contentStub.innerHTML).toContain('Edited server comment');
  });

  test('delete persists through api.deleteComment for synced comments', async () => {
    const api = makeApi();
    const { drawer, listeners, contentStub } = loadDrawer({ api });
    drawer.open(makeTask([], TASK_UUID));
    await flush();
    expect(contentStub.innerHTML).toContain('Server comment');
    clickAction(listeners, 'delete', COMMENT_UUID);
    await flush();
    expect(api.deleteComment).toHaveBeenCalledWith(COMMENT_UUID);
    expect(contentStub.innerHTML).not.toContain('Server comment');
  });

  test('server liked_by_me and like_count render as active state on load', async () => {
    const api = makeApi({
      getResourceComments: jest.fn().mockResolvedValue({
        status: 'success',
        data: {
          comments: [{ id: COMMENT_UUID, author_name: 'Ron', author_id: 'user-2', content: 'Popular comment', created_at: '2026-08-16T02:00:00.000Z', liked_by_me: true, like_count: 7, replies: [] }],
          total: 1,
          hasMore: false,
        },
      }),
    });
    const { drawer, contentStub } = loadDrawer({ api });
    drawer.open(makeTask([], TASK_UUID));
    await flush();
    expect(contentStub.innerHTML).toContain('is-active');
    expect(contentStub.innerHTML).toContain('<span>7</span>');
  });

  test('like and unlike persist through the like endpoints for synced comments', async () => {
    const api = makeApi();
    const { drawer, listeners, contentStub } = loadDrawer({ api });
    drawer.open(makeTask([], TASK_UUID));
    await flush();

    clickAction(listeners, 'like', COMMENT_UUID);
    await flush();
    expect(api.likeComment).toHaveBeenCalledWith(COMMENT_UUID);
    expect(contentStub.innerHTML).toContain('is-active');
    expect(contentStub.innerHTML).toContain('<span>5</span>');

    clickAction(listeners, 'like', COMMENT_UUID);
    await flush();
    expect(api.unlikeComment).toHaveBeenCalledWith(COMMENT_UUID);
    expect(contentStub.innerHTML).not.toContain('is-active');
    expect(contentStub.innerHTML).toContain('<span>4</span>');
  });

  test('a failed like keeps the previous state', async () => {
    const api = makeApi({ likeComment: jest.fn().mockRejectedValue(new Error('nope')) });
    const { drawer, listeners, contentStub, Lex } = loadDrawer({ api });
    drawer.open(makeTask([], TASK_UUID));
    await flush();

    clickAction(listeners, 'like', COMMENT_UUID);
    await flush();
    expect(Lex.Toast.error).toHaveBeenCalled();
    expect(contentStub.innerHTML).not.toContain('is-active');
  });

  test('post-reply persists through api.replyToComment for synced comments', async () => {
    const api = makeApi();
    const { drawer, listeners, contentStub } = loadDrawer({ api });
    drawer.open(makeTask([], TASK_UUID));
    await flush();
    const replyEditor = { querySelector: (sel) => (sel === 'textarea' ? { value: 'Server reply' } : null) };
    clickAction(listeners, 'post-reply', COMMENT_UUID, { '.my-task-reply-editor': replyEditor });
    await flush();
    expect(api.replyToComment).toHaveBeenCalledWith(COMMENT_UUID, { content: 'Server reply' });
    expect(contentStub.innerHTML).toContain('Server reply');
    expect(contentStub.innerHTML).toContain('my-task-comment-replies');
  });
});
