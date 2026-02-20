/* Lex UI — Tabs Component
   Horizontal tab navigation with underline and pills variants.
   Supports optional icons, horizontal scroll for overflow, and
   keyboard navigation.

   Usage:
     <lex-tabs id="matterTabs" active="details"></lex-tabs>

     var tabs = document.getElementById('matterTabs');
     tabs.setAttribute('tabs', JSON.stringify([
       { id: 'details',       label: 'Details',       icon: 'file-text' },
       { id: 'documents',     label: 'Documents',     icon: 'file' },
       { id: 'conversations', label: 'Conversations', icon: 'message-square' }
     ]));
     tabs.addEventListener('tab-change', function (e) {
       showTabContent(e.detail.tab);
     });

   Properties:
     tabs     Array    []          Array of { id, label, icon? } objects
     active   String   ''          ID of the currently selected tab
     variant  String   'underline' 'underline' | 'pills'

   Events:
     tab-change  { tab: 'tabId', previous: 'prevTabId' }
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  // ---------------------------------------------------------------------------
  // Style injection (once)
  // ---------------------------------------------------------------------------

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-tabs-styles';
    style.textContent = `

      /* ── Host ───────────────────────────────────────────── */

      lex-tabs {
        display: block;
      }

      /* ── Tab list wrapper ───────────────────────────────── */

      .lex-tabs-list {
        display: flex;
        align-items: flex-end;
        gap: 0;
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        -webkit-overflow-scrolling: touch;
        position: relative;
      }

      .lex-tabs-list::-webkit-scrollbar {
        display: none;
      }

      /* Underline variant — bottom border track */
      .lex-tabs-list--underline {
        border-bottom: 1px solid var(--lex-border-default);
      }

      /* Pills variant — background container */
      .lex-tabs-list--pills {
        background: var(--lex-bg-tertiary);
        border-radius: var(--lex-radius-lg);
        padding: 3px;
        gap: 2px;
        align-items: center;
      }

      /* ── Tab button shared ──────────────────────────────── */

      .lex-tab-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        white-space: nowrap;
        border: none;
        cursor: pointer;
        font-family: var(--lex-font-sans, inherit);
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-medium, 500);
        background: none;
        outline: none;
        transition:
          color var(--lex-transition-fast),
          background var(--lex-transition-fast),
          border-color var(--lex-transition-fast);
        flex-shrink: 0;
      }

      .lex-tab-btn:focus-visible {
        outline: 2px solid var(--lex-border-focus);
        outline-offset: -2px;
        border-radius: var(--lex-radius-md);
      }

      /* ── Underline variant tab ──────────────────────────── */

      .lex-tabs-list--underline .lex-tab-btn {
        padding: 0.5rem 0.875rem;
        color: var(--lex-text-secondary);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        border-radius: var(--lex-radius-md) var(--lex-radius-md) 0 0;
      }

      .lex-tabs-list--underline .lex-tab-btn:hover:not(.lex-tab-btn--active) {
        color: var(--lex-text-primary);
        background: var(--lex-bg-tertiary);
        border-bottom-color: var(--lex-border-strong);
      }

      .lex-tabs-list--underline .lex-tab-btn--active {
        color: var(--lex-text-accent);
        border-bottom-color: var(--lex-border-accent);
      }

      /* ── Pills variant tab ──────────────────────────────── */

      .lex-tabs-list--pills .lex-tab-btn {
        padding: 0.375rem 0.75rem;
        color: var(--lex-text-secondary);
        border-radius: var(--lex-radius-md);
      }

      .lex-tabs-list--pills .lex-tab-btn:hover:not(.lex-tab-btn--active) {
        color: var(--lex-text-primary);
        background: var(--lex-bg-secondary);
      }

      .lex-tabs-list--pills .lex-tab-btn--active {
        color: var(--lex-text-primary);
        background: var(--lex-bg-primary);
        box-shadow: var(--lex-shadow-sm);
      }

      /* ── Tab icon ───────────────────────────────────────── */

      .lex-tab-btn svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }

    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // LexTabs
  // ---------------------------------------------------------------------------

  class LexTabs extends LexElement {
    static get properties() {
      return {
        tabs:    { type: Array,   default: [] },
        active:  { type: String,  default: '' },
        variant: { type: String,  default: 'underline' }
      };
    }

    constructor() {
      super();
      // _tabs is the resolved internal list — set in render from this.tabs
      this._tabs = [];
    }

    render() {
      injectStyles();

      const tabs = Array.isArray(this.tabs) ? this.tabs : [];
      this._tabs = tabs;

      const variant = this.variant === 'pills' ? 'pills' : 'underline';
      const listCls = 'lex-tabs-list lex-tabs-list--' + variant;

      let html = '<div class="' + listCls + '" role="tablist">';

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const isActive = tab.id === this.active;
        const activeCls = isActive ? ' lex-tab-btn--active' : '';
        const ariaSelected = isActive ? 'true' : 'false';

        let iconHtml = '';
        if (tab.icon && window.Lex && window.Lex.Icons && window.Lex.Icons.has(tab.icon)) {
          iconHtml = String(window.Lex.Icons[tab.icon].xSmall);
        }

        html += '<button'
          + ' class="lex-tab-btn' + activeCls + '"'
          + ' role="tab"'
          + ' aria-selected="' + ariaSelected + '"'
          + ' data-tab-id="' + this.escapeHtml(tab.id) + '"'
          + ' tabindex="' + (isActive ? '0' : '-1') + '"'
          + '>'
          + iconHtml
          + this.escapeHtml(tab.label || tab.id)
          + '</button>';
      }

      html += '</div>';

      return html;
    }

    updated() {
      // Delegated click handler — switch active tab
      this.delegate('click', '[data-tab-id]', (e, btn) => {
        const newTabId = btn.dataset.tabId;
        if (newTabId === this.active) return;

        const previous = this.active;
        this.active = newTabId;

        this.emit('tab-change', { tab: newTabId, previous: previous });
      });

      // Keyboard navigation within the tab list
      const list = this.$('.lex-tabs-list');
      if (list) {
        this.listen(list, 'keydown', (e) => {
          const buttons = Array.from(this.$$('[data-tab-id]'));
          const currentIdx = buttons.indexOf(document.activeElement);
          if (currentIdx === -1) return;

          let nextIdx = currentIdx;

          if (e.key === 'ArrowRight') {
            nextIdx = currentIdx + 1 < buttons.length ? currentIdx + 1 : 0;
          } else if (e.key === 'ArrowLeft') {
            nextIdx = currentIdx - 1 >= 0 ? currentIdx - 1 : buttons.length - 1;
          } else if (e.key === 'Home') {
            nextIdx = 0;
          } else if (e.key === 'End') {
            nextIdx = buttons.length - 1;
          } else {
            return;
          }

          e.preventDefault();
          buttons[nextIdx].focus();
          buttons[nextIdx].click();
        });
      }
    }
  }

  defineLex('lex-tabs', LexTabs);
})();
