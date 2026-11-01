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
    window.eval(read('shared/note-labels.js'));
    window.eval(read('shared/entity-links.js'));
    window.eval(read('components/note-list.component.js'));
    const component = Object.create(window.NoteListComponent.prototype);
    component.container = window.document.getElementById('notes-root');
    component.notes = [{ note_id: 'n1', title: 'Call <notes>', content: '<p>Hi</p>' }];
    component.options = { apiClient: { formatRelativeDate: () => 'today' }, matterId: 'M1' };
    component.focusModeEditor = null;
    component.filters = { label: '', unlinked: false };
    component.linkLabelIndex = {};
    component.loadedLinkKinds = {};
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

  test('cards show the fact label, the Not supported flag and link chips', () => {
    const { window, component } = bootNotes();
    component.notes = [{
      note_id: 'n1', title: 'T', content: '', label: 'fact', evidence_status: 'linked',
      links: [{ id: 'l1', link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'rulebook_rule', id: 'mod.area.slug' } }]
    }];
    component.options.apiClient.formatPreview = () => '';
    component.filteredNotes = component.notes;
    component.renderNotesList();
    const card = window.document.querySelector('[data-note-id="n1"]');
    expect(card.querySelector('.note-fact-label').getAttribute('label')).toBe('Fact');
    expect(card.querySelector('.note-fact-flag').getAttribute('label')).toBe('Not supported');
    expect(card.querySelector('.note-link-chip__text').textContent).toBe('mod.area.slug');
    expect(card.querySelector('.note-link-chip__remove')).toBeNull();
  });

  test('a plain note has no label badge and active filters show a no-match state', () => {
    const { window, component } = bootNotes();
    component.notes = [{ note_id: 'n1', title: 'T', content: '', evidence_status: 'unlinked' }];
    component.options.apiClient.formatPreview = () => '';
    component.filteredNotes = component.notes;
    component.renderNotesList();
    expect(window.document.querySelector('.note-fact-label')).toBeNull();
    expect(window.document.querySelector('.note-fact-flag')).toBeNull();

    component.filteredNotes = [];
    component.filters = { label: 'fact', unlinked: false };
    component.renderNotesList();
    expect(window.document.querySelector('#notesList lex-empty').getAttribute('message')).toBe('No matching notes');
  });

  test('removing a chip in the note view calls the link route and re-reads the note', async () => {
    const { window, component } = bootNotes();
    const linked = { note_id: 'n1', title: 'T', content: '', label: 'fact', evidence_status: 'linked',
      links: [{ id: 'l1', link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'rulebook_rule', id: 'mod.area.slug' } }] };
    component.notes = [linked];
    component.filteredNotes = component.notes;
    component.options.apiClient.formatPreview = () => '';
    component.options.apiClient.getNote = jest.fn(async () => ({ note: { ...linked, links: [], evidence_status: 'unlinked' } }));
    component.options.linksClient = { removeLink: jest.fn(async () => ({})), createLink: jest.fn(), loadCandidates: jest.fn(async () => []), unavailableReason: () => '' };
    component.openNoteView('n1');
    await tick(window);
    const remove = window.document.querySelector('#notesViewLinks .note-link-chip__remove');
    expect(remove.getAttribute('data-link-id')).toBe('l1');
    click(window, remove);
    await tick(window);
    expect(component.options.linksClient.removeLink).toHaveBeenCalledWith('l1');
    expect(component.options.apiClient.getNote).toHaveBeenCalledWith('M1', 'n1');
    expect(window.document.querySelector('#notesViewLinks .note-link-chip')).toBeNull();
    expect(window.document.querySelector('#notesViewMeta .note-fact-flag').getAttribute('title'))
      .toBe('Not linked to any record or document.');
  });

  test('a rule is picked from the rulebook the matter applies and posted with its pin', async () => {
    const { window, component } = bootNotes();
    component.options.apiClient.formatPreview = () => '';
    component.options.apiClient.getNote = jest.fn(async () => ({ note: { note_id: 'n1', title: 'T', links: [] } }));
    const rule = { id: 'mod.area.slug@starter:s:0.2.0:' + 'a'.repeat(64), label: 'mod.area.slug (Starter rule v0.2.0)', description: 'LANA starter rulebook 0.2.0 (US-IN)',
      target: { kind: 'rulebook_rule', id: 'mod.area.slug', rulebook_basis: 'starter', starter_id: 's', starter_version: '0.2.0', starter_sha256: 'a'.repeat(64), jurisdiction: 'US-IN' } };
    component.options.linksClient = { createLink: jest.fn(async () => ({})), loadCandidates: jest.fn(async () => [rule]) };
    await component.openLinkPicker('n1', 'rulebook_rule');
    await tick(window);
    const picker = [...window.document.querySelectorAll('lex-modal')].pop();
    expect(picker.querySelector('lex-input')).toBeNull();
    const select = picker.querySelector('[data-link-picker-value]');
    expect(select.options).toEqual([{ value: rule.id, label: rule.label, description: rule.description }]);
    expect(picker.querySelector('[data-link-picker-release]')).toBeNull();
    select.value = rule.id;
    click(window, picker.querySelector('[data-action="save-link"]'));
    await tick(window, 400);
    expect(component.options.linksClient.createLink)
      .toHaveBeenCalledWith({ kind: 'matter_note', id: 'n1' }, 'rulebook_rule', rule.target);
    expect(picker.isConnected).toBe(false);
  });

  test('no rules leaves the rule picker disabled with the server reason, else the empty text', async () => {
    const { window, component } = bootNotes();
    component.options.linksClient = { createLink: jest.fn(), loadCandidates: jest.fn(async () => []), unavailableReason: () => 'Rulebooks are not turned on for this organization.' };
    await component.openLinkPicker('n1', 'rulebook_rule');
    let select = [...window.document.querySelectorAll('lex-modal')].pop().querySelector('[data-link-picker-value]');
    expect(select.disabled).toBe(true);
    expect(select.placeholder).toBe('Rulebooks are not turned on for this organization.');

    component.loadedLinkKinds = {};
    component.options.linksClient.unavailableReason = () => '';
    await component.openLinkPicker('n1', 'rulebook_rule');
    select = [...window.document.querySelectorAll('lex-modal')].pop().querySelector('[data-link-picker-value]');
    expect(select.placeholder).toBe('No rules in the rulebook this matter applies');
  });

  test('a document link offers its retained releases and sends release_id; without one it still links', async () => {
    const { window, component } = bootNotes();
    component.options.apiClient.formatPreview = () => '';
    component.options.apiClient.getNote = jest.fn(async () => ({ note: { note_id: 'n1', title: 'T', links: [] } }));
    component.options.linksClient = {
      createLink: jest.fn(async () => ({})),
      loadCandidates: jest.fn(async () => [{ id: 'd1', label: 'will.pdf', target: { kind: 'document', id: 'd1' },
        releases: [{ id: 'rel-1', label: 'Release 3: will.pdf', target: { kind: 'document', id: 'd1', release_id: 'rel-1' } }] }]),
      unavailableReason: () => ''
    };
    await component.openLinkPicker('n1', 'document');
    let picker = [...window.document.querySelectorAll('lex-modal')].pop();
    const doc = picker.querySelector('[data-link-picker-value]');
    const release = picker.querySelector('[data-link-picker-release]');
    expect(release.hasAttribute('disabled')).toBe(true);
    doc.value = 'd1';
    doc.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value: 'd1' } }));
    await tick(window);
    expect(release.options).toEqual([{ value: '', label: 'No release' }, { value: 'rel-1', label: 'Release 3: will.pdf' }]);
    expect(release.disabled).toBe(false);
    release.value = 'rel-1';
    click(window, picker.querySelector('[data-action="save-link"]'));
    await tick(window, 400);
    expect(component.options.linksClient.createLink)
      .toHaveBeenLastCalledWith({ kind: 'matter_note', id: 'n1' }, 'document', { kind: 'document', id: 'd1', release_id: 'rel-1' });

    await component.openLinkPicker('n1', 'document');
    picker = [...window.document.querySelectorAll('lex-modal')].pop();
    picker.querySelector('[data-link-picker-value]').value = 'd1';
    click(window, picker.querySelector('[data-action="save-link"]'));
    await tick(window, 400);
    expect(component.options.linksClient.createLink)
      .toHaveBeenLastCalledWith({ kind: 'matter_note', id: 'n1' }, 'document', { kind: 'document', id: 'd1' });
  });

  test('a refused link keeps the picker open and shows why', async () => {
    const { window, component } = bootNotes();
    const errors = [];
    component.showError = (text) => errors.push(text);
    const refusal = Object.assign(new Error('Link target not found'), { status: 404, code: 'NOT_FOUND' });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    component.options.linksClient = {
      createLink: jest.fn(async () => { throw refusal; }),
      loadCandidates: jest.fn(async () => [{ id: 'c1', label: 'Ada', target: { id: 'c1' } }])
    };
    await component.openLinkPicker('n1', 'contact');
    const picker = [...window.document.querySelectorAll('lex-modal')].pop();
    picker.querySelector('[data-link-picker-value]').value = 'c1';
    click(window, picker.querySelector('[data-action="save-link"]'));
    await tick(window, 400);
    expect(errors).toEqual(['That contact is not on this matter, or you cannot see it.']);
    expect(picker.isConnected).toBe(true);
    errorLog.mockRestore();
  });

  test('the picker menu has no agent run and produced_by chips have no remove button', async () => {
    const { window, component } = bootNotes();
    component.options.apiClient.formatPreview = () => '';
    component.options.linksClient = { createLink: jest.fn(), removeLink: jest.fn(), loadCandidates: jest.fn(async () => []), unavailableReason: () => '' };
    component.notes = [{ note_id: 'n1', title: 'T', content: '', links: [
      { id: 'l1', link_type: 'produced_by', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'agent_run', id: 'run-1' } },
      { id: 'l2', link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'contact', id: 'c1' } }
    ] }];
    component.openNoteView('n1');
    await tick(window);
    const menu = window.document.getElementById('notesViewAddLink');
    expect(menu.options.map((o) => o.value)).not.toContain('agent_run');
    const chips = [...window.document.querySelectorAll('#notesViewLinks .note-link-chip')];
    expect(chips).toHaveLength(2);
    expect(chips[0].querySelector('.note-link-chip__remove')).toBeNull();
    expect(chips[1].querySelector('.note-link-chip__remove').getAttribute('data-link-id')).toBe('l2');
  });

  test('rule chips say Starter rule or Firm rule with the version; an outdated starter pin reads "Rulebook text changed"', async () => {
    const { window, component } = bootNotes();
    component.options.apiClient.formatPreview = () => '';
    component.options.linksClient = { createLink: jest.fn(), removeLink: jest.fn(), loadCandidates: jest.fn(async () => []), unavailableReason: () => '' };
    const starter = (id, outdated) => ({ id, link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'rulebook_rule', id: 'mod.area.' + id,
      rulebook_basis: 'starter', starter_id: 's', starter_version: '0.2.0-draft', starter_sha256: 'a'.repeat(64), jurisdiction: 'US-IN', pin_outdated: outdated } });
    component.notes = [{ note_id: 'n1', title: 'T', content: '', links: [
      starter('old', true), starter('now', false),
      { id: 'firm', link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'rulebook_rule', id: 'mod.area.firm', record_id: 'rb-1', version: 4 } }
    ] }];
    component.openNoteView('n1');
    await tick(window);
    const chips = [...window.document.querySelectorAll('#notesViewLinks .note-link-chip')];
    expect(chips.map((chip) => chip.querySelector('.note-link-chip__kind').textContent)).toEqual(['Starter rule', 'Starter rule', 'Firm rule']);
    expect(chips.map((chip) => chip.querySelector('.note-link-chip__text').textContent)).toEqual(['mod.area.old (v0.2.0-draft)', 'mod.area.now (v0.2.0-draft)', 'mod.area.firm (v4)']);
    expect(chips.map((chip) => !!chip.querySelector('.note-link-chip__outdated'))).toEqual([true, false, false]);
    expect(chips[0].querySelector('.note-link-chip__outdated').textContent).toBe('Rulebook text changed');
  });

  test('evidence_status null (labels other than fact and evidence) shows no flag and no error', () => {
    const { window, component } = bootNotes();
    component.options.apiClient.formatPreview = () => '';
    component.notes = [
      { note_id: 'n1', title: 'Q', content: '', label: 'open_question', evidence_status: null },
      { note_id: 'n2', title: 'P', content: '', label: null, evidence_status: null },
      { note_id: 'n3', title: 'F', content: '', label: 'fact', evidence_status: 'unlinked' },
    ];
    component.filteredNotes = component.notes;
    component.renderNotesList();
    const doc = window.document;
    expect(doc.querySelector('[data-note-id="n1"] .note-fact-label').getAttribute('label')).toBe('Open question');
    expect(doc.querySelector('[data-note-id="n1"] .note-fact-flag')).toBeNull();
    expect(doc.querySelector('[data-note-id="n2"] .note-fact-label')).toBeNull();
    expect(doc.querySelector('[data-note-id="n3"] .note-fact-flag').getAttribute('label')).toBe('Not supported');
  });

  test('a cited document can be re-pinned to another release, or to none, and the new pin is shown', async () => {
    const { window, component } = bootNotes();
    const messages = [];
    component.showSuccess = (text) => messages.push(text);
    const cites = (target) => ({ id: 'l1', link_type: 'cites', source: { kind: 'matter_note', id: 'n1' }, target });
    const note = { note_id: 'n1', title: 'T', content: '', label: 'fact', evidence_status: 'supported',
      links: [cites({ kind: 'document', id: 'd1', release_id: 'rel-1', version: 3 })] };
    component.notes = [note];
    component.filteredNotes = component.notes;
    component.options.apiClient.formatPreview = () => '';
    let served = note;
    component.options.apiClient.getNote = jest.fn(async () => ({ note: served }));
    component.options.linksClient = {
      createLink: jest.fn(async (source, kind, target) => {
        const pinned = target.release_id ? { kind: 'document', id: 'd1', release_id: target.release_id, version: 4 } : { kind: 'document', id: 'd1' };
        served = { ...note, evidence_status: target.release_id ? 'supported' : 'linked', links: [cites(pinned)] };
        return { status: 'success', data: { link: cites(pinned) } };
      }),
      removeLink: jest.fn(),
      loadCandidates: jest.fn(async () => [{ id: 'd1', label: 'will.pdf', target: { kind: 'document', id: 'd1' }, releases: [
        { id: 'rel-1', label: 'Release 3', target: { kind: 'document', id: 'd1', release_id: 'rel-1' } },
        { id: 'rel-2', label: 'Release 4', target: { kind: 'document', id: 'd1', release_id: 'rel-2' } }] }]),
      unavailableReason: () => ''
    };
    component.openNoteView('n1');
    await tick(window);
    const repin = window.document.querySelector('#notesViewLinks .note-link-chip__repin');
    expect(repin.getAttribute('data-release-id')).toBe('rel-1');
    click(window, repin);
    await tick(window, 60);
    let picker = [...window.document.querySelectorAll('lex-modal')].pop();
    expect(picker.heading).toBe('Change cited release');
    const docSelect = picker.querySelector('[data-link-picker-value]');
    expect(docSelect.value).toBe('d1');
    expect(docSelect.disabled).toBe(true);
    const release = picker.querySelector('[data-link-picker-release]');
    expect(release.value).toBe('rel-1');
    release.value = 'rel-2';
    click(window, picker.querySelector('[data-action="save-link"]'));
    await tick(window, 400);
    expect(component.options.linksClient.createLink)
      .toHaveBeenLastCalledWith({ kind: 'matter_note', id: 'n1' }, 'document', { kind: 'document', id: 'd1', release_id: 'rel-2' });
    expect(messages.pop()).toBe('Now cites release 4');
    expect(window.document.querySelector('#notesViewLinks .note-link-chip__text').textContent).toBe('will.pdf (release 4)');

    click(window, window.document.querySelector('#notesViewLinks .note-link-chip__repin'));
    await tick(window, 60);
    picker = [...window.document.querySelectorAll('lex-modal')].pop();
    expect(picker.querySelector('[data-link-picker-release]').value).toBe('rel-2');
    picker.querySelector('[data-link-picker-release]').value = '';
    click(window, picker.querySelector('[data-action="save-link"]'));
    await tick(window, 400);
    expect(component.options.linksClient.createLink)
      .toHaveBeenLastCalledWith({ kind: 'matter_note', id: 'n1' }, 'document', { kind: 'document', id: 'd1' });
    expect(messages.pop()).toBe('The note no longer cites a retained release');
  });

  test('a produced_by chip opens "Why did this run?" with the run kind and id; without the opener there is no button', async () => {
    const { window, component } = bootNotes();
    const open = jest.fn();
    component.options.openRunCausation = open;
    component.options.linksClient = { createLink: jest.fn(), removeLink: jest.fn(), loadCandidates: jest.fn(async () => []), unavailableReason: () => '' };
    component.notes = [{ note_id: 'n1', title: 'T', content: '', links: [
      { id: 'l1', link_type: 'produced_by', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'agent_run', id: 'run-1' } },
      { id: 'l2', link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'contact', id: 'c1' } }
    ] }];
    component.openNoteView('n1');
    await tick(window);
    const why = window.document.querySelectorAll('#notesViewLinks .note-link-chip__why');
    expect(why).toHaveLength(1);
    click(window, why[0]);
    expect(open).toHaveBeenCalledWith('agent_run', 'run-1');

    component.options.openRunCausation = null;
    component.renderViewLinks(component.notes[0]);
    expect(window.document.querySelector('#notesViewLinks .note-link-chip__why')).toBeNull();
  });

  test('note actions show with the server label and hand the note and action over; the recorded result re-reads the note', async () => {
    const { window, component } = bootNotes();
    const note = { note_id: 'n1', title: 'Bank letter', content: '', label: 'fact', evidence_status: 'supported', links: [
      { id: 'l1', link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'matter_asset', id: 'a1' } }
    ] };
    const action = { id: 'record_evidence', label: 'Record as evidence', form: 'p.record', subject: 'matter_note:{note_id}' };
    component.notes = [note];
    component.options.apiClient.getNote = jest.fn(async () => ({ note }));
    const run = jest.fn((given, chosen, onRecorded) => onRecorded());
    component.options.noteActions = { actionsFor: jest.fn(() => [action]), run };
    component.openNoteView('n1');
    await tick(window);
    const button = window.document.querySelector('#notesViewLinks .note-links__action');
    expect(button.textContent).toBe('Record as evidence');
    click(window, button);
    await tick(window);
    expect(run).toHaveBeenCalledWith(note, action, expect.any(Function));
    expect(component.options.apiClient.getNote).toHaveBeenCalledWith('M1', 'n1');
    // Control: when no action applies there is no button.
    component.options.noteActions.actionsFor.mockReturnValue([]);
    component.renderViewLinks(note);
    expect(window.document.querySelector('#notesViewLinks .note-links__action')).toBeNull();
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
