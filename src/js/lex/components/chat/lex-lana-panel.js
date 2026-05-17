/* ==========================================================================
   Lex UI — LANA Panel
   Unified Ask LANA chat panel component.
   Hosts lex-chat-threads + lex-chat with all lifecycle wiring built in.
   Works in two modes: column (inline) or drawer (overlay).

   Usage:
     <!-- Column mode (inline, hidden by default) -->
     <lex-lana-panel
       id="wsDataLana"
       mode="column"
       page-scope="workspace_data"
       context-type="full_chat"
       matter-id=""
       placeholder="Ask about this workspace data..."
       composer-tools='[{"id":"insights_chat","label":"Insights"}]'
       tools-locked="false"
       thread-title="Workspace Data"
       column-heading="LANA Assistant"
       column-subtitle="Query data insights or create tasks"
       width="380"
     ></lex-lana-panel>

     <!-- Drawer mode -->
     <lex-lana-panel
       id="fileViewerLana"
       mode="drawer"
       drawer-heading="LANA — Document Chat"
       drawer-width="lg"
       page-scope="workspace"
       context-type="document_chat"
       placeholder="Ask about this document..."
       tools-locked="true"
       default-tool="document_chat"
       thread-title="Document Chat"
     ></lex-lana-panel>

   Events (all bubble + compose):
     lex-lana-opened        — Panel became visible
     lex-lana-closed        — Panel hidden
     lex-lana-before-send   — Before lex-chat.send(); page mutates opts.attachments.
                              Call e.preventDefault() to take over send manually.
     lex-lana-thread-created — Thread registered via API
     lex-lana-thread-selected — User selected a thread
     lex-lana-tool-select   — Composer tool selected (detail: { toolId })
     lex-lana-tool-dismiss  — Composer tool dismissed (detail: { toolId })

   Public methods:
     show() / hide() / toggle()
     createThread(config) → Promise<thread>
     sendMessage(content, opts) → calls internal lex-chat.send()
     setContextType(type)
     bindConversationId(id, opts?) — opts: { title, matterId }
     addDocument(fileId, filename, matterId) → Promise
     attachFile(fileId, filename) — visual badge only
   ========================================================================== */

