/* Lex UI — Empty State Component
   Placeholder for when there's no data to display.

   Usage:
     <lex-empty message="No matters found" icon="folder"></lex-empty>
     <lex-empty message="No results" description="Try adjusting your search" action-label="Clear filters"></lex-empty>

   Icons: folder | search | document | inbox | chart
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  class LexEmpty extends LexElement {
    static get properties() {
      return {
        message:     { type: String, default: 'No data found' },
        description: { type: String },
        icon:        { type: String, default: 'inbox' },
        actionLabel: { type: String }
      };
    }

    render() {
      const icons = {
        folder: `<svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>`,
        search: `<svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>`,
        document: `<svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
        inbox: `<svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>`,
        chart: `<svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`
      };

      const iconSvg = icons[this.icon] || icons.inbox;

      return `
        <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
          <div class="lex-text-disabled mb-4">${iconSvg}</div>
          <p class="lex-text-secondary font-medium text-sm">${this.escapeHtml(this.message)}</p>
          ${this.description ? `<p class="lex-text-tertiary text-xs mt-1">${this.escapeHtml(this.description)}</p>` : ''}
          ${this.actionLabel ? `
            <button class="mt-4 px-4 py-2 text-sm font-medium lex-text-accent lex-hover-bg-accent rounded-lg transition-colors" data-action="empty-action">
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
