'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeContext(api) {
  const defined = {};

  class LexElement {
    constructor() {
      this._props = {};
      this.attributes = {};
    }

    emit() {}

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    removeAttribute(name) {
      delete this.attributes[name];
    }

    _reflectToAttribute(name, value) {
      if (value) this.setAttribute(name, '');
      else this.removeAttribute(name);
    }
  }

  const context = {
    api,
    console,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    },
    document: {
      head: { appendChild: jest.fn() },
      documentElement: {
        style: { setProperty: jest.fn() },
        setAttribute: jest.fn()
      },
      createElement: jest.fn(() => ({
        set id(value) { this._id = value; },
        get id() { return this._id; },
        textContent: ''
      })),
      querySelector: jest.fn()
    },
    Lex: {
      LexElement,
      Chat: {},
      defineLex(name, klass) {
        defined[name] = klass;
      }
    }
  };

  context.window = context;
  context.globalThis = context;
  context.__defined = defined;
  return context;
}

function loadComponent(relativePath, api, tagName) {
  const context = makeContext(api);
  const sourcePath = path.resolve(__dirname, '../..', relativePath);
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return { context, Component: context.__defined[tagName] };
}

describe('LANA dock/panel conversation API routing', () => {
  test('panel createThread prefers a conversation registry wrapper', async () => {
    const api = {
      createConversationRegistryEntry: jest.fn(() => Promise.resolve({
        data: { registryId: 'registry-1', conversationId: 'conversation-1', type: 'ad_hoc' }
      })),
      post: jest.fn()
    };
    const { Component } = loadComponent(
      'src/js/lex/components/chat/lex-lana-panel.js',
      api,
      'lex-lana-panel'
    );
    const panel = new Component();
    panel.matterId = 'matter-1';

    const created = await panel.createThread({ title: 'New Thread' });

    expect(api.createConversationRegistryEntry).toHaveBeenCalledWith({
      title: 'New Thread',
      matter_id: 'matter-1'
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(created).toEqual(expect.objectContaining({
      id: 'registry-1',
      thread_id: 'conversation-1',
      registryId: 'registry-1',
      conversationId: 'conversation-1'
    }));
  });

  test('panel createThread requires the canonical conversation wrapper', async () => {
    const api = {};
    const { Component } = loadComponent(
      'src/js/lex/components/chat/lex-lana-panel.js',
      api,
      'lex-lana-panel'
    );
    const panel = new Component();

    await expect(panel.createThread({ title: 'Missing API Thread' }))
      .rejects.toThrow('canonical conversation create API not available');
  });

  test('dock scope persistence prefers canonical conversation scope wrappers', async () => {
    const api = {
      setConversationMatter: jest.fn(() => Promise.resolve({ ok: true }))
    };
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      api,
      'lex-lana-dock'
    );
    const dock = new Component();
    const refresh = jest.fn();
    dock._panelEl = {
      _chatEl: {
        conversationId: 'conversation-1',
        setAttribute: jest.fn(),
        removeAttribute: jest.fn()
      },
      _threadsEl: { refresh },
      setAttribute: jest.fn(),
      removeAttribute: jest.fn()
    };

    dock._applyScope('matter-1', 'Matter One');
    await Promise.resolve();

    expect(api.setConversationMatter).toHaveBeenCalledWith('conversation-1', 'matter-1');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('panel openConversation loads existing canonical conversation and hydrates recents metadata', async () => {
    const api = {
      getConversation: jest.fn(() => Promise.resolve({
        data: {
          registryId: 'registry-1',
          conversationId: 'conversation-1',
          title: 'Hydrated Chat',
          scope: { matterId: 'matter-1' }
        }
      }))
    };
    const { Component } = loadComponent(
      'src/js/lex/components/chat/lex-lana-panel.js',
      api,
      'lex-lana-panel'
    );
    const panel = new Component();
    panel.threadTitle = 'Fallback Chat';
    panel.contextType = 'full_chat';
    panel.pageScope = 'dashboard';
    panel.setAttribute = jest.fn();
    panel.emit = jest.fn();
    panel._chatEl = {
      clearConversation: jest.fn(),
      loadConversation: jest.fn(),
      setAttribute: jest.fn()
    };
    panel._threadsEl = {
      addThread: jest.fn(),
      setActiveThread: jest.fn()
    };

    const opened = await panel.openConversation('conversation-1', 'matter-1', { matterName: 'Matter One' });

    expect(panel._chatEl.loadConversation).toHaveBeenCalledWith('conversation-1');
    expect(api.getConversation).toHaveBeenCalledWith('conversation-1');
    expect(opened).toEqual(expect.objectContaining({
      id: 'registry-1',
      thread_id: 'conversation-1',
      title: 'Hydrated Chat',
      matter_id: 'matter-1'
    }));
    expect(panel._threadsEl.setActiveThread).toHaveBeenLastCalledWith('registry-1');
    expect(panel.emit).toHaveBeenCalledWith('lex-lana-thread-selected', expect.objectContaining({
      thread: expect.objectContaining({ thread_id: 'conversation-1' })
    }));
  });

  test('panel document search uses canonical conversation document candidates domain API', async () => {
    const api = {
      getConversationDocumentCandidates: jest.fn(() => Promise.resolve({
        document_candidates: [{ id: 'doc-1', filename: 'evidence.pdf' }]
      }))
    };
    const { context, Component } = loadComponent(
      'src/js/lex/components/chat/lex-lana-panel.js',
      api,
      'lex-lana-panel'
    );
    context.Lex.Chat.ConversationsApiClient = class {
      constructor(apiClient) {
        this.api = apiClient;
      }

      getDocumentCandidates(conversationId, options) {
        return this.api.getConversationDocumentCandidates(conversationId, options);
      }
    };
    const panel = new Component();
    panel._chatEl = { conversationId: 'conversation-1' };
    const composer = { setDocumentResults: jest.fn() };

    panel._searchDocuments('evidence', composer);
    await Promise.resolve();

    expect(api.getConversationDocumentCandidates).toHaveBeenCalledWith('conversation-1', {
      search: 'evidence',
      limit: 10
    });
    expect(composer.setDocumentResults).toHaveBeenCalledWith([
      { id: 'doc-1', filename: 'evidence.pdf' }
    ]);
  });

  test('panel prefillPrompt writes composer draft without sending', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/chat/lex-lana-panel.js',
      {},
      'lex-lana-panel'
    );
    const composer = {
      getValue: jest.fn(() => ''),
      setValue: jest.fn(),
      querySelector: jest.fn(() => ({ focus: jest.fn() }))
    };
    const panel = new Component();
    panel._chatEl = {
      querySelector: jest.fn(() => composer),
      send: jest.fn()
    };

    panel.prefillPrompt('Review this tracked change');

    expect(composer.setValue).toHaveBeenCalledWith('Review this tracked change');
    expect(panel._chatEl.send).not.toHaveBeenCalled();
  });

  test('panel prefillPrompt does not overwrite an existing composer draft', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/chat/lex-lana-panel.js',
      {},
      'lex-lana-panel'
    );
    const composer = {
      getValue: jest.fn(() => 'Existing draft'),
      setValue: jest.fn(),
      querySelector: jest.fn(() => ({ focus: jest.fn() }))
    };
    const panel = new Component();
    panel._chatEl = {
      querySelector: jest.fn(() => composer),
      send: jest.fn()
    };

    panel.prefillPrompt('Review this tracked change');

    expect(composer.setValue).not.toHaveBeenCalled();
    expect(panel._chatEl.send).not.toHaveBeenCalled();
  });

  test('dock openConversation delegates to the panel and updates conversation header', async () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    const openedThread = { id: 'registry-1', thread_id: 'conversation-1', title: 'Opened Chat', subtitle: 'Matter One' };
    dock.expand = jest.fn();
    dock._syncScopeLocal = jest.fn();
    dock._setConvo = jest.fn();
    dock._panelEl = {
      openConversation: jest.fn(() => Promise.resolve(openedThread)),
      setContextType: jest.fn(),
      _focusComposer: jest.fn()
    };

    await dock.openConversation('conversation-1', 'matter-1', { contextType: 'full_chat', matterName: 'Matter One' });

    expect(dock.expand).toHaveBeenCalledTimes(1);
    expect(dock._syncScopeLocal).toHaveBeenCalledWith('matter-1', 'Matter One');
    expect(dock._panelEl.openConversation).toHaveBeenCalledWith('conversation-1', 'matter-1', {
      contextType: 'full_chat',
      matterName: 'Matter One'
    });
    expect(dock._setConvo).toHaveBeenCalledWith('Opened Chat', 'Matter One');
    expect(dock._panelEl._focusComposer).toHaveBeenCalledTimes(1);
  });

  test('dock remembers only the active conversation pointer for navigation continuity', () => {
    const { context, Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    context.window.sessionStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };

    dock._rememberActiveConversation({
      id: 'registry-1',
      thread_id: 'conversation-1',
      title: 'Dashboard questions',
      subtitle: 'Matter One',
      matter_id: 'matter-1',
      messages: [{ content: 'Do not persist message text' }]
    });

    expect(context.window.sessionStorage.setItem).toHaveBeenCalledTimes(1);
    expect(context.window.sessionStorage.setItem.mock.calls[0][0]).toBe('lana:lanaDock:activeConversation');
    const payload = JSON.parse(context.window.sessionStorage.setItem.mock.calls[0][1]);
    expect(payload).toEqual(expect.objectContaining({
      threadId: 'conversation-1',
      title: 'Dashboard questions',
      matterId: 'matter-1',
      matterName: 'Matter One'
    }));
    expect(payload.messages).toBeUndefined();
  });

  test('dock restores the active conversation after page navigation', async () => {
    const { context, Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock._collapsed = false;
    dock._panelEl = { _chatEl: { conversationId: null } };
    dock.openConversation = jest.fn(() => Promise.resolve({
      id: 'registry-1',
      thread_id: 'conversation-1',
      title: 'Dashboard questions',
      subtitle: 'Matter One',
      matter_id: 'matter-1'
    }));
    context.window.sessionStorage = {
      getItem: jest.fn(() => JSON.stringify({
        threadId: 'conversation-1',
        title: 'Dashboard questions',
        matterId: 'matter-1',
        matterName: 'Matter One',
        contextType: 'full_chat'
      })),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };

    await dock._restoreActiveConversation();

    expect(context.window.sessionStorage.getItem).toHaveBeenCalledWith('lana:lanaDock:activeConversation');
    expect(dock.openConversation).toHaveBeenCalledWith('conversation-1', 'matter-1', {
      title: 'Dashboard questions',
      matterName: 'Matter One',
      contextType: 'full_chat'
    });
    expect(context.window.sessionStorage.setItem).toHaveBeenCalledWith(
      'lana:lanaDock:activeConversation',
      expect.stringContaining('"threadId":"conversation-1"')
    );
  });

  test('dock clears active conversation continuity when starting a new chat', () => {
    const { context, Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock.expand = jest.fn();
    dock._clearConvo = jest.fn();
    dock._maybeShowSuggestion = jest.fn();
    context.window.sessionStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };

    dock.newChat();

    expect(context.window.sessionStorage.removeItem).toHaveBeenCalledWith('lana:lanaDock:activeConversation');
  });

  test('dock openWith sends an initial prompt after applying matter context', async () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock.expand = jest.fn();
    dock._applyScope = jest.fn();
    dock._panelEl = {
      _chatEl: { send: jest.fn() },
      _focusComposer: jest.fn()
    };

    dock.openWith({ matterId: 'matter-1', matterName: 'Matter One', initialPrompt: 'Discuss this task' });
    await new Promise(resolve => setTimeout(resolve, 320));

    expect(dock.expand).toHaveBeenCalledTimes(1);
    expect(dock._applyScope).toHaveBeenCalledWith('matter-1', 'Matter One');
    expect(dock._panelEl._chatEl.send).toHaveBeenCalledWith('Discuss this task', {
      matterId: 'matter-1'
    });
    expect(dock._panelEl._focusComposer).toHaveBeenCalledTimes(1);
  });

  test('dock trigger supports initial prompt and card context send payload', () => {
    const { context, Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock.openWith = jest.fn();
    context.document.contains = jest.fn(() => true);

    const attrs = {
      'data-lana-context-type': 'document_chat',
      'data-lana-matter-id': 'matter-1',
      'data-lana-document-id': 'file-1',
      'data-lana-document-name': 'affidavit.docx',
      'data-lana-prefill': 'Prefill this',
      'data-lana-initial-prompt': 'Send this',
      'data-lana-card-context': '{"type":"tracked_change","summary":"Replacement: replace A with B."}'
    };
    const trigger = {
      getAttribute: jest.fn(name => attrs[name] || null),
      closest: jest.fn(() => null)
    };
    const event = {
      target: { closest: jest.fn(() => trigger) },
      preventDefault: jest.fn()
    };

    dock._handleDockTriggerClick(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(dock.openWith).toHaveBeenCalledWith(expect.objectContaining({
      contextType: 'document_chat',
      matterId: 'matter-1',
      documentId: 'file-1',
      documentName: 'affidavit.docx',
      prefillPrompt: 'Prefill this',
      initialPrompt: 'Send this',
      cardContext: expect.objectContaining({
        type: 'tracked_change',
        summary: 'Replacement: replace A with B.'
      })
    }));
  });

  test('dock openWith includes document and card context in initial prompt send', async () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock.expand = jest.fn();
    dock._panelEl = {
      _chatEl: { send: jest.fn() },
      _focusComposer: jest.fn(),
      attachFile: jest.fn(),
      attachModuleContext: jest.fn()
    };

    const cardContext = {
      type: 'tracked_change',
      summary: 'Replacement: replace A with B.'
    };

    dock.openWith({
      contextType: 'document_chat',
      documentId: 'file-1',
      documentName: 'affidavit.docx',
      cardContext,
      initialPrompt: 'Review this change'
    });
    await new Promise(resolve => setTimeout(resolve, 320));

    expect(dock._panelEl.attachFile).toHaveBeenCalledWith('file-1', 'affidavit.docx');
    expect(dock._panelEl.attachModuleContext).toHaveBeenCalledWith(cardContext);
    expect(dock._panelEl._chatEl.send).toHaveBeenCalledWith('Review this change', {
      contextType: 'document_chat',
      attachments: {
        files: [{ file_id: 'file-1', name: 'affidavit.docx' }],
        module_context: cardContext
      }
    });
  });

  test('dock page context adds workspace matter scope before fresh sends', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    let beforeSend;
    const panel = {
      addEventListener: jest.fn((name, handler) => {
        if (name === 'lex-lana-before-send') beforeSend = handler;
      })
    };
    dock._pageContext = {
      matterId: 'matter-1',
      matterName: 'Matter One'
    };

    dock._bindPageContextSend(panel);
    const event = { detail: { content: 'Summarize this workspace', opts: { contextType: 'full_chat' } } };
    beforeSend(event);

    expect(event.detail.opts).toEqual({
      contextType: 'full_chat',
      matterId: 'matter-1'
    });
  });

  test('dock page context does not inject matter into an existing conversation send (SCRUM-261)', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    let beforeSend;
    const panel = {
      addEventListener: jest.fn((name, handler) => {
        if (name === 'lex-lana-before-send') beforeSend = handler;
      })
    };
    dock._pageContext = { matterId: 'matter-1', matterName: 'Matter One' };
    // An already-created (possibly unscoped) conversation is on screen —
    // injecting the page matter here triggers a 409 scope mismatch.
    dock._panelEl = { _chatEl: { conversationId: 'conversation-9' } };

    dock._bindPageContextSend(panel);
    const event = { detail: { content: 'Follow-up question', opts: { contextType: 'full_chat' } } };
    beforeSend(event);

    expect(event.detail.opts).toEqual({ contextType: 'full_chat' });
  });

  test('dock page context attaches module context to existing conversation sends (SCRUM-281)', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    let beforeSend;
    const panel = {
      addEventListener: jest.fn((name, handler) => {
        if (name === 'lex-lana-before-send') beforeSend = handler;
      })
    };
    const moduleContext = {
      type: 'ui_card',
      source: 'dashboard',
      ui_label: 'Dashboard window',
      summary: 'Team members: 7'
    };
    dock._pageContext = {
      moduleContext,
      matterId: 'matter-1',
      matterName: 'Matter One'
    };
    dock._panelEl = { _chatEl: { conversationId: 'conversation-9' } };

    dock._bindPageContextSend(panel);
    const event = { detail: { content: 'How many team members do we have?', opts: { contextType: 'full_chat' } } };
    beforeSend(event);

    expect(event.detail.opts).toEqual({
      contextType: 'full_chat',
      attachments: {
        module_context: moduleContext
      }
    });
  });

  test('dock page context keeps explicit composer module context over page context', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    let beforeSend;
    const panel = {
      addEventListener: jest.fn((name, handler) => {
        if (name === 'lex-lana-before-send') beforeSend = handler;
      })
    };
    const explicitContext = {
      type: 'ui_card',
      source: 'reporting',
      summary: 'Selected reporting card'
    };
    dock._pageContext = {
      moduleContext: {
        type: 'ui_card',
        source: 'dashboard',
        summary: 'Team members: 7'
      }
    };

    dock._bindPageContextSend(panel);
    const event = {
      detail: {
        content: 'Explain this',
        opts: {
          contextType: 'full_chat',
          attachments: { module_context: explicitContext }
        }
      }
    };
    beforeSend(event);

    expect(event.detail.opts.attachments.module_context).toBe(explicitContext);
  });

  test('dock adopts page matter scope when a conversation is created on a workspace page (SCRUM-261)', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock._pageContext = { matterId: 'matter-1', matterName: 'Matter One' };
    dock._panelEl = {
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      _chatEl: {
        setAttribute: jest.fn(),
        removeAttribute: jest.fn(),
        querySelector: jest.fn(() => null)
      }
    };

    expect(dock._adoptPageScopeOnCreate()).toBe(true);
    expect(dock._scopeMatterId).toBe('matter-1');
    expect(dock._workspaceName).toBe('Matter One');
    expect(dock._panelEl._chatEl.setAttribute).toHaveBeenCalledWith('matter-id', 'matter-1');

    // Second creation with a scope already applied must not overwrite it.
    dock._pageContext = { matterId: 'matter-2', matterName: 'Matter Two' };
    expect(dock._adoptPageScopeOnCreate()).toBe(false);
    expect(dock._scopeMatterId).toBe('matter-1');
  });

  test('dock page context keeps document attachment injection before sends', () => {
    const { Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    let beforeSend;
    const panel = {
      addEventListener: jest.fn((name, handler) => {
        if (name === 'lex-lana-before-send') beforeSend = handler;
      })
    };
    dock._pageContext = {
      matterId: 'matter-1',
      documentId: 'doc-1',
      documentName: 'affidavit-template.docx'
    };

    dock._bindPageContextSend(panel);
    const event = { detail: { content: 'What fields are incomplete?', opts: { contextType: 'full_chat' } } };
    beforeSend(event);

    expect(event.detail.opts).toEqual({
      contextType: 'document_chat',
      matterId: 'matter-1',
      attachments: {
        files: [{ file_id: 'doc-1', name: 'affidavit-template.docx' }]
      }
    });
  });

  test('dock consumes queued conversation navigation intent from sessionStorage', async () => {
    const { context, Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock.openConversation = jest.fn();
    context.window.sessionStorage = {
      getItem: jest.fn(() => JSON.stringify({
        type: 'conversation',
        threadId: 'conversation-1',
        matterId: 'matter-1'
      })),
      removeItem: jest.fn()
    };

    dock._consumePendingAction();
    await new Promise(resolve => setTimeout(resolve, 320));

    expect(context.window.sessionStorage.getItem).toHaveBeenCalledWith('lana_dock_pending_action');
    expect(context.window.sessionStorage.removeItem).toHaveBeenCalledWith('lana_dock_pending_action');
    expect(dock.openConversation).toHaveBeenCalledWith('conversation-1', 'matter-1');
  });

  test('dock consumes queued matter chat intent from sessionStorage', async () => {
    const { context, Component } = loadComponent(
      'src/js/lex/components/layout/lex-lana-dock.js',
      {},
      'lex-lana-dock'
    );
    const dock = new Component();
    dock.newChat = jest.fn();
    dock.openWith = jest.fn();
    context.window.sessionStorage = {
      getItem: jest.fn(() => JSON.stringify({
        type: 'matter_chat',
        matterId: 'matter-1',
        initialPrompt: 'Discuss this task'
      })),
      removeItem: jest.fn()
    };

    dock._consumePendingAction();
    await new Promise(resolve => setTimeout(resolve, 320));

    expect(dock.newChat).toHaveBeenCalledTimes(1);
    expect(dock.openWith).toHaveBeenCalledWith({
      matterId: 'matter-1',
      contextType: 'full_chat',
      initialPrompt: 'Discuss this task'
    });
  });
});
