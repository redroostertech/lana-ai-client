/**
 * Rename Conversation Helper
 *
 * Single source of truth for renaming a conversation thread from the client.
 * Wraps the PATCH /api/v1/conversations/:id call, validates input, and
 * fans out a window-level `conversation:renamed` CustomEvent so any mounted
 * view (chat header, sidebar menu, workspace Conversations tab) can react
 * without coupling to each other.
 *
 * NOTE: NO regex — string methods only (per LEX-COMPONENT-RULES section 11).
 */

(function (root) {
  'use strict';

  /**
   * Trim leading/whitespace + interior collapse without regex.
   * Returns the trimmed input; empty string if nothing remains.
   */
  function trimTitle(input) {
    if (input === null || input === undefined) return '';
    var str = String(input);
    // Trim — String.prototype.trim is regex-free at the API level
    return str.trim();
  }

  /**
   * Validate a candidate title before sending to the backend.
   * Pure function so it's trivially testable.
   *
   * @param {string} candidate
   * @returns {{ valid: boolean, value: string, error?: string }}
   */
  function validateTitle(candidate) {
    var trimmed = trimTitle(candidate);
    if (!trimmed) {
      return { valid: false, value: '', error: 'Conversation name cannot be empty' };
    }
    if (trimmed.length > 200) {
      return { valid: false, value: trimmed, error: 'Conversation name is too long (max 200 characters)' };
    }
    return { valid: true, value: trimmed };
  }

  /**
   * Emit the rename event on the provided event target (default: window).
   * Listeners can update their own views in response.
   *
   * @param {{ threadId: string, title: string, target?: EventTarget }} opts
   */
  function emitRenamed(opts) {
    var detail = {
      threadId: opts.eventThreadId || opts.threadId,
      registryId: opts.registryId || opts.threadId,
      title: opts.title
    };
    var target = opts.target || (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.dispatchEvent !== 'function') return;
    // CustomEvent should exist in any modern Electron renderer / jsdom test env.
    var ev = new CustomEvent('conversation:renamed', { detail: detail });
    target.dispatchEvent(ev);
  }

  /**
   * Rename a conversation thread via the backend.
   *
   * @param {object} deps
   * @param {object} deps.api - api client with .updateConversation()
   * @param {string} deps.threadId - conversation_threads row id or chat session thread_id
   * @param {string} [deps.eventThreadId] - stream thread_id to emit for row listeners
   * @param {string} [deps.registryId] - conversation_threads row id to emit for registry listeners
   * @param {string} deps.title - new title (will be trimmed/validated)
   * @param {EventTarget} [deps.eventTarget] - test seam; defaults to window
   * @returns {Promise<{ threadId: string, title: string }>}
   */
  async function renameConversation(deps) {
    if (!deps || !deps.api || typeof deps.api.updateConversation !== 'function') {
      throw new Error('renameConversation: api.updateConversation is required');
    }
    if (!deps.threadId) {
      throw new Error('renameConversation: threadId is required');
    }

    var v = validateTitle(deps.title);
    if (!v.valid) {
      var err = new Error(v.error);
      err.code = 'INVALID_TITLE';
      throw err;
    }

    await deps.api.updateConversation(deps.threadId, { title: v.value });

    emitRenamed({
      threadId: deps.threadId,
      eventThreadId: deps.eventThreadId,
      registryId: deps.registryId,
      title: v.value,
      target: deps.eventTarget
    });

    return { threadId: deps.threadId, title: v.value };
  }

  var api = {
    renameConversation: renameConversation,
    validateTitle: validateTitle,
    emitRenamed: emitRenamed,
    EVENT_NAME: 'conversation:renamed'
  };

  // Browser/Electron global
  if (root && typeof root === 'object') {
    root.RenameConversation = api;
  }

  // CommonJS for Jest
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
