'use strict';

// One "Sources" panel per assistant message: Documents, Legal authority and
// Records (the structured references) as groups shown only when non-empty,
// the quoted passage as the snippet, and document sources opening in the
// in-app file viewer (not a blob window) at the cited page with the quote.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function harness(options = {}) {
  const dom = new JSDOM('<div class="lex-chat-msg-agent-body"></div>');
  class LexElement {
    constructor() { this._props = {}; }
  }
  const context = {
    console,
    document: dom.window.document,
    URLSearchParams,
    Lex: {
      LexElement,
      Chat: {},
      Modal: { open: jest.fn() },
      Nav: options.nav === false ? undefined : { go: jest.fn() }
    },
    location: { pathname: '/app/src/workspace-details.html', search: '?id=matter-1' },
    history: { state: null },
    sessionStorage: { setItem: jest.fn() },
    open: jest.fn(),
    fetch: jest.fn()
  };
  context.window = context;
  context.globalThis = context;
  for (const name of ['lex-chat.format.js', 'lex-chat.message.js', 'lex-chat.js']) {
    const filename = path.resolve(__dirname, '../../src/js/lex/chat', name);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  // Mirror LexElement's reactive props: each declared property reads _props.
  for (const Ctor of [context.Lex.Chat.LexChatMessage, context.Lex.Chat.LexChat]) {
    for (const key of Object.keys(Ctor.properties || {})) {
      Object.defineProperty(Ctor.prototype, key, {
        configurable: true,
        get() { return this._props[key]; },
        set(value) { this._props[key] = value; }
      });
    }
  }
  const message = Object.create(context.Lex.Chat.LexChatMessage.prototype);
  message._props = {};
  message.querySelector = (selector) => dom.window.document.querySelector(selector);
  message.querySelectorAll = (selector) => dom.window.document.querySelectorAll(selector);
  message.delegate = jest.fn();
  message.emit = jest.fn();
  const chat = Object.create(context.Lex.Chat.LexChat.prototype);
  chat._props = {};
  chat._showSystemMessage = jest.fn();
  return { dom, context, message, chat, doc: dom.window.document };
}

const doc1 = {
  document_id: 'doc-1', filename: 'settlement.pdf', source_type: 'document', page_number: 4,
  chunk_text: '1. Recitals This Settlement Agreement is entered into by and between the parties',
  quote: 'The Settling Defendant shall pay the sum of $250,000 within thirty days.'
};
const doc2 = { document_id: 'doc-2', filename: 'memo.docx', sourceType: 'chunk', excerpt: 'Memo body text' };
const authority = { source: 'domain_pack', authority_id: 'case-1', label: 'Case v. State', citation: '123 Reporter 456' };
const record = { type: 'task', id: 'task-1', label: 'Draft response' };

function groupLabels(doc) {
  return [...doc.querySelectorAll('.lex-chat-evidence-group-label')].map((el) => el.textContent);
}

