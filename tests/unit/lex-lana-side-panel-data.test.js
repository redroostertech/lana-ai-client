'use strict';

// The Ask LANA full screen side panel's Context, Sources, Outputs and
// Activity cards: the pure mapping and merging (Lex.Chat.SidePanelData),
// the cards fed by the per-conversation endpoints on reopen, the live
// lex-chat events of a turn, and the lex-chat events that carry them.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

const CONV = '5b5a6731-94c6-4f0c-9116-4205fba18571';
const OTHER = '7e87c836-bb5b-4fc0-bc2b-8a0d68060431';

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/src/dashboard.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  for (const rel of ['js/time-utils.js', 'js/lex/lex.core.js', 'js/lex/lex.utils.js', 'js/lex/chat/lex-chat.format.js', 'js/lex/chat/lex-chat.message.js',
    'js/lex/chat/lex-chat.conversations-api.js', 'js/lex/components/chat/lex-lana-side-panel.data.js',
    'js/lex/components/chat/lex-lana-side-panel.js']) {
    window.eval(read(rel));
  }
  return window;
}

// Payloads in the shapes the backend returns (captured from the live API
// on 2026-10-30 and the route docs in lana-ai-chef conversations.routes.js).
const CONTEXT = {
  context_usage: {
    type: 'context_usage', purpose: 'runtime_records_answer', role: 'answer', percent_used: 18.4,
    tokens_used: 6031, tokens_available: 32768, usable_tokens: 30617, percent_until_compact: 75,
    basis: 'engine', window_source: 'engine', breakdown: { system: 3900, history: 420, rag: 1711, tools: 0 },
    compaction: { status: 'none', before_tokens: null, after_tokens: null, has_rolling_summary: false },
    as_of_message_id: 'a1', as_of: '2026-10-30T14:36:58.611Z'
  }
};
const UNAVAILABLE = {
  context_usage: {
    type: 'context_usage', purpose: null, role: null, percent_used: null, tokens_used: null,
    tokens_available: 32768, usable_tokens: 30617, percent_until_compact: null, basis: 'unavailable',
    window_source: 'engine', breakdown: {}, compaction: { status: 'none' },
    as_of_message_id: 'a1', as_of: '2026-10-30T10:48:57.819Z'
  }
};
const SOURCES = {
  documents: [{ document_id: 'lease', filename: 'Lease.pdf', matter_id: 'MATT-00039', pages: [1, 3], cite_count: 3,
    last_cited_message_id: 'a1', last_cited_at: '2026-10-30T10:00:00.000Z', kind: 'document', selected: false, retrieved: true }],
  authorities: [{ authority_id: 'frcp-26', label: 'FRCP 26', citation: 'Fed. R. Civ. P. 26', url: null, jurisdiction: 'US',
    court: null, domain_pack: 'forge-legal-us', kind: 'authority', cite_count: 1 }],
  records: [],
  totals: { documents: 1, citations: 4 }
};
const OUTPUTS = {
  items: [
    { id: 'a1:call_7', kind: 'entity_change', label: 'File the answer', entity_type: 'task', entity_id: 't1',
      operation: 'created', status: 'applied', matter_id: 'MATT-00039', view_url: '/matters/MATT-00039/tasks/t1',
      created_at: '2026-10-30T10:05:00.000Z', message_id: 'a1' },
    { id: 'art-1', kind: 'draft', label: 'Demand letter', entity_type: 'artifact', entity_id: 'art-1', operation: 'created',
      status: 'saved_as_draft', matter_id: 'MATT-00039', view_url: null, created_at: '2026-10-30T10:04:00.000Z',
      message_id: null, artifact_type: 'memo', version: 1, persistence: {}, canonical_document: null },
    { id: 'appr-1', kind: 'approval', label: 'Approve: create a task on a matter', entity_type: null, entity_id: null,
      operation: null, status: 'pending', matter_id: 'm-uuid', view_url: '/approvals/appr-1',
      created_at: '2026-10-30T10:03:00.000Z', message_id: null, capability: 'create_matter_task', decided_at: null }
  ],
  totals: { items: 3, documents: 0, drafts: 1, entity_changes: 1, approvals: 1 }
};
const ACTIVITY = {
  active: false,
  active_response: null,
  runs: [{ id: 'run-1', title: 'Prepare the filing', status: 'completed', started_at: '2026-10-30T10:00:00.000Z',
    completed_at: '2026-10-30T10:01:00.000Z', steps_completed: 4, total_steps: 4 }],
  tool_calls: [{ call_id: 'call_7', name: 'create_matter_task', label: 'Create a task on a matter', iteration: 2,
    success: true, duration_ms: 412, summary: 'Created task File the answer.', started_at: '2026-10-30T10:05:00.000Z',
    message_id: 'a1', turn_at: '2026-10-30T10:04:00.000Z' }]
};

