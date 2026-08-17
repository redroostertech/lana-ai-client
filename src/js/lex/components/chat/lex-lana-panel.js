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
       drawer-heading="LANA — Document Context"
       drawer-width="lg"
       page-scope="workspace"
       context-type="document_chat"
       placeholder="Ask about this document..."
       tools-locked="true"
       default-tool="document_chat"
       thread-title="Document Context"
     ></lex-lana-panel>

   Events (all bubble + compose):
     lex-lana-opened        — Panel became visible
     lex-lana-closed        — Panel hidden
     lex-lana-before-send   — Before lex-chat.send(); page mutates opts.attachments.
                              Call e.preventDefault() to take over send manually.
     lex-lana-thread-created — Thread created/registered in the panel list
     lex-lana-thread-selected — User selected a thread
     lex-lana-tool-select   — Composer tool selected (detail: { toolId })
     lex-lana-tool-dismiss  — Composer tool dismissed (detail: { toolId })

   Public methods:
     show() / hide() / toggle()
     createThread(config) → Promise<thread>
     openConversation(threadId, matterId?, opts?) → Promise<thread>
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
  var VALID_PAGE_SCOPES = [
    'reporting',
    'firm_reporting',
    'billable_hours',
    'matter',
    'workspace',
    'workspace_data',
    'dashboard',
    'data_visualization',
    'automations',
    'skills',
    'meeting_recording'
  ];

  function normalizePageScope(pageScope) {
    return VALID_PAGE_SCOPES.indexOf(pageScope) !== -1 ? pageScope : 'dashboard';
  }

  function requireApi() {
    if (typeof api === 'undefined') return null;
    return api;
  }

  function normalizeRegistryThread(row) {
    if (!row || typeof row !== 'object') return row;
    if (!row.conversationId && !row.registryId && !row.conversation_id && !row.registry_id) return row;
    var normalized = Object.assign({}, row);
    if (!normalized.id) normalized.id = row.registryId || row.registry_id || row.conversationId || row.conversation_id;
    if (!normalized.thread_id) normalized.thread_id = row.conversationId || row.conversation_id;
    if (!normalized.thread_type) normalized.thread_type = row.type || 'ad_hoc';
    if (!normalized.matter_id && row.scope) normalized.matter_id = row.scope.matterId || row.scope.matter_id || null;
    return normalized;
  }

  function normalizeRegistryResponse(resp) {
    if (resp && resp.data) {
      return Object.assign({}, resp, { data: normalizeRegistryThread(resp.data) });
    }
    return normalizeRegistryThread(resp);
  }

  function createConversationRegistryEntry(payload) {
    var client = requireApi();
    if (!client) return Promise.reject(new Error('api not available'));
    if (typeof client.createConversationRegistryEntry === 'function') {
      return client.createConversationRegistryEntry(payload).then(normalizeRegistryResponse);
    }
    return Promise.reject(new Error('canonical conversation create API not available'));
  }

  function getConversationRegistryEntry(conversationId) {
    var client = requireApi();
    if (!client || typeof client.getConversation !== 'function') {
      return Promise.resolve(null);
    }
    return client.getConversation(conversationId).then(function (resp) {
      var row = resp && (resp.data || resp.conversation || resp);
      return normalizeRegistryThread(row);
    }).catch(function (err) {
      console.warn('[lex-lana-panel] Failed to hydrate conversation metadata:', err);
      return null;
    });
  }

  function getConversationDocumentCandidates(conversationId, options) {
    var client = requireApi();
    if (!client) return Promise.reject(new Error('api not available'));
    if (Lex.Chat && typeof Lex.Chat.ConversationsApiClient === 'function') {
      return new Lex.Chat.ConversationsApiClient(client).getDocumentCandidates(conversationId, options);
    }
    if (typeof client.getConversationDocumentCandidates === 'function') {
      return client.getConversationDocumentCandidates(conversationId, options);
    }
    return Promise.reject(new Error('canonical conversation document candidates API not available'));
  }

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
      + ' .llp-generation-banner,'
      + ' .llp-compact-banner {'
      + '   display: none;'
      + '   align-items: center;'
      + '   gap: 8px;'
      + '   padding: 8px 12px;'
      + '   font-size: 12px;'
      + '   color: var(--lex-text-secondary, #6b7280);'
      + '   background: var(--lex-surface-secondary, #f9fafb);'
      + '   border-bottom: 1px solid var(--lex-border-subtle, #e5e7eb);'
      + ' }'
      + ' .llp-generation-banner[data-visible="true"],'
      + ' .llp-compact-banner[data-visible="true"] { display: flex; }'
      + ' .llp-banner-spacer { flex: 1; }'
      + ' .llp-banner-stop {'
      + '   border: 1px solid var(--lex-border-default, #e5e7eb);'
      + '   background: var(--lex-surface-primary, #fff);'
      + '   color: var(--lex-text-primary, #111827);'
      + '   border-radius: 6px;'
      + '   padding: 3px 8px;'
      + '   cursor: pointer;'
      + ' }'
      + ' .llp-followups {'
      + '   display: none;'
      + '   flex-wrap: wrap;'
      + '   gap: 6px;'
      + '   padding: 8px 12px;'
      + '   border-top: 1px solid var(--lex-border-subtle, #e5e7eb);'
      + '   background: var(--lex-surface-primary, #fff);'
      + ' }'
      + ' .llp-followups[data-visible="true"] { display: flex; }'
      + ' .llp-followups-label {'
      + '   width: 100%;'
      + '   font-size: 12px;'
      + '   color: var(--lex-text-secondary, #6b7280);'
      + ' }'
      + ' .llp-followup-chip {'
      + '   padding: 5px 10px;'
      + '   font-size: 12px;'
      + '   color: var(--lex-text-primary, #111827);'
      + '   background: var(--lex-surface-secondary, #f3f4f6);'
      + '   border: 1px solid var(--lex-border-default, #e5e7eb);'
      + '   border-radius: 9999px;'
      + '   cursor: pointer;'
      + '   white-space: nowrap;'
      + ' }'
      + ' .llp-followup-chip:hover { background: var(--lex-bg-hover, #e5e7eb); }'

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
        destroyOnClose: { type: Boolean, default: false, attribute: 'destroy-on-close' },
        threadsHeading: { type: String, default: '', attribute: 'threads-heading' },
        threadsRecents: { type: Boolean, default: false, attribute: 'threads-recents' }
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
      this._generationBannerEl = null;
      this._generationDurationEl = null;
      this._generationTimer = null;
      this._compactBannerEl = null;
      this._followupsEl = null;
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
      if (!requireApi()) return Promise.reject(new Error('api not available'));

      // Default the matter_id from the panel's bound matter context when the
      // caller didn't supply one. Without this, threads created from a
      // matter page get persisted without a matter_id and disappear from the
      // matter-scoped fetch (?matter_id=…).
      var payload = Object.assign({}, config || {});
      if (!payload.matter_id && self.matterId) {
        payload.matter_id = self.matterId;
      }

      return createConversationRegistryEntry(payload).then(function (resp) {
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
     * Open an existing canonical conversation inside the shared panel.
     * This is the dock/Recents path for existing conversation links; it
     * reuses the same loadConversation chain
     * as manual thread selection instead of creating a parallel page flow.
     * @param {string} threadId - Durable canonical conversation id.
     * @param {string} [matterId] - Optional workspace scope carried by caller.
     * @param {Object} [opts] - Optional { title, matterName } display hints.
     * @returns {Promise<Object>} The opened local/canonical thread row.
     */
    openConversation(threadId, matterId, opts) {
      opts = opts || {};
      if (!threadId) return Promise.reject(new Error('threadId is required'));
      if (!this._chatEl || typeof this._chatEl.loadConversation !== 'function') {
        return Promise.reject(new Error('chat panel not ready'));
      }

      var self = this;
      var fallback = normalizeRegistryThread({
        id: threadId,
        thread_id: threadId,
        title: opts.title || self.threadTitle || 'LANA Chat',
        thread_type: 'ad_hoc',
        context_type: self.contextType,
        page_scope: normalizePageScope(self.pageScope)
      });
      if (matterId) fallback.matter_id = matterId;
      if (opts.matterName) fallback.subtitle = opts.matterName;

      function activate(thread) {
        thread = normalizeRegistryThread(thread) || fallback;
        if (!thread.id) thread.id = thread.thread_id || threadId;
        if (!thread.thread_id) thread.thread_id = threadId;
        if (matterId && !thread.matter_id) thread.matter_id = matterId;
        if (opts.matterName && !thread.subtitle) thread.subtitle = opts.matterName;

        if (thread.matter_id) {
          self._props.matterId = thread.matter_id;
          self.setAttribute('matter-id', thread.matter_id);
          self._chatEl.setAttribute('matter-id', thread.matter_id);
        }

        self._chatEl.clearConversation();
        self._chatEl.loadConversation(thread.thread_id);

        if (self._threadsEl) {
          self._threadsEl.addThread(thread);
          self._threadsEl.setActiveThread(thread.id);
        }
        self.emit('lex-lana-thread-selected', { thread: thread });
        return thread;
      }

      activate(fallback);
      return getConversationRegistryEntry(threadId).then(function (thread) {
        if (!thread) return fallback;
        return activate(thread);
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
     * Send through the wrapped chat path so page-level before-send hooks can
     * attach active document, workspace, and module context.
     */
    send(content, opts) {
      if (this._chatEl && typeof this._chatEl.send === 'function') {
        return this._chatEl.send(content, opts || {});
      }
      return null;
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

      // Create conversation-thread record in backend + add to threads component.
      // Include matter_id so the thread shows up in the matter-scoped fetch
      // (?matter_id=…); without it, threads vanish from per-matter views.
      if (requireApi()) {
        var boundMatterId = (opts && opts.matterId) || self.matterId || null;
        var threadPayload = {
          title: threadTitle,
          thread_type: 'page_general',
          context_type: self.contextType,
          page_scope: self.pageScope,
          thread_id: id
        };
        if (boundMatterId) threadPayload.matter_id = boundMatterId;
        createConversationRegistryEntry(threadPayload).then(function (resp) {
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
        if (!self._chatEl) {
          if (attempts > 0) setTimeout(function () { tryAttach(attempts - 1); }, 100);
          return;
        }
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
        if (!self._chatEl) {
          if (attempts > 0) setTimeout(function () { tryAttach(attempts - 1); }, 100);
          return;
        }
        var composer = self._chatEl.querySelector('lex-chat-composer');
        if (composer && typeof composer.attachModuleContext === 'function') {
          composer.attachModuleContext(moduleContext);
        } else if (attempts > 0) {
          setTimeout(function () { tryAttach(attempts - 1); }, 100);
        }
      }
      tryAttach(5);
    }

    prefillPrompt(prompt) {
      var self = this;
      var text = String(prompt || '');
      if (!text) return;
      function tryPrefill(attempts) {
        if (!self._chatEl) {
          if (attempts > 0) setTimeout(function () { tryPrefill(attempts - 1); }, 100);
          return;
        }
        var composer = self._chatEl.querySelector('lex-chat-composer');
        if (composer && typeof composer.getValue === 'function' && typeof composer.setValue === 'function') {
          if (!composer.getValue()) composer.setValue(text);
          if (typeof self._focusComposer === 'function') self._focusComposer();
        } else if (attempts > 0) {
          setTimeout(function () { tryPrefill(attempts - 1); }, 100);
        }
      }
      tryPrefill(5);
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
      if (this.threadsHeading) threads.setAttribute('heading', this.threadsHeading);
      if (this.threadsRecents) threads.setAttribute('recents', 'true');
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
      container.appendChild(this._createGenerationBanner());
      container.appendChild(this._createCompactBanner());
      container.appendChild(chat);
      container.appendChild(this._createFollowupsRow());

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

    _createGenerationBanner() {
      var banner = document.createElement('div');
      banner.className = 'llp-generation-banner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = '<span>LANA is still responding</span>'
        + '<span class="llp-generation-duration"></span>'
        + '<span class="llp-banner-spacer"></span>'
        + '<button type="button" class="llp-banner-stop">Stop</button>';
      this._generationBannerEl = banner;
      this._generationDurationEl = banner.querySelector('.llp-generation-duration');
      var self = this;
      banner.querySelector('.llp-banner-stop').addEventListener('click', function () {
        self._hideGenerationBanner();
        if (self._chatEl && typeof self._chatEl.stop === 'function') self._chatEl.stop();
      });
      return banner;
    }

    _createCompactBanner() {
      var banner = document.createElement('div');
      banner.className = 'llp-compact-banner';
      banner.setAttribute('role', 'status');
      banner.textContent = 'Optimising conversation context...';
      this._compactBannerEl = banner;
      return banner;
    }

    _createFollowupsRow() {
      var row = document.createElement('div');
      row.className = 'llp-followups';
      this._followupsEl = row;
      return row;
    }

    _showGenerationBanner(startedAt) {
      if (!this._generationBannerEl) return;
      this._generationBannerEl.setAttribute('data-visible', 'true');
      var self = this;
      function updateDuration() {
        if (!self._generationDurationEl) return;
        var startedMs = new Date(startedAt || Date.now()).getTime();
        var seconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
        if (seconds < 60) {
          self._generationDurationEl.textContent = seconds + (seconds === 1 ? ' second ago' : ' seconds ago');
        } else {
          var mins = Math.floor(seconds / 60);
          self._generationDurationEl.textContent = mins + (mins === 1 ? ' minute ago' : ' minutes ago');
        }
      }
      updateDuration();
      clearInterval(this._generationTimer);
      this._generationTimer = setInterval(updateDuration, 1000);
    }

    _hideGenerationBanner() {
      if (this._generationBannerEl) this._generationBannerEl.setAttribute('data-visible', 'false');
      clearInterval(this._generationTimer);
      this._generationTimer = null;
    }

    _showCompactBanner() {
      if (this._compactBannerEl) this._compactBannerEl.setAttribute('data-visible', 'true');
      this._setComposerGenerating(true);
    }

    _hideCompactBanner(detail) {
      if (this._compactBannerEl) this._compactBannerEl.setAttribute('data-visible', 'false');
      this._setComposerGenerating(false);
      var saved = detail && detail.tokensSaved;
      var dur = detail && detail.durationMs;
      if (saved || dur) {
        var msg = 'Context optimised';
        if (saved) msg += ' - saved ' + (saved > 999 ? (saved / 1000).toFixed(1) + 'K' : saved) + ' tokens';
        if (dur) msg += ' in ' + (dur / 1000).toFixed(1) + 's';
        this._toast('success', msg);
      }
    }

    _setComposerGenerating(value) {
      if (!this._chatEl) return;
      var composer = this._chatEl.querySelector('lex-chat-composer');
      if (composer && typeof composer.setGenerating === 'function') {
        composer.setGenerating(!!value);
      }
    }

    _showFollowups(followups, message) {
      if (!this._followupsEl) return;
      this._followupsEl.innerHTML = '';
      followups = Array.isArray(followups) ? followups : [];
      if (message) {
        var label = document.createElement('span');
        label.className = 'llp-followups-label';
        label.textContent = message;
        this._followupsEl.appendChild(label);
      }
      var self = this;
      followups.forEach(function (followup) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'llp-followup-chip';
        chip.textContent = followup.description || followup.label || followup.entity_type || 'Follow up';
        chip.addEventListener('click', function () {
          self._clearFollowups();
          var prompt = followup.description || followup.label || 'Yes, proceed';
          if (self._chatEl && typeof self._chatEl.send === 'function') self._chatEl.send(prompt);
        });
        self._followupsEl.appendChild(chip);
      });
      this._followupsEl.setAttribute('data-visible', (followups.length > 0 || !!message) ? 'true' : 'false');
    }

    _clearFollowups() {
      if (!this._followupsEl) return;
      this._followupsEl.innerHTML = '';
      this._followupsEl.setAttribute('data-visible', 'false');
    }

    _toast(type, message) {
      var toast = window.Lex && window.Lex.Toast;
      if (!toast) return;
      if (toast[type] && typeof toast[type] === 'function') {
        toast[type](message);
      } else if (typeof toast.show === 'function') {
        toast.show(message, type);
      }
    }

    _openArtifact(detail) {
      detail = detail || {};
      var entityId = detail.entityId;
      var artifactType = detail.artifactType;
      if (!entityId) return;

      if (artifactType === 'copy' && detail.content) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          var self = this;
          navigator.clipboard.writeText(detail.content).then(function () {
            self._toast('success', 'Copied to clipboard');
          });
        }
        return;
      }

      if (artifactType === 'version_history') {
        this._openVersionHistory(entityId);
        return;
      }

      if (artifactType === 'download' || !artifactType) {
        var token = localStorage.getItem('token') || '';
        var baseUrl = (window.api && window.api.baseUrl) ? window.api.baseUrl : '';
        window.open(baseUrl + '/api/v1/documents/' + encodeURIComponent(entityId) + '/download?token=' + encodeURIComponent(token), '_blank');
      }
    }

    _openVersionHistory(entityId) {
      var self = this;
      if (!window.api || typeof window.api.get !== 'function') return;
      window.api.get('/api/v1/agentic/artifacts?entity_id=' + encodeURIComponent(entityId))
        .then(function (data) {
          var versions = (data && data.artifacts) || [];
          if (!versions.length) {
            self._toast('error', 'No version history found');
            return;
          }
          var html = versions.map(function (v, index) {
            var current = index === 0 ? '<lex-badge color="green" label="Current"></lex-badge>' : '';
            var date = v.created_at ? '<div style="font-size:var(--lex-body-xs-size);color:var(--lex-text-tertiary);margin-top:4px;">' + self._escapeHtml(new Date(v.created_at).toLocaleString()) + '</div>' : '';
            var summary = v.summary ? '<div style="font-size:var(--lex-body-sm-size);color:var(--lex-text-secondary);margin-top:8px;">' + self._escapeHtml(v.summary) + '</div>' : '';
            return '<div style="padding:12px;border:1px solid var(--lex-border-subtle);border-radius:var(--lex-radius-md);margin-bottom:8px;background:var(--lex-bg-primary);">'
              + '<div style="display:flex;justify-content:space-between;align-items:center;">'
              + '<span style="font-size:var(--lex-body-sm-size);font-weight:var(--lex-weight-medium,500);color:var(--lex-text-primary);">Version ' + (versions.length - index) + '</span>'
              + current
              + '</div>' + date + summary + '</div>';
          }).join('');
          if (window.Lex && window.Lex.Drawer && typeof window.Lex.Drawer.open === 'function') {
            window.Lex.Drawer.open({
              heading: 'Version History',
              subtitle: versions.length + ' version' + (versions.length !== 1 ? 's' : ''),
              side: 'right',
              width: 'md',
              content: html
            });
          }
        }).catch(function (err) {
          console.error('[lex-lana-panel] Failed to load version history:', err);
          self._toast('error', 'Failed to load version history');
        });
    }

    _requestArtifactPromotion(detail) {
      var self = this;
      var action = (detail && detail.action) || {};
      var run = function () { self._executeArtifactPromotion(detail || {}); };
      if (action.requires_confirmation === true) {
        if (!window.Lex || !window.Lex.Modal || typeof window.Lex.Modal.confirm !== 'function') {
          self._setArtifactPromotionError(detail || {}, 'Confirmation is unavailable. The draft was not promoted.');
          return;
        }
        window.Lex.Modal.confirm(
          'Save to Documents?',
          'This will promote the generated draft to the matter Documents library and queue it for ingestion.',
          run,
          { confirmText: 'Save to Documents', cancelText: 'Keep as Draft' }
        );
        return;
      }
      run();
    }

    _executeArtifactPromotion(detail) {
      var action = detail.action || {};
      var messageElement = detail.messageElement;
      var artifactId = detail.artifactId || '';
      var helpers = window.Lex && window.Lex.Chat && window.Lex.Chat.ArtifactPromotion;
      var request;

      if (!helpers || typeof helpers.getPromotionRequest !== 'function' || !window.api || typeof window.api.post !== 'function') {
        this._setArtifactPromotionError(detail, 'The save action is unavailable. The draft remains saved as a draft.');
        return;
      }

      try {
        request = helpers.getPromotionRequest(action);
      } catch (err) {
        this._setArtifactPromotionError(detail, err.message + ' The draft remains saved as a draft.');
        return;
      }

      if (messageElement && typeof messageElement.updateArtifactPromotion === 'function') {
        messageElement.updateArtifactPromotion(artifactId, { tone: 'pending', message: 'Saving to Documents...' });
      }

      var self = this;
      window.api.post(request.endpoint, request.body)
        .then(function (response) {
          if (typeof helpers.normalizePromotionResponse !== 'function') {
            throw new Error('The saved-document response could not be verified.');
          }
          var result = helpers.normalizePromotionResponse(response);
          var msg = 'Saved to Documents';
          if (result.ingestion && result.ingestion.status) {
            msg += ' - Ingestion ' + String(result.ingestion.status).split('_').join(' ');
          }
          if (messageElement && typeof messageElement.updateArtifactPromotion === 'function') {
            messageElement.updateArtifactPromotion(artifactId, {
              tone: 'success',
              message: msg,
              document: result.document
            });
          }
          self._toast('success', result.alreadyPromoted ? 'Document was already saved' : 'Saved to Documents');
        })
        .catch(function (err) {
          console.error('[lex-lana-panel] Failed to promote artifact:', err);
          self._setArtifactPromotionError(detail, err && err.message ? err.message : 'The save request failed.');
        });
    }

    _setArtifactPromotionError(detail, reason) {
      var messageElement = detail && detail.messageElement;
      if (messageElement && typeof messageElement.updateArtifactPromotion === 'function') {
        messageElement.updateArtifactPromotion(detail.artifactId || '', {
          tone: 'error',
          message: 'Could not save to Documents. ' + reason
        });
      }
      this._toast('error', 'Could not save this draft to Documents');
    }

    _requestContextPromotionAction(detail) {
      var self = this;
      detail = detail || {};
      var kind = detail.actionKind || '';
      var run = function () { self._executeContextPromotionAction(detail); };

      if (kind === 'approve') {
        if (!window.Lex || !window.Lex.Modal || typeof window.Lex.Modal.confirm !== 'function') {
          self._setContextPromotionError(detail, 'Confirmation is unavailable. The insight was not shared.');
          return;
        }
        window.Lex.Modal.confirm(
          'Share with this matter?',
          'This private chat insight will become shared matter context for this workspace.',
          run,
          { confirmText: 'Share with Matter', cancelText: 'Keep Private' }
        );
        return;
      }

      run();
    }

    _executeContextPromotionAction(detail) {
      var helpers = window.Lex && window.Lex.Chat &&
        (window.Lex.Chat.ContextPromotion || window.Lex.Chat.ArtifactPromotion);
      var action = detail.action || {};
      var kind = detail.actionKind || '';
      var promotionId = detail.promotionId || '';
      var messageElement = detail.messageElement;
      var request;

      if (!helpers || typeof helpers.getContextActionRequest !== 'function' || !window.api || typeof window.api.post !== 'function') {
        this._setContextPromotionError(detail, 'The context action is unavailable.');
        return;
      }

      try {
        request = helpers.getContextActionRequest(action, kind);
      } catch (err) {
        this._setContextPromotionError(detail, err.message);
        return;
      }

      if (messageElement && typeof messageElement.updateContextPromotion === 'function') {
        messageElement.updateContextPromotion(promotionId, {
          tone: 'pending',
          message: kind === 'approve' ? 'Sharing with matter...' : 'Dismissing...'
        });
      }

      var self = this;
      window.api.post(request.endpoint, request.body)
        .then(function (response) {
          if (typeof helpers.normalizeContextPromotionResponse !== 'function') {
            throw new Error('The context action response could not be verified.');
          }
          var result = helpers.normalizeContextPromotionResponse(response, kind);
          var approved = kind === 'approve';
          if (messageElement && typeof messageElement.updateContextPromotion === 'function') {
            messageElement.updateContextPromotion(promotionId, {
              tone: approved ? 'success' : 'neutral',
              status: approved ? 'promoted' : 'dismissed',
              message: approved ? 'Shared with the matter.' : 'Dismissed. Nothing was shared.'
            });
          }
          self._toast('success', approved
            ? (result.alreadyPromoted ? 'Insight was already shared' : 'Insight shared with matter')
            : 'Suggestion dismissed');
        })
        .catch(function (err) {
          console.error('[lex-lana-panel] Context promotion action failed:', err);
          self._setContextPromotionError(detail, err && err.message ? err.message : 'The request failed.');
        });
    }

    _setContextPromotionError(detail, reason) {
      var messageElement = detail && detail.messageElement;
      if (messageElement && typeof messageElement.updateContextPromotion === 'function') {
        messageElement.updateContextPromotion(detail.promotionId || '', {
          tone: 'error',
          message: 'Could not update context. ' + reason
        });
      }
      this._toast('error', 'Could not update context suggestion');
    }

    _searchDocuments(query, composerEl) {
      if (!composerEl || typeof composerEl.setDocumentResults !== 'function') return;
      var convId = this._chatEl && this._chatEl.conversationId;
      if (!convId || !window.api) {
        composerEl.setDocumentResults([]);
        return;
      }
      getConversationDocumentCandidates(convId, {
        search: query || '',
        limit: 10
      })
        .then(function (data) {
          composerEl.setDocumentResults((data && (data.document_candidates || data.files || data.candidates)) || []);
        })
        .catch(function () {
          composerEl.setDocumentResults([]);
        });
    }

    _escapeHtml(value) {
      return String(value == null ? '' : value)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split('"').join('&quot;')
        .split("'").join('&#39;');
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
        this._hideGenerationBanner();
        this._clearFollowups();
        if (this._compactBannerEl) this._compactBannerEl.setAttribute('data-visible', 'false');
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

      // Auto-select page_general thread when loaded.
      // NOT in recents mode (the dock): the app-wide recents registry also
      // contains page_general rows from other surfaces, and auto-loading
      // one would silently hijack the dock's fresh/current conversation on
      // every threads refresh — the dock always starts on the welcome
      // screen and binds conversations only by explicit selection.
      container.addEventListener('lex-threads-loaded', function (e) {
        if (self.threadsRecents) return;
        var threads = e.detail && e.detail.threads;
        if (!threads || !threads.length || !self._chatEl) return;
        if (self._chatEl.conversationId) return; // never displace a live conversation
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
        // Recents mode (the dock): New Chat starts a fresh conversation.
        // The chat source creates the canonical conversation container just
        // before the first stream so that streaming never falls back to the
        // legacy streaming route.
        if (self.threadsRecents) {
          self._chatEl.clearConversation();
          if (self._threadsEl) self._threadsEl.setActiveThread(null);
          self._focusComposer();
          return;
        }
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

        if (self.threadsRecents) {
          var recentThread = normalizeRegistryThread({
            id: conversationId,
            thread_id: conversationId,
            title: self.threadTitle,
            thread_type: 'ad_hoc',
            context_type: self.contextType,
            page_scope: normalizePageScope(self.pageScope),
          });
          if (self.matterId) recentThread.matter_id = self.matterId;
          if (self._threadsEl) {
            self._threadsEl.addThread(recentThread);
            self._threadsEl.setActiveThread(recentThread.id);
          }
          self.emit('lex-lana-thread-created', { thread: recentThread });
          return;
        }

        // The source already created the canonical backend conversation
        // container before streaming. Add a matching local row so the panel
        // list updates immediately without issuing a duplicate create.
        var generalThread = normalizeRegistryThread({
          id: conversationId,
          thread_id: conversationId,
          title: self.threadTitle,
          thread_type: 'page_general',
          context_type: self.contextType,
          page_scope: self.pageScope
        });
        if (self.matterId) generalThread.matter_id = self.matterId;
        if (self._threadsEl) {
          self._threadsEl.addThread(generalThread);
          self._threadsEl.setActiveThread(generalThread.id);
        }
        self.emit('lex-lana-thread-created', { thread: generalThread });
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

      container.addEventListener('lex-chat-artifact-click', function (e) {
        self._openArtifact(e.detail || {});
      });

      container.addEventListener('lex-chat-artifact-promote', function (e) {
        self._requestArtifactPromotion(e.detail || {});
      });

      container.addEventListener('lex-chat-context-promotion-action', function (e) {
        self._requestContextPromotionAction(e.detail || {});
      });

      container.addEventListener('lex-chat-manage-documents', function () {
        var convId = self._chatEl && self._chatEl.conversationId;
        if (window.ChatFileDrawer && convId) {
          window.ChatFileDrawer.open(convId, self.matterId || null);
        }
      });

      container.addEventListener('lex-composer-document-search', function (e) {
        var composer = self._chatEl && self._chatEl.querySelector('lex-chat-composer');
        self._searchDocuments((e.detail && e.detail.query) || '', composer);
      });

      container.addEventListener('lex-chat-agentic-followup', function (e) {
        var detail = e.detail || {};
        var followups = detail.followups || detail.options || [];
        var message = detail.message || '';
        if (followups.length > 0 || message) self._showFollowups(followups, message);
      });

      container.addEventListener('lex-chat-agentic-blocked', function (e) {
        var detail = e.detail || {};
        var followups = detail.suggestedFollowups || [];
        if (followups.length > 0) {
          self._showFollowups(
            followups,
            detail.message || 'The workflow is blocked. Choose a follow-up action to continue.'
          );
        }
      });

      container.addEventListener('lex-chat-send', function () {
        self._clearFollowups();
      });

      container.addEventListener('lex-chat-generation-active', function (e) {
        var detail = e.detail || {};
        if (detail.active) self._showGenerationBanner(detail.startedAt || LanaTime.nowIso());
        else self._hideGenerationBanner();
      });

      container.addEventListener('lex-chat-response-end', function () {
        self._hideGenerationBanner();
      });

      container.addEventListener('lex-chat-auto-compact-start', function () {
        self._showCompactBanner();
      });

      container.addEventListener('lex-chat-auto-compact-complete', function (e) {
        self._hideCompactBanner(e.detail || {});
      });

      container.addEventListener('lex-chat-error', function (e) {
        var detail = e.detail || {};
        if (detail.status !== 401) return;
        try { localStorage.removeItem('token'); } catch (_) {}
        self._toast('error', 'Your session has expired. Please log in again.');
        setTimeout(function () {
          window.location.href = 'index.html';
        }, 1500);
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
      container.addEventListener('lex-chat-response-end', function (e) {
        self.emit('lex-lana-response-end', e.detail || {});
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
        if (!opts.title) opts.title = self.threadTitle;
        if (!opts.threadType) opts.threadType = 'ad_hoc';
        if (!opts.contextType) opts.contextType = self.contextType;
        if (!opts.pageScope) opts.pageScope = normalizePageScope(self.pageScope);
        if (!opts.matterId && self.matterId) opts.matterId = self.matterId;

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
