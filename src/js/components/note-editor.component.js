/**
 * Note Editor Component
 *
 * Wrapper around Tiptap rich text editor for note editing.
 * Features:
 * - Tiptap editor initialization
 * - Auto-save (debounced)
 * - Create/Update/Delete operations
 * - Save status indication
 *
 * @requires window.TiptapEditor (from tiptap-bundle-built.js)
 * @requires MatterNotesAPIClient
 */

class NoteEditorComponent {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }

    this.options = {
      matterId: options.matterId,
      apiClient: options.apiClient,
      onNoteSaved: options.onNoteSaved || (() => {}),
      onNoteDeleted: options.onNoteDeleted || (() => {}),
      autoSaveDelay: options.autoSaveDelay || 2000, // 2 seconds
      ...options
    };

    this.editor = null;
    this.currentNote = null;
    this.saveStatus = 'saved'; // 'saved', 'saving', 'unsaved'
    this.autoSaveTimer = null;
    this.isInitialized = false;
    this.hasUnsavedChanges = false;
    this.isSaving = false;

    // Bind event handlers once to prevent memory leaks
    this.handleTitleChangeBound = this.handleTitleChange.bind(this);
    this.handleDeleteBound = this.handleDelete.bind(this);

    this.init();
  }

  /**
   * Initialize component
   */
  init() {
    this.render();
    this.initializeTiptap();
    this.attachEventListeners();
    this.isInitialized = true;
  }

  /**
   * Render initial HTML structure
   */
  render() {
    this.container.innerHTML = `
      <div class="notes-editor-panel">
        <!-- Editor Header -->
        <div class="notes-editor-header">
          <input
            type="text"
            id="noteEditorTitle"
            class="notes-editor-title-input"
            placeholder="Untitled Note"
            disabled
          />
          <div class="notes-editor-actions">
            <button id="deleteNoteBtn" class="notes-editor-btn danger" title="Delete note" disabled>
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Editor Meta -->
        <div class="notes-editor-meta" id="noteEditorMeta">
          <div class="notes-editor-meta-item">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span id="noteCreatedAt">-</span>
          </div>
          <div class="notes-editor-meta-item">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            <span id="noteUpdatedAt">-</span>
          </div>
          <div class="notes-editor-save-status saved" id="noteSaveStatus">
            Saved
          </div>
        </div>

        <!-- Tiptap Editor -->
        <div class="notes-editor-content">
          <div id="tiptapEditor"></div>
        </div>

        <!-- Empty State (shown when no note selected) -->
        <div class="notes-empty-state" id="editorEmptyState">
          <svg class="notes-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <h3 class="notes-empty-title">No note selected</h3>
          <p class="notes-empty-description">Select a note from the list or create a new one</p>
        </div>
      </div>
    `;
  }

  /**
   * Initialize Tiptap editor
   */
  initializeTiptap() {
    if (!window.TiptapEditor) {
      console.error('[NoteEditor] Tiptap not loaded. Make sure tiptap-bundle-built.js is included.');
      return;
    }

    const editorEl = document.getElementById('tiptapEditor');
    if (!editorEl) {
      console.error('[NoteEditor] Editor element not found');
      return;
    }

    try {
      this.editor = new window.TiptapEditor({
        element: editorEl,
        extensions: [
          window.TiptapStarterKit,
          window.TiptapPlaceholder.configure({
            placeholder: 'Start writing your note...'
          }),
          window.TiptapTypography,
          window.TiptapTextAlign.configure({
            types: ['heading', 'paragraph']
          })
        ],
        content: '',
        editable: false, // Disabled by default until note is loaded
        onUpdate: ({ editor }) => {
          this.handleEditorUpdate(editor);
        }
      });

      console.log('[NoteEditor] Tiptap initialized successfully');
    } catch (error) {
      console.error('[NoteEditor] Failed to initialize Tiptap:', error);
      this.showError('Failed to initialize editor');
    }
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Title input
    const titleInput = document.getElementById('noteEditorTitle');
    if (titleInput) {
      titleInput.addEventListener('input', this.handleTitleChangeBound);
    }

    // Delete button
    const deleteBtn = document.getElementById('deleteNoteBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', this.handleDeleteBound);
    }
  }

  /**
   * Load a note into the editor
   */
  async loadNote(note) {
    // Clear pending auto-save before switching notes
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    // If there are unsaved changes, save before switching
    if (this.hasUnsavedChanges && this.currentNote && !this.isSaving) {
      await this.saveNote();
    }

    if (!note) {
      this.clearEditor();
      return;
    }

    this.currentNote = note;
    this.hasUnsavedChanges = false;

    // Show editor, hide empty state
    const emptyState = document.getElementById('editorEmptyState');
    const editorContent = document.querySelector('.notes-editor-content');
    if (emptyState) emptyState.style.display = 'none';
    if (editorContent) editorContent.style.display = 'block';

    // Enable inputs
    const titleInput = document.getElementById('noteEditorTitle');
    const deleteBtn = document.getElementById('deleteNoteBtn');

    if (titleInput) {
      titleInput.disabled = false;
      titleInput.value = note.title || '';
    }

    if (deleteBtn) deleteBtn.disabled = false;

    // Load content into Tiptap
    if (this.editor) {
      this.editor.commands.setContent(note.content || '');
      this.editor.setEditable(true);
    }

    // Update metadata
    this.updateMetadata(note);

    // Reset save status
    this.setSaveStatus('saved');
  }

  /**
   * Create a new blank note
   */
  async createNewNote() {
    if (!this.options.matterId || !this.options.apiClient) {
      console.error('[NoteEditor] Missing matterId or apiClient');
      return;
    }

    try {
      // Create blank note on backend
      const response = await this.options.apiClient.createNote(this.options.matterId, {
        title: 'Untitled Note',
        content: ''
      });

      const newNote = response.note;
      this.loadNote(newNote);

      // Notify parent
      if (this.options.onNoteSaved) {
        this.options.onNoteSaved(newNote, 'created');
      }

      this.showSuccess('Note created');
      return newNote;
    } catch (error) {
      console.error('[NoteEditor] Failed to create note:', error);
      this.showError('Failed to create note');
      return null;
    }
  }

  /**
   * Handle editor content update
   */
  handleEditorUpdate(editor) {
    if (!this.currentNote) return;

    this.hasUnsavedChanges = true;
    this.setSaveStatus('unsaved');
    this.scheduleAutoSave();
  }

  /**
   * Handle title input change
   */
  handleTitleChange(event) {
    if (!this.currentNote) return;

    this.currentNote.title = event.target.value;
    this.hasUnsavedChanges = true;
    this.setSaveStatus('unsaved');
    this.scheduleAutoSave();
  }

  /**
   * Schedule auto-save (debounced)
   */
  scheduleAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = setTimeout(() => {
      this.saveNote();
    }, this.options.autoSaveDelay);
  }

  /**
   * Save note to backend
   */
  async saveNote() {
    if (!this.currentNote || !this.editor) return;

    // Prevent concurrent saves (race condition protection)
    if (this.isSaving) {
      console.log('[NoteEditor] Save already in progress, skipping');
      return;
    }

    this.isSaving = true;

    const titleInput = document.getElementById('noteEditorTitle');
    const title = titleInput ? titleInput.value.trim() : 'Untitled Note';
    const content = this.editor.getHTML();

    // Validate
    const validation = this.options.apiClient.validateNoteData({ title, content });
    if (!validation.valid) {
      this.showError(validation.errors[0]);
      this.isSaving = false;
      return;
    }

    this.setSaveStatus('saving');

    try {
      const response = await this.options.apiClient.updateNote(
        this.options.matterId,
        this.currentNote.note_id,
        { title, content }
      );

      const updatedNote = response.note;
      this.currentNote = updatedNote;
      this.updateMetadata(updatedNote);
      this.hasUnsavedChanges = false;
      this.setSaveStatus('saved');

      // Notify parent
      if (this.options.onNoteSaved) {
        this.options.onNoteSaved(updatedNote, 'updated');
      }
    } catch (error) {
      console.error('[NoteEditor] Failed to save note:', error);
      this.setSaveStatus('unsaved');
      this.showError('Failed to save note');
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Handle delete note
   */
  async handleDelete() {
    if (!this.currentNote) return;

    const confirmed = window.confirm('Are you sure you want to delete this note?');
    if (!confirmed) return;

    try {
      await this.options.apiClient.deleteNote(this.options.matterId, this.currentNote.note_id);

      // Notify parent
      if (this.options.onNoteDeleted) {
        this.options.onNoteDeleted(this.currentNote.note_id);
      }

      this.showSuccess('Note deleted');
      this.clearEditor();
    } catch (error) {
      console.error('[NoteEditor] Failed to delete note:', error);
      this.showError('Failed to delete note');
    }
  }

  /**
   * Update metadata display
   */
  updateMetadata(note) {
    const createdEl = document.getElementById('noteCreatedAt');
    const updatedEl = document.getElementById('noteUpdatedAt');

    if (createdEl) {
      createdEl.textContent = `Created ${this.options.apiClient.formatRelativeDate(note.created_at)}`;
    }

    if (updatedEl) {
      updatedEl.textContent = `Updated ${this.options.apiClient.formatRelativeDate(note.updated_at)}`;
    }
  }

  /**
   * Set save status
   */
  setSaveStatus(status) {
    this.saveStatus = status;
    const statusEl = document.getElementById('noteSaveStatus');

    if (!statusEl) return;

    statusEl.className = `notes-editor-save-status ${status}`;

    switch (status) {
      case 'saved':
        statusEl.textContent = 'Saved';
        break;
      case 'saving':
        statusEl.textContent = 'Saving...';
        break;
      case 'unsaved':
        statusEl.textContent = 'Unsaved changes';
        break;
    }
  }

  /**
   * Clear editor (no note selected)
   */
  clearEditor() {
    this.currentNote = null;

    // Show empty state, hide editor
    const emptyState = document.getElementById('editorEmptyState');
    const editorContent = document.querySelector('.notes-editor-content');
    if (emptyState) emptyState.style.display = 'flex';
    if (editorContent) editorContent.style.display = 'none';

    // Disable inputs
    const titleInput = document.getElementById('noteEditorTitle');
    const deleteBtn = document.getElementById('deleteNoteBtn');

    if (titleInput) {
      titleInput.disabled = true;
      titleInput.value = '';
    }

    if (deleteBtn) deleteBtn.disabled = true;

    // Clear editor
    if (this.editor) {
      this.editor.commands.setContent('');
      this.editor.setEditable(false);
    }

    this.setSaveStatus('saved');
  }

  /**
   * Show success toast
   */
  showSuccess(message) {
    const toast = document.createElement('div');
    toast.className = 'note-toast success';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 2000);
  }

  /**
   * Show error toast
   */
  showError(message) {
    const toast = document.createElement('div');
    toast.className = 'note-toast error';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    // Remove event listeners using bound references
    const titleInput = document.getElementById('noteEditorTitle');
    if (titleInput) {
      titleInput.removeEventListener('input', this.handleTitleChangeBound);
    }

    const deleteBtn = document.getElementById('deleteNoteBtn');
    if (deleteBtn) {
      deleteBtn.removeEventListener('click', this.handleDeleteBound);
    }

    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NoteEditorComponent;
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.NoteEditorComponent = NoteEditorComponent;
}
