'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function harness() {
  const context = {
    console: { error: jest.fn() },
    document: { head: { appendChild() {} }, createElement: () => ({}) },
    fetch: jest.fn(),
    open: jest.fn(),
    Lex: {
      LexElement: class { constructor() { this._props = {}; } },
      Chat: {},
      Nav: { go: jest.fn() }
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.js'), 'utf8'), context);
  const chat = new context.Lex.Chat.LexChat();
  chat._showSystemMessage = jest.fn();
  chat._showCitationSourceDetails = jest.fn();
  return { chat, context };
}

describe('Citation source navigation', () => {
  test('opens the authenticated file viewer instead of downloading into a popup', async () => {
    const { chat, context } = harness();
    await chat._openCitationSource({ documentId: 'document-1', page: 3, filename: 'Original filename.pdf' });
    expect(context.Lex.Nav.go).toHaveBeenCalledWith('file-viewer.html', {
      params: { id: 'document-1', page: 3 }
    });
    expect(context.fetch).not.toHaveBeenCalled();
    expect(context.open).not.toHaveBeenCalled();
  });

  test('resolves document sourceRef and does not use the source URL as a navigation target', async () => {
    const { chat, context } = harness();
    await chat._openCitationSource({ citation: { sourceType: 'document', sourceRef: 'doc&other=1', url: 'https://untrusted.example' } });
    expect(context.Lex.Nav.go).toHaveBeenCalledWith('file-viewer.html', { params: { id: 'doc&other=1', page: 1 } });
  });

  test.each([0, -1, 1.5, '3#anything', Infinity])('invalid page %s falls back to page one', async (page) => {
    const { chat, context } = harness();
    await chat._openCitationSource({ documentId: 'doc', page });
    expect(context.Lex.Nav.go.mock.calls[0][1].params.page).toBe(1);
  });

  test.each([{ citation: { sourceType: 'domain_pack', document_id: 'not-a-file' } }, {}])('non-document sources retain the source-details view', async (detail) => {
    const { chat, context } = harness();
    await chat._openCitationSource(detail);
    expect(chat._showCitationSourceDetails).toHaveBeenCalledWith(detail);
    expect(context.Lex.Nav.go).not.toHaveBeenCalled();
  });

  test('navigation failures show a useful error instead of silently opening a blank window', async () => {
    const { chat, context } = harness();
    context.Lex.Nav.go.mockRejectedValue(new Error('Viewer unavailable'));
    await chat._openCitationSource({ documentId: 'doc' });
    expect(chat._showSystemMessage).toHaveBeenCalledWith('Could not open document. Please try again.');
  });

  test('real navigation preserves the cited page and encodes the document ID as a single parameter', async () => {
    const { chat, context } = harness();
    context.URLSearchParams = URLSearchParams;
    context.sessionStorage = { removeItem: jest.fn() };
    context.LexRouter = { navigate: jest.fn() };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/js/lex/lex-nav.js'), 'utf8'), context);
    await chat._openCitationSource({ documentId: 'doc&other=1', page: '3' });
    const route = new URL(context.LexRouter.navigate.mock.calls[0][0], 'https://client.example');
    expect(route.pathname).toBe('/file-viewer.html');
    expect(Array.from(route.searchParams.entries())).toEqual([['id', 'doc&other=1'], ['page', '3']]);
  });
});
