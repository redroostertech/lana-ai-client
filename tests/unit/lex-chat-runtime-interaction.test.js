'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function setup() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  class LexElement extends w.EventTarget { emit() {} }
  const render = jest.fn();
  w.Lex = { LexElement, Chat: {}, ChatFormat: {}, BlockRenderer: { render } };
  w.eval(fs.readFileSync(path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.js'), 'utf8'));
  const chat = new w.Lex.Chat.LexChat();
  const container = w.document.createElement('div');
  chat._threadEl = { _container: container, scrollToBottom: jest.fn() };
  chat.conversationId = 'conversation-1';
  chat.send = jest.fn().mockResolvedValue(true);
  const interaction = { id: 'int-1', task_id: 'runtime-1', kind: 'approval', status: 'pending', prompt: 'Delete task "Intake"?' };
  return { dom, w, chat, container, render, interaction };
}

test('approval shows the server proposal, submits the bound decision once, and does not bubble into a second chat send', async () => {
  const { dom, w, chat, container, render, interaction } = setup();
  chat._insertRuntimeInteraction(interaction);
  chat._insertRuntimeInteraction(interaction);
  expect(container.children).toHaveLength(1);
  expect(render.mock.calls[0][1][0]).toMatchObject({ prompt: interaction.prompt, allow_custom: false,
    options: [{ label: 'Approve', value: 'approve' }, { label: 'Decline', value: 'reject' }] });
  const bubbled = jest.fn();
  container.addEventListener('lex-decision', bubbled);
  const controls = render.mock.calls[0][0];
  controls.dispatchEvent(new w.CustomEvent('lex-decision', { bubbles: true, detail: { value: 'reject' } }));
  controls.dispatchEvent(new w.CustomEvent('lex-decision', { bubbles: true, detail: { value: 'approve' } }));
  await new Promise(resolve => setImmediate(resolve));
  expect(chat.send).toHaveBeenCalledTimes(1);
  expect(chat.send).toHaveBeenCalledWith('Decline', { runtimeTaskId: 'runtime-1', runtimeReply: { interaction_id: 'int-1', value: { decision: 'reject' } } });
  expect(bubbled).not.toHaveBeenCalled();
  expect(controls.hidden).toBe(true);
  expect(container.textContent).toContain('Response submitted.');
  dom.window.close();
});

test('a choice uses the exact offered id and ignores clicks after navigation', async () => {
  const { dom, w, chat, render, interaction } = setup();
  chat._insertRuntimeInteraction({ ...interaction, kind: 'question', choices: [{ id: 'c1', label: 'Intake due Friday' }] });
  const controls = render.mock.calls[0][0];
  chat.conversationId = 'another-conversation';
  controls.dispatchEvent(new w.CustomEvent('lex-decision', { bubbles: true, detail: { value: 'c1' } }));
  expect(chat.send).not.toHaveBeenCalled();
  chat.conversationId = 'conversation-1';
  controls.dispatchEvent(new w.CustomEvent('lex-decision', { bubbles: true, detail: { value: 'c1' } }));
  await new Promise(resolve => setImmediate(resolve));
  expect(chat.send).toHaveBeenCalledWith('Intake due Friday', { runtimeTaskId: 'runtime-1', runtimeReply: { interaction_id: 'int-1', value: { choice_id: 'c1' } } });
  dom.window.close();
});

test('wizard preserves server fields and a failed response does not claim submission', async () => {
  const { dom, w, chat, container, render, interaction } = setup();
  const fields = [{ name: 'title', type: 'text', label: 'Title', required: true, value: 'Intake' }];
  chat.send.mockResolvedValue(false);
  chat._insertRuntimeInteraction({ ...interaction, kind: 'wizard', fields });
  expect(render.mock.calls[0][1][0].fields).toEqual(fields);
  const controls = render.mock.calls[0][0];
  controls.dispatchEvent(new w.CustomEvent('lex-form-submit', { bubbles: true, detail: { values: { title: 'Intake' } } }));
  await new Promise(resolve => setImmediate(resolve));
  expect(chat.send.mock.calls[0][1].runtimeReply.value).toEqual({ action: 'submit', values: { title: 'Intake' } });
  expect(controls.hidden).toBe(false);
  expect(container.textContent).toContain('Response not confirmed');
  dom.window.close();
});

test.each([false, true])('refresh restores only a still-pending task interaction (resolved: %s)', async (resolved) => {
  const { dom, chat, container, render, interaction } = setup();
  chat._props = {};
  chat._updateDocumentState = jest.fn();
  chat._showPendingGenerationRecovery = jest.fn();
  chat._threadEl.clear = () => container.replaceChildren();
  chat._threadEl.addMessage = jest.fn();
  const messages = [{ role: 'assistant', content: interaction.prompt,
    metadata: { intelligence_runtime: { task_id: interaction.task_id, interaction } } }];
  if (resolved) messages.push({ role: 'assistant', content: 'You declined this action, so I did not run it.',
    metadata: { intelligence_runtime: { task_id: interaction.task_id, interaction: null } } });
  chat._source = {
    connect: jest.fn().mockResolvedValue(), loadState: jest.fn().mockResolvedValue({}),
    loadHistory: jest.fn().mockResolvedValue({ messages }),
    checkActiveGeneration: jest.fn().mockResolvedValue({ active: false })
  };
  await chat.loadConversation('conversation-1');
  expect(render).toHaveBeenCalledTimes(resolved ? 0 : 1);
  expect(container.children).toHaveLength(resolved ? 0 : 1);
  dom.window.close();
});
