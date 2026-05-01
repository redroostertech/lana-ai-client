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
  scope: {
    type: 'chat_sessions',
    title: 'Your Chats'
  },

  setScope(scope) {
    const nextScope = scope || { type: 'chat_sessions', title: 'Your Chats' };
    const currentKey = JSON.stringify(this.scope || {});
    const nextKey = JSON.stringify(nextScope);
    this.scope = nextScope;

    if (currentKey !== nextKey) {
      this.page = 1;
      this.conversations = [];
      this.hasMore = true;
    }
  },

  /**
   * Initialize the conversation menu
   */
  init(containerSelector = '#conversationListContainer') {
    console.log('[ConversationMenu.init] Initializing with selector:', containerSelector);
    this.container = document.querySelector(containerSelector);

    if (!this.container) {
      console.warn('[ConversationMenu.init] Container not found:', containerSelector);
      // Try to find and clear any loading text manually
      const fallbackContainer = document.getElementById('conversationListContainer');
      if (fallbackContainer) {
        console.log('[ConversationMenu.init] Found container via fallback, setting it');
        this.container = fallbackContainer;
      } else {
        console.error('[ConversationMenu.init] Container does not exist in DOM');
        return false;
      }
    }

    console.log('[ConversationMenu.init] Container found successfully');

    // Set up infinite scroll with throttling to prevent duplicate requests
    // Prefer the conversation list container when it's the scroll element (lex sidebar),
    // otherwise use the scrollable parent
    const scrollableParent = (this.container.id === 'lexConversationListContainer' && this.container.closest('.lex-sidebar-section-has-conversations'))
      ? this.container
      : (this.container.closest('.lex-sidebar-scrollable') || this.container.closest('.overflow-y-auto') || this.container);
    this.scrollableEl = scrollableParent;

    scrollableParent.addEventListener('scroll', () => {
      // Clear previous timeout
      clearTimeout(this.scrollTimeout);

      // Set new timeout - throttle scroll events
      this.scrollTimeout = setTimeout(() => {
        const { scrollTop, scrollHeight, clientHeight } = scrollableParent;
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
    console.log('[ConversationMenu.loadConversations] Called with reset:', reset, 'isLoading:', this.isLoading);

    if (this.isLoading) {
      console.log('[ConversationMenu.loadConversations] Already loading, skipping');
      return;
    }

    if (!this.container) {
      console.error('[ConversationMenu.loadConversations] Container not initialized');
      return;
    }

    try {
      this.isLoading = true;
      console.log('[ConversationMenu.loadConversations] Starting load...');

      // Show loading indicator during initial load
      if (reset && this.container) {
        console.log('[ConversationMenu.loadConversations] Showing loading spinner');
        this.container.innerHTML = `
          <div class="flex items-center justify-center py-3">
            <div class="animate-spin rounded-full h-5 w-5 border-2 border-indigo-200 border-t-indigo-600"></div>
          </div>
        `;
      }

      if (reset) {
        this.page = 1;
        this.conversations = [];
        this.hasMore = true;
      }

      console.log('[ConversationMenu.loadConversations] Fetching from API...');
      const response = await this.fetchConversations(reset);
      const newConversations = response.sessions || [];
      console.log('[ConversationMenu.loadConversations] Received', newConversations.length, 'conversations');

      this.hasMore = response.hasMore || newConversations.length >= this.limit;
      this.conversations = reset ? newConversations : [...this.conversations, ...newConversations];

      // Clear loading before render so we don't append the bottom spinner (only show it when loading more pages)
      this.isLoading = false;
      // Always render to clear loading state
      console.log('[ConversationMenu.loadConversations] Calling render()');
      this.render();
    } catch (error) {
      console.error('[ConversationMenu.loadConversations] Error:', error);

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
      console.log('[ConversationMenu.loadConversations] Finished, setting isLoading to false');
      this.isLoading = false;
    }
  },

  async fetchConversations(reset = false) {
    if (this.scope && this.scope.type === 'conversation_threads') {
      return this.fetchConversationThreads();
    }

    // Add cache-busting parameter when resetting to ensure fresh data after title updates
    const cacheBuster = reset ? `&_=${Date.now()}` : '';
    return api.get(`/api/v1/chat/sessions?page=${this.page}&limit=${this.limit}&sort=updated_at&order=desc${cacheBuster}`);
  },

  async fetchConversationThreads() {
    const pageScopes = (this.scope && this.scope.pageScopes) || [];
    const limit = this.limit;
    const offset = (this.page - 1) * limit;

    const requests = pageScopes.length > 0
      ? pageScopes.map((pageScope) => api.get(
          `/api/v1/conversation-threads?page_scope=${encodeURIComponent(pageScope)}&limit=100&sort_by=last_activity&sort_order=desc`
        ))
      : [api.get('/api/v1/conversation-threads?limit=100&sort_by=last_activity&sort_order=desc')];

    const results = await Promise.all(requests);
    const allThreads = [];

    results.forEach((result) => {
      const threads = result.data || result.threads || [];
      threads.forEach((thread) => {
        if (thread && thread.context_type === 'insights_chat') {
          allThreads.push(thread);
        }
      });
    });

    allThreads.sort((a, b) => {
      const aTime = new Date(a.last_activity || a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.last_activity || b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });

    const pageThreads = allThreads.slice(offset, offset + limit);

    return {
      sessions: pageThreads.map((thread) => ({
        id: thread.thread_id || thread.id,
        thread_id: thread.thread_id || thread.id,
        title: thread.title || thread.metadata?.title || 'Untitled Chat',
        metadata: thread.metadata || {},
        matter_id: thread.matter_id || '',
        matter_name: thread.metadata?.matter_name || '',
        created_at: thread.created_at,
        updated_at: thread.last_activity || thread.updated_at || thread.created_at
      })),
      hasMore: offset + pageThreads.length < allThreads.length,
      pagination: {
        page: this.page,
        limit,
        offset,
        total: allThreads.length
      }
    };
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
    console.log('[ConversationMenu.render] Called with', this.conversations.length, 'conversations');

    if (!this.container) {
      console.error('[ConversationMenu.render] Container not found');
      return;
    }

    if (this.conversations.length === 0) {
      console.log('[ConversationMenu.render] No conversations, showing empty state');
      this.renderEmpty();
      return;
    }

    console.log('[ConversationMenu.render] Rendering', this.conversations.length, 'conversation items');
    const html = this.conversations.map(conv => this.renderConversationItem(conv)).join('');
    const loadingHtml = this.isLoading && this.hasMore ? this.renderLoading() : '';

    this.container.innerHTML = html + loadingHtml;
    console.log('[ConversationMenu.render] Render complete');
  },

  /**
   * Render empty state
   */
  renderEmpty() {
    if (!this.container) return;
    const label = this.scope && this.scope.type === 'conversation_threads'
      ? 'No insights chats'
      : 'No conversations';
    this.container.innerHTML = '<p class="text-sm text-gray-400 italic px-3 py-2">' + this.escapeHtml(label) + '</p>';
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
    const safeTitleForJs = this.escapeJs(title);  // For JavaScript strings in onclick

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
            <div class="opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); if (typeof window.openConversationActionsModal === 'function') { window.openConversationActionsModal('${threadId}', '${safeTitleForJs}', ${matterId ? `'${matterId}'` : 'null'}); }">
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
  },

  /**
   * Escape string for use in JavaScript string literals
   * This is needed when embedding strings in onclick handlers
   */
  escapeJs(text) {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')   // Escape backslashes first
      .replace(/'/g, "\\'")      // Escape single quotes
      .replace(/"/g, '\\"')      // Escape double quotes
      .replace(/\n/g, '\\n')     // Escape newlines
      .replace(/\r/g, '\\r')     // Escape carriage returns
      .replace(/\t/g, '\\t');    // Escape tabs
  }
};

// Export for use in chat.html
if (typeof window !== 'undefined') {
  window.ConversationMenu = ConversationMenu;
}
