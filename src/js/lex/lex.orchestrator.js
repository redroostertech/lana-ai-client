/* ==========================================================================
   Lex UI — Orchestrator
   Bridges the AI layer (SSE streams, structured output) with the block renderer.
   Integrates with the existing chat.js SSE handler.

   Usage:
     // In chat.js SSE handler, add:
     // } else if (currentEvent === 'structured_block') {
     //   window.Lex.Orchestrator.handleSSEBlock(data, messageContainer);
     // }

     // Get system prompt addition for the LLM:
     // const aiBlocks = window.Lex.Orchestrator.getSystemPromptAddendum();
   ========================================================================== */

(function (global) {
  'use strict';

  const { SchemaRegistry, BlockRenderer } = global.Lex;

  const LexOrchestrator = {

    // -- Intent state (set by block_hints SSE events) --
    _lastIntent: null,
    _lastBlocks: null,

    /**
     * Get the system prompt fragment that describes available UI blocks.
     * Append this to the LLM's system prompt.
     * @deprecated Use getCompactPromptForIntent() for token-efficient prompts.
     */
    getSystemPromptAddendum() {
      return SchemaRegistry.toSystemPrompt();
    },

    /**
     * Get a compact, token-efficient system prompt for a specific intent.
     * Uses TokenBudget to select relevant blocks, then generates compact schema.
     *
     * @param {string} [intent] - Backend intent label. Falls back to last stored intent.
     * @returns {string} Compact schema prompt (typically 50-200 tokens)
     */
    getCompactPromptForIntent(intent) {
      const TokenBudget = global.Lex.TokenBudget;
      const targetIntent = intent || this._lastIntent;

      let blockTypes;
      if (targetIntent && TokenBudget) {
        blockTypes = TokenBudget.getBlocksForIntent(targetIntent);
      }

      return SchemaRegistry.toCompactPrompt(blockTypes);
    },

    /**
     * Store intent hints from a block_hints SSE event.
     * Called by lex-chat when it receives block_hints from the backend.
     *
     * @param {string} intent - The classified intent
     * @param {string[]} [blocks] - Suggested block types (overrides local mapping)
     */
    setIntentHints(intent, blocks) {
      this._lastIntent = intent || null;
      this._lastBlocks = blocks || null;
    },

    /**
     * Get the last received intent hints.
     * @returns {{ intent: string|null, blocks: string[]|null }}
     */
    getIntentHints() {
      return { intent: this._lastIntent, blocks: this._lastBlocks };
    },

    /**
     * Process a complete AI response that may contain mixed text and blocks.
     * Parses the response, renders structured blocks, returns parsed blocks.
     *
     * @param {string} fullResponse - Complete AI text response
     * @param {HTMLElement} container - Where to render
     * @returns {Array} Parsed blocks
     */
    processResponse(fullResponse, container) {
      const blocks = BlockRenderer.parseResponse(fullResponse);
      if (blocks.length > 0) {
        BlockRenderer.render(container, blocks);
      }
      return blocks;
    },

    /**
     * Handle a single SSE event that contains a structured block.
     * Returns true if the block was handled, false if not recognized.
     *
     * @param {Object} data - Parsed SSE data object with { type, ... }
     * @param {HTMLElement} container - Target container
     * @returns {boolean} Whether the block was handled
     */
    handleSSEBlock(data, container) {
      if (!data || !data.type) return false;

      if (SchemaRegistry.has(data.type)) {
        BlockRenderer.render(container, [data], { append: true });
        return true;
      }

      return false;
    },

    /**
     * Handle an array of blocks from a non-streaming AI response.
     * Used when the AI returns structured output (not SSE).
     *
     * @param {Array} blocks - Array of structured block objects
     * @param {HTMLElement} container - Target container
     */
    renderStructuredOutput(blocks, container) {
      if (!Array.isArray(blocks) || blocks.length === 0) return;
      BlockRenderer.render(container, blocks);
    }
  };

  // =========================================================================
  // Export
  // =========================================================================

  global.Lex.Orchestrator = LexOrchestrator;

})(typeof window !== 'undefined' ? window : globalThis);
