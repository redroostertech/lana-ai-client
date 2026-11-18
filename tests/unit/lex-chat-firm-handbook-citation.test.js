'use strict';

// Firm Handbook citations (source 'firm_handbook') get their own "Firm
// Handbook" group first in the Sources panel, read as the item label
// ("Payment schedules (v3)"), and open the handbook reader instead of the
// file viewer, since the snapshot document belongs to no workspace.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

function harness() {
  const dom = new JSDOM('<div></div>');
  class LexElement { constructor() { this._props = {}; } }
  const nav = { go: jest.fn(), href: jest.fn(() => 'file-viewer.html') };
  const context = {
    console,
    document: dom.window.document,
    URLSearchParams,
    Lex: { LexElement, Chat: {}, Modal: { open: jest.fn() }, Nav: nav },
    location: { pathname: '/app/src/dashboard.html', search: '' },
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
  const chat = Object.create(context.Lex.Chat.LexChat.prototype);
  chat._props = {};
  chat._showSystemMessage = jest.fn();
  chat._showCitationSourceDetails = jest.fn(async () => {});
  chat._openCitationDocument = jest.fn(async () => {});
  return { context, chat, nav };
}

const handbookCitation = {
  source: 'firm_handbook',
  authority: 'firm_handbook',
  label: 'Payment schedules (v3)',
  document_id: 'snapshot-1',
  handbook_item_id: 'item-1',
  handbook_version_number: 3
};

describe('Firm Handbook citations', () => {
  test('are their own group, listed before documents', () => {
    const { context } = harness();
    const Evidence = context.Lex.Chat.Evidence;
    const result = Evidence.groupEvidence([
      { source: 'documents', source_type: 'document', document_id: 'd1', label: 'Engagement letter.pdf' },
      handbookCitation
    ], []);
    expect(result.groups.map((g) => [g.label, g.items.map((i) => i.index)]))
      .toEqual([['Firm Handbook', [1]], ['Documents', [0]]]);
    expect(Evidence.citationKind(handbookCitation)).toBe('handbook');
  });

  test('read as the item label, or the title and version when no label comes', () => {
    const { context } = harness();
    expect(context.Lex.Chat.documentCitationDisplayName(handbookCitation)).toBe('Payment schedules (v3)');
    expect(context.Lex.Chat.Evidence.firmHandbookCitationLabel({ source_type: 'firm_handbook', title: 'Fees', version_number: 2 }))
      .toBe('Fees (v2)');
  });

  test('open the handbook reader for the cited item, not the file viewer', async () => {
    const { chat, nav } = harness();
    await chat._openCitationSource({ citation: handbookCitation, documentId: 'snapshot-1' });
    expect(nav.go).toHaveBeenCalledWith('firm-handbook.html', { params: { id: 'item-1' } });
    expect(chat._openCitationDocument).not.toHaveBeenCalled();
  });

  test('without an item id they show the source details instead', async () => {
    const { chat, nav } = harness();
    await chat._openCitationSource({ citation: { source: 'firm_handbook', label: 'Fees (v1)' } });
    expect(nav.go).not.toHaveBeenCalled();
    expect(chat._showCitationSourceDetails).toHaveBeenCalled();
  });

  test('ordinary document citations still open the file viewer path', async () => {
    const { chat } = harness();
    await chat._openCitationSource({ citation: { source_type: 'document', document_id: 'd1' } });
    expect(chat._openCitationDocument).toHaveBeenCalled();
  });

  test('the source details name the kind', () => {
    const { chat } = harness();
    expect(chat._getCitationSourceKind(handbookCitation).label).toBe('Firm Handbook');
  });

  test('an inline (extracts N) marker for a handbook passage carries the citation, so it opens by item', () => {
    const { context } = harness();
    const message = Object.create(context.Lex.Chat.LexChatMessage.prototype);
    message._props = {};
    const handlers = {};
    message.delegate = (event, selector, fn) => { handlers[selector] = fn; };
    message.querySelector = () => null;
    message.querySelectorAll = () => [];
    message.emit = jest.fn();
    Object.defineProperty(message, 'citations', { value: [{ source_type: 'document', document_id: 'd1' }, handbookCitation] });
    message.updated();
    const click = (dataset) => handlers['.lex-chat-citation-link']({ preventDefault() {} }, { dataset });

    click({ citationNum: '2', documentId: 'snapshot-1', page: '1' });
    expect(message.emit).toHaveBeenLastCalledWith('lex-citation-click', expect.objectContaining({ citation: handbookCitation }));

    // Document markers keep their old shape (no citation object), unchanged.
    click({ citationNum: '1', documentId: 'd1', page: '1' });
    expect(message.emit).toHaveBeenLastCalledWith('lex-citation-click', expect.objectContaining({ citation: null, documentId: 'd1' }));
  });
});

