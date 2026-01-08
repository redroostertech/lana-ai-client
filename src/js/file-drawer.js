/**
 * File Drawer Component
 * Manages document activation/deactivation in chat sessions
 */

// Helper to access global objects
function getGlobal(name) {
  if (window[name]) return window[name];
  if (typeof self !== 'undefined' && self[name]) return self[name];
  // Try to access from global scope
  try {
    return eval(name);
  } catch (e) {
    console.error(`[FileDrawer] Could not access global ${name}`, e);
    return null;
  }
}

const FileDrawer = {
  currentSessionId: null,
  documents: {
    active: [],
    available: []
  },
  searchQuery: '',

  /**
   * Initialize the file drawer
   */
  init() {
    console.log('[FileDrawer] Initializing file drawer');
    this.attachEventListeners();
  },

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Upload button in drawer header
    document.getElementById('uploadToDrawerBtn')?.addEventListener('click', () => this.handleUpload());

    // Add menu toggle
    document.getElementById('documentsBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAddMenu();
    });

    // Menu item action - open drawer
    document.getElementById('manageDocumentsMenuItem')?.addEventListener('click', () => {
      this.closeAddMenu();
      this.openDrawer();
    });

    // Drawer controls
    document.getElementById('closeFileDrawer')?.addEventListener('click', () => this.closeDrawer());
    document.getElementById('fileDrawerOverlay')?.addEventListener('click', () => this.closeDrawer());

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('addMenuPopup');
      const btn = document.getElementById('documentsBtn');
      if (menu && !menu.contains(e.target) && e.target !== btn) {
        this.closeAddMenu();
      }
    });

    // Search input
    document.getElementById('drawerSearchInput')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.render();
    });
  },

  /**
   * Load documents for a session
   */
  async loadDocuments(sessionId) {
    if (!sessionId) {
      console.warn('[FileDrawer] No session ID provided');
      return;
    }

    this.currentSessionId = sessionId;
    console.log('[FileDrawer] Loading documents for session:', sessionId);

    try {
      const api = getGlobal('api');
      if (!api) {
        throw new Error('API client not available');
      }

      // Build query parameters
      const params = new URLSearchParams({
        page: 1,
        limit: 100, // Get more documents for client-side filtering
        search: this.searchQuery || '',
        sort_by: 'activation',
        order: 'desc'
      });

      const data = await api.get(`/api/v1/chat/sessions/${sessionId}/drawer?${params.toString()}`);
      this.documents.active = data.documents.active || [];
      this.documents.available = data.documents.available || [];

      console.log('[FileDrawer] Loaded documents:', {
        active: this.documents.active.length,
        available: this.documents.available.length,
        total: data.pagination?.total || 0
      });

      this.render();
    } catch (error) {
      console.error('[FileDrawer] Failed to load documents:', error);
      const Toast = getGlobal('Toast');
      if (Toast) Toast.error('Failed to load documents');
    }
  },

  /**
   * Render the file drawer
   */
  render() {
    this.renderStats();
    this.renderActiveDocuments();
    this.renderAvailableDocuments();
    this.updateBadges();
    this.setDefaultCollapsedState();
  },

  /**
   * Render statistics
   */
  renderStats() {
    const statsEl = document.getElementById('drawerStats');
    if (statsEl) {
      statsEl.textContent = `${this.documents.active.length} active, ${this.documents.available.length} available`;
    }
  },

  /**
   * Filter documents by search query
   */
  filterDocuments(documents) {
    if (!this.searchQuery) return documents;
    return documents.filter(doc =>
      doc.filename.toLowerCase().includes(this.searchQuery)
    );
  },

  /**
   * Render active documents
   */
  renderActiveDocuments() {
    const container = document.getElementById('activeDocuments');
    const countEl = document.getElementById('activeCount');

    if (!container) return;

    const filteredDocs = this.filterDocuments(this.documents.active);

    if (countEl) {
      countEl.textContent = filteredDocs.length;
    }

    if (filteredDocs.length === 0) {
      const message = this.searchQuery
        ? 'No matching active documents'
        : 'No active documents';
      container.innerHTML = `
        <div class="text-center py-6 text-sm text-gray-500">
          ${message}
        </div>
      `;
      return;
    }

    container.innerHTML = filteredDocs.map(doc => this.renderDocumentItem(doc, true)).join('');
  },

  /**
   * Render available documents
   */
  renderAvailableDocuments() {
    const container = document.getElementById('availableDocuments');
    const countEl = document.getElementById('availableCount');

    if (!container) return;

    const filteredDocs = this.filterDocuments(this.documents.available);

    if (countEl) {
      countEl.textContent = filteredDocs.length;
    }

    if (filteredDocs.length === 0) {
      const message = this.searchQuery
        ? 'No matching available documents'
        : 'No available documents';
      container.innerHTML = `
        <div class="text-center py-6 text-sm text-gray-500">
          ${message}
        </div>
      `;
      return;
    }

    container.innerHTML = filteredDocs.map(doc => this.renderDocumentItem(doc, false)).join('');
  },

  /**
   * Render a single document item
   */
  renderDocumentItem(doc, isActive) {
    const statusBadge = this.getStatusBadge(doc.status);
    const fileIcon = this.getFileIcon(doc.mime_type);
    const fileSize = this.formatFileSize(doc.file_size);

    return `
      <div class="file-drawer-item bg-white border border-gray-200 rounded-lg p-3 ${doc.status === 'processing' ? 'file-status-processing' : ''}" data-doc-id="${doc.id}">
        <div class="flex items-start gap-2">
          <!-- File Icon -->
          <div class="flex-shrink-0 text-gray-400">
            ${fileIcon}
          </div>

          <!-- Document Info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 truncate" title="${doc.filename}">
                  ${doc.filename}
                </p>
                <div class="flex items-center gap-2 mt-1">
                  <span class="text-xs text-gray-500">${fileSize}</span>
                  ${statusBadge}
                  ${doc.chunk_count > 0 ? `<span class="text-xs text-gray-400">${doc.chunk_count} chunks</span>` : ''}
                </div>
              </div>

              <!-- Action Button -->
              ${doc.status === 'completed' ? `
                <button
                  onclick="FileDrawer.toggleDocument('${doc.id}', ${!isActive})"
                  class="flex-shrink-0 p-1 ${isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'} rounded transition-colors"
                  title="${isActive ? 'Remove from chat' : 'Add to chat'}"
                >
                  ${isActive ? `
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                  ` : `
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                  `}
                </button>
              ` : ''}
            </div>

            <!-- Processing Progress (if applicable) -->
            ${doc.status === 'processing' && doc.processing_progress ? `
              <div class="mt-2">
                <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Processing...</span>
                  <span>${doc.processing_progress.percent_complete || 0}%</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-1.5">
                  <div class="bg-indigo-600 h-1.5 rounded-full transition-all" style="width: ${doc.processing_progress.percent_complete || 0}%"></div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Get status badge HTML
   */
  getStatusBadge(status) {
    const badges = {
      'pending': '<span class="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full">Pending</span>',
      'processing': '<span class="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">Processing</span>',
      'completed': '<span class="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full">Ready</span>',
      'failed': '<span class="text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded-full">Failed</span>'
    };
    return badges[status] || '';
  },

  /**
   * Get file icon based on mime type
   */
  getFileIcon(mimeType) {
    if (mimeType?.includes('pdf')) {
      return `
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"></path>
        </svg>
      `;
    }
    if (mimeType?.includes('word') || mimeType?.includes('document')) {
      return `
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"></path>
        </svg>
      `;
    }
    if (mimeType?.includes('csv') || mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) {
      return `
        <svg class="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 13h2v2H8v-2zm0 3h2v2H8v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2z"/>
        </svg>
      `;
    }
    // Default file icon
    return `
      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"></path>
      </svg>
    `;
  },

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 10) / 10 + ' ' + sizes[i];
  },

  /**
   * Toggle document activation
   */
  async toggleDocument(documentId, activate) {
    if (!this.currentSessionId) {
      console.error('[FileDrawer] No session ID set');
      return;
    }

    console.log(`[FileDrawer] ${activate ? 'Activating' : 'Deactivating'} document:`, documentId);

    try {
      const api = getGlobal('api');
      const Toast = getGlobal('Toast');

      if (!api) {
        throw new Error('API client not available');
      }

      // TRIGGER #3: File Drawer Activation - Check if processing needed before activating
      if (activate) {
        try {
          const status = await api.getDocumentProcessingStatus(documentId);

          if (status.stage === 'pending' || !status.hasExtractedText) {
            console.log('[FileDrawer] Document needs processing, triggering JIT processing');

            // Show processing indicator in file drawer
            this.showFileProcessingIndicator(documentId);

            // Trigger processing (don't wait for completion before activating)
            api.triggerDocumentProcessing(documentId, 'file_drawer')
              .then(() => {
                console.log('[FileDrawer] Processing triggered successfully');
                // Poll for completion in background
                return api.pollDocumentProcessing(documentId);
              })
              .then(() => {
                console.log('[FileDrawer] Processing completed');
                this.hideFileProcessingIndicator(documentId);
                if (Toast) Toast.success('Document processed and ready for AI');
                // Refresh documents to show updated status
                this.loadDocuments(this.currentSessionId);
              })
              .catch(error => {
                console.error('[FileDrawer] Processing failed:', error);
                this.hideFileProcessingIndicator(documentId);
                if (Toast) Toast.warning('Document activated but processing failed');
              });
          }
        } catch (statusError) {
          console.error('[FileDrawer] Failed to check processing status:', statusError);
          // Don't fail activation if status check fails
        }
      }

      const endpoint = activate ? 'activate' : 'deactivate';
      const data = await api.post(
        `/api/v1/chat/sessions/${this.currentSessionId}/drawer/${endpoint}`,
        { document_id: documentId }
      );

      console.log(`[FileDrawer] Document ${endpoint}d:`, data);

      if (Toast) Toast.success(data.message);

      // Reload documents to refresh the UI
      await this.loadDocuments(this.currentSessionId);
    } catch (error) {
      console.error(`[FileDrawer] Failed to toggle document:`, error);
      const Toast = getGlobal('Toast');
      if (Toast) Toast.error(`Failed to ${activate ? 'activate' : 'deactivate'} document`);
    }
  },

  /**
   * Handle upload button click
   */
  handleUpload() {
    // Get the current matter ID from the chat context
    const currentMatterId = getGlobal('currentMatterId');

    if (!currentMatterId) {
      // Show toast warning if no matter is selected
      const Toast = getGlobal('Toast');
      if (Toast) {
        Toast.warning('Please select a matter for this conversation first');
      }
      return;
    }

    // Show feedback toast before redirect
    const Toast = getGlobal('Toast');
    if (Toast) {
      Toast.info('Opening matter documents page...');
    }

    // Small delay to show toast, then redirect
    setTimeout(() => {
      const mattersPath = typeof getPagePath === 'function' ? getPagePath('matters.html') : 'matters.html';
      window.location.href = `${mattersPath}?open=${encodeURIComponent(currentMatterId)}&tab=documents`;
    }, 500);
  },

  /**
   * Toggle add menu popup
   */
  toggleAddMenu() {
    const menu = document.getElementById('addMenuPopup');
    if (menu) {
      menu.classList.toggle('hidden');
    }
  },

  /**
   * Close add menu popup
   */
  closeAddMenu() {
    const menu = document.getElementById('addMenuPopup');
    if (menu) {
      menu.classList.add('hidden');
    }
  },

  /**
   * Open the drawer
   */
  openDrawer() {
    const drawer = document.getElementById('fileDrawer');
    const overlay = document.getElementById('fileDrawerOverlay');

    if (drawer && overlay) {
      drawer.classList.remove('translate-x-full');
      overlay.classList.remove('hidden');

      // Refresh documents when drawer is opened
      if (this.currentSessionId) {
        this.loadDocuments(this.currentSessionId);
      }
    }
  },

  /**
   * Close the drawer
   */
  closeDrawer() {
    const drawer = document.getElementById('fileDrawer');
    const overlay = document.getElementById('fileDrawerOverlay');

    if (drawer && overlay) {
      drawer.classList.add('translate-x-full');
      overlay.classList.add('hidden');
    }
  },

  /**
   * Update badges
   */
  updateBadges() {
    const badge = document.getElementById('documentsBadge');
    if (badge) {
      const totalDocs = this.documents.active.length + this.documents.available.length;
      if (totalDocs > 0) {
        badge.textContent = totalDocs;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  },

  /**
   * Set default collapsed state for sections
   * Collapse Available section if less than 10 active files
   */
  setDefaultCollapsedState() {
    const availableContent = document.getElementById('availableDocuments');
    const availableChevron = document.getElementById('availableChevron');

    // Collapse Available section if less than 10 active files
    if (this.documents.active.length < 10) {
      if (availableContent && !availableContent.classList.contains('drawer-section-collapsed')) {
        availableContent.classList.add('drawer-section-collapsed');
        if (availableChevron) {
          availableChevron.classList.add('rotate-180');
        }
      }
    }
  },

  /**
   * Show processing indicator for a specific file in the drawer
   */
  showFileProcessingIndicator(documentId) {
    const docElement = document.querySelector(`[data-doc-id="${documentId}"]`);
    if (!docElement) return;

    // Add processing class
    docElement.classList.add('file-status-processing');

    // Find or create processing indicator
    let indicator = docElement.querySelector('.processing-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'processing-indicator text-xs text-blue-600 mt-1 flex items-center gap-1';
      indicator.innerHTML = `
        <svg class="animate-spin h-3 w-3" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Processing for AI...</span>
      `;

      const infoSection = docElement.querySelector('.flex-1.min-w-0');
      if (infoSection) {
        infoSection.appendChild(indicator);
      }
    }
  },

  /**
   * Hide processing indicator for a specific file in the drawer
   */
  hideFileProcessingIndicator(documentId) {
    const docElement = document.querySelector(`[data-doc-id="${documentId}"]`);
    if (!docElement) return;

    // Remove processing class
    docElement.classList.remove('file-status-processing');

    // Remove indicator
    const indicator = docElement.querySelector('.processing-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
};

/**
 * Toggle drawer section (active/available)
 */
function toggleDrawerSection(section) {
  const content = document.getElementById(`${section}Documents`);
  const chevron = document.getElementById(`${section}Chevron`);

  if (content && chevron) {
    content.classList.toggle('drawer-section-collapsed');
    chevron.classList.toggle('rotate-180');
  }
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => FileDrawer.init());
} else {
  FileDrawer.init();
}

// Export to window for integration with chat.js
window.FileDrawer = FileDrawer;
