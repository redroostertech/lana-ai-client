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

describe('LANA dock canonical conversation topology', () => {
  test('dock-facing API methods use conversation subresources where the backend facade exists', async () => {
    const api = loadApi();
    api.get = jest.fn().mockResolvedValue({});
    api.patch = jest.fn().mockResolvedValue({});
    api.post = jest.fn().mockResolvedValue({});

    await api.getConversationMessages('conversation/1', { page: 1, limit: 20 });
    await api.getConversationGeneration('conversation/1');
    await api.stopConversationGeneration('conversation/1');
    await api.setConversationMatter('conversation/1', 'matter-1');

    expect(api.get).toHaveBeenNthCalledWith(1, '/api/v1/conversations/conversation%2F1/messages?page=1&limit=20&order=desc');
    expect(api.get).toHaveBeenNthCalledWith(2, '/api/v1/conversations/conversation%2F1/generation');
    expect(api.post).toHaveBeenCalledWith('/api/v1/conversations/conversation%2F1/generation/stop', {});
    expect(api.patch).toHaveBeenCalledWith('/api/v1/conversations/conversation%2F1/scope', { matter_id: 'matter-1' });
  });

  test('conversation registry aliases still point at compatibility metadata routes', async () => {
    const api = loadApi();
    api.post = jest.fn().mockResolvedValue({});
    api.put = jest.fn().mockResolvedValue({});

    await api.createConversationRegistryEntry({ title: 'New chat' });
    await api.updateConversationRegistryEntry('registry/1', { title: 'Renamed' });

    expect(api.post).toHaveBeenCalledWith('/api/v1/conversation-threads', { title: 'New chat' });
    expect(api.put).toHaveBeenCalledWith('/api/v1/conversation-threads/registry%2F1', { title: 'Renamed' });
  });
});
