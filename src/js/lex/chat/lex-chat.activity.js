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
        padding: 0 0 6px;
      }
      lex-chat-activity[hidden] {
        display: none !important;
      }

      .lex-chat-activity-wrapper {
        display: inline-flex;
        max-width: min(720px, 100%);
        gap: 8px;
        align-items: flex-start;
        padding: 6px 10px;
        border: 1px solid var(--lex-chat-border-soft, rgba(0,0,0,0.08));
        border-radius: 999px;
        background: color-mix(in srgb, var(--lex-chat-bg-surface, #fff) 82%, transparent);
        opacity: 0.82;
        animation: lex-chat-fade-in 0.3s ease both;
      }

      .lex-chat-activity-wrapper .lex-chat-indicator {
        width: 20px;
        height: 20px;
        margin-top: 1px;
        opacity: 0.58;
        transform: scale(0.72);
        transform-origin: top left;
      }

      .lex-chat-activity-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .lex-chat-activity-message {
        font-size: 0.75rem;
        color: var(--lex-chat-text-muted);
        font-weight: 500;
        line-height: 1.25;
      }

      .lex-chat-activity-phase {
        font-family: var(--lex-font-mono);
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--lex-chat-text-dim);
      }

      /* Reasoning drawer */
      .lex-chat-reasoning-drawer {
        margin-top: 3px;
        border-left: 2px solid var(--lex-chat-accent);
        padding-left: 8px;
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
        message:        { type: String, default: 'Working...' },
        phase:          { type: String, default: '' },
        minDisplayTime: { type: Number, default: 500, attribute: 'min-display-time' }
      };
    }

    constructor() {
      super();
      this._showTime = 0;
      this._reasoningEntries = [];
      this._lastReasoningEntry = null;
      this._reasoningCollapsed = true;
      this._hideTimeout = null;
      // Optional secondary line shown ABOVE the main message (e.g.
      // "Executing find organization users..." sits above "Working...").
      this._primary = '';
      // When true, the main message is rendered as innerHTML so callers
      // can include light formatting like "<strong>Completed</strong>".
      this._messageIsHtml = false;
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
            <div class="lex-chat-activity-primary" data-primary style="display:none;font-size:0.72rem;color:var(--lex-chat-text-dim,#8a8177);line-height:1.25;"></div>
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
     * Apply a structured update.
     *   { primary, message, phase, html }
     * - primary (string) — small line above the main message ('' clears it)
     * - message (string) — main line
     * - phase   (string) — small label below the main message
     * - html    (boolean) — when true, message is rendered as innerHTML
     *
     * Plain string forms still work (msg, phase) for backwards compatibility.
     */
    _applyOptions(arg, phase) {
      if (arg && typeof arg === 'object') {
        if ('primary' in arg) this._primary = String(arg.primary || '');
        if ('message' in arg && arg.message != null) this._props.message = String(arg.message);
        if ('phase' in arg && arg.phase != null) this._props.phase = String(arg.phase);
        this._messageIsHtml = !!arg.html;
      } else {
        if (arg) this._props.message = arg;
        if (phase) this._props.phase = phase;
        // Plain string callers always want plain text rendering.
        this._messageIsHtml = false;
      }
    }

    /**
     * Show the activity indicator.
     */
    show(msg, phase) {
      this._applyOptions(msg, phase);
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
      this._applyOptions(msg, phase);
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
      const progressEvents = global.Lex.Chat && global.Lex.Chat.ProgressEvents;
      const eventKey = progressEvents ? progressEvents.getProgressEventKey(data) : '';

      if (
        progressEvents
        && this._lastReasoningEntry
        && progressEvents.shouldReplaceConsecutive(this._lastReasoningEntry.key, data)
      ) {
        this._lastReasoningEntry.updates += 1;
        this._reasoningEntries[this._reasoningEntries.length - 1] = msg;
        if (this._lastReasoningEntry.element) {
          this._lastReasoningEntry.element.textContent = msg;
          this._lastReasoningEntry.element.title =
            `Updated ${this._lastReasoningEntry.updates} times by consecutive progress events`;
        }
        return;
      }

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
        this._lastReasoningEntry = {
          key: eventKey,
          updates: 1,
          element: el
        };
      } else {
        this._lastReasoningEntry = {
          key: eventKey,
          updates: 1,
          element: null
        };
      }
    }

    /**
     * Clear all reasoning entries.
     */
    clearReasoning() {
      this._reasoningEntries = [];
      this._lastReasoningEntry = null;
      const entries = this.querySelector('[data-entries]');
      if (entries) entries.innerHTML = '';
      const drawer = this.querySelector('[data-drawer]');
      if (drawer) drawer.style.display = 'none';
    }

    _updateDisplay() {
      const primaryEl = this.querySelector('[data-primary]');
      const msgEl = this.querySelector('[data-msg]');
      const phaseEl = this.querySelector('[data-phase]');

      if (primaryEl) {
        if (this._primary) {
          primaryEl.textContent = this._primary;
          primaryEl.style.display = '';
        } else {
          primaryEl.textContent = '';
          primaryEl.style.display = 'none';
        }
      }
      if (msgEl) {
        if (this._messageIsHtml) {
          msgEl.innerHTML = this.message;
        } else {
          msgEl.textContent = this.message;
        }
      }
      if (phaseEl) {
        // Hide the phase row entirely when there's nothing meaningful to
        // show — keeps the activity bar from flashing a stray "TOOL" label
        // below "Working..." when callers don't supply one.
        if (this.phase) {
          phaseEl.textContent = this.phase;
          phaseEl.style.display = '';
        } else {
          phaseEl.textContent = '';
          phaseEl.style.display = 'none';
        }
      }
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
