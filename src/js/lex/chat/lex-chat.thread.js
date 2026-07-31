/* ==========================================================================
   Lex UI — <lex-chat-thread>
   Scrollable message container with smart auto-scroll, pagination,
   and imperative child management (render returns null).
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, ChatFormat } = global.Lex;
  const Chat = global.Lex.Chat || {};
  if (!LexElement) { console.error('[lex-chat-thread] LexElement not loaded'); return; }

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-thread-styles';
    style.textContent = `
      lex-chat-thread {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        position: relative;
      }

      /* Soft fade at bottom edge where thread meets composer */
      lex-chat-thread::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 40px;
        background: linear-gradient(
          to bottom,
          transparent 0%,
          var(--lex-chat-bg, #f8f8f6) 100%
        );
        pointer-events: none;
        z-index: 1;
      }

      .lex-chat-thread-scroller {
        flex: 1;
        overflow-y: auto;
      }

      .lex-chat-thread-container {
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 24px 16px;
      }

      .lex-chat-thread-anchor {
        height: 1px;
        width: 100%;
      }

      /* Welcome message */
      .lex-chat-welcome {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        flex: 1;
        padding: 24px;
        padding-bottom: 12px;
        text-align: center;
      }

      .lex-chat-welcome-subtitle {
        font-size: var(--lex-heading-h2-size, 1.5rem);
        font-weight: 600;
        color: var(--lex-chat-text);
        max-width: 500px;
        line-height: 1.4;
      }

      /* Load more trigger */
      .lex-chat-load-more {
        display: flex;
        justify-content: center;
        padding: 8px;
      }
      .lex-chat-load-more-btn {
        font-size: 11px;
        font-weight: 500;
        color: var(--lex-chat-text-dim);
        background: none;
        border: 1px solid var(--lex-chat-border-soft);
        border-radius: var(--lex-radius-md, 6px);
        padding: 4px 12px;
        cursor: pointer;
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-load-more-btn:hover {
        background: var(--lex-chat-bg-surface);
      }
    `;
    document.head.appendChild(style);
  }

  // Breathing logo for welcome
  const WELCOME_LOGO = `
    <div class="lex-chat-indicator lex-chat-indicator--static">
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--tl" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M0 0L8 0M0 0L0 8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--br" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M8 8L0 8M8 8L8 0" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </div>`;

  class LexChatThread extends LexElement {

    static get properties() {
      return {
        scrollThreshold: { type: Number, default: 100, attribute: 'scroll-threshold' },
        loading:         { type: Boolean, default: false, reflect: true },
        hasMore:         { type: Boolean, default: false, attribute: 'has-more' }
      };
    }

    constructor() {
      super();
      this._scroller = null;
      this._container = null;
      this._anchor = null;
      this._lastAssistantMsg = null;
      this._messages = [];
    }

    connected() {
      injectStyles();
      this._buildDOM();
    }

    // Imperative DOM management — don't re-render
    render() { return null; }

    _buildDOM() {
      this.innerHTML = `
        <div class="lex-chat-thread-scroller" data-scroller>
          <div class="lex-chat-thread-container" data-container></div>
          <div class="lex-chat-thread-anchor" data-anchor></div>
        </div>`;

      this._scroller = this.querySelector('[data-scroller]');
      this._container = this.querySelector('[data-container]');
      this._anchor = this.querySelector('[data-anchor]');

      // Scroll-to-top detection for pagination
      if (this._scroller) {
        this._scroller.addEventListener('scroll', () => {
          if (this._scroller.scrollTop < 20 && this.hasMore && !this.loading) {
            this.emit('lex-thread-scroll-top');
          }
        });
      }
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Add a message to the thread.
     * @param {string} role - 'user' | 'assistant' | 'system'
     * @param {string} content
     * @param {Object} meta - { messageId, timestamp, citations, references, artifacts }
     * @returns {HTMLElement} The created lex-chat-message element
     */
    addMessage(role, content, meta = {}) {
      if (!this._container) return null;

      // Hide welcome if present
      const welcome = this._container.querySelector('.lex-chat-welcome');
      if (welcome) welcome.remove();

      const msg = document.createElement('lex-chat-message');
      msg.role = role;
      msg.content = content;
      if (meta.messageId) msg.messageId = meta.messageId;
      if (meta.timestamp) msg.timestamp = meta.timestamp;
      if (meta.citations) msg.citations = meta.citations;
      if (meta.references) msg.references = meta.references;
      if (meta.artifacts) msg.artifacts = meta.artifacts;
      if (meta.attachments) msg.attachments = meta.attachments;
      if (meta.duration != null) msg.duration = meta.duration;
      if (meta.tokenCount != null) msg.tokenCount = meta.tokenCount;

      this._container.appendChild(msg);
      this._messages.push(msg);

      if (role === 'assistant') {
        this._lastAssistantMsg = msg;
      }

      // User messages always scroll; assistant uses smart scroll
      if (role === 'user' || this._isNearBottom()) {
        this.scrollToBottom();
      }

      return msg;
    }

    /**
     * Add a system message (centered, temporary-looking).
     */
    addSystemMessage(content) {
      return this.addMessage('system', content);
    }

    /**
     * Start streaming an assistant message.
     * @returns {HTMLElement} The streaming message element
     */
    startAssistantMessage() {
      if (!this._container) return null;

      const welcome = this._container.querySelector('.lex-chat-welcome');
      if (welcome) welcome.remove();

      const msg = document.createElement('lex-chat-message');
      msg.role = 'assistant';
      msg.streaming = true;
      msg.content = '';

      this._container.appendChild(msg);
      this._messages.push(msg);
      this._lastAssistantMsg = msg;

      return msg;
    }

    /**
     * Append content to the last assistant message (streaming).
     */
    updateLastAssistantMessage(chunk) {
      if (this._lastAssistantMsg) {
        this._lastAssistantMsg.appendContent(chunk);

        if (this._isNearBottom()) {
          this.scrollToBottom();
        }
      }
    }

    /**
     * Finalize the last assistant message.
     */
    finalizeLastMessage(meta = {}) {
      if (this._lastAssistantMsg) {
        this._lastAssistantMsg.finalize(meta);
      }
    }

    /**
     * Get the last assistant message element.
     */
    getLastAssistantMessage() {
      return this._lastAssistantMsg;
    }

    /**
     * Scroll to bottom.
     */
    scrollToBottom(force) {
      if (!this._scroller) return;
      if (force || this._isNearBottom()) {
        requestAnimationFrame(() => {
          this._scroller.scrollTop = this._scroller.scrollHeight;
        });
      }
    }

    /**
     * Clear all messages and optionally show welcome.
     */
    clear() {
      this._messages = [];
      this._lastAssistantMsg = null;
      if (this._container) this._container.innerHTML = '';
    }

    /**
     * Show a welcome message.
     */
    showWelcome(msg) {
      if (!this._container) return;
      this.clear();

      const welcome = document.createElement('div');
      welcome.className = 'lex-chat-welcome';
      welcome.innerHTML = `
        <div class="lex-chat-welcome-subtitle">${msg || 'I\'m Lana, your AI assistant. How can I help you today?'}</div>`;
      this._container.appendChild(welcome);
    }

    /**
     * Prepend older messages (for pagination).
     * @param {Array} msgs - [{ role, content, messageId, timestamp }]
     */
    prependMessages(msgs) {
      if (!this._container || !msgs || msgs.length === 0) return;

      // Save scroll position
      const scrollH = this._scroller.scrollHeight;

      const frag = document.createDocumentFragment();
      for (const m of msgs) {
        const msg = document.createElement('lex-chat-message');
        msg.role = m.role;
        msg.content = m.content;
        if (m.messageId) msg.messageId = m.messageId;
        if (m.timestamp) msg.timestamp = m.timestamp;
        if (m.duration != null) msg.duration = m.duration;
        if (m.tokenCount != null) msg.tokenCount = m.tokenCount;
        frag.appendChild(msg);
      }

      this._container.insertBefore(frag, this._container.firstChild);

      // Restore scroll position (keep view steady)
      requestAnimationFrame(() => {
        const newScrollH = this._scroller.scrollHeight;
        this._scroller.scrollTop = newScrollH - scrollH;
      });
    }

    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------

    _isNearBottom() {
      if (!this._scroller) return true;
      return this._scroller.scrollHeight - this._scroller.scrollTop - this._scroller.clientHeight < this.scrollThreshold;
    }
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChatThread = LexChatThread;

})(typeof window !== 'undefined' ? window : globalThis);
