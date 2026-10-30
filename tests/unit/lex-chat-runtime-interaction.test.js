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

test('approval full review exposes all exact values safely, then submits only the bound decision', async () => {
  const { dom, w, chat, container, render, interaction } = setup();
  const longBody = 'Full note content.\n'.repeat(300) + 'LAST VALUE';
  const args = { action: 'update', task_id: 'task-exact', fields: { description: longBody,
    custom_field: '<img src=x onerror="window.injected=true">', enabled: false, count: 0,
    cleared: null, empty: '', recipients: ['first', { unknown_key: 'last' }] } };
  const before = JSON.stringify(args);
  Object.freeze(args.fields.recipients[1]);
  Object.freeze(args.fields.recipients);
  Object.freeze(args.fields);
  Object.freeze(args);
  chat._insertRuntimeInteraction({ ...interaction, prompt: 'Summary shortened. Review the full change.',
    approval: { action: { arguments: args, arguments_sha256: 'fixed-binding' },
      review: { schema_version: 'lana.approval-review.v1', arguments: args } } });
  const details = container.querySelector('.lex-chat-approval-details');
  const toggle = details.querySelector('lex-btn');
  const values = details.querySelector('.lex-chat-approval-values');
  expect(values.hidden).toBe(true);
  toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(values.hidden).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(values.textContent).toContain(longBody);
  expect(values.textContent).toContain(args.fields.custom_field);
  expect(values.querySelector('img')).toBeNull();
  expect(w.injected).toBeUndefined();
  expect(values.textContent).toContain('Unknown key');
  expect(values.textContent).toContain('last');
  expect(values.textContent).toContain('false');
  expect(values.textContent).toContain('0');
  expect(values.textContent).toContain('No value');
  expect(values.textContent).toContain('Empty text');
  expect(values.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0);
  expect(JSON.stringify(args)).toBe(before);
  expect(chat.send).not.toHaveBeenCalled();
  toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(values.hidden).toBe(true);
  const controls = render.mock.calls[0][0];
  controls.dispatchEvent(new w.CustomEvent('lex-decision', { bubbles: true, detail: { value: 'approve' } }));
  await new Promise(resolve => setImmediate(resolve));
  expect(chat.send).toHaveBeenCalledWith('Approve', { runtimeTaskId: interaction.task_id,
    runtimeReply: { interaction_id: interaction.id, value: { decision: 'approve' } } });
  expect(JSON.stringify(args)).toBe(before);
  dom.window.close();
});

test('empty argument collections stay explicit in full review', () => {
  const { dom, chat, container, interaction } = setup();
  chat._insertRuntimeInteraction({ ...interaction, approval: { review: {
    schema_version: 'lana.approval-review.v1', arguments: { fields: {}, recipients: [] } } } });
  expect(container.textContent).toContain('No fields');
  expect(container.textContent).toContain('Empty list');
  dom.window.close();
});

test.each([null, { schema_version: 'unknown', arguments: { credential: 'SECRET' } }])('legacy or unsupported approval review never displays raw arguments', review => {
  const { dom, chat, container, interaction } = setup();
  chat._insertRuntimeInteraction({ ...interaction, approval: { action: { arguments: { credential: 'SECRET' } }, review } });
  expect(container.querySelector('.lex-chat-approval-details')).toBeNull();
  expect(container.textContent).not.toContain('SECRET');
  dom.window.close();
});

