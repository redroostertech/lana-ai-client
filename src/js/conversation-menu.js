/**
 * Conversation Menu Manager
 * Handles rendering conversations in the sidebar menu for chat.html
 */

const ConversationMenu = {
  container: null,
  conversations: [],
  currentConversationId: null,
  hasMore: true,
  isLoading: false,
  page: 1,
  limit: 20,
  scrollTimeout: null,

  /**
   * Initialize the conversation menu
   */
  init(containerSelector = '#conversationListContainer') {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.warn('Conversation list container not found:', containerSelector);
      return false;
    }

    // Set up infinite scroll with throttling to prevent duplicate requests
    this.container.addEventListener('scroll', () => {
      // Clear previous timeout
      clearTimeout(this.scrollTimeout);

      // Set new timeout - throttle scroll events
      this.scrollTimeout = setTimeout(() => {
        const { scrollTop, scrollHeight, clientHeight } = this.container;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
          this.loadMore();
        }
      }, 150); // Throttle to 150ms
    });

    return true;
  },

  /**
   * Load conversations from API
   */
  async loadConversations(reset = false) {
    if (this.isLoading) return;

    try {
      this.isLoading = true;

      if (reset) {
        this.page = 1;
        this.conversations = [];
        this.hasMore = true;
      }

      const response = await api.get(`/api/v1/chat/sessions?page=${this.page}&limit=${this.limit}&sort=updated_at&order=desc`);
      const newConversations = response.sessions || [];

      this.hasMore = response.hasMore || newConversations.length >= this.limit;
      this.conversations = reset ? newConversations : [...this.conversations, ...newConversations];

      this.render();
    } catch (error) {
      console.error('Failed to load conversations:', error);

      // Show error state with retry button instead of empty state
      if (this.container) {
        this.container.innerHTML = `
          <div class="px-3 py-4 text-center">
            <svg class="w-8 h-8 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p class="text-sm text-red-600 font-medium mb-1">Failed to load conversations</p>
            <p class="text-xs text-gray-500 mb-3">${this.escapeHtml(error.message || 'Network error')}</p>
            <button onclick="ConversationMenu.loadConversations(true)"
                    class="px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 rounded font-medium transition-colors">
              <svg class="w-3 h-3 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
              Retry
            </button>
          </div>
        `;
      }
    } finally {
      this.isLoading = false;
    }
  },

  /**
   * Load more conversations (pagination)
   */
  async loadMore() {
    if (!this.hasMore || this.isLoading) return;
    this.page++;
    await this.loadConversations(false);
  },

  /**
   * Render conversations in the menu
   */
  render() {
    if (!this.container) return;

    if (this.conversations.length === 0) {
      this.renderEmpty();
      return;
    }

    const html = this.conversations.map(conv => this.renderConversationItem(conv)).join('');
    const loadingHtml = this.isLoading && this.hasMore ? this.renderLoading() : '';

    this.container.innerHTML = html + loadingHtml;
  },

  /**
   * Render empty state
   */
  renderEmpty() {
    if (!this.container) return;
    this.container.innerHTML = '<p class="text-sm text-gray-400 italic px-3 py-2">No conversations</p>';
  },

  /**
   * Render loading indicator
   */
  renderLoading() {
    return `
      <div class="flex items-center justify-center py-3">
        <div class="animate-spin rounded-full h-5 w-5 border-2 border-indigo-200 border-t-indigo-600"></div>
      </div>
    `;
  },

  /**
   * Render a single conversation item
   */
  renderConversationItem(conv) {
    const threadId = conv.thread_id || conv.id;
    const isActive = threadId === this.currentConversationId;
    const activeClass = isActive ? 'bg-gray-800 border-indigo-500' : 'hover:bg-gray-800';

    // Get conversation title
    const title = conv.title || conv.metadata?.title || 'Untitled Chat';
    const safeTitle = this.escapeHtml(title);
    const safeTitleForAttr = this.escapeHtml(title).replace(/'/g, '&#39;');

    // Get last message preview
    const lastMessage = conv.last_message || conv.lastMessage || '';
    const preview = lastMessage.substring(0, 60) + (lastMessage.length > 60 ? '...' : '');
    const safePreview = this.escapeHtml(preview);

    // Get matter info if available
    const matterName = conv.matter_name || conv.metadata?.matter_name || '';
    const safeMatterName = this.escapeHtml(matterName);
    const matterId = conv.matter_id || '';
    const matterLabel = matterName ? `
      <p class="text-xs text-gray-400 truncate flex items-center gap-1 mt-0.5">
        <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>
        <span class="truncate">${safeMatterName}</span>
      </p>
    ` : '';

    // Format timestamp
    const timestamp = this.formatTimestamp(conv.updated_at || conv.created_at);

    return `
      <div class="conversation-item ${activeClass} p-2 rounded-lg border border-gray-700 cursor-pointer transition-colors group"
           onclick="ConversationMenu.selectConversation('${threadId}', '${matterId}')"
           data-thread-id="${threadId}">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-white truncate">${safeTitle}</p>
            ${matterLabel}
            ${safePreview ? `<p class="text-xs text-gray-400 truncate mt-1">${safePreview}</p>` : ''}
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span class="text-xs text-gray-500">${timestamp}</span>
            <div class="opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); if (typeof window.openConversationActionsModal === 'function') { window.openConversationActionsModal('${threadId}', '${safeTitleForAttr}', ${matterId ? `'${matterId}'` : 'null'}); }">
              <button class="p-1 hover:bg-gray-700 rounded transition-colors">
                <svg class="w-4 h-4 text-gray-400 hover:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Handle conversation selection - navigate to chat.html or select in-page
   */
  selectConversation(threadId, matterId = '') {
    console.log('[ConversationMenu.selectConversation] Called with:', { threadId, matterId });

    // Check if we're on the chat page
    const isOnChatPage = NavigationHelpers.isOnChatPage();
    console.log('[ConversationMenu.selectConversation] isOnChatPage:', isOnChatPage);
    console.log('[ConversationMenu.selectConversation] window.selectConversation exists:', typeof window.selectConversation === 'function');

    if (isOnChatPage && typeof window.selectConversation === 'function') {
      // We're on chat page, call the local function with matterId
      console.log('[ConversationMenu.selectConversation] Calling window.selectConversation()');
      window.selectConversation(threadId, matterId);
    } else {
      // Navigate to chat page with conversation - use centralized navigation
      console.log('[ConversationMenu.selectConversation] Navigating to conversation');
      NavigationHelpers.navigateToConversation(threadId, matterId);
    }
  },

  /**
   * Set active conversation
   * @param {string} conversationId - Conversation ID to set as active
   * @returns {boolean} True if conversation found and set active, false otherwise
   */
  setActive(conversationId) {
    // Validate conversation exists before setting active
    const conversationExists = this.conversations.some(c =>
      (c.thread_id || c.id) === conversationId
    );

    if (!conversationExists) {
      console.warn(`[ConversationMenu] Conversation ${conversationId} not found in loaded conversations`);
      this.currentConversationId = null; // Clear active state
      this.render();
      return false;
    }

    this.currentConversationId = conversationId;
    this.render();
    return true;
  },

  /**
   * Update a specific conversation (e.g., after new message)
   */
  updateConversation(conversationId, updates) {
    const index = this.conversations.findIndex(c => (c.thread_id || c.id) === conversationId);
    if (index !== -1) {
      this.conversations[index] = { ...this.conversations[index], ...updates };
      this.render();
    }
  },

  /**
   * Add a new conversation to the top of the list
   */
  addConversation(conversation) {
    this.conversations.unshift(conversation);
    this.render();
  },

  /**
   * Remove a conversation from the list
   */
  removeConversation(conversationId) {
    this.conversations = this.conversations.filter(c => (c.thread_id || c.id) !== conversationId);
    this.render();
  },

  /**
   * Format timestamp for display
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
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

// Export for use in chat.html
if (typeof window !== 'undefined') {
  window.ConversationMenu = ConversationMenu;
}
