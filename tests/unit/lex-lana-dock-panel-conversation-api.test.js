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
      setItem: jest.fn()
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
    expect(dock._panelEl._chatEl.send).toHaveBeenCalledWith('Discuss this task');
    expect(dock._panelEl._focusComposer).toHaveBeenCalledTimes(1);
  });
});
