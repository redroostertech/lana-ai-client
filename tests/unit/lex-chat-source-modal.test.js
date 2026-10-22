'use strict';

// A document source opens in a lex-modal over the current page, hosting the
// file viewer (embedded chrome) in an iframe at the cited page and quote.
// No navigation, no new window; X, Escape and backdrop close it, focus goes
// back to the clicked source, and "Open full view" goes to the full page.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
const tick = (window, ms = 40) => new Promise((resolve) => window.setTimeout(resolve, ms));

function boot() {
  const dom = new JSDOM('<!doctype html><body><button id="source">settlement.pdf</button></body>', {
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
  const chat = Object.create(window.Lex.Chat.LexChat.prototype);
  chat._props = { conversationId: 'conv-1', matterId: 'matter-1' };
  for (const key of ['conversationId', 'matterId']) {
    Object.defineProperty(chat, key, { get() { return this._props[key]; } });
  }
  chat._showSystemMessage = jest.fn();
  return { window, chat };
}

const citation = {
  document_id: 'doc-1', filename: 'settlement.pdf', source_type: 'document', page_number: 4, chunk_index: 7,
  quote: 'The Settling Defendant shall pay the sum of $250,000.'
};

async function openSource() {
  const env = boot();
  const trigger = env.window.document.getElementById('source');
  trigger.focus();
  await env.chat._openCitationSource({ documentId: 'doc-1', page: 4, citation });
  await tick(env.window);
  const modal = env.window.document.querySelector('lex-modal');
  const frame = modal && modal.querySelector('iframe.lex-chat-source-viewer-frame');
  return { ...env, trigger, modal, frame };
}

test('opens a large lex-modal hosting the embedded viewer at the cited page and quote, without navigating', async () => {
  const { window, modal, frame } = await openSource();
  expect(modal).not.toBeNull();
  expect(modal.open).toBe(true);
  expect(modal.classList.contains('lex-chat-source-modal')).toBe(true);
  expect(modal.querySelector('.lex-modal-title').textContent).toBe('settlement.pdf');
  expect(modal.querySelector('.lex-modal-panel').style.maxWidth || modal.width).toContain('calc(100vw - 64px)');

  const src = new URL(frame.getAttribute('src'), 'http://localhost/src/');
  expect(src.pathname.endsWith('/src/file-viewer.html')).toBe(true);
  expect(Object.fromEntries(src.searchParams)).toEqual({
    id: 'doc-1', page: '4', quote: citation.quote, chunk: '7', chrome: 'embedded'
  });
  expect(frame.getAttribute('tabindex')).toBe('0');
  expect(window.Lex.Nav.go).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem('lana_dock_pending_action')).toBeNull();
});

test('Escape closes the modal, unloads the viewer and returns focus to the clicked source', async () => {
  const { window, trigger, modal, frame } = await openSource();
  expect(window.document.activeElement).not.toBe(trigger);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(window, 400);
  expect(modal.open).toBe(false);
  expect(modal.isConnected).toBe(false);
  expect(frame.getAttribute('src')).toBe('about:blank');
  expect(window.document.activeElement).toBe(trigger);
});

test('a backdrop click closes the modal', async () => {
  const { window, modal } = await openSource();
  modal.querySelector('[data-action="overlay"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(window, 400);
  expect(modal.isConnected).toBe(false);
});

test('Escape pressed inside the viewer (posted by the embedded page) closes the modal', async () => {
  const { window, trigger, modal, frame } = await openSource();
  window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'lex-embedded-close' }, source: frame.contentWindow }));
  await tick(window, 400);
  expect(modal.isConnected).toBe(false);
  expect(window.document.activeElement).toBe(trigger);
});

test('messages from other windows do not close it', async () => {
  const { window, modal } = await openSource();
  window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'lex-embedded-close' }, source: window }));
  await tick(window, 100);
  expect(modal.open).toBe(true);
});

