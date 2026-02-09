/**
 * Note List Component
 *
 * Renders the left sidebar with scrollable notes list.
 * Features:
 * - Virtual scrolling for 1000+ notes performance
 * - Search/filter integration
 * - Selection state management
 * - Statistics display
 * - Auto-refresh on updates
 *
 * @requires MatterNotesAPIClient
 */

class NoteListComponent {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }

    this.options = {
      matterId: options.matterId,
      apiClient: options.apiClient,
      onNoteSelect: options.onNoteSelect || (() => {}),
      onNoteCreate: options.onNoteCreate || (() => {}),
      onNoteDelete: options.onNoteDelete || (() => {}),
      itemHeight: options.itemHeight || 100, // Virtual scroll item height
      bufferSize: options.bufferSize || 5, // Number of items to render outside viewport
      ...options
    };

    this.notes = [];
    this.filteredNotes = [];
    this.selectedNoteId = null;
    this.searchQuery = '';
    this.statistics = null;
    this.isSearching = false;
    this.focusModeEditor = null; // Tiptap editor instance for focus mode

    // Virtual scrolling state
    this.virtualScroll = {
      startIndex: 0,
      endIndex: 0,
      scrollTop: 0
    };
    this.lastRenderedRange = { start: -1, end: -1 };

    // Bind event handlers once to prevent memory leaks
    this.handleSearchBound = this.handleSearch.bind(this);
    this.handleScrollBound = this.throttle(this.handleScroll.bind(this), 100);

    // Debounced API search
    this.apiSearchDebounced = this.debounce((query) => {
      this.performAPISearch(query);
    }, 500);

    this.init();
  }

  /**
   * Throttle helper for scroll events
   */
  throttle(func, delay) {
    let lastCall = 0;
    return function(...args) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        return func.apply(this, args);
      }
    };
  }

  /**
   * Debounce helper for search input
   */
  debounce(func, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }

  /**
   * Initialize component
   */
  async init() {
    this.render();
    this.attachEventListeners();
    await this.loadNotes();
    await this.loadStatistics();
  }

  /**
   * Render initial HTML structure
   */
  render() {
    this.container.innerHTML = `
      <div class="space-y-4">
        <!-- Note Composer - Unified Component -->
        <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <!-- Header with Focus Mode Toggle -->
          <div class="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
            <h3 class="text-sm font-medium text-gray-700">New Note</h3>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500">Focus Mode</span>
              <button
                id="notesFocusModeToggle"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 bg-gray-200"
                role="switch"
                aria-checked="false"
              >
                <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1"></span>
              </button>
            </div>
          </div>

          <!-- Editor Content -->
          <div class="p-4">
            <input
              type="text"
              id="notesTitleInput"
              class="w-full px-0 py-2 border-0 border-b border-gray-200 focus:ring-0 focus:border-indigo-500 text-base outline-none mb-3 font-semibold placeholder-gray-400"
              placeholder="Note title..."
            />
            <div
              id="notesEditorContainer"
              contenteditable="true"
              class="w-full px-0 py-2 border-0 focus:ring-0 min-h-[120px] text-sm outline-none text-gray-700 placeholder-gray-400"
              data-placeholder="Start writing your note..."
            ></div>
          </div>

          <!-- Footer with Actions -->
          <div class="px-4 pb-4 flex justify-end gap-2">
            <button id="notesClearBtn" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium">Clear</button>
            <button id="notesSaveBtn" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shadow-sm">Save Note</button>
          </div>
        </div>

        <!-- Notes List -->
        <div id="notesList" class="space-y-4">
          <div class="text-center py-8">
            <div class="inline-block animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full"></div>
            <p class="mt-2 text-sm text-gray-500">Loading notes...</p>
          </div>
        </div>
      </div>

      <!-- Focus Mode Modal -->
      <div id="notesFocusModal" class="hidden fixed inset-0 z-50 bg-white">
        <div class="h-full flex flex-col">
          <!-- Modal Header -->
          <div class="flex-shrink-0 border-b border-gray-200 px-8 py-4 flex items-center justify-between">
            <div class="flex items-center gap-4">
              <button id="notesFocusClose" class="text-gray-400 hover:text-gray-600">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
              <span class="text-sm text-gray-500">Focus Mode</span>
            </div>
          </div>

          <!-- Modal Content - Notion Style -->
          <div class="flex-1 overflow-y-auto">
            <div class="max-w-4xl mx-auto px-8 py-12">
              <input
                type="text"
                id="notesFocusTitleInput"
                class="w-full text-4xl font-bold text-gray-900 border-none outline-none mb-4 placeholder-gray-300"
                placeholder="Untitled"
              />
              <div
                id="notesFocusEditorContainer"
                contenteditable="true"
                class="w-full text-base text-gray-700 outline-none min-h-[500px] leading-relaxed"
                data-placeholder="Start writing..."
              ></div>
            </div>
          </div>

          <!-- Modal Footer - Fixed CTAs -->
          <div class="flex-shrink-0 border-t border-gray-200 px-8 py-4 flex justify-end gap-3">
            <button id="notesFocusClearBtn" class="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800 font-medium">Clear</button>
            <button id="notesFocusSaveBtn" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save Note</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Save Note button (regular)
    const saveBtn = document.getElementById('notesSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.handleSaveNote());
    }

    // Clear button (regular)
    const clearBtn = document.getElementById('notesClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.handleClearNote());
    }

    // Focus Mode Toggle
    const focusToggle = document.getElementById('notesFocusModeToggle');
    if (focusToggle) {
      focusToggle.addEventListener('click', () => this.toggleFocusMode());
    }

    // Focus Mode Close
    const focusClose = document.getElementById('notesFocusClose');
    if (focusClose) {
      focusClose.addEventListener('click', () => this.closeFocusMode());
    }

    // Focus Mode Save
    const focusSaveBtn = document.getElementById('notesFocusSaveBtn');
    if (focusSaveBtn) {
      focusSaveBtn.addEventListener('click', () => this.handleSaveNote(true));
    }

    // Focus Mode Clear
    const focusClearBtn = document.getElementById('notesFocusClearBtn');
    if (focusClearBtn) {
      focusClearBtn.addEventListener('click', () => this.handleClearNote(true));
    }

    // Click on note items (delegated)
    const notesList = document.getElementById('notesList');
    if (notesList) {
      notesList.addEventListener('click', (e) => {
        const noteItem = e.target.closest('[data-note-id]');
        if (noteItem) {
          const noteId = noteItem.getAttribute('data-note-id');
          this.selectNote(noteId);
        }
      });
    }

    // ESC key to close focus mode
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('notesFocusModal');
        if (modal && !modal.classList.contains('hidden')) {
          this.closeFocusMode();
        }
      }
    });
  }

  /**
   * Load notes from API
   */
  async loadNotes() {
    if (!this.options.matterId || !this.options.apiClient) {
      console.error('[NoteList] Missing matterId or apiClient');
      return;
    }

    const loadingEl = document.getElementById('notesLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
      // Load all notes (auto-pagination)
      this.notes = await this.options.apiClient.loadAllNotes(this.options.matterId, {
        limit: 100,
        maxNotes: 1000,
        onProgress: (loaded, total) => {
          // Could show progress bar here
          console.log(`Loaded ${loaded}/${total} notes`);
        }
      });

      this.filteredNotes = [...this.notes];
      this.renderNotesList();
      this.updateStatistics();
    } catch (error) {
      console.error('[NoteList] Failed to load notes:', error);
      this.showError('Failed to load notes. Please try again.');
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /**
   * Load statistics from API
   */
  async loadStatistics() {
    if (!this.options.matterId || !this.options.apiClient) return;

    try {
      const response = await this.options.apiClient.getStatistics(this.options.matterId);
      this.statistics = response;
      this.updateStatistics();
    } catch (error) {
      console.error('[NoteList] Failed to load statistics:', error);
    }
  }

  /**
   * Update statistics display (removed - not needed in Comments-style layout)
   */
  updateStatistics() {
    // No longer displaying count separately - it's implicit in the list
  }

  /**
   * Render notes list (Comments-style)
   */
  renderNotesList() {
    const notesList = document.getElementById('notesList');
    if (!notesList) return;

    // Empty state
    if (this.filteredNotes.length === 0) {
      notesList.innerHTML = `
        <div class="text-center py-8 text-gray-500">
          <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <p>No notes yet</p>
        </div>
      `;
      return;
    }

    // Render all notes (simple list, no virtual scrolling for now)
    notesList.innerHTML = this.filteredNotes.map(note => this.renderNoteItem(note)).join('');
  }

  /**
   * Calculate virtual scroll range
   */
  calculateVirtualScroll() {
    const notesList = document.getElementById('notesList');
    if (!notesList) return;

    const viewportHeight = notesList.clientHeight;
    const scrollTop = notesList.scrollTop;

    const startIndex = Math.max(0, Math.floor(scrollTop / this.options.itemHeight) - this.options.bufferSize);
    const visibleCount = Math.ceil(viewportHeight / this.options.itemHeight);
    const endIndex = Math.min(
      this.filteredNotes.length,
      startIndex + visibleCount + this.options.bufferSize * 2
    );

    // Only update if range changed (avoid unnecessary re-renders)
    if (startIndex === this.lastRenderedRange.start &&
        endIndex === this.lastRenderedRange.end) {
      return; // Skip re-render
    }

    this.lastRenderedRange = { start: startIndex, end: endIndex };

    this.virtualScroll = {
      startIndex,
      endIndex,
      scrollTop
    };
  }

  /**
   * Render individual note item
   */
  renderNoteItem(note) {
    const preview = this.options.apiClient.formatPreview(note.content, 200);
    const relativeDate = this.options.apiClient.formatRelativeDate(note.updated_at || note.created_at);

    return `
      <div class="bg-white rounded-lg border border-gray-200 p-4 hover:border-indigo-200 transition-colors cursor-pointer" data-note-id="${note.note_id}">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <h3 class="text-base font-semibold text-gray-900 mb-1">${this.escapeHtml(note.title || 'Untitled Note')}</h3>
            <p class="text-sm text-gray-600 line-clamp-2">${this.escapeHtml(preview || 'No content')}</p>
            <div class="mt-2 flex items-center gap-2 text-xs text-gray-500">
              <span>${relativeDate}</span>
              ${note.ai_generated ? '<span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded">AI Generated</span>' : ''}
            </div>
          </div>
          <div class="flex gap-1 flex-shrink-0">
            <button class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="Edit note" onclick="event.stopPropagation()">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            </button>
            <button class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete note" onclick="event.stopPropagation()">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Handle search input
   */
  async handleSearch(event) {
    const query = event.target.value.trim();
    this.searchQuery = query;

    if (query.length === 0) {
      // Reset to all notes
      this.filteredNotes = [...this.notes];
      this.renderNotesList();
      this.updateStatistics();
      return;
    }

    if (query.length < 3) {
      // Local filter for short queries (immediate)
      this.filteredNotes = this.notes.filter(note =>
        note.title.toLowerCase().includes(query.toLowerCase()) ||
        (note.content && note.content.toLowerCase().includes(query.toLowerCase()))
      );
      this.renderNotesList();
      this.updateStatistics();
      return;
    }

    // API search for longer queries (debounced)
    this.apiSearchDebounced(query);
  }

  /**
   * Perform API search (called via debounce)
   */
  async performAPISearch(query) {
    this.isSearching = true;
    const loadingEl = document.getElementById('notesLoading');
    if (loadingEl) loadingEl.style.display = 'flex';

    try {
      const response = await this.options.apiClient.searchNotes(
        this.options.matterId,
        query,
        { limit: 100 }
      );

      this.filteredNotes = response.results || [];
      this.renderNotesList();
      this.updateStatistics();
    } catch (error) {
      console.error('[NoteList] Search failed:', error);
      this.showError('Search failed. Please try again.');
    } finally {
      this.isSearching = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /**
   * Handle scroll event (virtual scrolling)
   */
  handleScroll() {
    this.renderNotesList();
  }

  /**
   * Handle save note button click
   */
  async handleSaveNote(fromFocusMode = false) {
    const titleInput = fromFocusMode
      ? document.getElementById('notesFocusTitleInput')
      : document.getElementById('notesTitleInput');

    if (!titleInput) return;

    const title = titleInput.value.trim();
    let content = '';

    // Get content from appropriate editor
    if (fromFocusMode && this.focusModeEditor) {
      // Get HTML from Tiptap editor
      content = this.focusModeEditor.getHTML();
      // Get text for validation
      const textContent = this.focusModeEditor.getText().trim();

      if (!title && !textContent) {
        this.showError('Please enter a title or content');
        return;
      }
    } else {
      const editorContainer = document.getElementById('notesEditorContainer');
      if (!editorContainer) return;

      content = editorContainer.innerHTML;
      const textContent = editorContainer.textContent.trim();

      if (!title && !textContent) {
        this.showError('Please enter a title or content');
        return;
      }
    }

    try {
      const noteData = {
        title: title || 'Untitled Note',
        content: content,
        ai_generated: false
      };

      const newNote = await this.options.apiClient.createNote(this.options.matterId, noteData);

      // Add to list
      this.notes.unshift(newNote);
      this.filteredNotes = [...this.notes];
      this.renderNotesList();

      // Clear inputs
      titleInput.value = '';
      if (fromFocusMode && this.focusModeEditor) {
        this.focusModeEditor.commands.clearContent();
      } else {
        const editorContainer = document.getElementById('notesEditorContainer');
        if (editorContainer) editorContainer.textContent = '';
      }

      this.showSuccess('Note saved successfully');

      // Close focus mode if saving from there
      if (fromFocusMode) {
        this.closeFocusMode();
      }
    } catch (error) {
      console.error('[NoteList] Failed to save note:', error);
      this.showError('Failed to save note');
    }
  }

  /**
   * Handle clear button click
   */
  handleClearNote(fromFocusMode = false) {
    const titleInput = fromFocusMode
      ? document.getElementById('notesFocusTitleInput')
      : document.getElementById('notesTitleInput');

    if (titleInput) titleInput.value = '';

    if (fromFocusMode && this.focusModeEditor) {
      // Clear Tiptap editor in focus mode
      this.focusModeEditor.commands.clearContent();
    } else {
      // Clear regular contenteditable
      const editorContainer = document.getElementById('notesEditorContainer');
      if (editorContainer) editorContainer.textContent = '';
    }
  }

  /**
   * Toggle focus mode
   */
  toggleFocusMode() {
    const modal = document.getElementById('notesFocusModal');
    const toggle = document.getElementById('notesFocusModeToggle');
    const toggleButton = toggle?.querySelector('span');

    if (!modal) return;

    // Copy title
    const regularTitle = document.getElementById('notesTitleInput');
    const focusTitle = document.getElementById('notesFocusTitleInput');

    if (regularTitle && focusTitle) {
      focusTitle.value = regularTitle.value;
    }

    // Initialize Tiptap editor if not already created
    if (!this.focusModeEditor && window.Tiptap) {
      const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
      if (focusEditorContainer) {
        try {
          this.focusModeEditor = new window.Tiptap.Editor({
            element: focusEditorContainer,
            extensions: [
              window.Tiptap.StarterKit.configure({
                heading: {
                  levels: [1, 2, 3]
                }
              }),
              window.Tiptap.Placeholder.configure({
                placeholder: 'Start writing...'
              })
            ],
            editorProps: {
              attributes: {
                class: 'prose prose-lg max-w-none focus:outline-none'
              }
            }
          });

          console.log('[NoteList] Tiptap editor initialized for focus mode');
        } catch (error) {
          console.error('[NoteList] Failed to initialize Tiptap:', error);
        }
      }
    }

    // Copy content from regular editor to Tiptap
    const regularEditor = document.getElementById('notesEditorContainer');
    if (regularEditor && this.focusModeEditor) {
      const content = regularEditor.innerHTML;
      this.focusModeEditor.commands.setContent(content);
    }

    // Show modal
    modal.classList.remove('hidden');

    // Update toggle appearance
    if (toggle) {
      toggle.classList.add('bg-indigo-600');
      toggle.classList.remove('bg-gray-200');
      toggle.setAttribute('aria-checked', 'true');
    }
    if (toggleButton) {
      toggleButton.classList.add('translate-x-6');
      toggleButton.classList.remove('translate-x-1');
    }

    // Focus on title input
    if (focusTitle) {
      setTimeout(() => focusTitle.focus(), 100);
    }
  }

  /**
   * Close focus mode
   */
  closeFocusMode() {
    const modal = document.getElementById('notesFocusModal');
    const toggle = document.getElementById('notesFocusModeToggle');
    const toggleButton = toggle?.querySelector('span');

    if (!modal) return;

    // Copy title back
    const regularTitle = document.getElementById('notesTitleInput');
    const focusTitle = document.getElementById('notesFocusTitleInput');

    if (regularTitle && focusTitle) {
      regularTitle.value = focusTitle.value;
    }

    // Copy content from Tiptap back to regular editor
    const regularEditor = document.getElementById('notesEditorContainer');
    if (regularEditor && this.focusModeEditor) {
      const content = this.focusModeEditor.getHTML();
      regularEditor.innerHTML = content;
    }

    // Hide modal
    modal.classList.add('hidden');

    // Update toggle appearance
    if (toggle) {
      toggle.classList.remove('bg-indigo-600');
      toggle.classList.add('bg-gray-200');
      toggle.setAttribute('aria-checked', 'false');
    }
    if (toggleButton) {
      toggleButton.classList.remove('translate-x-6');
      toggleButton.classList.add('translate-x-1');
    }
  }

  /**
   * Select a note
   */
  selectNote(noteId) {
    this.selectedNoteId = noteId;
    const note = this.notes.find(n => n.note_id === noteId);

    if (note && this.options.onNoteSelect) {
      this.options.onNoteSelect(note);
    }

    this.renderNotesList();
  }

  /**
   * Add a new note to the list (after creation)
   */
  addNote(note) {
    this.notes.unshift(note); // Add to beginning
    this.filteredNotes = [...this.notes];
    this.renderNotesList();
    this.updateStatistics();
    this.selectNote(note.note_id);
  }

  /**
   * Update a note in the list
   */
  updateNote(noteId, updates) {
    const index = this.notes.findIndex(n => n.note_id === noteId);
    if (index !== -1) {
      this.notes[index] = { ...this.notes[index], ...updates };
      this.filteredNotes = [...this.notes];
      this.renderNotesList();
    }
  }

  /**
   * Remove a note from the list
   */
  removeNote(noteId) {
    this.notes = this.notes.filter(n => n.note_id !== noteId);
    this.filteredNotes = [...this.notes];

    if (this.selectedNoteId === noteId) {
      this.selectedNoteId = null;
    }

    this.renderNotesList();
    this.updateStatistics();
  }

  /**
   * Get selected note
   */
  getSelectedNote() {
    return this.notes.find(n => n.note_id === this.selectedNoteId);
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.selectedNoteId = null;
    this.renderNotesList();
  }

  /**
   * Show error message
   */
  showError(message) {
    // Use Tailwind-styled toast
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-slide-up';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    // Use Tailwind-styled toast
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-slide-up';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 2000);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    // Remove event listeners using bound references
    const notesList = document.getElementById('notesList');
    if (notesList) {
      notesList.removeEventListener('scroll', this.handleScrollBound);
    }

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NoteListComponent;
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.NoteListComponent = NoteListComponent;
}
