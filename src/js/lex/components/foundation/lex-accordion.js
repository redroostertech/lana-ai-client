/* Lex UI — Accordion Component
   Collapsible section with animated chevron and optional Lucide icon.
   Child elements become the collapsible body via slot-content.

   Usage:
     <lex-accordion heading="Matter Details" expanded icon="briefcase">
       <div>Content here...</div>
     </lex-accordion>

     <lex-accordion heading="Flush Section" variant="flush">
       <p>No outer border or horizontal padding.</p>
     </lex-accordion>

     accordion.addEventListener('section-toggle', function (e) {
       console.log('expanded:', e.detail.expanded);
     });

   Properties:
     heading   String   ''        Section title text
     expanded  Boolean  false     Whether the body is visible
     icon      String   ''        Optional Lucide icon name shown left of heading
     variant   String   'default' 'default' | 'flush'

   Events:
     section-toggle  { expanded: true | false }
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  // ---------------------------------------------------------------------------
  // Style injection (once)
  // ---------------------------------------------------------------------------

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-accordion-styles';
    style.textContent = `

      /* ── Host ───────────────────────────────────────────── */

      lex-accordion {
        display: block;
      }

      /* ── Wrapper ────────────────────────────────────────── */

      .lex-accordion {
        background: var(--lex-bg-primary);
      }

      .lex-accordion--default {
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-lg);
        overflow: hidden;
      }

      .lex-accordion--flush {
        border-top: 1px solid var(--lex-border-default);
      }

      /* ── Trigger (header row) ───────────────────────────── */

      .lex-accordion-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.625rem;
        width: 100%;
        border: none;
        background: none;
        cursor: pointer;
        text-align: left;
        font-family: var(--lex-font-sans, inherit);
        color: var(--lex-text-primary);
        transition: background var(--lex-transition-fast);
        outline: none;
      }

      .lex-accordion--default .lex-accordion-trigger {
        padding: 0.875rem 1rem;
      }

      .lex-accordion--flush .lex-accordion-trigger {
        padding: 0.75rem 0;
      }

      .lex-accordion-trigger:hover {
        background: var(--lex-bg-tertiary);
      }

      .lex-accordion--flush .lex-accordion-trigger:hover {
        background: none;
        color: var(--lex-text-accent);
      }

      .lex-accordion-trigger:focus-visible {
        outline: 2px solid var(--lex-border-focus);
        outline-offset: -2px;
      }

      /* ── Trigger left group (icon + heading) ────────────── */

      .lex-accordion-trigger-left {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
        flex: 1;
      }

      .lex-accordion-heading-icon {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        color: var(--lex-text-secondary);
      }

      .lex-accordion-heading-icon svg {
        width: 16px;
        height: 16px;
      }

      .lex-accordion-heading {
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-semibold, 600);
        color: var(--lex-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.4;
      }

      /* ── Chevron icon ───────────────────────────────────── */

      .lex-accordion-chevron {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        color: var(--lex-text-tertiary);
        transition: transform var(--lex-transition-normal);
      }

      .lex-accordion-chevron svg {
        width: 16px;
        height: 16px;
      }

      .lex-accordion--expanded .lex-accordion-chevron {
        transform: rotate(180deg);
      }

      /* ── Body (collapsible content area) ────────────────── */

      .lex-accordion-body {
        overflow: hidden;
        max-height: 0;
        opacity: 0;
        transition:
          max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
          opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .lex-accordion--expanded .lex-accordion-body {
        max-height: 9999px;
        opacity: 1;
      }

      .lex-accordion--default .lex-accordion-body-inner {
        padding: 0 1rem 1rem;
        border-top: 1px solid var(--lex-border-subtle);
        padding-top: 0.875rem;
      }

      .lex-accordion--flush .lex-accordion-body-inner {
        padding: 0 0 0.75rem;
      }

    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Inline chevron SVG (avoids dependency on icon library being loaded)
  // ---------------------------------------------------------------------------

  const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  // ---------------------------------------------------------------------------
  // LexAccordion
  // ---------------------------------------------------------------------------

  class LexAccordion extends LexElement {
    static get properties() {
      return {
        heading:  { type: String,  default: '' },
        expanded: { type: Boolean, default: false, reflect: true },
        icon:     { type: String,  default: '' },
        variant:  { type: String,  default: 'default' }
      };
    }

    constructor() {
      super();
      // No additional state needed — expanded drives everything
    }

    render() {
      injectStyles();

      const variant = this.variant === 'flush' ? 'flush' : 'default';
      const isExpanded = !!this.expanded;
      const expandedCls = isExpanded ? ' lex-accordion--expanded' : '';
      const wrapperCls = 'lex-accordion lex-accordion--' + variant + expandedCls;

      // Optional leading icon
      let iconHtml = '';
      if (this.icon) {
        let iconSvg = '';
        if (window.Lex && window.Lex.Icons && window.Lex.Icons.has(this.icon)) {
          iconSvg = String(window.Lex.Icons[this.icon].small);
        }
        if (iconSvg) {
          iconHtml = '<span class="lex-accordion-heading-icon">' + iconSvg + '</span>';
        }
      }

      return '<div class="' + wrapperCls + '">'
        + '<button'
        + '  type="button"'
        + '  class="lex-accordion-trigger"'
        + '  aria-expanded="' + (isExpanded ? 'true' : 'false') + '"'
        + '  data-action="toggle"'
        + '>'
        +   '<span class="lex-accordion-trigger-left">'
        +     iconHtml
        +     '<span class="lex-accordion-heading">' + this.escapeHtml(this.heading) + '</span>'
        +   '</span>'
        +   '<span class="lex-accordion-chevron">' + CHEVRON_SVG + '</span>'
        + '</button>'
        + '<div class="lex-accordion-body" aria-hidden="' + (isExpanded ? 'false' : 'true') + '">'
        +   '<div class="lex-accordion-body-inner">'
        +     '<slot-content></slot-content>'
        +   '</div>'
        + '</div>'
        + '</div>';
    }

    updated() {
      this.delegate('click', '[data-action="toggle"]', () => {
        this.expanded = !this.expanded;
        this.emit('section-toggle', { expanded: this.expanded });
      });
    }
  }

  defineLex('lex-accordion', LexAccordion);
})();
