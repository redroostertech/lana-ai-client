/**
 * Regression tests — NoteListComponent create-note affordance.
 *
 * Bug: the only "Create Note" entry point lived in the Notes tab's empty
 * state, so once a matter had one note there was no way to add another.
 * The fix adds a persistent header "New Note" button wired to
 * startNewNote(), which must also clear any lingering edit state so the
 * save path POSTs a create instead of PUTting over the last edited note.
 *
 * note-list.component.js is a browser class; per repo convention we avoid
 * jsdom and hand-build the minimal DOM surface each method touches.
 */
const path = require('path');

const NoteListComponent = require(
  path.join(__dirname, '../../src/js/components/note-list.component.js')
);

async function withDocumentStub(elementsById, fn) {
  const hadDocument = 'document' in global;
  const prevDocument = global.document;
  global.document = {
    getElementById: (id) => (elementsById[id] !== undefined ? elementsById[id] : null),
  };
  try {
    return await fn();
  } finally {
    if (hadDocument) {
      global.document = prevDocument;
    } else {
      delete global.document;
    }
  }
}

describe('NoteListComponent create affordance', () => {
  test('render() always includes the header New Note button (not only the empty state)', () => {
    const fakeThis = { container: { innerHTML: '' } };
    NoteListComponent.prototype.render.call(fakeThis);
    expect(fakeThis.container.innerHTML).toContain('id="notesNewBtn"');
    expect(fakeThis.container.innerHTML).toContain('New Note');
  });

  test('startNewNote() clears edit state and opens the focus editor', async () => {
    const fakeThis = {
      editingNoteId: 'note-42',
      focusModeEditor: null,
      resetFocusSaveButton: jest.fn(),
      toggleFocusMode: jest.fn(),
    };
    await withDocumentStub({}, () => {
      NoteListComponent.prototype.startNewNote.call(fakeThis);
    });
    expect(fakeThis.editingNoteId).toBeNull();
    expect(fakeThis.resetFocusSaveButton).toHaveBeenCalled();
    expect(fakeThis.toggleFocusMode).toHaveBeenCalled();
  });

  test('handleSaveNote(true) with no editingNoteId calls createNote, not updateNote', async () => {
    const apiClient = {
      createNote: jest.fn(async () => ({ note: { id: 'new-1', title: 'T' } })),
      updateNote: jest.fn(),
    };
    const fakeThis = {
      editingNoteId: null,
      focusModeEditor: null,
      options: { apiClient, matterId: 'MATT-1' },
      notes: [],
      filteredNotes: [],
      renderNotesList: jest.fn(),
      resetFocusSaveButton: jest.fn(),
      closeFocusMode: jest.fn(),
      showSuccess: jest.fn(),
      showError: jest.fn(),
      updateNote: jest.fn(),
      labels: NoteListComponent.prototype.labels,
    };
    const elements = {
      notesFocusTitleInput: { value: 'My title' },
      notesFocusEditorContainer: { innerHTML: '<p>body</p>', textContent: 'body' },
    };
    await withDocumentStub(elements, () =>
      NoteListComponent.prototype.handleSaveNote.call(fakeThis, true)
    );
    expect(apiClient.createNote).toHaveBeenCalledWith('MATT-1', {
      title: 'My title',
      content: '<p>body</p>',
      ai_generated: false,
    });
    expect(apiClient.updateNote).not.toHaveBeenCalled();
    expect(fakeThis.notes).toHaveLength(1);
    expect(fakeThis.closeFocusMode).toHaveBeenCalled();
  });

  test('handleSaveNote(true) with editingNoteId set calls updateNote, not createNote', async () => {
    const apiClient = {
      createNote: jest.fn(),
      updateNote: jest.fn(async () => ({ note: { id: 'note-42', title: 'T2' } })),
    };
    const fakeThis = {
      editingNoteId: 'note-42',
      focusModeEditor: null,
      options: { apiClient, matterId: 'MATT-1' },
      notes: [],
      filteredNotes: [],
      renderNotesList: jest.fn(),
      resetFocusSaveButton: jest.fn(),
      closeFocusMode: jest.fn(),
      showSuccess: jest.fn(),
      showError: jest.fn(),
      updateNote: jest.fn(),
      labels: NoteListComponent.prototype.labels,
    };
    const elements = {
      notesFocusTitleInput: { value: 'T2' },
      notesFocusEditorContainer: { innerHTML: '<p>edited</p>', textContent: 'edited' },
    };
    await withDocumentStub(elements, () =>
      NoteListComponent.prototype.handleSaveNote.call(fakeThis, true)
    );
    expect(apiClient.updateNote).toHaveBeenCalledWith('MATT-1', 'note-42', {
      title: 'T2',
      content: '<p>edited</p>',
      ai_generated: false,
    });
    expect(apiClient.createNote).not.toHaveBeenCalled();
    expect(fakeThis.editingNoteId).toBeNull();
  });

  describe('fact label on save', () => {
    function saveWith({ editingNoteId = null, notes = [], selected }) {
      const apiClient = {
        createNote: jest.fn(async () => ({ note: { id: 'new-1', title: 'T' } })),
        updateNote: jest.fn(async () => ({ note: { id: editingNoteId, title: 'T' } })),
      };
      const fakeThis = {
        editingNoteId,
        focusModeEditor: null,
        options: { apiClient, matterId: 'MATT-1' },
        notes,
        filteredNotes: [],
        renderNotesList: jest.fn(),
        resetFocusSaveButton: jest.fn(),
        closeFocusMode: jest.fn(),
        showSuccess: jest.fn(),
        showError: jest.fn(),
        updateNote: jest.fn(),
        labels: NoteListComponent.prototype.labels,
      };
      const elements = {
        notesFocusTitleInput: { value: 'T' },
        notesFocusEditorContainer: { innerHTML: '<p>b</p>', textContent: 'b' },
        notesFocusLabelSelect: { value: selected },
      };
      return withDocumentStub(elements, () =>
        NoteListComponent.prototype.handleSaveNote.call(fakeThis, true)
      ).then(() => apiClient);
    }

    test('create sends the picked label', async () => {
      const apiClient = await saveWith({ selected: 'client_instruction' });
      expect(apiClient.createNote).toHaveBeenCalledWith('MATT-1', {
        title: 'T', content: '<p>b</p>', ai_generated: false, label: 'client_instruction',
      });
    });

    test('edit that clears a label sends label null', async () => {
      const apiClient = await saveWith({
        editingNoteId: 'n1', notes: [{ note_id: 'n1', label: 'fact' }], selected: '',
      });
      expect(apiClient.updateNote).toHaveBeenCalledWith('MATT-1', 'n1', {
        title: 'T', content: '<p>b</p>', ai_generated: false, label: null,
      });
    });

    test('edit that keeps the label leaves it out of the update', async () => {
      const apiClient = await saveWith({
        editingNoteId: 'n1', notes: [{ note_id: 'n1', label: 'fact' }], selected: 'fact',
      });
      expect(apiClient.updateNote.mock.calls[0][2]).not.toHaveProperty('label');
    });
  });
});
