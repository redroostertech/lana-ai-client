'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHAT_PATH = path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.js');
const MESSAGE_PATH = path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.message.js');

function loadChat() {
  class LexElement {
    constructor() {
      this._props = {};
      this._listeners = {};
      this.emitted = [];
    }

    emit(type, detail) {
      this.emitted.push({ type, detail });
    }

    addEventListener(type, listener) {
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(listener);
    }

    dispatchEvent(event) {
      const listeners = this._listeners[event.type] || [];
      listeners.forEach((listener) => listener(event));
      return true;
    }
  }

  const context = {
    console,
    setTimeout,
    clearTimeout,
    structuredClone,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
    document: {
      head: { appendChild: jest.fn() },
      createElement: jest.fn(() => ({ textContent: '' })),
      querySelector: jest.fn()
    },
    localStorage: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    },
    Lex: {
      LexElement,
      Chat: {},
      Utils: { millisecondsSince: jest.fn(() => 10) }
    }
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(fs.readFileSync(CHAT_PATH, 'utf8'), context, { filename: CHAT_PATH });
  return context.Lex.Chat.LexChat;
}

function makeHarness(source) {
  const LexChat = loadChat();
  const chat = new LexChat();
  const recoveryMessages = [];

  chat.chatMode = 'general';
  chat.contextType = null;
  chat.matterId = null;
  chat.conversationId = 'conversation-1';
  chat._props.conversationId = 'conversation-1';
  chat._source = source;
  chat._processMessageMentions = jest.fn();
  chat._threadEl = {
    addMessage: jest.fn(() => ({})),
    addSystemMessage: jest.fn((content, meta = {}) => {
      const message = {
        content,
        recovery: meta.recovery || null,
        states: [],
        setRecoveryState(next) {
          this.recovery = Object.assign({}, this.recovery || {}, next || {});
          this.states.push(next);
        }
      };
      recoveryMessages.push(message);
      return message;
    }),
    finalizeLastMessage: jest.fn(),
    getLastAssistantMessage: jest.fn(() => null),
    startAssistantMessage: jest.fn(),
    updateLastAssistantMessage: jest.fn()
  };
  chat._activityEl = {
    clearReasoning: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    update: jest.fn(),
    addReasoningEntry: jest.fn()
  };
  chat._composerEl = {
    clear: jest.fn(),
    hideSuggestions: jest.fn(),
    setGenerating: jest.fn(),
    focus: jest.fn()
  };

  return { chat, recoveryMessages };
}

async function* failedStream(overrides = {}) {
  yield Object.assign({
    type: 'error',
    error: 'Temporary generation failure',
    status: 503,
    code: 'PERSISTENCE_UNAVAILABLE'
  }, overrides);
}

async function* admittedFailedStream() {
  yield { type: 'connected', generationId: 'generation-1' };
  yield {
    type: 'error',
    error: 'Generation timed out',
    status: 503,
    code: 'GENERATION_TIMEOUT'
  };
}

async function* completedStream() {
  yield { type: 'done', messageId: 'assistant-1', processingTimeMs: 10 };
}

async function* activeRetryReceiptStream() {
  yield {
    type: 'retry_receipt',
    terminal: true,
    generationId: 'generation-retry-active',
    generationStatus: 'active',
    contentPersisted: false
  };
}

