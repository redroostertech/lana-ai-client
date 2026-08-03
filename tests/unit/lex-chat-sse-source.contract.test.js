'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSource(fetchMock, overrides = {}) {
  const api = overrides.api || null;
  const context = {
    console,
    TextDecoder,
    AbortController: overrides.AbortController || AbortController,
    Intl,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: jest.fn((key) => key === 'token' ? 'token-1' : null)
    },
    crypto: {
      randomUUID: jest.fn(() => '11111111-1111-4111-8111-111111111111')
    },
    fetch: fetchMock,
    api,
    Lex: {}
  };
  context.window = context;
  context.globalThis = context;

  const domainPath = path.join(__dirname, '../../src/js/lex/chat/lex-chat.conversations-api.js');
  const sourcePath = path.join(__dirname, '../../src/js/lex/chat/lex-chat.source.js');
  vm.runInNewContext(fs.readFileSync(domainPath, 'utf8'), context, { filename: domainPath });
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return { context, Source: context.Lex.Chat.SSEChatSource };
}

function canonicalApi(overrides = {}) {
  return {
    baseUrl: 'http://api.test',
    _readyPromise: Promise.resolve('http://api.test'),
    token: 'token-1',
    getHeaders: jest.fn(() => ({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token-1'
    })),
    createConversation: jest.fn().mockResolvedValue({
      data: { conversationId: 'thread-1' }
    }),
    getConversationActivity: jest.fn().mockResolvedValue({
      status: 'success',
      conversation_id: 'thread-1',
      active: true,
      active_response: {
        started_at: '2026-08-03T12:00:00.000Z',
        duration_seconds: 4
      }
    }),
    stopConversationActivity: jest.fn().mockResolvedValue({ stopped: true }),
    getConversationGeneration: jest.fn().mockResolvedValue({
      active: true,
      thread_id: 'thread-1',
      generation_id: 'generation-1',
      client_id: 'client-1'
    }),
    stopConversationGeneration: jest.fn().mockResolvedValue({ success: true }),
    ...overrides
  };
}

function responseFromChunks(chunks, status = 200) {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: jest.fn(() => 'request-1') },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= encoded.length) return { done: true };
            return { done: false, value: encoded[index++] };
          }
        };
      }
    },
    async json() {
      return { error: { code: 'VALIDATION_ERROR', field: 'message' }, request_id: 'request-1' };
    }
  };
}

