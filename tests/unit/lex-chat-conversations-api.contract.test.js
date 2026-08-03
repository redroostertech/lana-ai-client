'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDomain(fetchMock, apiOverrides = {}) {
  const api = {
    baseUrl: 'http://api.test',
    _readyPromise: Promise.resolve('http://api.test'),
    token: 'token-1',
    getHeaders: jest.fn(() => ({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token-1'
    })),
    get: jest.fn().mockResolvedValue({}),
    post: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    createConversation: jest.fn().mockResolvedValue({ data: { conversationId: 'thread-1' } }),
    getConversationGeneration: jest.fn().mockResolvedValue({ active: false }),
    stopConversationGeneration: jest.fn().mockResolvedValue({ success: true }),
    ...apiOverrides
  };
  const context = {
    console,
    fetch: fetchMock,
    api,
    location: {
      protocol: 'http:',
      origin: 'http://client.test'
    },
    Lex: {}
  };
  context.window = context;
  context.globalThis = context;

  const domainPath = path.join(__dirname, '../../src/js/lex/chat/lex-chat.conversations-api.js');
  vm.runInNewContext(fs.readFileSync(domainPath, 'utf8'), context, { filename: domainPath });
  return { api, DomainClient: context.Lex.Chat.ConversationsApiClient };
}

describe('Lex conversations domain API', () => {
  test('streams messages through the canonical conversation subresource', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    const { api, DomainClient } = loadDomain(fetchMock);
    const client = new DomainClient(api);

    await client.streamMessage('thread/1', { message: 'hello' }, { aborted: false });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/conversations/thread%2F1/messages/stream',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token-1'
        },
        body: JSON.stringify({ message: 'hello' })
      })
    );
  });

  test('delegates canonical metadata/history/generation calls to the core API client', async () => {
    const fetchMock = jest.fn();
    const { api, DomainClient } = loadDomain(fetchMock);
    const client = new DomainClient(api);

    await client.createConversation({ title: 'Draft' });
    await client.getMessages('thread/1', 2, 25);
    await client.getGeneration('thread/1');
    await client.stopGeneration('thread/1');

    expect(api.createConversation).toHaveBeenCalledWith({ title: 'Draft' });
    expect(api.get).toHaveBeenCalledWith('/api/v1/conversations/thread%2F1/messages?page=2&limit=25&order=desc');
    expect(api.getConversationGeneration).toHaveBeenCalledWith('thread/1');
    expect(api.stopConversationGeneration).toHaveBeenCalledWith('thread/1');
  });
});
