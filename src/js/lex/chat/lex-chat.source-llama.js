/* ==========================================================================
   Lex UI — LlamaChatSource
   ChatSource implementation for local llama.cpp server.
   Uses the OpenAI-compatible /v1/chat/completions endpoint with SSE streaming.
   ========================================================================== */

(function (global) {
  'use strict';

  const Chat = global.Lex?.Chat;
  if (!Chat) { console.error('[LlamaChatSource] Lex.Chat not loaded'); return; }

  // ---------------------------------------------------------------------------
  // Default system prompt — instructs the LLM to produce rich markdown
  // ---------------------------------------------------------------------------

  const DEFAULT_SYSTEM_PROMPT = `You are Lana AI, an intelligent legal assistant built for law firms and legal professionals. You help with legal research, document analysis, contract review, matter management, and general legal questions.

IMPORTANT — Formatting rules (follow strictly):
- Use **bold** for key terms and emphasis
- Use ## for major sections and ### for subsections — never use #### or deeper headings
- Use bullet lists (- item) and numbered lists (1. item) for structured information
- Use \`inline code\` for legal citations, statute numbers, or case references
- Use fenced code blocks (\`\`\`language) for legal text excerpts, contract clauses, or structured data
- Use > blockquotes for quoting legal text or clauses
- Separate sections with blank lines for readability
- Keep paragraphs short (2-4 sentences)

Keep responses concise but thorough. Provide actionable insights. Structure complex analyses with clear sections.`;

  // ---------------------------------------------------------------------------
  // LlamaChatSource
  // ---------------------------------------------------------------------------

  class LlamaChatSource {

    constructor(options = {}) {
      this._endpoint = options.endpoint || 'http://localhost:8081';
      this._model = options.model || null; // Auto-detect
      this._systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      this._temperature = options.temperature ?? 0.7;
      this._maxTokens = options.maxTokens || 2048;

      this._messages = [];
      this._connected = false;
      this._generating = false;
      this._abortController = null;
      this._conversationId = null;
    }

    get connected() { return this._connected; }
    get generating() { return this._generating; }

    async connect(conversationId) {
      this._conversationId = conversationId || 'llama-' + Date.now();
      this._connected = true;

      // Auto-detect model if not specified
      if (!this._model) {
        try {
          const res = await fetch(`${this._endpoint}/v1/models`);
          const data = await res.json();
          const models = data.models || data.data || [];
          if (models.length > 0) {
            this._model = models[0].id || models[0].name || models[0].model;
          }
        } catch (e) {
          console.warn('[LlamaChatSource] Could not auto-detect model:', e.message);
        }
        if (!this._model) this._model = 'default';
      }

      // Initialize system prompt
      if (this._messages.length === 0) {
        this._messages.push({ role: 'system', content: this._systemPrompt });
      }

      return { conversationId: this._conversationId, model: this._model };
    }

    async *send(content, options = {}) {
      if (!this._connected) await this.connect();

      this._generating = true;
      this._abortController = new AbortController();

      // Add user message to history
      this._messages.push({ role: 'user', content });

      // Yield connected event
      yield { type: 'connected', threadId: this._conversationId, model: this._model };

      // Yield thinking
      yield { type: 'thinking', message: 'Thinking...', phase: 'thinking' };

      let fullContent = '';

      try {
        const response = await fetch(`${this._endpoint}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this._model,
            messages: this._messages,
            stream: true,
            temperature: this._temperature,
            max_tokens: this._maxTokens
          }),
          signal: this._abortController.signal
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          throw new Error(`llama.cpp API error ${response.status}: ${errText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));
              const choice = data.choices?.[0];
              if (!choice) continue;

              // Stream content token
              const token = choice.delta?.content;
              if (token) {
                fullContent += token;
                yield { type: 'content', text: token };
              }

              // Check for completion
              if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
                // Save to history
                this._messages.push({ role: 'assistant', content: fullContent });

                yield {
                  type: 'done',
                  messageId: data.id || ('msg-' + Date.now()),
                  threadId: this._conversationId
                };
              }
            } catch (e) {
              // Skip malformed JSON lines
            }
          }
        }

        // Process leftover buffer
        if (buffer.trim() && buffer.trim() !== 'data: [DONE]' && buffer.trim().startsWith('data: ')) {
          try {
            const data = JSON.parse(buffer.trim().slice(6));
            const choice = data.choices?.[0];
            if (choice?.delta?.content) {
              fullContent += choice.delta.content;
              yield { type: 'content', text: choice.delta.content };
            }
            if (choice?.finish_reason) {
              this._messages.push({ role: 'assistant', content: fullContent });
              yield { type: 'done', messageId: data.id || ('msg-' + Date.now()), threadId: this._conversationId };
            }
          } catch (e) {}
        }

        // If we never got a finish_reason but the stream ended, still finalize
        if (fullContent && !this._messages.some(m => m.content === fullContent && m.role === 'assistant')) {
          this._messages.push({ role: 'assistant', content: fullContent });
          yield { type: 'done', messageId: 'msg-' + Date.now(), threadId: this._conversationId };
        }

      } catch (err) {
        if (err.name === 'AbortError') {
          if (fullContent) {
            this._messages.push({ role: 'assistant', content: fullContent });
          }
          yield { type: 'stopped' };
        } else {
          yield { type: 'error', error: err.message };
        }
      } finally {
        this._generating = false;
        this._abortController = null;
      }
    }

    async stop() {
      if (this._abortController) {
        this._abortController.abort();
      }
    }

    // Stub methods (not applicable for direct LLM connection)
    async loadHistory() { return { messages: [], hasMore: false }; }
    async loadState() { return null; }
    async addDocument() { return null; }
    async removeDocument() { return null; }
    async clearDocuments() { return null; }

    disconnect() {
      this.stop();
      this._connected = false;
      this._messages = [];
    }
  }

  Chat.LlamaChatSource = LlamaChatSource;

})(typeof window !== 'undefined' ? window : globalThis);
