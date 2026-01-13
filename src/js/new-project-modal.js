/**
 * New Project Modal
 * Reusable modal component for creating new matter-based conversations
 * Works on any page - injects HTML dynamically
 */

const NewProjectModal = {
  modal: null,
  allMatters: [],
  isOpen: false,

  /**
   * Initialize the modal
   */
  init() {
    // Inject modal HTML if it doesn't exist
    if (!document.getElementById('newProjectModal')) {
      this.injectModalHTML();
    }

    this.modal = document.getElementById('newProjectModal');
    this.setupEventListeners();
    return true;
  },

  /**
   * Inject modal HTML into the page
   */
  injectModalHTML() {
    const modalHTML = `
      <!-- New Project Modal -->
      <div id="newProjectModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4" style="z-index: 9999;" onclick="if(event.target === this) NewProjectModal.close()">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onclick="event.stopPropagation()">
          <!-- Modal Header -->
          <div class="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 class="text-xl font-semibold text-gray-900">Start New Project Chat</h2>
              <p class="text-sm text-gray-500 mt-1">Select a matter to associate this conversation with</p>
            </div>
            <button onclick="NewProjectModal.close()" class="text-gray-400 hover:text-gray-600 transition-colors">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Search Bar -->
          <div class="p-6 border-b border-gray-200">
            <div class="relative">
              <input
                type="text"
                id="newProjectMatterSearch"
                placeholder="Search matters by name, client, or number..."
                class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              >
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </div>
          </div>

          <!-- Matters List -->
          <div id="newProjectMattersList" class="flex-1 overflow-y-auto p-6">
            <div class="flex items-center justify-center py-8 text-gray-400">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          </div>

          <!-- Modal Footer -->
          <div class="p-4 border-t border-gray-200 bg-gray-50">
            <div class="flex items-center justify-between gap-4">
              <div class="flex items-start gap-2 flex-1">
                <svg class="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <p class="text-sm text-gray-600">
                  <span class="font-medium">About Projects:</span> Projects let you organize conversations by matter/case for better context and collaboration.
                </p>
              </div>
              <button onclick="NewProjectModal.createNewMatter()" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
                Create Project
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  },

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Search input handler
    const searchInput = document.getElementById('newProjectMatterSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterMatters(e.target.value);
      });
    }

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  },

  /**
   * Open the modal
   */
  async open() {
    if (!this.modal) {
      this.init();
    }

    this.modal.classList.remove('hidden');
    this.modal.classList.add('flex');
    this.isOpen = true;

    // Load matters
    await this.loadMatters();

    // Focus search input
    setTimeout(() => {
      document.getElementById('newProjectMatterSearch')?.focus();
    }, 100);
  },

  /**
   * Close the modal
   */
  close() {
    if (this.modal) {
      this.modal.classList.add('hidden');
      this.modal.classList.remove('flex');
      this.isOpen = false;

      // Clear search
      const searchInput = document.getElementById('newProjectMatterSearch');
      if (searchInput) {
        searchInput.value = '';
      }
    }
  },

  /**
   * Load matters from API
   */
  async loadMatters() {
    try {
      const response = await api.getMatters(1, 100, { status: 'active' });
      this.allMatters = response.matters || [];

      // Show default view with pinned and recent matters
      this.renderDefaultView();
    } catch (error) {
      console.error('[NewProjectModal] Failed to load matters:', error);
      const listContainer = document.getElementById('newProjectMattersList');
      if (listContainer) {
        listContainer.innerHTML = '<p class="text-center text-red-500 py-8">Failed to load matters. Please try again.</p>';
      }
    }
  },

  /**
   * Filter matters based on search query
   */
  filterMatters(query) {
    if (!query) {
      // Show default view when search is cleared
      this.renderDefaultView();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const filtered = this.allMatters.filter(matter => {
      const matterName = (matter.name || matter.matter_name || '').toLowerCase();
      const clientName = (matter.client_name || matter.client?.name || '').toLowerCase();
      const matterId = (matter.matter_id || '').toLowerCase();

      return matterName.includes(lowerQuery) ||
             clientName.includes(lowerQuery) ||
             matterId.includes(lowerQuery);
    });

    // Show flat search results
    this.renderSearchResults(filtered);
  },

  /**
   * Render default view with pinned and recent matters
   */
  renderDefaultView() {
    const listContainer = document.getElementById('newProjectMattersList');
    if (!listContainer) return;

    if (this.allMatters.length === 0) {
      listContainer.innerHTML = '<p class="text-gray-400 text-center py-8">No matters found</p>';
      return;
    }

    // Separate pinned and unpinned matters
    const pinnedMatters = this.allMatters.filter(m => m.is_pinned || m.pinned);
    const unpinnedMatters = this.allMatters.filter(m => !m.is_pinned && !m.pinned);

    // Sort unpinned by creation date (most recent first)
    const recentMatters = unpinnedMatters
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 10);

    let html = '';

    // Section 1: Pinned Matters
    if (pinnedMatters.length > 0) {
      html += `
        <div class="mb-6">
          <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2 mb-3">
            <svg class="w-4 h-4 text-yellow-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
            </svg>
            Pinned Matters
          </h3>
          ${pinnedMatters.map(matter => this.renderMatterItem(matter, true)).join('')}
        </div>
      `;
    }

    // Section 2: Recent Matters
    if (recentMatters.length > 0) {
      html += `
        <div class="mb-6">
          <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2 mb-3">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            Recent Matters
          </h3>
          ${recentMatters.map(matter => this.renderMatterItem(matter, false)).join('')}
        </div>
      `;
    }

    listContainer.innerHTML = html;
  },

  /**
   * Render search results (flat list)
   */
  renderSearchResults(matters) {
    const listContainer = document.getElementById('newProjectMattersList');
    if (!listContainer) return;

    if (matters.length === 0) {
      listContainer.innerHTML = '<p class="text-gray-400 text-center py-8">No matters found matching your search</p>';
      return;
    }

    const html = `
      <div class="mb-3">
        <p class="text-sm text-gray-600">${matters.length} result${matters.length !== 1 ? 's' : ''} found</p>
      </div>
      ${matters.map(matter => this.renderMatterItem(matter, false)).join('')}
    `;

    listContainer.innerHTML = html;
  },

  /**
   * Render a single matter item
   */
  renderMatterItem(matter, isPinned) {
    const clientName = matter.client_name || matter.client?.name || 'Unknown Client';
    const matterIdString = matter.matter_id;
    const matterName = matter.name || matter.matter_name || 'Untitled Matter';
    const status = matter.status || 'Active';

    if (!matterIdString) {
      console.warn('[NewProjectModal] Matter missing matter_id:', matter);
      return '';
    }

    const pinIcon = isPinned ? `
      <svg class="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
      </svg>
    ` : '';

    return `
      <div class="p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer transition-all mb-3"
           onclick="NewProjectModal.selectMatter('${matterIdString}', '${this.escapeHtml(matterName)}')">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              ${pinIcon}
              <h3 class="font-medium text-gray-900 truncate">${this.escapeHtml(matterName)}</h3>
              <span class="px-2 py-0.5 text-xs rounded-full ${status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}">${status}</span>
            </div>
            <p class="text-sm text-gray-600 truncate">${this.escapeHtml(clientName)}</p>
            <p class="text-xs text-gray-500 mt-1">${matterIdString}</p>
          </div>
          <svg class="w-5 h-5 text-gray-400 group-hover:text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
          </svg>
        </div>
      </div>
    `;
  },

  /**
   * Validate matter ID format
   * Accepts: MATT-XXXXX (native), AS-XXXXX (ActionStep), numeric (legacy)
   *
   * TODO: In future, dynamically load prefixes from connector registry
   * When adding new connectors, update the validPatterns array below
   */
  validateMatterId(matterId) {
    if (!matterId) return false;

    const matterIdString = String(matterId);

    // TODO: Replace this static list with dynamic loading from connector registry
    // Each connector should define its matter_id prefix format
    const validPatterns = [
      /^MATT-/i,      // Native LANA matters
      /^AS-/i,        // ActionStep imported matters
      /^matter_/i,    // Legacy matter_ prefix
      /^\d+$/         // Legacy numeric IDs
      // ADD NEW CONNECTOR PREFIXES HERE (e.g., /^CLIO-/i, /^MY-/i, etc.)
    ];

    return validPatterns.some(pattern => pattern.test(matterIdString));
  },

  /**
   * Handle matter selection
   */
  async selectMatter(matterId, matterName) {
    try {
      this.close();

      // Validate matter_id format
      if (!this.validateMatterId(matterId)) {
        console.error('[NewProjectModal] Invalid matter_id format:', matterId);
        Toast.error('Invalid matter ID. Please try again.');
        return;
      }

      // Convert to string if numeric (legacy matters)
      const matterIdString = String(matterId);

      console.log('[NewProjectModal] Matter selected:', { matterId: matterIdString, matterName });

      // Check if we're on chat.html
      const isOnChatPage = NavigationHelpers.isOnChatPage();

      if (isOnChatPage && typeof window.createProjectChat === 'function') {
        // We're on chat.html - use existing createProjectChat function
        await window.createProjectChat(matterIdString, matterName);
      } else {
        // We're on another page - navigate to chat.html with matter context
        Toast.success(`Opening chat for ${matterName}...`);
        NavigationHelpers.navigateToMatterChat(matterIdString);
      }
    } catch (error) {
      console.error('[NewProjectModal] Failed to select matter:', error);
      Toast.error('Failed to start chat. Please try again.');
    }
  },

  /**
   * Create new matter
   */
  createNewMatter() {
    // Redirect to matters page with action to create new matter
    window.location.href = NavigationHelpers.resolvePath('matters.html') + '?action=create';
  },

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Global function for opening the modal (called from menu buttons)
window.openNewProjectModal = function() {
  NewProjectModal.open();
};

// Export for use across the application
if (typeof window !== 'undefined') {
  window.NewProjectModal = NewProjectModal;
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NewProjectModal;
}
