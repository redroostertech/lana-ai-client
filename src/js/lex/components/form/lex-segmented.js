/* Lex UI — Segmented Control Component
   Horizontal segments with animated sliding selection indicator.

   Usage:
     <lex-segmented value="medium"
       options='[{"value":"low","label":"Low"},{"value":"medium","label":"Medium"},{"value":"high","label":"High"}]'>
     </lex-segmented>

     <lex-segmented size="sm"
       options='[{"value":"grid","label":"Grid","icon":"grid"},{"value":"list","label":"List","icon":"list"}]'>
     </lex-segmented>

   Sizes: sm | md | lg
   Events: lex-change { name, value }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField, Icons } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-segmented-styles';
    style.textContent = `
      lex-segmented {
        display: block;
      }

      .lex-seg-container {
        display: inline-flex;
        align-items: center;
        position: relative;
        background: var(--lex-bg-tertiary);
        border-radius: var(--lex-radius-lg);
        padding: 3px;
        gap: 2px;
      }

      /* ── Sliding indicator ─────────────────────────────── */

      .lex-seg-indicator {
        position: absolute;
        top: 3px;
        bottom: 3px;
        left: 0;
        border-radius: calc(var(--lex-radius-lg) - 2px);
        background: var(--lex-bg-primary);
        box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
        transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 0;
      }

      /* ── Segments ──────────────────────────────────────── */

      .lex-seg-item {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
        font-family: inherit;
        font-weight: var(--lex-weight-regular, 400);
        letter-spacing: 0.01em;
        color: var(--lex-text-secondary);
        border: none;
        background: transparent;
        border-radius: calc(var(--lex-radius-lg) - 2px);
        white-space: nowrap;
        transition: color 0.2s ease;
        outline: none;
      }

      .lex-seg-item:hover {
        color: var(--lex-text-primary);
      }

      .lex-seg-item--selected {
        color: var(--lex-text-primary);
        font-weight: var(--lex-weight-medium, 500);
      }

      .lex-seg-item:focus-visible {
        box-shadow: 0 0 0 2px rgba(89, 82, 70, 0.2);
      }

      .lex-seg-item svg {
        flex-shrink: 0;
      }

      /* ── Size variants ─────────────────────────────────── */

      .lex-seg-container--sm .lex-seg-item { padding: 4px 12px; font-size: var(--lex-form-font-size-sm, 0.75rem); }
      .lex-seg-container--sm .lex-seg-item svg { width: 14px; height: 14px; }

      .lex-seg-container--md .lex-seg-item { padding: 6px 16px; font-size: var(--lex-form-font-size, 0.8125rem); }
      .lex-seg-container--md .lex-seg-item svg { width: 16px; height: 16px; }

      .lex-seg-container--lg .lex-seg-item { padding: 8px 20px; font-size: var(--lex-form-font-size-lg, 0.875rem); }
      .lex-seg-container--lg .lex-seg-item svg { width: 18px; height: 18px; }

      /* ── Dark variant ──────────────────────────────────── */

      .lex-seg-container--dark {
        background: var(--lex-color-gray-800);
      }

      .lex-seg-container--dark .lex-seg-indicator {
        background: var(--lex-color-gray-700);
        box-shadow: none;
      }

      .lex-seg-container--dark .lex-seg-item {
        color: var(--lex-color-gray-400);
      }

      .lex-seg-container--dark .lex-seg-item:hover {
        color: var(--lex-color-gray-200);
      }

      .lex-seg-container--dark .lex-seg-item--selected {
        color: var(--lex-color-white);
      }
    `;
    document.head.appendChild(style);
  }

  function getIcon(name) {
    if (Icons && Icons.has && Icons.has(name)) {
      return Icons[name].small.toString();
    }
    return '';
  }

  class LexSegmented extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        options: { type: Array, default: [] },
        theme:   { type: String, default: 'light' }
      };
    }

    render() {
      injectStyles();

      const options = this.options || [];
      const sz = this.size || 'md';
      const darkCls = this.theme === 'dark' ? ' lex-seg-container--dark' : '';

      let html = `<div class="lex-seg-container lex-seg-container--${sz}${darkCls}">`;
      html += `<div class="lex-seg-indicator"></div>`;

      options.forEach((opt) => {
        const selectedCls = this.value === opt.value ? ' lex-seg-item--selected' : '';
        const iconHtml = opt.icon ? getIcon(opt.icon) : '';
        html += `<button type="button" class="lex-seg-item${selectedCls}" data-value="${this.escapeHtml(opt.value)}">`;
        if (iconHtml) html += iconHtml;
        html += this.escapeHtml(opt.label);
        html += `</button>`;
      });

      html += `</div>`;

      if (this.label || this.error || this.help) {
        return this._renderFieldWrapper(html);
      }
      return html;
    }

    updated() {
      // Position the sliding indicator
      this._positionIndicator();

      // Click handler
      this.delegate('click', '.lex-seg-item', (e, target) => {
        const val = target.dataset.value;
        if (val !== this.value) {
          this._props.value = val;
          this._emitChange(val);
          // Update selected classes without full re-render for smooth animation
          this.querySelectorAll('.lex-seg-item').forEach(el => {
            el.classList.toggle('lex-seg-item--selected', el.dataset.value === val);
          });
          this._positionIndicator();
        }
      });
    }

    _positionIndicator() {
      const indicator = this.querySelector('.lex-seg-indicator');
      const selected = this.querySelector('.lex-seg-item--selected');
      if (!indicator || !selected) {
        if (indicator) indicator.style.opacity = '0';
        return;
      }

      const container = this.querySelector('.lex-seg-container');
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();

      indicator.style.opacity = '1';
      indicator.style.left = (selectedRect.left - containerRect.left) + 'px';
      indicator.style.width = selectedRect.width + 'px';
    }
  }

  defineLex('lex-segmented', LexSegmented);
})();
