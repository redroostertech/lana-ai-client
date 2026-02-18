/* Lex UI — Divider Component
   Horizontal or vertical rule with optional label.

   Usage:
     <lex-divider></lex-divider>
     <lex-divider label="Or"></lex-divider>
     <lex-divider label="Section 2" spacing="lg"></lex-divider>
     <lex-divider direction="vertical"></lex-divider>
     <lex-divider direction="vertical" label="Or"></lex-divider>

   Direction: horizontal | vertical (default: horizontal)
   Spacing:   sm | md | lg
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-divider-styles';
    style.textContent = `
      lex-divider[direction="vertical"] {
        display: inline-flex;
        align-self: stretch;
      }
      lex-divider[direction="vertical"] .lex-divider-v {
        display: flex;
        flex-direction: column;
        align-items: center;
        align-self: stretch;
        min-height: 100%;
      }
      lex-divider[direction="vertical"] .lex-divider-v-line {
        flex: 1;
        width: 0;
        border-left: 1px solid var(--lex-border-default, #E8E5E1);
      }
      lex-divider[direction="vertical"] .lex-divider-v-label {
        padding: 6px 0;
        font-size: var(--lex-text-xs, 12px);
        color: var(--lex-text-secondary);
        font-weight: 500;
        white-space: nowrap;
        writing-mode: vertical-lr;
        text-orientation: mixed;
      }
    `;
    document.head.appendChild(style);
  }

  class LexDivider extends LexElement {
    static get properties() {
      return {
        label:     { type: String },
        spacing:   { type: String, default: 'md' },
        direction: { type: String, default: 'horizontal' }
      };
    }

    render() {
      injectStyles();

      const isVertical = this.direction === 'vertical';

      if (isVertical) {
        return this._renderVertical();
      }
      return this._renderHorizontal();
    }

    _renderHorizontal() {
      const spacings = {
        sm: 'my-2',
        md: 'my-4',
        lg: 'my-6'
      };
      const spacingClass = spacings[this.spacing] || spacings.md;

      if (this.label) {
        return `
          <div class="relative ${spacingClass}">
            <div class="absolute inset-0 flex items-center"><div class="w-full border-t lex-border"></div></div>
            <div class="relative flex justify-center">
              <span class="lex-bg-primary px-3 text-xs lex-text-secondary font-medium">${this.escapeHtml(this.label)}</span>
            </div>
          </div>
        `;
      }

      return `<div class="border-t lex-border ${spacingClass}"></div>`;
    }

    _renderVertical() {
      const spacings = {
        sm: 'mx-2',
        md: 'mx-4',
        lg: 'mx-6'
      };
      const spacingClass = spacings[this.spacing] || spacings.md;

      if (this.label) {
        return `
          <div class="lex-divider-v ${spacingClass}">
            <div class="lex-divider-v-line"></div>
            <span class="lex-divider-v-label">${this.escapeHtml(this.label)}</span>
            <div class="lex-divider-v-line"></div>
          </div>
        `;
      }

      return `<div class="lex-divider-v ${spacingClass}"><div class="lex-divider-v-line"></div></div>`;
    }
  }

  defineLex('lex-divider', LexDivider);
})();
