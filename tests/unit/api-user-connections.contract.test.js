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

describe('settings-v2 connect button state', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/js/settings-v2.js'),
    'utf8'
  );

  /**
   * settings-v2.js is a self-executing IIFE that calls init() on load, so it
   * cannot be required in isolation. Assert on the structure of the one
   * function instead, which is the same approach the redirect_uri tests above
   * take with this file.
   */
  function connectUserConnectorBody() {
    const start = source.indexOf('function connectUserConnector(');
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf('\n  function ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  }

  test('every branch after the connect call clears the button spinner', () => {
    const body = connectUserConnectorBody();

    // One set, and one clear per outcome: authorization URL returned (browser
    // opened), no authorization URL returned, and request rejected.
    expect(body.match(/btn\.loading = true/g)).toHaveLength(1);
    expect(body.match(/btn\.loading = false/g)).toHaveLength(3);
  });

  test('the spinner clears on the branch that opens the browser', () => {
    const body = connectUserConnectorBody();
    const opened = body.indexOf('openExternalUrl(');
    const elseBranch = body.indexOf('} else {', opened);

    expect(opened).toBeGreaterThan(-1);
    expect(elseBranch).toBeGreaterThan(opened);

    // The clear must land between opening the browser and the else branch.
    // Without it the row spins forever whenever no deep link ever arrives: the
    // provider refused before redirecting, the user closed the tab, or the deep
    // link failed to route.
    const openedBranch = body.slice(opened, elseBranch);
    expect(openedBranch).toContain('btn.loading = false');
  });

  test('the pending OAuth state survives the spinner reset', () => {
    const body = connectUserConnectorBody();
    const assignPending = body.indexOf('_pendingUserConnectionOAuth = {');
    const opened = body.indexOf('openExternalUrl(');

    // The spinner is presentation. Clearing it must not discard the flow state,
    // or a deep link arriving late would be dropped.
    expect(assignPending).toBeGreaterThan(-1);
    expect(assignPending).toBeLessThan(opened);
    expect(body).not.toContain('_pendingUserConnectionOAuth = null');
  });
});
