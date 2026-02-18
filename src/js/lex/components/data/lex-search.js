/* Lex UI — Search Component
   Debounced search input that queries an endpoint.

   Usage:
     <lex-search endpoint="/api/v1/search" placeholder="Search matters..." param-name="q"></lex-search>

   Events: lex-search, lex-results, lex-select
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  class LexSearch extends LexElement {
    static get properties() {
      return {
        endpoint:    { type: String },
        placeholder: { type: String, default: 'Search...' },
        paramName:   { type: String, default: 'q' },
        debounce:    { type: Number, default: 300 },
        minChars:    { type: Number, default: 2 },
        value:       { type: String, default: '' }
      };
    }

    connected() {
      this._timer = null;
      this._results = [];
      this._loading = false;
      this._showDropdown = false;
    }

    render() {
      const hasValue = (this.value || '').length > 0;
      const showClear = hasValue && !this._loading;
      const inputPaddingRight = showClear ? '2.5rem' : '0.75rem';
      const clearSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      return `
        <div class="relative">
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 lex-text-tertiary pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="text"
              class="w-full pl-10 py-2 text-sm focus:outline-none"
              style="background:var(--lex-color-gray-50);border:none;border-width:0;border-radius:var(--lex-input-radius);transition:box-shadow 0.2s ease;padding-right:${inputPaddingRight};"
              onfocus="this.style.boxShadow='0 0 0 2px var(--lex-input-border-focus,var(--lex-color-brand-500))'"
              onblur="this.style.boxShadow='none'"
              placeholder="${this.escapeHtml(this.placeholder)}"
              value="${this.escapeHtml(this.value)}"
              data-input="search"
              autocomplete="off"
            />
            ${this._loading ? `
              <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg class="animate-spin w-4 h-4 lex-text-tertiary" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            ` : ''}
            ${showClear ? `
              <button type="button" class="lex-search-clear absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded text-[var(--lex-text-tertiary)] hover:text-[var(--lex-text-primary)] hover:bg-[var(--lex-bg-tertiary)] border-none bg-transparent cursor-pointer transition-colors" data-action="clear" tabindex="-1" aria-label="Clear search">${clearSvg}</button>
            ` : ''}
          </div>
          ${this._showDropdown && this._results.length > 0 ? `
            <div class="absolute z-10 mt-1 w-full lex-bg-primary border lex-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
              ${this._results.map((item, i) => `
                <div class="px-4 py-2 text-sm lex-text-primary lex-hover-bg-accent cursor-pointer transition-colors" data-result-idx="${i}">
                  ${this.escapeHtml(item.name || item.title || item.label || JSON.stringify(item))}
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }

    updated() {
      const input = this.$('[data-input="search"]');
      if (input) {
        // Restore focus and cursor after re-render (e.g. after clearing dropdown or loading)
        if (this._hadFocus != null) {
          input.focus();
          const pos = this._hadFocus;
          this._hadFocus = null;
          if (typeof pos === 'number' && pos >= 0) {
            input.setSelectionRange(pos, pos);
          }
        }

        this.listen(input, 'input', (e) => {
          const val = e.target.value;
          this._props.value = val;
          this.emit('lex-search', { query: val });

          clearTimeout(this._timer);
          if (val.length >= this.minChars && this.endpoint) {
            this._timer = setTimeout(() => this._doSearch(), this.debounce);
          } else {
            this._results = [];
            this._showDropdown = false;
          }
          this._hadFocus = input.selectionStart;
          this._scheduleUpdate();
        });

        this.listen(input, 'blur', () => {
          setTimeout(() => {
            this._showDropdown = false;
            this._scheduleUpdate();
          }, 200);
        });
      }

      this.delegate('click', '[data-action="clear"]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._props.value = '';
        this._results = [];
        this._showDropdown = false;
        clearTimeout(this._timer);
        this._timer = null;
        this.emit('lex-search', { query: '' });
        this._scheduleUpdate();
        queueMicrotask(() => {
          const inp = this.$('[data-input="search"]');
          if (inp) inp.focus();
        });
      });

      this.delegate('click', '[data-result-idx]', (e, el) => {
        const idx = parseInt(el.dataset.resultIdx);
        const item = this._results[idx];
        if (item) {
          this.value = item.name || item.title || item.label || '';
          this._showDropdown = false;
          this.emit('lex-select', { item, index: idx });
          this._scheduleUpdate();
        }
      });
    }

    async _doSearch() {
      if (!this.endpoint || !window.api) return;

      this._loading = true;
      this._scheduleUpdate();

      try {
        const url = `${this.endpoint}?${encodeURIComponent(this.paramName)}=${encodeURIComponent(this.value)}`;
        let response;
        if (window.api.get) {
          response = await window.api.get(url);
        } else {
          const fetchResponse = await fetch(url);
          response = await fetchResponse.json();
        }

        this._results = response.data || response.results || response || [];
        this._showDropdown = true;
        this.emit('lex-results', { results: this._results, query: this.value });
      } catch (err) {
        console.error('[Lex Search] Error:', err);
        this._results = [];
      } finally {
        this._loading = false;
        this._scheduleUpdate();
      }
    }
  }

  defineLex('lex-search', LexSearch);
})();
