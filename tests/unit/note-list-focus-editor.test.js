/**
 * Regressions found in the notes create/edit screenshots:
 * - the editor dialog read "Focus Mode" for both a new note and an edit;
 * - a long title in the single-line title input was clipped (on edit the
 *   caret lands at the end, so the start of the title scrolled out of view);
 * - editing a note hid its links entirely, so nothing showed what the note
 *   is linked to while its label is being changed;
 * - a "Note loaded for editing" toast covered the Update Note button.
 *
 * note-list.component.js is a browser class; per repo convention we avoid
 * jsdom and hand-build the minimal DOM surface each method touches.
 */
const path = require('path');

const NoteListComponent = require(path.join(__dirname, '../../src/js/components/note-list.component.js'));
const NoteLabels = require(path.join(__dirname, '../../src/js/shared/note-labels.js'));
const EntityLinks = require(path.join(__dirname, '../../src/js/shared/entity-links.js'));

function withDocument(elementsById, fn, created) {
  const had = 'document' in global;
  const previous = global.document;
  global.document = {
    getElementById: (id) => elementsById[id] || null,
    createElement: () => {
      const el = { attrs: {}, innerHTML: '', setAttribute(name, value) { this.attrs[name] = value; }, addEventListener: jest.fn() };
      if (created) created.push(el);
      return el;
    },
    body: { appendChild: jest.fn() }
  };
  try { return fn(); } finally { if (had) global.document = previous; else delete global.document; }
}

function fakeThis(extra = {}) {
  return {
    options: { linksClient: {} },
    linkLabelIndex: { 'matter_asset:asset-checking': 'Joint checking ****2210' },
    labels: () => NoteLabels,
    entityLinks: () => EntityLinks,
    factLabels: () => NoteLabels.PLATFORM_FACT_LABELS,
    escapeAttr: (value) => String(value == null ? '' : value),
    escapeHtml: (value) => String(value == null ? '' : value),
    renderLinkChips: NoteListComponent.prototype.renderLinkChips,
    ...extra
  };
}

const linkedNote = {
  note_id: 'note-question',
  label: 'open_question',
  links: [{ id: 'lk-6', link_type: 'about', source: { kind: 'matter_note', id: 'note-question' }, target: { kind: 'matter_asset', id: 'asset-checking' }, relationship_source: 'user' }]
};

describe('NoteListComponent focus editor', () => {
  test('a new note is headed "New note" and shows no links section', () => {
    const modal = { heading: 'Focus Mode' };
    const links = { innerHTML: 'stale', hidden: false };
    withDocument({ notesFocusModal: modal, notesFocusLinks: links }, () => NoteListComponent.prototype.setFocusContext.call(fakeThis(), null));
    expect(modal.heading).toBe('New note');
    expect(links.hidden).toBe(true);
    expect(links.innerHTML).toBe('');
  });

  test('editing is headed "Edit note" and lists the links read-only', () => {
    const modal = { heading: 'Focus Mode' };
    const links = { innerHTML: '', hidden: true };
    withDocument({ notesFocusModal: modal, notesFocusLinks: links }, () => NoteListComponent.prototype.setFocusContext.call(fakeThis(), linkedNote));
    expect(modal.heading).toBe('Edit note');
    expect(links.hidden).toBe(false);
    expect(links.innerHTML).toContain('Joint checking ****2210');
    expect(links.innerHTML).not.toContain('note-link-chip__remove');
  });

  test('editing a note with no links says so (control)', () => {
    const links = { innerHTML: '', hidden: true };
    withDocument({ notesFocusModal: {}, notesFocusLinks: links }, () => NoteListComponent.prototype.setFocusContext.call(fakeThis(), { note_id: 'n1', links: [] }));
    expect(links.hidden).toBe(false);
    expect(links.innerHTML).toContain('No links yet.');
  });

  test('the title field wraps long titles instead of clipping them', () => {
    const created = [];
    withDocument({}, () => NoteListComponent.prototype.mountModals.call(fakeThis()), created);
    const focus = created.find((el) => el.id === 'notesFocusModal');
    expect(focus.innerHTML).toMatch(/<textarea[^>]*id="notesFocusTitleInput"/);
    expect(focus.innerHTML).toContain('id="notesFocusLinks"');
  });

  test('loading a note for editing does not toast over the Update Note button', async () => {
    const self = fakeThis({ notes: [linkedNote], toggleFocusMode: jest.fn(), showSuccess: jest.fn(), showError: jest.fn() });
    await withDocument({}, () => NoteListComponent.prototype.handleEditNote.call(self, 'note-question'));
    expect(self.toggleFocusMode).toHaveBeenCalled();
    expect(self.showSuccess).not.toHaveBeenCalled();
  });
});