describe('SSEChatSource contract', () => {
  test('creates a canonical conversation before first-message streaming', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(responseFromChunks([
        'event: connected\ndata: {"thread_id":"thread-1","generation_id":"generation-1"}\n\n',
        'event: done\ndata: {"thread_id":"thread-1","generation_id":"generation-1","message_id":"assistant-1"}\n\n'
      ]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    const api = canonicalApi();
    const { Source } = loadSource(fetchMock, { api });
    const source = new Source({ api });

    const events = [];
    for await (const event of source.send('hello', {
      title: 'LANA Chat',
      matterId: 'matter-1',
      pageScope: 'dashboard',
      contextType: 'full_chat'
    })) events.push(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(api.createConversation).toHaveBeenCalledWith({
      title: 'LANA Chat',
      thread_type: 'ad_hoc',
      context_type: 'full_chat',
      matter_id: 'matter-1',
      page_scope: 'dashboard'
    });
    expect(body).toEqual(expect.objectContaining({
      message: 'hello',
      client_request_id: '11111111-1111-4111-8111-111111111111',
      conversation_id: 'thread-1',
      matter_id: 'matter-1',
      context_type: 'full_chat'
    }));
    expect(events).toEqual([
      expect.objectContaining({ type: 'connected', threadId: 'thread-1', generationId: 'generation-1' }),
      expect.objectContaining({ type: 'done', messageId: 'assistant-1', generationId: 'generation-1' })
    ]);

    await source.stop();
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/conversations/thread-1/messages/stream');
    expect(api.stopConversationActivity).toHaveBeenCalledWith('thread-1');
    expect(api.stopConversationGeneration).not.toHaveBeenCalled();
  });

  test('streams into an existing conversation through the canonical conversation route', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(responseFromChunks([
        'event: done\ndata: {"thread_id":"thread-1","generation_id":"generation-1","message_id":"assistant-1"}\n\n'
      ]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    const api = canonicalApi();
    const { Source } = loadSource(fetchMock, { api });
    const source = new Source({ api });
    await source.connect('thread-1');

    const events = [];
    for await (const event of source.send('hello again')) events.push(event);

    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/conversations/thread-1/messages/stream');
    expect(events).toEqual([
      expect.objectContaining({ type: 'done', messageId: 'assistant-1', generationId: 'generation-1' })
    ]);

    await source.stop();
    expect(api.stopConversationActivity).toHaveBeenCalledWith('thread-1');
    expect(api.stopConversationGeneration).not.toHaveBeenCalled();
  });

  test('parses fragmented frames and final frame without trailing blank line', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(responseFromChunks([
      'event: content\ndata: {"content":"hel',
      'lo"}\n\n',
      'event: error\ndata: {"reason_code":"INTERNAL_ERROR","generation_id":"generation-1"}'
    ]));
    const api = canonicalApi();
    const { Source } = loadSource(fetchMock, { api });
    const source = new Source({ api });

    const events = [];
    for await (const event of source.send('hello')) events.push(event);

    expect(events).toEqual([
      { type: 'content', text: 'hello' },
      expect.objectContaining({ type: 'error', code: 'INTERNAL_ERROR', generationId: 'generation-1' })
    ]);
  });

  test('reports a terminal error when canonical conversation creation is unavailable', async () => {
    const fetchMock = jest.fn();
    const { Source } = loadSource(fetchMock);
    const source = new Source({ endpoint: 'http://api.test' });

    const events = [];
    for await (const event of source.send('hello')) events.push(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        error: 'Core API client not available'
      })
    ]);
  });

  test('rejects over-limit messages before network transport', async () => {
    const fetchMock = jest.fn();
    const { Source } = loadSource(fetchMock);
    const source = new Source({ endpoint: 'http://api.test' });

    const events = [];
    for await (const event of source.send('a'.repeat(2001))) events.push(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'VALIDATION_ERROR', field: 'message' })
    ]);
  });

  test('checks active response by conversation without requiring generation identifiers', async () => {
    const fetchMock = jest.fn();
    const api = canonicalApi();
    const { Source } = loadSource(fetchMock, { api });
    const source = new Source({ api });

    const status = await source.checkActiveGeneration('thread-1');
    expect(status).toEqual(expect.objectContaining({
      active: true,
      generationId: null,
      sessionId: null,
      startedAt: '2026-08-03T12:00:00.000Z',
      durationSeconds: 4
    }));
    expect(api.getConversationActivity).toHaveBeenCalledWith('thread-1');
    expect(api.getConversationGeneration).not.toHaveBeenCalled();

    await source.stop();
    expect(api.stopConversationActivity).toHaveBeenCalledWith('thread-1');
    expect(api.stopConversationGeneration).not.toHaveBeenCalled();
  });

  test('posts exact-generation stop before aborting an in-flight stream', async () => {
    const sequence = [];
    class TrackedAbortController {
      constructor() {
        this.signal = { aborted: false };
      }
      abort() {
        sequence.push('abort');
        this.signal.aborted = true;
      }
    }
    const streamResponse = responseFromChunks([
      'event: connected\ndata: {"thread_id":"thread-1","generation_id":"generation-1"}\n\n',
      'event: content\ndata: {"content":"still running"}\n\n'
    ]);
    const fetchMock = jest.fn(async () => streamResponse);
    const api = canonicalApi({
      stopConversationActivity: jest.fn(async () => {
        sequence.push('stop-post');
        return { stopped: true };
      })
    });
    const { Source } = loadSource(fetchMock, { AbortController: TrackedAbortController, api });
    const source = new Source({ api });

    const iterator = source.send('hello');
    await expect(iterator.next()).resolves.toEqual(expect.objectContaining({
      value: expect.objectContaining({ type: 'connected', generationId: 'generation-1' }),
      done: false
    }));

    await source.stop();

    expect(api.stopConversationActivity).toHaveBeenCalledWith('thread-1');
    expect(api.stopConversationGeneration).not.toHaveBeenCalled();
    expect(sequence).toEqual(['stop-post', 'abort']);
  });
});
