/**
 * Matter Notes Main Controller
 *
 * Coordinates between Note List and Note Editor components.
 * Manages state, routing, and communication between components.
 *
 * @requires api.js (global api instance)
 * @requires MatterNotesAPIClient
 * @requires NoteListComponent
 * @requires NoteEditorComponent
 */

class MatterNotesController {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }

    this.options = {
      matterId: options.matterId,
      ...options
    };

    // API client
    this.apiClient = null;

    // Components
    this.noteListComponent = null;
    this.noteEditorComponent = null;

    // State
    this.currentMatterId = this.options.matterId;
    this.isInitialized = false;

    this.init();
  }

  /**
   * Initialize controller
   */
  async init() {
    // Check for global api instance (can be window.api or just api)
    const globalApi = window.api || (typeof api !== 'undefined' ? api : null);

    if (!globalApi) {
      console.error('[MatterNotes] Global api instance not found');
      this.showError('API not initialized');
      return;
    }

    if (!this.currentMatterId) {
      console.error('[MatterNotes] No matterId provided');
      this.showError('Matter ID is required');
      return;
    }

    // Initialize API client
    this.apiClient = new window.MatterNotesAPIClient(globalApi);

    // Render container structure
    this.renderContainer();

    // Initialize components
    this.initializeComponents();

    this.isInitialized = true;
    console.log('[MatterNotes] Initialized successfully');
  }

  /**
   * Render main container structure
   */
  renderContainer() {
    this.container.innerHTML = `
      <div class="matter-notes-container">
        <!-- Notes List (Full Width) -->
        <div id="matterNotesList"></div>
      </div>
    `;
  }

  /**
   * Initialize Note List component (editor removed for simplified view)
   */
  initializeComponents() {
    // Initialize Note List Component (Full Width)
    try {
      this.noteListComponent = new window.NoteListComponent('matterNotesList', {
        matterId: this.currentMatterId,
        apiClient: this.apiClient,
        onNoteSelect: this.handleNoteSelect.bind(this),
        onNoteCreate: this.handleCreateNote.bind(this),
        onNoteDelete: this.handleNoteDelete.bind(this)
      });

      console.log('[MatterNotes] Note List Component initialized');
    } catch (error) {
      console.error('[MatterNotes] Failed to initialize Note List:', error);
      this.showError('Failed to initialize notes list');
    }

    // Editor component not initialized for simplified view
    this.noteEditorComponent = null;
    console.log('[MatterNotes] Editor component skipped (simplified view)');
  }

  /**
   * Handle note selection from list
   */
  handleNoteSelect(note) {
    console.log('[MatterNotes] Note selected:', note.note_id);

    if (this.noteEditorComponent) {
      this.noteEditorComponent.loadNote(note);
    }
  }

  /**
   * Handle create note button click
   */
  async handleCreateNote() {
    console.log('[MatterNotes] Creating new note');

    if (!this.noteEditorComponent) {
      this.showError('Editor not initialized');
      return;
    }

    // Create new note via editor
    const newNote = await this.noteEditorComponent.createNewNote();

    if (newNote && this.noteListComponent) {
      // Add to list
      this.noteListComponent.addNote(newNote);
    }
  }

  /**
   * Handle note saved (created or updated)
   */
  handleNoteSaved(note, action) {
    console.log('[MatterNotes] Note saved:', note.note_id, action);

    if (!this.noteListComponent) return;

    if (action === 'created') {
      // Already handled in handleCreateNote
    } else if (action === 'updated') {
      // Update in list
      this.noteListComponent.updateNote(note.note_id, note);
    }
  }

  /**
   * Handle note deleted from editor
   */
  handleNoteDeleted(noteId) {
    console.log('[MatterNotes] Note deleted:', noteId);

    if (this.noteListComponent) {
      this.noteListComponent.removeNote(noteId);
    }
  }

  /**
   * Handle note delete from list (future enhancement)
   */
  handleNoteDelete(noteId) {
    console.log('[MatterNotes] Delete request from list:', noteId);
    // Currently deletion is handled from editor
    // Could add swipe-to-delete or context menu in future
  }

  /**
   * Refresh all notes
   */
  async refresh() {
    console.log('[MatterNotes] Refreshing notes');

    if (this.noteListComponent) {
      await this.noteListComponent.loadNotes();
      await this.noteListComponent.loadStatistics();
    }
  }

  /**
   * Change matter (when switching between matters)
   */
  async changeMatter(matterId) {
    console.log('[MatterNotes] Changing matter to:', matterId);

    this.currentMatterId = matterId;

    // Update note list with new matter
    if (this.noteListComponent) {
      this.noteListComponent.options.matterId = matterId;
      await this.noteListComponent.loadNotes();
      await this.noteListComponent.loadStatistics();
    }
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
   * Destroy controller and cleanup
   */
  destroy() {
    console.log('[MatterNotes] Destroying controller');

    if (this.noteListComponent) {
      this.noteListComponent.destroy();
      this.noteListComponent = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
    }

    this.isInitialized = false;
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MatterNotesController;
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.MatterNotesController = MatterNotesController;
}

// Global instance management
let matterNotesInstance = null;

/**
 * Initialize Matter Notes for a specific matter
 * @param {string} containerId - Container element ID
 * @param {string} matterId - Matter ID
 * @returns {MatterNotesController} Controller instance
 */
function initializeMatterNotes(containerId, matterId) {
  // Destroy existing instance if present
  if (matterNotesInstance) {
    matterNotesInstance.destroy();
    matterNotesInstance = null;
  }

  // Create new instance
  matterNotesInstance = new MatterNotesController(containerId, {
    matterId: matterId
  });

  return matterNotesInstance;
}

/**
 * Get current Matter Notes instance
 * @returns {MatterNotesController|null}
 */
function getMatterNotesInstance() {
  return matterNotesInstance;
}

/**
 * Destroy Matter Notes instance
 */
function destroyMatterNotes() {
  if (matterNotesInstance) {
    matterNotesInstance.destroy();
    matterNotesInstance = null;
  }
}

// Expose global helper functions
if (typeof window !== 'undefined') {
  window.initializeMatterNotes = initializeMatterNotes;
  window.getMatterNotesInstance = getMatterNotesInstance;
  window.destroyMatterNotes = destroyMatterNotes;
}
