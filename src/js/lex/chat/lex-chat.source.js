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

  function createConversationsApi(options = {}) {
    if (options.conversationsApi) return options.conversationsApi;
    if (!Lex.Chat || !Lex.Chat.ConversationsApiClient) {
      throw new Error('Lex.Chat.ConversationsApiClient not loaded');
    }
    return new Lex.Chat.ConversationsApiClient(options.api || global.api, {
      endpoint: options.endpoint || ''
    });
  }

  function humanizePhase(phase) {
    var raw = String(phase || 'thinking').trim();
    var known = {
      thinking: 'Thinking',
      routing: 'Routing',
      retrieving: 'Retrieving context',
      generating: 'Generating',
      grounding: 'Grounding',
      grounding_buffered_generation: 'Grounding',
      finalizing: 'Finalizing',
      agentic: 'Working'
    };
    var key = raw.toLowerCase();
    if (known[key]) return known[key];
    return raw
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function firstValue() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (value !== undefined && value !== null) return value;
    }
    return null;
  }

  function numberValue() {
    var value = firstValue.apply(null, arguments);
    if (value === null || value === '') return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

    /** Forget the currently-bound conversation before starting a new chat. */
    resetConversation() {}

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
      this._conversationsApi = createConversationsApi(options);
      this._abortController = null;
      this._conversationId = null;
      this._generationId = null;
      this._model = null;
    }

    async connect(conversationId) {
      this._conversationId = conversationId || null;
      this._connected = true;
      return { conversationId: this._conversationId, sessionId: null, model: null };
    }

    resetConversation() {
      this._conversationId = null;
      this._generationId = null;
      this._model = null;
    }

    async _ensureConversation(options = {}) {
      if (this._conversationId) return this._conversationId;

      const payload = {
        title: options.title || 'New chat',
        thread_type: options.threadType || 'ad_hoc',
        context_type: options.contextType || 'full_chat'
      };
      if (options.matterId) payload.matter_id = options.matterId;
      if (options.pageScope) payload.page_scope = options.pageScope;
      if (options.metadata) payload.metadata = options.metadata;

      const response = await this._conversationsApi.createConversation(payload);
      const conversation = response && (response.conversation || response.data || response);
      const conversationId = conversation && (
        conversation.conversationId ||
        conversation.conversation_id ||
        conversation.thread_id ||
        conversation.id
      );

      if (!conversationId) {
        throw new Error('Canonical conversation create API returned no conversation id');
      }

      this._conversationId = conversationId;
      return conversationId;
    }

    async ensureConversation(options = {}) {
      return this._ensureConversation(options);
    }

    /** Load message history for the current conversation. */
    async loadHistory(page, limit) {
      if (!this._conversationId) return { messages: [], pagination: null, hasMore: false };

      try {
        const data = await this._conversationsApi.getMessages(this._conversationId, page, limit);
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
            references: (m.metadata && m.metadata.references) || m.references || [],
            artifacts: (m.metadata && (m.metadata.artifacts || m.metadata.agentic_artifacts)) || m.artifacts || [],
            attachments: (m.metadata && m.metadata.attachments) || m.attachments || [],
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
        const conversationId = await this._ensureConversation(options);

        // Guard streaming
        if (global.api && typeof global.api.setStreamingActive === 'function') {
          global.api.setStreamingActive();
        }

        const body = {
          message: content,
          client_request_id: clientRequestId,
          client_time: LanaTime.nowIso(),
          client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
        body.conversation_id = conversationId;
        if (options.matterId) body.matter_id = options.matterId;
        if (options.attachments) body.attachments = options.attachments;
        if (options.contextType) body.context_type = options.contextType;

        const response = await this._conversationsApi.streamMessage(
          conversationId,
          body,
          this._abortController.signal
        );

        if (!response.ok) {
          const payload = await this._conversationsApi.readJsonSafe(response);
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
      if (!key && !this._conversationId) {
        if (this._abortController) this._abortController.abort();
        return { success: false, reason: 'no-generation' };
      }

      try {
        return await this._conversationsApi.stopGeneration(this._conversationId);
      } catch (err) {
        return { success: false, error: err.message };
      } finally {
        if (this._abortController) this._abortController.abort();
      }
    }

    /**
     * Check whether an active assistant response exists for a conversation.
     * Used on page load / thread switch to detect responses started in another
     * tab or device.
     *
     * @param {string} [conversationId] defaults to the currently-bound conversation
     * @returns {Promise<{active:boolean, startedAt?:string, durationSeconds?:number, clientId?:string}>}
     */
    async checkActiveGeneration(conversationId) {
      const id = conversationId || this._conversationId;
      if (!id) return { active: false };

      try {
        const data = await this._conversationsApi.getGeneration(id);
        if (!data.active) return { active: false };
        const activeResponse = data.active_response || {};
        this._conversationId = id;
        if (data.generation_id || data.session_id) {
          this._generationId = data.generation_id || data.session_id;
        }
        return {
          active: true,
          sessionId: data.generation_id || data.session_id || null,
          generationId: data.generation_id || data.session_id || null,
          clientId: data.client_id || null,
          startedAt: data.started_at || activeResponse.started_at || null,
          durationSeconds: data.duration_seconds || activeResponse.duration_seconds || 0
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
      return await this._conversationsApi.addDocument(this._conversationId, docId, filename, matterId);
    }

    async removeDocument(docId) {
      if (!this._conversationId) return null;
      return await this._conversationsApi.removeDocument(this._conversationId, docId);
    }

    async clearDocuments() {
      if (!this._conversationId) return null;
      return await this._conversationsApi.clearDocuments(this._conversationId);
    }

    async loadState() {
      if (!this._conversationId) return null;
      return await this._conversationsApi.loadState(this._conversationId);
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
          return { type: 'thinking', message: data.message, phase: humanizePhase(data.phase) };

        case 'status':
          return { type: 'thinking', message: data.message, phase: humanizePhase(data.phase) };

        case 'reasoning':
          return {
            type: 'reasoning',
            complexity: data.complexity,
            iterations: data.iterations,
            message: data.message
          };

        case 'progress':
          // status/phase/heartbeat give liveness heartbeats a stable
          // identity so the activity drawer can coalesce consecutive
          // "Still generating..." rows (see lex-chat-progress-events.js).
          return {
            type: 'progress',
            category: data.category,
            stage: data.stage,
            percent: data.percent,
            message: data.message,
            status: data.status,
            phase: data.phase,
            heartbeat: data.heartbeat === true
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
            message: data.message || '',
            status: data.status || null,
            phase: data.phase || data.stage || null,
            scanType: data.scan_type || data.scanType || null,
            filename: data.filename || data.file_name || null,
            fileCount: numberValue(data.file_count, data.fileCount),
            completed: data.completed === true,
            chunksFound: numberValue(data.chunks_found, data.chunksFound),
            heartbeat: data.heartbeat === true
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

        case 'references':
          return { type: 'references', references: data.references || [] };

        case 'rag_complete':
          return {
            type: 'rag_complete',
            message: data.message || '',
            chunksFound: numberValue(data.chunks_found, data.chunksFound),
            documentsSearched: numberValue(data.documents_searched, data.documentsSearched),
            ragTimeMs: numberValue(data.rag_time_ms, data.ragTimeMs),
            source: data.source || data.provider || null
          };

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

        case 'conversation_compaction':
          return {
            type: 'conversation_compaction',
            status: data.status || 'applied',
            reason: data.reason || null,
            message: data.message || '',
            beforeTokens: numberValue(data.before_tokens, data.beforeTokens),
            afterTokens: numberValue(data.after_tokens, data.afterTokens),
            budgetTokens: numberValue(data.budget_tokens, data.budgetTokens),
            beforeMessageCount: numberValue(data.before_message_count, data.beforeMessageCount),
            afterMessageCount: numberValue(data.after_message_count, data.afterMessageCount),
            droppedMessageCount: numberValue(data.dropped_message_count, data.droppedMessageCount),
            hasRollingSummary: firstValue(data.has_rolling_summary, data.hasRollingSummary) === true,
            hasStructuredState: firstValue(data.has_structured_state, data.hasStructuredState) === true,
            historyStrategy: data.history_strategy || data.historyStrategy || null
          };

        case 'phase':
          return { type: 'thinking', message: data.message, phase: humanizePhase(data.phase) };

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
            matterId: data.matter_id || null,
            references: data.references || []
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
            validatorWarnings: data.grounding.validator_warnings || [],
            validationFindings: data.grounding.validation_findings || [],
            validationDisposition: data.grounding.validation_disposition || null,
            validationSeverity: data.grounding.validation_severity || null,
            toolEvidenceCount: data.grounding.tool_evidence_count || 0,
            policy: data.grounding_policy || null,
            handler: data.handler || null,
            strategy: data.strategy || null,
            // Who checked this answer, and were they a different model than the
            // one that wrote it. `verified` alone cannot answer the second
            // question, and a self-review presented as verification would be a
            // stronger claim than the system can support.
            verification: data.response_verification
              ? {
                attempted: data.response_verification.attempted === true,
                verified: data.response_verification.verified === true,
                independent: data.response_verification.independent_review,
                verdict: data.response_verification.verdict || null,
                disposition: data.response_verification.disposition || null,
                latencyMs: data.response_verification.latency_ms || null
              }
              : null
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
