'use strict';

const fs = require('fs');
const path = require('path');

// navigation-helpers.js uses the LanaTime clock utility, which every page
// loads from time-utils.js before it — mirror that load order in the sandbox.
const timeUtilsSrc = fs.readFileSync(
  path.resolve(__dirname, '../../src/js/time-utils.js'),
  'utf8'
);

describe('NavigationHelpers dock-first chat routing', () => {
  let NavigationHelpers;

  beforeEach(() => {
    jest.resetModules();
    global.window = {
      location: {
        pathname: '/src/matters.html',
        search: '',
        href: ''
      },
      document: {
        querySelector: jest.fn()
      },
      Lex: {}
    };
    global.window.sessionStorage = {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };
    global.document = global.window.document;
    global.URLSearchParams = URLSearchParams;
    new Function('window', timeUtilsSrc)(global.window);
    global.LanaTime = global.window.LanaTime;
    NavigationHelpers = require('../../src/js/navigation-helpers.js');
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.LanaTime;
  });

  test('navigateToConversation opens the LANA dock when available', () => {
    const dock = { openConversation: jest.fn() };
    global.window.Lex.LanaDock = { get: jest.fn(() => dock) };
    global.window.Lex.Nav = { go: jest.fn() };

    NavigationHelpers.navigateToConversation('conversation-1', 'matter-1');

    expect(dock.openConversation).toHaveBeenCalledWith('conversation-1', 'matter-1');
    expect(global.window.Lex.Nav.go).not.toHaveBeenCalled();
  });

  test('openMatterDockChat opens the LANA dock with matter context when available', () => {
    const dock = { newChat: jest.fn(), openWith: jest.fn() };
    global.window.Lex.LanaDock = { get: jest.fn(() => dock) };
    global.window.Lex.Nav = { go: jest.fn() };

    NavigationHelpers.openMatterDockChat('matter-1');

    expect(dock.newChat).toHaveBeenCalledTimes(1);
    expect(dock.openWith).toHaveBeenCalledWith({
      matterId: 'matter-1',
      contextType: 'full_chat',
      initialPrompt: null
    });
    expect(global.window.Lex.Nav.go).not.toHaveBeenCalled();
  });

  test('openMatterDockChat forwards queued prompt to the dock and clears it only on dock path', () => {
    const dock = { newChat: jest.fn(), openWith: jest.fn() };
    global.window.Lex.LanaDock = { get: jest.fn(() => dock) };
    global.window.sessionStorage.getItem.mockReturnValue('Discuss this task');

    NavigationHelpers.openMatterDockChat('matter-1');

    expect(dock.newChat).toHaveBeenCalledTimes(1);
    expect(dock.openWith).toHaveBeenCalledWith({
      matterId: 'matter-1',
      contextType: 'full_chat',
      initialPrompt: 'Discuss this task'
    });
    expect(global.window.sessionStorage.removeItem).toHaveBeenCalledWith('lana_chat_prompt');
  });

  test('navigateToConversation falls back to dashboard dock host when no dock is mounted', () => {
    global.window.Lex.Nav = { go: jest.fn() };

    NavigationHelpers.navigateToConversation('conversation-1', 'matter-1');

    expect(global.window.Lex.Nav.go).toHaveBeenCalledWith('dashboard.html');
    const queued = JSON.parse(global.window.sessionStorage.setItem.mock.calls[0][1]);
    expect(global.window.sessionStorage.setItem.mock.calls[0][0]).toBe('lana_dock_pending_action');
    expect(queued).toEqual(expect.objectContaining({
      type: 'conversation',
      threadId: 'conversation-1',
      matterId: 'matter-1'
    }));
  });

  test('openMatterDockChat fallback queues prompt for dashboard dock host', () => {
    global.window.Lex.Nav = { go: jest.fn() };
    global.window.sessionStorage.getItem.mockReturnValue('Discuss this task');

    NavigationHelpers.openMatterDockChat('matter-1');

    expect(global.window.Lex.Nav.go).toHaveBeenCalledWith('dashboard.html');
    const queued = JSON.parse(global.window.sessionStorage.setItem.mock.calls[0][1]);
    expect(queued).toEqual(expect.objectContaining({
      type: 'matter_chat',
      matterId: 'matter-1',
      initialPrompt: 'Discuss this task'
    }));
    expect(global.window.sessionStorage.removeItem).toHaveBeenCalledWith('lana_chat_prompt');
  });

  test('dock host naming resolves and detects dashboard', () => {
    global.window.location.pathname = '/src/settings/account.html';

    expect(NavigationHelpers.resolveDockHostPath()).toBe('../dashboard.html');
    expect(NavigationHelpers.isOnDockHost()).toBe(false);

    global.window.location.pathname = '/src/dashboard.html';

    expect(NavigationHelpers.isOnDockHost()).toBe(true);
  });
});
