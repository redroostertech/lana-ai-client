'use strict';

// Chat documents: attaching a document is the whole signal (no Document Context
// tool), new threads keep documents until their first message is saved, the
// composer's tools are one-at-a-time modes, and "Manage chat documents" opens
// the chat's own drawer instead of a page-level global.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const CHAT_PATH = path.join(ROOT, 'src/js/lex/chat/lex-chat.js');
const COMPOSER_PATH = path.join(ROOT, 'src/js/lex/chat/lex-chat.composer.js');

class LexElement {
  constructor() {
    this._props = {};
    this._listeners = {};
    this.emitted = [];
  }

  emit(type, detail) {
    this.emitted.push({ type, detail });
    (this._listeners[type] || []).forEach((listener) => listener({ type, detail }));
  }

  addEventListener(type, listener) {
    this._listeners[type] = this._listeners[type] || [];
    this._listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    this._listeners[type] = (this._listeners[type] || []).filter((l) => l !== listener);
  }

  dispatchEvent(event) {
    (this._listeners[event.type] || []).forEach((listener) => listener(event));
    return !event.defaultPrevented;
  }

  querySelector() { return null; }
}

function makeContext(api) {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    structuredClone,
    URLSearchParams,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.defaultPrevented = false;
        Object.assign(this, init);
      }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    },
    document: {
      head: { appendChild: jest.fn() },
      createElement: jest.fn(() => ({ textContent: '' })),
      querySelector: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    },
    localStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
    api,
    Lex: { LexElement, Chat: {}, Utils: { millisecondsSince: jest.fn(() => 10) } }
  };
  context.window = context;
  context.globalThis = context;
  return context;
}

function loadChat(api = {}) {
  const context = makeContext(api);
  context.Lex.Chat.ConversationsApiClient = class {
    constructor(client) { this.client = client; }
    getDocumentCandidates(id, options) { return this.client.getConversationDocumentCandidates(id, options); }
  };
  vm.runInNewContext(fs.readFileSync(CHAT_PATH, 'utf8'), context, { filename: CHAT_PATH });
  const chat = new context.Lex.Chat.LexChat();
  // The real LexElement maps declared properties onto _props; mirror it here.
  Object.defineProperty(chat, 'conversationId', {
    get() { return this._props.conversationId || null; },
    set(value) { this._props.conversationId = value; }
  });
  chat._props.conversationId = null;
  chat.matterId = null;
  chat.contextType = null;
  chat.chatMode = 'general';
  chat._documentsEl = { documents: [] };
  chat._composerEl = { removeDocument: jest.fn(), setDocumentResults: jest.fn() };
  chat._threadEl = { addSystemMessage: jest.fn() };
  chat._source = {
    addDocument: jest.fn(async (id, name) => ({ activeDocuments: [{ id, filename: name }] })),
    removeDocument: jest.fn(async () => ({ activeDocuments: [] })),
    clearDocuments: jest.fn(async () => ({ activeDocuments: [] }))
  };
  chat._bindChildEvents();
  return { chat, context };
}

function loadComposerClass() {
  const context = makeContext({});
  vm.runInNewContext(fs.readFileSync(COMPOSER_PATH, 'utf8'), context, { filename: COMPOSER_PATH });
  return context.Lex.Chat.LexChatComposer;
}

