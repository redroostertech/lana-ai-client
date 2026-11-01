'use strict';

const { JSDOM } = require('jsdom');
const Registry = require('../../src/js/shared/matter-tab-registry.js');

function fresh() {
  const registry = Registry.createRegistry();
  ['summary', 'notes', 'tasks', 'comments', 'documents', 'billable_hours', 'conversations', 'doc_generation', 'analytics', 'records']
    .forEach((kind) => registry.register(kind, jest.fn()));
  return registry;
}

describe('matter-tab-registry', () => {
  test('the fallback is the standard tab set the page showed before makeups', () => {
    const tabs = fresh().buildTabs(null);
    expect(fresh().barTabs(tabs)).toEqual([
      { id: 'summary', label: 'Summary' }, { id: 'notes', label: 'Notes' }, { id: 'tasks', label: 'Board' },
      { id: 'comments', label: 'Discussions' }, { id: 'documents', label: 'Documents' }, { id: 'billableHours', label: 'Billable Hours' },
    ]);
    expect(tabs.filter((t) => t.hidden).map((t) => t.key)).toEqual(['conversations', 'docGeneration', 'analytics']);
    expect(tabs.find((t) => t.kind === 'billable_hours').panelId).toBe('tabContentBillableHours');
  });

  test('a server list is used as given: no standard tabs mixed in, even when it is empty', () => {
    const registry = fresh();
    expect(registry.buildTabs([])).toEqual([]);
    expect(registry.buildTabs([{ id: 'notes', kind: 'notes', hidden: true }]).map((t) => t.key)).toEqual(['notes']);
  });

  test('failedTabs is one unavailable section with the load failure', () => {
    const registry = fresh();
    const tabs = registry.failedTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ available: false, reason: Registry.LOAD_FAILED, hidden: false });
    expect(registry.barTabs(tabs)).toEqual([{ id: 'sections', label: 'Matter' }]);
  });

  test('renderBuiltIn in a renderer context runs the built-in kind renderer', () => {
    const registry = fresh();
    const builtIn = jest.fn();
    registry.register('notes', builtIn);
    registry.register('records', (ctx) => ctx.renderBuiltIn());
    const [records] = registry.buildTabs([{ id: 'notes', kind: 'records' }]);
    registry.render(records, { document: { getElementById: () => null } });
    // records is generic: there is no built-in renderer, nothing runs.
    expect(builtIn).not.toHaveBeenCalled();
    registry.register('notes', (ctx) => builtIn(ctx.tab.kind));
    const [notes] = registry.buildTabs([{ id: 'notes', kind: 'notes' }]);
    registry.render(notes, { document: { getElementById: () => null } });
    expect(builtIn).toHaveBeenCalledWith('notes');
  });

  test('server order, labels and hidden tabs are kept; duplicates and malformed entries dropped', () => {
    const registry = fresh();
    const tabs = registry.buildTabs([
      { id: 'documents', kind: 'documents' },
      { id: 'assets', kind: 'records', label: 'Assets' },
      { id: 'summary', kind: 'summary', label: 'Overview' },
      { id: 'notes', kind: 'notes', hidden: true },
      { id: 'documents-again', kind: 'documents' },
      { id: '', kind: 'notes' },
      { kind: 'tasks' },
    ]);
    expect(registry.barTabs(tabs)).toEqual([
      { id: 'documents', label: 'Documents' }, { id: 'assets', label: 'Assets' }, { id: 'summary', label: 'Overview' },
    ]);
    expect(tabs.map((t) => t.key)).toEqual(['documents', 'assets', 'summary', 'notes']);
    expect(tabs.find((t) => t.key === 'assets').panelId).toBe('matterTabPanel-assets');
  });

  test('resolve matches the page key, the server id or the kind, else the first visible tab', () => {
    const registry = fresh();
    const tabs = registry.buildTabs([{ id: 'hours', kind: 'billable_hours' }, { id: 'assets', kind: 'records' }, { id: 'chats', kind: 'conversations', hidden: true }]);
    expect(registry.resolve(tabs, 'billableHours').id).toBe('hours');
    expect(registry.resolve(tabs, 'hours').key).toBe('billableHours');
    expect(registry.resolve(tabs, 'billable_hours').key).toBe('billableHours');
    expect(registry.resolve(tabs, 'conversations').id).toBe('chats');
    expect(registry.resolve(tabs, 'summary').key).toBe('billableHours');
    expect(registry.resolve(tabs, null).key).toBe('billableHours');
  });

  describe('render', () => {
    function page() {
      const dom = new JSDOM('<!doctype html><body><div id="panels"></div></body>');
      return dom.window.document;
    }

    test('calls the renderer for the kind with the context', () => {
      const registry = Registry.createRegistry();
      const render = jest.fn();
      registry.register('records', render);
      const doc = page();
      const [tab] = registry.buildTabs([{ id: 'assets', kind: 'records' }]);
      registry.ensurePanels(doc.getElementById('panels'), [tab]);
      registry.render(tab, { document: doc, matterId: 'M-1' });
      expect(render).toHaveBeenCalledWith(expect.objectContaining({ tab, matterId: 'M-1', panel: doc.getElementById('matterTabPanel-assets') }));
      expect(doc.getElementById('matterTabPanel-assets').className).toBe('hidden p-6');
    });

    test('an unknown kind renders the newer app version empty state', () => {
      const registry = Registry.createRegistry();
      const doc = page();
      const [tab] = registry.buildTabs([{ id: 'x', kind: 'timeline', label: 'Timeline' }]);
      expect(tab.label).toBe('Timeline');
      registry.ensurePanels(doc.getElementById('panels'), [tab]);
      registry.render(tab, { document: doc });
      const empty = doc.querySelector('#matterTabPanel-x lex-empty');
      expect(empty.getAttribute('message')).toBe('This section needs a newer app version');
    });

    test('an unavailable tab shows the server reason instead of rendering', () => {
      const registry = Registry.createRegistry();
      const render = jest.fn();
      registry.register('records', render);
      const doc = page();
      const [tab] = registry.buildTabs([{ id: 'assets', kind: 'records', available: false, reason: 'The feature is off.' }]);
      registry.ensurePanels(doc.getElementById('panels'), [tab]);
      registry.render(tab, { document: doc });
      expect(render).not.toHaveBeenCalled();
      expect(doc.querySelector('#matterTabPanel-assets lex-empty').getAttribute('description')).toBe('The feature is off.');
    });

    test('panel ids from server ids are safe', () => {
      const registry = Registry.createRegistry();
      const [tab] = registry.buildTabs([{ id: 'a"b c', kind: 'records' }]);
      expect(tab.panelId).toBe('matterTabPanel-a-b-c');
    });
  });
});
