'use strict';

/**
 * Shared imperative modals render in lex-modal (docs/TABLE-STANDARD.md
 * section 11): widget config, search result JSON editor, event browser,
 * conversation actions + rename, and the session-expired notice. No
 * hand-built backdrop; the component owns close, Escape and focus.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

function boot(url) {
  const dom = new JSDOM('<!doctype html><body><div id="searchResultDetailRoot"></div></body>', {
    url: url || 'http://client.test/app.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.eval(read('lex/lex.core.js'));
  window.eval(read('lex/lex.forms.js'));
  window.eval(read('lex/components/foundation/lex-btn.js'));
  window.eval(read('lex/components/foundation/lex-modal.js'));
  window.eval(read('lex/components/form/lex-input.js'));
  return window;
}

const tick = (window, ms) => new Promise((resolve) => window.setTimeout(resolve, ms == null ? 20 : ms));

function click(window, el) {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function pressEscape(window) {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function innerButton(lexBtn) {
  return lexBtn.querySelector('button') || lexBtn;
}

// Legacy hand-built overlay markers (lex-modal's own classes are lex-modal-*).
const HAND_BUILT = /fixed inset-0|bg-opacity-50|event-browser-backdrop|search-result-editor-backdrop/;

describe('WidgetConfigModal', () => {
  function load() {
    const window = boot();
    window.api = {
      getDashboardWidgetTypes: jest.fn(async () => ({ data: [{ type: 'chart', label: 'Chart' }] })),
      createDashboardWidget: jest.fn(async () => ({}))
    };
    window.eval(read('dashboard/widget-config-modal.js') + '\n;window.WidgetConfigModal = WidgetConfigModal;');
    return window;
  }

  test('opens a lex-modal with the legacy ids and footer buttons', async () => {
    const window = load();
    await window.WidgetConfigModal.open();
    const modal = window.document.getElementById('widgetConfigModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.open).toBe(true);
    expect(modal.heading).toBe('Add Widget');
    expect(modal.querySelector('#widgetTypeSelect option[value="chart"]')).not.toBeNull();
    const footer = modal.querySelector('.lex-modal-footer');
    expect(footer.querySelector('#saveWidgetBtn')).not.toBeNull();
    expect(footer.querySelector('#cancelWidgetBtn')).not.toBeNull();
    expect(footer.querySelector('[data-action="confirm"]')).toBeNull();
    expect(modal.outerHTML).not.toMatch(HAND_BUILT);
  });

  test('cancel and Escape close it; save posts the widget and closes', async () => {
    const window = load();
    await window.WidgetConfigModal.open();
    const modal = window.document.getElementById('widgetConfigModal');
    click(window, innerButton(modal.querySelector('#cancelWidgetBtn')));
    expect(modal.open).toBeFalsy();

    await window.WidgetConfigModal.open();
    await tick(window);
    pressEscape(window);
    expect(modal.open).toBeFalsy();

    await window.WidgetConfigModal.open();
    modal.querySelector('#widgetTypeSelect').value = 'chart';
    click(window, innerButton(modal.querySelector('#saveWidgetBtn')));
    await tick(window);
    expect(window.api.createDashboardWidget).toHaveBeenCalledWith(expect.objectContaining({ widget_type: 'chart', title: 'Chart' }));
    expect(modal.open).toBeFalsy();
  });
});

describe('search result JSON editor', () => {
  test('Edit Object opens a lex-modal editor; Cancel removes it', async () => {
    const window = boot('http://client.test/search-results.html?entity_id=e1&title=Thing');
    window.api = { get: jest.fn(async () => null), post: jest.fn() };
    window.eval(read('search-result-detail.js'));
    await tick(window);

    click(window, window.document.querySelector('[data-search-result-edit]'));
    const editor = window.document.getElementById('searchResultEditor');
    expect(editor.tagName).toBe('LEX-MODAL');
    expect(editor.heading).toBe('Edit Object JSON');
    expect(editor.querySelector('.lex-modal-body [data-search-result-editor-textarea]')).not.toBeNull();
    expect(editor.querySelector('.lex-modal-footer [data-search-result-editor-save]')).not.toBeNull();
    expect(editor.outerHTML).not.toMatch(HAND_BUILT);

    click(window, innerButton(editor.querySelector('[data-search-result-editor-close]')));
    expect(window.document.getElementById('searchResultEditor')).toBeNull();
    await tick(window, 400);
    expect(window.document.querySelector('lex-modal')).toBeNull();
  });

  test('invalid JSON keeps the editor open with an error status', async () => {
    const window = boot('http://client.test/search-results.html?entity_id=e1');
    window.api = { get: jest.fn(async () => null), post: jest.fn() };
    window.eval(read('search-result-detail.js'));
    await tick(window);
    click(window, window.document.querySelector('[data-search-result-edit]'));
    const editor = window.document.getElementById('searchResultEditor');
    editor.querySelector('[data-search-result-editor-textarea]').value = '{oops';
    click(window, innerButton(editor.querySelector('[data-search-result-editor-save]')));
    await tick(window);
    const status = editor.querySelector('[data-search-result-editor-status]');
    expect(status.dataset.error).toBe('true');
    expect(window.api.post).not.toHaveBeenCalled();
    expect(window.document.getElementById('searchResultEditor')).toBe(editor);
  });
});

describe('LanaEventBrowser', () => {
  function load() {
    const window = boot();
    const events = [
      { event_type: 'matter.created', friendly_name: 'Matter created', description: 'd', category_label: 'Matters', when: 'w', data_available: ['a'], common_use_cases: ['u'], example_workflows: ['x'] },
      { event_type: 'task.done', friendly_name: 'Task done', description: 'd', category_label: 'Tasks', when: 'w', data_available: ['a'], common_use_cases: ['u'], example_workflows: ['x'] }
    ];
    window.LanaEventCatalog = {
      getGroupedEvents: () => [{ key: 'all', label: 'All', description: '', events }],
      getEventMeta: (type) => events.find((e) => e.event_type === type) || null
    };
    window.eval(read('shared/event-browser.js'));
    return window;
  }

  test('opens a full-size lex-modal and focuses the search field', async () => {
    const window = load();
    window.LanaEventBrowser.open({ currentValue: 'task.done' });
    const root = window.document.getElementById('lana-event-browser-root');
    expect(root.tagName).toBe('LEX-MODAL');
    expect(root.size).toBe('full');
    expect(root.heading).toBe('Browse Events');
    expect(root.querySelectorAll('[data-event-key]').length).toBe(2);
    expect(root.outerHTML).not.toMatch(/event-browser-backdrop|event-browser-panel/);
    await tick(window);
    expect(window.document.activeElement).toBe(root.querySelector('[data-event-browser-search]'));
  });

  test('Use Event calls onSelect and closes; Escape closes', async () => {
    const window = load();
    const onSelect = jest.fn();
    window.LanaEventBrowser.open({ currentValue: 'task.done', onSelect });
    let root = window.document.getElementById('lana-event-browser-root');
    click(window, root.querySelector('[data-event-browser-use="true"]'));
    expect(onSelect).toHaveBeenCalledWith('task.done', expect.objectContaining({ event_type: 'task.done' }));
    expect(window.document.getElementById('lana-event-browser-root')).toBeNull();

    window.LanaEventBrowser.open({});
    root = window.document.getElementById('lana-event-browser-root');
    await tick(window);
    pressEscape(window);
    expect(root.open).toBeFalsy();
    await tick(window, 400);
    expect(root.isConnected).toBe(false);
  });
});

describe('ConversationActionsModal', () => {
  function load() {
    const window = boot();
    window.eval(read('components.js'));
    return window;
  }

  test('actions open in a lex-modal and Escape clears the selection', async () => {
    const window = load();
    const actions = window.ConversationActionsModal;
    await actions.open('c1', 'Q&amp;A', 'm1', true);
    const modal = window.document.getElementById('conversationActionsModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.open).toBe(true);
    expect(modal.querySelector('#modalConversationTitle').textContent).toBe('Q&A');
    expect(modal.querySelector('#viewMatterDetailsBtn').classList.contains('hidden')).toBe(false);
    expect(modal.querySelector('#togglePinConversationLabel').textContent).toBe('Unpin Conversation');
    expect(modal.outerHTML).not.toMatch(HAND_BUILT);

    await tick(window);
    pressEscape(window);
    expect(modal.open).toBeFalsy();
    expect(actions.selectedConversationId).toBeNull();

    // Reuses the same element on the next open.
    await actions.open('c2', 'Other', null, false);
    expect(window.document.querySelectorAll('#conversationActionsModal').length).toBe(1);
    expect(modal.querySelector('#viewMatterDetailsBtn').classList.contains('hidden')).toBe(true);
  });

  test('rename footer lives in the modal footer and submits the form', async () => {
    const window = load();
    const actions = window.ConversationActionsModal;
    await actions.open('c1', 'Old', null, false);
    actions.confirmRename = jest.fn();
    await actions.editConversation();
    const rename = window.document.getElementById('renameConversationModal');
    expect(window.document.getElementById('conversationActionsModal').open).toBeFalsy();
    expect(rename.open).toBe(true);
    const footer = rename.querySelector('.lex-modal-footer');
    const confirm = footer.querySelector('#renameConfirmBtn');
    expect(confirm.getAttribute('form')).toBe('renameConversationForm');
    expect(footer.querySelector('#renameCancelBtn')).not.toBeNull();
    expect(rename.querySelector('.rename-conversation-footer')).toBeNull();

    rename.querySelector('#renameConversationForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    expect(actions.confirmRename).toHaveBeenCalledTimes(1);

    click(window, innerButton(footer.querySelector('#renameCancelBtn')));
    expect(rename.open).toBeFalsy();
  });
});

describe('ApiClient session-expired notice', () => {
  function load(withModal) {
    // Silent console: the redirect hits jsdom's "navigation not implemented".
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://client.test/app.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    const { window } = dom;
    if (withModal) {
      window.eval(read('lex/lex.core.js'));
      window.eval(read('lex/components/foundation/lex-modal.js'));
    }
    window.LanaConfig = {};
    window.LanaTime = { nowMs: () => 1000, millisecondsSince: (s) => 1000 - s, MS_PER_MINUTE: 60000, MS_PER_HOUR: 3600000 };
    window.eval(read('api.js'));
    return window;
  }

  test('shows a lex-modal without a close button', async () => {
    const window = load(true);
    window.localStorage.setItem('token', 't');
    window.api.showSessionExpiredModal();
    await tick(window);
    const modal = window.document.getElementById('sessionExpiredModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.heading).toBe('Session Expired');
    expect(modal.querySelector('.lex-modal-close').hidden).toBe(true);
    expect(modal.querySelector('#sessionCountdown').textContent).toBe('3');
    expect(window.localStorage.getItem('token')).toBeNull();
    // A second 401 does not stack another notice.
    window.api.showSessionExpiredModal();
    expect(window.document.querySelectorAll('lex-modal').length).toBe(1);
    window.close(); // stop the redirect countdown
  });

  test('without lex-modal it draws no overlay', () => {
    const window = load(false);
    window.api.showSessionExpiredModal();
    expect(window.document.getElementById('sessionExpiredModal')).toBeNull();
    expect(window.document.body.innerHTML).not.toMatch(HAND_BUILT);
    window.close();
  });
});
