/* Lex UI — Spacer Component
   Invisible spacing utility for adding vertical or horizontal gaps.

   Usage:
     <lex-spacer></lex-spacer>                          <!-- default: sm (4px) -->
     <lex-spacer size="md"></lex-spacer>                 <!-- 8px -->
     <lex-spacer size="lg"></lex-spacer>                 <!-- 16px -->
     <lex-spacer size="xl"></lex-spacer>                 <!-- 24px -->
     <lex-spacer size="2xl"></lex-spacer>                <!-- 32px -->
     <lex-spacer size="xs"></lex-spacer>                 <!-- 2px -->

   Size: xs | sm | md | lg | xl | 2xl  (maps to --lex-space-* tokens)
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  class LexSpacer extends LexElement {
    static get properties() {
      return {
        size: { type: String, default: 'sm' }
      };
    }

    render() {
      const token = `var(--lex-space-${this.size}, 4px)`;
      return `<div style="height:${token};width:100%;flex-shrink:0;" aria-hidden="true"></div>`;
    }
  }

  defineLex('lex-spacer', LexSpacer);
})();
