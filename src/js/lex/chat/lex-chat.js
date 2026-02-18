/* ==========================================================================
   Lex UI — <lex-chat>
   Main orchestrator that wires all chat subcomponents together.
   Routes ChatSource events to child components.
   Returns null from render() after initial DOM setup.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, ChatFormat } = global.Lex;
  const Chat = global.Lex.Chat || {};
  if (!LexElement) { console.error('[lex-chat] LexElement not loaded'); return; }

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-styles';
    style.textContent = `
      lex-chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--lex-chat-bg);
        color: var(--lex-chat-text);
        font-family: var(--lex-font-sans);
        overflow: hidden;
      }
    `;
    document.head.appendChild(style);
  }

  class LexChat extends LexElement {

    static get properties() {
      return {
        source:         { type: String, default: 'sse' },
        endpoint:       { type: String, default: '' },
        conversationId: { type: String, default: null, attribute: 'conversation-id' },
        matterId:       { type: String, default: null, attribute: 'matter-id' },
        maxHistory:     { type: Number, default: 50, attribute: 'max-history' },
        chatMode:       { type: String, default: 'general', attribute: 'chat-mode' },
        showComposer:   { type: Boolean, default: true, attribute: 'show-composer' },
        placeholder:    { type: String, default: 'Message Lana AI...' },
        theme:          { type: String, default: null }
      };
    }

    constructor() {
      super();
      this._source = null;
      this._documents = [];
      this._citations = [];
      this._artifacts = [];
      this._streamingContent = '';
      this._initialized = false;

      // Sub-component references
      this._documentsEl = null;
      this._threadEl = null;
      this._activityEl = null;
      this._composerEl = null;
    }

    connected() {
      injectStyles();

      // Apply theme
      if (this.theme) {
        this.setAttribute('data-lex-theme', this.theme);
      }

      this._buildDOM();
      this._bindChildEvents();
      this._initSource();

      // Auto-load conversation if provided
      if (this.conversationId) {
        this.loadConversation(this.conversationId);
      }
    }

    // Imperative DOM after initial build
    render() { return null; }

    _buildDOM() {
      this.innerHTML = `
        <lex-chat-documents></lex-chat-documents>
        <lex-chat-thread></lex-chat-thread>
        <lex-chat-activity hidden></lex-chat-activity>
        ${this.showComposer ? '<lex-chat-composer></lex-chat-composer>' : ''}
      `;

      this._documentsEl = this.querySelector('lex-chat-documents');
      this._threadEl = this.querySelector('lex-chat-thread');
      this._activityEl = this.querySelector('lex-chat-activity');
      this._composerEl = this.querySelector('lex-chat-composer');

      // Apply initial props
      if (this._composerEl) {
        this._composerEl.placeholder = this.placeholder;
      }
      if (this._documentsEl) {
        this._documentsEl.mode = this.chatMode;
      }

      // Show welcome
      if (this._threadEl && !this.conversationId) {
        this._threadEl.showWelcome();
      }
    }

    _bindChildEvents() {
      // Composer send
      this.addEventListener('lex-composer-send', (e) => {
        this.send(e.detail.content);
      });

      // Composer stop
      this.addEventListener('lex-composer-stop', () => {
        this.stop();
      });

      // Composer suggestion
      this.addEventListener('lex-composer-suggestion', (e) => {
        this.send(e.detail.value);
      });

      // Document remove
      this.addEventListener('lex-document-remove', async (e) => {
        try {
          if (this._source) {
            const state = await this._source.removeDocument(e.detail.documentId);
            if (state) this._updateDocumentState(state);
          }
        } catch (err) {
          this._showSystemMessage('Failed to remove document: ' + err.message);
        }
      });

      // Document exit
      this.addEventListener('lex-document-exit', async () => {
        try {
          if (this._source) {
            const state = await this._source.clearDocuments();
            if (state) this._updateDocumentState(state);
          }
        } catch (err) {
          this._showSystemMessage('Failed to exit document mode: ' + err.message);
        }
      });

      // Citation click (bubble up from message)
      this.addEventListener('lex-citation-click', (e) => {
        this.emit('lex-chat-citation-click', e.detail);
      });

      // Artifact click (bubble up from message)
      this.addEventListener('lex-artifact-click', (e) => {
        this.emit('lex-chat-artifact-click', e.detail);
      });

      // Thread scroll-top for pagination
      this.addEventListener('lex-thread-scroll-top', () => {
        this._loadMoreHistory();
      });

      // Composer tool selection
      this.addEventListener('lex-composer-tool-select', (e) => {
        const { toolId } = e.detail;
        if (toolId === 'document_chat') {
          this._props.chatMode = 'document';
          if (this._documentsEl) this._documentsEl.mode = 'document';
        } else if (toolId === 'agentic') {
          localStorage.setItem('chatMode', 'agentic');
        }
        this.emit('lex-chat-tool-select', { toolId });
      });

      // Composer tool dismiss
      this.addEventListener('lex-composer-tool-dismiss', (e) => {
        const { toolId } = e.detail;
        if (toolId === 'document_chat') {
          if (this._documents.length === 0) {
            this._props.chatMode = 'general';
            if (this._documentsEl) this._documentsEl.mode = 'general';
          }
        } else if (toolId === 'agentic') {
          localStorage.setItem('chatMode', 'general');
        }
        this.emit('lex-chat-tool-dismiss', { toolId });
      });

      // Composer manage documents request
      this.addEventListener('lex-composer-manage-documents', () => {
        this.emit('lex-chat-manage-documents');
      });
    }

    // ---------------------------------------------------------------------------
    // Source management
    // ---------------------------------------------------------------------------

    _initSource() {
      const sourceName = this.source;

      // Check if a programmatic source was set
      if (this._source) return;

      // Create from registry
      try {
        this._source = Chat.createSource(sourceName, {
          endpoint: this.endpoint,
          api: global.api
        });
      } catch (err) {
        console.warn(`[lex-chat] Source "${sourceName}" not found, falling back to SSE`);
        if (Chat.SSEChatSource) {
          this._source = new Chat.SSEChatSource({ endpoint: this.endpoint, api: global.api });
        }
      }
    }

    /**
     * Get the current ChatSource instance.
     */
    getSource() { return this._source; }

    /**
     * Set a programmatic source instance.
     */
    set sourceInstance(src) {
      if (this._source) this._source.disconnect();
      this._source = src;
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Send a message through the chat source.
     */
    async send(content, opts = {}) {
      if (!content || !this._source) return;

      // Reset per-message state
      this._citations = [];
      this._artifacts = [];
      this._streamingContent = '';
      this._sendStartTime = Date.now();

      // Add user message to thread
      if (this._threadEl) {
        this._threadEl.addMessage('user', content);
      }

      // Hide suggestions after first message
      if (this._composerEl) {
        this._composerEl.clear();
        this._composerEl.hideSuggestions();
        this._composerEl.setGenerating(true);
      }

      // Show activity indicator
      if (this._activityEl) {
        this._activityEl.clearReasoning();
        this._activityEl.show('Thinking...', 'thinking');
      }

      // Emit send event
      this.emit('lex-chat-send', { content, conversationId: this.conversationId });

      // Prepare source options
      const sendOpts = { ...opts };
      const chatModeStored = localStorage.getItem('chatMode');
      if (chatModeStored === 'agentic') sendOpts.forceAgentic = true;

      // Connect if needed
      if (!this._source.connected) {
        await this._source.connect(this.conversationId);
      }

      let responseStarted = false;

      try {
        // Iterate async generator
        for await (const event of this._source.send(content, sendOpts)) {
          this._handleEvent(event, responseStarted);

          if (event.type === 'content' && !responseStarted) {
            responseStarted = true;
          }
        }
      } catch (err) {
        console.error('[lex-chat] Send error:', err);
        this.emit('lex-chat-error', { error: err.message, type: 'send' });
      }

      // Finalize
      if (this._activityEl) this._activityEl.hide();
      if (this._composerEl) this._composerEl.setGenerating(false);

      if (!responseStarted && this._threadEl) {
        this._threadEl.addMessage('assistant', 'No response received.');
      }

      if (this._composerEl) this._composerEl.focus();
    }

    /**
     * Stop active generation.
     */
    async stop() {
      if (this._source) {
        await this._source.stop();
      }
    }

    /**
     * Load a conversation by ID.
     */
    async loadConversation(id) {
      this._props.conversationId = id;

      if (this._source) {
        await this._source.connect(id);

        // Load chat state (document mode)
        const state = await this._source.loadState();
        if (state) this._updateDocumentState(state);

        // Load history
        const result = await this._source.loadHistory(1, this.maxHistory);
        if (result && result.messages) {
          if (this._threadEl) {
            this._threadEl.clear();
            for (const m of result.messages) {
              this._threadEl.addMessage(m.role, m.content, {
                messageId: m.id || m.message_id,
                timestamp: m.timestamp || m.created_at
              });
            }
            this._threadEl.scrollToBottom(true);
          }
          if (this._threadEl) {
            this._threadEl.hasMore = result.hasMore || false;
          }
        }
      }
    }

    /**
     * Clear the conversation.
     */
    clearConversation() {
      this._props.conversationId = null;
      this._citations = [];
      this._artifacts = [];
      if (this._threadEl) {
        this._threadEl.clear();
        this._threadEl.showWelcome();
      }
      if (this._documentsEl) {
        this._documentsEl.documents = [];
        this._documentsEl.mode = 'general';
      }
    }

    /**
     * Add a document to document mode.
     */
    async addDocument(id, name) {
      if (!this._source) return;
      try {
        const state = await this._source.addDocument(id, name, this.matterId);
        if (state) this._updateDocumentState(state);
      } catch (err) {
        this._showSystemMessage('Failed to add document: ' + err.message);
      }
    }

    /**
     * Remove a document from document mode.
     */
    async removeDocument(id) {
      if (!this._source) return;
      try {
        const state = await this._source.removeDocument(id);
        if (state) this._updateDocumentState(state);
      } catch (err) {
        this._showSystemMessage('Failed to remove document: ' + err.message);
      }
    }

    // ---------------------------------------------------------------------------
    // Event dispatch loop — routes ChatEvents to child components
    // ---------------------------------------------------------------------------

    _handleEvent(event, responseStarted) {
      switch (event.type) {

        case 'connected':
          if (event.threadId && !this.conversationId) {
            this._props.conversationId = event.threadId;
            this.emit('lex-chat-conversation-created', { conversationId: event.threadId });
          }
          this.emit('lex-chat-response-start', { conversationId: this.conversationId });
          break;

        case 'thinking':
          if (this._activityEl) {
            this._activityEl.update(event.message, event.phase);
          }
          break;

        case 'reasoning':
          if (this._activityEl) {
            this._activityEl.addReasoningEntry(event);
          }
          break;

        case 'progress':
          if (this._activityEl) {
            this._activityEl.update(event.message || 'Processing...', event.category || 'progress');
            this._activityEl.addReasoningEntry(event);
          }
          break;

        case 'tool_thinking':
          if (this._activityEl) {
            this._activityEl.update(event.content || 'Analyzing...', 'tool');
            this._activityEl.addReasoningEntry({ message: event.content });
          }
          break;

        case 'content': {
          // First content chunk — hide activity, start streaming message
          if (!responseStarted && this._streamingContent === '') {
            if (this._activityEl) this._activityEl.hide();
            if (this._threadEl) this._threadEl.startAssistantMessage();
          }

          this._streamingContent += event.text;

          if (this._threadEl) {
            this._threadEl.updateLastAssistantMessage(event.text);
          }
          break;
        }

        case 'citations':
          this._citations = event.citations || [];
          break;

        case 'context_usage':
          this.emit('lex-chat-context-usage', {
            percentUsed: event.percentUsed,
            tokensUsed: event.tokensUsed,
            percentUntilCompact: event.percentUntilCompact
          });
          break;

        case 'agentic_progress':
          if (this._activityEl) {
            this._activityEl.update(event.message || 'Processing...', event.phase || 'agentic');
            this._activityEl.addReasoningEntry(event);
          }
          break;

        case 'agentic_complete':
          if (event.artifacts) {
            this._artifacts.push(...event.artifacts);
          }
          this.emit('lex-chat-artifacts', { artifacts: event.artifacts || [] });
          break;

        case 'agentic_error':
          if (this._activityEl) this._activityEl.hide();
          this.emit('lex-chat-error', { error: event.error, type: 'agentic' });
          break;

        case 'agentic_artifacts':
          if (event.artifacts) {
            this._artifacts.push(...event.artifacts);
          }
          this.emit('lex-chat-artifacts', { artifacts: event.artifacts || [] });
          break;

        case 'iteration_summary':
          if (this._activityEl) {
            this._activityEl.addReasoningEntry({
              message: `Iteration ${event.iteration}/${event.maxIterations}: ${event.message}`
            });
          }
          break;

        case 'title':
          this.emit('lex-chat-title-generated', {
            title: event.generatedTitle,
            conversationId: this.conversationId
          });
          break;

        case 'auto_compact_start':
          if (this._activityEl) {
            this._activityEl.update('Auto-compacting conversation...', 'compacting');
          }
          break;

        case 'auto_compact_complete':
          this.emit('lex-chat-context-usage', {
            percentUsed: event.newPercentUsed,
            tokensUsed: null,
            percentUntilCompact: null
          });
          break;

        case 'done':
          // Finalize the streaming message
          if (this._threadEl) {
            const duration = this._sendStartTime ? Date.now() - this._sendStartTime : null;
            this._threadEl.finalizeLastMessage({
              messageId: event.messageId,
              duration,
              citations: this._citations.length > 0 ? this._citations : undefined,
              artifacts: this._artifacts.length > 0 ? this._artifacts : undefined
            });
          }

          // Capture conversation ID from done event (fallback)
          if (event.threadId && !this.conversationId) {
            this._props.conversationId = event.threadId;
            this.emit('lex-chat-conversation-created', { conversationId: event.threadId });
          }

          this.emit('lex-chat-response-end', {
            conversationId: this.conversationId,
            messageId: event.messageId
          });
          break;

        case 'stopped':
          if (this._threadEl) {
            this._threadEl.finalizeLastMessage({
              citations: this._citations.length > 0 ? this._citations : undefined
            });
          }
          this._showSystemMessage('Generation stopped');
          break;

        case 'error':
          if (this._activityEl) this._activityEl.hide();
          if (event.status === 401) {
            this._showSystemMessage('Session expired. Please log in again.');
          } else {
            this._showSystemMessage('Error: ' + (event.error || 'Unknown error'));
          }
          this.emit('lex-chat-error', { error: event.error, type: 'stream' });
          break;
      }
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    _updateDocumentState(state) {
      this._props.chatMode = state.mode || 'general';
      const docs = state.activeDocuments || [];
      this._documents = docs;

      if (this._documentsEl) {
        this._documentsEl.documents = docs;
        this._documentsEl.mode = state.mode || 'general';
      }
    }

    _showSystemMessage(msg) {
      if (this._threadEl) {
        this._threadEl.addSystemMessage(msg);
      }
    }

    async _loadMoreHistory() {
      if (!this._source || !this.conversationId) return;
      // Could implement paged history loading here
    }

    disconnected() {
      if (this._source) {
        this._source.disconnect();
      }
    }
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChat = LexChat;

})(typeof window !== 'undefined' ? window : globalThis);
