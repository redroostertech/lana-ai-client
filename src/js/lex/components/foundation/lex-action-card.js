/* Lex UI — Action Card Component
   Premium minimal card for action items, tasks, and navigable list entries.
   Features a left accent bar on hover, title + description, meta tags,
   priority indicators, and a chevron affordance.

   Usage:
     <lex-action-card
       title="Review Amendment Section 4.2"
       description="Critical change to notice period"
       tag="High"
       priority="high">
     </lex-action-card>

   Priority: high (red) | medium (yellow) | low (gray) | none (default)
   Chevron: true (default) | false
   Theme: auto-inherits from parent context (light/dark via CSS custom properties)

   Events:
     action-click — emitted on click with { title, description, tag, priority }
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-action-card-styles';
    style.textContent = `
      lex-action-card {
        display: block;
      }

      .lex-acard {
        background: var(--lex-bg-primary);
        border: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.08));
        padding: 14px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: background 0.3s ease, transform 0.3s ease;
        cursor: pointer;
        position: relative;
        overflow: hidden;
      }

      .lex-acard::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 2px;
        height: 0%;
        background: var(--lex-text-primary);
        transition: height 0.3s ease;
      }

      .lex-acard:hover {
        background: var(--lex-bg-secondary, rgba(0,0,0,0.02));
        transform: translateX(4px);
      }

      .lex-acard:hover::before {
        height: 40%;
      }

      .lex-acard-main {
        flex: 1;
        min-width: 0;
      }

      .lex-acard-title {
        color: var(--lex-text-primary);
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-regular, 400);
        letter-spacing: 0.03em;
        line-height: 1.4;
      }

      .lex-acard-desc {
        color: var(--lex-text-tertiary);
        font-size: var(--lex-form-help-size, 0.6875rem);
        font-weight: var(--lex-weight-light, 300);
        letter-spacing: 0.02em;
        margin-top: 3px;
        line-height: 1.4;
      }

      .lex-acard-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: 16px;
        flex-shrink: 0;
      }

      .lex-acard-tag {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--lex-text-tertiary);
        font-weight: var(--lex-weight-medium, 500);
        white-space: nowrap;
      }

      .lex-acard-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--lex-text-tertiary);
        flex-shrink: 0;
      }
      .lex-acard-dot[data-priority="high"]   { background: var(--lex-color-danger-500); }
      .lex-acard-dot[data-priority="medium"] { background: var(--lex-color-warning-500); }
      .lex-acard-dot[data-priority="low"]    { background: var(--lex-text-tertiary); }

      .lex-acard-chevron {
        width: 12px;
        height: 12px;
        opacity: 0.3;
        color: var(--lex-text-primary);
        flex-shrink: 0;
      }

      /* Spacing between stacked action cards */
      lex-action-card + lex-action-card .lex-acard {
        margin-top: -1px;
      }
    `;
    document.head.appendChild(style);
  }

  const CHEVRON_SVG = '<svg class="lex-acard-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';

  class LexActionCard extends LexElement {
    static get properties() {
      return {
        title:       { type: String, default: '' },
        description: { type: String, default: '' },
        tag:         { type: String, default: '' },
        priority:    { type: String, default: '' },
        chevron:     { type: Boolean, default: true },
        action:      { type: String, default: '' }
      };
    }

    render() {
      injectStyles();

      const descHtml = this.description
        ? `<div class="lex-acard-desc">${this.escapeHtml(this.description)}</div>`
        : '';

      // Meta: tag + priority dot + chevron
      let metaParts = '';
      if (this.tag) {
        metaParts += `<span class="lex-acard-tag">${this.escapeHtml(this.tag)}</span>`;
      }
      if (this.priority) {
        metaParts += `<div class="lex-acard-dot" data-priority="${this.escapeHtml(this.priority)}"></div>`;
      }
      if (this.chevron) {
        metaParts += CHEVRON_SVG;
      }

      const metaHtml = metaParts
        ? `<div class="lex-acard-meta">${metaParts}</div>`
        : '';

      return `
        <div class="lex-acard">
          <div class="lex-acard-main">
            <div class="lex-acard-title">${this.escapeHtml(this.title)}</div>
            ${descHtml}
          </div>
          ${metaHtml}
        </div>
      `;
    }

    updated() {
      const card = this.querySelector('.lex-acard');
      if (card) {
        this.listen(card, 'click', () => {
          this.emit('action-click', {
            title: this.title,
            description: this.description,
            tag: this.tag,
            priority: this.priority,
            action: this.action
          });
        });
      }
    }
  }

  defineLex('lex-action-card', LexActionCard);
})();
