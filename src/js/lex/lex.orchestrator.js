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

    /**
     * Get the system prompt fragment that describes available UI blocks.
     * Append this to the LLM's system prompt.
     */
    getSystemPromptAddendum() {
      return SchemaRegistry.toSystemPrompt();
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
