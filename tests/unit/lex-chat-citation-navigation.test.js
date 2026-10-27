'use strict';

// A chat citation opens the in-app, authenticated file viewer: never a blob
// popup, never the source URL. On this branch the viewer is hosted in a
// lex-modal over the current page (lex-chat-source-modal.test.js covers the
// modal itself); these cases pin what the viewer is asked to open: the
// document id as one parameter, the cited page when it is a real page
// number, and the source-details view for anything that is not a document.
// Ported from the file-viewer navigation version of this test (c851ce7).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const tick = (window, ms = 40) => new Promise((resolve) => window.setTimeout(resolve, ms));

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/src/workspace-details.html?id=matter-1',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  for (const rel of ['js/lex/lex.core.js', 'js/lex/components/foundation/lex-modal.js', 'js/lex/lex-nav.js',
    'js/lex/chat/lex-chat.format.js', 'js/lex/chat/lex-chat.message.js', 'js/lex/chat/lex-chat.js']) {
    window.eval(read(rel));
  }
  window.Lex.Nav.go = jest.fn();
  window.open = jest.fn();
  window.fetch = jest.fn();
  const chat = Object.create(window.Lex.Chat.LexChat.prototype);
  chat._props = { conversationId: 'conv-1', matterId: 'matter-1' };
  for (const key of ['conversationId', 'matterId']) {
    Object.defineProperty(chat, key, { get() { return this._props[key]; } });
  }
  chat._showSystemMessage = jest.fn();
  chat._showCitationSourceDetails = jest.fn();
  return { window, chat };
}

async function viewerUrl(env) {
  await tick(env.window);
  const frame = env.window.document.querySelector('lex-modal iframe.lex-chat-source-viewer-frame');
  return frame ? new URL(frame.getAttribute('src'), 'http://localhost/src/') : null;
}

describe('Citation source navigation', () => {
  test('opens the authenticated in-app viewer instead of downloading into a popup', async () => {
    const env = boot();
    await env.chat._openCitationSource({ documentId: 'document-1', page: 3, filename: 'Original filename.pdf' });
    const url = await viewerUrl(env);
    expect(url.pathname.endsWith('/src/file-viewer.html')).toBe(true);
    expect(url.searchParams.get('id')).toBe('document-1');
    expect(url.searchParams.get('page')).toBe('3');
    expect(env.window.fetch).not.toHaveBeenCalled();
    expect(env.window.open).not.toHaveBeenCalled();
    expect(env.window.Lex.Nav.go).not.toHaveBeenCalled();
  });

  test('resolves a document sourceRef and never uses the source URL as a navigation target', async () => {
    const env = boot();
    await env.chat._openCitationSource({ citation: { sourceType: 'document', sourceRef: 'doc&other=1', url: 'https://untrusted.example' } });
    const url = await viewerUrl(env);
    expect(url.searchParams.get('id')).toBe('doc&other=1');
    expect(url.searchParams.has('url')).toBe(false);
    expect(url.host).toBe('localhost');
  });

  test.each([0, -1, 1.5, '3#anything', Infinity])('invalid page %s is not sent, so the viewer opens at page one', async (page) => {
    const env = boot();
    await env.chat._openCitationSource({ documentId: 'doc', page });
    const url = await viewerUrl(env);
    expect(url.searchParams.get('id')).toBe('doc');
    expect(url.searchParams.has('page')).toBe(false);
  });

  test.each([{ citation: { sourceType: 'domain_pack', document_id: 'not-a-file' } }, {}])('non-document sources retain the source-details view', async (detail) => {
    const env = boot();
    await env.chat._openCitationSource(detail);
    expect(env.chat._showCitationSourceDetails).toHaveBeenCalledWith(detail);
    expect(await viewerUrl(env)).toBeNull();
  });

  test('a missing viewer shows a useful error instead of silently opening a blank window', async () => {
    const env = boot();
    delete env.window.Lex.Modal;
    await env.chat._openCitationSource({ documentId: 'doc' });
    expect(env.chat._showSystemMessage).toHaveBeenCalledWith('Could not open document. Please try again.');
    expect(env.window.open).not.toHaveBeenCalled();
  });

  test('the viewer URL keeps the cited page and the document id as single, encoded parameters', async () => {
    const env = boot();
    await env.chat._openCitationSource({ documentId: 'doc&other=1', page: '3' });
    const url = await viewerUrl(env);
    expect(Array.from(url.searchParams.entries())).toEqual([['id', 'doc&other=1'], ['page', '3'], ['chrome', 'embedded']]);
  });
});
