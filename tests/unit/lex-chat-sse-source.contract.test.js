'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSource(fetchMock, overrides = {}) {
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
    Lex: {}
  };
  context.window = context;
  context.globalThis = context;

  const sourcePath = path.join(__dirname, '../../src/js/lex/chat/lex-chat.source.js');
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return { context, Source: context.Lex.Chat.SSEChatSource };
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
  test('sends client_request_id and captures server generation_id', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(responseFromChunks([
        'event: connected\ndata: {"thread_id":"thread-1","generation_id":"generation-1"}\n\n',
        'event: done\ndata: {"thread_id":"thread-1","generation_id":"generation-1","message_id":"assistant-1"}\n\n'
      ]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    const { Source } = loadSource(fetchMock);
    const source = new Source({ endpoint: 'http://api.test' });

    const events = [];
    for await (const event of source.send('hello')) events.push(event);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual(expect.objectContaining({
      message: 'hello',
      client_request_id: '11111111-1111-4111-8111-111111111111'
    }));
    expect(events).toEqual([
      expect.objectContaining({ type: 'connected', threadId: 'thread-1', generationId: 'generation-1' }),
      expect.objectContaining({ type: 'done', messageId: 'assistant-1', generationId: 'generation-1' })
    ]);

    await source.stop();
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/streaming/chat/stream');
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/api/v1/streaming/sessions/generation-1/stop');
  });

  test('streams into an existing conversation through the canonical conversation route', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(responseFromChunks([
        'event: done\ndata: {"thread_id":"thread-1","generation_id":"generation-1","message_id":"assistant-1"}\n\n'
      ]))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    const { Source } = loadSource(fetchMock);
    const source = new Source({ endpoint: 'http://api.test' });
    await source.connect('thread-1');

    const events = [];
    for await (const event of source.send('hello again')) events.push(event);

    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/conversations/thread-1/messages/stream');
    expect(events).toEqual([
      expect.objectContaining({ type: 'done', messageId: 'assistant-1', generationId: 'generation-1' })
    ]);

    await source.stop();
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/api/v1/conversations/thread-1/generation/stop');
  });

  test('parses fragmented frames and final frame without trailing blank line', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(responseFromChunks([
      'event: content\ndata: {"content":"hel',
      'lo"}\n\n',
      'event: error\ndata: {"reason_code":"INTERNAL_ERROR","generation_id":"generation-1"}'
    ]));
    const { Source } = loadSource(fetchMock);
    const source = new Source({ endpoint: 'http://api.test' });

    const events = [];
    for await (const event of source.send('hello')) events.push(event);

    expect(events).toEqual([
      { type: 'content', text: 'hello' },
      expect.objectContaining({ type: 'error', code: 'INTERNAL_ERROR', generationId: 'generation-1' })
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

  test('checks active generation by thread and stores returned generation id for stop', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: true,
          thread_id: 'thread-1',
          generation_id: 'generation-1',
          client_id: 'client-1'
        })
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    const { Source } = loadSource(fetchMock);
    const source = new Source({ endpoint: 'http://api.test' });

    const status = await source.checkActiveGeneration('thread-1');
    expect(status).toEqual(expect.objectContaining({
      active: true,
      generationId: 'generation-1',
      sessionId: 'generation-1'
    }));
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/conversations/thread-1/generation');

    await source.stop();
    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/api/v1/conversations/thread-1/generation/stop');
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
    const fetchMock = jest.fn(async (url) => {
      if (String(url).includes('/stop')) sequence.push('stop-post');
      return String(url).includes('/stop')
        ? { ok: true, json: async () => ({ success: true }) }
        : streamResponse;
    });
    const { Source } = loadSource(fetchMock, { AbortController: TrackedAbortController });
    const source = new Source({ endpoint: 'http://api.test' });

    const iterator = source.send('hello');
    await expect(iterator.next()).resolves.toEqual(expect.objectContaining({
      value: expect.objectContaining({ type: 'connected', generationId: 'generation-1' }),
      done: false
    }));

    await source.stop();

    expect(fetchMock.mock.calls[1][0]).toBe('http://api.test/api/v1/streaming/sessions/generation-1/stop');
    expect(sequence).toEqual(['stop-post', 'abort']);
  });
});
