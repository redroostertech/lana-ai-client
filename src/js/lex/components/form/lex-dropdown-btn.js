/* Lex UI — Dropdown Button Component
   Button that opens a searchable dropdown menu. Unlike lex-select,
   the button label stays fixed (it's a command menu, not a form field).

   Usage:
     <lex-dropdown-btn button-label="Actions" variant="primary"
       options='[{"value":"edit","label":"Edit","icon":"edit"},{"value":"delete","label":"Delete","icon":"trash-2"}]'>
     </lex-dropdown-btn>

   Events: lex-select { value, label, item }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, Icons } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-dropdown-btn-styles';
    style.textContent = `
      lex-dropdown-btn {
        display: inline-block;
        position: relative;
      }

      .lex-ddbtn-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: inherit;
        font-weight: var(--lex-weight-medium, 500);
        border: none;
        cursor: pointer;
        border-radius: var(--lex-btn-radius-md);
        padding: 0.5rem 1rem;
        font-size: var(--lex-form-font-size-lg, 0.875rem);
        transition: background 0.15s ease;
        outline: none;
        background: var(--_ddbtn-bg);
        color: var(--_ddbtn-text);
      }

      .lex-ddbtn-trigger:hover {
        background: var(--_ddbtn-bg-hover);
      }

      .lex-ddbtn-trigger:focus-visible {
        box-shadow: 0 0 0 2px var(--lex-bg-primary), 0 0 0 4px var(--_ddbtn-bg);
      }

      .lex-ddbtn-trigger:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .lex-ddbtn-chevron {
        width: 14px;
        height: 14px;
        transition: transform 0.2s ease;
      }

      .lex-ddbtn-trigger--open .lex-ddbtn-chevron {
        transform: rotate(180deg);
      }

      /* ── Dropdown ──────────────────────────────────────── */

      .lex-ddbtn-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 180px;
        max-height: 280px;
        overflow-y: auto;
        background: var(--lex-select-dropdown-bg, var(--lex-bg-primary));
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-input-radius);
        box-shadow: var(--lex-shadow-lg);
        z-index: var(--lex-z-dropdown, 10);
        display: none;
      }

      .lex-ddbtn-dropdown--open {
        display: block;
      }

      .lex-ddbtn-search {
        position: sticky;
        top: 0;
        padding: 8px;
        background: var(--lex-select-dropdown-bg, var(--lex-bg-primary));
        border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
      }

      .lex-ddbtn-search input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 10px;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        font-family: inherit;
        border: none;
        border-radius: var(--lex-radius-sm);
        outline: none;
        background: var(--lex-color-gray-50);
        color: var(--lex-text-primary);
      }

      .lex-ddbtn-search input:focus {
        background: var(--lex-bg-primary);
        box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500));
      }

      .lex-ddbtn-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-primary);
        transition: background 0.1s ease;
      }

      .lex-ddbtn-item:hover,
      .lex-ddbtn-item--focused {
        background: var(--lex-select-option-hover, var(--lex-bg-secondary));
      }

      .lex-ddbtn-item-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        color: var(--lex-text-tertiary);
      }

      .lex-ddbtn-item-icon svg {
        width: 16px;
        height: 16px;
      }

      .lex-ddbtn-item-desc {
        font-size: var(--lex-form-help-size, 0.6875rem);
        color: var(--lex-text-tertiary);
        margin-top: 1px;
      }

      .lex-ddbtn-empty {
        padding: 12px;
        text-align: center;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        color: var(--lex-text-tertiary);
      }
    `;
    document.head.appendChild(style);
  }

  const CHEVRON_SVG = '<svg class="lex-ddbtn-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  const VARIANTS = {
    primary:   { bg: 'var(--lex-bg-accent)', bgHover: 'var(--lex-bg-accent-hover)', text: 'var(--lex-text-on-accent)' },
    secondary: { bg: 'var(--lex-color-gray-200)', bgHover: 'var(--lex-color-gray-300)', text: 'var(--lex-text-primary)' },
    ghost:     { bg: 'transparent', bgHover: 'var(--lex-color-gray-100)', text: 'var(--lex-text-secondary)' }
  };

  function getIcon(name) {
    if (Icons && Icons.has && Icons.has(name)) {
      return Icons[name].small.toString();
    }
    return '';
  }

  class LexDropdownBtn extends LexElement {
    static get properties() {
      return {
        options:     { type: Array, default: [] },
        searchable:  { type: Boolean, default: false },
        variant:     { type: String, default: 'secondary' },
        buttonLabel: { type: String, default: 'Actions' },
        disabled:    { type: Boolean, default: false }
      };
    }

    constructor() {
      super();
      this._open = false;
      this._searchTerm = '';
      this._focusedIdx = -1;
    }

    render() {
      injectStyles();

      const v = VARIANTS[this.variant] || VARIANTS.secondary;
      const cssVars = `--_ddbtn-bg:${v.bg};--_ddbtn-bg-hover:${v.bgHover};--_ddbtn-text:${v.text};`;
      const openCls = this._open ? ' lex-ddbtn-trigger--open' : '';
      const disabledAttr = this.disabled ? 'disabled' : '';

      const filtered = this._getFiltered();

      let html = `<button type="button" class="lex-ddbtn-trigger${openCls}" style="${cssVars}" ${disabledAttr} data-action="toggle">`;
      html += this.escapeHtml(this.buttonLabel);
      html += CHEVRON_SVG;
      html += `</button>`;

      html += `<div class="lex-ddbtn-dropdown${this._open ? ' lex-ddbtn-dropdown--open' : ''}">`;

      if (this.searchable) {
        html += `<div class="lex-ddbtn-search"><input type="text" placeholder="Search..." value="${this.escapeHtml(this._searchTerm)}" /></div>`;
      }

      if (filtered.length === 0) {
        html += `<div class="lex-ddbtn-empty">No items found</div>`;
      } else {
        filtered.forEach((item, idx) => {
          const focusedCls = idx === this._focusedIdx ? ' lex-ddbtn-item--focused' : '';
          const iconHtml = item.icon ? `<span class="lex-ddbtn-item-icon">${getIcon(item.icon)}</span>` : '';
          html += `<div class="lex-ddbtn-item${focusedCls}" data-value="${this.escapeHtml(item.value)}" data-idx="${idx}">`;
          html += iconHtml;
          html += `<div><div>${this.escapeHtml(item.label)}</div>`;
          if (item.description) html += `<div class="lex-ddbtn-item-desc">${this.escapeHtml(item.description)}</div>`;
          html += `</div></div>`;
        });
      }

      html += `</div>`;
      return html;
    }

    _getFiltered() {
      const opts = this.options || [];
      if (!this._searchTerm) return opts;
      const term = this._searchTerm.toLowerCase();
      return opts.filter(o => o.label.toLowerCase().includes(term));
    }

    updated() {
      // Toggle
      this.delegate('click', '[data-action="toggle"]', () => {
        if (this.disabled) return;
        this._open = !this._open;
        this._searchTerm = '';
        this._focusedIdx = -1;
        this._scheduleUpdate();
        if (this._open && this.searchable) {
          queueMicrotask(() => {
            const si = this.querySelector('.lex-ddbtn-search input');
            if (si) si.focus();
          });
        }
      });

      // Item click
      this.delegate('click', '.lex-ddbtn-item', (e, target) => {
        const val = target.dataset.value;
        const items = this.options || [];
        const item = items.find(o => o.value === val);
        this._open = false;
        this._scheduleUpdate();
        this.emit('lex-select', { value: val, label: item ? item.label : val, item });
      });

      // Search
      const searchInput = this.querySelector('.lex-ddbtn-search input');
      if (searchInput) {
        this.listen(searchInput, 'input', (e) => {
          this._searchTerm = e.target.value;
          this._focusedIdx = -1;
          this._scheduleUpdate();
          queueMicrotask(() => {
            const si = this.querySelector('.lex-ddbtn-search input');
            if (si) { si.focus(); si.value = this._searchTerm; }
          });
        });

        this.listen(searchInput, 'keydown', (e) => {
          const opts = this._getFiltered();
          if (e.key === 'ArrowDown') { e.preventDefault(); this._focusedIdx = Math.min(this._focusedIdx + 1, opts.length - 1); this._scheduleUpdate(); queueMicrotask(() => { const si = this.querySelector('.lex-ddbtn-search input'); if (si) si.focus(); }); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); this._focusedIdx = Math.max(this._focusedIdx - 1, 0); this._scheduleUpdate(); queueMicrotask(() => { const si = this.querySelector('.lex-ddbtn-search input'); if (si) si.focus(); }); }
          else if (e.key === 'Enter' && this._focusedIdx >= 0) { e.preventDefault(); const el = this.querySelector(`[data-idx="${this._focusedIdx}"]`); if (el) el.click(); }
          else if (e.key === 'Escape') { this._open = false; this._scheduleUpdate(); }
        });
      }

      // Close on outside click
      if (this._open) {
        const closeHandler = (e) => {
          if (!this.contains(e.target)) {
            this._open = false;
            this._scheduleUpdate();
            document.removeEventListener('mousedown', closeHandler);
          }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
        this._eventCleanups.push(() => document.removeEventListener('mousedown', closeHandler));
      }
    }
  }

  defineLex('lex-dropdown-btn', LexDropdownBtn);
})();
