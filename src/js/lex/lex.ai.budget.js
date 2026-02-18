/* ==========================================================================
   Lex UI — AI Token Budget Manager
   Maps backend intent classifications to relevant block types and manages
   token allocation for schema prompts. Ensures the block vocabulary sent
   to the LLM fits within the system prompt token budget.

   Provides:
     - LexTokenBudget.estimateTokens(text)       — word-count heuristic
     - LexTokenBudget.getBlocksForIntent(intent)  — intent → block type names
     - LexTokenBudget.getAllIntents()              — list known intents
     - LexTokenBudget.MAX_SCHEMA_TOKENS            — hard cap (250)

   The intent names match LANA-AI's unified-intent-classifier.js (40 intents).
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex) { console.error('[Lex TokenBudget] Lex core not loaded'); return; }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /** Max tokens the compact schema should occupy in the system prompt. */
  const MAX_SCHEMA_TOKENS = 250;

  /** Default blocks when intent is unknown or unmapped. */
  const DEFAULT_BLOCKS = ['text', 'suggestion'];

  // ---------------------------------------------------------------------------
  // Intent → Block Type Mapping
  //
  // Each key matches a UNIFIED_INTENT_LABELS value from the backend classifier.
  // Values are arrays of block type names registered in SchemaRegistry.
  // 'text' and 'suggestion' are always included as baseline vocabulary.
  // ---------------------------------------------------------------------------

  const INTENT_BLOCK_MAP = {

    // ── Document intents ──────────────────────────────────────────────────
    document_content_query: [
      'text', 'citation', 'document_ref', 'table', 'suggestion'
    ],
    document_search: [
      'text', 'citation', 'document_ref', 'table', 'suggestion'
    ],
    document_summary: [
      'text', 'citation', 'document_ref', 'metric_card', 'suggestion'
    ],
    document_comparison: [
      'text', 'compare', 'redline', 'table', 'citation', 'suggestion'
    ],
    document_generation: [
      'text', 'decision', 'input_request', 'form_collect', 'suggestion'
    ],
    document_upload: [
      'text', 'action_list', 'suggestion'
    ],
    document_creation: [
      'text', 'decision', 'input_request', 'form_collect', 'action_list', 'suggestion'
    ],

    // ── Matter / Client intents ───────────────────────────────────────────
    matter_query: [
      'text', 'metric_card', 'metric_grid', 'table', 'timeline', 'suggestion'
    ],
    matter_search: [
      'text', 'table', 'action_list', 'suggestion'
    ],
    client_query: [
      'text', 'metric_card', 'table', 'suggestion'
    ],
    matter_creation: [
      'text', 'form_collect', 'decision', 'suggestion'
    ],
    matter_update: [
      'text', 'decision', 'input_request', 'suggestion'
    ],
    client_creation: [
      'text', 'form_collect', 'decision', 'suggestion'
    ],

    // ── Task / Workflow intents ───────────────────────────────────────────
    task_query: [
      'text', 'table', 'timeline', 'action_list', 'suggestion'
    ],
    deadline_query: [
      'text', 'timeline', 'metric_card', 'table', 'suggestion'
    ],
    appointment_query: [
      'text', 'timeline', 'table', 'suggestion'
    ],
    task_creation: [
      'text', 'form_collect', 'decision', 'input_request', 'suggestion'
    ],
    task_update: [
      'text', 'decision', 'input_request', 'suggestion'
    ],
    appointment_creation: [
      'text', 'form_collect', 'decision', 'suggestion'
    ],
    reminder_creation: [
      'text', 'input_request', 'decision', 'suggestion'
    ],
    note_creation: [
      'text', 'input_request', 'suggestion'
    ],

    // ── Activity / Analytics intents ──────────────────────────────────────
    activity_query: [
      'text', 'timeline', 'table', 'metric_card', 'suggestion'
    ],
    kpi_query: [
      'text', 'metric_card', 'metric_grid', 'table', 'suggestion'
    ],
    analytics_query: [
      'text', 'metric_card', 'metric_grid', 'table', 'progress_metric', 'suggestion'
    ],
    notification_query: [
      'text', 'action_list', 'timeline', 'suggestion'
    ],

    // ── Integration intents ───────────────────────────────────────────────
    integration_query: [
      'text', 'table', 'action_list', 'suggestion'
    ],

    // ── General intents ───────────────────────────────────────────────────
    direct_answer: [
      'text', 'suggestion'
    ],
    general_chat: [
      'text', 'suggestion'
    ],
    multi_step: [
      'text', 'action_list', 'decision', 'timeline', 'suggestion'
    ],
    ai_insights: [
      'text', 'metric_card', 'metric_grid', 'table', 'action_list', 'suggestion'
    ],
    workflow_automation: [
      'text', 'action_list', 'decision', 'form_collect', 'timeline', 'suggestion'
    ],
    search_query: [
      'text', 'table', 'citation', 'document_ref', 'suggestion'
    ],
    summarization: [
      'text', 'metric_card', 'citation', 'suggestion'
    ],

    // ── State change intents (minimal UI — these are commands, not queries) ──
    document_add_request: ['text', 'suggestion'],
    document_remove_request: ['text', 'suggestion'],
    document_clear_request: ['text', 'suggestion'],
    mode_switch_research: ['text', 'suggestion'],
    mode_switch_drafting: ['text', 'suggestion'],
    mode_switch_general: ['text', 'suggestion'],
    persona_change: ['text', 'suggestion']
  };

  // ---------------------------------------------------------------------------
  // LexTokenBudget
  // ---------------------------------------------------------------------------

  const LexTokenBudget = {

    /** Hard cap for schema portion of system prompt. */
    MAX_SCHEMA_TOKENS,

    /**
     * Estimate token count from text using word-count heuristic.
     * Roughly: tokens ≈ words × 1.3 (accounts for punctuation, JSON syntax).
     * @param {string} text
     * @returns {number}
     */
    estimateTokens(text) {
      if (!text) return 0;
      const words = text.split(/\s+/).filter(Boolean).length;
      return Math.ceil(words * 1.3);
    },

    /**
     * Get relevant block type names for a given intent.
     * @param {string} intent — one of the 40 backend intent labels
     * @returns {string[]} — block type names (always includes 'text')
     */
    getBlocksForIntent(intent) {
      if (!intent) return DEFAULT_BLOCKS;
      return INTENT_BLOCK_MAP[intent] || DEFAULT_BLOCKS;
    },

    /**
     * Get block types for multiple intents (union of all).
     * Useful when intent confidence is split across categories.
     * @param {string[]} intents
     * @returns {string[]} — deduplicated block type names
     */
    getBlocksForIntents(intents) {
      if (!Array.isArray(intents) || intents.length === 0) return DEFAULT_BLOCKS;
      const set = new Set();
      for (const intent of intents) {
        const blocks = this.getBlocksForIntent(intent);
        blocks.forEach(b => set.add(b));
      }
      return Array.from(set);
    },

    /**
     * Check if a compact prompt for given blocks fits within the token budget.
     * @param {string} compactPrompt — generated by SchemaRegistry.toCompactPrompt()
     * @returns {{ fits: boolean, tokens: number, budget: number }}
     */
    checkFit(compactPrompt) {
      const tokens = this.estimateTokens(compactPrompt);
      return {
        fits: tokens <= MAX_SCHEMA_TOKENS,
        tokens,
        budget: MAX_SCHEMA_TOKENS
      };
    },

    /**
     * Get all known intent names.
     * @returns {string[]}
     */
    getAllIntents() {
      return Object.keys(INTENT_BLOCK_MAP);
    },

    /**
     * Get the default block set (used when no intent is available).
     * @returns {string[]}
     */
    getDefaultBlocks() {
      return [...DEFAULT_BLOCKS];
    },

    /**
     * Get the raw intent-to-block mapping (for debugging/visualization).
     * @returns {Object}
     */
    getIntentMap() {
      return { ...INTENT_BLOCK_MAP };
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  Lex.TokenBudget = LexTokenBudget;

})(typeof window !== 'undefined' ? window : globalThis);
