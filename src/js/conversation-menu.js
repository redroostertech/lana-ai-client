/**
 * Conversation Menu Manager
 * Handles rendering conversations in the sidebar menu for chat.html
 */

const ConversationMenu = {
  container: null,
  conversations: [],          // unpinned list, paginated
  pinnedConversations: [],    // pinned list, fetched in parallel on page 1
  currentConversationId: null,
  hasMore: true,
  isLoading: false,
  page: 1,
  limit: 20,
  scrollTimeout: null,
  scope: {
    type: 'chat_sessions',
    title: 'Recents'
  },

  setScope(scope) {
    const nextScope = scope || { type: 'chat_sessions', title: 'Recents' };
    const currentKey = JSON.stringify(this.scope || {});
    const nextKey = JSON.stringify(nextScope);
    this.scope = nextScope;

    if (currentKey !== nextKey) {
      this.page = 1;
      this.conversations = [];
      this.pinnedConversations = [];
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

    // Self-sync on `conversation:renamed` window events. The rename helper
    // (utils/rename-conversation.js) dispatches this on every rename, from
    // any surface (kebab modal, workspace Conversations tab, future inline
    // edit). Updating the cached row + re-rendering avoids a full
    // /api/v1/conversation-threads list refetch for the common case.
    //
    // Bind once per ConversationMenu lifetime — `init` is idempotent (called
    // from sidebar mount), so we guard against double-binding.
    if (!this._renameListenerBound) {
      this._renameListenerBound = true;
      window.addEventListener('conversation:renamed', (e) => {
        const detail = (e && e.detail) || {};
        if (!detail.threadId || !detail.title) return;
        this.updateConversation(detail.threadId, { title: detail.title });
      });
    }

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
        this.pinnedConversations = [];
        this.hasMore = true;
      }

      console.log('[ConversationMenu.loadConversations] Fetching from API...');
      // Page 1 fetches pinned + unpinned in parallel (mirrors workspaces).
      // Subsequent pages only fetch the unpinned tail.
      let pinnedResult = { sessions: [] };
      if (this.page === 1) {
        try {
          pinnedResult = await this.fetchPinnedConversations();
        } catch (pinnedErr) {
          // Backend may not expose the /pinned route yet — treat as empty
          console.warn('[ConversationMenu.loadConversations] Pinned fetch failed, falling back to none:', pinnedErr && pinnedErr.message);
          pinnedResult = { sessions: [] };
        }
      }
      const response = await this.fetchConversations(reset);
      const newConversations = response.sessions || [];
      const pinnedFromMain = newConversations.filter(c => c.is_pinned);
      const unpinnedFromMain = newConversations.filter(c => !c.is_pinned);
      console.log('[ConversationMenu.loadConversations] Received', newConversations.length, 'conversations,', pinnedResult.sessions?.length || 0, 'pinned');

      this.hasMore = response.hasMore || unpinnedFromMain.length >= this.limit;
      // If the server doesn't filter on exclude_pinned, pinnedFromMain
      // would otherwise duplicate items in pinnedResult — dedupe by thread_id.
      const pinnedAll = ((pinnedResult.sessions || []).concat(this.page === 1 ? pinnedFromMain : []));
      const seenPinnedIds = new Set();
      const dedupedPinned = pinnedAll.filter(c => {
        const id = c.thread_id || c.id;
        if (!id || seenPinnedIds.has(id)) return false;
        seenPinnedIds.add(id);
        return true;
      });
      if (this.page === 1) {
        this.pinnedConversations = dedupedPinned;
      }
      this.conversations = reset ? unpinnedFromMain : [...this.conversations, ...unpinnedFromMain];

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
      return this.fetchConversationThreads({ excludePinned: true });
    }

    // Add cache-busting parameter when resetting to ensure fresh data after title updates
    const cacheBuster = reset ? `&_=${Date.now()}` : '';
    return api.get(`/api/v1/chat/sessions?page=${this.page}&limit=${this.limit}&sort=updated_at&order=desc&exclude_pinned=true${cacheBuster}`);
  },

  // Page-1 only — fetches the pinned strip in parallel with the regular list.
  async fetchPinnedConversations() {
    if (this.scope && this.scope.type === 'conversation_threads') {
      return this.fetchConversationThreads({ pinnedOnly: true });
    }
    const result = await api.getPinnedChatSessions({ limit: 100, offset: 0 });
    // Normalize to { sessions: [...] } regardless of envelope
    const sessions = result.sessions || result.data || result.threads || [];
    return { sessions };
  },

  async fetchConversationThreads(opts = {}) {
    const pageScopes = (this.scope && this.scope.pageScopes) || [];
    const limit = this.limit;
    const offset = opts.pinnedOnly ? 0 : (this.page - 1) * limit;
    const pinnedQs = opts.pinnedOnly ? '' : (opts.excludePinned ? '&exclude_pinned=true' : '');
    const fetchLimit = opts.pinnedOnly ? 100 : 100;

    const buildUrl = (pageScope) => {
      const base = '/api/v1/conversation-threads' + (opts.pinnedOnly ? '/pinned' : '');
      const ps = pageScope ? `page_scope=${encodeURIComponent(pageScope)}&` : '';
      const sort = opts.pinnedOnly ? '' : '&sort_by=last_activity&sort_order=desc';
      return `${base}?${ps}limit=${fetchLimit}${sort}${pinnedQs}`;
    };

    const requests = pageScopes.length > 0
      ? pageScopes.map((pageScope) => api.get(buildUrl(pageScope)))
      : [api.get(buildUrl(null))];

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

    if (!opts.pinnedOnly) {
      // Sort by last activity for the regular list. Pinned-only is already
      // ordered by pinned_at on the server.
      allThreads.sort((a, b) => {
        const aTime = new Date(a.last_activity || a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.last_activity || b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
      });
    }

    const pageThreads = opts.pinnedOnly ? allThreads : allThreads.slice(offset, offset + limit);

    return {
      sessions: pageThreads.map((thread) => ({
        id: thread.thread_id || thread.id,
        thread_id: thread.thread_id || thread.id,
        title: thread.title || thread.metadata?.title || 'Untitled Chat',
        metadata: thread.metadata || {},
        matter_id: thread.matter_id || '',
        matter_name: thread.metadata?.matter_name || '',
        is_pinned: !!thread.is_pinned,
        pinned_at: thread.pinned_at || null,
        created_at: thread.created_at,
        updated_at: thread.last_activity || thread.updated_at || thread.created_at
      })),
      hasMore: opts.pinnedOnly ? false : offset + pageThreads.length < allThreads.length,
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
    console.log('[ConversationMenu.render] Called with',
      this.pinnedConversations.length, 'pinned,',
      this.conversations.length, 'unpinned');

    if (!this.container) {
      console.error('[ConversationMenu.render] Container not found');
      return;
    }

    if (this.pinnedConversations.length === 0 && this.conversations.length === 0) {
      console.log('[ConversationMenu.render] No conversations, showing empty state');
      this.renderEmpty();
      return;
    }

    let html = '';

    if (this.pinnedConversations.length > 0) {
      const pinnedItems = this.pinnedConversations.map(conv => this.renderConversationItem(conv)).join('');
      html += `
        <div class="px-1 pt-1 pb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <svg class="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg>
          <span>Pinned</span>
        </div>
        <div class="space-y-1 mb-2">${pinnedItems}</div>
      `;
      if (this.conversations.length > 0) {
        html += `<div class="px-1 pt-1 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">All</div>`;
      }
    }

    if (this.conversations.length > 0) {
      html += this.conversations.map(conv => this.renderConversationItem(conv)).join('');
    }

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
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 20V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"></path>
          <rect width="20" height="14" x="2" y="6" rx="2" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></rect>
        </svg>
        <span class="truncate">${safeMatterName}</span>
      </p>
    ` : '';

    // Format timestamp
    const timestamp = this.formatTimestamp(conv.updated_at || conv.created_at);

    const isPinned = !!conv.is_pinned;
    const pinnedGlyph = isPinned ? `
      <svg class="w-3 h-3 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24" title="Pinned" aria-label="Pinned">
        <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/>
      </svg>` : '';

    return `
      <div class="conversation-item ${activeClass} p-2 rounded-lg border border-gray-700 cursor-pointer transition-colors group"
           onclick="ConversationMenu.selectConversation('${threadId}', '${matterId}')"
           data-thread-id="${threadId}">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-white truncate flex items-center gap-1.5">${pinnedGlyph}<span class="truncate">${safeTitle}</span></p>
            ${matterLabel}
            ${safePreview ? `<p class="text-xs text-gray-400 truncate mt-1">${safePreview}</p>` : ''}
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <span class="text-xs text-gray-500">${timestamp}</span>
            <div class="opacity-100 transition-opacity" onclick="event.stopPropagation(); if (typeof window.openConversationActionsModal === 'function') { window.openConversationActionsModal('${threadId}', '${safeTitleForJs}', ${matterId ? `'${matterId}'` : 'null'}, ${isPinned ? 'true' : 'false'}); }">
              <button type="button" class="p-1 hover:bg-gray-700 focus:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded transition-colors" aria-label="Conversation actions" title="Conversation actions">
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
    // Validate conversation exists in either pinned or unpinned list
    const conversationExists =
      this.conversations.some(c => (c.thread_id || c.id) === conversationId) ||
      this.pinnedConversations.some(c => (c.thread_id || c.id) === conversationId);

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
    const idMatch = c => (c.thread_id || c.id) === conversationId;
    const ui = this.conversations.findIndex(idMatch);
    if (ui !== -1) {
      this.conversations[ui] = { ...this.conversations[ui], ...updates };
      this.render();
      return;
    }
    const pi = this.pinnedConversations.findIndex(idMatch);
    if (pi !== -1) {
      this.pinnedConversations[pi] = { ...this.pinnedConversations[pi], ...updates };
      this.render();
    }
  },

  /**
   * Add a new conversation to the top of the list
   */
  addConversation(conversation) {
    if (conversation && conversation.is_pinned) {
      this.pinnedConversations.unshift(conversation);
    } else {
      this.conversations.unshift(conversation);
    }
    this.render();
  },

  /**
   * Remove a conversation from both lists
   */
  removeConversation(conversationId) {
    const keep = c => (c.thread_id || c.id) !== conversationId;
    this.conversations = this.conversations.filter(keep);
    this.pinnedConversations = this.pinnedConversations.filter(keep);
    this.render();
  },

  /**
   * Format timestamp for display
   */
  formatTimestamp(dateString) {
    if (!dateString) return '';

    const date = window.Lex?.Utils?.parseApiUtcDate
      ? window.Lex.Utils.parseApiUtcDate(dateString)
      : new Date(dateString);
    if (!date || !Number.isFinite(date.getTime())) return '';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return formatDateLong(dateString, { month: 'short' });
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
