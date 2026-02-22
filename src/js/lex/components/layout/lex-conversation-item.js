/* ==========================================================================
   Lex UI — <lex-conversation-item>
   Sidebar conversation list item with dark theme, kebab menu,
   active state accent bar, and hover transitions.

   Usage:
     <lex-conversation-item
       thread-id="abc123"
       title="Law Firm Product Overview"
       subtitle="Brian Moore Injury Law"
       timestamp="1d"
       active>
     </lex-conversation-item>

   Events:
     conversation-select — { threadId, title }
     conversation-menu   — { threadId, title, el }
   ========================================================================== */

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  // Inline SVG icons
  const ICON_FOLDER = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>';
  const ICON_KEBAB = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-conversation-item-styles';
    style.textContent = `
      lex-conversation-item {
        display: block;
        margin-bottom: 2px;
      }

      .lex-conv-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        width: 100%;
        padding: 10px 12px;
        border: none;
        border-radius: var(--lex-radius-lg, 8px);
        background: transparent;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        transition: background 0.2s ease, transform 0.2s ease;
        text-align: left;
        font-family: var(--lex-font-sans);
      }

      /* Accent bar — LANA pattern */
      .lex-conv-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 2px;
        height: 0%;
        background: var(--lex-bg-accent, #736B5C);
        transition: height 0.3s ease;
        border-radius: 1px;
      }

      .lex-conv-item:hover {
        background: var(--lex-sidebar-hover-bg, #2D2B27);
      }

      .lex-conv-item:hover::before {
        height: 40%;
      }

      /* Active state */
      lex-conversation-item[active] .lex-conv-item {
        background: var(--lex-sidebar-active-bg, #2D2B27);
      }

      lex-conversation-item[active] .lex-conv-item::before {
        height: 40%;
        background: var(--lex-bg-accent, #736B5C);
      }

      /* Body */
      .lex-conv-item-body {
        flex: 1;
        min-width: 0;
      }

      .lex-conv-item-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--lex-sidebar-text-active, #FFFFFF);
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      lex-conversation-item[unread] .lex-conv-item-title {
        font-weight: 600;
      }

      .lex-conv-item-subtitle {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 3px;
        font-size: 11px;
        color: var(--lex-sidebar-text-muted, #7A756D);
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .lex-conv-item-subtitle svg {
        flex-shrink: 0;
        opacity: 0.7;
      }

      /* Meta (timestamp + kebab) */
      .lex-conv-item-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .lex-conv-item-time {
        font-size: 11px;
        color: var(--lex-sidebar-section-text, #A9A49D);
        white-space: nowrap;
      }

      .lex-conv-item-menu {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        border-radius: var(--lex-radius-md, 6px);
        background: transparent;
        color: var(--lex-sidebar-text-muted, #7A756D);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
      }

      .lex-conv-item:hover .lex-conv-item-menu {
        opacity: 1;
      }

      .lex-conv-item-menu:hover {
        background: var(--lex-sidebar-border, #2D2B27);
        color: var(--lex-sidebar-text-active, #FFFFFF);
      }

      /* Unread dot */
      .lex-conv-item-unread {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--lex-bg-accent, #736B5C);
        flex-shrink: 0;
        margin-top: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  class LexConversationItem extends LexElement {

    static get properties() {
      return {
        threadId:  { type: String, default: null, attribute: 'thread-id' },
        title:     { type: String, default: '' },
        subtitle:  { type: String, default: '' },
        timestamp: { type: String, default: '' },
        active:    { type: Boolean, default: false, reflect: true },
        unread:    { type: Boolean, default: false, reflect: true }
      };
    }

    connected() {
      injectStyles();
    }

    render() {
      const subtitleHtml = this.subtitle
        ? `<div class="lex-conv-item-subtitle">${ICON_FOLDER}<span>${this._esc(this.subtitle)}</span></div>`
        : '';

      const timeHtml = this.timestamp
        ? `<span class="lex-conv-item-time">${this._esc(this.timestamp)}</span>`
        : '';

      return `
        <div class="lex-conv-item" data-item>
          <div class="lex-conv-item-body">
            <div class="lex-conv-item-title">${this._esc(this.title)}</div>
            ${subtitleHtml}
          </div>
          <div class="lex-conv-item-meta">
            ${timeHtml}
            <button class="lex-conv-item-menu" data-menu type="button">${ICON_KEBAB}</button>
          </div>
        </div>`;
    }

    updated() {
      // Item click → select conversation
      this.delegate('click', '[data-item]', (e) => {
        // Don't fire select if kebab was clicked
        if (e.target.closest('[data-menu]')) return;
        this.emit('conversation-select', {
          threadId: this.threadId,
          title: this.title
        });
      });

      // Kebab click → open menu
      this.delegate('click', '[data-menu]', (e) => {
        e.stopPropagation();
        this.emit('conversation-menu', {
          threadId: this.threadId,
          title: this.title,
          el: e.target.closest('[data-menu]')
        });
      });
    }

    _esc(str) {
      if (!str) return '';
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }
  }

  defineLex('lex-conversation-item', LexConversationItem);

})();
