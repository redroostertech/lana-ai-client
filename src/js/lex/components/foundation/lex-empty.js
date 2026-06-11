/* Lex UI — Empty State Component
   Reusable placeholder for when there is no data to display.

   Usage:
     <lex-empty message="No matters found" icon="folder"></lex-empty>
     <lex-empty message="No results" description="Try adjusting your search" action-label="Clear filters"></lex-empty>
     <lex-empty size="compact" message="No comments yet" description="Comments will appear here."></lex-empty>

   Icons: folder | search | document | inbox | chart | users | comment | alert | tasks | link
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'lex-empty-styles';
    style.textContent = `
      lex-empty {
        display: block;
      }

      .lex-empty {
        color: var(--lex-text-secondary, #6b7280);
        font-family: var(--lex-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
        padding-bottom: 3rem;
        padding-top: 3rem;
        text-align: center;
      }

      .lex-empty--compact {
        padding-bottom: 2rem;
        padding-top: 2rem;
      }

      .lex-empty--inline {
        padding-bottom: 1rem;
        padding-top: 1rem;
      }

      .lex-empty--left {
        text-align: left;
      }

      .lex-empty .lex-empty__icon {
        color: var(--lex-empty-icon-color, #9ca3af);
        height: 3rem;
        margin: 0 auto 1rem;
        width: 3rem;
      }

      .lex-empty--left .lex-empty__icon {
        margin-left: 0;
        margin-right: 0;
      }

      .lex-empty .lex-empty__message {
        color: #111827;
        font-family: var(--lex-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
        font-size: 1.125rem;
        font-weight: 600;
        line-height: 1.5;
        margin: 0 0 0.5rem;
      }

      .lex-empty .lex-empty__description {
        color: #6b7280;
        font-family: var(--lex-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
        font-size: 1rem;
        line-height: 1.5;
        margin: 0 auto;
        max-width: var(--lex-empty-description-width, 28rem);
      }

      .lex-empty--left .lex-empty__description {
        margin-left: 0;
        margin-right: 0;
      }

      .lex-empty .lex-empty__action {
        align-items: center;
        background: var(--lex-action-bg, #5b5347);
        border: 1px solid var(--lex-action-bg, #5b5347);
        border-radius: 0.5rem;
        color: var(--lex-action-text, #fff);
        cursor: pointer;
        display: inline-flex;
        font-family: var(--lex-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
        font-size: 0.875rem;
        font-weight: 500;
        gap: 0.5rem;
        margin-top: 1.25rem;
        padding: 0.5rem 1rem;
        transition: background-color 0.15s ease, border-color 0.15s ease;
      }

      .lex-empty .lex-empty__action svg {
        height: 1rem;
        width: 1rem;
      }

      .lex-empty .lex-empty__action:hover {
        background: var(--lex-action-bg-hover, #453f36);
        border-color: var(--lex-action-bg-hover, #453f36);
      }
    `;
    document.head.appendChild(style);
  }

  class LexEmpty extends LexElement {
    static get properties() {
      return {
        heading:     { type: String },
        message:     { type: String, default: 'No data found' },
        description: { type: String },
        icon:        { type: String, default: 'inbox' },
        actionLabel: { type: String },
        actionIcon:  { type: String },
        size:        { type: String, default: 'default' },
        align:       { type: String, default: 'center' }
      };
    }

    connected() {
      super.connected();
      injectStyles();
    }

    render() {
      const icons = {
        folder: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>',
        search: '<circle cx="11" cy="11" r="7" stroke-width="1.6"/><path stroke-linecap="round" stroke-width="1.6" d="m20 20-4.5-4.5"/>',
        document: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>',
        inbox: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M8 9h8M8 13h5"/>',
        chart: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M5 19V9m7 10V5m7 14v-7"/><path stroke-linecap="round" stroke-width="1.6" d="M4 19h16"/>',
        users: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M16 19a4 4 0 0 0-8 0"/><circle cx="12" cy="8" r="3" stroke-width="1.6"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M20 18a3 3 0 0 0-3-3M4 18a3 3 0 0 1 3-3"/>',
        comment: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v6A2.5 2.5 0 0 1 16.5 14H11l-5 4v-4.5A2.5 2.5 0 0 1 5 11.5z"/><path stroke-linecap="round" stroke-width="1.6" d="M8.5 7.5h7M8.5 10.5h5"/>',
        alert: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 8v5M12 17h.01"/><path stroke-linejoin="round" stroke-width="1.6" d="M10.3 4.6 2.8 18a1.7 1.7 0 0 0 1.5 2.5h15.4a1.7 1.7 0 0 0 1.5-2.5L13.7 4.6a2 2 0 0 0-3.4 0z"/>',
        tasks: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
        link: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9.5 14.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M14.5 9.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5"/>'
      };

      const actionIcons = {
        plus: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"/>',
        add: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"/>',
        upload: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 16V4m0 0 4 4m-4-4-4 4"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 20h16"/>'
      };
      const iconSvg = icons[this.icon] || icons.inbox;
      const actionIcon = this.actionIcon && actionIcons[this.actionIcon]
        ? `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${actionIcons[this.actionIcon]}</svg>`
        : '';
      const message = this.heading || this.message || 'No data found';
      const classNames = [
        'lex-empty',
        'text-center',
        'py-12',
        this.size === 'compact' ? 'lex-empty--compact' : '',
        this.size === 'inline' ? 'lex-empty--inline' : '',
        this.align === 'left' ? 'lex-empty--left' : ''
      ].filter(Boolean).join(' ');

      return `
        <div class="${classNames}">
          <svg class="lex-empty__icon mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${iconSvg}</svg>
          <h4 class="lex-empty__message text-lg font-semibold text-gray-900 mb-2">${this.escapeHtml(message)}</h4>
          ${this.description ? `<p class="lex-empty__description text-gray-500${this.actionLabel ? ' mb-5' : ''}">${this.escapeHtml(this.description)}</p>` : ''}
          ${this.actionLabel ? `
            <button class="lex-empty__action inline-flex items-center gap-2 px-4 py-2 lex-bg-accent hover:lex-bg-accent text-white text-sm rounded-lg font-medium transition-colors" data-action="empty-action">
              ${actionIcon}
              ${this.escapeHtml(this.actionLabel)}
            </button>
          ` : ''}
        </div>
      `;
    }

    updated() {
      this.delegate('click', '[data-action="empty-action"]', () => {
        this.emit('action');
      });
    }
  }

  defineLex('lex-empty', LexEmpty);
})();
