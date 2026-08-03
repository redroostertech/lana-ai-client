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

  test('uses canonical conversation document-selection subresources', async () => {
    const fetchMock = jest.fn();
    const { api, DomainClient } = loadDomain(fetchMock, {
      get: jest.fn().mockResolvedValue({
        data: {
          documents: [{ documentId: 'doc-1', filename: 'evidence.pdf' }]
        }
      }),
      post: jest.fn().mockResolvedValue({
        data: {
          documents: [{ documentId: 'doc-1', filename: 'evidence.pdf' }],
          retrieval: { active: false, status: 'degraded', fallback: 'system_or_matter_scope' }
        }
      }),
      delete: jest.fn().mockResolvedValue({
        data: { documents: [] }
      })
    });
    const client = new DomainClient(api);

    const selected = await client.addDocument('thread/1', 'doc-1', 'evidence.pdf', 'MAT-1');
    const loaded = await client.loadState('thread/1');
    const removed = await client.removeDocument('thread/1', 'doc-1');
    const cleared = await client.clearDocuments('thread/1');

    expect(api.post).toHaveBeenCalledWith('/api/v1/conversations/thread%2F1/documents', {
      documentId: 'doc-1',
      filename: 'evidence.pdf',
      matterId: 'MAT-1',
      selectionSource: 'prompt_mention'
    });
    expect(api.get).toHaveBeenCalledWith('/api/v1/conversations/thread%2F1/documents');
    expect(api.delete).toHaveBeenCalledWith('/api/v1/conversations/thread%2F1/documents/doc-1');
    expect(api.delete).toHaveBeenCalledWith('/api/v1/conversations/thread%2F1/documents');
    expect(selected).toEqual({
      mode: 'document',
      activeDocuments: [{ documentId: 'doc-1', filename: 'evidence.pdf' }],
      retrieval: { active: false, status: 'degraded', fallback: 'system_or_matter_scope' }
    });
    expect(loaded.mode).toBe('document');
    expect(removed).toEqual({ mode: 'general', activeDocuments: [], retrieval: null });
    expect(cleared).toEqual({ mode: 'general', activeDocuments: [], retrieval: null });
  });
});
