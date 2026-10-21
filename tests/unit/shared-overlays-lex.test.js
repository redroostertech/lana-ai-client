/**
 * Shared overlays on lex components (UI standard section 11, wave 3b).
 *
 * The notifications, activity and data-override slide-overs are lex-drawers,
 * and the conflict, contact-search, conversation-search and note dialogs are
 * lex-modals. These tests run the real modules and the real components in
 * jsdom.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

const LEGACY_NOTIFICATION_MARKUP = `
  <button id="notificationBtn"><span id="notificationBadge" class="hidden">0</span></button>
  <div id="notificationOverlay" class="fixed inset-0 hidden"></div>
  <div id="notificationPanel" class="fixed inset-y-0 right-0 translate-x-full">
    <button id="closeNotificationPanel"></button>
    <div id="notificationList"><div id="notificationLoading"></div></div>
  </div>`;

function boot(bodyHtml = '', { components = ['lex-modal', 'lex-drawer'] } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(read('lex/lex.core.js'));
  components.forEach((name) => window.eval(read(`lex/components/foundation/${name}.js`)));
  window.console.log = () => {};
  return window;
}

const tick = (window, ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const pressEscape = (window) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('NotificationPanel on lex-drawer', () => {
  function bootPanel() {
    const window = boot(LEGACY_NOTIFICATION_MARKUP);
    window.api = {
      isAuthenticated: () => true,
      getNotifications: jest.fn(async () => ({ notifications: [], unreadCount: 0, total: 0 })),
      markAllNotificationsRead: jest.fn(async () => ({}))
    };
    window.eval(read('notifications.js'));
    window.eval('window.NotificationPanel.init({ autoLoadBadge: false })');
    return window;
  }

  test('replaces legacy hand-built overlay markup with one lex-drawer', () => {
    const window = bootPanel();
    const doc = window.document;
    const panel = doc.getElementById('notificationPanel');
    expect(panel.tagName).toBe('LEX-DRAWER');
    expect(doc.getElementById('notificationOverlay')).toBeNull();
    expect(doc.getElementById('closeNotificationPanel')).toBeNull();
    expect(doc.querySelectorAll('#notificationPanel').length).toBe(1);
    // Header buttons ride in the drawer header, not the body.
    const headerActions = panel.querySelector('.lex-drawer-header-actions');
    expect(headerActions.querySelector('#refreshNotificationsBtn')).not.toBeNull();
    expect(headerActions.querySelector('#markAllReadBtn')).not.toBeNull();
    expect(headerActions.querySelector('#viewAllNotificationsBtn')).not.toBeNull();
    expect(panel.contentRoot.querySelector('#notificationList')).not.toBeNull();
  });

  test('opens from the bell, loads, and closes on Escape and the drawer close button', async () => {
    const window = bootPanel();
    const doc = window.document;
    const panel = doc.getElementById('notificationPanel');

    click(window, doc.getElementById('notificationBtn'));
    expect(panel.open).toBe(true);
    expect(window.NotificationPanel.isOpen()).toBe(true);
    expect(window.api.getNotifications).toHaveBeenCalled();

    await tick(window); // the drawer wires Escape when its update runs
    pressEscape(window);
    expect(window.NotificationPanel.isOpen()).toBe(false);

    window.NotificationPanel.open();
    await tick(window);
    click(window, panel.querySelector('.lex-drawer-close'));
    expect(window.NotificationPanel.isOpen()).toBe(false);
  });

  test('filter tabs still switch the filter', async () => {
    const window = bootPanel();
    window.NotificationPanel.open();
    await tick(window);
    click(window, window.document.getElementById('filterUnread'));
    expect(window.NotificationPanel.getState().filter).toBe('unread');
  });

  test('pages without lex-drawer keep their legacy markup working (fallback)', async () => {
    const window = boot(LEGACY_NOTIFICATION_MARKUP, { components: [] });
    window.api = { isAuthenticated: () => true, getNotifications: jest.fn(async () => ({ notifications: [] })) };
    window.eval(read('notifications.js'));
    window.eval('window.NotificationPanel.init({ autoLoadBadge: false })');
    await tick(window); // init waits for DOMContentLoaded before choosing the fallback
    const panel = window.document.getElementById('notificationPanel');
    expect(panel.tagName).toBe('DIV');
    window.NotificationPanel.open();
    expect(panel.classList.contains('translate-x-full')).toBe(false);
    pressEscape(window);
    expect(panel.classList.contains('translate-x-full')).toBe(true);
  });
});

describe('ActivityPanel on lex-drawer', () => {
  test('mounts its own drawer, opens, refreshes, and closes on Escape', async () => {
    const window = boot('<div id="activityOverlay"></div><div id="activityPanel" class="translate-x-full"></div>');
    window.api = { getActivityFeed: jest.fn(async () => ({ activities: [] })) };
    window.eval(read('activity.js'));
    window.eval('window.ActivityPanel.init()');
    const doc = window.document;
    const panel = doc.getElementById('activityPanel');
    expect(panel.tagName).toBe('LEX-DRAWER');
    expect(doc.getElementById('activityOverlay')).toBeNull();

    window.ActivityPanel.open();
    expect(panel.open).toBe(true);
    expect(window.api.getActivityFeed).toHaveBeenCalledTimes(1);
    await tick(window);

    click(window, panel.querySelector('.lex-drawer-header-actions #refreshActivityBtn'));
    await tick(window);
    expect(window.api.getActivityFeed).toHaveBeenCalledTimes(2);

    pressEscape(window);
    expect(window.ActivityPanel.isOpen()).toBe(false);
  });

  test('uses a page-declared lex-drawer as-is', () => {
    const window = boot('<lex-drawer id="activityPanel" heading="Activity"><div id="activityList"></div></lex-drawer>');
    window.api = { getActivityFeed: jest.fn(async () => ({ activities: [] })) };
    window.eval(read('activity.js'));
    window.eval('window.ActivityPanel.init()');
    expect(window.document.querySelectorAll('lex-drawer').length).toBe(1);
  });
});

describe('DataOverridePanel on lex-drawer', () => {
  function bootOverride() {
    const window = boot('', { components: ['lex-modal', 'lex-drawer', 'lex-btn'] });
    const source = read('components/data-override-panel.js')
      .replace('export class DataOverridePanel', 'window.DataOverridePanel = class DataOverridePanel')
      .replace('export default DataOverridePanel;', '');
    window.eval(source);
    window.eval('var LanaTime = { utcDayStart: (d) => d + "T00:00:00Z", utcDayEnd: (d) => d + "T23:59:59Z" };');
    return window;
  }

  test('builds a drawer with Save/Cancel in its footer and opens/closes it', async () => {
    const window = bootOverride();
    const apiClient = { get: jest.fn(async () => []), post: jest.fn(), delete: jest.fn() };
    const panel = new window.DataOverridePanel({ apiClient, onError: () => {}, formatDateRange: () => 'January 2026' });
    const drawer = window.document.getElementById('dataOverridePanel');
    expect(drawer.tagName).toBe('LEX-DRAWER');
    expect(window.document.getElementById('dataOverrideOverlay')).toBeNull();

    const footer = drawer.querySelector('.lex-drawer-footer');
    const save = footer.querySelector('#saveOverrideBtn');
    expect(save.getAttribute('form')).toBe('overrideForm');
    expect(save.getAttribute('type')).toBe('submit');
    expect(footer.querySelector('#cancelOverrideBtn')).not.toBeNull();

    panel.open('revenue', 'Revenue', 'Total', 100, {
      periodStart: '2026-01-01', periodEnd: '2026-01-31', periodType: 'monthly', moduleKey: 'finance'
    });
    expect(drawer.open).toBe(true);
    expect(window.document.getElementById('overrideMetricName').textContent).toBe('Revenue');

    click(window, footer.querySelector('#cancelOverrideBtn'));
    expect(drawer.open).toBeFalsy();
    expect(panel.currentMetric).toBeNull();
  });

  test('a second instance reuses the mounted drawer', () => {
    const window = bootOverride();
    const apiClient = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
    new window.DataOverridePanel({ apiClient });
    new window.DataOverridePanel({ apiClient });
    expect(window.document.querySelectorAll('#dataOverridePanel').length).toBe(1);
  });
});

describe('Search modals on lex-modal', () => {
  test('ContactSearchModal opens a lex-modal and resets on Escape', async () => {
    const window = boot();
    window.api = { get: jest.fn(async () => ({ roles: [] })) };
    window.eval(read('contact-search-modal.js'));
    await window.ContactSearchModal.open('MATTER-1');
    const modal = window.document.getElementById('contactSearchModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.open).toBe(true);
    expect(modal.querySelector('.lex-modal-title').textContent).toBe('Link Existing Contact');
    expect(modal.querySelector('#contactSearchInput')).not.toBeNull();

    window.document.getElementById('contactSearchInput').value = 'abc';
    pressEscape(window);
    expect(modal.open).toBe(false);
    expect(window.ContactSearchModal.isOpen).toBe(false);
    expect(window.document.getElementById('contactSearchInput').value).toBe('');
  });

  test('ConversationSearchModal defers init until lex-modal exists', async () => {
    const window = boot('', { components: [] });
    window.api = { getConversations: jest.fn(async () => ({ conversations: [] })) };
    window.eval(read('conversation-search-modal.js'));
    expect(window.ConversationSearchModal.init()).toBe(false);
    expect(window.document.getElementById('conversationSearchModal')).toBeNull();

    window.eval(read('lex/components/foundation/lex-modal.js'));
    await window.ConversationSearchModal.open();
    const modal = window.document.getElementById('conversationSearchModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.open).toBe(true);
    click(window, modal.querySelector('.lex-modal-close'));
    expect(window.ConversationSearchModal.isOpen).toBe(false);
  });
});

describe('ConflictDetection details on Lex.Modal', () => {
  test('showConflictDetails opens one lex-modal; close removes it', async () => {
    const window = boot();
    window.eval(read('conflict-detection.js'));
    const detection = new window.ConflictDetection({});
    detection.conflicts = [{
      party: { name: 'Acme <Corp>', type: 'opposing_party' },
      conflicts: []
    }];
    detection.showConflictDetails();
    detection.showConflictDetails();
    const modals = window.document.querySelectorAll('#conflictDetailsModal');
    expect(modals.length).toBe(1);
    expect(modals[0].tagName).toBe('LEX-MODAL');
    expect(modals[0].innerHTML).toContain('Acme &lt;Corp&gt;');
    detection.closeConflictDetails();
    await tick(window, 600);
    expect(window.document.getElementById('conflictDetailsModal')).toBeNull();
  });
});

describe('NoteListComponent dialogs on lex-modal', () => {
  function bootNotes() {
    const window = boot('<div id="notes-root"></div>');
    window.eval(read('components/note-list.component.js'));
    const component = Object.create(window.NoteListComponent.prototype);
    component.container = window.document.getElementById('notes-root');
    component.notes = [{ note_id: 'n1', title: 'Call <notes>', content: '<p>Hi</p>' }];
    component.options = { apiClient: { formatRelativeDate: () => 'today' }, matterId: 'M1' };
    component.focusModeEditor = null;
    component.showSuccess = () => {};
    component.showError = () => {};
    component.render();
    component.mountModals();
    component.attachEventListeners();
    return { window, component };
  }

  test('view and focus dialogs are lex-modals on body, not hand-built overlays', () => {
    const { window } = bootNotes();
    const doc = window.document;
    expect(doc.getElementById('notesViewModal').tagName).toBe('LEX-MODAL');
    expect(doc.getElementById('notesFocusModal').tagName).toBe('LEX-MODAL');
    expect(doc.getElementById('notesDeleteModal')).toBeNull();
    expect(doc.getElementById('notes-root').querySelector('.fixed')).toBeNull();
  });

  test('openNoteView sets the heading and Edit opens focus mode', async () => {
    const { window, component } = bootNotes();
    const doc = window.document;
    component.openNoteView('n1');
    await tick(window);
    const view = doc.getElementById('notesViewModal');
    expect(view.open).toBe(true);
    expect(view.querySelector('.lex-modal-title').textContent).toBe('Call <notes>');

    click(window, doc.getElementById('notesViewEditBtn'));
    expect(view.open).toBeFalsy();
    expect(doc.getElementById('notesFocusModal').open).toBe(true);
    expect(doc.getElementById('notesFocusTitleInput').value).toBe('Call <notes>');
  });

  test('Escape in focus mode copies the draft back to the composer', async () => {
    const { window, component } = bootNotes();
    const doc = window.document;
    component.toggleFocusMode();
    await tick(window);
    doc.getElementById('notesFocusTitleInput').value = 'Draft title';
    pressEscape(window);
    expect(doc.getElementById('notesFocusModal').open).toBe(false);
    expect(doc.getElementById('notesTitleInput').value).toBe('Draft title');
  });

  test('delete asks through Lex.Modal.confirmAsync with the title escaped', async () => {
    const { window, component } = bootNotes();
    const onConfirm = jest.fn();
    const pending = component.showDeleteModal('Call <notes>', onConfirm);
    await tick(window);
    const modal = [...window.document.querySelectorAll('lex-modal')].pop();
    expect(modal.innerHTML).toContain('Call &lt;notes&gt;');
    click(window, modal.querySelector('[data-action="confirm"]'));
    await pending;
    expect(onConfirm).toHaveBeenCalled();
  });
});
