/**
 * Conversation Search Modal
 * Shared conversation search surface for shell pages and the LANA dock.
 * Selection always routes through the dock/navigation helper path so the modal
 * can be reused when search moves directly into the dock.
 */

const ConversationSearchModal = {
  modal: null,
  searchInput: null,
  resultsContainer: null,
  searchTimeout: null,
  isOpen: false,

  /**
   * Initialize the modal (call once on page load)
   */
  init() {
    // Create modal HTML if it doesn't exist
    if (!document.getElementById('conversationSearchModal')) {
      this.createModal();
    }

    this.modal = document.getElementById('conversationSearchModal');
    this.searchInput = document.getElementById('conversationSearchInput');
    this.resultsContainer = document.getElementById('conversationSearchResults');

    // Set up event listeners
    this.setupEventListeners();

    return true;
  },

  /**
   * Create the modal HTML
   */
  createModal() {
    const modalHTML = `
      <!-- Conversation Search Modal -->
      <div id="conversationSearchModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50" onclick="if(event.target === this) ConversationSearchModal.close()">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onclick="event.stopPropagation()">
          <!-- Modal Header -->
          <div class="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 class="text-xl font-semibold text-gray-900">Search Conversations</h2>
              <p class="text-sm text-gray-500 mt-0.5">Find your recent chats quickly</p>
            </div>
            <button onclick="ConversationSearchModal.close()" class="text-gray-400 hover:text-gray-600 transition-colors">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Search Input -->
          <div class="p-6 border-b border-gray-200">
            <div class="relative">
              <input
                type="text"
                id="conversationSearchInput"
                placeholder="Search conversations by title, message, or matter name..."
                class="w-full pl-10 pr-4 py-3 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                autocomplete="off"
              >
              <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
              </svg>
            </div>
          </div>

          <!-- Search Results -->
          <div id="conversationSearchResults" class="flex-1 overflow-y-auto p-6">
            <p class="text-gray-500 text-sm text-center py-8">Start typing to search conversations...</p>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  },

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Search input with debouncing
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(this.searchTimeout);
      const query = e.target.value.trim();

      if (query.length === 0) {
        // If search cleared, show recent conversations again
        this.loadRecentConversations();
        return;
      }

      if (query.length < 2) {
        this.renderEmpty('Type at least 2 characters to search...');
        return;
      }

      this.searchTimeout = setTimeout(() => {
        this.performSearch(query);
      }, 300);
    });

    // Handle keyboard shortcuts
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  },

  /**
   * Open the modal
   */
  async open() {
    if (!this.modal) this.init();

    this.modal.classList.remove('hidden');
    this.modal.classList.add('flex');
    this.isOpen = true;

    // Load recent conversations on open
    await this.loadRecentConversations();

    // Focus search input
    setTimeout(() => {
      this.searchInput.focus();
    }, 100);
  },

  /**
   * Close the modal
   */
  close() {
    if (!this.modal) return;

    this.modal.classList.add('hidden');
    this.modal.classList.remove('flex');
    this.isOpen = false;

    // Clear search
    this.searchInput.value = '';
    this.renderEmpty('Start typing to search conversations...');
  },

  /**
   * Load recent conversations (shown when modal opens)
   */
  async loadRecentConversations() {
    try {
      this.renderLoading();

      const response = await api.getConversations({
        limit: 10,
        offset: 0,
        sortBy: 'last_activity',
        sortOrder: 'desc'
      });
      const conversations = this.normalizeConversations(response);

      if (conversations.length === 0) {
        this.renderEmpty('No recent conversations');
      } else {
        this.renderRecentResults(conversations);
      }
    } catch (error) {
      console.error('Failed to load recent conversations:', error);
      this.renderError('Failed to load conversations');
    }
  },

  /**
   * Perform search via API
   */
  async performSearch(query) {
    try {
      this.renderLoading();

      const response = await api.getConversations({
        limit: 50,
        offset: 0,
        search: query
      });
      const conversations = this.normalizeConversations(response);

      if (conversations.length === 0) {
        this.renderEmpty('No conversations found');
      } else {
        this.renderResults(conversations, query);
      }
    } catch (error) {
      console.error('Failed to search conversations:', error);
      this.renderError('Failed to search conversations');
    }
  },

  /**
   * Render search results
   */
  renderResults(conversations, query) {
    const html = conversations.map(conv => this.renderResultItem(conv, query)).join('');
    this.resultsContainer.innerHTML = html;
  },

  /**
   * Render recent conversations (with header)
   */
  renderRecentResults(conversations) {
    const header = `
      <div class="mb-4">
        <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider">Recent Conversations</h3>
        <p class="text-xs text-gray-500 mt-1">Your 10 most recent chats</p>
      </div>
    `;
    const html = conversations.map(conv => this.renderResultItem(conv, '')).join('');
    this.resultsContainer.innerHTML = header + html;
  },

  normalizeConversations(response) {
    const rows = response && (response.conversations || response.data || response.sessions || []);
    return rows.map((row) => this.normalizeConversation(row));
  },

  normalizeConversation(row) {
    if (!row || typeof row !== 'object') return row;
    if (row.thread_id || row.matter_id || row.updated_at) return row;

    const conversationId = row.conversationId || row.conversation_id || row.threadId || row.thread_id || row.id;
    const registryId = row.registryId || row.registry_id || row.id || conversationId;
    const scope = row.scope || {};

    return {
      id: registryId,
      thread_id: conversationId,
      title: row.title || row.metadata?.title || 'Untitled Chat',
      metadata: row.metadata || {},
      matter_id: scope.matterId || scope.matter_id || row.matterId || row.matter_id || '',
      matter_name: row.matterName || row.matter_name || row.metadata?.matter_name || '',
      last_message: row.lastMessage || row.last_message || '',
      created_at: row.createdAt || row.created_at,
      updated_at: row.lastActivity || row.last_activity || row.updatedAt || row.updated_at || row.createdAt || row.created_at
    };
  },

  /**
   * Render a single result item
   */
  renderResultItem(conv, query) {
    const threadId = conv.thread_id || conv.id;
    const matterId = conv.matter_id || '';
    const title = conv.title || conv.metadata?.title || 'Untitled Chat';
    const lastMessage = conv.last_message || conv.lastMessage || '';
    const preview = lastMessage.substring(0, 100) + (lastMessage.length > 100 ? '...' : '');
    const matterName = conv.matter_name || conv.metadata?.matter_name || '';

    // Highlight search term
    const highlightedTitle = this.highlightText(title, query);
    const highlightedPreview = this.highlightText(preview, query);
    const highlightedMatter = matterName ? this.highlightText(matterName, query) : '';

    const matterLabel = matterName ? `
      <p class="text-xs text-gray-500 flex items-center gap-1 mt-1">
        <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>
        <span>${highlightedMatter}</span>
      </p>
    ` : '';

    const timestamp = this.formatTimestamp(conv.updated_at || conv.created_at);

    // Safety check: ensure threadId is valid
    if (!threadId) {
      console.error('[ConversationSearchModal.renderResultItem] Invalid threadId:', conv);
      return '';
    }

    // Escape special characters in IDs to prevent breaking onclick handler
    const escapedThreadId = String(threadId).replace(/'/g, "\\'");
    const escapedMatterId = String(matterId).replace(/'/g, "\\'");

    return `
      <div class="p-4 hover:bg-gray-50 rounded-lg cursor-pointer border border-gray-200 mb-3 transition-colors"
           onclick="ConversationSearchModal.selectConversation('${escapedThreadId}', '${escapedMatterId}')">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900">${highlightedTitle}</p>
            ${matterLabel}
            ${preview ? `<p class="text-sm text-gray-600 mt-2">${highlightedPreview}</p>` : ''}
          </div>
          <span class="text-xs text-gray-500 flex-shrink-0">${timestamp}</span>
        </div>
      </div>
    `;
  },

  /**
   * Select a conversation and close modal
   */
  selectConversation(threadId, matterId = '') {
    this.close();

    try {
      if (typeof NavigationHelpers !== 'undefined'
          && typeof NavigationHelpers.navigateToConversation === 'function') {
        NavigationHelpers.navigateToConversation(threadId, matterId);
        return;
      }
      const dock = window.Lex
        && window.Lex.LanaDock
        && typeof window.Lex.LanaDock.get === 'function'
        && window.Lex.LanaDock.get();
      if (dock && typeof dock.openConversation === 'function') {
        dock.openConversation(threadId, matterId || null);
        return;
      }
      throw new Error('LANA dock navigation is not available');
    } catch (error) {
      console.error('[ConversationSearchModal.selectConversation] ERROR:', error);
      alert(`Error selecting conversation: ${error.message}`);
    }
  },

  /**
   * Highlight search term in text
   */
  highlightText(text, query) {
    if (!query) return this.escapeHtml(text);

    const escapedText = this.escapeHtml(text);
    const escapedQuery = this.escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery})`, 'gi');

    return escapedText.replace(regex, '<mark class="bg-yellow-200 font-medium">$1</mark>');
  },

  /**
   * Render loading state
   */
  renderLoading() {
    this.resultsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12">
        <div class="animate-spin rounded-full h-10 w-10 border-4 border-indigo-200 border-t-indigo-600 mb-4"></div>
        <p class="text-gray-500 text-sm">Searching...</p>
      </div>
    `;
  },

  /**
   * Render empty state
   */
  renderEmpty(message) {
    this.resultsContainer.innerHTML = `
      <p class="text-gray-500 text-sm text-center py-8">${message}</p>
    `;
  },

  /**
   * Render error state
   */
  renderError(message) {
    this.resultsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12">
        <svg class="w-12 h-12 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p class="text-red-600 text-sm font-medium">${message}</p>
      </div>
    `;
  },

  /**
   * Format timestamp
   */
  formatTimestamp(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return formatDateLong(dateString, { month: 'short' });
  },

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Global function to open the modal
window.openConversationSearchModal = function() {
  ConversationSearchModal.open();
};

// Export for host pages that still render the shared conversation search modal.
if (typeof window !== 'undefined') {
  window.ConversationSearchModal = ConversationSearchModal;
}