(function () {
  'use strict';

  var Lex = window.Lex;
  if (!Lex || !Lex.LexElement) { console.error('[lex-lana-panel] LexElement not loaded'); return; }

  var LexElement = Lex.LexElement;
  var defineLex = Lex.defineLex;

  // ─── Constants ────────────────────────────────────────────────────────
  var CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var style = document.createElement('style');
    style.id = 'lex-lana-panel-styles';
    style.textContent = ''
      /* ── Column mode ───────────────────────────────── */
      + 'lex-lana-panel[mode="column"] {'
      + '  display: none;'
      + '  flex-direction: column;'
      + '  flex-shrink: 0;'
      + '  overflow: hidden;'
      + '  background: var(--lex-surface-primary, #fff);'
      + '  border-left: 1px solid var(--lex-border-default, #e5e7eb);'
      + '}'
      + 'lex-lana-panel[mode="column"][open] {'
      + '  display: flex;'
      + '}'

      /* ── Column header ─────────────────────────────── */
      + ' .llp-col-header {'
      + '   padding: 0.75rem 1rem;'
      + '   border-bottom: 1px solid var(--lex-border-default, #e5e7eb);'
      + '   display: flex;'
      + '   align-items: center;'
      + '   justify-content: space-between;'
      + '   flex-shrink: 0;'
      + ' }'
      + ' .llp-col-title {'
      + '   font-size: 13px;'
      + '   font-weight: 600;'
      + '   color: var(--lex-text-primary, #111827);'
      + '   margin: 0;'
      + ' }'
      + ' .llp-col-subtitle {'
      + '   font-size: 11px;'
      + '   color: var(--lex-text-secondary, #6b7280);'
      + '   margin: 0.25rem 0 0;'
      + ' }'
      + ' .llp-close-btn {'
      + '   background: none;'
      + '   border: none;'
      + '   cursor: pointer;'
      + '   padding: 4px;'
      + '   color: var(--lex-text-tertiary, #9ca3af);'
      + '   border-radius: 4px;'
      + '   transition: color 0.15s;'
      + ' }'
      + ' .llp-close-btn:hover {'
      + '   color: var(--lex-text-primary, #111827);'
      + ' }'

      /* ── Chat container ────────────────────────────── */
      + ' .llp-chat-container {'
      + '   flex: 1;'
      + '   display: flex;'
      + '   flex-direction: column;'
      + '   min-height: 0;'
      + '   overflow: hidden;'
      + ' }'

      /* ── Drawer mode — component itself is invisible ─ */
      + ' lex-lana-panel[mode="drawer"] {'
      + '   display: none;'
      + ' }';

    document.head.appendChild(style);
  }

  // ─── Component ──────────────────────────────────────────────────────────

  class LexLanaPanel extends LexElement {

    static get properties() {
      return {
        mode:           { type: String, default: 'drawer' },
        pageScope:      { type: String, default: '', attribute: 'page-scope' },
        contextType:    { type: String, default: 'full_chat', attribute: 'context-type' },
        matterId:       { type: String, default: '', attribute: 'matter-id' },
        placeholder:    { type: String, default: 'Ask LANA...' },
        composerTools:  { type: Array, default: [], attribute: 'composer-tools' },
        toolsLocked:    { type: Boolean, default: false, attribute: 'tools-locked' },
        defaultTool:    { type: String, default: '', attribute: 'default-tool' },
        threadTitle:    { type: String, default: 'LANA Chat', attribute: 'thread-title' },
        drawerHeading:  { type: String, default: 'LANA Assistant', attribute: 'drawer-heading' },
        drawerWidth:    { type: String, default: 'lg', attribute: 'drawer-width' },
        width:          { type: Number, default: 380 },
        columnHeading:  { type: String, default: 'LANA Assistant', attribute: 'column-heading' },
        columnSubtitle: { type: String, default: '', attribute: 'column-subtitle' },
        open:           { type: Boolean, default: false, reflect: true },
        destroyOnClose: { type: Boolean, default: false, attribute: 'destroy-on-close' }
      };
    }

    constructor() {
      super();
      this._chatEl = null;
      this._threadsEl = null;
      this._drawerEl = null;
      this._container = null;
      this._originalSend = null;
      this._chatReady = false;
    }

    connected() {
      injectStyles();
      if (this.mode === 'column') {
        this.style.width = this.width + 'px';
      }
    }

    // Return null — we build DOM imperatively to avoid re-render issues
    render() { return null; }

    // =====================================================================
    //  Public API
    // =====================================================================

    show() {
      if (this._props.open) return;
      this._props.open = true;
      this._reflectToAttribute('open', true);

      if (this.mode === 'drawer') {
        this._openDrawer();
      }
      // Column mode: [open] attribute triggers CSS display:flex

      // Build chat components on first open
      if (!this._chatReady) {
        this._buildChat();
      }

      // Focus composer after visible
      var self = this;
      setTimeout(function () { self._focusComposer(); }, 200);

      this.emit('lex-lana-opened', {});
    }

    hide() {
      if (!this._props.open) return;
      this._props.open = false;
      this._reflectToAttribute('open', false);

      if (this.mode === 'drawer') {
        this._closeDrawer();
      }

      this.emit('lex-lana-closed', {});
    }

    toggle() {
      if (this._props.open) {
        this.hide();
      } else {
        this.show();
      }
    }

    /**
     * Create a typed thread (e.g. report_run) and navigate chat to it.
     * @param {Object} config - { title, thread_type, context_type, page_scope, metadata }
     * @returns {Promise<Object>} The created thread object
     */
    createThread(config) {
      var self = this;
      if (typeof api === 'undefined') return Promise.reject(new Error('api not available'));

      // Default the matter_id from the panel's bound matter context when the
      // caller didn't supply one. Without this, threads created from a
      // matter page get persisted without a matter_id and disappear from the
      // matter-scoped fetch (?matter_id=…).
      var payload = Object.assign({}, config || {});
      if (!payload.matter_id && self.matterId) {
        payload.matter_id = self.matterId;
      }

      return api.post('/api/v1/conversation-threads', payload).then(function (resp) {
        var thread = resp.data || resp;

        if (self._threadsEl) {
          self._threadsEl.addThread(thread);
          self._threadsEl.setActiveThread(thread.id);
        }
        if (self._chatEl) {
          self._chatEl.clearConversation();
          if (thread.thread_id) {
            self._chatEl.loadConversation(thread.thread_id);
          }
        }

        self.emit('lex-lana-thread-created', { thread: thread });
        return thread;
      });
    }

    /**
     * Send a message into the internal lex-chat (bypasses before-send event).
     */
    sendMessage(content, opts) {
      if (this._originalSend) {
        return this._originalSend.call(this._chatEl, content, opts);
      }
      if (this._chatEl && typeof this._chatEl.send === 'function') {
        return this._chatEl.send(content, opts);
      }
    }

    /**
     * Dynamically change the context-type on the internal lex-chat.
     */
    setContextType(type) {
      this._props.contextType = type;
      if (this._chatEl) {
        this._chatEl.setAttribute('context-type', type);
      }
    }

    /**
     * Bind a pre-created conversation ID to the internal lex-chat.
     * Used for session bootstrapping (e.g. file-viewer).
     * Also registers a conversation-thread record so the thread appears in the panel list.
     * @param {string} id - The conversation/thread UUID
     * @param {Object} [opts] - Optional overrides { title, matterId }
     */
    bindConversationId(id, opts) {
      if (!this._chatEl) return;
      opts = opts || {};
      this._chatEl._props.conversationId = id;
      if (this._chatEl._source) {
        this._chatEl._source._conversationId = id;
      }

      // Also set matter-id on the chat element if provided
      if (opts.matterId) {
        this._chatEl._props.matterId = opts.matterId;
        this._chatEl.setAttribute('matter-id', opts.matterId);
      }

      // Register thread so it appears in the panel's thread list
      var self = this;
      var threadTitle = opts.title || this.threadTitle;

      // Add to sidebar conversation menu
      if (window.ConversationMenu && typeof window.ConversationMenu.addConversation === 'function') {
        window.ConversationMenu.addConversation({
          thread_id: id,
          title: threadTitle,
          matter_id: opts.matterId || self.matterId || undefined,
          updated_at: new Date().toISOString()
        });
      }

      // Create conversation-thread record in backend + add to threads component.
      // Include matter_id so the thread shows up in the matter-scoped fetch
      // (?matter_id=…); without it, threads vanish from per-matter views.
      if (typeof api !== 'undefined') {
        var boundMatterId = (opts && opts.matterId) || self.matterId || null;
        var threadPayload = {
          title: threadTitle,
          thread_type: 'page_general',
          context_type: self.contextType,
          page_scope: self.pageScope,
          thread_id: id
        };
        if (boundMatterId) threadPayload.matter_id = boundMatterId;
        api.post('/api/v1/conversation-threads', threadPayload).then(function (resp) {
          var created = resp.data || resp;
          if (self._threadsEl) {
            self._threadsEl.addThread(created);
            self._threadsEl.setActiveThread(created.id);
          }
        }).catch(function (err) {
          console.warn('[lex-lana-panel] Failed to register bound thread:', err);
        });
      }
    }

    /**
     * Register a document in the chat state (delegates to lex-chat).
     */
    addDocument(fileId, filename, matterId) {
      if (this._chatEl && typeof this._chatEl.addDocument === 'function') {
        return this._chatEl.addDocument(fileId, filename, matterId);
      }
      return Promise.resolve();
    }

    /**
     * Show a file as an attachment badge in the composer.
     * Does NOT register with backend — purely visual.
     * Call after show() so the chat is built.
     */
    attachFile(fileId, filename) {
      var self = this;
      // Composer may not be ready immediately — retry briefly
      function tryAttach(attempts) {
        if (!self._chatEl) return;
        var composer = self._chatEl.querySelector('lex-chat-composer');
        if (composer && typeof composer.attachDocument === 'function') {
          composer.attachDocument(fileId, filename);
        } else if (attempts > 0) {
          setTimeout(function () { tryAttach(attempts - 1); }, 100);
        }
      }
      tryAttach(5);
    }

    attachModuleContext(moduleContext) {
      var self = this;
      function tryAttach(attempts) {
        if (!self._chatEl) return;
        var composer = self._chatEl.querySelector('lex-chat-composer');
        if (composer && typeof composer.attachModuleContext === 'function') {
          composer.attachModuleContext(moduleContext);
        } else if (attempts > 0) {
          setTimeout(function () { tryAttach(attempts - 1); }, 100);
        }
      }
      tryAttach(5);
    }

    clearModuleContext() {
      if (!this._chatEl) return null;
      var composer = this._chatEl.querySelector('lex-chat-composer');
      if (composer && typeof composer.clearModuleContext === 'function') {
        return composer.clearModuleContext();
      }
      return null;
    }

    /**
     * Get reference to internal lex-chat (escape hatch for advanced use).
     */
    getChatElement() {
      return this._chatEl;
    }

    // =====================================================================
    //  Internal — Build Chat
    // =====================================================================

    _buildChat() {
      if (this._chatReady) return;
      this._chatReady = true;

      var container;

      if (this.mode === 'column') {
        container = this._buildColumnDOM();
      } else {
        // Drawer mode — container is inside the drawer wrapper
        container = this._getOrCreateDrawerContent();
      }

      if (!container) return;
      this._container = container;

      // Create lex-chat-threads
      var threads = document.createElement('lex-chat-threads');
      threads.setAttribute('page-scope', this.pageScope);
      threads.setAttribute('context-type', this.contextType);
      if (this.matterId) threads.setAttribute('matter-id', this.matterId);
      threads.style.flexShrink = '0';

      // Create lex-chat
      var chat = document.createElement('lex-chat');
      chat.setAttribute('context-type', this.contextType);
      chat.setAttribute('source', 'sse');
      if (this.matterId) chat.setAttribute('matter-id', this.matterId);
      chat.setAttribute('placeholder', this.placeholder);
      chat.style.flex = '1';
      chat.style.minHeight = '0';
      chat.style.overflow = 'hidden';

      container.appendChild(threads);
      container.appendChild(chat);

      // Re-acquire live refs after potential cloning by parent components
      var liveChat = container.querySelector('lex-chat');
      var liveThreads = container.querySelector('lex-chat-threads');
      this._chatEl = liveChat || chat;
      this._threadsEl = liveThreads || threads;

      // Ensure styles after cloning
      this._threadsEl.style.flexShrink = '0';
      this._chatEl.style.flex = '1';
      this._chatEl.style.minHeight = '0';
      this._chatEl.style.overflow = 'hidden';

      this._wireInternalEvents(container);
      this._wrapSend();

      // Configure composer after lex-chat upgrades its children
      var self = this;
      setTimeout(function () { self._configureComposer(); }, 200);
    }

    _buildColumnDOM() {
      // Column header + chat container
      var header = document.createElement('div');
      header.className = 'llp-col-header';

      var titleDiv = document.createElement('div');
      var h = document.createElement('p');
      h.className = 'llp-col-title';
      h.textContent = this.columnHeading;
      titleDiv.appendChild(h);

      if (this.columnSubtitle) {
        var sub = document.createElement('p');
        sub.className = 'llp-col-subtitle';
        sub.textContent = this.columnSubtitle;
        titleDiv.appendChild(sub);
      }

      var closeBtn = document.createElement('button');
      closeBtn.className = 'llp-close-btn';
      closeBtn.title = 'Close chat';
      closeBtn.innerHTML = CLOSE_SVG;
      var self = this;
      closeBtn.addEventListener('click', function () { self.hide(); });

      header.appendChild(titleDiv);
      header.appendChild(closeBtn);
      this.appendChild(header);

      var container = document.createElement('div');
      container.className = 'llp-chat-container';
      this.appendChild(container);

      return container;
    }

    // =====================================================================
    //  Internal — Drawer Management
    // =====================================================================

    _openDrawer() {
      if (this._drawerEl) {
        this._drawerEl.setAttribute('open', 'true');
        return;
      }

      var drawer = document.createElement('lex-drawer');
      drawer.setAttribute('heading', this.drawerHeading);
      drawer.setAttribute('side', 'right');
      drawer.setAttribute('width', this.drawerWidth);
      drawer.setAttribute('open', 'true');
      this._drawerEl = drawer;

      // Build chat inside drawer wrapper
      var wrapper = document.createElement('div');
      wrapper.className = 'llp-chat-container';
      wrapper.style.height = '100%';
      drawer.appendChild(wrapper);
      document.body.appendChild(drawer);

      var self = this;
      drawer.addEventListener('lex-close', function () {
        self.hide();
      });
    }

    _closeDrawer() {
      if (!this._drawerEl) return;

      if (this.destroyOnClose) {
        // Disconnect chat source
        if (this._chatEl && this._chatEl.disconnect) {
          this._chatEl.disconnect();
        }
        if (this._drawerEl.parentNode) {
          this._drawerEl.remove();
        }
        this._drawerEl = null;
        this._chatEl = null;
        this._threadsEl = null;
        this._container = null;
        this._originalSend = null;
        this._chatReady = false;
      } else {
        this._drawerEl.setAttribute('open', 'false');
      }
    }

    _getOrCreateDrawerContent() {
      if (!this._drawerEl) return null;
      return this._drawerEl.querySelector('.llp-chat-container');
    }

    // =====================================================================
    //  Internal — Event Wiring
    // =====================================================================

    _wireInternalEvents(container) {
      var self = this;

      // Thread selection
      container.addEventListener('lex-thread-select', function (e) {
        var thread = e.detail && e.detail.thread;
        if (!thread || !self._chatEl) return;
        self._chatEl.clearConversation();
        self._chatEl.loadConversation(thread.thread_id);
        self.emit('lex-lana-thread-selected', { thread: thread });
      });

      // Auto-select page_general thread when loaded
      container.addEventListener('lex-threads-loaded', function (e) {
        var threads = e.detail && e.detail.threads;
        if (!threads || !threads.length || !self._chatEl) return;
        for (var i = 0; i < threads.length; i++) {
          if (threads[i].thread_type === 'page_general' && threads[i].thread_id) {
            self._chatEl.loadConversation(threads[i].thread_id);
            if (self._threadsEl) self._threadsEl.setActiveThread(threads[i].id);
            break;
          }
        }
      });

      // New thread creation — eager. We POST a fresh thread row now so
      // the backend allocates a brand-new thread_id; createThread() then
      // rebinds the chat element (clearConversation + loadConversation)
      // so the SSE source connects to the new conversation. Without
      // this, the source would still be connected to the previously
      // selected thread and the next message would silently append to
      // it (see _wrapSend + lex-chat.source.js).
      container.addEventListener('lex-thread-create', function (e) {
        if (!self._chatEl) return;
        var threadType = (e.detail && e.detail.threadType) || 'ad_hoc';
        self.createThread({
          title: threadType === 'page_general' ? self.threadTitle : 'New Thread',
          thread_type: threadType,
          context_type: self.contextType,
          page_scope: self.pageScope
        }).catch(function (err) {
          console.warn('[lex-lana-panel] Failed to create new thread:', err);
        });
      });

      // Register thread on first conversation
      container.addEventListener('lex-chat-conversation-created', function (e) {
        var conversationId = e.detail && e.detail.conversationId;
        if (!conversationId || typeof api === 'undefined') return;

        // Add to sidebar menu
        if (window.ConversationMenu && typeof window.ConversationMenu.addConversation === 'function') {
          window.ConversationMenu.addConversation({
            thread_id: conversationId,
            title: self.threadTitle,
            matter_id: self.matterId || undefined,
            updated_at: new Date().toISOString()
          });
        }

        // If a thread row already tracks this conversation (e.g. the
        // user just clicked "+ New" and createThread() pre-allocated
        // it), there's nothing to register. Avoids a duplicate POST
        // with an already-taken thread_id, which the backend rejects
        // with a 500.
        if (self._threadsEl && self._threadsEl._threads) {
          for (var k = 0; k < self._threadsEl._threads.length; k++) {
            if (self._threadsEl._threads[k].thread_id === conversationId) {
              self._threadsEl.setActiveThread(self._threadsEl._threads[k].id);
              return;
            }
          }
        }

        // Check if page_general thread already exists
        if (self._threadsEl && self._threadsEl._threads && self._threadsEl._threads.length > 0) {
          for (var i = 0; i < self._threadsEl._threads.length; i++) {
            if (self._threadsEl._threads[i].thread_type === 'page_general') {
              var existing = self._threadsEl._threads[i];
              existing.thread_id = conversationId;
              api.put('/api/v1/conversation-threads/' + existing.id, {
                thread_id: conversationId
              }).catch(function (err) {
                console.warn('[lex-lana-panel] Failed to update thread:', err);
              });
              return;
            }
          }
        }

        // Create new page_general thread. Carry the panel's bound matter_id
        // through so the thread is discoverable via ?matter_id=… filters.
        var generalPayload = {
          title: self.threadTitle,
          thread_type: 'page_general',
          context_type: self.contextType,
          page_scope: self.pageScope,
          thread_id: conversationId
        };
        if (self.matterId) generalPayload.matter_id = self.matterId;
        api.post('/api/v1/conversation-threads', generalPayload).then(function (resp) {
          var created = resp.data || resp;
          if (self._threadsEl) {
            self._threadsEl.addThread(created);
            self._threadsEl.setActiveThread(created.id);
          }
          self.emit('lex-lana-thread-created', { thread: created });
        }).catch(function (err) {
          console.warn('[lex-lana-panel] Failed to register thread:', err);
        });
      });

      // Auto-title arrives over SSE as a 'title' event, which lex-chat
      // re-emits as lex-chat-title-generated. The backend mirrors the
      // generated title into conversation_threads.title at the same time
      // (see conversation.service.updateConversationTitle), so this
      // handler just refreshes the visible row.
      container.addEventListener('lex-chat-title-generated', function (e) {
        var detail = e.detail || {};
        var newTitle = detail.title;
        var conversationId = detail.conversationId;
        if (!newTitle || !conversationId || !self._threadsEl) return;
        var list = self._threadsEl._threads || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].thread_id === conversationId) {
            list[i].title = newTitle;
            self._threadsEl._scheduleUpdate();
            self.emit('lex-lana-thread-renamed', { thread: list[i] });
            break;
          }
        }
      });

      // Re-emit composer tool events
      container.addEventListener('lex-composer-tool-select', function (e) {
        self.emit('lex-lana-tool-select', { toolId: e.detail && e.detail.toolId });
      });
      container.addEventListener('lex-composer-tool-dismiss', function (e) {
        self.emit('lex-lana-tool-dismiss', { toolId: e.detail && e.detail.toolId });
      });
      container.addEventListener('lex-composer-module-context-remove', function (e) {
        self.emit('lex-lana-module-context-remove', e.detail || {});
      });
    }

    // =====================================================================
    //  Internal — Send Interception
    // =====================================================================

    _wrapSend() {
      if (!this._chatEl || typeof this._chatEl.send !== 'function') return;

      var self = this;
      this._originalSend = this._chatEl.send.bind(this._chatEl);

      this._chatEl.send = function (content, opts) {
        opts = opts || {};
        opts.attachments = opts.attachments || {};

        // Emit cancelable before-send event
        var event = new CustomEvent('lex-lana-before-send', {
          detail: { content: content, opts: opts },
          bubbles: true,
          composed: true,
          cancelable: true
        });
        self.dispatchEvent(event);

        // If page called preventDefault(), it takes over send manually
        if (event.defaultPrevented) return;

        return self._originalSend(content, opts);
      };
    }

    // =====================================================================
    //  Internal — Composer Configuration
    // =====================================================================

    _configureComposer() {
      if (!this._chatEl) return;
      var composer = this._chatEl.querySelector('lex-chat-composer');
      if (!composer) return;

      // Hide plus button when tools are locked
      if (this.toolsLocked) {
        var plusBtn = composer.querySelector('[data-plus]');
        if (plusBtn && plusBtn.parentElement) {
          plusBtn.parentElement.style.display = 'none';
        }
      }

      // Set custom tools
      if (this.composerTools && this.composerTools.length > 0) {
        composer.tools = this.composerTools;
      }

      // Pre-select default tool
      if (this.defaultTool && typeof composer.setActiveTools === 'function') {
        composer.setActiveTools([this.defaultTool]);
      } else if (!this.defaultTool && typeof composer.setActiveTools === 'function') {
        composer.setActiveTools([]);
      }

      // Lock tools
      if (this.toolsLocked && typeof composer.setToolsLocked === 'function') {
        composer.setToolsLocked(true);
      }
    }

    _focusComposer() {
      if (!this._chatEl) return;
      var composer = this._chatEl.querySelector('lex-chat-composer');
      if (!composer) return;
      var input = composer.querySelector('textarea, input, [contenteditable]');
      if (input) input.focus();
    }
  }

  defineLex('lex-lana-panel', LexLanaPanel);
})();
