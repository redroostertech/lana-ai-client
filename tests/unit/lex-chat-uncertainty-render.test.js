'use strict';

// The uncertainty card, driven by the frame the backend actually sends.
//
// Captured live on 2026-09-24 from POST /conversations/:id/messages/stream
// after "Execute the document summary automation on this matter right now".
// The plan named the automation rather than resolving an id, so the candidate
// carries `id: null`; the synthetic fixtures elsewhere in this suite all carry
// an id, so nothing here had ever rendered the shape the wire carries.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHAT_PATH = path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.js');

const LIVE_UNCERTAINTY_FRAME = {
  uncertainty_kind: 'ambiguous_target',
  prompt: 'I could not match "Automatic Document Summarization" to the exact words you used, so I have not run anything. Did you mean Automatic Document Summarization?',
  candidates: [{ id: null, label: 'Automatic Document Summarization', tool_name: 'execute_automation' }],
  looked_for: 'Execute the document summary automation on this matter right now',
  resolves_by: 'confirmation'
};

function loadChat() {
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

  const render = jest.fn();
  const context = {
    console,
    document: {
      head: { appendChild() {} },
      createElement: () => ({ textContent: '', className: '' })
    },
    Lex: {
      LexElement,
      ChatFormat: {},
      Chat: {},
      BlockRenderer: { render },
      Utils: { millisecondsSince: () => 1 }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(CHAT_PATH, 'utf8'), context, { filename: CHAT_PATH });
  return { LexChat: context.Lex.Chat.LexChat, render };
}

function chatWithThread() {
  const { LexChat, render } = loadChat();
  const chat = new LexChat();
  const appended = [];
  chat._threadEl = {
    _container: {
      querySelector: () => null,
      appendChild: (el) => appended.push(el)
    },
    scrollToBottom: jest.fn()
  };
  return { chat, render, appended };
}

// Same mapping the SSE source applies to the wire frame (lex-chat.source.js).
function mappedEvent(frame) {
  return {
    type: 'uncertainty',
    uncertaintyKind: frame.uncertainty_kind || null,
    prompt: frame.prompt || '',
    candidates: Array.isArray(frame.candidates) ? frame.candidates : [],
    lookedFor: frame.looked_for || null,
    resolvesBy: frame.resolves_by || 'choice'
  };
}

describe('the uncertainty card, given the frame the wire carries', () => {
  test('a candidate with no id still renders by its label, as a yes/no with an escape hatch', () => {
    const { chat, render, appended } = chatWithThread();

    chat._insertUncertaintyBlock(mappedEvent(LIVE_UNCERTAINTY_FRAME));

    expect(appended).toHaveLength(1);
    expect(appended[0].className).toBe('lex-chat-uncertainty');
    expect(render).toHaveBeenCalledTimes(1);
    const [, blocks] = render.mock.calls[0];
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.type).toBe('decision');
    expect(block.prompt).toBe(LIVE_UNCERTAINTY_FRAME.prompt);
    // The LABEL is the value. The backend matches the reply on the label it
    // offered; an id (here there is none) must never be what gets sent.
    expect(block.options).toEqual([
      { label: 'Yes, Automatic Document Summarization', value: 'Yes, Automatic Document Summarization' },
      { label: 'No, not that one', value: 'No, not that one' }
    ]);
    expect(block.allow_custom).toBe(true);
    expect(chat.emitted).toContainEqual({
      type: 'lex-chat-uncertainty',
      detail: { uncertaintyKind: 'ambiguous_target', resolvesBy: 'confirmation', candidates: 1 }
    });
  });

  test('several candidates render as a choice among labels, one card each', () => {
    // Control arm: the yes/no expansion is for a single confirmation only.
    const { chat, render } = chatWithThread();
    chat._insertUncertaintyBlock(mappedEvent({
      ...LIVE_UNCERTAINTY_FRAME,
      resolves_by: 'choice',
      candidates: [
        { id: null, label: 'Automatic Document Summarization', tool_name: 'execute_automation' },
        { id: 'c3d2', label: 'Weekly Matter Digest', tool_name: 'execute_automation' }
      ]
    }));
    const block = render.mock.calls[0][1][0];
    expect(block.options).toEqual([
      { label: 'Automatic Document Summarization', value: 'Automatic Document Summarization' },
      { label: 'Weekly Matter Digest', value: 'Weekly Matter Digest' }
    ]);
  });

  test('a question with nothing nameable renders no card at all', () => {
    const { chat, render, appended } = chatWithThread();
    chat._insertUncertaintyBlock(mappedEvent({
      ...LIVE_UNCERTAINTY_FRAME, candidates: [{ id: 'e078331c', label: '' }]
    }));
    expect(render).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });
});
