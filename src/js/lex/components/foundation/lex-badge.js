/* Lex UI — Badge Component
   Status pill / tag for labeling items. Supports optional icon via slot content.

   Usage:
     <lex-badge label="Active" color="green"></lex-badge>
     <lex-badge label="Overdue" color="red" size="lg"></lex-badge>
     <lex-badge label="Synced" color="green"><svg>...</svg></lex-badge>
     <lex-badge color="red"><svg>...</svg></lex-badge>

   Colors: gray | green | red | yellow | blue | indigo
   Sizes: sm | md | lg
   Slot content: optional icon (SVG) displayed before the label
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  class LexBadge extends LexElement {
    static get properties() {
      return {
        label: { type: String, default: '' },
        color: { type: String, default: 'gray' },
        size:  { type: String, default: 'md' }
      };
    }

    render() {
      const colors = {
        gray:   'lex-bg-neutral lex-text-neutral',
        green:  'lex-bg-success lex-text-success',
        red:    'lex-bg-danger lex-text-danger',
        yellow: 'lex-bg-warning lex-text-warning',
        blue:   'lex-bg-info lex-text-info',
        indigo: 'lex-bg-accent-muted lex-text-accent'
      };

      const sizes = {
        sm: 'px-1.5 py-0.5 text-[10px] gap-1',
        md: 'px-2.5 py-0.5 text-xs gap-1',
        lg: 'px-3 py-1 text-sm gap-1.5'
      };

      const iconSizes = { sm: 10, md: 12, lg: 14 };
      const iconSize = iconSizes[this.size] || iconSizes.md;

      const colorClass = colors[this.color] || colors.gray;
      const sizeClass = sizes[this.size] || sizes.md;
      const labelHtml = this.label ? `<span>${this.escapeHtml(this.label)}</span>` : '';

      return `<span class="inline-flex items-center rounded-full font-medium ${colorClass} ${sizeClass}" style="--_badge-icon-size:${iconSize}px;"><slot-content></slot-content>${labelHtml}</span>`;
    }

    updated() {
      // Size any slotted SVG icons to match badge size
      const svgs = this.querySelectorAll('slot-content svg');
      for (const svg of svgs) {
        svg.style.width = 'var(--_badge-icon-size)';
        svg.style.height = 'var(--_badge-icon-size)';
        svg.style.flexShrink = '0';
      }
    }
  }

  defineLex('lex-badge', LexBadge);
})();
