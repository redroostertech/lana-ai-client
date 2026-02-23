/* ==========================================================================
   Lex UI — <lex-chat-activity>
   Thinking / typing / progress indicator with breathing logo animation.
   Supports phase display and collapsible reasoning drawer.
   Uses lex-chat.css tokens.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, ChatFormat } = global.Lex;
  if (!LexElement) { console.error('[lex-chat-activity] LexElement not loaded'); return; }

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-activity-styles';
    style.textContent = `
      lex-chat-activity {
        display: block;
        padding-bottom: var(--lex-space-md);
      }
      lex-chat-activity[hidden] {
        display: none !important;
      }

      .lex-chat-activity-wrapper {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        animation: lex-chat-fade-in 0.3s ease both;
      }

      .lex-chat-activity-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .lex-chat-activity-message {
        font-size: var(--lex-body-sm-size, 0.875rem);
        color: var(--lex-chat-text-muted);
        font-weight: 500;
      }

      .lex-chat-activity-phase {
        font-family: var(--lex-font-mono);
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--lex-chat-text-dim);
      }

      /* Reasoning drawer */
      .lex-chat-reasoning-drawer {
        margin-top: 6px;
        border-left: 2px solid var(--lex-chat-accent);
        padding-left: 12px;
      }

      .lex-chat-reasoning-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        font-weight: 500;
        color: var(--lex-chat-text-dim);
        transition: color var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-reasoning-toggle:hover { color: var(--lex-chat-text-muted); }

      .lex-chat-reasoning-toggle svg {
        width: 12px; height: 12px;
        transition: transform var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-reasoning-toggle.collapsed svg {
        transform: rotate(-90deg);
      }

      .lex-chat-reasoning-entries {
        margin-top: 6px;
        font-family: var(--lex-font-mono);
        font-size: 11px;
        line-height: 1.6;
        color: var(--lex-chat-text-dim);
        max-height: 200px;
        overflow-y: auto;
      }
      .lex-chat-reasoning-entries.collapsed {
        display: none;
      }

      .lex-chat-reasoning-entry {
        padding: 2px 0;
        border-bottom: 1px solid var(--lex-chat-border-soft);
      }
      .lex-chat-reasoning-entry:last-child {
        border-bottom: none;
      }
    `;
    document.head.appendChild(style);
  }

  // Breathing logo
  const BREATHING_LOGO = `
    <div class="lex-chat-indicator">
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--tl" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M0 0L8 0M0 0L0 8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--br" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M8 8L0 8M8 8L8 0" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </div>`;

  class LexChatActivity extends LexElement {

    static get properties() {
      return {
        active:         { type: Boolean, default: false, reflect: true },
        message:        { type: String, default: 'Thinking...' },
        phase:          { type: String, default: 'thinking' },
        minDisplayTime: { type: Number, default: 500, attribute: 'min-display-time' }
      };
    }

    constructor() {
      super();
      this._showTime = 0;
      this._reasoningEntries = [];
      this._reasoningCollapsed = true;
      this._hideTimeout = null;
    }

    connected() {
      injectStyles();
    }

    render() {
      // Returns null after initial render — DOM managed imperatively
      return null;
    }

    _buildDOM() {
      this.innerHTML = `
        <div class="lex-chat-activity-wrapper">
          ${BREATHING_LOGO}
          <div class="lex-chat-activity-body">
            <div class="lex-chat-activity-message" data-msg></div>
            <div class="lex-chat-activity-phase" data-phase></div>
            <div class="lex-chat-reasoning-drawer" data-drawer style="display:none">
              <div class="lex-chat-reasoning-toggle collapsed" data-toggle>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                <span>View reasoning</span>
              </div>
              <div class="lex-chat-reasoning-entries collapsed" data-entries></div>
            </div>
          </div>
        </div>`;

      // Toggle reasoning drawer
      const toggle = this.querySelector('[data-toggle]');
      if (toggle) {
        toggle.addEventListener('click', () => {
          this._reasoningCollapsed = !this._reasoningCollapsed;
          toggle.classList.toggle('collapsed', this._reasoningCollapsed);
          const entries = this.querySelector('[data-entries]');
          if (entries) entries.classList.toggle('collapsed', this._reasoningCollapsed);
        });
      }

      this._updateDisplay();
    }

    /**
     * Show the activity indicator.
     */
    show(msg, phase) {
      if (msg) this._props.message = msg;
      if (phase) this._props.phase = phase;
      this._props.active = true;
      this._showTime = Date.now();
      this.removeAttribute('hidden');

      if (!this.querySelector('.lex-chat-activity-wrapper')) {
        this._buildDOM();
      }
      this._updateDisplay();
    }

    /**
     * Update the message / phase without hiding.
     */
    update(msg, phase) {
      if (msg) this._props.message = msg;
      if (phase) this._props.phase = phase;
      this._updateDisplay();
    }

    /**
     * Hide the indicator, respecting minDisplayTime.
     */
    hide() {
      if (this._hideTimeout) {
        clearTimeout(this._hideTimeout);
        this._hideTimeout = null;
      }

      const elapsed = Date.now() - this._showTime;
      const remaining = this.minDisplayTime - elapsed;

      if (remaining > 0) {
        this._hideTimeout = setTimeout(() => this._doHide(), remaining);
      } else {
        this._doHide();
      }
    }

    _doHide() {
      this._props.active = false;
      this.setAttribute('hidden', '');
    }

    /**
     * Add a reasoning log entry.
     */
    addReasoningEntry(data) {
      const msg = data.message || data.content || JSON.stringify(data);
      this._reasoningEntries.push(msg);

      // Show drawer
      const drawer = this.querySelector('[data-drawer]');
      if (drawer) drawer.style.display = '';

      // Append entry
      const entries = this.querySelector('[data-entries]');
      if (entries) {
        const el = document.createElement('div');
        el.className = 'lex-chat-reasoning-entry';
        el.textContent = msg;
        entries.appendChild(el);
        entries.scrollTop = entries.scrollHeight;
      }
    }

    /**
     * Clear all reasoning entries.
     */
    clearReasoning() {
      this._reasoningEntries = [];
      const entries = this.querySelector('[data-entries]');
      if (entries) entries.innerHTML = '';
      const drawer = this.querySelector('[data-drawer]');
      if (drawer) drawer.style.display = 'none';
    }

    _updateDisplay() {
      const msgEl = this.querySelector('[data-msg]');
      const phaseEl = this.querySelector('[data-phase]');
      if (msgEl) msgEl.textContent = this.message;
      if (phaseEl) phaseEl.textContent = this.phase;
    }

    disconnected() {
      if (this._hideTimeout) {
        clearTimeout(this._hideTimeout);
        this._hideTimeout = null;
      }
    }
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChatActivity = LexChatActivity;

})(typeof window !== 'undefined' ? window : globalThis);