describe('Lex.Chat.SidePanelData', () => {
  let D;
  beforeAll(() => { D = boot().Lex.Chat.SidePanelData; });

  test('context: a recorded snapshot with its breakdown, rag shown as Sources', () => {
    const view = D.contextView(CONTEXT.context_usage);
    expect(view).toEqual(expect.objectContaining({
      recorded: true, percentUsed: 18.4, tokensUsed: 6031, tokensAvailable: 32768, usableTokens: 30617,
      headroomPercent: 75, level: 'accent', asOf: '2026-10-30T14:36:58.611Z'
    }));
    expect(view.breakdown.map((b) => [b.label, b.tokens])).toEqual([
      ['System', 3900], ['History', 420], ['Sources', 1711], ['Tools', 0]
    ]);
    expect(D.contextView({ percent_used: 92, basis: 'estimate' })).toEqual(expect.objectContaining({ level: 'danger', estimated: true }));
    expect(D.contextView(null)).toBeNull();
  });

  test('context: basis "unavailable" is not recorded and never reads as zero', () => {
    const view = D.contextView(UNAVAILABLE.context_usage);
    expect(view.recorded).toBe(false);
    expect(view.percentUsed).toBeNull();
    expect(view.tokensUsed).toBeNull();
    expect(view.headroomPercent).toBeNull();
    expect(view.breakdown).toEqual([]);
    expect(view.tokensAvailable).toBe(32768);
  });

  test('sources: full history merges with live citations by the same keys', () => {
    const server = D.sourcesFromServer(SOURCES);
    const live = {
      groups: [
        { key: 'documents', items: [{ key: 'lease', kind: 'document', label: 'Lease.pdf', documentId: 'lease', pages: [3, 9], citeCount: 2 }] },
        { key: 'records', items: [{ key: 'task:t1', kind: 'record', label: 'Call client', entityType: 'task', citeCount: 1, reference: {} }] }
      ],
      citationCount: 2
    };
    const merged = D.mergeSources(server, live);
    expect(merged.groups.map((g) => g.key)).toEqual(['documents', 'authority', 'records']);
    expect(merged.groups[0].items).toEqual([expect.objectContaining({ key: 'lease', citeCount: 5, pages: [1, 3, 9] })]);
    expect(merged.groups[0].items[0].citation).toEqual(expect.objectContaining({ document_id: 'lease', page_number: 1 }));
    expect(merged.groups[1].items[0].citation).toEqual(expect.objectContaining({ source: 'domain_pack', authority_id: 'frcp-26' }));
    expect(merged.total).toBe(3);
    expect(merged.citationCount).toBe(6);
    // The server copy is not changed by the merge.
    expect(server.groups.documents[0].pages).toEqual([1, 3]);
  });

  test('outputs: label, kind and status badge per kind', () => {
    const items = D.outputsFromServer(OUTPUTS);
    expect(items.map((i) => [i.kindLabel, i.label, i.badge.label, i.badge.color])).toEqual([
      ['Task', 'File the answer', 'Created', 'green'],
      ['Draft', 'Demand letter', 'Draft', 'gray'],
      ['Approval', 'Approve: create a task on a matter', 'Pending', 'yellow']
    ]);
    const doc = D.outputItem({ id: 'art-2', kind: 'document', entity_type: 'document', status: null,
      canonical_document: { id: 'd9', filename: 'Memo.docx', status: 'saved' }, view_url: '/matters/M1/documents/d9' });
    expect(doc).toEqual(expect.objectContaining({ kindLabel: 'Document', label: 'Memo.docx', badge: { label: 'Saved', color: 'green' } }));
  });

  test('outputs: a live change the server already holds shows once, newest first', () => {
    const server = D.outputsFromServer(OUTPUTS);
    const held = D.outputFromEntityChange({ operation: 'created', entityType: 'task', entityId: 't1', label: 'File the answer' }, '2026-10-30T11:00:00.000Z');
    const fresh = D.outputFromEntityChange({ operation: 'deleted', entityType: 'note', entityId: 'n1', label: 'Old note', viewUrl: null }, '2026-10-30T11:00:00.000Z');
    const merged = D.mergeOutputs(server, [held, fresh]);
    expect(merged.items.map((i) => i.label)).toEqual(['Old note', 'File the answer', 'Demand letter', 'Approve: create a task on a matter']);
    expect(merged.items[0]).toEqual(expect.objectContaining({ live: true, badge: { label: 'Deleted', color: 'red' }, viewUrl: null }));
    expect(merged.totals).toEqual({ items: 4, entityChanges: 2, drafts: 1, documents: 0, approvals: 1 });
  });

  test('activity: tool start and end pair by call id; older streams pair by tool name', () => {
    let calls = D.applyToolEvent([], { phase: 'start', callId: 'call_1', toolName: 'search_documents', label: 'Search documents', iteration: 1, startedAt: 's1' });
    calls = D.applyToolEvent(calls, { phase: 'start', callId: 'call_2', toolName: 'search_documents', iteration: 1, startedAt: 's2' });
    calls = D.applyToolEvent(calls, { phase: 'end', callId: 'call_1', toolName: 'search_documents', success: false, durationMs: 80, summary: 'No access.' });
    expect(calls.map((c) => [c.callId, c.status, c.durationMs, c.summary])).toEqual([
      ['call_1', 'failed', 80, 'No access.'],
      ['call_2', 'running', null, null]
    ]);
    expect(calls[1].label).toBe('Search documents');

    let legacy = D.applyToolEvent([], { phase: 'start', toolName: 'get_matter_data' });
    legacy = D.applyToolEvent(legacy, { phase: 'end', toolName: 'get_matter_data', success: true, durationMs: 1500 });
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toEqual(expect.objectContaining({ status: 'done', durationMs: 1500 }));
  });

  test('activity: stored history plus live calls, newest first, running from either side', () => {
    const view = D.activityView(ACTIVITY);
    expect(view.runs[0]).toEqual(expect.objectContaining({ title: 'Prepare the filing', stepsCompleted: 4, totalSteps: 4, badge: { label: 'Completed', color: 'green' } }));
    const live = D.applyToolEvent([], { phase: 'start', callId: 'call_9', toolName: 'list_tasks', startedAt: '2026-10-30T11:00:00.000Z' });
    const duplicate = D.applyToolEvent([], { phase: 'start', callId: 'call_7', toolName: 'create_matter_task', startedAt: '2026-10-30T10:05:00.000Z' });
    const merged = D.mergeActivity(view, live.concat(duplicate), true);
    expect(merged.running).toBe(true);
    expect(merged.calls.map((c) => c.callId)).toEqual(['call_9', 'call_7']);
    expect(merged.calls[1].live).toBe(false);
    expect(D.mergeActivity(D.activityView({ active: true, active_response: { started_at: 'x', duration_seconds: 110 } }), [], false))
      .toEqual(expect.objectContaining({ running: true, activeResponse: expect.objectContaining({ durationSeconds: 110 }) }));
  });

  test('view_url maps to client pages, and to nothing the client has no page for', () => {
    expect(D.viewUrlTarget('/matters/MATT-00039/tasks/t1')).toEqual({
      page: 'workspace-details.html', params: { id: 'MATT-00039', task: 't1' }, context: { matterId: 'MATT-00039' }
    });
    expect(D.viewUrlTarget('/matters/M1/documents/d9')).toEqual({
      page: 'file-viewer.html', params: { id: 'd9', matter_id: 'M1' }, context: { matterId: 'M1' }
    });
    expect(D.viewUrlTarget('/matters/M1/notes/n1').params).toEqual({ id: 'M1', tab: 'notes' });
    expect(D.viewUrlTarget('/matters/M1').params).toEqual({ id: 'M1' });
    expect(D.viewUrlTarget('/approvals/appr-1')).toEqual({ page: 'approval-detail.html', params: { id: 'appr-1' } });
    expect(D.viewUrlTarget('/tasks/t2')).toEqual({ page: 'my-tasks.html', params: { task: 't2' } });
    expect(D.viewUrlTarget('/contacts/c1')).toBeNull();
    expect(D.viewUrlTarget('/calendar/e1')).toBeNull();
    expect(D.viewUrlTarget('//evil.example/x')).toBeNull();
    expect(D.viewUrlTarget('https://evil.example/matters/1')).toBeNull();
    expect(D.viewUrlTarget(null)).toBeNull();
  });

  test('formatting', () => {
    expect(D.formatTokens(32768)).toBe('32,768');
    expect(D.formatPercent(18.4)).toBe('18.4%');
    expect(D.formatPercent(75)).toBe('75%');
    expect(D.formatDuration(412)).toBe('412 ms');
    expect(D.formatDuration(1500)).toBe('1.5 s');
    expect(D.formatDuration(65000)).toBe('1 min 5 s');
    expect(D.formatDuration(null)).toBe('');
  });
});