describe('chat documents on a new thread', () => {
  test('adding a document keeps it locally and sends it with the first message', async () => {
    const { chat } = loadChat();
    await chat.addDocument('doc-1', 'Lease.pdf');

    expect(chat._source.addDocument).not.toHaveBeenCalled();
    expect(chat.getDocuments()).toEqual([{ id: 'doc-1', filename: 'Lease.pdf' }]);
    expect(chat._documentsEl.documents).toHaveLength(1);
    expect(chat.emitted.map((e) => e.type)).toContain('lex-chat-documents-change');

    const opts = chat._buildSendOptions({});
    expect(opts.attachments.files).toEqual([{ file_id: 'doc-1', name: 'Lease.pdf' }]);
    expect(opts.contextType).toBeUndefined();
  });

  test('a document already attached in the composer is not sent twice', async () => {
    const { chat } = loadChat();
    await chat.addDocument('doc-1', 'Lease.pdf');
    const opts = chat._buildSendOptions({ attachments: { files: [{ file_id: 'doc-1', name: 'Lease.pdf' }] } });
    expect(opts.attachments.files).toHaveLength(1);
  });

  test('a thread id the server has not saved yet still searches the library and queues', async () => {
    const api = { getConversationDocumentCandidates: jest.fn(), get: jest.fn(async () => ({ files: [] })) };
    const { chat } = loadChat(api);
    chat._props.conversationId = 'pre-assigned-id';

    await chat.searchDocuments('', { limit: 5 });
    await chat.addDocument('doc-1', 'Lease.pdf');

    expect(api.getConversationDocumentCandidates).not.toHaveBeenCalled();
    expect(chat._source.addDocument).not.toHaveBeenCalled();
    expect(chat._buildSendOptions({}).attachments.files).toEqual([{ file_id: 'doc-1', name: 'Lease.pdf' }]);
  });

  test('stops at three documents', async () => {
    const { chat } = loadChat();
    await chat.addDocument('a', 'A');
    await chat.addDocument('b', 'B');
    await chat.addDocument('c', 'C');
    await expect(chat.addDocument('d', 'D')).rejects.toThrow('Maximum of 3 documents');
    expect(chat.getDocuments()).toHaveLength(3);
  });

  test('removing an unsaved document drops it from the next send', async () => {
    const { chat } = loadChat();
    await chat.addDocument('doc-1', 'Lease.pdf');
    await chat.removeDocument('doc-1');

    expect(chat._source.removeDocument).not.toHaveBeenCalled();
    expect(chat._composerEl.removeDocument).toHaveBeenCalledWith('doc-1');
    expect(chat.getDocuments()).toEqual([]);
    expect(chat._buildSendOptions({}).attachments).toBeUndefined();
  });

  test('clearing a new thread needs no server call', async () => {
    const { chat } = loadChat();
    await chat.addDocument('doc-1', 'Lease.pdf');
    await chat.clearDocuments();
    expect(chat._source.clearDocuments).not.toHaveBeenCalled();
    expect(chat.getDocuments()).toEqual([]);
  });
});

describe('chat documents on a saved thread', () => {
  test('adding saves through the conversation and the server list wins', async () => {
    const { chat } = loadChat();
    chat._props.conversationId = 'conversation-1';
    chat._conversationRegistered = true;
    await chat.addDocument('doc-1', 'Lease.pdf');

    expect(chat._source.addDocument).toHaveBeenCalledWith('doc-1', 'Lease.pdf', null);
    expect(chat.getDocuments()).toEqual([{ id: 'doc-1', filename: 'Lease.pdf' }]);
    // The server reloads saved documents itself, so nothing rides along.
    expect(chat._buildSendOptions({}).attachments).toBeUndefined();
  });

  test('a saved document list never changes the chat mode', () => {
    const { chat } = loadChat();
    chat.chatMode = 'agentic';
    chat._updateDocumentState({ mode: 'document', activeDocuments: [{ id: 'doc-1', filename: 'Lease.pdf' }] });
    expect(chat.chatMode).toBe('agentic');
    expect(chat._buildSendOptions({}).contextType).toBe('agentic_mode');
  });
});

describe('document search', () => {
  test('a saved thread asks the conversation for candidates', async () => {
    const api = {
      getConversationDocumentCandidates: jest.fn(async () => ({
        document_candidates: [{ id: 'doc-1', filename: 'Lease.pdf' }]
      })),
      get: jest.fn()
    };
    const { chat } = loadChat(api);
    chat._props.conversationId = 'conversation-1';
    chat._conversationRegistered = true;

    const results = await chat.searchDocuments('lease', { limit: 10 });

    expect(api.getConversationDocumentCandidates).toHaveBeenCalledWith('conversation-1', { search: 'lease', limit: 10 });
    expect(api.get).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: 'doc-1', filename: 'Lease.pdf', name: 'Lease.pdf', meta: '' }]);
  });

  test('a new thread searches the document library', async () => {
    const api = {
      getConversationDocumentCandidates: jest.fn(),
      get: jest.fn(async () => ({ files: [{ id: 'doc-2', original_filename: 'Brief.docx', workspace_name: 'Smith v. Jones' }] }))
    };
    const { chat } = loadChat(api);

    const results = await chat.searchDocuments('brief', { limit: 20 });

    expect(api.getConversationDocumentCandidates).not.toHaveBeenCalled();
    const url = api.get.mock.calls[0][0];
    expect(url).toMatch(/^\/api\/v1\/storage\/library\/files\?/);
    expect(url).toContain('search=brief');
    expect(url).toContain('page_size=20');
    expect(results).toEqual([{ id: 'doc-2', filename: 'Brief.docx', name: 'Brief.docx', meta: 'Smith v. Jones' }]);
  });

  test('the composer # picker is answered by the chat, even before a thread exists', async () => {
    const api = { get: jest.fn(async () => ({ files: [{ id: 'doc-2', filename: 'Brief.docx' }] })) };
    const { chat } = loadChat(api);

    chat.dispatchEvent({ type: 'lex-composer-document-search', detail: { query: 'br' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chat._composerEl.setDocumentResults).toHaveBeenCalledWith([
      { id: 'doc-2', filename: 'Brief.docx', name: 'Brief.docx', meta: '' }
    ]);
  });
});

