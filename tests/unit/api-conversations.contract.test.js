'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadApi() {
  const context = {
    console,
    URLSearchParams,
    AbortController,
    FormData: class FormData {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: jest.fn(),
    localStorage: {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn()
    },
    document: {
      addEventListener: jest.fn(),
      body: {},
      getElementById: jest.fn(() => null)
    },
    location: {
      protocol: 'http:',
      origin: 'http://client.test',
      pathname: '/app.html'
    },
    LanaConfig: {},
    LanaTime: {
      nowMs: jest.fn(() => 1000),
      millisecondsSince: jest.fn((start) => 1000 - start),
      MS_PER_MINUTE: 60000
    }
  };
  context.window = context;
  context.globalThis = context;

  const apiPath = path.join(__dirname, '../../src/js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
  return context.window.api;
}

describe('ApiClient canonical conversation aliases', () => {
  test('lists conversations through the current conversation-threads compatibility route', async () => {
    const api = loadApi();
    api.get = jest.fn().mockResolvedValue({ data: [] });

    await api.getConversations({
      limit: 25,
      matterId: 'matter-1',
      pageScope: 'workspace',
      excludePinned: true,
      sortBy: 'updated_at',
      sortOrder: 'asc'
    });

    expect(api.get).toHaveBeenCalledWith(
      '/api/v1/conversation-threads?limit=25&sort_by=updated_at&sort_order=asc&matter_id=matter-1&page_scope=workspace&exclude_pinned=true'
    );
  });

  test('creates, reads, updates, and deletes conversation metadata through compatibility routes', async () => {
    const api = loadApi();
    api.post = jest.fn().mockResolvedValue({});
    api.get = jest.fn().mockResolvedValue({});
    api.put = jest.fn().mockResolvedValue({});
    api.delete = jest.fn().mockResolvedValue({});

    await api.createConversation({ title: 'Draft' });
    await api.getConversation('thread/1');
    await api.updateConversation('thread/1', { title: 'Renamed' });
    await api.deleteConversation('thread/1');

    expect(api.post).toHaveBeenCalledWith('/api/v1/conversation-threads', { title: 'Draft' });
    expect(api.get).toHaveBeenCalledWith('/api/v1/conversation-threads/thread%2F1');
    expect(api.put).toHaveBeenCalledWith('/api/v1/conversation-threads/thread%2F1', { title: 'Renamed' });
    expect(api.delete).toHaveBeenCalledWith('/api/v1/conversation-threads/thread%2F1');
  });

  test('loads messages, reads generation state, and updates scope through canonical conversation subresources', async () => {
    const api = loadApi();
    api.get = jest.fn().mockResolvedValue({});
    api.patch = jest.fn().mockResolvedValue({});

    await api.getConversationMessages('conv/1', { page: 2, limit: 10, order: 'asc' });
    await api.getConversationGeneration('conv/1');
    await api.updateConversationScope('conv/1', 'matter-1');
    await api.updateConversationScope('conv/2', null);

    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v1/conversations/conv%2F1/messages?page=2&limit=10&order=asc');
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v1/conversations/conv%2F1/generation');
    expect(api.patch).toHaveBeenNthCalledWith(1, '/api/v1/conversations/conv%2F1/scope', { matter_id: 'matter-1' });
    expect(api.patch).toHaveBeenNthCalledWith(2, '/api/v1/conversations/conv%2F2/scope', { matter_id: null });
  });

  test('exposes dock and panel wrapper aliases over canonical conversation methods', async () => {
    const api = loadApi();
    api.createConversation = jest.fn().mockResolvedValue({ id: 'created' });
    api.updateConversation = jest.fn().mockResolvedValue({ id: 'updated' });
    api.updateConversationScope = jest.fn().mockResolvedValue({ id: 'scoped' });

    await api.createConversationRegistryEntry({ title: 'Draft' });
    await api.createConversationThread({ title: 'Thread' });
    await api.updateConversationRegistryEntry('registry-1', { title: 'Renamed' });
    await api.updateConversationThread('registry-2', { title: 'Thread Renamed' });
    await api.setConversationMatter('conversation-1', 'matter-1');
    await api.setConversationScope('conversation-2', { matterId: 'matter-2' });
    await api.setConversationScope('conversation-3', { scope: { matter_id: 'matter-3' } });

    expect(api.createConversation).toHaveBeenNthCalledWith(1, { title: 'Draft' });
    expect(api.createConversation).toHaveBeenNthCalledWith(2, { title: 'Thread' });
    expect(api.updateConversation).toHaveBeenNthCalledWith(1, 'registry-1', { title: 'Renamed' });
    expect(api.updateConversation).toHaveBeenNthCalledWith(2, 'registry-2', { title: 'Thread Renamed' });
    expect(api.updateConversationScope).toHaveBeenNthCalledWith(1, 'conversation-1', 'matter-1');
    expect(api.updateConversationScope).toHaveBeenNthCalledWith(2, 'conversation-2', 'matter-2');
    expect(api.updateConversationScope).toHaveBeenNthCalledWith(3, 'conversation-3', 'matter-3');
  });

  test('stops the active generation through the conversation-scoped generation route', async () => {
    const api = loadApi();
    api.post = jest.fn().mockResolvedValue({ success: true });

    await api.stopConversationGeneration('thread-1');

    expect(api.post).toHaveBeenCalledWith('/api/v1/conversations/thread-1/generation/stop', {});
  });
});