describe('<lex-lana-side-panel> with the conversation endpoints', () => {
  const wait = (window, ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  // Past the fetch debounce, then the promise chain.
  const settle = async (window) => { await wait(window, 300); await wait(window, 0); };

  function mount(routes) {
    const window = boot();
    const document = window.document;
    const calls = [];
    window.api = {
      get: jest.fn((url) => {
        calls.push(url);
        const route = Object.keys(routes).find((key) => url.indexOf(key) !== -1);
        const answer = route ? routes[route] : undefined;
        if (answer instanceof Error) return Promise.reject(answer);
        return Promise.resolve(typeof answer === 'function' ? answer(url) : answer);
      })
    };
    window.Lex.Nav = { go: jest.fn() };
    const chat = document.createElement('div');
    chat.conversationId = CONV;
    const m1 = document.createElement('lex-chat-message');
    chat.appendChild(m1);
    document.body.appendChild(chat);
    m1.messageId = 'a1';
    m1.citations = [{ document_id: 'lease', filename: 'Lease.pdf', page_number: 3 }];
    const side = document.createElement('lex-lana-side-panel');
    document.body.appendChild(side);
    side.attachChat(chat);
    side.setActive(true);
    const fire = (name, detail) => chat.dispatchEvent(new window.CustomEvent(name, { detail: Object.assign({ conversationId: CONV }, detail) }));
    return { window, document, chat, side, calls, fire };
  }

  const fullRoutes = () => ({
    '/context': CONTEXT,
    '/sources': SOURCES,
    '/outputs': OUTPUTS,
    '/activity/history': ACTIVITY
  });

  const text = (side, card) => side.querySelector(`[data-card="${card}"] .llsp-card-body`).textContent;
  const count = (side, card) => side.querySelector(`[data-card="${card}"] .llsp-count`).textContent;

  test('on reopen the cards load once per conversation from the four endpoints', async () => {
    const { window, side, calls } = mount(fullRoutes());
    // Several refreshes in quick succession still make one request set.
    side.refresh();
    side.refresh();
    expect(side.querySelector('[data-card="outputs"] lex-spinner')).not.toBeNull();
    await settle(window);
    expect(calls.sort()).toEqual([
      `/api/v1/conversations/${CONV}/activity/history?limit=200`,
      `/api/v1/conversations/${CONV}/context`,
      `/api/v1/conversations/${CONV}/outputs`,
      `/api/v1/conversations/${CONV}/sources`
    ]);

    expect(count(side, 'context')).toBe('18.4%');
    const bar = side.querySelector('[data-card="context"] lex-progress-bar');
    expect(bar.getAttribute('value')).toBe('18.4');
    const kv = [...side.querySelectorAll('[data-card="context"] lex-kv')].map((n) => [n.getAttribute('label'), n.getAttribute('value')]);
    expect(kv).toEqual([
      ['Tokens used', '6,031 of 32,768'], ['Usable window', '30,617'], ['Room left', '75%'],
      ['System', '3,900'], ['History', '420'], ['Sources', '1,711'], ['Tools', '0']
    ]);

    // Server history (3 + 1 citations), not the one loaded message.
    expect(text(side, 'sources')).toContain('2 sources from 4 citations');
    expect(side.querySelector('.llsp-source-meta').textContent).toBe('pp. 1, 3 · cited 3 times');

    expect(count(side, 'outputs')).toBe('3');
    expect(text(side, 'outputs')).toContain('1 record change · 1 draft · 1 approval');
    const badges = [...side.querySelectorAll('[data-card="outputs"] lex-badge')].map((b) => b.getAttribute('label'));
    expect(badges).toEqual(['Created', 'Draft', 'Pending']);
    // The draft has no view_url: no link.
    expect(side.querySelectorAll('[data-card="outputs"] button.llsp-output')).toHaveLength(2);
    side.querySelector('[data-card="outputs"] button.llsp-output').click();
    expect(window.Lex.Nav.go).toHaveBeenCalledWith('workspace-details.html', {
      params: { id: 'MATT-00039', task: 't1' }, context: { matterId: 'MATT-00039' }
    });

    expect(text(side, 'activity')).toContain('Create a task on a matter');
    expect(text(side, 'activity')).toContain('412 ms · round 2');
    expect(text(side, 'activity')).toContain('Created task File the answer.');
    expect(text(side, 'activity')).toContain('4 of 4 steps');
  });

  test('an unrecorded context reads "not recorded", and an empty conversation shows empty states', async () => {
    const { window, side } = mount({
      '/context': UNAVAILABLE,
      '/sources': { documents: [], authorities: [], records: [], totals: { documents: 0, citations: 0 } },
      '/outputs': { items: [], totals: { items: 0 } },
      '/activity/history': { active: false, active_response: null, runs: [], tool_calls: [] }
    });
    await settle(window);
    expect(text(side, 'context')).toContain('Usage was not recorded for the latest answer.');
    expect(count(side, 'context')).toBe('');
    expect(side.querySelector('[data-card="context"] lex-progress-bar')).toBeNull();
    expect(text(side, 'outputs')).toContain('will show here');
    expect(text(side, 'activity')).toContain('Answers that only read usually run none.');
  });

  test('one failed endpoint shows an error with retry in its card only', async () => {
    const routes = fullRoutes();
    routes['/outputs'] = new Error('Request failed');
    const { window, side, calls } = mount(routes);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await settle(window);
    expect(text(side, 'outputs')).toContain('Could not load the outputs.');
    expect(text(side, 'activity')).toContain('Create a task on a matter');
    routes['/outputs'] = OUTPUTS;
    side.querySelector('[data-card="outputs"] .llsp-retry').click();
    await settle(window);
    expect(count(side, 'outputs')).toBe('3');
    expect(calls.filter((u) => u.endsWith('/outputs'))).toHaveLength(2);
    warn.mockRestore();
  });

  test('a turn streams into the cards live, then the refetch replaces the live rows without duplicates', async () => {
    const routes = fullRoutes();
    const { window, side, chat, calls, fire } = mount(routes);
    await settle(window);

    fire('lex-chat-response-start', {});
    expect(text(side, 'activity')).toContain('LANA is working');
    fire('lex-chat-tool-start', { callId: 'call_1', toolName: 'update_matter_task', label: 'Update a task', iteration: 1, startedAt: '2026-10-30T11:00:00.000Z' });
    expect(side.querySelector('[data-call="call_1"] lex-badge').getAttribute('label')).toBe('Running');
    fire('lex-chat-tool-end', { callId: 'call_1', toolName: 'update_matter_task', success: true, durationMs: 250, summary: 'Updated.' });
    expect(side.querySelector('[data-call="call_1"] lex-badge').getAttribute('label')).toBe('Done');
    fire('lex-chat-entity-change', { operation: 'updated', entityType: 'task', entityId: 't1', label: 'File the answer', viewUrl: '/matters/MATT-00039/tasks/t1' });
    expect(count(side, 'outputs')).toBe('4');
    fire('lex-chat-context-usage', { usage: Object.assign({}, CONTEXT.context_usage, { percent_used: 40, as_of: undefined }) });
    expect(count(side, 'context')).toBe('40%');
    expect(text(side, 'context')).toContain('Updated live from this answer');
    // A context event without the snapshot (auto compact) changes nothing.
    fire('lex-chat-context-usage', { percentUsed: 10 });
    expect(count(side, 'context')).toBe('40%');

    // The answer lands with a new citation on a new message.
    const m2 = window.document.createElement('lex-chat-message');
    chat.appendChild(m2);
    m2.messageId = 'a2';
    m2.citations = [{ document_id: 'nda', filename: 'NDA.pdf', page_number: 2 }];
    fire('lex-chat-response-end', { messageId: 'a2' });
    side.refresh();
    expect(text(side, 'sources')).toContain('3 sources from 5 citations');

    // The server now holds the turn.
    const before = calls.length;
    routes['/outputs'] = { items: OUTPUTS.items.concat([{ id: 'a2:call_1', kind: 'entity_change', label: 'File the answer',
      entity_type: 'task', entity_id: 't1', operation: 'updated', status: 'applied', view_url: '/matters/MATT-00039/tasks/t1',
      created_at: '2026-10-30T11:00:01.000Z', message_id: 'a2' }]) };
    routes['/activity/history'] = Object.assign({}, ACTIVITY, { tool_calls: ACTIVITY.tool_calls.concat([{ call_id: 'call_1',
      name: 'update_matter_task', label: 'Update a task', iteration: 1, success: true, duration_ms: 250, summary: 'Updated.',
      started_at: '2026-10-30T11:00:00.000Z', message_id: 'a2' }]) });
    routes['/sources'] = Object.assign({}, SOURCES, {
      documents: SOURCES.documents.concat([{ document_id: 'nda', filename: 'NDA.pdf', pages: [2], cite_count: 1 }]),
      totals: { documents: 2, citations: 5 }
    });
    routes['/context'] = { context_usage: Object.assign({}, CONTEXT.context_usage, { percent_used: 40 }) };
    fire('lex-chat-turn-end', { failed: false });
    expect(text(side, 'activity')).not.toContain('LANA is working');
    await settle(window);
    expect(calls.length - before).toBe(4);
    expect(count(side, 'outputs')).toBe('4');
    expect(side.querySelectorAll('[data-call="call_1"]')).toHaveLength(1);
    expect(text(side, 'sources')).toContain('3 sources from 5 citations');
    expect(text(side, 'context')).toContain('As of');
  });

  test('switching conversation starts over and ignores the old one', async () => {
    const { window, side, chat, calls, fire } = mount(fullRoutes());
    await settle(window);
    chat.conversationId = OTHER;
    side.refresh();
    // Late events from the old conversation do not land in the new one.
    fire('lex-chat-entity-change', { conversationId: CONV, operation: 'created', entityType: 'note', entityId: 'n1', label: 'Stray' });
    expect(text(side, 'outputs')).not.toContain('Stray');
    await settle(window);
    expect(calls.filter((u) => u.indexOf(OTHER) !== -1)).toHaveLength(4);

    chat.conversationId = null;
    side.refresh();
    expect(text(side, 'outputs')).toContain('will show here');
    expect(count(side, 'context')).toBe('');
  });

  test('hidden panels do not fetch until shown again', async () => {
    const { window, side, chat, calls } = mount(fullRoutes());
    await settle(window);
    side.setActive(false);
    chat.conversationId = OTHER;
    await settle(window);
    expect(calls.filter((u) => u.indexOf(OTHER) !== -1)).toHaveLength(0);
    side.setActive(true);
    await settle(window);
    expect(calls.filter((u) => u.indexOf(OTHER) !== -1)).toHaveLength(4);
  });
});

describe('lex-chat carries the side panel events', () => {
  function loadChat() {
    class LexElement {
      constructor() { this._props = {}; this.emitted = []; }
      emit(type, detail) { this.emitted.push({ type, detail }); }
      addEventListener() {}
    }
    const context = {
      console,
      document: { head: { appendChild() {} }, createElement: () => ({ textContent: '', className: '' }) },
      Lex: { LexElement, ChatFormat: {}, Chat: {}, BlockRenderer: { render: jest.fn() }, Utils: { millisecondsSince: () => 1 } }
    };
    context.window = context;
    context.globalThis = context;
    const file = path.join(__dirname, '../../src/js/lex/chat/lex-chat.js');
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    return new context.Lex.Chat.LexChat();
  }

  const emitted = (chat, type) => chat.emitted.filter((e) => e.type === type).map((e) => e.detail);

  test('tool start and end, entity change and the whole context snapshot', () => {
    const chat = loadChat();
    chat._handleEvent({ type: 'tool_start', toolName: 'create_matter_task', label: 'Create a task on a matter', callId: 'call_7', iteration: 2, startedAt: 's' });
    chat._handleEvent({ type: 'tool_end', toolName: 'create_matter_task', callId: 'call_7', success: false, durationMs: 412, summary: 'Denied.', iteration: 2, startedAt: 's' });
    chat._handleEvent({ type: 'entity_change', operation: 'created', entityType: 'task', entityId: 't1', label: 'File', viewUrl: '/tasks/t1', matterId: null });
    const usage = CONTEXT.context_usage;
    chat._handleEvent({ type: 'context_usage', percentUsed: 18.4, tokensUsed: 6031, percentUntilCompact: 75, usage });

    expect(emitted(chat, 'lex-chat-tool-start')[0]).toEqual(expect.objectContaining({ callId: 'call_7', toolName: 'create_matter_task', label: 'Create a task on a matter', iteration: 2 }));
    expect(emitted(chat, 'lex-chat-tool-end')[0]).toEqual(expect.objectContaining({ callId: 'call_7', success: false, durationMs: 412, summary: 'Denied.' }));
    expect(emitted(chat, 'lex-chat-entity-change')[0]).toEqual(expect.objectContaining({ operation: 'created', entityType: 'task', entityId: 't1', viewUrl: '/tasks/t1' }));
    expect(emitted(chat, 'lex-chat-context-usage')[0]).toEqual(expect.objectContaining({ percentUsed: 18.4, usage }));
  });

  test('the composer meter skips a snapshot with no numbers', () => {
    const chat = loadChat();
    chat._updateContextMeter = jest.fn();
    chat._handleEvent({ type: 'context_usage', percentUsed: null, usage: UNAVAILABLE.context_usage });
    expect(chat._updateContextMeter).not.toHaveBeenCalled();
    chat._handleEvent({ type: 'context_usage', percentUsed: 18.4, percentUntilCompact: 75, usage: CONTEXT.context_usage });
    expect(chat._updateContextMeter).toHaveBeenCalledWith(18.4, 75);
    expect(emitted(chat, 'lex-chat-context-usage')).toHaveLength(2);
  });
});
