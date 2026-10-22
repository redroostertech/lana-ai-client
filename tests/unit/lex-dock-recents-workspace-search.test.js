'use strict';

// Dock Recents: scoped chats show their workspace name under the title, and
// the header's Search chats button opens the conversation search, whose pick
// opens in the dock.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadThreads(api) {
  class FakeLexElement {
    constructor() { this._events = []; this._props = {}; }
    _scheduleUpdate() { this._scheduled = (this._scheduled || 0) + 1; }
    emit(name, detail) { this._events.push({ name, detail }); }
    escapeHtml(value) { return String(value == null ? '' : value); }
    delegate() {}
  }
  const context = {
    console,
    api,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    customElements: { define: jest.fn((name, klass) => { context.DefinedThreadList = klass; }) },
    Lex: { LexElement: FakeLexElement }
  };
  context.window = context;
  context.globalThis = context;
  const file = path.join(ROOT, 'src/js/lex/chat/lex-chat.threads.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { ThreadList: context.DefinedThreadList, context };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Recents workspace names', () => {
  test('a scoped chat shows its workspace name; unscoped and unknown ones show none', async () => {
    const api = {
      getConversations: jest.fn(async () => ({
        conversations: [
          { registryId: 'r1', conversationId: 'c1', title: 'Settlement', scope: { matterId: 'MATT-00001' } },
          { registryId: 'r2', conversationId: 'c2', title: 'General' },
          { registryId: 'r3', conversationId: 'c3', title: 'Old', scope: { matterId: 'MATT-99999' } }
        ]
      })),
      get: jest.fn(async () => ({ matters: [{ id: 'uuid-1', matter_id: 'MATT-00001', name: 'Smith v. Jones' }] }))
    };
    const { ThreadList } = loadThreads(api);
    const el = new ThreadList();
    el.recents = true;
    el._threads = [];

    await el.loadThreads();
    await flush();

    const url = api.get.mock.calls[0][0];
    expect(url).toContain('/api/v1/storage/matters?');
    expect(decodeURIComponent(url)).toContain('matter_ids=MATT-00001,MATT-99999');
    expect(el._threads.map((t) => t.subtitle)).toEqual(['Smith v. Jones', '', '']);
  });

  test('names are looked up once per page', async () => {
    const api = {
      getConversations: jest.fn(async () => ({
        conversations: [{ registryId: 'r1', conversationId: 'c1', title: 'A', scope: { matterId: 'MATT-00001' } }]
      })),
      get: jest.fn(async () => ({ matters: [{ matter_id: 'MATT-00001', name: 'Smith v. Jones' }] }))
    };
    const { ThreadList } = loadThreads(api);
    const el = new ThreadList();
    el.recents = true;
    el._threads = [];
    await el.loadThreads(); await flush();
    await el.loadThreads(); await flush();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(el._threads[0].subtitle).toBe('Smith v. Jones');
  });

  test('Recents header has Search chats to the left of New chat', () => {
    const source = read('src/js/lex/chat/lex-chat.threads.js');
    const search = source.indexOf('data-search-threads title="Search chats"');
    const plus = source.indexOf('data-new-thread title="New chat"');
    expect(search).toBeGreaterThan(-1);
    expect(search).toBeLessThan(plus);
    expect(source).toContain("this.emit('lex-thread-search', {})");
  });
});

describe('dock chat search', () => {
  test('the dock opens the search on lex-thread-search and loads it on demand', () => {
    const source = read('src/js/lex/components/layout/lex-lana-dock.js');
    expect(source).toContain("panel.addEventListener('lex-thread-search'");
    expect(source).toContain("script.src = jsBase() + 'conversation-search-modal.js'");
  });
});

describe('conversation search modal', () => {
  function loadModal(extra = {}) {
    const context = {
      console,
      document: { createElement: () => { let t = ''; return { set textContent(v) { t = String(v); }, get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; } },
      LanaTime: { timeAgo: () => '5m' },
      ...extra
    };
    context.window = context;
    vm.runInNewContext(read('src/js/conversation-search-modal.js') + '\nthis.M = ConversationSearchModal;', context);
    return { modal: context.M, context };
  }

  test('highlighting survives regex characters in the query', () => {
    const { modal } = loadModal();
    expect(() => modal.highlightText('Fees (2026)', '(2026')).not.toThrow();
    expect(modal.highlightText('Fees (2026)', '(2026')).toContain('<mark');
  });

  test('a pick opens in the dock with its title and workspace name', () => {
    const openConversation = jest.fn(() => Promise.resolve());
    const { modal } = loadModal({ Lex: { LanaDock: { get: () => ({ openConversation }) } } });
    modal.modal = { open: true };
    modal.searchInput = { value: '' };
    modal.resultsContainer = {};
    modal.renderResultItem({ thread_id: 'c1', matter_id: 'MATT-00001', title: 'Settlement', matter_name: 'Smith v. Jones' }, '');

    modal.selectConversation('c1', 'MATT-00001');

    expect(openConversation).toHaveBeenCalledWith('c1', 'MATT-00001', { title: 'Settlement', matterName: 'Smith v. Jones' });
  });

  test('results get workspace names from the shared lookup', async () => {
    const resolveWorkspaceNames = jest.fn(async () => {});
    const { modal } = loadModal({ Lex: { Chat: { resolveWorkspaceNames, workspaceName: () => 'Smith v. Jones' } } });
    const rows = await modal.withWorkspaceNames([{ thread_id: 'c1', matter_id: 'MATT-00001', matter_name: '' }, { thread_id: 'c2', matter_id: '' }]);
    expect(resolveWorkspaceNames).toHaveBeenCalledWith(['MATT-00001']);
    expect(rows[0].matter_name).toBe('Smith v. Jones');
    expect(rows[1].matter_name).toBeUndefined();
  });
});