describe('Manage chat documents', () => {
  test('opens the chat documents drawer', () => {
    const { chat, context } = loadChat();
    context.Lex.Chat.openDocumentsManager = jest.fn();

    chat.dispatchEvent({ type: 'lex-composer-manage-documents' });

    expect(context.Lex.Chat.openDocumentsManager).toHaveBeenCalledWith(chat);
  });

  test('a host that cancels lex-chat-manage-documents keeps its own UI', () => {
    const { chat, context } = loadChat();
    context.Lex.Chat.openDocumentsManager = jest.fn();
    chat.addEventListener('lex-chat-manage-documents', (e) => e.preventDefault());

    chat.dispatchEvent({ type: 'lex-composer-manage-documents' });

    expect(context.Lex.Chat.openDocumentsManager).not.toHaveBeenCalled();
  });
});

describe('composer tools', () => {
  function makeComposer() {
    const Composer = loadComposerClass();
    const composer = Object.create(Composer.prototype);
    composer._props = { activeTools: [] };
    Object.defineProperty(composer, 'activeTools', { get() { return this._props.activeTools; } });
    composer.tools = null;
    composer._toolsLocked = false;
    composer._attachedDocs = [];
    composer.emitted = [];
    composer.emit = function (type, detail) { this.emitted.push({ type, detail }); };
    composer._refreshToolsPopover = jest.fn();
    composer._refreshActiveChips = jest.fn();
    composer._renderDocBadges = jest.fn();
    return composer;
  }

  test('Document Context is no longer a tool', () => {
    const ids = makeComposer()._getTools().map((tool) => tool.id);
    expect(ids).toEqual(['agentic', 'insights_chat']);
  });

  test('choosing a tool replaces the active one', () => {
    const composer = makeComposer();
    composer._toggleTool('agentic');
    composer.emitted = [];
    composer._toggleTool('insights_chat');

    expect(composer.activeTools).toEqual(['insights_chat']);
    expect(composer.emitted).toEqual([
      { type: 'lex-composer-tool-dismiss', detail: { toolId: 'agentic' } },
      { type: 'lex-composer-tool-select', detail: { toolId: 'insights_chat' } }
    ]);
  });

  test('choosing the active tool again turns it off', () => {
    const composer = makeComposer();
    composer._toggleTool('agentic');
    composer._toggleTool('agentic');
    expect(composer.activeTools).toEqual([]);
    expect(composer.emitted.pop()).toEqual({ type: 'lex-composer-tool-dismiss', detail: { toolId: 'agentic' } });
  });

  test('pinning a dashboard card selects Insights so the chip matches the send', () => {
    const composer = makeComposer();
    composer._toggleTool('agentic');
    composer.attachModuleContext({ type: 'module', module_key: 'revenue' });
    expect(composer.activeTools).toEqual(['insights_chat']);
    expect(composer.emitted.pop()).toEqual({ type: 'lex-composer-tool-select', detail: { toolId: 'insights_chat' } });
  });
});

describe('the chat panel', () => {
  test('no longer calls the deleted ChatFileDrawer', () => {
    const files = [
      'src/js/lex/chat/lex-chat.js',
      'src/js/lex/components/chat/lex-lana-panel.js'
    ];
    for (const file of files) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).not.toContain('ChatFileDrawer');
    }
  });
});
