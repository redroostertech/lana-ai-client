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

  // ---------------------------------------------------------------------------
  // Tool-name humanizer
  // ---------------------------------------------------------------------------
  // Maps backend tool identifiers (and, where useful, params) to short
  // human-friendly phrases that appear above "Working..." on the activity
  // bar while a tool runs. Keep these phrases short (they replace the small
  // primary line in <lex-chat-activity>); the trailing ellipsis matches the
  // server-supplied tool_progress messages so the bar reads consistently.
  //
  // To extend: add a new entry below; for tools whose phrasing depends on a
  // param (e.g. get_matter_data + data_type), branch inside the function.
  // ---------------------------------------------------------------------------

  function humanizeSnakeCase(name) {
    const cleaned = String(name || '').replace(/_/g, ' ').trim();
    if (!cleaned) return '';
    return `Running ${cleaned}…`;
  }

  function humanizeToolStart(toolName, params) {
    const name = String(toolName || '').trim();
    if (!name) return '';
    const p = params || {};

    switch (name) {
      case 'get_matter_data': {
        // Sub-shape varies by data_type; pick a friendly phrase per kind.
        const kind = String(p.data_type || '').toLowerCase();
        switch (kind) {
          case 'documents': return 'Looking up matter documents…';
          case 'tasks':     return 'Looking up matter tasks…';
          case 'contacts':  return 'Looking up matter contacts…';
          case 'notes':     return 'Looking up matter notes…';
          case 'comments':  return 'Looking up matter comments…';
          case 'activity':  return 'Looking up matter activity…';
          case 'access':    return 'Checking matter access…';
          default:          return 'Looking up matter data…';
        }
      }
      case 'get_matter_documents': return 'Looking up matter documents…';
      case 'get_matter_tasks':     return 'Looking up matter tasks…';
      case 'get_matter_contacts':  return 'Looking up matter contacts…';
      case 'get_matter_notes':     return 'Looking up matter notes…';
      case 'get_matter_calendar':  return 'Looking up matter calendar…';
      case 'get_automation_details': return 'Looking up automation details…';

      case 'find_organization_users': return 'Finding organization users…';
      case 'share_matter':            return 'Sharing matter…';

      case 'entity_search': return 'Searching records…';
      case 'entity_list':   return 'Listing records…';
      case 'entity_read':   return 'Reading record…';
      case 'entity_create': return 'Creating record…';
      case 'entity_update': return 'Updating record…';
      case 'entity_delete': return 'Deleting record…';

      case 'query_platform_knowledge': return 'Looking up platform knowledge…';
      case 'query_analytics_data':     return 'Querying analytics…';
      case 'generate_forecast':        return 'Generating forecast…';
      case 'request_additional_tools': return 'Loading more tools…';

      default:
        return humanizeSnakeCase(name);
    }
  }

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
      .lex-chat-context-meter {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 16px;
        font-size: 11px;
        color: var(--lex-text-muted, #6b7280);
      }
      .lex-chat-context-meter-bar {
        flex: 0 0 80px;
        height: 4px;
        border-radius: 2px;
        background: var(--lex-border, #e5e7eb);
        overflow: hidden;
      }
      .lex-chat-context-meter-fill {
        height: 100%;
        border-radius: 2px;
        background: #22c55e;
        transition: width .3s ease, background .3s ease;
        width: 0%;
      }
      .lex-chat-context-meter-fill[data-warn] { background: #f59e0b; }
      .lex-chat-context-meter-fill[data-danger] { background: #ef4444; }
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
        contextType:    { type: String, default: null, attribute: 'context-type' },
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
      this._contextWarningShown = false;
      this._contextMeterEl = null;

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

      // Clear stale global chatMode from localStorage (legacy). Chat mode is now
      // per-component state and should not persist across conversations/pages.
      try { localStorage.removeItem('chatMode'); } catch (_) {}

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
        <div class="lex-chat-context-meter" style="display:none">
          <div class="lex-chat-context-meter-bar"><div class="lex-chat-context-meter-fill"></div></div>
          <span class="lex-chat-context-meter-text"></span>
        </div>
        ${this.showComposer ? '<lex-chat-composer></lex-chat-composer>' : ''}
      `;

      this._documentsEl = this.querySelector('lex-chat-documents');
      this._threadEl = this.querySelector('lex-chat-thread');
      this._activityEl = this.querySelector('lex-chat-activity');
      this._composerEl = this.querySelector('lex-chat-composer');
      this._contextMeterEl = this.querySelector('.lex-chat-context-meter');

      // Apply initial props
      if (this._composerEl) {
        this._composerEl.placeholder = this.placeholder;
        // Forward matter scope so the composer's @-mention typeahead can
        // include matter contacts in addition to org users + agents.
        if (this.matterId) this._composerEl.matterId = this.matterId;
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
      // ── Action Bridge — bidirectional block↔AI communication ──
      if (global.Lex.ActionBridge) {
        this._bridge = new global.Lex.ActionBridge();
        this._bridge.attach(this, {
          feedbackEndpoint: '/api/v1/feedback/',
          getToken: () => localStorage.getItem('token') || '',
          getBaseUrl: () => {
            const api = global.api;
            return api?.baseUrl || '';
          }
        });
      }

      // Composer send
      this.addEventListener('lex-composer-send', (e) => {
        const opts = {};
        if (e.detail.attachments) opts.attachments = e.detail.attachments;
        this.send(e.detail.content, opts);
      });

      // Composer stop
      this.addEventListener('lex-composer-stop', () => {
        this.stop();
      });

      // Composer suggestion (fallback if bridge isn't loaded)
      this.addEventListener('lex-composer-suggestion', (e) => {
        if (!this._bridge) this.send(e.detail.value);
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

      // Citation click — emit cancelable event, then open document as default.
      // Pages can call e.preventDefault() on lex-chat-citation-click to override.
      this.addEventListener('lex-citation-click', (e) => {
        const evt = new CustomEvent('lex-chat-citation-click', {
          detail: e.detail, bubbles: true, composed: true, cancelable: true
        });
        this.dispatchEvent(evt);
        if (!evt.defaultPrevented) {
          this._openCitationDocument(e.detail);
        }
      });

      // Artifact click (bubble up from message)
      this.addEventListener('lex-artifact-click', (e) => {
        this.emit('lex-chat-artifact-click', e.detail);
      });

      // Promotion is executed by the page controller so the message remains a
      // presentation-only component and the page can use the shared API client.
      this.addEventListener('lex-artifact-promote', (e) => {
        this.emit('lex-chat-artifact-promote', e.detail);
      });

      // Thread scroll-top for pagination
      this.addEventListener('lex-thread-scroll-top', () => {
        this._loadMoreHistory();
      });

      // Composer tool selection — set component state, not global localStorage
      this.addEventListener('lex-composer-tool-select', (e) => {
        const { toolId } = e.detail;
        if (toolId === 'document_chat') {
          this._props.chatMode = 'document';
          if (this._documentsEl) this._documentsEl.mode = 'document';
        } else if (toolId === 'agentic') {
          this._props.chatMode = 'agentic';
        } else if (toolId === 'insights_chat') {
          this._props.chatMode = 'insights';
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
          this._props.chatMode = 'general';
        } else if (toolId === 'insights_chat') {
          this._props.chatMode = 'general';
        }
        this.emit('lex-chat-tool-dismiss', { toolId });
      });

      // Composer manage documents request
      this.addEventListener('lex-composer-manage-documents', () => {
        this.emit('lex-chat-manage-documents');
      });

      // Composer document selection from # picker — add document to chat context
      // and trigger JIT processing if the document isn't vectorized yet.
      this.addEventListener('lex-composer-document-select', async (e) => {
        const { documentId, filename } = e.detail || {};
        if (documentId) {
          try {
            await this.addDocument(documentId, filename);
            this._ensureDocumentProcessed(documentId, filename);
          } catch (err) {
            this._showSystemMessage('Failed to add document: ' + err.message);
            // Remove badge from composer on failure
            const composer = this.querySelector('lex-chat-composer');
            if (composer) composer.removeDocument(documentId);
          }
        }
      });

      // Composer document badge dismissed — remove from chat context
      this.addEventListener('lex-composer-document-remove', async (e) => {
        const { documentId } = e.detail || {};
        if (documentId) {
          await this.removeDocument(documentId);
        }
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
      this._groundingContext = null;
      this._sendStartTime = Date.now();
      this._planReadyReceived = false;
      this._recoveryNoticeShownForConversation = null;

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
        this._activityEl.show('Working...');
      }

      // Emit send event
      this.emit('lex-chat-send', { content, conversationId: this.conversationId });

      // Prepare source options
      const sendOpts = { ...opts };
      // Map chat mode to backend context_type enum
      // Use component state only — no global localStorage that persists across conversations
      if (this.chatMode === 'agentic') {
        sendOpts.contextType = 'agentic_mode';
      } else if (this.chatMode === 'document') {
        sendOpts.contextType = 'document_chat';
        // Auto-include pinned documents as attachments in document chat mode
        if (this._documents && this._documents.length > 0 && !sendOpts.attachments) {
          sendOpts.attachments = {
            files: this._documents.map(d => ({ file_id: d.id, name: d.filename || d.name }))
          };
        }
      } else if (this.chatMode === 'insights') {
        sendOpts.contextType = sendOpts.attachments && sendOpts.attachments.module_context
          ? 'insights_chat'
          : 'data_chat';
      }
      // Explicit contextType prop takes precedence
      if (this.contextType && !sendOpts.contextType) sendOpts.contextType = this.contextType;
      if (this.matterId) sendOpts.matterId = this.matterId;

      // Fire-and-forget JIT processing for any #filename mentions
      this._processMessageMentions(content);

      // Connect if needed
      if (!this._source.connected) {
        await this._source.connect(this.conversationId);
      }

      let responseStarted = false;
      this._agenticBlockedReceived = false;

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
        this.emit('lex-chat-error', { error: err.message, type: 'send', status: err.status || null });
      }

      // Finalize
      if (this._activityEl) this._activityEl.hide();
      if (this._composerEl) this._composerEl.setGenerating(false);

      // Suppress fallback when the stream intentionally yielded a plan card or
      // blocked-state event instead of streaming content.
      if (!responseStarted && !this._planReadyReceived && !this._agenticBlockedReceived && this._threadEl) {
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
      this._resetContextMeter();
      this._recoveryNoticeShownForConversation = null;

      if (this._source) {
        await this._source.connect(id);

        // Load chat state (document mode)
        const state = await this._source.loadState();
        if (state) this._updateDocumentState(state);

        // Load history
        const result = await this._source.loadHistory(1, this.maxHistory);
        if (result && result.messages) {
          let lastPersistedMessage = null;
          if (this._threadEl) {
            this._threadEl.clear();
            for (const m of result.messages) {
              lastPersistedMessage = m;
              this._threadEl.addMessage(m.role, m.content, {
                messageId: m.id || m.message_id,
                timestamp: m.timestamp || m.created_at,
                citations: m.citations && m.citations.length > 0 ? m.citations : undefined,
                artifacts: m.artifacts && m.artifacts.length > 0 ? m.artifacts : undefined,
                duration: m.duration || null,
                tokenCount: m.tokenCount || null
              });

              // Re-hydrate dynamic cards from persisted message metadata.
              // LexDynamicCardRenderer is loaded before lex-chat.js in every
              // HTML page so it is guaranteed to be present here.
              if (m.metadata && Array.isArray(m.metadata.dynamic_cards) &&
                  this._threadEl._container &&
                  global.LexDynamicCardRenderer) {
                for (var _ci = 0; _ci < m.metadata.dynamic_cards.length; _ci++) {
                  global.LexDynamicCardRenderer.renderCard(
                    m.metadata.dynamic_cards[_ci],
                    this._threadEl._container
                  );
                }
              }
            }

            // Batch-refresh card states after all messages are rendered so
            // cards reflect their real current state (e.g. approved) rather
            // than the state that was saved when the message was persisted.
            if (global.LexDynamicCardRenderer) {
              var _allDescriptors = [];
              for (var _mi = 0; _mi < result.messages.length; _mi++) {
                var _msg = result.messages[_mi];
                if (_msg.metadata && Array.isArray(_msg.metadata.dynamic_cards)) {
                  for (var _di = 0; _di < _msg.metadata.dynamic_cards.length; _di++) {
                    _allDescriptors.push(_msg.metadata.dynamic_cards[_di]);
                  }
                }
              }

              if (_allDescriptors.length > 0) {
                global.LexDynamicCardRenderer.refreshCardStates(_allDescriptors)
                  .then(function (states) {
                    // Apply refreshed states to already-rendered card elements
                    var stateKeys = Object.keys(states);
                    for (var _ki = 0; _ki < stateKeys.length; _ki++) {
                      var _cardId = stateKeys[_ki];
                      var _cardEl = document.querySelector('[card-id="' + _cardId + '"]');
                      if (_cardEl && states[_cardId]) {
                        _cardEl.setAttribute('status', states[_cardId]);
                      }
                    }
                  })
                  .catch(function (err) {
                    console.warn('[lex-chat] Dynamic card state refresh failed:', err && err.message);
                  });
              }
            }

            this._threadEl.scrollToBottom(true);
          }
          if (this._threadEl) {
            this._threadEl.hasMore = result.hasMore || false;
          }
        }

        // Detect a generation already in flight for this conversation
        // (e.g. started in another tab/device). Host pages can listen for
        // `lex-chat-generation-active` and render their own banner.
        try {
          const status = await this._source.checkActiveGeneration(id);
          if (status && status.active) {
            this._showPendingGenerationRecovery(lastPersistedMessage, { activeGeneration: true });
            this.dispatchEvent(new CustomEvent('lex-chat-generation-active', {
              bubbles: true,
              composed: true,
              detail: { conversationId: id, ...status }
            }));
          } else {
            this._showPendingGenerationRecovery(lastPersistedMessage, { activeGeneration: false });
          }
        } catch (_) { /* best-effort */ }
      }
    }

    /**
     * Check whether a generation is already running on the current
     * conversation. Returns the status payload from the backend.
     */
    async checkActiveGeneration(conversationId) {
      if (!this._source) return { active: false };
      return await this._source.checkActiveGeneration(
        conversationId || this.conversationId
      );
    }

    /**
     * Clear the conversation.
     */
    clearConversation() {
      this._props.conversationId = null;
      this._citations = [];
      this._artifacts = [];
      this._resetContextMeter();
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
          if (event.threadId) {
            var isNew = !this.conversationId || this.conversationId !== event.threadId || !this._conversationRegistered;
            this._props.conversationId = event.threadId;
            if (isNew) {
              this._conversationRegistered = true;
              this.emit('lex-chat-conversation-created', { conversationId: event.threadId });
            }
          }
          // Capture backend-resolved matter ID early (before handler runs)
          if (event.matterId && !this.matterId) {
            this._props.matterId = event.matterId;
            // Propagate to the composer so subsequent @-mention searches
            // include matter contacts. (The initial render forwarded
            // whatever matter id was set at mount time; this catches the
            // case where the matter is resolved by the backend mid-turn.)
            if (this._composerEl) this._composerEl.matterId = event.matterId;
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

        case 'tool_start':
        case 'tool_call_starting':
          // Show the humanized tool phrase on the small primary line ABOVE
          // the main "Working..." label. The main label intentionally never
          // changes mid-turn — only the primary moves — so the bar stays
          // calm while multiple tools chain.
          if (this._activityEl) {
            const toolName = event.toolName || event.tool || '';
            const primary = humanizeToolStart(toolName, event.params);
            this._activityEl.show({
              primary: primary || (toolName ? `Running ${toolName}…` : ''),
              message: 'Working...',
              phase: ''
            });
          }
          break;

        case 'tool_progress':
          // Prefer the server-supplied friendly progress string (e.g.
          // "Looking up matter documents…"). If the server didn't send
          // one, leave the existing primary line in place.
          if (this._activityEl) {
            const progressMsg = String(event.message || '').trim();
            if (progressMsg) {
              this._activityEl.update({
                primary: progressMsg,
                message: 'Working...',
                phase: ''
              });
            }
          }
          break;

        case 'tool_end':
        case 'tool_call_complete':
          // Tool finished: clear the primary line and keep the main
          // "Working..." label so the next tool's start can take over.
          // We deliberately don't surface the result summary here — the
          // model writes its own summary through the `content` stream.
          if (this._activityEl) {
            this._activityEl.update({
              primary: '',
              message: 'Working...',
              phase: ''
            });
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
          this._updateContextMeter(event.percentUsed, event.percentUntilCompact);
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

        case 'plan_ready':
          // Backend generated a plan that requires user approval before execution.
          // Hide the activity indicator and insert a plan card into the thread.
          // Mark flag so the "No response received" fallback is suppressed.
          this._planReadyReceived = true;
          if (this._activityEl) this._activityEl.hide();
          this._insertPlanCard(event);
          break;

        case 'agentic_complete':
          if (event.artifacts) {
            this._artifacts = Chat.ArtifactPromotion
              ? Chat.ArtifactPromotion.mergeArtifacts(this._artifacts, event.artifacts)
              : this._artifacts.concat(event.artifacts);
          }
          this.emit('lex-chat-artifacts', { artifacts: event.artifacts || [] });
          break;

        case 'agentic_error':
          if (this._activityEl) this._activityEl.hide();
          this.emit('lex-chat-error', { error: event.error, type: 'agentic' });
          break;

        case 'agentic_blocked':
          this._agenticBlockedReceived = true;
          if (this._activityEl) this._activityEl.hide();
          this.emit('lex-chat-agentic-blocked', {
            error: event.error,
            message: event.message,
            status: event.status,
            failureClass: event.failureClass,
            failureReason: event.failureReason,
            suggestedFollowups: event.suggestedFollowups || []
          });
          if (event.suggestedFollowups && event.suggestedFollowups.length > 0) {
            this.emit('lex-chat-agentic-followup', {
              followups: event.suggestedFollowups,
              message: 'Here are suggested follow-up actions you may want me to take next:',
              matterId: null,
              options: []
            });
          }
          break;

        case 'agentic_followup':
          this.emit('lex-chat-agentic-followup', {
            followups: event.followups,
            message: event.message,
            matterId: event.matterId,
            options: event.options
          });
          break;

        case 'agentic_artifacts':
          if (event.artifacts) {
            this._artifacts = Chat.ArtifactPromotion
              ? Chat.ArtifactPromotion.mergeArtifacts(this._artifacts, event.artifacts)
              : this._artifacts.concat(event.artifacts);
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
          this.emit('lex-chat-auto-compact-start', {
            messagesToSummarize: event.messagesToSummarize || null
          });
          break;

        case 'auto_compact_complete':
          this.emit('lex-chat-auto-compact-complete', {
            newPercentUsed: event.newPercentUsed,
            tokensSaved: event.tokensSaved || null,
            durationMs: event.durationMs || null
          });
          this.emit('lex-chat-context-usage', {
            percentUsed: event.newPercentUsed,
            tokensUsed: null,
            percentUntilCompact: null
          });
          break;

        case 'done':
          // Finalize the streaming message
          if (this._threadEl) {
            const duration = event.processingTimeMs || (this._sendStartTime ? Date.now() - this._sendStartTime : null);
            this._threadEl.finalizeLastMessage({
              messageId: event.messageId,
              duration,
              tokenCount: event.tokenCount || null,
              citations: this._citations.length > 0 ? this._citations : undefined,
              artifacts: this._artifacts.length > 0 ? this._artifacts : undefined,
              grounding: this._groundingContext || undefined
            });
          }

          // Capture conversation ID from done event (fallback)
          if (event.threadId && !this.conversationId) {
            this._props.conversationId = event.threadId;
            this.emit('lex-chat-conversation-created', { conversationId: event.threadId });
          }

          // Capture backend-resolved matter ID (e.g. resolved from attachment file)
          // This ensures subsequent messages include the correct matter_id
          if (event.matterId && !this.matterId) {
            this._props.matterId = event.matterId;
            if (this._composerEl) this._composerEl.matterId = event.matterId;
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

        case 'grounding_context':
          // Keep the latest (post-tool) grounding context; backend emits multiple per response
          this._groundingContext = event;
          break;

        case 'block_hints':
          // Store intent hints for schema selection on next turn
          if (global.Lex.Orchestrator) {
            global.Lex.Orchestrator.setIntentHints(event.intent, event.blocks);
          }
          this.emit('lex-chat-block-hints', { intent: event.intent, blocks: event.blocks });
          break;

        case 'error':
          if (this._activityEl) this._activityEl.hide();
          if (event.status === 401) {
            this._showSystemMessage('Session expired. Please log in again.');
          } else {
            this._showSystemMessage('Error: ' + (event.error || 'Unknown error'));
          }
          this.emit('lex-chat-error', {
            error: event.error,
            type: 'stream',
            status: event.status || null
          });
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

    /**
     * Insert a lex-agentic-plan-card into the thread container.
     * Called when the backend emits a `plan_ready` SSE event.
     * The card handles its own Approve / Cancel API calls.
     *
     * @param {Object} event - { approval_id, plan, message }
     */
    /**
     * Insert any web component into the chat stream.
     * Generic mechanism for injecting dynamic UI (plan cards, artifact
     * previews, approval prompts, progress trackers, etc.) without
     * hardcoding per-feature insertion logic.
     *
     * @param {string} tagName - Custom element tag (e.g. 'lex-agentic-plan-card')
     * @param {Object} [attributes] - String attributes to set via setAttribute
     * @param {Object} [properties] - JS properties to assign directly (for complex objects)
     * @param {string} [eventName] - Optional event to emit after insertion
     * @param {Object} [eventDetail] - Optional event detail payload
     * @returns {HTMLElement|null} The inserted element, or null if container not available
     */
    insertComponent(tagName, attributes, properties, eventName, eventDetail) {
      if (!this._threadEl || !this._threadEl._container) return null;

      // Hide welcome screen if present (mirrors addMessage behaviour)
      const welcome = this._threadEl._container.querySelector('.lex-chat-welcome');
      if (welcome) welcome.remove();

      const el = document.createElement(tagName);

      // Set string attributes
      if (attributes) {
        var attrKeys = Object.keys(attributes);
        for (var i = 0; i < attrKeys.length; i++) {
          if (attributes[attrKeys[i]] != null) {
            el.setAttribute(attrKeys[i], String(attributes[attrKeys[i]]));
          }
        }
      }

      // Set JS properties (for complex objects like plan data)
      if (properties) {
        var propKeys = Object.keys(properties);
        for (var j = 0; j < propKeys.length; j++) {
          el[propKeys[j]] = properties[propKeys[j]];
        }
      }

      this._threadEl._container.appendChild(el);

      // Scroll into view
      if (this._threadEl._isNearBottom && this._threadEl._isNearBottom()) {
        this._threadEl.scrollToBottom();
      }

      // Emit event if specified
      if (eventName) {
        this.emit(eventName, eventDetail || {});
      }

      return el;
    }

    _insertPlanCard(event) {
      if (!this._threadEl || !this._threadEl._container) return;

      // Remove the welcome placeholder if it is still visible
      var welcome = this._threadEl._container.querySelector('.lex-chat-welcome');
      if (welcome) welcome.remove();

      if (event.card && global.LexDynamicCardRenderer) {
        // Preferred path: backend sent a full card descriptor in the SSE event.
        // The renderer handles element creation, props, data, and actions.
        global.LexDynamicCardRenderer.renderCard(event.card, this._threadEl._container);
      } else {
        // Backward-compat fallback: build a minimal descriptor from the legacy
        // event fields so old-format SSE events still render a card.
        var fallbackDescriptor = {
          type: 'lex-agentic-plan-card',
          card_id: 'plan_' + event.approval_id,
          state: 'pending',
          props: { 'approval-id': event.approval_id, status: 'pending' },
          data: { plan: event.plan },
          actions: []
        };

        if (global.LexDynamicCardRenderer) {
          global.LexDynamicCardRenderer.renderCard(fallbackDescriptor, this._threadEl._container);
        } else {
          // Last resort: original insertComponent path
          this.insertComponent(
            'lex-agentic-plan-card',
            { 'approval-id': event.approval_id, status: 'pending' },
            { plan: event.plan },
            null,
            null
          );
        }
      }

      if (this._threadEl._isNearBottom && this._threadEl._isNearBottom()) {
        this._threadEl.scrollToBottom();
      }

      this.emit('lex-chat-plan-ready', {
        approvalId: event.approval_id,
        plan: event.plan,
        message: event.message
      });
    }

    _showSystemMessage(msg) {
      if (this._threadEl) {
        this._threadEl.addSystemMessage(msg);
      }
    }

    _showPendingGenerationRecovery(lastMessage, options = {}) {
      const { activeGeneration = false } = options;
      if (!this._threadEl || !lastMessage || lastMessage.role !== 'user') return;
      if (this._recoveryNoticeShownForConversation === this.conversationId) return;

      this._recoveryNoticeShownForConversation = this.conversationId;

      if (activeGeneration) {
        if (this._activityEl) {
          this._activityEl.clearReasoning();
          this._activityEl.show('LANA is generating a response…', 'thinking');
        }
        if (this._composerEl) {
          this._composerEl.setGenerating(true);
        }
        this._showSystemMessage('LANA was still generating a response when this page loaded. Keep this conversation open for a moment or resend the last message if nothing appears.');
        return;
      }

      this._showSystemMessage('The last user message does not have a saved assistant response yet. The previous generation may have been interrupted by a refresh. Resend the message to retry.');
    }

    // ---------------------------------------------------------------------------
    // JIT document processing
    // ---------------------------------------------------------------------------

    _jitCallbacks() {
      return {
        onReady: (filename) => this._showSystemMessage(`Document "${filename}" is ready for use`),
        onError: (filename, err) => {
          const reason = err && err.message ? ': ' + err.message : '';
          this._showSystemMessage(`Failed to prepare "${filename}"${reason}`);
        }
      };
    }

    _ensureDocumentProcessed(documentId, filename) {
      const svc = global.DocumentProcessingService;
      if (!svc) return;
      svc.ensureReadyBackground(documentId, filename, this._jitCallbacks());
    }

    _processMessageMentions(content) {
      const svc = global.DocumentProcessingService;
      if (!svc) return;
      const docs = (this._documents || []).concat(this._getAvailableDocuments());
      if (docs.length === 0) return;
      svc.processMessageMentions(content, docs, this._jitCallbacks());
    }

    _getAvailableDocuments() {
      if (global.ChatFileDrawer && typeof global.ChatFileDrawer.getMentionItems === 'function') {
        return global.ChatFileDrawer.getMentionItems() || [];
      }
      return [];
    }

    // ---------------------------------------------------------------------------
    // Default citation click — open document at cited page
    // ---------------------------------------------------------------------------

    async _openCitationDocument(detail) {
      const docId = detail && detail.documentId;
      if (!docId) return;

      const page = detail.page || 1;

      try {
        const apiClient = global.api;
        if (!apiClient || typeof apiClient.get !== 'function') {
          throw new Error('API client not available');
        }

        const resp = await fetch(
          apiClient.baseUrl + '/api/v1/documents/' + encodeURIComponent(docId) + '/download',
          { headers: { 'Authorization': 'Bearer ' + (apiClient.token || localStorage.getItem('token') || '') } }
        );

        if (!resp.ok) throw new Error('Download failed: ' + resp.status);

        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl + '#page=' + page, '_blank');

        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      } catch (err) {
        console.error('[lex-chat] Citation document open failed:', err);
        this._showSystemMessage('Could not open document. Please try again.');
      }
    }

    // ---------------------------------------------------------------------------
    // Context meter — shows token usage above the composer
    // ---------------------------------------------------------------------------

    _updateContextMeter(percentUsed, percentUntilCompact) {
      if (!this._contextMeterEl) return;
      const available = Math.max(0, 100 - (percentUsed || 0));
      const fill = this._contextMeterEl.querySelector('.lex-chat-context-meter-fill');
      const text = this._contextMeterEl.querySelector('.lex-chat-context-meter-text');

      if (fill) {
        fill.style.width = (percentUsed || 0) + '%';
        fill.removeAttribute('data-warn');
        fill.removeAttribute('data-danger');
        if (percentUsed >= 90) fill.setAttribute('data-danger', '');
        else if (percentUsed >= 75) fill.setAttribute('data-warn', '');
      }
      if (text) {
        text.textContent = percentUntilCompact != null
          ? `Context available: ${available}% (${percentUntilCompact}% until auto-compact)`
          : `Context available: ${available}%`;
      }
      this._contextMeterEl.style.display = '';

      // Warning fires when the bar turns red (90%) — aligned with the visual danger state.
      if (percentUsed >= 90 && !this._contextWarningShown) {
        this._contextWarningShown = true;
        this._showSystemMessage('Conversation getting long. Consider starting a new chat for best results.');
      }
    }

    _resetContextMeter() {
      if (!this._contextMeterEl) return;
      this._contextMeterEl.style.display = 'none';
      this._contextWarningShown = false;
      const fill = this._contextMeterEl.querySelector('.lex-chat-context-meter-fill');
      if (fill) {
        fill.style.width = '0%';
        fill.removeAttribute('data-warn');
        fill.removeAttribute('data-danger');
      }
      const text = this._contextMeterEl.querySelector('.lex-chat-context-meter-text');
      if (text) text.textContent = '';
    }

    async _loadMoreHistory() {
      if (!this._source || !this.conversationId) return;
      if (!this._threadEl || !this._threadEl.hasMore) return;
      if (this._loadingMore) return;

      this._loadingMore = true;
      this._currentPage = (this._currentPage || 1) + 1;

      try {
        const result = await this._source.loadHistory(this._currentPage, this.maxHistory);

        if (result && result.messages && result.messages.length > 0) {
          // Format messages for prependMessages — expects [{ role, content, messageId, timestamp }]
          const formatted = result.messages.map(function (m) {
            return {
              role: m.role,
              content: m.content,
              messageId: m.id,
              timestamp: m.timestamp,
              citations: m.citations,
              artifacts: m.artifacts,
              duration: m.duration || null,
              tokenCount: m.tokenCount || null
            };
          });
          this._threadEl.prependMessages(formatted);
          this._threadEl.hasMore = result.hasMore || false;
        } else {
          this._threadEl.hasMore = false;
        }
      } catch (err) {
        console.error('[lex-chat] Failed to load more history:', err);
      } finally {
        this._loadingMore = false;
      }
    }

    disconnected() {
      if (this._bridge) {
        this._bridge.detach();
        this._bridge = null;
      }
      if (this._source) {
        this._source.disconnect();
      }
    }
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChat = LexChat;

})(typeof window !== 'undefined' ? window : globalThis);
