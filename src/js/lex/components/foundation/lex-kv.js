/* Lex UI — Key-Value Component
   Displays a label-value pair.

   Usage:
     <lex-kv label="Status" value="Active"></lex-kv>
     <lex-kv label="Client" value="Acme Corp" direction="horizontal"></lex-kv>
     <lex-kv label="Matter #" value="M-2026-0042" copyable="true"></lex-kv>

   Direction: vertical | horizontal
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  class LexKv extends LexElement {
    static get properties() {
      return {
        label:     { type: String, default: '' },
        value:     { type: String, default: '' },
        direction: { type: String, default: 'vertical' },
        copyable:  { type: Boolean, default: false },
        muted:     { type: Boolean, default: false }
      };
    }

    render() {
      const isHorizontal = this.direction === 'horizontal';
      const containerClass = isHorizontal
        ? 'flex items-center justify-between gap-4'
        : '';

      const valueClass = this.muted ? 'lex-text-tertiary' : 'lex-text-primary';

      const copyBtn = this.copyable ? `
        <button class="ml-2 lex-text-tertiary transition-colors" data-action="copy" title="Copy">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
        </button>
      ` : '';

      return `
        <div class="${containerClass}">
          <dt class="text-xs font-medium lex-text-secondary ${isHorizontal ? '' : 'mb-0.5'}">${this.escapeHtml(this.label)}</dt>
          <dd class="text-sm ${valueClass} flex items-center">
            <span>${this.escapeHtml(this.value)}</span>
            ${copyBtn}
          </dd>
        </div>
      `;
    }

    updated() {
      if (this.copyable) {
        this.delegate('click', '[data-action="copy"]', () => {
          navigator.clipboard.writeText(this.value).then(() => {
            this.emit('copied', { value: this.value });
          });
        });
      }
    }
  }

  defineLex('lex-kv', LexKv);
})();
