'use strict';

const fs = require('fs');
const path = require('path');

describe('chat-v2 composer slash command load contract', () => {
  test('loads slash helpers before the Lex composer and chat orchestrator', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/chat-v2.html'), 'utf8');
    const slash = html.indexOf('js/lex/chat/lex-chat.composer-slash.js');
    const composer = html.indexOf('js/lex/chat/lex-chat.composer.js');
    const chat = html.indexOf('js/lex/chat/lex-chat.js');

    expect(slash).toBeGreaterThan(-1);
    expect(composer).toBeGreaterThan(slash);
    expect(chat).toBeGreaterThan(composer);
  });

  test('public_html chat-v2 has the same slash helper load order', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../public_html/chat-v2.html'), 'utf8');
    const slash = html.indexOf('js/lex/chat/lex-chat.composer-slash.js');
    const composer = html.indexOf('js/lex/chat/lex-chat.composer.js');
    const chat = html.indexOf('js/lex/chat/lex-chat.js');

    expect(slash).toBeGreaterThan(-1);
    expect(composer).toBeGreaterThan(slash);
    expect(chat).toBeGreaterThan(composer);
  });

  test('slash autocomplete popover mirrors the mention picker surface', () => {
    const composer = fs.readFileSync(path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.composer.js'), 'utf8');

    expect(composer).toContain('.lex-cmp-mentionpicker');
    expect(composer).toContain('.lex-cmp-slashpicker');
    expect(composer).toContain('max-width: 400px;');
    expect(composer).toContain('max-height: 240px;');
    expect(composer).toContain('align-items: center;');
    expect(composer).toContain('background: var(--lex-chat-bg-elevated, #eef);');
    expect(composer).toContain('color: var(--lex-chat-text-muted, #555);');
  });
});
