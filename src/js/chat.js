/**
 * Lana AI Chat Component
 * Reusable chat interface that works in both demo and production modes
 */

class LanaChat {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('chatPanel');
    this.demoMode = options.demoMode !== undefined ? options.demoMode : window.LanaConfig?.DEMO_MODE;
    this.onToggle = options.onToggle || (() => {});
    this.api = options.api || window.api;

    this.isOpen = false;
    this.messages = [];
    this.currentConversationId = null;
    this.currentSessionId = null;      // Track current session (message) ID
    this.isGenerating = false;          // Track if AI is currently generating
    this.currentReader = null;          // Track current SSE reader for cancellation
    this.queryCount = 0;
    this.maxDemoQueries = 50;
    this.currentMessageCitations = {};  // Store citations for current message

    // Stateful Chat Mode - Stored in backend, synced locally
    // NOTE: This is now managed by the backend API, not local state
    this.chatState = {
      mode: 'general',
      agentPersona: 'default',
      activeDocuments: [],
      contextPreferences: {
        useRAG: true,
        useConversationHistory: true,
        maxHistoryMessages: 10
      },
      activeFilters: [],
      sessionMetadata: {}
    };

    // Document mode constants
    this.maxDocuments = 3;

    this.init();
  }

  init() {
    if (!this.container) {
      console.error('LanaChat: Container element not found');
      return;
    }

    this.render();
    this.bindEvents();
    this.setupCitationClickHandlers();

    if (!this.demoMode) {
      this.initSSE();
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="chat-panel-inner flex flex-col h-full bg-white border-l border-gray-200">
        <!-- Chat Header -->
        <div class="chat-header flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
              <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
              </svg>
            </div>
            <div>
              <h3 class="font-semibold text-gray-900 text-sm">Lana AI</h3>
              <p class="text-xs text-gray-500">${this.demoMode ? 'Demo Mode' : 'Online'}</p>
            </div>
          </div>
          <button id="chatCloseBtn" class="text-gray-400 hover:text-gray-600 p-1">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- Document Chat Mode Banner -->
        <div id="documentModeBanner" class="hidden border-b border-indigo-200 bg-indigo-50 px-4 py-3">
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                <span class="text-sm font-semibold text-indigo-900">Document Chat Mode</span>
                <span id="docModeCount" class="text-xs text-indigo-600">(0 of 3 documents)</span>
              </div>
              <div id="docModeChips" class="flex flex-wrap gap-2">
                <!-- Document chips will be inserted here -->
              </div>
              <p class="text-xs text-indigo-700 mt-2">All questions will be answered using these documents</p>
            </div>
            <button id="exitDocMode" class="ml-3 px-3 py-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100 rounded-md transition">
              Exit
            </button>
          </div>
        </div>

        <!-- Messages Area -->
        <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-4">
          ${this.renderWelcomeMessage()}
        </div>

        <!-- Typing Indicator -->
        <div id="chatTypingIndicator" class="hidden px-4 py-2">
          <div class="flex items-center space-x-2 text-gray-500">
            <div class="typing-indicator flex space-x-1">
              <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0s;"></span>
              <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.15s;"></span>
              <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.3s;"></span>
            </div>
            <span class="text-sm">Thinking......</span>
          </div>
        </div>

        <!-- Suggestions -->
        <div id="chatSuggestions" class="px-4 pb-2">
          <div class="flex flex-wrap gap-2">
            <button class="chat-suggestion px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition" data-suggestion="What are the key elements of a valid contract?">
              Contract basics
            </button>
            <button class="chat-suggestion px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition" data-suggestion="How do I organize legal documents effectively?">
              Document tips
            </button>
            <button class="chat-suggestion px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs hover:bg-gray-200 transition" data-suggestion="Help me draft a document">
              Draft document
            </button>
          </div>
        </div>

        <!-- Input Area -->
        <div class="chat-input-area border-t border-gray-200 p-3">
          <form id="chatForm" class="flex items-end gap-2">
            <div class="flex-1 relative">
              <textarea
                id="chatInput"
                rows="1"
                placeholder="Ask Lana anything..."
                class="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm max-h-24"
              ></textarea>
            </div>
            <!-- Send Button (shown when not generating) -->
            <button
              type="submit"
              id="chatSendBtn"
              class="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
              </svg>
            </button>
            <!-- Stop Button (shown when generating) -->
            <button
              type="button"
              id="chatStopBtn"
              class="hidden p-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex-shrink-0"
              title="Stop generation"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </form>
          <p class="text-xs text-gray-400 mt-1 text-center">Press Enter to send</p>
        </div>
      </div>
    `;

    // Add required styles if not already present
    this.addStyles();
  }

  renderWelcomeMessage() {
    return `
      <div class="flex items-start space-x-3">
        <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
          </svg>
        </div>
        <div class="flex-1">
          <div class="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3">
            <p class="text-gray-800 text-sm">Hello! I'm Lana, your AI legal assistant.</p>
            <p class="text-gray-600 text-sm mt-2">I can help you with:</p>
            <ul class="list-disc list-inside text-gray-600 text-sm mt-1 space-y-1">
              <li>Document analysis & review</li>
              <li>Legal research</li>
              <li>Contract basics</li>
              <li>Document organization</li>
            </ul>
            ${this.demoMode ? '<p class="text-xs text-indigo-600 mt-2">Demo mode - try the suggestions below!</p>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  addStyles() {
    if (document.getElementById('lana-chat-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'lana-chat-styles';
    styles.textContent = `
      .chat-panel {
        transition: transform 0.3s ease, width 0.3s ease;
      }
      .chat-panel.closed {
        transform: translateX(100%);
      }
      .chat-message-content pre {
        background-color: #f3f4f6;
        padding: 0.75rem;
        border-radius: 0.5rem;
        overflow-x: auto;
        font-size: 0.75rem;
      }
      .chat-message-content code {
        font-family: 'Monaco', 'Menlo', monospace;
        font-size: 0.75rem;
      }
      @keyframes bounce {
        0%, 80%, 100% { transform: translateY(0); }
        40% { transform: translateY(-6px); }
      }
      .animate-bounce {
        animation: bounce 1.4s infinite ease-in-out;
      }
      #chatInput {
        min-height: 38px;
      }
    `;
    document.head.appendChild(styles);
  }

  // ========================================================================
  // DOCUMENT CHAT MODE MANAGEMENT
  // ========================================================================

  /**
   * Add a document to active document chat mode (max 3)
   * Calls backend API to update chat state
   * @param {string} documentId - Document UUID
   * @param {string} filename - Document filename
   */
  async addDocumentToMode(documentId, filename) {
    if (!this.currentConversationId) {
      console.warn('[DocumentMode] No active conversation, cannot add document');
      return false;
    }

    // Check if already at max capacity
    if (this.chatState.activeDocuments.length >= this.maxDocuments) {
      this.showSystemMessage(`Maximum of ${this.maxDocuments} documents reached. Remove a document to add another.`);
      return false;
    }

    // Check if document already added
    const existing = this.chatState.activeDocuments.find(d => d.id === documentId);
    if (existing) {
      this.showSystemMessage(`"${filename}" is already in document chat mode.`);
      return false;
    }

    try {
      // Call backend API to add document
      const response = await fetch(`${this.api.baseUrl}/api/chat/conversations/${this.currentConversationId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.api.getToken()}`
        },
        body: JSON.stringify({
          documentId,
          filename,
          matterId: this.api.currentMatterId || null
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add document');
      }

      const data = await response.json();

      // Update local state from backend response
      this.chatState = data.state;

      // Update UI
      this.updateDocumentModeBanner();

      console.log('[DocumentMode] Document added via API:', {
        documentId,
        filename,
        totalDocs: this.chatState.activeDocuments.length,
        mode: this.chatState.mode
      });

      this.showSystemMessage(data.message || `Added "${filename}" to document chat mode`);
      return true;

    } catch (error) {
      console.error('[DocumentMode] Failed to add document:', error);
      this.showSystemMessage(`Failed to add document: ${error.message}`);
      return false;
    }
  }

  /**
   * Remove a document from active document chat mode
   * Calls backend API to update chat state
   * @param {string} documentId - Document UUID to remove
   */
  async removeDocumentFromMode(documentId) {
    if (!this.currentConversationId) {
      console.warn('[DocumentMode] No active conversation');
      return;
    }

    try {
      const response = await fetch(`${this.api.baseUrl}/api/chat/conversations/${this.currentConversationId}/documents/${documentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${await this.api.getToken()}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove document');
      }

      const data = await response.json();

      // Update local state from backend response
      this.chatState = data.state;

      // Update UI
      this.updateDocumentModeBanner();

      console.log('[DocumentMode] Document removed via API:', {
        documentId,
        remainingDocs: this.chatState.activeDocuments.length,
        mode: this.chatState.mode
      });

      this.showSystemMessage(data.message || 'Document removed from chat mode');

    } catch (error) {
      console.error('[DocumentMode] Failed to remove document:', error);
      this.showSystemMessage(`Failed to remove document: ${error.message}`);
    }
  }

  /**
   * Exit document chat mode entirely
   * Calls backend API to clear all documents
   */
  async exitDocumentMode() {
    if (!this.currentConversationId) {
      console.warn('[DocumentMode] No active conversation');
      return;
    }

    try {
      const response = await fetch(`${this.api.baseUrl}/api/chat/conversations/${this.currentConversationId}/documents/clear`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await this.api.getToken()}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to exit document mode');
      }

      const data = await response.json();

      // Update local state from backend response
      this.chatState = data.state;

      // Hide banner
      const banner = this.container.querySelector('#documentModeBanner');
      if (banner) {
        banner.classList.add('hidden');
      }

      console.log('[DocumentMode] Exited document chat mode via API');
      this.showSystemMessage(data.message || 'Exited document chat mode');

    } catch (error) {
      console.error('[DocumentMode] Failed to exit document mode:', error);
      this.showSystemMessage(`Failed to exit document mode: ${error.message}`);
    }
  }

  /**
   * Update the document mode banner UI
   * Uses chatState.activeDocuments from backend
   */
  updateDocumentModeBanner() {
    const banner = this.container.querySelector('#documentModeBanner');
    const countEl = this.container.querySelector('#docModeCount');
    const chipsContainer = this.container.querySelector('#docModeChips');

    if (!banner || !countEl || !chipsContainer) return;

    const activeDocuments = this.chatState.activeDocuments || [];
    const docCount = activeDocuments.length;
    const isDocumentMode = this.chatState.mode === 'document';

    // Show/hide banner
    if (isDocumentMode && docCount > 0) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
      return;
    }

    // Update count
    countEl.textContent = `(${docCount} of ${this.maxDocuments} documents)`;

    // Render document chips
    chipsContainer.innerHTML = activeDocuments.map(doc => `
      <div class="flex items-center gap-1 px-3 py-1.5 bg-white border border-indigo-200 rounded-full text-xs">
        <svg class="w-3 h-3 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
        </svg>
        <span class="text-gray-700 max-w-xs truncate">${this.escapeHtml(doc.filename)}</span>
        <button
          class="ml-1 text-gray-400 hover:text-red-600 transition remove-doc-btn"
          data-doc-id="${doc.id}"
          title="Remove ${this.escapeHtml(doc.filename)}"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
    `).join('');

    // Bind remove buttons
    chipsContainer.querySelectorAll('.remove-doc-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const docId = btn.dataset.docId;
        this.removeDocumentFromMode(docId);
      });
    });
  }

  /**
   * Load chat state from backend
   * Called when conversation is loaded/switched
   */
  async loadChatState() {
    if (!this.currentConversationId) {
      return;
    }

    try {
      const response = await fetch(`${this.api.baseUrl}/api/chat/conversations/${this.currentConversationId}/state`, {
        headers: {
          'Authorization': `Bearer ${await this.api.getToken()}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load chat state');
      }

      const data = await response.json();
      this.chatState = data.state;

      // Update UI to reflect loaded state
      this.updateDocumentModeBanner();

      console.log('[ChatState] Loaded from backend:', {
        mode: this.chatState.mode,
        activeDocuments: this.chatState.activeDocuments?.length || 0
      });

    } catch (error) {
      console.error('[ChatState] Failed to load state:', error);
      // Keep default state on error
    }
  }

  /**
   * Show a system message in the chat
   */
  showSystemMessage(message) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'flex justify-center';
    messageDiv.innerHTML = `
      <div class="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm max-w-md text-center">
        ${this.escapeHtml(message)}
      </div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Auto-remove after 3 seconds
    setTimeout(() => {
      messageDiv.remove();
    }, 3000);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  bindEvents() {
    // Close button
    const closeBtn = this.container.querySelector('#chatCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggle());
    }

    // Form submission
    const form = this.container.querySelector('#chatForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.sendMessage();
      });
    }

    // Textarea auto-resize and enter key
    const input = this.container.querySelector('#chatInput');
    if (input) {
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 96) + 'px';
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }

    // Suggestion buttons
    const suggestions = this.container.querySelectorAll('.chat-suggestion');
    suggestions.forEach(btn => {
      btn.addEventListener('click', () => {
        const suggestion = btn.dataset.suggestion;
        if (suggestion) {
          input.value = suggestion;
          this.sendMessage();
        }
      });
    });

    // Document Mode Exit button
    const exitDocModeBtn = this.container.querySelector('#exitDocMode');
    if (exitDocModeBtn) {
      exitDocModeBtn.addEventListener('click', () => {
        this.exitDocumentMode();
        this.showSystemMessage('Exited document chat mode');
      });
    }
  }

  initSSE() {
    // SSE is initiated per-message, not as a persistent connection
    // The actual SSE streaming happens in sendViaSSE()
    console.log('Chat ready for SSE streaming');
  }

  async sendMessage() {
    const input = this.container.querySelector('#chatInput');
    let content = input.value.trim();

    if (!content) return;

    // Check demo query limit
    if (this.demoMode && this.queryCount >= this.maxDemoQueries) {
      this.addSystemMessage('Demo query limit reached. Sign in for unlimited access!');
      return;
    }

    // TRIGGER #2: Chat # Mention - Detect and trigger processing for mentioned documents
    if (!this.demoMode) {
      await this.handleDocumentMentions(content);
    }

    // NOTE: Document references are NO LONGER appended to messages
    // The backend automatically uses active documents from chat state
    // This eliminates the need to modify the user's query
    console.log('[ChatState] Sending message with state:', {
      mode: this.chatState.mode,
      activeDocuments: this.chatState.activeDocuments?.length || 0
    });

    // Clear citations when starting a NEW message (prevents race condition)
    this.currentMessageCitations = {};

    // Add user message to UI
    this.addMessage('user', content);
    input.value = '';
    input.style.height = 'auto';

    // Hide suggestions after first message
    const suggestionsEl = this.container.querySelector('#chatSuggestions');
    if (suggestionsEl) {
      suggestionsEl.classList.add('hidden');
    }

    this.queryCount++;

    if (this.demoMode) {
      // Demo mode - use local responses
      this.simulateDemoResponse(content);
    } else {
      // Real mode with SSE streaming
      await this.sendViaSSE(content);
    }
  }

  simulateDemoResponse(query) {
    this.showTypingIndicator();

    const response = window.ChatDemoResponses?.getResponse(query) ||
      'I can help with that! In the full version of Lana AI, I would analyze your query and provide a detailed response.';

    const delay = window.ChatDemoResponses?.getTypingDelay(response) || 1500;

    setTimeout(() => {
      this.hideTypingIndicator();
      this.addMessage('assistant', response);
    }, delay);
  }

  async sendViaRest(content) {
    this.showTypingIndicator();

    try {
      const res = await this.api.request('/api/chat/message', {
        method: 'POST',
        body: JSON.stringify({
          content,
          conversation_id: this.currentConversationId
        })
      });

      this.hideTypingIndicator();

      if (!this.currentConversationId && res.conversation_id) {
        this.currentConversationId = res.conversation_id;
        // Load file drawer documents for this conversation
        if (window.FileDrawer) {
          window.FileDrawer.loadDocuments(res.conversation_id);
        }
        // Load chat state from backend
        this.loadChatState();
      }

      const responseContent = res.message?.content || res.response || 'No response received.';
      this.addMessage('assistant', responseContent);
    } catch (error) {
      this.hideTypingIndicator();
      this.addSystemMessage('Failed to send message. Please try again.');
      console.error('Chat error:', error);
    }
  }

  async sendViaSSE(content) {
    this.showTypingIndicator();

    try {
      const token = localStorage.getItem('token');

      // Wait for ApiClient to be ready (handles async Electron server discovery)
      // This ensures we have the discovered server URL before making requests
      let baseUrl = '';
      if (this.api) {
        // Wait for the API client to finish discovering the server
        if (this.api._readyPromise) {
          await this.api._readyPromise;
        }
        baseUrl = this.api.baseUrl || '';
      }

      // Fallback to config if api.baseUrl is still empty
      if (!baseUrl) {
        baseUrl = window.LanaConfig?.API_BASE_URL || '';
      }

      // Helper: check if URL is invalid for API calls (handles file://, file:///, "null", etc.)
      const isInvalidUrl = (url) => {
        if (!url || url === 'null' || url === 'undefined') return true;
        if (url.startsWith('file:')) return true;
        return false;
      };

      // If still empty, try localStorage synchronously first (fastest path)
      if (isInvalidUrl(baseUrl)) {
        try {
          const savedServer = localStorage.getItem('lana_saved_server');
          if (savedServer) {
            const serverInfo = JSON.parse(savedServer);
            if (serverInfo.url) {
              baseUrl = serverInfo.url;
              if (this.api) this.api.baseUrl = baseUrl;
              console.log('[LanaChat] Got server URL from localStorage:', baseUrl);
            }
          }
        } catch (err) { /* ignore */ }
      }

      // If still empty and in Electron, try IPC to main process
      if (isInvalidUrl(baseUrl) && window.electronAPI) {
        try {
          const result = await window.electronAPI.getSavedServer();
          if (result && result.success && result.server && result.server.url) {
            baseUrl = result.server.url;
            // Update api.baseUrl for future requests
            if (this.api) this.api.baseUrl = baseUrl;
            console.log('[LanaChat] Got server URL from Electron IPC:', baseUrl);
          }
        } catch (err) {
          console.error('[LanaChat] Failed to get saved server:', err);
        }
      }

      // Safety check: if baseUrl is still invalid, we can't make API calls
      if (isInvalidUrl(baseUrl)) {
        throw new Error('Server not connected. Please wait for server discovery or check your connection.');
      }

      const body = { message: content };
      if (this.currentConversationId) {
        body.conversation_id = this.currentConversationId;
      }

      // Add force_agentic flag if Agentic Mode tool is active
      const currentChatMode = localStorage.getItem('chatMode');
      if (currentChatMode === 'agentic') {
        body.force_agentic = true;
        console.log('[Chat] Forcing agentic mode (tool selected)');
      }

      const response = await fetch(`${baseUrl}/api/v1/streaming/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let responseStarted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        let currentEvent = 'message'; // Default event type
        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim());

              // Handle different event types
              if (currentEvent === 'context_usage') {
                console.log('[SSE] Received context_usage event:', data);
                this.updateContextMeter(data);
              } else if (currentEvent === 'thinking') {
                console.log('[SSE] Thinking:', data.message);
                this.updateTypingIndicator(data.message);
              } else if (currentEvent === 'reasoning') {
                console.log('[SSE] Reasoning:', data);
                this.showReasoning(data);
              } else if (currentEvent === 'iteration_summary') {
                console.log('[SSE] Iteration Summary:', data);
                this.showIterationSummary(data);
              } else if (currentEvent === 'tool_thinking') {
                console.log('[SSE] Tool thinking:', data);
                this.showToolThinking(data);
              } else if (currentEvent === 'phase') {
                console.log('[SSE] Phase:', data);
                // Phase started/completed - could show as status update
                if (data.status === 'started') {
                  this.updateTypingIndicator(data.message || `Starting ${data.phase}...`);
                } else if (data.status === 'completed') {
                  console.log(`[SSE] Phase ${data.phase} completed in ${data.elapsed}ms`);
                }
              } else if (currentEvent === 'document_progress') {
                console.log('[SSE] Document Progress:', data);
                // Document progress now handled in chat.html via reasoning drawer
              } else if (currentEvent === 'phase_update') {
                console.log('[SSE] Phase Update:', data);
                // Phase updates now handled in reasoning drawer
              } else if (currentEvent === 'document_phase_update') {
                console.log('[SSE] Document Phase Update:', data);
                // Document phase updates now handled in reasoning drawer
              } else if (currentEvent === 'documents_loaded') {
                console.log('[SSE] Documents Loaded:', data);
                // Documents loaded now handled in reasoning drawer
              } else if (currentEvent === 'citations') {
                console.log('[SSE] Citations:', data);
                this.showCitations(data);
              } else if (currentEvent === 'auto_compact_start') {
                this.handleAutoCompactStart(data);
              } else if (currentEvent === 'auto_compact_complete') {
                this.handleAutoCompactComplete(data);
              } else if (currentEvent === 'agentic_progress') {
                console.log('[SSE] Agentic Progress:', data);
                if (window.AgenticUI) {
                  window.AgenticUI.handleAgenticProgress(data);
                }
              } else if (currentEvent === 'agentic_complete') {
                console.log('[SSE] Agentic Complete:', data);
                if (window.AgenticUI) {
                  window.AgenticUI.handleAgenticComplete(data);
                }
              } else if (currentEvent === 'agentic_error') {
                console.log('[SSE] Agentic Error:', data);
                if (window.AgenticUI) {
                  window.AgenticUI.handleAgenticError(data);
                }
              } else if (data.content) {
                // Regular message content
                if (!responseStarted) {
                  this.hideTypingIndicator();

                  // Check if we already have an AI message with tool thinking section
                  const existingMessage = messagesContainer.querySelector('.ai-message:last-child .chat-message-content');
                  if (existingMessage) {
                    // Stream into existing message (after tool thinking section)
                    existingMessage.innerHTML = this.formatContent(data.content);
                  } else {
                    // Create new message normally
                    this.addMessage('assistant', data.content);
                  }
                  responseStarted = true;
                } else {
                  this.appendToLastMessage(data.content);
                }
              }
            } catch (parseError) {
              // Skip malformed JSON lines
            }
          }
        }
      }

      if (!responseStarted) {
        this.hideTypingIndicator();
        this.addMessage('assistant', 'No response received.');
      }

      // Track successful chat message
      if (responseStarted && window.FeatureTracker) {
        try {
          await window.FeatureTracker.trackFeature(window.Features.CHAT_MESSAGE_SENT, {
            conversation_id: this.currentConversationId,
            has_file_drawer: !!(window.FileDrawer && window.FileDrawer.selectedFiles?.length > 0),
            chat_mode: this.chatState?.mode || 'general',
            active_documents: this.chatState?.activeDocuments?.length || 0
          });
        } catch (trackError) {
          console.error('[FeatureTracker] Failed to track chat message:', trackError);
        }
      }
    } catch (error) {
      this.hideTypingIndicator();
      this.addSystemMessage('Failed to send message. Please try again.');
      console.error('SSE Chat error:', error);
    }
  }

  addMessage(role, content) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (!messagesContainer) return;

    const messageEl = document.createElement('div');

    if (role === 'user') {
      messageEl.className = 'flex items-start space-x-3 justify-end';
      messageEl.innerHTML = `
        <div class="flex-1 max-w-[85%]">
          <div class="bg-indigo-600 text-white rounded-2xl rounded-tr-none px-4 py-3 ml-auto">
            <p class="text-sm">${this.escapeHtml(content)}</p>
          </div>
        </div>
        <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
          </svg>
        </div>
      `;
    } else {
      messageEl.className = 'flex items-start space-x-3 ai-message';
      messageEl.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
          </svg>
        </div>
        <div class="flex-1 max-w-[85%]">
          <div class="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3">
            <div class="chat-message-content text-gray-800 text-sm">${this.formatContent(content)}</div>
          </div>
        </div>
      `;
    }

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    this.messages.push({ role, content });
  }

  addSystemMessage(content) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (!messagesContainer) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'flex justify-center';
    messageEl.innerHTML = `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-sm text-yellow-800">
        ${content}
      </div>
    `;

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  appendToLastMessage(content) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    let lastAiMessage = messagesContainer.querySelector('.ai-message:last-child .chat-message-content');

    if (!lastAiMessage) {
      this.addMessage('assistant', content);
      return;
    }

    // Create temporary container for formatted content
    const formatted = this.formatContent(content);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = formatted;

    // Append all child nodes without re-parsing existing DOM
    // This preserves event listeners on citation links
    while (tempDiv.firstChild) {
      lastAiMessage.appendChild(tempDiv.firstChild);
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showTypingIndicator(message = 'Thinking...') {
    const indicator = this.container.querySelector('#chatTypingIndicator');
    if (indicator) {
      indicator.classList.remove('hidden');
      // Update indicator text if message provided
      const textElement = indicator.querySelector('.text-gray-500');
      if (textElement && message) {
        textElement.textContent = message;
      }
    }
    const sendBtn = this.container.querySelector('#chatSendBtn');
    if (sendBtn) {
      sendBtn.disabled = true;
    }
  }

  updateTypingIndicator(message) {
    const indicator = this.container.querySelector('#chatTypingIndicator');
    if (indicator && !indicator.classList.contains('hidden')) {
      const textElement = indicator.querySelector('.text-gray-500');
      if (textElement) {
        textElement.textContent = message;
      }
    }
  }

  hideTypingIndicator() {
    const indicator = this.container.querySelector('#chatTypingIndicator');
    if (indicator) {
      indicator.classList.add('hidden');
    }
    const sendBtn = this.container.querySelector('#chatSendBtn');
    if (sendBtn) {
      sendBtn.disabled = false;
    }
  }

  showToolThinking(data) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (!messagesContainer) return;

    // Check if we already have an AI message bubble started
    let lastMessage = messagesContainer.querySelector('.ai-message:last-child');

    if (!lastMessage) {
      // Create new AI message bubble with tool thinking section
      lastMessage = document.createElement('div');
      lastMessage.className = 'flex items-start space-x-3 ai-message';
      lastMessage.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
          </svg>
        </div>
        <div class="flex-1 max-w-[85%]">
          <div class="bg-gray-100 rounded-2xl rounded-tl-none px-4 py-3">
            <div class="tool-thinking-section mb-2 pb-2 border-b border-gray-300">
              <div class="flex items-center space-x-2 cursor-pointer text-xs text-gray-600 hover:text-gray-800" onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('svg').classList.toggle('rotate-180');">
                <svg class="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                </svg>
                <span class="font-medium">Show my activity</span>
              </div>
              <div class="hidden mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2 font-mono overflow-x-auto">
                ${this.escapeHtml(data.content || data.message || 'Analyzing query and preparing tools...')}
              </div>
            </div>
            <div class="chat-message-content text-gray-800 text-sm"></div>
          </div>
        </div>
      `;
      messagesContainer.appendChild(lastMessage);
    } else {
      // Add tool thinking section to existing message bubble
      const contentContainer = lastMessage.querySelector('.bg-gray-100');
      if (contentContainer) {
        const thinkingSection = document.createElement('div');
        thinkingSection.className = 'tool-thinking-section mb-2 pb-2 border-b border-gray-300';
        thinkingSection.innerHTML = `
          <div class="flex items-center space-x-2 cursor-pointer text-xs text-gray-600 hover:text-gray-800" onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('svg').classList.toggle('rotate-180');">
            <svg class="w-3 h-3 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
            <span class="font-medium">Show my activity</span>
          </div>
          <div class="hidden mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2 font-mono overflow-x-auto">
            ${this.escapeHtml(data.content || data.message || 'Analyzing query and preparing tools...')}
          </div>
        `;
        contentContainer.insertBefore(thinkingSection, contentContainer.firstChild);
      }
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showReasoning(data) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (!messagesContainer) return;

    // Create reasoning display
    const reasoningEl = document.createElement('div');
    reasoningEl.className = 'reasoning-container mb-3 px-3 py-2 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg';
    reasoningEl.id = 'current-reasoning';

    // Complexity badge colors
    const complexityColors = {
      simple: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      complex: 'bg-red-100 text-red-800'
    };

    // Complexity icons
    const complexityIcons = {
      simple: '⚡',
      medium: '🔍',
      complex: '🧠'
    };

    const badgeClass = complexityColors[data.complexity] || 'bg-gray-100 text-gray-800';
    const icon = complexityIcons[data.complexity] || '🤔';

    reasoningEl.innerHTML = `
      <div class="flex items-start space-x-2">
        <span class="text-xl">${icon}</span>
        <div class="flex-1">
          <div class="flex items-center space-x-2 mb-1">
            <span class="${badgeClass} px-2 py-0.5 rounded-full text-xs font-semibold uppercase">${data.complexity}</span>
            <span class="text-xs text-gray-600">${data.iterations} step${data.iterations > 1 ? 's' : ''}</span>
          </div>
          <p class="text-sm text-gray-700 italic">${this.escapeHtml(data.message)}</p>
        </div>
      </div>
    `;

    messagesContainer.appendChild(reasoningEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showIterationSummary(data) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (!messagesContainer) return;

    // Check if we already have a progress container
    let progressContainer = messagesContainer.querySelector('#iteration-progress');

    if (!progressContainer) {
      progressContainer = document.createElement('div');
      progressContainer.id = 'iteration-progress';
      progressContainer.className = 'iteration-progress mb-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg';
      messagesContainer.appendChild(progressContainer);
    }

    // Calculate progress percentage
    const progressPercent = (data.iteration / data.maxIterations) * 100;

    // Build tools list if any
    let toolsHtml = '';
    if (data.toolsUsed && data.toolsUsed.length > 0) {
      toolsHtml = `
        <div class="mt-1 flex flex-wrap gap-1">
          ${data.toolsUsed.map(tool =>
            `<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">${this.escapeHtml(tool)}</span>`
          ).join('')}
        </div>
      `;
    }

    // Warning if there were failures
    let warningHtml = '';
    if (data.failureCount > 0) {
      warningHtml = `
        <div class="mt-1 text-xs text-red-600">
          ⚠️ ${data.failureCount} tool${data.failureCount > 1 ? 's' : ''} encountered issues
        </div>
      `;
    }

    progressContainer.innerHTML = `
      <div class="flex items-center space-x-2 mb-2">
        <div class="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div class="bg-yellow-500 h-full transition-all duration-300" style="width: ${progressPercent}%"></div>
        </div>
        <span class="text-xs font-semibold text-yellow-800">${data.iteration}/${data.maxIterations}</span>
      </div>
      <div class="text-sm text-gray-700 italic">${this.formatContent(data.message)}</div>
      ${toolsHtml}
      ${warningHtml}
    `;

    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Remove progress container when complete (after 2 seconds)
    if (data.iteration === data.maxIterations) {
      setTimeout(() => {
        progressContainer.style.opacity = '0';
        progressContainer.style.transition = 'opacity 0.5s';
        setTimeout(() => {
          if (progressContainer.parentNode) {
            progressContainer.remove();
          }
        }, 500);
      }, 2000);
    }
  }

  // Document progress is now handled in chat.html via reasoning drawer
  // Removed: showDocumentProgress, showDocumentPhaseUpdate, showDocumentsLoaded

  showCitations(data) {
    // Store citations for inline linking
    console.log('[Citations] Storing citations for inline links:', data);

    // Handle both "sources" and "citations" keys
    const citations = data.sources || data.citations;

    if (!citations || citations.length === 0) {
      console.warn('[Citations] No citations found in data');
      return;
    }

    // Initialize if undefined, but DON'T clear (prevents race condition)
    // Citations are cleared only when starting a new message (in sendMessage)
    if (!this.currentMessageCitations) {
      this.currentMessageCitations = {};
    }

    // Store/merge citations by number for quick lookup
    citations.forEach((citation, index) => {
      const citationNumber = index + 1;
      this.currentMessageCitations[citationNumber] = {
        document_id: citation.document_id,
        filename: citation.filename,
        page_number: citation.page_number || citation.page,
        chunk_index: citation.chunk_index,
        chunk_text: citation.chunk_text || citation.excerpt,  // Handle both keys
        relevance_score: citation.relevance_score || citation.relevance
      };
    });

    console.log('[Citations] Stored citation map:', this.currentMessageCitations);
  }

  formatContent(content) {
    let formatted = content
      .replace(/```(\w+)?\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="bg-gray-200 px-1 rounded text-xs">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Inline document references: "[filename.pdf:page]" format
      .replace(/\[([^\]]+\.pdf)(?::(\d+)(?::(\d+))?)?\]/gi, (match, filename, page) => {
        const pageNum = page || 1;

        // Look up citation in currentMessageCitations to get document ID
        let documentId = '';
        const citations = Object.values(this.currentMessageCitations);
        if (citations && citations.length > 0) {
          const citation = citations.find(c =>
            c.filename === filename ||
            c.filename.includes(filename) ||
            filename.includes(c.filename)
          );
          if (citation) {
            documentId = citation.document_id || '';
          }
        }

        const escapedFilename = this.escapeHtml(filename);
        const displayPage = page || '?';

        // If we found the document ID, create a clickable button
        if (documentId) {
          return `<button class="citation-link inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer transition-colors" data-document-id="${documentId}" data-filename="${escapedFilename}" data-page="${pageNum}" title="Click to open ${escapedFilename} at page ${displayPage}">${escapedFilename}${page ? `, page ${displayPage}` : ''}</button>`;
        } else {
          // Log for debugging
          console.warn('[FormatContent] Could not find document ID for citation:', { filename, page, availableCitations: citations.map(c => c.filename) });
          // Can't find document ID - create clickable button, handler will look it up from Sources at click time
          return `<button class="citation-link inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer transition-colors" data-filename="${escapedFilename}" data-page="${pageNum}" title="Click to open ${escapedFilename} at page ${displayPage}">${escapedFilename}${page ? `, page ${displayPage}` : ''}</button>`;
        }
      })
      // Markdown links: "[text](url)" format
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        // Check if this is a PDF citation (format: "filename.pdf, page XX")
        const pdfMatch = text.match(/^(.+\.pdf)[,\s]*page\s+(\d+)/i);
        if (pdfMatch) {
          const filename = pdfMatch[1].trim();
          const page = parseInt(pdfMatch[2]);

          // Extract document ID from URL: /api/v1/storage/download/{documentId}
          const docIdMatch = url.match(/\/storage\/download\/([^\/\?&#]+)/);
          const documentId = docIdMatch ? docIdMatch[1] : '';

          const escapedFilename = this.escapeHtml(filename);
          const escapedText = this.escapeHtml(text);

          // Create clickable button with data attributes for PDF viewer
          return `<button class="citation-link text-indigo-600 hover:text-indigo-800 hover:underline font-medium cursor-pointer" data-document-id="${documentId}" data-filename="${escapedFilename}" data-page="${page}" title="Click to open ${escapedFilename} at page ${page}">${escapedText}</button>`;
        }

        // Regular markdown link
        return `<a href="${url}" class="text-indigo-600 hover:underline">${text}</a>`;
      })
      .replace(/\n/g, '<br>');

    // Process citation patterns if we have citations stored
    if (Object.keys(this.currentMessageCitations).length > 0) {
      formatted = this.processCitationPatterns(formatted);
    }

    return formatted;
  }

  processCitationPatterns(text) {
    // Match patterns like "(extracts 1, 8)" or "(extract 3)"
    const citationPattern = /\(extracts?\s+(\d+(?:,\s*\d+)*)\)/gi;

    return text.replace(citationPattern, (match, numbers) => {
      const nums = numbers.split(',').map(n => parseInt(n.trim()));
      const links = nums.map(num => {
        const citation = this.currentMessageCitations[num];
        if (!citation) {
          console.warn(`[Citations] Citation ${num} not found in stored citations`);
          return this.escapeHtml(String(num));
        }

        // Escape all user-controlled data for security
        const escapedNum = this.escapeHtml(String(num));
        const escapedDocId = this.escapeHtml(citation.document_id);
        const escapedPage = this.escapeHtml(String(citation.page_number || 1));
        const escapedFilename = this.escapeHtml(citation.filename);
        const escapedTitle = this.escapeHtml(`View ${citation.filename}${citation.page_number ? `, page ${citation.page_number}` : ''}`);

        return `<a href="#"
          class="citation-link text-blue-600 hover:text-blue-800 underline font-medium"
          data-citation-num="${escapedNum}"
          data-doc-id="${escapedDocId}"
          data-page="${escapedPage}"
          data-filename="${escapedFilename}"
          title="${escapedTitle}"
          onclick="event.preventDefault();"
        >${escapedNum}</a>`;
      }).join(', ');

      return `(extracts ${links})`;
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Context meter and auto-compact handling
  updateContextMeter(data) {
    const text = document.getElementById('contextText');
    if (!text) {
      console.warn('Context meter element not found');
      return;
    }

    // Always show percent until compact
    const available = 100 - data.percent_used;
    const untilCompact = data.percent_until_compact;

    // Format: "Context available: 87% (72% until auto-compact)"
    text.textContent = `Context available: ${available}% (${untilCompact}% until auto-compact)`;

    console.log('Context meter updated:', {
      percent_used: data.percent_used,
      available,
      until_compact: untilCompact,
      tokens_used: data.tokens_used,
      tokens_available: data.tokens_available
    });
  }

  handleAutoCompactStart(data) {
    console.log('Auto-compact starting:', data);

    // Disable send button during compaction
    const sendBtn = this.container.querySelector('#sendBtn');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Auto-compacting...';
    }

    // Update context meter
    const text = document.getElementById('contextText');
    if (text) {
      text.textContent = 'Auto-compacting conversation...';
    }

    // Show system message
    this.addSystemMessage(`Auto-compacting conversation (${data.messages_to_summarize} messages)...`);
  }

  handleAutoCompactComplete(data) {
    console.log('Auto-compact complete:', data);

    // Re-enable send button
    const sendBtn = this.container.querySelector('#sendBtn');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }

    // Update context meter with new usage
    const text = document.getElementById('contextText');
    if (text) {
      const available = 100 - data.new_percent_used;
      text.textContent = `Context available: ${available}%`;
    }

    // Show success message
    this.addSystemMessage(
      `Conversation compacted (saved ${data.tokens_saved} tokens) in ${data.duration_ms}ms`
    );
  }

  addSystemMessage(message) {
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (!messagesContainer) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'flex justify-center my-2';
    messageEl.innerHTML = `
      <div class="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs">
        ${this.escapeHtml(message)}
      </div>
    `;

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * TRIGGER #2: Handle document mentions in chat messages
   * Detect # mentions and trigger processing for unprocessed documents
   */
  async handleDocumentMentions(message) {
    // Detect #mentions in message (filenames after #)
    const mentions = message.match(/#([a-zA-Z0-9_\-\.]+)/g);

    if (!mentions || mentions.length === 0) {
      return; // No mentions found
    }

    console.log('[Chat] Detected document mentions:', mentions);

    // Get file drawer documents (if available)
    if (!window.FileDrawer || !window.FileDrawer.currentSessionId) {
      console.log('[Chat] File drawer not initialized, skipping mention processing');
      return;
    }

    const processingPromises = [];

    for (const mention of mentions) {
      const filename = mention.substring(1); // Remove # prefix

      // Find document by filename in active or available documents
      const doc = this.findDocumentByFilename(filename);

      if (doc) {
        console.log(`[Chat] Found document for mention: ${filename}`, doc);

        // ADD TO DOCUMENT CHAT MODE (NEW BEHAVIOR)
        // This activates persistent document context
        const added = this.addDocumentToMode(doc.id, doc.filename);
        if (added) {
          console.log(`[DocumentMode] Added ${filename} to persistent document chat mode`);
        }

        try {
          // Check if processing needed
          const status = await this.api.getDocumentProcessingStatus(doc.id);

          if (status.stage === 'pending' || !status.hasExtractedText) {
            console.log(`[Chat] Document ${filename} needs processing, triggering JIT`);

            // Trigger processing (don't wait)
            const promise = this.api.triggerDocumentProcessing(doc.id, 'chat_reference')
              .then(() => {
                console.log(`[Chat] Processing triggered for ${filename}`);
                // Poll for completion in background
                return this.api.pollDocumentProcessing(doc.id);
              })
              .then(() => {
                console.log(`[Chat] Processing completed for ${filename}`);
                this.showSystemMessage(`Document "${filename}" processed and ready`);
              })
              .catch(error => {
                console.error(`[Chat] Failed to process ${filename}:`, error);
                this.showSystemMessage(`Failed to process "${filename}"`);
              });

            processingPromises.push(promise);
          }
        } catch (error) {
          console.error(`[Chat] Error checking status for ${filename}:`, error);
        }
      } else {
        console.log(`[Chat] Document not found for mention: ${filename}`);
      }
    }

    // Optional: Wait for all processing to complete before sending message
    // For now, we process in background and send message immediately
    if (processingPromises.length > 0) {
      console.log(`[Chat] Processing ${processingPromises.length} mentioned documents in background`);
    }
  }

  /**
   * Find document by filename in conversation context
   * Search in both active and available documents from FileDrawer
   */
  findDocumentByFilename(filename) {
    if (!window.FileDrawer) return null;

    const allDocs = [
      ...(window.FileDrawer.documents.active || []),
      ...(window.FileDrawer.documents.available || [])
    ];

    // Try exact match first
    let doc = allDocs.find(d => d.filename === filename);

    // Try case-insensitive match
    if (!doc) {
      doc = allDocs.find(d => d.filename.toLowerCase() === filename.toLowerCase());
    }

    // Try partial match (filename contains the mention)
    if (!doc) {
      doc = allDocs.find(d => d.filename.toLowerCase().includes(filename.toLowerCase()));
    }

    return doc;
  }

  toggle() {
    this.isOpen = !this.isOpen;

    if (this.isOpen) {
      this.container.classList.remove('closed');
      this.container.classList.add('open');
    } else {
      this.container.classList.add('closed');
      this.container.classList.remove('open');
    }

    this.onToggle(this.isOpen);
  }

  open() {
    if (!this.isOpen) {
      this.toggle();
    }
  }

  close() {
    if (this.isOpen) {
      this.toggle();
    }
  }

  clearMessages() {
    this.messages = [];
    this.currentConversationId = null;
    const messagesContainer = this.container.querySelector('#chatMessages');
    if (messagesContainer) {
      messagesContainer.innerHTML = this.renderWelcomeMessage();
    }
    const suggestionsEl = this.container.querySelector('#chatSuggestions');
    if (suggestionsEl) {
      suggestionsEl.classList.remove('hidden');
    }

    // Reset context meter for new conversation
    this.resetContextMeter();
  }

  resetContextMeter() {
    const text = document.getElementById('contextText');
    if (text) {
      text.textContent = 'Context available: 100% (85% until auto-compact)';
    }
  }

  setupCitationClickHandlers() {
    // Event delegation for dynamically added citation links
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('citation-link')) {
        e.preventDefault();
        const citationNum = parseInt(e.target.dataset.citationNum);
        // Support both data-doc-id and data-document-id
        let docId = e.target.dataset.docId || e.target.dataset.documentId;
        const page = parseInt(e.target.dataset.page) || 1;
        const filename = e.target.dataset.filename;

        console.log('[Citations] Click data:', { citationNum, docId, page, filename });

        // If no document ID, try to look it up from currentMessageCitations by filename
        if (!docId && filename) {
          console.log('[Citations] No document ID, looking up from stored citations by filename:', filename);
          const citations = Object.values(this.currentMessageCitations);
          const citation = citations.find(c =>
            c.filename === filename ||
            c.filename.includes(filename) ||
            filename.includes(c.filename)
          );
          if (citation) {
            docId = citation.document_id;
            console.log('[Citations] Found matching document ID from stored citations:', docId);
          }
        }

        if (docId) {
          console.log('[Citations] Opening citation:', { citationNum, docId, page, filename });
          this.openDocumentAtCitation(docId, page, filename);
        } else {
          console.error('[Citations] No document ID found for filename:', filename);
          // Show error toast (assuming Toast is available)
          if (window.Toast) {
            window.Toast.error('Document reference not found');
          }
        }
      }
    });
  }

  async openDocumentAtCitation(documentId, pageNumber, filename) {
    try {
      console.log('[Citations] Opening document viewer:', { documentId, pageNumber, filename });

      // Get the API base URL
      let baseUrl = '';
      if (this.api) {
        if (this.api._readyPromise) {
          await this.api._readyPromise;
        }
        baseUrl = this.api.baseUrl || '';
      }

      if (!baseUrl) {
        baseUrl = window.LanaConfig?.API_BASE_URL || '';
      }

      // Helper: check if URL is invalid for API calls (handles file://, file:///, "null", etc.)
      const isInvalidUrl = (url) => {
        if (!url || url === 'null' || url === 'undefined') return true;
        if (url.startsWith('file:')) return true;
        return false;
      };

      // Try localStorage synchronously first (fastest path)
      if (isInvalidUrl(baseUrl)) {
        try {
          const savedServer = localStorage.getItem('lana_saved_server');
          if (savedServer) {
            const serverInfo = JSON.parse(savedServer);
            if (serverInfo.url) {
              baseUrl = serverInfo.url;
              console.log('[Citations] Got server URL from localStorage:', baseUrl);
            }
          }
        } catch (err) { /* ignore */ }
      }

      // If still empty and in Electron, try IPC to main process
      if (isInvalidUrl(baseUrl) && window.electronAPI) {
        try {
          const result = await window.electronAPI.getSavedServer();
          if (result && result.success && result.server && result.server.url) {
            baseUrl = result.server.url;
            console.log('[Citations] Got server URL from Electron IPC:', baseUrl);
          }
        } catch (err) {
          console.error('[Citations] Failed to get saved server:', err);
        }
      }

      // Early return with user-friendly message if server not connected
      if (isInvalidUrl(baseUrl)) {
        this.addSystemMessage('Server not connected. Please connect to your Lana AI server first.');
        return;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        this.addSystemMessage('Please log in to view documents.');
        return;
      }

      // Construct document URL with page anchor
      // The browser's native PDF viewer supports #page=N anchor
      const documentUrl = `${baseUrl}/api/v1/documents/${documentId}/download?token=${token}#page=${pageNumber}`;

      // Validate URL before opening
      try {
        new URL(documentUrl);
      } catch (urlError) {
        throw new Error('Invalid document URL generated');
      }

      console.log('[Citations] Opening URL:', documentUrl);

      // Open in new tab with native browser PDF viewer
      const newWindow = window.open(documentUrl, '_blank');

      if (!newWindow) {
        // Popup blocked - show message
        this.addSystemMessage(
          `Please allow popups to view ${filename} (page ${pageNumber})`
        );
      } else {
        // Success - show confirmation
        this.addSystemMessage(
          `Opening ${filename} at page ${pageNumber}...`
        );
      }
    } catch (error) {
      console.error('[Citations] Failed to open document:', error);

      // User-friendly error messages based on error type
      let userMessage = 'Failed to open document';
      if (error.message.includes('authentication') || error.message.includes('log in')) {
        userMessage = 'Please log in to view documents';
      } else if (error.message.includes('Server') || error.message.includes('connect')) {
        userMessage = 'Server not connected. Please connect first';
      } else if (error.message.includes('Invalid')) {
        userMessage = `Unable to open ${filename}: Invalid document reference`;
      } else {
        userMessage = `Unable to open ${filename}: ${error.message}`;
      }

      this.addSystemMessage(userMessage);
    }
  }

  destroy() {
    if (this.ws) {
      this.ws.close();
    }
    this.container.innerHTML = '';
  }
}

// Export for use as module or global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LanaChat;
} else {
  window.LanaChat = LanaChat;
}