test('"Open full view" closes the modal and navigates to the file viewer with the same params', async () => {
  const { window, modal } = await openSource();
  const button = modal.querySelector('.lex-modal-header-actions [data-citation-open-full]');
  expect(button.textContent).toBe('Open full view');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  expect(window.Lex.Nav.go).toHaveBeenCalledWith('file-viewer.html', {
    params: { id: 'doc-1', page: 4, quote: citation.quote, chunk: 7 },
    context: { referrer: 'workspace-details.html?id=matter-1' }
  });
  // The full page reopens this conversation in its dock.
  expect(JSON.parse(window.sessionStorage.getItem('lana_dock_pending_action'))).toEqual(
    expect.objectContaining({ type: 'conversation', threadId: 'conv-1', matterId: 'matter-1' })
  );
  await tick(window, 400);
  expect(modal.isConnected).toBe(false);
});

test('legal authority sources keep the details view instead of the viewer modal', async () => {
  const { window, chat } = boot();
  await chat._openCitationSource({
    documentId: 'case-1',
    citation: { source: 'domain_pack', authority_id: 'case-1', label: 'Case v. State', excerpt: 'Authority text' }
  });
  await tick(window);
  expect(window.document.querySelector('iframe.lex-chat-source-viewer-frame')).toBeNull();
  expect(window.document.querySelector('lex-modal .lex-modal-title').textContent).toBe('Source Details');
  expect(window.Lex.Nav.go).not.toHaveBeenCalled();
});

describe('file viewer embedded chrome', () => {
  const Focus = require('../../src/js/file-viewer-citation-focus.js');

  function embeddedDom() {
    const dom = new JSDOM('<!doctype html><html><body><lex-app></lex-app></body></html>', { runScripts: 'outside-only' });
    return dom.window;
  }

  test('only applies inside a host frame with chrome=embedded', () => {
    const win = embeddedDom();
    const inFrame = { parent: {} };
    expect(Focus.isEmbeddedChrome(new URLSearchParams('id=d&chrome=embedded'), inFrame)).toBe(true);
    expect(Focus.isEmbeddedChrome(new URLSearchParams('id=d'), inFrame)).toBe(false);
    expect(Focus.isEmbeddedChrome(new URLSearchParams('chrome=embedded'), win)).toBe(false);
  });

  test('marks the page embedded so its header, sidebar, banner, breadcrumb and dock are hidden', () => {
    const win = embeddedDom();
    Focus.enterEmbeddedChrome(win.document, { parent: { postMessage: jest.fn() } });
    expect(win.document.documentElement.getAttribute('data-lex-chrome')).toBe('embedded');
    expect(win.document.querySelector('lex-app').getAttribute('chrome')).toBe('embedded');
    const css = read('css/file-viewer.css');
    for (const selector of ['lex-sidebar', 'lex-header', 'lex-lana-dock', '#viewerHeader', '#viewerBreadcrumb']) {
      expect(css).toContain(`html[data-lex-chrome="embedded"] ${selector}`);
    }
  });

  test('Escape inside the embedded viewer asks the host to close, unless a viewer overlay is open', () => {
    const win = embeddedDom();
    const parent = { postMessage: jest.fn() };
    Focus.enterEmbeddedChrome(win.document, { parent });
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'lex-embedded-close' }, '*');
    parent.postMessage.mockClear();
    win.document.body.insertAdjacentHTML('beforeend', '<lex-drawer open></lex-drawer>');
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  test('an embedded page never mounts its own LANA dock', () => {
    const dom = new JSDOM('<!doctype html><html data-lex-chrome="embedded"><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    win.eval(read('js/lex/lex.core.js'));
    win.eval(read('js/lex/components/layout/lex-lana-dock.js'));
    win.document.body.appendChild(win.document.createElement('lex-lana-dock'));
    expect(win.document.querySelector('lex-lana-dock')).toBeNull();
    expect(win.Lex.LanaDock && typeof win.Lex.LanaDock.get).not.toBe('function');
  });

  test('file-viewer.html loads the module (which boots embedded chrome) before the shell scripts mount the dock', () => {
    const html = read('file-viewer.html');
    const focus = html.indexOf('<script src="js/file-viewer-citation-focus.js"></script>');
    const dock = html.indexOf('<script src="js/lex/components/layout/lex-lana-dock.js"></script>');
    expect(focus).toBeGreaterThan(-1);
    expect(dock).toBeGreaterThan(focus);
    expect(read('js/file-viewer-citation-focus.js')).toContain('api.bootEmbeddedChrome(window);');
  });
});
