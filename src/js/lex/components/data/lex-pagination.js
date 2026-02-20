/* Lex UI — Pagination Component
   Standalone pagination controls. Can be wired to any data source.

   Usage:
     <lex-pagination page="1" total-pages="10" total="200"></lex-pagination>

   Events: page-change
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  class LexPagination extends LexElement {
    static get properties() {
      return {
        page:       { type: Number, default: 1 },
        totalPages: { type: Number, default: 1 },
        total:      { type: Number, default: 0 },
        limit:      { type: Number, default: 20 }
      };
    }

    render() {
      if (this.total === 0) return '';

      const pages = this._getPageNumbers();

      return `
        <div class="flex items-center justify-between py-3 text-sm">
          <span class="lex-text-secondary">
            ${this.total > 0 ? `${(this.page - 1) * this.limit + 1}-${Math.min(this.page * this.limit, this.total)} of ${this.total}` : `Page ${this.page} of ${this.totalPages}`}
          </span>
          <div class="flex items-center gap-1">
            <button class="px-2 py-1 rounded lex-text-secondary lex-hover-bg disabled:opacity-40 disabled:cursor-not-allowed" data-action="prev" ${this.page <= 1 ? 'disabled' : ''}>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            </button>
            ${pages.map(p => {
              if (p === '...') {
                return `<span class="px-2 py-1 lex-text-tertiary">...</span>`;
              }
              const active = p === this.page;
              return `<button class="px-2.5 py-1 rounded text-sm ${active ? 'lex-bg-accent lex-text-on-accent font-medium' : 'lex-text-secondary lex-hover-bg'}" data-page="${p}">${p}</button>`;
            }).join('')}
            <button class="px-2 py-1 rounded lex-text-secondary lex-hover-bg disabled:opacity-40 disabled:cursor-not-allowed" data-action="next" ${this.page >= this.totalPages ? 'disabled' : ''}>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      `;
    }

    _getPageNumbers() {
      const total = this.totalPages;
      const current = this.page;
      const pages = [];

      if (total <= 7) {
        for (let i = 1; i <= total; i++) pages.push(i);
        return pages;
      }

      pages.push(1);
      if (current > 3) pages.push('...');
      for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
        pages.push(i);
      }
      if (current < total - 2) pages.push('...');
      pages.push(total);

      return pages;
    }

    updated() {
      this.delegate('click', '[data-page]', (e, el) => {
        const page = parseInt(el.dataset.page);
        if (page !== this.page) {
          this.page = page;
          this.emit('page-change', { page });
        }
      });

      this.delegate('click', '[data-action="prev"]', () => {
        if (this.page > 1) {
          this.page--;
          this.emit('page-change', { page: this.page });
        }
      });

      this.delegate('click', '[data-action="next"]', () => {
        if (this.page < this.totalPages) {
          this.page++;
          this.emit('page-change', { page: this.page });
        }
      });
    }
  }

  defineLex('lex-pagination', LexPagination);
})();