describe('Lex Chat failed-generation recovery', () => {
  test('a proven pre-admission Retry replays the same scope without another user bubble', async () => {
    const source = {
      connected: true,
      connect: jest.fn(),
      send: jest.fn()
        .mockImplementationOnce(() => failedStream())
        .mockImplementationOnce(() => completedStream())
    };
    const { chat, recoveryMessages } = makeHarness(source);
    chat.chatMode = 'document';
    chat.matterId = 'matter-original';

    const attachments = { files: [{ file_id: 'file-1', name: 'Evidence.pdf' }] };
    const firstResult = await chat.send('Analyze this document', {
      attachments,
      clientRequestId: 'failed-request-id'
    });

    expect(firstResult).toBe(false);
    expect(recoveryMessages).toHaveLength(1);
    expect(recoveryMessages[0].recovery).toEqual(expect.objectContaining({
      label: 'Retry',
      disabled: false,
      status: 'available'
    }));

    const recoveryId = chat._failedAttempt.recoveryId;
    chat.chatMode = 'general';
    chat.matterId = 'matter-changed-after-failure';

    const retryResult = await chat.retryLastFailed({ recoveryId });

    expect(retryResult).toBe(true);
    expect(source.send).toHaveBeenCalledTimes(2);
    const [retryContent, retryOptions] = source.send.mock.calls[1];
    expect(retryContent).toBe('Analyze this document');
    expect(retryOptions).toEqual(expect.objectContaining({
      contextType: 'document_chat',
      matterId: 'matter-original',
      attachments
    }));
    expect(retryOptions.clientRequestId).toBe('failed-request-id');
    expect(chat._threadEl.addMessage).toHaveBeenCalledTimes(1);
    expect(recoveryMessages[0].states).toEqual([
      expect.objectContaining({ label: 'Retrying…', disabled: true }),
      expect.objectContaining({ label: 'Retried', disabled: true })
    ]);
  });

  test('repeated Retry activation cannot create duplicate in-flight sends', async () => {
    let finishRetry;
    const retryGate = new Promise((resolve) => { finishRetry = resolve; });
    async function* delayedCompletedStream() {
      await retryGate;
      yield { type: 'done', messageId: 'assistant-2', processingTimeMs: 10 };
    }

    const source = {
      connected: true,
      connect: jest.fn(),
      send: jest.fn()
        .mockImplementationOnce(() => failedStream())
        .mockImplementationOnce(() => delayedCompletedStream())
    };
    const { chat } = makeHarness(source);

    await chat.send('Try once');
    const recoveryId = chat._failedAttempt.recoveryId;
    const firstRetry = chat.retryLastFailed({ recoveryId });
    await Promise.resolve();
    const duplicateRetry = await chat.retryLastFailed({ recoveryId });

    expect(duplicateRetry).toBe(false);
    expect(source.send).toHaveBeenCalledTimes(2);

    finishRetry();
    await expect(firstRetry).resolves.toBe(true);
    expect(source.send).toHaveBeenCalledTimes(2);
  });

  test('non-retryable validation failures remain visible without a Retry action', async () => {
    const source = {
      connected: true,
      connect: jest.fn(),
      send: jest.fn(() => failedStream({
        error: 'Invalid request',
        status: 400,
        details: { retryable: false }
      }))
    };
    const { chat, recoveryMessages } = makeHarness(source);

    await expect(chat.send('Invalid turn')).resolves.toBe(false);

    expect(chat._failedAttempt).toBeNull();
    expect(recoveryMessages).toHaveLength(1);
    expect(recoveryMessages[0].content).toBe('Error: Invalid request');
    expect(recoveryMessages[0].recovery).toBeNull();
  });

  test('an admitted generation failure retries by generation id without another user bubble', async () => {
    const source = {
      connected: true,
      connect: jest.fn(),
      send: jest.fn()
        .mockImplementationOnce(() => admittedFailedStream())
        .mockImplementationOnce(() => completedStream())
    };
    const { chat, recoveryMessages } = makeHarness(source);

    await expect(chat.send('Do not duplicate this message')).resolves.toBe(false);

    expect(chat._failedAttempt).toEqual(expect.objectContaining({
      options: expect.objectContaining({ retryGenerationId: 'generation-1' })
    }));
    expect(recoveryMessages).toHaveLength(1);
    expect(recoveryMessages[0].recovery).toEqual(expect.objectContaining({ label: 'Retry' }));

    const recoveryId = chat._failedAttempt.recoveryId;
    await expect(chat.retryLastFailed({ recoveryId })).resolves.toBe(true);

    expect(source.send).toHaveBeenCalledTimes(2);
    expect(source.send.mock.calls[1][1]).toEqual(expect.objectContaining({
      retryGenerationId: 'generation-1'
    }));
    expect(chat._threadEl.addMessage).toHaveBeenCalledTimes(1);
  });

  test('an active idempotent retry receipt stays in progress and reloads only after polling settles', async () => {
    jest.useFakeTimers();
    try {
      const source = {
        connected: true,
        connect: jest.fn(),
        send: jest.fn()
          .mockImplementationOnce(() => admittedFailedStream())
          .mockImplementationOnce(() => activeRetryReceiptStream()),
        checkActiveGeneration: jest.fn()
          .mockResolvedValueOnce({ active: true, generationId: 'generation-retry-active' })
          .mockResolvedValueOnce({ active: false })
      };
      const { chat, recoveryMessages } = makeHarness(source);
      chat.loadConversation = jest.fn().mockResolvedValue(undefined);

      await chat.send('Retry without duplicating me');
      const recoveryId = chat._failedAttempt.recoveryId;
      await expect(chat.retryLastFailed({ recoveryId })).resolves.toBe(true);

      expect(recoveryMessages[0].states).toEqual([
        expect.objectContaining({ label: 'Retrying…', disabled: true }),
        expect.objectContaining({ label: 'Retry in progress…', disabled: true, status: 'active' })
      ]);
      expect(chat._activeRetryReceipt).toEqual({
        conversationId: 'conversation-1',
        generationId: 'generation-retry-active'
      });
      expect(chat.loadConversation).not.toHaveBeenCalled();
      expect(chat._composerEl.setGenerating).toHaveBeenLastCalledWith(true);

      await jest.advanceTimersByTimeAsync(2000);
      expect(source.checkActiveGeneration).toHaveBeenCalledTimes(1);
      expect(chat.loadConversation).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(2000);
      expect(source.checkActiveGeneration).toHaveBeenCalledTimes(2);
      expect(chat.loadConversation).toHaveBeenCalledWith('conversation-1');
      expect(chat._activeRetryReceipt).toBeNull();
      expect(chat._composerEl.setGenerating).toHaveBeenLastCalledWith(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('connection failures restore the composer and expose Retry', async () => {
    const connectionError = Object.assign(new Error('Service unavailable'), { status: 503 });
    const source = {
      connected: false,
      connect: jest.fn(() => Promise.reject(connectionError)),
      send: jest.fn()
    };
    const { chat, recoveryMessages } = makeHarness(source);

    await expect(chat.send('Connect and answer')).resolves.toBe(false);

    expect(source.send).not.toHaveBeenCalled();
    expect(chat._activeTurnId).toBeNull();
    expect(chat._composerEl.setGenerating).toHaveBeenLastCalledWith(false);
    expect(chat._activityEl.hide).toHaveBeenCalled();
    expect(recoveryMessages[0].recovery).toEqual(expect.objectContaining({ label: 'Retry' }));
  });

  test('an interrupted persisted user turn retries its generation without resending a user row', () => {
    const source = { connected: true, connect: jest.fn(), send: jest.fn() };
    const { chat, recoveryMessages } = makeHarness(source);
    chat.matterId = 'matter-1';

    chat._showPendingGenerationRecovery({
      role: 'user',
      content: 'Continue the prior analysis',
      attachments: [{ file_id: 'file-2', name: 'Contract.docx' }],
      metadata: {
        context_type: 'document_chat',
        generation_id: 'generation-persisted'
      }
    });

    expect(chat._failedAttempt).toEqual(expect.objectContaining({
      content: 'Continue the prior analysis',
      options: expect.objectContaining({ retryGenerationId: 'generation-persisted' })
    }));
    expect(recoveryMessages[0].recovery).toEqual(expect.objectContaining({ label: 'Retry' }));
  });
});

describe('Lex Chat system-message Retry UI', () => {
  test('renders the recovery action with the shared lex-btn component', () => {
    class LexElement {
      constructor() { this._props = {}; }
      delegate() {}
      emit() {}
    }
    const context = {
      console,
      LanaTime: { nowIso: () => '2026-08-23T12:00:00Z' },
      document: {
        head: { appendChild: jest.fn() },
        createElement: jest.fn(() => ({ textContent: '' }))
      },
      Lex: {
        LexElement,
        Chat: {},
        ChatFormat: {
          escapeHtml: (value) => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
        },
        Utils: {
          startOfLocalDay: () => new Date('2026-08-23T00:00:00Z'),
          daysBetweenLocal: () => 0
        }
      }
    };
    context.window = context;
    context.globalThis = context;
    vm.runInNewContext(fs.readFileSync(MESSAGE_PATH, 'utf8'), context, { filename: MESSAGE_PATH });

    const Message = context.Lex.Chat.LexChatMessage;
    const message = new Message();
    message.role = 'system';
    message.content = 'The generation failed.';
    message.recovery = {
      recoveryId: 'retry-1',
      label: 'Retry',
      disabled: false
    };

    const html = message.render();
    expect(html).toContain('<lex-btn');
    expect(html).toContain('data-chat-retry');
    expect(html).toContain('data-recovery-id="retry-1"');
    expect(html).toContain('variant="secondary"');
    expect(html).toContain('>Retry</lex-btn>');
  });
});
