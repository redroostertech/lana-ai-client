'use strict';

// The Ask LANA full screen side panel: Sources merges the evidence of every
// loaded message (pure aggregate), and the card opens a source through
// lex-chat's own citation / record handlers rather than its own navigation.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost/src/dashboard.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  for (const rel of ['js/lex/lex.core.js', 'js/lex/chat/lex-chat.format.js', 'js/lex/chat/lex-chat.message.js',
    'js/lex/components/chat/lex-lana-side-panel.js']) {
    window.eval(read(rel));
  }
  return window;
}

const doc = (id, page, extra) => Object.assign({ document_id: id, filename: id + '.pdf', page_number: page }, extra);

describe('Lex.Chat.SourcesAggregate', () => {
  let aggregate;
  beforeAll(() => { aggregate = boot().Lex.Chat.SourcesAggregate.aggregate; });

  test('merges documents across messages by document id, collecting pages', () => {
    const result = aggregate([
      { citations: [doc('lease', 3), doc('nda', 1)] },
      { citations: [doc('lease', 7), doc('lease', 3)] }
    ]);
    const docs = result.groups.find((g) => g.key === 'documents').items;
    expect(docs.map((d) => d.label)).toEqual(['lease.pdf', 'nda.pdf']);
    expect(docs[0]).toEqual(expect.objectContaining({ documentId: 'lease', pages: [3, 7], citeCount: 3 }));
    expect(result.total).toBe(2);
    expect(result.citationCount).toBe(4);
  });

  test('groups authority and records, and dedupes records by type and id', () => {
    const result = aggregate([
      {
        citations: [{ source: 'domain_pack', authority_id: 'frcp-26', label: 'FRCP 26' }],
        references: [{ entity_type: 'note', id: 'n1', label: 'Intake note' }]
      },
      { references: [{ entity_type: 'note', id: 'n1', label: 'Intake note' }, { type: 'task', id: 't1', title: 'Call client' }] }
    ]);
    expect(result.groups.map((g) => g.key)).toEqual(['authority', 'records']);
    const records = result.groups[1].items;
    expect(records.map((r) => [r.label, r.entityType, r.citeCount])).toEqual([
      ['Intake note', 'note', 2],
      ['Call client', 'task', 1]
    ]);
  });

  test('prefers the display filename and ignores junk entries', () => {
    const result = aggregate([
      { citations: [null, 'x', doc('d1', 2, { display_filename: 'Supply Agreement.docx' })], references: [undefined] },
      null
    ]);
    expect(result.total).toBe(1);
    expect(result.groups[0].items[0].label).toBe('Supply Agreement.docx');
  });

  test('empty input yields no groups', () => {
    expect(aggregate([])).toEqual({ groups: [], total: 0, citationCount: 0 });
    expect(aggregate(undefined).total).toBe(0);
  });
});

describe('<lex-lana-side-panel>', () => {
  function mount() {
    const window = boot();
    const document = window.document;
    const chat = document.createElement('div');
    const m1 = document.createElement('lex-chat-message');
    const m2 = document.createElement('lex-chat-message');
    chat.appendChild(m1);
    chat.appendChild(m2);
    document.body.appendChild(chat);
    m1.citations = [doc('lease', 3)];
    m2.citations = [doc('lease', 9)];
    m2.references = [{ entity_type: 'task', id: 't1', label: 'Call client' }];
    const side = document.createElement('lex-lana-side-panel');
    document.body.appendChild(side);
    side.attachChat(chat);
    side.setActive(true);
    return { window, document, chat, side };
  }

  test('renders Scope and merged Sources', () => {
    const { side } = mount();
    side.setScope({ workspaceName: 'Acme v. Beta', matterId: 'm1', documentName: 'Lease.pdf' });
    expect(side.querySelector('.llsp-scope-name').textContent).toBe('Acme v. Beta');
    expect(side.querySelector('.llsp-scope-change').textContent).toBe('Change');
    expect(side.querySelector('.llsp-scope-view').textContent).toBe('View details');
    expect(side.querySelector('.llsp-scope-doc .llsp-scope-name').textContent).toBe('Lease.pdf');

    const labels = [...side.querySelectorAll('.llsp-source-label')].map((n) => n.textContent);
    expect(labels).toEqual(['lease.pdf', 'Call client']);
    expect(side.querySelector('.llsp-source-meta').textContent).toBe('pp. 3, 9 · cited 2 times');
    expect(side.querySelector('[data-card="sources"] .llsp-count').textContent).toBe('2');
  });

  test('shows the empty state and "Add" without a workspace', () => {
    const { side, chat } = mount();
    chat.innerHTML = '';
    side.refresh();
    side.setScope({});
    expect(side.querySelector('.llsp-scope-change').textContent).toBe('Add to workspace');
    expect(side.querySelector('.llsp-scope-view')).toBeNull();
    expect(side.querySelector('[data-card="sources"] .llsp-empty')).not.toBeNull();
  });

  test('opens documents and records through lex-chat handlers', () => {
    const { chat, side } = mount();
    const citations = [];
    const references = [];
    chat.addEventListener('lex-citation-click', (e) => citations.push(e.detail));
    chat.addEventListener('lex-reference-click', (e) => references.push(e.detail));

    const buttons = side.querySelectorAll('.llsp-source');
    buttons[0].click();
    buttons[1].click();

    expect(citations).toHaveLength(1);
    expect(citations[0]).toEqual(expect.objectContaining({ documentId: 'lease', page: 3, filename: 'lease.pdf' }));
    expect(references).toEqual([{ reference: { entity_type: 'task', id: 't1', label: 'Call client' } }]);
  });

  test('collapsing a card is remembered', () => {
    const { window, side } = mount();
    side.querySelector('[data-card="sources"] .llsp-card-head').click();
    expect(side.querySelector('[data-card="sources"]').getAttribute('data-collapsed')).toBe('true');
    expect(JSON.parse(window.localStorage.getItem('lana:lanaDock:sideCards'))).toEqual({ sources: true });
  });

  test('View details opens the workspace page', () => {
    const { window, side } = mount();
    window.Lex.Nav = { go: jest.fn() };
    side.setScope({ workspaceName: 'Acme', matterId: 'm 1' });
    side.querySelector('.llsp-scope-view').click();
    expect(window.Lex.Nav.go).toHaveBeenCalledWith('workspace-details.html', {
      params: { id: 'm 1' }, context: { matterId: 'm 1' }
    });
  });

  test('Change asks the dock to open its scope picker in the Scope row', () => {
    const { side } = mount();
    side.setScope({ workspaceName: 'Acme' });
    const events = [];
    side.addEventListener('lex-lana-side-panel-scope-change', (e) => events.push(e.detail));
    side.querySelector('.llsp-scope-change').click();
    expect(events).toHaveLength(1);
    expect(events[0].anchor).toBe(side.querySelector('.llsp-scope-row'));
  });
});
