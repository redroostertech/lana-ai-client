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
});
