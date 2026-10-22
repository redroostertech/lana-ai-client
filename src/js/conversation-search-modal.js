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
    if (this.modal) return true;
    // The modal is a lex-modal. lex-modal.js may load after this init call
    // (end of <body>); open() retries init once the component exists.
    if (!(window.customElements && window.customElements.get('lex-modal'))) {
      return false;
    }
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
    // lex-modal supplies the title, close button, backdrop, Escape and focus
    // trap. Content is set before the element connects so it is captured once.
    const modal = document.createElement('lex-modal');
    modal.id = 'conversationSearchModal';
    modal.setAttribute('heading', 'Search Conversations');
    modal.setAttribute('size', 'lg');
    modal.setAttribute('hide-actions', '');
    modal.innerHTML = `
      <p class="text-sm text-gray-500 -mt-2 mb-4">Find your recent chats quickly</p>
      <div class="relative mb-4">
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
      <div id="conversationSearchResults">
        <p class="text-gray-500 text-sm text-center py-8">Start typing to search conversations...</p>
      </div>
    `;
    document.body.appendChild(modal);
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

    // The modal's close button, backdrop and Escape close it; reset state.
    this.modal.addEventListener('lex-close', () => this.close());
  },

  /**
   * Open the modal
   */
  async open() {
    if (!this.modal && !this.init()) {
      console.warn('[ConversationSearchModal] lex-modal is not loaded on this page');
      return;
    }

    this.modal.open = true;
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

    if (this.modal.open) this.modal.open = false;
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
      const conversations = await this.withWorkspaceNames(this.normalizeConversations(response));

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
      const conversations = await this.withWorkspaceNames(this.normalizeConversations(response));
      // A newer keystroke already replaced this search.
      if (this.searchInput.value.trim() !== query) return;

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

  /**
   * Conversation rows carry the workspace code, not its name; fill names in
   * with the dock's shared lookup when it is loaded.
   */
  async withWorkspaceNames(conversations) {
    const chat = window.Lex && window.Lex.Chat;
    if (!chat || typeof chat.resolveWorkspaceNames !== 'function') return conversations;
    const ids = conversations.filter(c => c && c.matter_id && !c.matter_name).map(c => c.matter_id);
    if (ids.length) await chat.resolveWorkspaceNames(ids);
    return conversations.map(c => (c && c.matter_id && !c.matter_name)
      ? { ...c, matter_name: chat.workspaceName(c.matter_id) }
      : c);
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

    this._selection = this._selection || new Map();
    this._selection.set(String(threadId), { title, matterName });

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
    const hints = (this._selection && this._selection.get(String(threadId))) || {};

    try {
      const liveDock = window.Lex
        && window.Lex.LanaDock
        && typeof window.Lex.LanaDock.get === 'function'
        && window.Lex.LanaDock.get();
      if (liveDock && typeof liveDock.openConversation === 'function') {
        liveDock.openConversation(threadId, matterId || null, {
          title: hints.title || '',
          matterName: hints.matterName || ''
        });
        return;
      }
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
      window.Lex.Modal.alertAsync('Conversation Unavailable', `Error selecting conversation: ${error.message}`);
    }
  },

  /**
   * Highlight search term in text
   */
  highlightText(text, query) {
    if (!query) return this.escapeHtml(text);

    const escapedText = this.escapeHtml(text);
    const escapedQuery = this.escapeHtml(query);
    const pattern = escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${pattern})`, 'gi');

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
    return LanaTime.timeAgo(dateString, { maxDays: 7 }) || window.Lex.Utils.formatDate(dateString);
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
