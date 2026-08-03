'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadThreads(api) {
  class FakeLexElement {
    constructor() {
      this._events = [];
    }

    _scheduleUpdate() {
      this._scheduled = true;
    }

    emit(name, detail) {
      this._events.push({ name, detail });
    }

    escapeHtml(value) {
      return String(value == null ? '' : value);
    }

    delegate() {}
  }

  const context = {
    console,
    api,
    window: null,
    globalThis: null,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    customElements: {
      define: jest.fn((name, klass) => {
        context.DefinedThreadList = klass;
      })
    },
    Lex: { LexElement: FakeLexElement }
  };
  context.window = context;
  context.globalThis = context;

  const sourcePath = path.join(__dirname, '../../src/js/lex/chat/lex-chat.threads.js');
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return context.DefinedThreadList;
}

function makeApi(overrides = {}) {
  return {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ success: true })),
    delete: jest.fn(async () => ({ success: true })),
    getConversations: jest.fn(async () => ({ conversations: [] })),
    stopConversationActivity: jest.fn(async () => ({ stopped: true })),
    stopConversationGeneration: jest.fn(async () => ({ success: true })),
    deleteConversation: jest.fn(async () => ({ success: true })),
    ...overrides
  };
}

describe('lex-chat-threads route contract', () => {
  test('loads recents through the canonical conversation wrapper when available', async () => {
    const api = makeApi({
      getConversations: jest.fn(async () => ({
        conversations: [{
          registryId: 'registry-1',
          conversationId: 'conversation-1',
          title: 'Recent chat',
          lastActivity: '2026-08-03T12:00:00Z'
        }]
      }))
    });
    const ThreadList = loadThreads(api);
    const el = new ThreadList();
    el.recents = true;
    el.pageScope = '';
    el.matterId = null;

    await el.loadThreads();

    expect(api.getConversations).toHaveBeenCalledWith({ matterId: null });
    expect(api.get).not.toHaveBeenCalled();
    expect(el._threads).toEqual([
      expect.objectContaining({ id: 'registry-1', thread_id: 'conversation-1', title: 'Recent chat' })
    ]);
  });

  test('loads page-scoped threads through the canonical conversation wrapper', async () => {
    const api = makeApi({
      getConversations: jest.fn(async () => ({
        conversations: [{
          registryId: 'registry-1',
          conversationId: 'conversation-1',
          title: 'Dashboard chat'
        }]
      }))
    });
    const ThreadList = loadThreads(api);
    const el = new ThreadList();
    el.recents = false;
    el.pageScope = 'dashboard';
    el.matterId = 'matter-1';

    await el.loadThreads();

    expect(api.getConversations).toHaveBeenCalledWith({ pageScope: 'dashboard', matterId: 'matter-1' });
    expect(api.get).not.toHaveBeenCalled();
    expect(el._threads).toEqual([
      expect.objectContaining({ id: 'registry-1', thread_id: 'conversation-1' })
    ]);
  });

  test('delete prefers the canonical conversation activity stop wrapper', async () => {
    const api = makeApi();
    const ThreadList = loadThreads(api);
    const el = new ThreadList();
    el.activeThread = 'registry-1';
    el._threads = [{ id: 'registry-1', thread_id: 'conversation-1', title: 'Delete me' }];

    await el._deleteThread('registry-1');

    expect(api.stopConversationActivity).toHaveBeenCalledWith('conversation-1');
    expect(api.stopConversationGeneration).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.deleteConversation).toHaveBeenCalledWith('registry-1');
    expect(api.delete).not.toHaveBeenCalled();
    expect(el._events).toContainEqual({ name: 'lex-thread-delete', detail: { threadId: 'registry-1' } });
  });

  test('delete skips stop when only the registry id is available', async () => {
    const api = makeApi();
    const ThreadList = loadThreads(api);
    const el = new ThreadList();
    el._threads = [{ id: 'registry-only', title: 'No stream id' }];

    await el._deleteThread('registry-only');

    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.stopConversationActivity).not.toHaveBeenCalled();
    expect(api.stopConversationGeneration).not.toHaveBeenCalled();
    expect(api.deleteConversation).toHaveBeenCalledWith('registry-only');
    expect(api.delete).not.toHaveBeenCalled();
  });
});
