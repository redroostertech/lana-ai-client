'use strict';

// Phase 10d (O4): a conversation reloaded from history shows the cards of the
// changes its offline answer drafted, not only the answer streamed live.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.console.log = () => {};
  window.eval(read('js/time-utils.js'));
  window.eval(read('js/lex/lex.core.js'));
  window.eval(read('js/lex/lex.utils.js'));
  window.eval(read('js/lex/chat/lex-chat.format.js'));
  window.eval(read('js/offline-copy-status.js'));
  window.eval(read('js/lex/chat/lex-chat.message.js'));
  window.eval(read('js/lex/chat/lex-chat.thread.js'));
  window.Lex.defineLex('lex-chat-message', window.Lex.Chat.LexChatMessage);
  window.Lex.defineLex('lex-chat-thread', window.Lex.Chat.LexChatThread);
  return window;
}

test('a reloaded offline answer shows its drafted change with what the server did; a plain answer shows none (control)', async () => {
  const window = boot();
  const thread = window.document.createElement('lex-chat-thread');
  window.document.body.appendChild(thread);
  await new Promise((r) => window.setTimeout(r, 30));
  const drafted = thread.addMessage('assistant', 'I drafted this for you.', {
    messageId: 'a1',
    offlineDrafts: [{ draft_id: 'd1', tool_id: 'create_matter_task', summary: 'New task: Call Rosa', outcome: 'approval' }]
  });
  const plain = thread.addMessage('assistant', 'Rosa Alvarez is the client contact.', { messageId: 'a2' });
  await new Promise((r) => window.setTimeout(r, 30));
  const card = drafted.querySelector('.lex-chat-msg-draft');
  expect(card).not.toBeNull();
  expect(card.textContent).toContain('New task: Call Rosa');
  expect(card.querySelector('lex-badge').getAttribute('label')).toBe('Waiting for your approval');
  expect(plain.querySelector('.lex-chat-msg-draft')).toBeNull();
});
