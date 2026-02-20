/* Lex UI — Detail Panel Component
   Expandable panel for showing detail snapshots below metric cards.
   Features smooth cubic-bezier animation, heading, and action button.

   Usage:
     <lex-detail-panel id="myPanel" heading="Team Overview" action-label="View all" action-href="admin/users.html">
     </lex-detail-panel>

     // Open/close:
     panel.open = true;
     panel.open = false;

     // Inject content (after mount):
     var area = panel.querySelector('.lex-detail-panel__content');
     area.innerHTML = '<div>...</div>';

     // Listen for action button click:
     panel.addEventListener('detail-action', function (e) {
       console.log(e.detail.href);
     });

   Properties:
     open         Boolean   false   Controls expand/collapse
     heading      String    ''      Panel title (top-left)
     actionLabel  String    ''      Navigation button text (attribute: action-label)
     actionHref   String    ''      SPA navigation target (attribute: action-href)

   Notes:
     After initial render, render() returns null so that externally-injected
     content in .lex-detail-panel__content is preserved across property changes.
     Heading and action button are patched directly in updated().
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-detail-panel-styles';
    style.textContent = `
      lex-detail-panel {
        display: block;
      }

      .lex-detail-panel__body {
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        transform: translateY(-8px);
        transition:
          max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
          opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
          transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .lex-detail-panel__body--open {
        opacity: 1;
        transform: translateY(0);
      }

      .lex-detail-panel__inner {
        padding: 1rem 1.25rem;
        background: var(--lex-bg-secondary, #f9fafb);
        border: 1px solid var(--lex-border-default, #d1d5db);
        border-radius: var(--lex-radius-xl, 0.75rem);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      }

      .lex-detail-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }

      .lex-detail-panel__heading {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-semibold, 600);
        color: var(--lex-text-primary);
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  }

  class LexDetailPanel extends LexElement {
    static get properties() {
      return {
        open:        { type: Boolean, default: false },
        heading:     { type: String, default: '' },
        actionLabel: { type: String, default: '' },
        actionHref:  { type: String, default: '' }
      };
    }

    constructor() {
      super();
      this._rendered = false;
    }

    render() {
      injectStyles();

      // After initial render, return null to preserve injected content
      if (this._rendered) return null;
      this._rendered = true;

      return (
        '<div class="lex-detail-panel__body">' +
          '<div class="lex-detail-panel__inner">' +
            '<div class="lex-detail-panel__header">' +
              '<span class="lex-detail-panel__heading"></span>' +
              '<lex-btn variant="ghost" size="sm" class="lex-detail-panel__action" style="display:none;">' +
                '<span class="lex-detail-panel__action-text"></span>' +
                ' <svg class="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>' +
                '</svg>' +
              '</lex-btn>' +
            '</div>' +
            '<div class="lex-detail-panel__content"></div>' +
          '</div>' +
        '</div>'
      );
    }

    updated() {
      // Patch heading text directly (no re-render wipe)
      var headingEl = this.querySelector('.lex-detail-panel__heading');
      if (headingEl) headingEl.textContent = this.heading || '';

      // Patch action button text and visibility
      var actionBtn = this.querySelector('.lex-detail-panel__action');
      var actionText = this.querySelector('.lex-detail-panel__action-text');
      if (actionBtn && actionText) {
        if (this.actionLabel) {
          actionText.textContent = this.actionLabel;
          actionBtn.style.display = '';
        } else {
          actionBtn.style.display = 'none';
        }
      }

      // Animate open/close
      var body = this.querySelector('.lex-detail-panel__body');
      if (!body) return;

      if (this.open) {
        var inner = body.querySelector('.lex-detail-panel__inner');
        if (inner) {
          // offsetHeight includes padding + border; +8 for box-shadow + border clearance
          body.style.maxHeight = (inner.offsetHeight + 8) + 'px';
        }
        body.classList.add('lex-detail-panel__body--open');
      } else {
        body.style.maxHeight = '0px';
        body.classList.remove('lex-detail-panel__body--open');
      }

      // Wire action button click
      if (actionBtn) {
        this.listen(actionBtn, 'click', function () {
          this.emit('detail-action', {
            href: this.actionHref || ''
          });
        }.bind(this));
      }
    }

    /**
     * Recalculate panel height after content changes while open.
     * Call this after injecting new content when the panel is already open.
     */
    refreshHeight() {
      if (!this.open) return;
      var body = this.querySelector('.lex-detail-panel__body');
      var inner = body ? body.querySelector('.lex-detail-panel__inner') : null;
      if (inner && body) {
        body.style.maxHeight = (inner.offsetHeight + 8) + 'px';
      }
    }
  }

  defineLex('lex-detail-panel', LexDetailPanel);
})();