test('full review uses the server redaction rather than raw secret values', () => {
  const { dom, chat, container, interaction } = setup();
  chat._insertRuntimeInteraction({ ...interaction, approval: { action: { arguments: { credential: 'SECRET' } },
    review: { schema_version: 'lana.approval-review.v1', arguments: { credential: '[hidden]' } } } });
  expect(container.textContent).toContain('[hidden]');
  expect(container.textContent).not.toContain('SECRET');
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

function reloadWith(chat, container, messages, live) {
  chat._props = {};
  chat._updateDocumentState = jest.fn();
  chat._showPendingGenerationRecovery = jest.fn();
  chat._threadEl.clear = () => container.replaceChildren();
  chat._threadEl.addMessage = jest.fn();
  chat._source = {
    connect: jest.fn().mockResolvedValue(), loadState: jest.fn().mockResolvedValue({}),
    loadHistory: jest.fn().mockResolvedValue({ messages }),
    checkActiveGeneration: jest.fn().mockResolvedValue({ active: false }),
    loadPendingInteraction: jest.fn().mockResolvedValue(live)
  };
}

test.each([
  ['still pending in the run record', 'live', 1],
  ['answered elsewhere (nothing pending)', null, 0],
  ['the live read failed', undefined, 0],
  ['another interaction is pending now', 'other', 0]
])('reload offers a saved interaction only when it is %s', async (_label, liveKind, rendered) => {
  const { dom, chat, container, render, interaction } = setup();
  const saved = { id: interaction.id, task_id: interaction.task_id, kind: 'wizard', status: 'pending', title: 'Task details', prompt: '',
    fields: [{ name: 'title', type: 'text', label: 'Title', required: true }] };
  const live = liveKind === 'live' ? { ...saved, fields: [{ ...saved.fields[0], value: 'Intake call' }] }
    : liveKind === 'other' ? { ...saved, id: 'int-9' } : liveKind;
  reloadWith(chat, container, [{ role: 'assistant', content: 'Task details',
    metadata: { intelligence_runtime: { task_id: interaction.task_id, interaction: saved } } }], live);
  await chat.loadConversation('conversation-1');
  await new Promise(resolve => setImmediate(resolve));
  expect(chat._source.loadPendingInteraction).toHaveBeenCalledWith('conversation-1');
  expect(render).toHaveBeenCalledTimes(rendered);
  // The live interaction (with its prefilled value) is what is offered.
  if (rendered) expect(render.mock.calls[0][1][0].fields[0].value).toBe('Intake call');
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
    checkActiveGeneration: jest.fn().mockResolvedValue({ active: false }),
    loadPendingInteraction: jest.fn().mockResolvedValue(interaction)
  };
  await chat.loadConversation('conversation-1');
  await new Promise(resolve => setImmediate(resolve));
  expect(render).toHaveBeenCalledTimes(resolved ? 0 : 1);
  expect(container.children).toHaveLength(resolved ? 0 : 1);
  dom.window.close();
});

test('a live dynamic_card frame is handed to the card renderer under the answer', () => {
  const { dom, w, chat, container } = setup();
  w.LexDynamicCardRenderer = { renderCard: jest.fn() };
  const card = { card_type: 'connector_setup', connector_type: 'stripe', connector_name: 'Stripe', scope: 'org' };
  chat._handleEvent({ type: 'dynamic_card', card }, true);
  expect(w.LexDynamicCardRenderer.renderCard).toHaveBeenCalledWith(card, container);
  dom.window.close();
});

describe('approval for a tool on a third-party MCP server', () => {
  const external = (approval, extra) => ({ id: 'int-mcp', task_id: 'runtime-1', kind: 'approval', status: 'pending',
    prompt: 'Run "Search documents" on Research?', approval, ...(extra || {}) });

  test('shows the server name, tool title, External label and argument summary above the choices, as text only', () => {
    const { dom, chat, container, render } = setup();
    chat._insertRuntimeInteraction(external({
      action: { capability: 'connector_live_action', label: 'Use connector', arguments: {} },
      external: {
        server_name: 'Research <img src=x onerror=alert(1)>',
        tool_title: '<b>Search</b> documents',
        arguments_summary: [{ label: 'query', value: '<script>x</script>' }, 'limit: 5']
      }
    }));
    const header = container.querySelector('.lex-chat-external-approval');
    expect(header).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(header.querySelector('lex-badge').getAttribute('label')).toBe('External');
    expect(header.querySelector('.lex-chat-external-approval-title').textContent).toBe('<b>Search</b> documents');
    expect(header.querySelector('.lex-chat-external-approval-from').textContent).toBe('Provided by Research <img src=x onerror=alert(1)>');
    expect(Array.from(header.querySelectorAll('.lex-chat-external-approval-args li')).map((li) => li.textContent))
      .toEqual(['query: <script>x</script>', 'limit: 5']);
    // The choices still render below, from the same interaction.
    expect(header.nextSibling).toBe(render.mock.calls[0][0]);
    expect(render.mock.calls[0][1][0].options.map((o) => o.value)).toEqual(['approve', 'reject']);
    dom.window.close();
  });

  test('reads the fields from the action arguments when there is no external block', () => {
    const { dom, w } = setup();
    const view = w.Lex.Chat.externalApprovalView(external({
      action: { capability: 'connector_live_action', arguments: { server_name: 'Research', tool_name: 'search', arguments_summary: 'query: retainer' } }
    }));
    expect(view).toEqual(expect.objectContaining({ serverName: 'Research', toolTitle: 'search', argumentsSummary: ['query: retainer'], truncated: false, argumentsFull: '' }));
    dom.window.close();
  });

  test('provider mcp-server marks it external even without a server name', () => {
    const { dom, w } = setup();
    const view = w.Lex.Chat.externalApprovalView(external({ action: { capability: 'connector_live_action', label: 'Search', arguments: { provider: 'mcp-server' } } }));
    expect(view).toEqual(expect.objectContaining({ serverName: 'an external server', toolTitle: 'Search', argumentsSummary: [] }));
    dom.window.close();
  });

  test('other approvals keep the plain decision (no External header)', () => {
    const { dom, w, chat, container, interaction } = setup();
    chat._insertRuntimeInteraction(interaction);
    expect(container.querySelector('.lex-chat-external-approval')).toBeNull();
    expect(w.Lex.Chat.externalApprovalView({ kind: 'approval', approval: { action: { capability: 'connector_live_action', arguments: { connector: 'stripe' } } } })).toBeNull();
    expect(w.Lex.Chat.externalApprovalView({ kind: 'question', external: true })).toBeNull();
    dom.window.close();
  });

  test('a shortened summary also shows everything that will be sent, as text', () => {
    const { dom, chat, container } = setup();
    const hidden = '{\n  "query": "retainer",\n  "extra_12": "<img src=x onerror=alert(1)> matter notes"\n}';
    chat._insertRuntimeInteraction(external({
      external: { server_name: 'Research', tool_title: 'Search', truncated: true, arguments_summary: ['query: retainer', '1 more argument'], arguments_full: hidden }
    }));
    const full = container.querySelector('.lex-chat-external-approval-full');
    expect(full).not.toBeNull();
    expect(full.open).toBe(true);
    expect(full.querySelector('pre').textContent).toBe(hidden);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.lex-chat-external-approval-warning')).toBeNull();
    dom.window.close();
  });

  test('a shortened summary with no full view warns instead', () => {
    const { dom, chat, container } = setup();
    chat._insertRuntimeInteraction(external({
      external: { server_name: 'Research', tool_title: 'Search', truncated: true, arguments_summary: ['query: retainer'] }
    }));
    expect(container.querySelector('.lex-chat-external-approval-full')).toBeNull();
    expect(container.querySelector('.lex-chat-external-approval-warning').textContent).toContain('not shown');
    dom.window.close();
  });

  test('long remote text is bounded', () => {
    const { dom, w } = setup();
    const view = w.Lex.Chat.externalApprovalView(external({ external: { server_name: 'x'.repeat(1000), tool_title: 't', arguments_summary: new Array(50).fill('a') } }));
    expect(view.serverName).toHaveLength(300);
    expect(view.argumentsSummary).toHaveLength(20);
    dom.window.close();
  });
});
