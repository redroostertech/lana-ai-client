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

describe('ApiClient user connection OAuth contract', () => {
  test('starts authorization without sending a client-chosen redirect_uri', async () => {
    const api = loadApi();
    api.post = jest.fn().mockResolvedValue({});

    await api.connectUserConnection('google-drive');

    expect(api.post).toHaveBeenCalledWith('/api/v1/me/connections/google-drive/connect', {});
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('redirect_uri');
  });

  test('still forwards a redirect_uri when a caller explicitly supplies one', async () => {
    const api = loadApi();
    api.post = jest.fn().mockResolvedValue({});

    await api.connectUserConnection('quickbooks', 'https://example.test/oauth/callback/quickbooks');

    expect(api.post).toHaveBeenCalledWith('/api/v1/me/connections/quickbooks/connect', {
      redirect_uri: 'https://example.test/oauth/callback/quickbooks'
    });
  });

  test('completes authorization with only the code and state', async () => {
    const api = loadApi();
    api.post = jest.fn().mockResolvedValue({});

    await api.completeUserConnection('google-drive', { code: 'abc', state: 'xyz' });

    expect(api.post).toHaveBeenCalledWith('/api/v1/me/connections/google-drive/complete', {
      code: 'abc',
      state: 'xyz'
    });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('redirect_uri');
  });

  test('still forwards a redirect_uri supplied by a completion caller', async () => {
    const api = loadApi();
    api.post = jest.fn().mockResolvedValue({});

    await api.completeUserConnection('quickbooks', {
      code: 'abc',
      state: 'xyz',
      redirect_uri: 'https://example.test/oauth/callback/quickbooks'
    });

    expect(api.post).toHaveBeenCalledWith('/api/v1/me/connections/quickbooks/complete', {
      code: 'abc',
      state: 'xyz',
      redirect_uri: 'https://example.test/oauth/callback/quickbooks'
    });
  });
});

describe('Plugins settings never hardcodes an OAuth redirect target', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/js/settings-v2.js'),
    'utf8'
  );

  test('settings-v2.js does not define a custom-scheme redirect URI', () => {
    expect(source).not.toContain('lana-ai://oauth/callback');
    expect(source).not.toContain('USER_CONNECTION_REDIRECT_URI');
  });

  test('settings-v2.js does not send redirect_uri on user connection calls', () => {
    expect(source).not.toContain('redirect_uri');
  });
});