describe('single Sources panel', () => {
  test('replaces the Sources/References tabs with one grouped panel and a total count', () => {
    const { message, doc } = harness();
    message.citations = [doc1, authority, doc2];
    message.references = [record];
    message._renderCitationsSection(message.citations);

    expect(doc.querySelector('[role="tablist"]')).toBeNull();
    expect(doc.querySelector('.lex-chat-evidence-tab')).toBeNull();
    expect(doc.querySelector('.lex-chat-evidence-heading').textContent).toBe('Sources (4)');
    expect(groupLabels(doc)).toEqual(['Documents (2)', 'Legal authority (1)', 'Records (1)']);
    // Citation numbers keep the citation index (inline [n] markers use it).
    const docGroup = doc.querySelector('[data-evidence-group="documents"]');
    expect([...docGroup.querySelectorAll('.lex-chat-citation-num')].map((el) => el.textContent)).toEqual(['1.', '3.']);
    expect([...docGroup.querySelectorAll('.lex-chat-citation-link')].map((el) => el.dataset.citationIndex)).toEqual(['0', '2']);
    expect(doc.querySelector('[data-evidence-group="records"] .lex-chat-reference-link').dataset.referenceIndex).toBe('0');
  });

  test('groups are labelled for assistive tech and empty groups are not shown', () => {
    const { message, doc } = harness();
    message.citations = [doc1];
    message.references = [];
    message._renderCitationsSection(message.citations);

    const section = doc.querySelector('.lex-chat-citations-section');
    const heading = doc.getElementById(section.getAttribute('aria-labelledby'));
    expect(heading.getAttribute('role')).toBe('heading');
    expect(groupLabels(doc)).toEqual(['Documents (1)']);
    const group = doc.querySelector('[role="group"]');
    expect(doc.getElementById(group.getAttribute('aria-labelledby')).textContent).toBe('Documents (1)');
    expect(doc.querySelector('.lex-chat-citation-link').getAttribute('type')).toBe('button');
    expect(doc.body.textContent).not.toContain('No structured references');
    expect(doc.body.textContent).not.toContain('References');
  });

  test('a records-only response shows a Records group', () => {
    const { message, doc } = harness();
    message.references = [record];
    message._renderCitationsSection([]);
    expect(doc.querySelector('.lex-chat-evidence-heading').textContent).toBe('Sources (1)');
    expect(groupLabels(doc)).toEqual(['Records (1)']);
  });

  test('finalize renders the panel for a response that has records but no citations', () => {
    const { message, doc } = harness();
    message._contentEl = doc.createElement('div');
    message._rawContent = '';
    message.finalize({ references: [record] });
    expect(doc.querySelector('.lex-chat-citations-section')).not.toBeNull();
    expect(groupLabels(doc)).toEqual(['Records (1)']);
  });

  test('collapsed panel shows five items and an accessible "more" toggle', () => {
    const { message, doc } = harness();
    message.citations = Array.from({ length: 6 }, (_, i) => ({ ...doc2, document_id: 'doc-' + i }));
    message.references = [record];
    message._renderCitationsSection(message.citations);
    expect(doc.querySelectorAll('.lex-chat-citation-item')).toHaveLength(5);
    const more = doc.querySelector('.lex-chat-citations-more');
    expect(more.textContent).toBe('+ 2 more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    message._expandedCitations = true;
    doc.querySelector('.lex-chat-citations-section').remove();
    message._renderCitationsSection(message.citations);
    expect(doc.querySelectorAll('.lex-chat-citation-item')).toHaveLength(7);
    expect(doc.querySelector('.lex-chat-citations-more').getAttribute('aria-expanded')).toBe('true');
  });

  test('renders a server-authored "What I checked" line only when the field is present', () => {
    const { message, doc } = harness();
    message.citations = [doc1];
    message.grounding = { coverageSummary: 'Read 300 of 300 pages <b>' };
    message._renderCitationsSection(message.citations);
    const line = doc.querySelector('.lex-chat-evidence-coverage');
    expect(line.textContent).toBe('What I checked: Read 300 of 300 pages <b>');
    expect(line.querySelector('b')).toBeNull();

    const other = harness();
    other.message.citations = [doc1];
    other.message.grounding = { groundingStatus: 'grounded' };
    other.message._renderCitationsSection(other.message.citations);
    expect(other.doc.querySelector('.lex-chat-evidence-coverage')).toBeNull();
  });
});

describe('source snippet', () => {
  test('shows the quoted passage instead of the start of the chunk', () => {
    const { message, doc } = harness();
    message.citations = [doc1];
    message._renderCitationsSection(message.citations);
    const snippet = doc.querySelector('.lex-chat-citation-snippet');
    expect(snippet.textContent).toBe(doc1.quote);
    expect(snippet.classList.contains('lex-chat-citation-snippet--quote')).toBe(true);
    expect(doc.body.textContent).not.toContain('1. Recitals');
  });

  test('without a quote keeps the chunk excerpt, shortened at a word boundary', () => {
    const { context } = harness();
    const { citationPassage, truncatePassage } = context.Lex.Chat.Evidence;
    expect(citationPassage({ chunk_text: 'chunk start', excerpt: 'excerpt' })).toEqual({ text: 'chunk start', isQuote: false });
    expect(citationPassage({ quoted_text: '  the   quoted  words ' })).toEqual({ text: 'the quoted words', isQuote: true });
    const long = 'word '.repeat(80).trim();
    const short = truncatePassage(long, 200);
    expect(short.endsWith('word...')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(203);
  });
});

describe('opening a document source', () => {
  test('navigates to the in-app file viewer with page, quote and chunk instead of a blob window', async () => {
    const { context, chat } = harness();
    chat._props.conversationId = 'conv-1';
    chat._props.matterId = 'matter-1';
    const citation = { ...doc1, chunk_index: 7 };
    await chat._openCitationSource({ documentId: 'doc-1', page: 4, citation });

    expect(context.Lex.Nav.go).toHaveBeenCalledWith('file-viewer.html', {
      params: { id: 'doc-1', page: 4, quote: doc1.quote, chunk: 7 },
      context: { referrer: 'workspace-details.html?id=matter-1' }
    });
    expect(context.open).not.toHaveBeenCalled();
    expect(context.fetch).not.toHaveBeenCalled();
    // The viewer's dock reopens the same conversation.
    const [key, raw] = context.sessionStorage.setItem.mock.calls[0];
    expect(key).toBe('lana_dock_pending_action');
    expect(JSON.parse(raw)).toEqual(expect.objectContaining({ type: 'conversation', threadId: 'conv-1', matterId: 'matter-1' }));
  });

  test('without an explicit quote passes the excerpt, and omits an unknown page', () => {
    const { context } = harness();
    const nav = context.Lex.Chat.Evidence.buildCitationViewerNavigation({
      documentId: 'doc-2', citation: doc2, page: 1, referrer: 'dashboard.html'
    });
    expect(nav).toEqual({
      path: 'file-viewer.html',
      params: { id: 'doc-2', quote: 'Memo body text' },
      context: { referrer: 'dashboard.html' }
    });
  });

  test('legal authority keeps the details view and never navigates', async () => {
    const { context, chat } = harness();
    await chat._openCitationSource({ documentId: 'case-1', citation: { ...authority, excerpt: 'Authority text' } });
    expect(context.Lex.Modal.open).toHaveBeenCalled();
    expect(context.Lex.Nav.go).not.toHaveBeenCalled();
  });

  test('the blob-window download path is gone from the citation opener', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.js'), 'utf8');
    const start = source.indexOf('async _openCitationDocument(detail)');
    const end = source.indexOf('_openReference(reference)', start);
    const body = source.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toContain('createObjectURL');
    expect(body).not.toContain('window.open');
  });
});
