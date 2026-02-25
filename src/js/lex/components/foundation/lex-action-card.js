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

      /* ── Feedback buttons ─────────────────────────────── */

      .lex-acard-feedback {
        display: flex;
        align-items: center;
        gap: 2px;
        opacity: 0;
        transition: opacity 0.2s ease;
        flex-shrink: 0;
      }

      .lex-acard:hover .lex-acard-feedback {
        opacity: 1;
      }

      @media (hover: none) {
        .lex-acard-feedback {
          opacity: 1;
        }
      }

      .lex-acard-fb-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        background: transparent;
        border-radius: var(--lex-radius-md, 6px);
        color: var(--lex-text-tertiary);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        padding: 0;
      }

      .lex-acard-fb-btn--accept:hover {
        background: rgba(34, 197, 94, 0.12);
        color: var(--lex-color-success-600, #16a34a);
      }

      .lex-acard-fb-btn--assign:hover {
        background: rgba(59, 130, 246, 0.12);
        color: var(--lex-color-info-600, #2563eb);
      }

      .lex-acard-fb-btn--reject:hover {
        background: rgba(239, 68, 68, 0.12);
        color: var(--lex-color-danger-600, #dc2626);
      }

      /* ── Dismiss button ──────────────────────────────── */

      .lex-acard-dismiss {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        background: transparent;
        border-radius: var(--lex-radius-md, 6px);
        color: var(--lex-text-tertiary);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.2s ease, background 0.2s ease;
        flex-shrink: 0;
        padding: 0;
      }

      .lex-acard:hover .lex-acard-dismiss {
        opacity: 1;
      }

      .lex-acard-dismiss:hover {
        background: var(--lex-bg-tertiary);
        color: var(--lex-text-primary);
      }

      /* Always visible on touch devices */
      @media (hover: none) {
        .lex-acard-dismiss {
          opacity: 1;
        }
      }

      /* Spacing between stacked action cards */
      lex-action-card + lex-action-card .lex-acard {
        margin-top: -1px;
      }
    `;
    document.head.appendChild(style);
  }

  const CHEVRON_SVG = '<svg class="lex-acard-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
  const DISMISS_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var FB_ACCEPT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  var FB_ASSIGN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>';
  var FB_REJECT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';

  class LexActionCard extends LexElement {
    static get properties() {
      return {
        title:       { type: String, default: '' },
        description: { type: String, default: '' },
        tag:         { type: String, default: '' },
        priority:    { type: String, default: '' },
        chevron:     { type: Boolean, default: true },
        dismissible: { type: Boolean, default: false },
        feedback:    { type: Boolean, default: false },
        action:      { type: String, default: '' }
      };
    }

    render() {
      injectStyles();

      const descHtml = this.description
        ? `<div class="lex-acard-desc">${this.escapeHtml(this.description)}</div>`
        : '';

      // Meta: tag + priority dot + dismiss + chevron
      let metaParts = '';
      if (this.tag) {
        metaParts += `<span class="lex-acard-tag">${this.escapeHtml(this.tag)}</span>`;
      }
      if (this.priority) {
        metaParts += `<div class="lex-acard-dot" data-priority="${this.escapeHtml(this.priority)}"></div>`;
      }
      if (this.feedback) {
        metaParts += '<div class="lex-acard-feedback">'
          + '<button class="lex-acard-fb-btn lex-acard-fb-btn--accept" aria-label="Accept" title="Accept" type="button" data-fb="accept">' + FB_ACCEPT_SVG + '</button>'
          + '<button class="lex-acard-fb-btn lex-acard-fb-btn--assign" aria-label="Assign to Lana" title="Assign to Lana" type="button" data-fb="assign">' + FB_ASSIGN_SVG + '</button>'
          + '<button class="lex-acard-fb-btn lex-acard-fb-btn--reject" aria-label="Reject" title="Reject" type="button" data-fb="reject">' + FB_REJECT_SVG + '</button>'
          + '</div>';
      }
      if (this.dismissible && !this.feedback) {
        metaParts += `<button class="lex-acard-dismiss" aria-label="Dismiss" type="button">${DISMISS_SVG}</button>`;
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

      const dismissBtn = this.querySelector('.lex-acard-dismiss');
      if (dismissBtn) {
        this.listen(dismissBtn, 'click', (e) => {
          e.stopPropagation();
          this.emit('dismiss-click', {
            title: this.title,
            priority: this.priority,
            action: this.action
          });
        });
      }

      var fbBtns = this.querySelectorAll('.lex-acard-fb-btn');
      for (var i = 0; i < fbBtns.length; i++) {
        (function (btn) {
          var fbType = btn.getAttribute('data-fb');
          this.listen(btn, 'click', function (e) {
            e.stopPropagation();
            this.emit(fbType + '-click', {
              title: this.title,
              priority: this.priority,
              action: this.action
            });
          }.bind(this));
        }.bind(this))(fbBtns[i]);
      }
    }
  }

  defineLex('lex-action-card', LexActionCard);
})();
