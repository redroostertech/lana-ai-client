/* Lex UI — Stack Component
   Flex layout with direction, gap, alignment, and optional dividers.
   Styles the host element directly — no wrapper div, no slot-content cloning.

   Usage:
     <lex-stack direction="horizontal" gap="4" align="center">
       <lex-badge label="A"></lex-badge>
       <lex-badge label="B"></lex-badge>
     </lex-stack>

     <lex-stack direction="vertical" gap="3" divider="true">
       <div>Item 1</div>
       <div>Item 2</div>
     </lex-stack>

   Direction: vertical | horizontal
   Align: start | center | end | stretch
   Justify: start | center | end | between | around
   Wrap: true | false
   Divider: true | false — inserts a subtle line between each child
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  const ALIGN_MAP = {
    start: 'flex-start', center: 'center',
    end: 'flex-end', stretch: 'stretch'
  };

  const JUSTIFY_MAP = {
    start: 'flex-start', center: 'center',
    end: 'flex-end', between: 'space-between', around: 'space-around'
  };

  class LexStack extends LexElement {
    static get properties() {
      return {
        direction: { type: String, default: 'vertical' },
        gap:       { type: String, default: '3' },
        align:     { type: String, default: 'stretch' },
        justify:   { type: String, default: 'start' },
        wrap:      { type: Boolean, default: false },
        divider:   { type: Boolean, default: false }
      };
    }

    // Return null so the core leaves children in place (no cloning)
    render() {
      return null;
    }

    updated() {
      const isHorizontal = this.direction === 'horizontal';
      const gapRem = Number(this.gap) * 0.25;

      // Style the host element as the flex container
      this.style.display = 'flex';
      this.style.flexDirection = isHorizontal ? 'row' : 'column';
      this.style.gap = `${gapRem}rem`;
      this.style.alignItems = ALIGN_MAP[this.align] || 'stretch';
      this.style.justifyContent = JUSTIFY_MAP[this.justify] || 'flex-start';
      this.style.flexWrap = this.wrap ? 'wrap' : 'nowrap';

      // --- Dividers ---
      // Remove old dividers
      this.querySelectorAll(':scope > .lex-stack-divider').forEach(d => d.remove());

      if (!this.divider) return;

      const children = Array.from(this.children).filter(
        c => !c.classList.contains('lex-stack-divider')
      );

      for (let i = children.length - 1; i > 0; i--) {
        const div = document.createElement('div');
        div.className = 'lex-stack-divider';
        div.setAttribute('aria-hidden', 'true');

        if (isHorizontal) {
          div.style.cssText = 'width:1px;align-self:stretch;background:var(--lex-border-subtle);flex-shrink:0;';
        } else {
          div.style.cssText = 'height:1px;align-self:stretch;background:var(--lex-border-subtle);flex-shrink:0;';
        }

        children[i].before(div);
      }
    }
  }

  defineLex('lex-stack', LexStack);
})();
