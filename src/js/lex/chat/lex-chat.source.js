/* ==========================================================================
   Lex UI — Chat Source Protocol
   Strategy pattern for chat backends. Includes:
     - ChatSource   (abstract base)
     - SSEChatSource  (LANA AI streaming endpoint)
     - DemoChatSource (mock responses for demo/trade-show mode)
     - Source registry (named + programmatic)
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex) { console.error('[Lex ChatSource] Lex core not loaded'); return; }
  const CHAT_MESSAGE_MAX_CODE_UNITS = 2000;

  function generateClientRequestId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      const value = Math.random() * 16 | 0;
      const nibble = char === 'x' ? value : (value & 0x3 | 0x8);
      return nibble.toString(16);
    });
  }

  // =========================================================================
  // ChatSource — abstract base
  // =========================================================================

  class ChatSource {
    constructor(options = {}) {
      this._options = options;
      this._connected = false;
      this._generating = false;
    }

    /** Connect to a conversation (or create one). */
    async connect(conversationId, options) {
      throw new Error('ChatSource.connect() not implemented');
    }

    /**
     * Send a message and stream back events.
     * @param {string} content
     * @param {Object} options
     * @yields {ChatEvent} { type, ...payload }
     */
    async *send(content, options) {
      throw new Error('ChatSource.send() not implemented');
    }

    /** Load message history. */
    async loadHistory(page, limit) {
      return { messages: [], pagination: null, hasMore: false };
    }

    /** Stop an active generation. */
    async stop() {}

    /** Check whether a generation is already in flight for a conversation. */
    async checkActiveGeneration(conversationId) {
      return { active: false };
    }

    /** Cleanup on disconnect. */
    disconnect() {
      this._connected = false;
      this._generating = false;
    }

    // -- Document mode (optional) --
    async addDocument(docId, filename, matterId) { return null; }
    async removeDocument(docId) { return null; }
    async clearDocuments() { return null; }
    async loadState() { return null; }

    get connected() { return this._connected; }
    get generating() { return this._generating; }
  }

  // =========================================================================
  // SSEChatSource — LANA AI streaming
  // =========================================================================

  class SSEChatSource extends ChatSource {
    constructor(options = {}) {
      super(options);
      this._baseUrl = options.endpoint || '';
      this._abortController = null;
      this._conversationId = null;
      this._generationId = null;
      this._model = null;
    }

    // -- URL resolution chain --
    async _resolveBaseUrl() {
      let url = this._baseUrl;

      // 1. API client
      const api = this._options.api || global.api;
      if (api) {
        if (api._readyPromise) await api._readyPromise;
        if (api.baseUrl) url = api.baseUrl;
      }

      // 2. Config fallback
      if (!url || url === 'null' || url.startsWith('file:')) {
        url = global.LanaConfig?.API_BASE_URL || '';
      }

      // 3. localStorage
      if (!url || url === 'null' || url.startsWith('file:')) {
        try {
          const saved = localStorage.getItem('lana_saved_server');
          if (saved) {
            const info = JSON.parse(saved);
            if (info.url) url = info.url;
          }
        } catch (_) { /* ignore */ }
      }

      // 4. Electron IPC
      if ((!url || url === 'null' || url.startsWith('file:')) && global.electronAPI) {
        try {
          const res = await global.electronAPI.getSavedServer();
          if (res?.success && res.server?.url) url = res.server.url;
        } catch (_) { /* ignore */ }
      }

      if (!url || url === 'null' || url.startsWith('file:')) {
        throw new Error('Server not connected. Please wait for server discovery or check your connection.');
      }

      this._baseUrl = url;
      return url;
    }

    _getToken() {
      return localStorage.getItem('token') || '';
    }

    async connect(conversationId) {
      this._conversationId = conversationId || null;
      this._connected = true;
      return { conversationId: this._conversationId, sessionId: null, model: null };
    }

    /** Load message history for the current conversation. */
    async loadHistory(page, limit) {
      if (!this._conversationId) return { messages: [], pagination: null, hasMore: false };

      try {
        const baseUrl = await this._resolveBaseUrl();
        const token = this._getToken();

        const res = await fetch(
          `${baseUrl}/api/v1/chat/sessions/${this._conversationId}/messages?page=${page}&limit=${limit}&order=desc`,
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        );

        if (!res.ok) return { messages: [], pagination: null, hasMore: false };

        const data = await res.json();
        const rawMessages = (data.messages || []).filter(function (m) {
          return m.role !== 'tool' && m.role !== 'system';
        });

        // Reverse from desc order to chronological
        const messages = rawMessages.reverse().map(function (m) {
          return {
            id: m.id || m.message_id,
            role: m.role,
            content: m.content,
            timestamp: m.created_at || m.timestamp,
            citations: (m.metadata && m.metadata.citations) || m.citations || [],
            artifacts: (m.metadata && m.metadata.artifacts) || m.artifacts || [],
            duration: m.duration_ms || null,
            tokenCount: m.token_count || null,
            metadata: m.metadata || {}  // Preserve full metadata for dynamic_cards re-hydration
          };
        });

        return {
          messages: messages,
          pagination: data.pagination || null,
          hasMore: data.hasMore === true || (data.pagination && data.pagination.hasMore === true)
        };
      } catch (err) {
        console.error('[SSEChatSource] Failed to load history:', err);
        return { messages: [], pagination: null, hasMore: false };
      }
    }

    async *send(content, options = {}) {
      if (String(content || '').length > CHAT_MESSAGE_MAX_CODE_UNITS) {
        yield {
          type: 'error',
          error: `Message must be ${CHAT_MESSAGE_MAX_CODE_UNITS} characters or fewer.`,
          code: 'VALIDATION_ERROR',
          field: 'message',
          terminal: true
        };
        return;
      }

      this._generating = true;
      this._abortController = new AbortController();
      this._generationId = null;
      const clientRequestId = options.clientRequestId || generateClientRequestId();

      try {
        const baseUrl = await this._resolveBaseUrl();
        const token = this._getToken();

        // Guard streaming
        if (global.api && typeof global.api.setStreamingActive === 'function') {
          global.api.setStreamingActive();
        }

        const body = {
          message: content,
          client_request_id: clientRequestId,
          client_time: new Date().toISOString(),
          client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
        if (this._conversationId) body.conversation_id = this._conversationId;
        if (options.matterId) body.matter_id = options.matterId;
        if (options.attachments) body.attachments = options.attachments;
        if (options.contextType) body.context_type = options.contextType;

        const response = await fetch(`${baseUrl}/api/v1/streaming/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(body),
          signal: this._abortController.signal
        });

        if (!response.ok) {
          let payload = null;
          try { payload = await response.json(); } catch (_) { /* ignore */ }
          if (response.status === 401) {
            yield { type: 'error', error: 'Session expired', status: 401 };
            return;
          }
          yield {
            type: 'error',
            error: payload?.error?.code || payload?.error || `HTTP ${response.status}`,
            code: payload?.error?.code || null,
            field: payload?.error?.field || null,
            details: payload?.error?.details || null,
            requestId: payload?.request_id || response.headers.get('X-Request-ID') || null,
            status: response.status,
            terminal: true
          };
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const consumeSSEBlock = function (block) {
          const lines = block.split('\n');
          let eventName = null;
          const dataLines = [];

          for (const rawLine of lines) {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }

          if (!dataLines.length) return null;
          let data;
          try { data = JSON.parse(dataLines.join('\n')); }
          catch (_) {
            return { type: 'protocol_warning', event: eventName, reason: 'malformed_json' };
          }
          return this._mapEvent(eventName, data);
        }.bind(this);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop();

          for (const block of blocks) {
            const event = consumeSSEBlock(block);
            if (event) {
              if (event.type === 'connected') {
                if (event.threadId) this._conversationId = event.threadId;
                if (event.generationId) this._generationId = event.generationId;
                if (event.model) this._model = event.model;
              }
              yield event;
            }
          }
        }

        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) {
          const event = consumeSSEBlock(buffer);
          if (event) yield event;
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          yield { type: 'stopped' };
        } else {
          yield { type: 'error', error: error.message };
        }
      } finally {
        this._generating = false;
        this._abortController = null;
        if (global.api && typeof global.api.setStreamingInactive === 'function') {
          global.api.setStreamingInactive();
        }
      }
    }

    async stop() {
      const key = this._generationId;
      if (!key) {
        if (this._abortController) this._abortController.abort();
        return { success: false, reason: 'no-generation' };
      }

      try {
        const baseUrl = await this._resolveBaseUrl();
        const token = this._getToken();
        const res = await fetch(`${baseUrl}/api/v1/streaming/sessions/${key}/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        if (!res.ok) return { success: false, status: res.status };
        return await res.json().catch(() => ({ success: true }));
      } catch (err) {
        return { success: false, error: err.message };
      } finally {
        if (this._abortController) this._abortController.abort();
      }
    }

    /**
     * Check whether an active generation exists for a conversation.
     * Used on page load / thread switch to detect generations started
     * in another tab or device.
     *
     * @param {string} [conversationId] defaults to the currently-bound conversation
     * @returns {Promise<{active:boolean, startedAt?:string, durationSeconds?:number, clientId?:string}>}
     */
    async checkActiveGeneration(conversationId) {
      const id = conversationId || this._conversationId;
      if (!id) return { active: false };

      try {
        const baseUrl = await this._resolveBaseUrl();
        const token = this._getToken();
        const res = await fetch(`${baseUrl}/api/v1/streaming/threads/${id}/active-generation`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return { active: false };
        const data = await res.json();
        if (!data.active) return { active: false };
        if (data.generation_id || data.session_id) {
          this._generationId = data.generation_id || data.session_id;
        }
        return {
          active: true,
          sessionId: data.generation_id || data.session_id || null,
          generationId: data.generation_id || data.session_id || null,
          clientId: data.client_id || null,
          startedAt: data.started_at || null,
          durationSeconds: data.duration_seconds || 0
        };
      } catch (_) {
        return { active: false };
      }
    }

    disconnect() {
      this.stop();
      super.disconnect();
    }

    // -- Document mode API --

    async addDocument(docId, filename, matterId) {
      if (!this._conversationId) return null;
      const baseUrl = await this._resolveBaseUrl();
      const token = this._getToken();
      const res = await fetch(`${baseUrl}/api/chat/conversations/${this._conversationId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ documentId: docId, filename, matterId })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add document');
      return (await res.json()).state;
    }

    async removeDocument(docId) {
      if (!this._conversationId) return null;
      const baseUrl = await this._resolveBaseUrl();
      const token = this._getToken();
      const res = await fetch(`${baseUrl}/api/chat/conversations/${this._conversationId}/documents/${docId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to remove document');
      return (await res.json()).state;
    }

    async clearDocuments() {
      if (!this._conversationId) return null;
      const baseUrl = await this._resolveBaseUrl();
      const token = this._getToken();
      const res = await fetch(`${baseUrl}/api/chat/conversations/${this._conversationId}/documents/clear`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to clear documents');
      return (await res.json()).state;
    }

    async loadState() {
      if (!this._conversationId) return null;
      const baseUrl = await this._resolveBaseUrl();
      const token = this._getToken();
      const res = await fetch(`${baseUrl}/api/chat/conversations/${this._conversationId}/state`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      return (await res.json()).state;
    }

    // -- SSE event → ChatEvent mapping --

    _mapEvent(eventType, data) {
      switch (eventType) {
        case 'connected':
          return {
            type: 'connected',
            threadId: data.thread_id || null,
            generationId: data.generation_id || data.session_id || null,
            model: data.model || null,
            matterId: data.matter_id || null
          };

        case 'thinking':
          return { type: 'thinking', message: data.message, phase: data.phase || 'thinking' };

        case 'status':
          return { type: 'thinking', message: data.message, phase: data.phase || 'thinking' };

        case 'reasoning':
          return {
            type: 'reasoning',
            complexity: data.complexity,
            iterations: data.iterations,
            message: data.message
          };

        case 'progress':
          return {
            type: 'progress',
            category: data.category,
            stage: data.stage,
            percent: data.percent,
            message: data.message
          };

        case 'tool_thinking':
          return { type: 'tool_thinking', content: data.content || data.message || '' };

        case 'tool_start':
          // Forward tool_name AND params so the chat component can
          // humanize the activity-bar primary line (e.g. inspect
          // params.data_type for get_matter_data).
          return {
            type: 'tool_start',
            tool: data.tool || data.tool_name || '',
            toolName: data.tool_name || data.tool || '',
            params: data.params || {}
          };

        case 'tool_progress':
          return {
            type: 'tool_progress',
            tool: data.tool || data.tool_name || '',
            toolName: data.tool_name || data.tool || '',
            message: data.message || ''
          };

        case 'tool_end':
          return {
            type: 'tool_end',
            tool: data.tool || data.tool_name || '',
            toolName: data.tool_name || data.tool || '',
            success: data.success !== false,
            // Backend emits a human-readable rollup like "Found 1 user
            // (top: Jennifer Norton)." — pass it through; the UI uses
            // this for telemetry but no longer renders it on the bar.
            summary: data.summary || data.message || ''
          };

        // Legacy variants emitted by matter-context-tool-loop.js. Same
        // semantics as tool_start / tool_end above; kept distinct so the
        // chat component can keep handlers symmetrical.
        case 'tool_call_starting':
          return {
            type: 'tool_call_starting',
            tool: data.tool_name || '',
            toolName: data.tool_name || '',
            paramsPreview: data.params_preview || '',
            agentId: data.agent_id || null,
            step: data.step || null
          };

        case 'tool_call_complete':
          return {
            type: 'tool_call_complete',
            tool: data.tool_name || '',
            toolName: data.tool_name || '',
            ok: data.ok !== false,
            summary: data.summary || '',
            step: data.step || null
          };

        case 'content':
        case 'message':
          if (data.content) return { type: 'content', text: data.content };
          return null;

        case 'citations':
          return { type: 'citations', citations: data.citations || data.sources || [] };

        case 'context_usage':
          return {
            type: 'context_usage',
            percentUsed: data.percent_used,
            tokensUsed: data.tokens_used,
            percentUntilCompact: data.percent_until_compact
          };

        case 'agentic_progress':
          return {
            type: 'agentic_progress',
            step: data.step,
            currentStep: data.current_step ?? data.currentStep,
            totalSteps: data.total_steps,
            phase: data.phase,
            message: data.message,
            status: data.status,
            taskId: data.task_id || data.taskId,
            heartbeat: data.heartbeat === true
          };

        case 'plan_ready':
          return {
            type: 'plan_ready',
            approval_id: data.approval_id,
            plan: data.plan,
            message: data.message
          };

        case 'agentic_approval_required':
          return {
            type: 'agentic_approval_required',
            approval_id: data.approval_id,
            plan: data.plan,
            status: data.status
          };

        case 'agentic_complete':
          return { type: 'agentic_complete', artifacts: data.artifacts || [] };

        case 'agentic_error':
          return {
            type: 'agentic_error',
            error: data.error || data.message || data.reason_code || 'Unknown error',
            message: data.message,
            code: data.reason_code || data.code || null,
            generationId: data.generation_id || data.session_id || null,
            terminal: true
          };

        case 'agentic_blocked':
          return {
            type: 'agentic_blocked',
            error: data.error,
            message: data.message || data.summary || '',
            status: data.status || 'blocked_precondition',
            failureClass: data.failureClass || null,
            failureReason: data.failureReason || null,
            suggestedFollowups: data.suggestedFollowups || []
          };

        case 'agentic_artifacts':
          return { type: 'agentic_artifacts', artifacts: data.artifacts || [] };

        case 'agentic_followup':
          return {
            type: 'agentic_followup',
            followups: data.followups || [],
            message: data.message || '',
            matterId: data.matter_id || data.matterId || null,
            options: data.options || []
          };

        case 'iteration_summary':
          return {
            type: 'iteration_summary',
            iteration: data.iteration,
            maxIterations: data.maxIterations || data.max_iterations,
            toolsUsed: data.toolsUsed || data.tools_used || [],
            message: data.message,
            failureCount: data.failureCount || data.failure_count || 0
          };

        case 'title':
          if (data.generated_title) {
            return { type: 'title', generatedTitle: data.generated_title };
          }
          return null;

        case 'auto_compact_start':
          return { type: 'auto_compact_start', messagesToSummarize: data.messages_to_summarize };

        case 'auto_compact_complete':
          return {
            type: 'auto_compact_complete',
            newPercentUsed: data.new_percent_used,
            tokensSaved: data.tokens_saved,
            durationMs: data.duration_ms
          };

        case 'phase':
          return { type: 'thinking', message: data.message, phase: data.phase || 'thinking' };

        case 'done':
          if (!data.message_id) {
            return {
              type: 'error',
              error: 'Response could not be saved.',
              code: 'INVALID_DONE_MESSAGE_ID',
              generationId: data.generation_id || data.session_id || null,
              terminal: true
            };
          }
          return {
            type: 'done',
            messageId: data.message_id,
            userMessageId: data.user_message_id,
            generationId: data.generation_id || data.session_id || null,
            threadId: data.thread_id,
            tokenCount: data.token_count || data.total_tokens || null,
            processingTimeMs: data.processing_time_ms || data.generation_time_ms || null,
            matterId: data.matter_id || null
          };

        case 'block_hints':
          return {
            type: 'block_hints',
            intent: data.intent || null,
            blocks: data.blocks || data.suggested_blocks || []
          };

        case 'debug_context':
          if (!data.grounding) return null; // skip if no grounding data
          return {
            type: 'grounding_context',
            groundingStatus: data.grounding.grounding_status || 'none',
            evidenceMode: data.grounding.evidence_mode || 'unknown',
            retrievalCoverage: data.grounding.retrieval_coverage || null,
            fallbackUsed: data.grounding.fallback_used || false,
            validatorFailures: data.grounding.validator_failures || [],
            toolEvidenceCount: data.grounding.tool_evidence_count || 0,
            policy: data.grounding_policy || null,
            handler: data.handler || null,
            strategy: data.strategy || null
          };

        case 'sources':
        case 'retrieval_metrics':
        case 'tool_result':
        case 'document_progress':
        case 'phase_update':
        case 'document_phase_update':
        case 'documents_loaded':
          // Pass through as generic events for extension
          return { type: eventType, ...data };

        case 'error':
          return {
            type: 'error',
            error: data.error || data.message || data.reason_code || 'Unknown error',
            code: data.reason_code || data.code || null,
            status: data.status || null,
            generationId: data.generation_id || data.session_id || null,
            terminal: true
          };

        case 'aborted':
          return {
            type: 'stopped',
            reason: data.reason_code || 'REQUEST_ABORTED',
            generationId: data.generation_id || data.session_id || null,
            terminal: true
          };

        default:
          return { type: 'protocol_warning', event: eventType || null, reason: 'unknown_event' };
      }
    }
  }

  // =========================================================================
  // DemoChatSource — mock responses
  // =========================================================================

  class DemoChatSource extends ChatSource {
    constructor(options = {}) {
      super(options);
      this._delay = options.delay || 1500;
      this._thinkDelay = options.thinkDelay || 800;
    }

    async connect(conversationId) {
      this._connected = true;
      return { conversationId: conversationId || 'demo-' + Date.now(), sessionId: null, model: 'demo' };
    }

    async *send(content, _options) {
      this._generating = true;
      try {
        // Thinking phase
        yield { type: 'thinking', message: 'Thinking...', phase: 'thinking' };
        await this._wait(this._thinkDelay);

        // Get response
        const response = global.ChatDemoResponses?.getResponse(content)
          || 'I can help with that! In the full version of Lana AI, I would analyze your query and provide a detailed response.';

        const delay = global.ChatDemoResponses?.getTypingDelay(response) || this._delay;

        // Simulate streaming by yielding chunks
        const words = response.split(' ');
        const chunkSize = Math.max(3, Math.floor(words.length / 8));
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunk = words.slice(i, i + chunkSize).join(' ') + (i + chunkSize < words.length ? ' ' : '');
          yield { type: 'content', text: chunk };
          await this._wait(delay / Math.ceil(words.length / chunkSize));
        }

        yield { type: 'done', messageId: 'demo-' + Date.now(), threadId: 'demo-thread' };
      } finally {
        this._generating = false;
      }
    }

    _wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  // =========================================================================
  // Source Registry
  // =========================================================================

  const _sourceRegistry = {};

  function registerSource(name, SourceClass) {
    _sourceRegistry[name] = SourceClass;
  }

  function createSource(name, options) {
    const Cls = _sourceRegistry[name];
    if (!Cls) throw new Error(`Unknown chat source: "${name}"`);
    return new Cls(options);
  }

  function getRegisteredSources() {
    return Object.keys(_sourceRegistry);
  }

  // =========================================================================
  // Export
  // =========================================================================

  Lex.Chat = Lex.Chat || {};
  Lex.Chat.ChatSource = ChatSource;
  Lex.Chat.SSEChatSource = SSEChatSource;
  Lex.Chat.DemoChatSource = DemoChatSource;
  Lex.Chat.registerSource = registerSource;
  Lex.Chat.createSource = createSource;
  Lex.Chat.getRegisteredSources = getRegisteredSources;

})(typeof window !== 'undefined' ? window : globalThis);
