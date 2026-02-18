/* ==========================================================================
   Lex UI — Action Bridge
   Bidirectional connector between AI blocks and the chat conversation.
   Catches block interaction events, composes contextual messages, and
   sends them back through the ChatSource — closing the loop.

   Also handles:
     - Block rejection ("Not what I wanted") with feedback to backend
     - Activity context enrichment on outgoing messages
     - Visual state management (disabled/dimmed after interaction)

   Usage:
     const bridge = new Lex.ActionBridge();
     bridge.attach(chatElement, { feedbackEndpoint: '/api/v1/feedback/' });
     // ... later:
     bridge.detach();

   Provides:
     - LexActionBridge (class)
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex) { console.error('[Lex ActionBridge] Lex core not loaded'); return; }

  // ---------------------------------------------------------------------------
  // Styles for block interaction states
  // ---------------------------------------------------------------------------

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-action-bridge-styles';
    style.textContent = `
      /* ── Responded state — block was interacted with ─── */
      .lex-block-responded {
        opacity: 0.55;
        pointer-events: none;
        position: relative;
        transition: opacity var(--lex-transition-normal, 200ms) ease;
      }
      .lex-block-responded::after {
        content: '';
        position: absolute;
        inset: 0;
        background: transparent;
        pointer-events: none;
      }

      /* ── Rejected state — user said "not what I wanted" ─── */
      .lex-block-rejected {
        opacity: 0.4;
        pointer-events: none;
        border-left: 2px solid var(--lex-color-danger-500, #DC2626);
        position: relative;
        transition: opacity var(--lex-transition-normal, 200ms) ease;
      }

      /* ── Dismiss button on interactive blocks ─── */
      .lex-block-dismiss {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--lex-radius-sm, 4px);
        border: none;
        background: transparent;
        color: var(--lex-text-tertiary, #999);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--lex-transition-fast, 150ms) ease,
                    background var(--lex-transition-fast, 150ms) ease;
        z-index: 2;
        padding: 0;
        font-size: 12px;
        line-height: 1;
      }
      .lex-block:hover .lex-block-dismiss,
      .lex-block-dismiss:focus {
        opacity: 1;
      }
      .lex-block-dismiss:hover {
        background: var(--lex-color-danger-bg, #FEF2F2);
        color: var(--lex-color-danger-500, #DC2626);
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Interactive block types that the bridge should add dismiss buttons to
  // ---------------------------------------------------------------------------

  const INTERACTIVE_BLOCK_TYPES = new Set([
    'suggestion', 'action_list', 'decision',
    'input_request', 'form_collect'
  ]);

  // ---------------------------------------------------------------------------
  // LexActionBridge
  // ---------------------------------------------------------------------------

  class LexActionBridge {

    constructor() {
      this._chatEl = null;
      this._options = {};
      this._listeners = [];
      this._attached = false;
    }

    /**
     * Attach the bridge to a lex-chat element.
     * @param {HTMLElement} chatElement — the <lex-chat> component
     * @param {Object} [options]
     * @param {string} [options.feedbackEndpoint] — e.g. '/api/v1/feedback/'
     * @param {Function} [options.getToken] — returns auth token for API calls
     * @param {Function} [options.getBaseUrl] — returns API base URL
     */
    attach(chatElement, options) {
      if (this._attached) this.detach();

      injectStyles();

      this._chatEl = chatElement;
      this._options = options || {};
      this._attached = true;

      // Register event listeners
      this._on('lex-suggestion', this._handleSuggestion.bind(this));
      this._on('lex-action', this._handleAction.bind(this));
      this._on('lex-decision', this._handleDecision.bind(this));
      this._on('lex-input-response', this._handleInputResponse.bind(this));
      this._on('lex-form-submit', this._handleFormSubmit.bind(this));
      this._on('lex-block-reject', this._handleBlockReject.bind(this));

      // Observe new blocks being rendered to add dismiss buttons
      this._observer = new MutationObserver(this._onDomMutation.bind(this));
      this._observer.observe(chatElement, { childList: true, subtree: true });
    }

    /**
     * Detach the bridge and remove all listeners.
     */
    detach() {
      for (const { event, handler } of this._listeners) {
        this._chatEl?.removeEventListener(event, handler);
      }
      this._listeners = [];
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      this._chatEl = null;
      this._attached = false;
    }

    /**
     * Check if the bridge is currently attached.
     */
    get attached() {
      return this._attached;
    }

    // ── Event Handlers ──────────────────────────────────────────────────

    _handleSuggestion(e) {
      const { value, item } = e.detail || {};
      if (!value) return;

      const message = value; // Suggestions are direct user choices — send as-is
      this._markResponded(e.target);
      this._trackAndSend(message, 'suggestion', e.detail);
    }

    _handleAction(e) {
      const { action, item } = e.detail || {};
      if (!item) return;

      const label = item.label || action || 'unknown';
      const desc = item.description ? ` — ${item.description}` : '';
      const message = `[ACTION] ${label}${desc}`;

      this._markResponded(e.target);
      this._trackAndSend(message, 'action', e.detail);
    }

    _handleDecision(e) {
      const { value, label, custom } = e.detail || {};
      if (!value && !custom) return;

      const chosen = label || custom || value;
      const message = `[DECISION] ${chosen}`;

      this._markResponded(e.target);
      this._trackAndSend(message, 'decision', e.detail);
    }

    _handleInputResponse(e) {
      const { field, value } = e.detail || {};
      if (!value) return;

      const message = `[INPUT ${field || 'response'}] ${value}`;

      this._markResponded(e.target);
      this._trackAndSend(message, 'input', e.detail);
    }

    _handleFormSubmit(e) {
      const { values } = e.detail || {};
      if (!values) return;

      // Compose a readable summary instead of raw JSON
      const parts = Object.entries(values)
        .filter(([, v]) => v !== '' && v !== null && v !== undefined)
        .map(([k, v]) => `${k}: ${v}`);
      const message = `[FORM] ${parts.join(', ')}`;

      this._markResponded(e.target);
      this._trackAndSend(message, 'form', e.detail);
    }

    _handleBlockReject(e) {
      const { blockType, messageId, reason } = e.detail || {};
      const message = `[REJECT] That's not what I needed${reason ? ': ' + reason : ''}. Please try a different approach.`;

      this._markRejected(e.target);
      this._trackAndSend(message, 'reject', e.detail);

      // Fire-and-forget feedback to backend
      this._submitFeedback(messageId, blockType, reason);
    }

    // ── Core send logic ─────────────────────────────────────────────────

    _trackAndSend(message, interactionType, detail) {
      // Track the interaction for activity context
      const ActivityContext = Lex.ActivityContext;
      if (ActivityContext) {
        ActivityContext.track('block_interact', {
          interactionType,
          detail: detail || null
        });
      }

      // Send through the chat element
      if (this._chatEl && typeof this._chatEl.send === 'function') {
        this._chatEl.send(message);
      }
    }

    // ── Visual state management ─────────────────────────────────────────

    _markResponded(target) {
      const block = this._findBlockWrapper(target);
      if (block) {
        block.classList.add('lex-block-responded');
      }
    }

    _markRejected(target) {
      const block = this._findBlockWrapper(target);
      if (block) {
        block.classList.add('lex-block-rejected');
      }
    }

    _findBlockWrapper(el) {
      // Walk up to find the .lex-block wrapper created by BlockRenderer
      let node = el;
      while (node && node !== this._chatEl) {
        if (node.classList && node.classList.contains('lex-block')) return node;
        node = node.parentElement;
      }
      return null;
    }

    // ── Dismiss button injection ────────────────────────────────────────

    _onDomMutation(mutations) {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Check the added node itself and descendants for .lex-block elements
          const blocks = node.classList?.contains('lex-block')
            ? [node]
            : Array.from(node.querySelectorAll?.('.lex-block') || []);

          for (const block of blocks) {
            this._addDismissButton(block);
          }
        }
      }
    }

    _addDismissButton(blockEl) {
      const blockType = blockEl.dataset?.blockType;
      if (!blockType || !INTERACTIVE_BLOCK_TYPES.has(blockType)) return;
      if (blockEl.querySelector('.lex-block-dismiss')) return; // Already has one

      // Make the block relatively positioned for the absolute dismiss button
      blockEl.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'lex-block-dismiss';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Dismiss this suggestion');
      btn.title = 'Not what I wanted';
      btn.innerHTML = '&times;';

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        blockEl.dispatchEvent(new CustomEvent('lex-block-reject', {
          detail: {
            blockType,
            messageId: this._findMessageId(blockEl),
            reason: null
          },
          bubbles: true
        }));
      });

      blockEl.appendChild(btn);
    }

    _findMessageId(blockEl) {
      // Walk up to find a message element with a data-message-id attribute
      let node = blockEl;
      while (node && node !== this._chatEl) {
        if (node.dataset?.messageId) return node.dataset.messageId;
        node = node.parentElement;
      }
      return null;
    }

    // ── Feedback API ────────────────────────────────────────────────────

    async _submitFeedback(messageId, blockType, reason) {
      if (!messageId) return; // Can't submit without a message ID

      const endpoint = this._options.feedbackEndpoint || '/api/v1/feedback/';
      const getToken = this._options.getToken || (() => localStorage.getItem('token') || '');
      const getBaseUrl = this._options.getBaseUrl || (() => {
        const api = global.api;
        return api?.baseUrl || '';
      });

      try {
        const baseUrl = getBaseUrl();
        const token = getToken();
        if (!baseUrl) return;

        await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            messageId,
            wasHelpful: false,
            feedbackType: 'response_quality',
            details: {
              blockType,
              rejectionReason: reason || 'Block dismissed by user',
              source: 'lex_action_bridge'
            }
          })
        });
      } catch (_) {
        // Best-effort — don't break the UI if feedback fails
      }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    _on(event, handler) {
      this._chatEl.addEventListener(event, handler);
      this._listeners.push({ event, handler });
    }
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  Lex.ActionBridge = LexActionBridge;

})(typeof window !== 'undefined' ? window : globalThis);
