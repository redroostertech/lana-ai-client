'use strict';

const fs = require('fs');
const path = require('path');

const chatJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/lex/chat/lex-chat.js'),
  'utf8'
);
const sourceJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/lex/chat/lex-chat.source.js'),
  'utf8'
);
const messageJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/lex/chat/lex-chat.message.js'),
  'utf8'
);

describe('lex chat attachment display contract', () => {
  test('renders sent module context attachments on user message bubbles', () => {
    expect(chatJs).toContain('const sendOpts = this._buildSendOptions(opts);');
    expect(chatJs).toContain('const messageAttachments = this._messageAttachmentsFromSendOptions(sendOpts);');
    expect(chatJs).toContain("type: 'module_context'");
    expect(chatJs).toContain('moduleContext.ui_label');
    expect(chatJs).toContain('moduleContext.summary');
    expect(chatJs).toContain('moduleContext.selection && moduleContext.selection.text');
    expect(chatJs).toContain('moduleContext.revision && moduleContext.revision.text');
    expect(chatJs).toContain('moduleContext.details && moduleContext.details.change_summary');
    expect(sourceJs).toContain('attachments: (m.metadata && m.metadata.attachments) || m.attachments || []');
    expect(messageJs).toContain('ATTACH_CONTEXT_ICON');
    expect(messageJs).toContain("item.type === 'module_context'");
    expect(messageJs).toContain('lex-chat-msg-attachment--context');
    expect(messageJs).toContain('lex-chat-msg-attachment-summary');
  });

  test('queues a new-thread document attach until the first message is persisted', () => {
    expect(chatJs).toContain('const shouldDeferUntilFirstResponse = this._conversationRegistered !== true');
    expect(chatJs).toContain('if (shouldDeferUntilFirstResponse ||');
    expect(chatJs).toContain('this._pendingDocumentAdds.some((document) => document.id === id)');
    expect(chatJs).toContain('this._source.addDocument(d.id, d.name, this.matterId)');
  });
});
