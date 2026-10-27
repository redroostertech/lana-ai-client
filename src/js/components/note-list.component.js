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
    this.editingNoteId = null; // Track which note is being edited

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
      const now = LanaTime.nowMs();
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
    this.mountModals();
    this.attachEventListeners();
    await this.loadNotes();
    await this.loadStatistics();
  }

  /**
   * Render initial HTML structure
   */
  render() {
    this.container.innerHTML = `
      <div class="flex flex-col h-full">
        <!--
          Hidden composer plumbing.
          The save/clear/focus-mode flow throughout this file reads + writes
          to these elements (see saveNote, toggleFocusMode, closeFocusMode).
          We hide the inline composer card per UX direction — notes are
          authored exclusively in the focus-mode modal — but keep these DOM
          nodes around so the existing handlers continue to work without a
          full refactor of the save pipeline.
        -->
        <div class="hidden" aria-hidden="true">
          <input type="text" id="notesTitleInput" placeholder="Note title..." />
          <div id="notesEditorContainer" contenteditable="true" data-placeholder="Start writing your note..."></div>
          <button id="notesSaveBtn">Save Note</button>
          <button id="notesClearBtn">Clear</button>
          <button id="notesFocusModeToggle" role="switch" aria-checked="false"><span></span></button>
        </div>

        <!-- Header — title + create CTA (empty state carries its own CTA) -->
        <div class="flex-shrink-0 mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-gray-900">Notes</h3>
          <button id="notesNewBtn" class="px-4 py-2 lex-bg-accent hover:lex-bg-accent text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
            New Note
          </button>
        </div>

        <!-- Notes List - Scrollable -->
        <div class="flex-1 overflow-y-auto">
          <div id="notesList" class="space-y-4 pr-2">
            <div class="text-center py-8">
              <div class="inline-block animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full"></div>
              <p class="mt-2 text-sm text-gray-500">Loading notes...</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Mount the note view and focus-mode dialogs as lex-modals on <body>
   * (re-mounting replaces earlier instances). The component supplies the
   * title, close button, backdrop, Escape, focus trap and scroll lock.
   * Buttons inside are handled by delegation on the modal element, so the
   * handlers survive the component capturing its children.
   */
  mountModals() {
    ['notesViewModal', 'notesFocusModal'].forEach((id) => {
      const existing = document.getElementById(id);
      if (existing) existing.remove();
    });

    const viewModal = document.createElement('lex-modal');
    viewModal.id = 'notesViewModal';
    viewModal.setAttribute('heading', 'Untitled Note');
    viewModal.setAttribute('size', 'xl');
    viewModal.setAttribute('hide-actions', '');
    viewModal.innerHTML = `
      <div id="notesViewMeta" class="mb-4 flex items-center gap-2 text-xs text-gray-500"></div>
      <div id="notesViewContent" class="prose max-w-none text-gray-700 leading-relaxed"></div>
      <button type="button" data-slot="footer" id="notesViewEditBtn" class="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Edit</button>
    `;

    const focusModal = document.createElement('lex-modal');
    focusModal.id = 'notesFocusModal';
    focusModal.setAttribute('heading', 'Focus Mode');
    focusModal.setAttribute('size', 'full');
    focusModal.setAttribute('hide-actions', '');
    focusModal.innerHTML = `
      <div class="max-w-4xl mx-auto px-8 py-8">
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
      <button type="button" data-slot="footer" id="notesFocusClearBtn" class="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800 font-medium">Clear</button>
      <button type="button" data-slot="footer" id="notesFocusSaveBtn" class="px-5 py-2.5 lex-bg-accent hover:lex-bg-accent text-white rounded-lg text-sm font-medium transition-colors">Save Note</button>
    `;

    document.body.appendChild(viewModal);
    document.body.appendChild(focusModal);

    viewModal.addEventListener('click', (e) => {
      const editBtn = e.target.closest && e.target.closest('#notesViewEditBtn');
      if (!editBtn) return;
      const noteId = editBtn.getAttribute('data-note-id');
      this.closeNoteView();
      this.handleEditNote(noteId);
    });
    focusModal.addEventListener('click', (e) => {
      if (!e.target.closest) return;
      if (e.target.closest('#notesFocusSaveBtn')) this.handleSaveNote(true);
      else if (e.target.closest('#notesFocusClearBtn')) this.handleClearNote(true);
    });

    // Header close, backdrop and Escape: keep the hidden composer in sync.
    focusModal.addEventListener('lex-close', () => this.closeFocusMode());
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // New Note button (header)
    const newBtn = document.getElementById('notesNewBtn');
    if (newBtn) {
      newBtn.addEventListener('click', () => this.startNewNote());
    }

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

    // Focus Mode Toggle (hidden plumbing — kept for backwards-compat)
    const focusToggle = document.getElementById('notesFocusModeToggle');
    if (focusToggle) {
      focusToggle.addEventListener('click', () => this.toggleFocusMode());
    }

    // Click on note items (delegated)
    const notesList = document.getElementById('notesList');
    if (notesList) {
      notesList.addEventListener('click', (e) => {
        // Handle edit button clicks
        if (e.target.closest('.note-edit-btn')) {
          e.stopPropagation();
          const editBtn = e.target.closest('.note-edit-btn');
          const noteId = editBtn.getAttribute('data-note-id');
          this.handleEditNote(noteId);
          return;
        }

        // Handle delete button clicks
        if (e.target.closest('.note-delete-btn')) {
          e.stopPropagation();
          const deleteBtn = e.target.closest('.note-delete-btn');
          const noteId = deleteBtn.getAttribute('data-note-id');
          this.handleDeleteNote(noteId);
          return;
        }

        // Handle note item clicks (for selection)
        const noteItem = e.target.closest('[data-note-id]');
        if (noteItem) {
          const noteId = noteItem.getAttribute('data-note-id');
          this.selectNote(noteId);
          this.openNoteView(noteId);
        }
      });
    }
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

    // Empty state — render a single CTA that takes the user straight into
    // the focus-mode editor via startNewNote(), same as the header button.
    if (this.filteredNotes.length === 0) {
      notesList.innerHTML = `
        <lex-empty
          id="notesEmptyCreateBtn"
          icon="document"
          message="No notes yet"
          description="Capture your first note for this matter."
          action-label="Create Note"
          action-icon="plus"
        ></lex-empty>
      `;
      const emptyCreateBtn = document.getElementById('notesEmptyCreateBtn');
      if (emptyCreateBtn) {
        emptyCreateBtn.addEventListener('action', () => this.startNewNote());
      }
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
            <button class="note-edit-btn p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="Edit note" data-note-id="${note.note_id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            </button>
            <button class="note-delete-btn p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete note" data-note-id="${note.note_id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Open a read-only note view. Edit is available from the modal header.
   */
  openNoteView(noteId) {
    const note = this.notes.find(n => n.note_id === noteId);
    if (!note) {
      this.showError('Note not found');
      return;
    }

    const modal = document.getElementById('notesViewModal');
    const meta = document.getElementById('notesViewMeta');
    const content = document.getElementById('notesViewContent');
    const editBtn = document.getElementById('notesViewEditBtn');

    if (!modal || !meta || !content || !editBtn) return;

    const relativeDate = this.options.apiClient.formatRelativeDate(note.updated_at || note.created_at);

    modal.heading = note.title || 'Untitled Note';
    meta.innerHTML = '';

    const dateEl = document.createElement('span');
    dateEl.textContent = relativeDate || '';
    meta.appendChild(dateEl);

    if (note.ai_generated) {
      const aiEl = document.createElement('span');
      aiEl.className = 'px-2 py-0.5 bg-purple-100 text-purple-700 rounded';
      aiEl.textContent = 'AI Generated';
      meta.appendChild(aiEl);
    }

    content.innerHTML = this.renderNoteContent(note.content || '<p>No content</p>');
    editBtn.setAttribute('data-note-id', note.note_id);
    modal.open = true;
  }

  /**
   * Close the read-only note view.
   */
  closeNoteView() {
    const modal = document.getElementById('notesViewModal');
    if (modal) modal.open = false;
  }

  /**
   * Conservative rich-text sanitizer for locally-authored note HTML.
   */
  sanitizeNoteContent(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html || '';

    const allowedTags = ['P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A', 'HR', 'SPAN'];
    const allowedAttributes = {
      A: ['href', 'title', 'target', 'rel']
    };

    wrapper.querySelectorAll('*').forEach((node) => {
      if (allowedTags.indexOf(node.tagName) === -1) {
        node.remove();
        return;
      }

      Array.from(node.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '').trim().toLowerCase();
        const tagAttributes = allowedAttributes[node.tagName] || [];
        if (tagAttributes.indexOf(name) === -1 ||
            name.indexOf('on') === 0 ||
            value.indexOf('javascript:') === 0 ||
            (name === 'href' && !this.isSafeNoteHref(attr.value))) {
          node.removeAttribute(attr.name);
        }
      });

      if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });

    return wrapper.innerHTML;
  }

  isSafeNoteHref(href) {
    const value = String(href || '').trim().toLowerCase();
    if (!value) return false;
    const compact = value.replace(/[\u0000-\u001f\u007f\s]+/g, '');
    const colonIndex = compact.indexOf(':');
    const pathStart = compact.search(/[/?#]/);

    if (colonIndex !== -1 && (pathStart === -1 || colonIndex < pathStart)) {
      const scheme = compact.substring(0, colonIndex + 1);
      return scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:' || scheme === 'tel:';
    }

    return true;
  }

  /**
   * Render stored note content safely. Existing rich HTML is sanitized;
   * plain text is escaped and newline runs are preserved as visible breaks.
   */
  renderNoteContent(content) {
    if (!content) return '';
    const value = String(content);
    if (this.isHtmlNoteContent(value)) {
      return this.sanitizeNoteContent(value);
    }

    const wrapper = document.createElement('div');
    value.split(/\r\n|\r|\n/).forEach((line, index) => {
      if (index > 0) wrapper.appendChild(document.createElement('br'));
      wrapper.appendChild(document.createTextNode(line));
    });
    return wrapper.innerHTML;
  }

  /**
   * Treat only actual parsed elements as HTML. Text such as "<script>" remains
   * plain text unless the browser creates an element from it.
   */
  isHtmlNoteContent(content) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content || '';
    const editorTags = ['P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A', 'HR', 'SPAN'];
    const hasTopLevelText = Array.from(wrapper.childNodes).some((node) => {
      return node.nodeType === 3 && String(node.textContent || '').trim();
    });
    if (hasTopLevelText) return false;

    return Array.from(wrapper.childNodes).some((node) => {
      return node.nodeType === 1 && editorTags.indexOf(node.tagName) !== -1;
    });
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
    if (fromFocusMode) {
      // Focus mode: try Tiptap first, fall back to contenteditable
      if (this.focusModeEditor) {
        // Get HTML from Tiptap editor
        content = this.focusModeEditor.getHTML();
        // Get text for validation
        const textContent = this.focusModeEditor.getText().trim();

        if (!title && !textContent) {
          this.showError('Please enter a title or content');
          return;
        }
      } else {
        // Fall back to contenteditable div
        const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
        if (!focusEditorContainer) {
          this.showError('Focus mode editor not found');
          return;
        }

        content = focusEditorContainer.innerHTML;
        const textContent = focusEditorContainer.textContent.trim();

        if (!title && !textContent) {
          this.showError('Please enter a title or content');
          return;
        }
      }
    } else {
      // Regular mode
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

      // Check if we're editing an existing note
      if (this.editingNoteId) {
        // Update existing note
        const response = await this.options.apiClient.updateNote(
          this.options.matterId,
          this.editingNoteId,
          noteData
        );

        // Extract note from response (API returns { note: Note })
        const updatedNote = response.note || response;

        // Update in list
        this.updateNote(this.editingNoteId, updatedNote);

        // Clear editing state
        this.editingNoteId = null;

        // Reset save button
        const saveBtn = document.getElementById('notesSaveBtn');
        if (saveBtn) {
          saveBtn.textContent = 'Save Note';
          saveBtn.classList.remove('bg-amber-600', 'hover:bg-amber-700');
          saveBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        }
        this.resetFocusSaveButton();

        this.showSuccess('Note updated successfully');
      } else {
        // Create new note
        const response = await this.options.apiClient.createNote(this.options.matterId, noteData);

        // Extract note from response (API returns { note: Note })
        const newNote = response.note || response;

        // Add to list
        this.notes.unshift(newNote);
        this.filteredNotes = [...this.notes];
        this.renderNotesList();

        this.showSuccess('Note saved successfully');
      }

      // Clear inputs
      titleInput.value = '';
      if (fromFocusMode) {
        // Clear focus mode editor
        if (this.focusModeEditor) {
          this.focusModeEditor.commands.clearContent();
        } else {
          const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
          if (focusEditorContainer) focusEditorContainer.textContent = '';
        }
      } else {
        // Clear regular mode editor
        const editorContainer = document.getElementById('notesEditorContainer');
        if (editorContainer) editorContainer.textContent = '';
      }

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

    if (fromFocusMode) {
      // Clear focus mode editor
      if (this.focusModeEditor) {
        this.focusModeEditor.commands.clearContent();
      } else {
        const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
        if (focusEditorContainer) focusEditorContainer.textContent = '';
      }
    } else {
      // Clear regular contenteditable
      const editorContainer = document.getElementById('notesEditorContainer');
      if (editorContainer) editorContainer.textContent = '';
    }

    // Reset editing state if we were editing
    if (this.editingNoteId) {
      this.editingNoteId = null;

      // Reset save button
      const saveBtn = document.getElementById('notesSaveBtn');
      if (saveBtn) {
        saveBtn.textContent = 'Save Note';
        saveBtn.classList.remove('bg-amber-600', 'hover:bg-amber-700');
        saveBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
      }
      this.resetFocusSaveButton();
    }
  }

  /**
   * Open the focus-mode editor for a brand-new note. Clears any lingering
   * edit state so the save path POSTs a create instead of PUTting an update
   * over the previously edited note.
   */
  startNewNote() {
    this.editingNoteId = null;

    const titleInput = document.getElementById('notesTitleInput');
    if (titleInput) titleInput.value = '';
    const editorContainer = document.getElementById('notesEditorContainer');
    if (editorContainer) editorContainer.innerHTML = '';

    const focusTitle = document.getElementById('notesFocusTitleInput');
    if (focusTitle) focusTitle.value = '';
    if (this.focusModeEditor) {
      this.focusModeEditor.commands.clearContent();
    } else {
      const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
      if (focusEditorContainer) focusEditorContainer.innerHTML = '';
    }

    this.resetFocusSaveButton();
    this.toggleFocusMode();
  }

  resetFocusSaveButton() {
    const focusSaveBtn = document.getElementById('notesFocusSaveBtn');
    if (focusSaveBtn) {
      focusSaveBtn.textContent = 'Save Note';
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
    if (!this.focusModeEditor && window.TiptapEditor) {
      const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
      if (focusEditorContainer) {
        try {
          this.focusModeEditor = new window.TiptapEditor({
            element: focusEditorContainer,
            extensions: [
              window.TiptapStarterKit.configure({
                heading: {
                  levels: [1, 2, 3]
                }
              }),
              window.TiptapPlaceholder.configure({
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

    // Copy content from regular editor to focus mode editor
    const regularEditor = document.getElementById('notesEditorContainer');
    if (regularEditor) {
      const content = regularEditor.innerHTML;

      if (this.focusModeEditor) {
        // Copy to Tiptap
        this.focusModeEditor.commands.setContent(content);
      } else {
        // Copy to contenteditable
        const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
        if (focusEditorContainer) {
          focusEditorContainer.innerHTML = content;
        }
      }
    }

    // Show modal
    modal.open = true;

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

    // Copy content from focus mode back to regular editor
    const regularEditor = document.getElementById('notesEditorContainer');
    if (regularEditor) {
      if (this.focusModeEditor) {
        // Copy from Tiptap
        const content = this.focusModeEditor.getHTML();
        regularEditor.innerHTML = content;
      } else {
        // Copy from contenteditable
        const focusEditorContainer = document.getElementById('notesFocusEditorContainer');
        if (focusEditorContainer) {
          regularEditor.innerHTML = focusEditorContainer.innerHTML;
        }
      }
    }

    // Hide modal
    if (modal.open) modal.open = false;

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
   * Handle edit note button click
   */
  async handleEditNote(noteId) {
    const note = this.notes.find(n => n.note_id === noteId);
    if (!note) {
      this.showError('Note not found');
      return;
    }

    // Populate the editor with the note content for editing
    const titleInput = document.getElementById('notesTitleInput');
    const editorContainer = document.getElementById('notesEditorContainer');

    if (titleInput) {
      titleInput.value = note.title || '';
    }

    if (editorContainer) {
      editorContainer.innerHTML = this.renderNoteContent(note.content || '');
    }

    // Store the note being edited so we can update instead of create
    this.editingNoteId = noteId;

    // Update the save button to show "Update Note"
    const saveBtn = document.getElementById('notesSaveBtn');
    if (saveBtn) {
      saveBtn.textContent = 'Update Note';
      saveBtn.classList.add('bg-amber-600', 'hover:bg-amber-700');
      saveBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
    }

    this.toggleFocusMode();

    const focusSaveBtn = document.getElementById('notesFocusSaveBtn');
    if (focusSaveBtn) {
      focusSaveBtn.textContent = 'Update Note';
    }

    // Focus on title input
    const focusTitle = document.getElementById('notesFocusTitleInput');
    if (focusTitle) {
      setTimeout(() => focusTitle.focus(), 150);
    }

    this.showSuccess('Note loaded for editing');
  }

  /**
   * Handle delete note button click
   */
  async handleDeleteNote(noteId) {
    const note = this.notes.find(n => n.note_id === noteId);
    if (!note) {
      this.showError('Note not found');
      return;
    }

    // Show custom delete confirmation modal
    this.showDeleteModal(note.title || 'Untitled Note', async () => {
      try {
        await this.options.apiClient.deleteNote(this.options.matterId, noteId);

        // Remove from list
        this.removeNote(noteId);

        this.showSuccess('Note deleted successfully');

        // Notify parent if callback exists
        if (this.options.onNoteDelete) {
          this.options.onNoteDelete(noteId);
        }
      } catch (error) {
        console.error('[NoteList] Failed to delete note:', error);
        this.showError('Failed to delete note');
      }
    });
  }

  /**
   * Ask for delete confirmation (Lex.Modal.confirmAsync escapes the title)
   */
  async showDeleteModal(noteTitle, onConfirm) {
    const confirmed = await window.Lex.Modal.confirmAsync(
      'Delete note',
      `Are you sure you want to delete "${noteTitle}"? This action cannot be undone.`,
      { variant: 'danger', confirmText: 'Delete note' }
    );
    if (confirmed) onConfirm();
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
