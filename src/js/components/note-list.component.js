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
 * @requires MatterLinksAPIClient (link chips; optional)
 * @requires LanaNoteLabels (shared/note-labels.js)
 * @requires LanaEntityLinks (shared/entity-links.js)
 */

function noteListModule(globalName, path) {
  if (typeof window !== 'undefined' && window[globalName]) return window[globalName];
  return require(path);
}

class NoteListComponent {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }

    this.options = {
      matterId: options.matterId,
      apiClient: options.apiClient,
      linksClient: options.linksClient || null,
      factLabels: options.factLabels || null,
      openRunCausation: options.openRunCausation || null, // (runKind, runId) for produced_by chips
      noteActions: options.noteActions || null, // { actionsFor(note), run(note, action, onRecorded) }: the makeup's note actions
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
    this.filters = { label: '', unlinked: false };
    this.linkLabelIndex = {}; // kind:id -> readable label for link chips
    this.loadedLinkKinds = {};

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

  labels() {
    return noteListModule('LanaNoteLabels', '../shared/note-labels.js');
  }

  entityLinks() {
    return noteListModule('LanaEntityLinks', '../shared/entity-links.js');
  }

  factLabels() {
    return this.labels().factLabels(this.options && this.options.factLabels);
  }

  /**
   * Escape text for a double-quoted HTML attribute.
   */
  escapeAttr(text) {
    return this.escapeHtml(text == null ? '' : String(text)).split('"').join('&quot;');
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

        <!-- Filters: fact label and unlinked -->
        <div class="notes-filters flex-shrink-0">
          <lex-select id="notesLabelFilter" class="notes-filters__label" size="sm" aria-label="Filter by label"></lex-select>
          <lex-checkbox id="notesUnlinkedFilter" label="Unlinked only"></lex-checkbox>
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
      <div id="notesViewLinks" class="note-links"></div>
      <button type="button" data-slot="footer" id="notesViewEditBtn" class="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">Edit</button>
    `;

    const focusModal = document.createElement('lex-modal');
    focusModal.id = 'notesFocusModal';
    focusModal.setAttribute('heading', 'Focus Mode');
    focusModal.setAttribute('size', 'full');
    focusModal.setAttribute('hide-actions', '');
    focusModal.innerHTML = `
      <div class="max-w-4xl mx-auto px-8 py-8">
        <textarea
          id="notesFocusTitleInput"
          rows="1"
          class="notes-focus-title w-full text-4xl font-bold text-gray-900 border-none outline-none mb-4 placeholder-gray-300"
          placeholder="Untitled"
        ></textarea>
        <lex-select id="notesFocusLabelSelect" class="notes-focus-label" label="Label" size="sm"></lex-select>
        <div id="notesFocusLinks" class="note-links notes-focus-links" hidden></div>
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
      const removeBtn = e.target.closest && e.target.closest('.note-link-chip__remove');
      if (removeBtn) {
        this.handleRemoveLink(removeBtn.getAttribute('data-note-id'), removeBtn.getAttribute('data-link-id'));
        return;
      }
      const repinBtn = e.target.closest && e.target.closest('.note-link-chip__repin');
      if (repinBtn) {
        this.openLinkPicker(repinBtn.getAttribute('data-note-id'), 'document', {
          documentId: repinBtn.getAttribute('data-document-id'),
          releaseId: repinBtn.getAttribute('data-release-id') || ''
        });
        return;
      }
      const actionBtn = e.target.closest && e.target.closest('.note-links__action');
      if (actionBtn) {
        this.runNoteAction(actionBtn.getAttribute('data-note-id'), actionBtn.getAttribute('data-note-action'));
        return;
      }
      const whyBtn = e.target.closest && e.target.closest('.note-link-chip__why');
      if (whyBtn) {
        if (this.options.openRunCausation) this.options.openRunCausation(whyBtn.getAttribute('data-run-kind'), whyBtn.getAttribute('data-run-id'));
        return;
      }
      const editBtn = e.target.closest && e.target.closest('#notesViewEditBtn');
      if (!editBtn) return;
      const noteId = editBtn.getAttribute('data-note-id');
      this.closeNoteView();
      this.handleEditNote(noteId);
    });
    viewModal.addEventListener('lex-select', (e) => {
      const menu = e.target.closest && e.target.closest('#notesViewAddLink');
      if (!menu || !e.detail) return;
      this.openLinkPicker(menu.getAttribute('data-note-id'), e.detail.value);
    });
    // The title wraps like a heading but stays one line of text.
    focusModal.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.id === 'notesFocusTitleInput') e.preventDefault();
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

    this.initFilters();

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
   * Fill the label filter and listen for filter changes. Filtering is done
   * by the server (?label= and ?unlinked=true).
   */
  initFilters() {
    const labelFilter = document.getElementById('notesLabelFilter');
    if (labelFilter) {
      const filterOptions = this.labels().labelFilterOptions(this.factLabels());
      labelFilter.options = filterOptions;
      // lex-select shows its placeholder for an empty value, so the empty
      // option's own text ("All labels") is the placeholder.
      labelFilter.placeholder = filterOptions[0].label;
      labelFilter.value = this.filters.label;
      labelFilter.addEventListener('lex-change', (e) => {
        this.filters.label = (e.detail && e.detail.value) || '';
        this.loadNotes();
      });
    }

    const unlinkedFilter = document.getElementById('notesUnlinkedFilter');
    if (unlinkedFilter) {
      unlinkedFilter.addEventListener('lex-change', (e) => {
        this.filters.unlinked = !!(e.detail && e.detail.value);
        this.loadNotes();
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
        label: this.filters.label,
        unlinked: this.filters.unlinked,
        onProgress: (loaded, total) => {
          // Could show progress bar here
          console.log(`Loaded ${loaded}/${total} notes`);
        }
      });

      this.filteredNotes = [...this.notes];
      this.renderNotesList();
      this.updateStatistics();
      this.loadLinkLabels();
    } catch (error) {
      console.error('[NoteList] Failed to load notes:', error);
      this.showError('Failed to load notes. Please try again.');
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  /**
   * Fetch readable names for link targets the loaded notes point at (one
   * request per record kind, once per component), then re-render.
   */
  async loadLinkLabels() {
    const linksClient = this.options.linksClient;
    if (!linksClient) return;
    const kinds = this.entityLinks().kindsNeedingLookup(this.notes, 'matter_note')
      .filter((kind) => !this.loadedLinkKinds[kind]);
    if (kinds.length === 0) return;

    await Promise.all(kinds.map((kind) => this.loadLinkCandidates(kind)));
    this.renderNotesList();
  }

  /**
   * Existing matter records of one kind for the link picker and chip labels.
   */
  async loadLinkCandidates(kind) {
    if (this.loadedLinkKinds[kind]) return this.loadedLinkKinds[kind];
    const candidates = await this.options.linksClient.loadCandidates(kind);
    this.loadedLinkKinds[kind] = candidates;
    this.entityLinks().indexCandidates(this.linkLabelIndex, kind, candidates);
    return candidates;
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
    if (this.filteredNotes.length === 0 && this.labels().hasActiveFilters(this.filters)) {
      notesList.innerHTML = `
        <lex-empty
          icon="filter"
          message="No matching notes"
          description="No notes match these filters."
        ></lex-empty>
      `;
      return;
    }

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
              ${this.renderFactBadges(note)}
            </div>
            ${this.renderLinkChips(note, false)}
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
   * Label badge and the "Not supported" flag. evidence_status is derived by
   * the server from the note's cites links.
   */
  renderFactBadges(note) {
    if (!note || !note.label) return '';
    const labelText = this.labels().labelText(note.label, this.factLabels());
    const flag = this.labels().evidenceFlag(note);
    return `<lex-badge class="note-fact-label" color="indigo" size="sm" label="${this.escapeAttr(labelText)}"></lex-badge>` +
      (flag
        ? `<lex-badge class="note-fact-flag" color="yellow" size="sm" label="${this.escapeAttr(flag.text)}" title="${this.escapeAttr(flag.detail)}"></lex-badge>`
        : '');
  }

  /**
   * Link chips for a note. The list card shows them read-only; the note view
   * adds a remove button on each chip a person made (server-written
   * produced_by links stay read-only), "Change release" on document
   * citations, and "Why did this run?" on the run that produced the note.
   */
  renderLinkChips(note, removable) {
    const chips = this.entityLinks().linkChips(
      note && note.links,
      { kind: 'matter_note', id: note && note.note_id },
      this.linkLabelIndex
    );
    if (chips.length === 0) return '';
    return `<div class="note-links__chips">${chips.map((chip) => `
      <span class="note-link-chip" title="${this.escapeAttr(chip.title)}">
        <span class="note-link-chip__kind">${this.escapeHtml(chip.kindText)}</span>
        <span class="note-link-chip__text">${this.escapeHtml(chip.text)}</span>
        ${chip.outdated ? `<span class="note-link-chip__outdated">${this.escapeHtml(this.entityLinks().PIN_OUTDATED_TEXT)}</span>` : ''}
        ${removable && chip.repin && this.options.linksClient ? `<lex-btn class="note-link-chip__repin" variant="ghost" size="sm" data-note-id="${this.escapeAttr(note.note_id)}" data-document-id="${this.escapeAttr(chip.repin.documentId)}" data-release-id="${this.escapeAttr(chip.repin.releaseId)}">Change release</lex-btn>` : ''}
        ${removable && chip.run && this.options.openRunCausation ? `<lex-btn class="note-link-chip__why" variant="ghost" size="sm" data-run-kind="${this.escapeAttr(chip.run.kind)}" data-run-id="${this.escapeAttr(chip.run.id)}">Why did this run?</lex-btn>` : ''}
        ${removable && chip.removable ? `<lex-btn class="note-link-chip__remove" variant="ghost" size="sm" icon leading-icon="x" aria-label="${this.escapeAttr('Remove link to ' + chip.title)}" data-note-id="${this.escapeAttr(note.note_id)}" data-link-id="${this.escapeAttr(chip.id)}"></lex-btn>` : ''}
      </span>`).join('')}</div>`;
  }

  /**
   * Links section of the note view: removable chips plus "Add link".
   */
  renderViewLinks(note) {
    const container = document.getElementById('notesViewLinks');
    if (!container) return;
    const addLink = this.options.linksClient
      ? `<lex-dropdown-btn id="notesViewAddLink" button-label="Add link" icon="link" variant="ghost" floating data-note-id="${this.escapeAttr(note.note_id)}"></lex-dropdown-btn>`
      : '';
    const evidence = this.noteActionsFor(note).map(action =>
      `<lex-btn class="note-links__action" variant="secondary" size="sm" leading-icon="check-circle" data-note-id="${this.escapeAttr(note.note_id)}" data-note-action="${this.escapeAttr(action.id)}">${this.escapeHtml(action.label)}</lex-btn>`
    ).join('');
    container.innerHTML = `
      <div class="note-links__header">
        <span class="note-links__title">Links</span>
        ${evidence}
        ${addLink}
      </div>
      ${this.renderLinkChips(note, true) || '<p class="note-links__empty">No links yet.</p>'}
    `;
    const menu = document.getElementById('notesViewAddLink');
    if (menu) menu.options = this.entityLinks().pickerKindOptions();
  }

  /**
   * Pick a target of one kind and link the note to it. Rules are listed from
   * the rulebook the matter applies (firm or starter); a document may also pin a retained
   * release, which is what makes the note read Supported.
   *
   * With `repin` ({ documentId, releaseId }) the picker re-pins an existing
   * citation: the document is preselected and sending it again with another
   * release (or none) updates the link's pin (the server answers 200).
   */
  async openLinkPicker(noteId, kind, repin = null) {
    const links = this.entityLinks();
    const kindText = links.kindLabel(kind);
    const isDocument = kind === 'document';
    const repinning = isDocument && repin && repin.documentId ? repin : null;
    const release = isDocument
      ? '<lex-select data-link-picker-release label="Retained release" placeholder="Choose a document first" help="Cite a retained release so the note reads Supported. Without one it reads Linked." disabled></lex-select>'
      : '';

    const modal = window.Lex.Modal.open({
      heading: repinning ? 'Change cited release' : 'Link ' + kindText.toLowerCase(),
      size: 'sm',
      content: `
        <lex-select data-link-picker-value label="${this.escapeAttr(kindText)}" searchable placeholder="Loading..."></lex-select>
        ${release}
        <lex-btn data-slot="footer" variant="secondary" data-action="cancel-link">Cancel</lex-btn>
        <lex-btn data-slot="footer" variant="primary" data-action="save-link">${repinning ? 'Save release' : 'Add link'}</lex-btn>
      `
    });
    let candidates = [];

    modal.addEventListener('click', async (e) => {
      const action = e.target.closest && e.target.closest('[data-action]');
      if (!action) return;
      if (action.getAttribute('data-action') === 'cancel-link') {
        modal.removeAfterClose();
        return;
      }
      if (action.getAttribute('data-action') !== 'save-link') return;
      const input = modal.querySelector('[data-link-picker-value]');
      const value = input ? String(input.value || '') : '';
      const picked = candidates.find((item) => item.id === value);
      if (!picked) {
        this.showError('Choose a ' + kindText.toLowerCase());
        return;
      }
      const releaseSelect = modal.querySelector('[data-link-picker-release]');
      const releaseId = releaseSelect ? String(releaseSelect.value || '') : '';
      const release = releaseId ? (picked.releases || []).find((item) => item.id === releaseId) : null;
      const target = release ? release.target : picked.target;
      action.loading = true;
      const linked = await this.handleAddLink(noteId, kind, target, repinning);
      action.loading = false;
      if (linked) modal.removeAfterClose();
    });

    if (isDocument) {
      modal.addEventListener('lex-change', (e) => {
        if (!e.target.hasAttribute || !e.target.hasAttribute('data-link-picker-value')) return;
        this.showReleaseOptions(modal, candidates.find((item) => item.id === String((e.detail && e.detail.value) || '')));
      });
    }

    candidates = await this.loadLinkCandidates(kind);
    const select = modal.querySelector('[data-link-picker-value]');
    if (!select || !select.isConnected) return;
    if (repinning && !candidates.some((item) => item.id === String(repinning.documentId))) {
      candidates = candidates.concat([{ id: String(repinning.documentId), label: links.endLabel({ kind: 'document', id: repinning.documentId }, this.linkLabelIndex), target: { kind: 'document', id: String(repinning.documentId) }, releases: [] }]);
    }
    select.options = candidates.map((item) => ({ value: item.id, label: item.label, description: item.description || '' }));
    select.placeholder = candidates.length ? 'Choose...' : (this.options.linksClient.unavailableReason(kind) || this.emptyPickerText(kind, kindText));
    if (!candidates.length) select.disabled = true;
    if (repinning) {
      select.value = String(repinning.documentId);
      select.disabled = true;
      this.showReleaseOptions(modal, candidates.find((item) => item.id === String(repinning.documentId)), repinning.releaseId);
    }
  }

  emptyPickerText(kind, kindText) {
    if (kind === 'rulebook_rule') return 'No rules in the rulebook this matter applies';
    return 'No ' + kindText.toLowerCase() + ' records on this matter';
  }

  /**
   * Fill the release select with the chosen document's retained releases
   * (the link target lookup lists them on the document). "No release" stays
   * first: the link is allowed without one.
   */
  showReleaseOptions(modal, candidate, selectedReleaseId = '') {
    const select = modal.querySelector('[data-link-picker-release]');
    if (!select) return;
    const releases = (candidate && candidate.releases) || [];
    select.value = '';
    select.options = [{ value: '', label: 'No release' }].concat(
      releases.map((item) => ({ value: item.id, label: item.label }))
    );
    select.placeholder = !candidate ? 'Choose a document first' : (releases.length ? 'No release' : 'No retained releases of this document');
    select.disabled = releases.length === 0;
    if (selectedReleaseId) select.value = String(selectedReleaseId);
  }

  async handleAddLink(noteId, kind, target, repin = null) {
    try {
      const response = await this.options.linksClient.createLink({ kind: 'matter_note', id: noteId }, kind, target);
      await this.refreshNote(noteId);
      this.showSuccess(repin ? this.entityLinks().repinMessage(repin.releaseId, response) : 'Link added');
      return true;
    } catch (error) {
      console.error('[NoteList] Failed to add link:', error);
      this.showError(this.entityLinks().linkErrorMessage(error, kind, 'add'));
      return false;
    }
  }

  async handleRemoveLink(noteId, linkId) {
    if (!noteId || !linkId) return;
    try {
      await this.options.linksClient.removeLink(linkId);
      await this.refreshNote(noteId);
      this.showSuccess('Link removed');
    } catch (error) {
      console.error('[NoteList] Failed to remove link:', error);
      this.showError(this.entityLinks().linkErrorMessage(error, null, 'remove'));
    }
  }

  /**
   * The makeup's note actions that apply to this note (labels from the server).
   */
  noteActionsFor(note) {
    return this.options.noteActions ? this.options.noteActions.actionsFor(note) : [];
  }

  /**
   * A note action (for example recording the note as evidence): the page opens
   * its form for this note; once recorded the note may gain links, so re-read it.
   */
  runNoteAction(noteId, actionId) {
    const note = this.notes.find(n => n.note_id === noteId);
    const action = note && this.noteActionsFor(note).find(item => item.id === actionId);
    if (!action) return;
    this.options.noteActions.run(note, action, () => this.refreshNote(noteId).catch(() => {}));
  }

  /**
   * Re-read one note so its links and evidence_status come from the server.
   */
  async refreshNote(noteId) {
    const response = await this.options.apiClient.getNote(this.options.matterId, noteId);
    const note = (response && response.note) || response;
    if (!note) return;
    this.updateNote(noteId, note);
    const view = document.getElementById('notesViewModal');
    if (view && view.open) {
      this.renderViewMeta(this.notes.find(n => n.note_id === noteId));
      this.renderViewLinks(this.notes.find(n => n.note_id === noteId));
    }
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

    modal.heading = note.title || 'Untitled Note';
    this.renderViewMeta(note);
    this.renderViewLinks(note);

    content.innerHTML = this.renderNoteContent(note.content || '<p>No content</p>');
    editBtn.setAttribute('data-note-id', note.note_id);
    modal.open = true;
  }

  /**
   * Date, AI flag, label badge and evidence flag in the note view.
   */
  renderViewMeta(note) {
    const meta = document.getElementById('notesViewMeta');
    if (!meta || !note) return;
    const relativeDate = this.options.apiClient.formatRelativeDate(note.updated_at || note.created_at);
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

    meta.insertAdjacentHTML('beforeend', this.renderFactBadges(note));
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
      if (fromFocusMode) {
        const labelSelect = document.getElementById('notesFocusLabelSelect');
        const editing = this.editingNoteId && this.notes.find(n => n.note_id === this.editingNoteId);
        Object.assign(noteData, this.labels().labelChange(
          labelSelect ? labelSelect.value : '',
          editing ? editing.label : null
        ));
      }

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

    const editing = this.editingNoteId && this.notes.find(n => n.note_id === this.editingNoteId);
    this.setFocusLabel(editing ? editing.label : '');
    this.setFocusContext(editing || null);

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
   * Label picker in the focus editor: the matter's labels plus the note's
   * current label when the makeup no longer offers it.
   */
  setFocusLabel(currentKey) {
    const select = document.getElementById('notesFocusLabelSelect');
    if (!select) return;
    const options = this.labels().labelOptions(this.factLabels(), currentKey || '');
    select.options = options;
    select.placeholder = options[0].label;
    select.value = currentKey || '';
  }

  /**
   * Heading for create or edit, and the note's links read-only while
   * editing (links are added and removed from the note view).
   */
  setFocusContext(note) {
    const modal = document.getElementById('notesFocusModal');
    if (modal) modal.heading = note ? 'Edit note' : 'New note';
    const container = document.getElementById('notesFocusLinks');
    if (!container) return;
    if (!note) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }
    container.innerHTML = `
      <div class="note-links__header">
        <span class="note-links__title">Links</span>
        <span class="note-links__empty">Add or remove links from the note view.</span>
      </div>
      ${this.renderLinkChips(note, false) || '<p class="note-links__empty">No links yet.</p>'}
    `;
    container.hidden = false;
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
