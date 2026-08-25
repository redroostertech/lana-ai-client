'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHAT_PATH = path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.js');

function loadChat(artifactPromotion = null) {
  class LexElement {
    constructor() {
      this._props = {};
      this.emitted = [];
    }

    emit(type, detail) {
      this.emitted.push({ type, detail });
    }

    addEventListener() {}
  }

  const context = {
    console,
    document: {
      head: { appendChild() {} },
      createElement: () => ({ textContent: '' })
    },
    Lex: {
      LexElement,
      ChatFormat: {},
      Chat: artifactPromotion ? { ArtifactPromotion: artifactPromotion } : {},
      Utils: { millisecondsSince: () => 1 }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(CHAT_PATH, 'utf8'), context, { filename: CHAT_PATH });
  return context.Lex.Chat.LexChat;
}

function artifactHarness(artifactPromotion = null) {
  const LexChat = loadChat(artifactPromotion);
  const chat = new LexChat();
  let assistant = null;
  chat._threadEl = {
    getLastAssistantMessage: jest.fn(() => assistant),
    startAssistantMessage: jest.fn(() => {
      assistant = { streaming: true };
      return assistant;
    })
  };
  chat._activityEl = { hide: jest.fn() };
  return chat;
}

describe('Lex Chat artifact SSE reconciliation', () => {
  test('deduplicates one durable artifact across realtime and completion event paths', () => {
    const chat = artifactHarness();

    chat._handleEvent({
      type: 'agentic_artifacts',
      artifacts: [{
        artifact_id: 'artifact-1',
        artifact_name: 'Workspace evidence memo',
        persistence: { status: 'saved_as_draft', saved: true }
      }]
    }, false);
    chat._handleEvent({
      type: 'agentic_complete',
      artifacts: [{
        artifact_id: 'artifact-1',
        content: 'Terminal copy with complete generated content.',
        actions: [{ id: 'save_to_documents' }]
      }]
    }, false);

    expect(chat._artifacts).toEqual([{
      artifact_id: 'artifact-1',
      artifact_name: 'Workspace evidence memo',
      persistence: { status: 'saved_as_draft', saved: true },
      content: 'Terminal copy with complete generated content.',
      actions: [{ id: 'save_to_documents' }]
    }]);
    expect(chat._threadEl.startAssistantMessage).toHaveBeenCalledTimes(1);
  });

  test('collapses duplicate IDs already present when a later event enriches them', () => {
    const promotion = require('../../src/js/lex/chat/lex-chat-artifact-promotion');
    const chat = artifactHarness(promotion);
    chat._artifacts = [
      { artifact_id: 'artifact-1', artifact_name: 'Draft memo' },
      { artifact_id: 'artifact-1', persistence: { status: 'saved_as_draft' } }
    ];

    chat._handleEvent({
      type: 'agentic_complete',
      artifacts: [{ artifact_id: 'artifact-1', actions: [{ id: 'save_to_documents' }] }]
    }, false);

    expect(chat._artifacts).toEqual([{
      artifact_id: 'artifact-1',
      artifact_name: 'Draft memo',
      persistence: { status: 'saved_as_draft' },
      actions: [{ id: 'save_to_documents' }]
    }]);
  });

  test.each(['file-editor.html', 'file-viewer.html'])(
    '%s loads the shared artifact contract before chat messages',
    (filename) => {
      const html = fs.readFileSync(path.resolve(__dirname, `../../src/${filename}`), 'utf8');
      const contractIndex = html.indexOf('lex-chat-artifact-promotion.js');
      const messageIndex = html.indexOf('lex-chat.message.js');

      expect(contractIndex).toBeGreaterThan(-1);
      expect(messageIndex).toBeGreaterThan(contractIndex);
    }
  );
});
