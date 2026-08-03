'use strict';

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
      removeItem: jest.fn()
    };
    global.document = global.window.document;
    global.URLSearchParams = URLSearchParams;
    NavigationHelpers = require('../../src/js/navigation-helpers.js');
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
  });

  test('navigateToConversation opens the LANA dock when available', () => {
    const dock = { openConversation: jest.fn() };
    global.window.Lex.LanaDock = { get: jest.fn(() => dock) };
    global.window.Lex.Nav = { go: jest.fn() };

    NavigationHelpers.navigateToConversation('conversation-1', 'matter-1');

    expect(dock.openConversation).toHaveBeenCalledWith('conversation-1', 'matter-1');
    expect(global.window.Lex.Nav.go).not.toHaveBeenCalled();
  });

  test('navigateToMatterChat opens the LANA dock with matter context when available', () => {
    const dock = { newChat: jest.fn(), openWith: jest.fn() };
    global.window.Lex.LanaDock = { get: jest.fn(() => dock) };
    global.window.Lex.Nav = { go: jest.fn() };

    NavigationHelpers.navigateToMatterChat('matter-1');

    expect(dock.newChat).toHaveBeenCalledTimes(1);
    expect(dock.openWith).toHaveBeenCalledWith({
      matterId: 'matter-1',
      contextType: 'full_chat',
      initialPrompt: null
    });
    expect(global.window.Lex.Nav.go).not.toHaveBeenCalled();
  });

  test('navigateToMatterChat forwards queued prompt to the dock and clears it only on dock path', () => {
    const dock = { newChat: jest.fn(), openWith: jest.fn() };
    global.window.Lex.LanaDock = { get: jest.fn(() => dock) };
    global.window.sessionStorage.getItem.mockReturnValue('Discuss this task');

    NavigationHelpers.navigateToMatterChat('matter-1');

    expect(dock.newChat).toHaveBeenCalledTimes(1);
    expect(dock.openWith).toHaveBeenCalledWith({
      matterId: 'matter-1',
      contextType: 'full_chat',
      initialPrompt: 'Discuss this task'
    });
    expect(global.window.sessionStorage.removeItem).toHaveBeenCalledWith('lana_chat_prompt');
  });

  test('navigateToConversation falls back to chat-v2 when no dock is mounted', () => {
    global.window.Lex.Nav = { go: jest.fn() };

    NavigationHelpers.navigateToConversation('conversation-1', 'matter-1');

    expect(global.window.Lex.Nav.go).toHaveBeenCalledWith('chat-v2.html', {
      params: { session: 'conversation-1', matter: 'matter-1' }
    });
  });

  test('navigateToMatterChat fallback leaves queued prompt for chat-v2 to consume', () => {
    global.window.Lex.Nav = { go: jest.fn() };
    global.window.sessionStorage.getItem.mockReturnValue('Discuss this task');

    NavigationHelpers.navigateToMatterChat('matter-1');

    expect(global.window.Lex.Nav.go).toHaveBeenCalledWith('chat-v2.html', {
      params: { matter: 'matter-1' }
    });
    expect(global.window.sessionStorage.removeItem).not.toHaveBeenCalled();
  });
});
