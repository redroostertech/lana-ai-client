'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function harness() {
  const dom = new JSDOM('<div class="lex-chat-msg-agent-body"></div>');
  const context = { console, document: dom.window.document, Lex: {
    LexElement: class {}, Chat: {}, Modal: { open: jest.fn() }
  } };
  context.window = context;
  context.globalThis = context;
  for (const name of ['lex-chat.format.js', 'lex-chat.message.js', 'lex-chat.js']) {
    const filename = path.resolve(__dirname, '../../src/js/lex/chat', name);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  const message = Object.create(context.Lex.Chat.LexChatMessage.prototype);
  message.querySelector = (selector) => dom.window.document.querySelector(selector);
  message.querySelectorAll = (selector) => dom.window.document.querySelectorAll(selector);
  message.streaming = true;
  message.delegate = jest.fn();
  message.emit = jest.fn();
  const chat = Object.create(context.Lex.Chat.LexChat.prototype);
  return { dom, context, message, chat };
}

const original = 'E2E (देवनागरी) [2026] <img src=x onerror=bad>.pdf';
const documentCitation = { document_id: 'document-1', filename: 'E2E-_.pdf',
  label: 'legacy label', display_filename: original, source_type: 'document', page_number: 3 };

test('actual source list shows exact original label without changing click identity or routing filename', () => {
  const { dom, message } = harness();
  message.citations = [documentCitation];
  message._renderCitationsSection(message.citations);
  const button = dom.window.document.querySelector('.lex-chat-citation-link');
  expect(button.textContent).toBe(original);
  expect(button.querySelector('img')).toBeNull();
  expect(button.dataset.filename).toBe('legacy label');
  expect(button.dataset.documentId).toBe('document-1');
  message.updated();
  const click = message.delegate.mock.calls.find((call) => call[1] === '.lex-chat-citation-link')[2];
  click({ preventDefault() {} }, button);
  expect(message.emit).toHaveBeenCalledWith('lex-citation-click', expect.objectContaining({
    documentId: 'document-1', filename: 'legacy label', page: 3, citation: documentCitation
  }));
  expect(documentCitation.filename).toBe('E2E-_.pdf');
  dom.window.close();
});

test('actual details show escaped original filename while preserving source object', async () => {
  const { dom, context, chat } = harness();
  await chat._showCitationSourceDetails({ citation: documentCitation, filename: 'legacy label' });
  const content = context.Lex.Modal.open.mock.calls[0][0].content;
  const container = dom.window.document.createElement('div');
  container.innerHTML = content;
  expect(container.firstElementChild.firstElementChild.textContent).toBe(original);
  expect(container.querySelector('img')).toBeNull();
  expect(documentCitation.document_id).toBe('document-1');
  dom.window.close();
});

test.each([undefined, null, '', '   ', 7, { name: 'not a string' }])('invalid display label preserves legacy presentation (%p)', async (display) => {
  const { dom, context, message, chat } = harness();
  const citation = { ...documentCitation, display_filename: display };
  message._renderCitationsSection([citation]);
  expect(dom.window.document.querySelector('.lex-chat-citation-link').textContent).toBe('legacy label');
  await chat._showCitationSourceDetails({ citation });
  expect(context.Lex.Modal.open.mock.calls[0][0].content).toContain('legacy label');
  dom.window.close();
});

test.each([{ source: 'domain_pack' }, { source_type: 'domain_pack' }, { authority_id: 'case-1' },
  { source_type: 'legal_authority' }, { source_type: undefined, sourceType: 'legal_authority' }])('authority label is not replaced by display filename (%p)', async (authority) => {
  const { dom, context, message, chat } = harness();
  const citation = { ...documentCitation, ...authority, label: 'Case v. State', citation: '123 Reporter 456', excerpt: 'Authority text' };
  message._renderCitationsSection([citation]);
  expect(dom.window.document.querySelector('.lex-chat-citation-link').textContent).toBe('Case v. State');
  await chat._showCitationSourceDetails({ citation });
  const content = context.Lex.Modal.open.mock.calls[0][0].content;
  expect(content).toContain('Case v. State');
  expect(content).toContain('123 Reporter 456');
  expect(content).not.toContain('देवनागरी');
  dom.window.close();
});
