'use strict';

const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
}

describe('chat-v2 general chat contract', () => {
  test('new chat modal exposes a general chat action only outside picker mode', () => {
    const modal = read('src/js/new-project-modal.js');

    expect(modal).toContain('id="newProjectGeneralChatBtn"');
    expect(modal).toContain('Start General Chat');
    expect(modal).toContain("window.createProjectChat(null, '')");
    expect(modal).toContain("sessionStorage.setItem('lana_start_general_chat', '1')");
    expect(modal).toContain('(isPickerMode || this._renderOverrides.hideGeneralChatBtn)');
  });

  test('chat-v2 creates general sessions without a matter_id payload', () => {
    const controller = read('src/js/chat_v2.js');

    expect(controller).toContain("api.post('/api/v1/chat/sessions', {})");
    expect(controller).toContain('if (!matterId) {');
    expect(controller).toContain('startGeneralChat();');
    expect(controller).toContain("sessionStorage.getItem('lana_start_general_chat') === '1'");
    expect(controller).toContain("syncUrlParams({ session: convId, matter: null })");
  });

  test('lex-chat receives matter-id only for matter-scoped conversations', () => {
    const controller = read('src/js/chat_v2.js');

    expect(controller).toContain('var matterId = _matter && (_matter.matter_id || _matter.id);');
    expect(controller).toContain('if (matterId) {');
    expect(controller).toContain("chatEl.setAttribute('matter-id', matterId);");
    expect(controller).toContain("chatEl.setAttribute('placeholder', 'Ask Lana anything...');");
  });

  test('landing copy no longer implies a matter is required', () => {
    const html = read('src/chat-v2.html');
    const controller = read('src/js/chat_v2.js');

    expect(html).toContain('Select a matter or start a general chat.');
    expect(controller).toContain('Select a matter or start a general chat.');
    expect(html).not.toContain('Select a matter to begin.');
    expect(controller).not.toContain('Select a matter to begin.');
  });
});
