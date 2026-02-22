/* Lex UI — Breadcrumb Component
   Navigation breadcrumb trail with collapse behavior for deep paths.

   Usage:
     <lex-breadcrumb
       items='[{"label":"Dashboard","href":"dashboard.html"},{"label":"Admin","href":"index.html"},{"label":"Users"}]'>
     </lex-breadcrumb>

   Props:
     items  Array  [{label, href?}] — last item renders as current page (no link)

   Collapse:
     When items.length > 5, shows: first / ... / last.
     Clicking "..." expands inline to show all items (no re-collapse).

   Events:
     breadcrumb-navigate { href, label, index } — emitted on link click
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-breadcrumb-styles';
    style.textContent = `
      lex-breadcrumb {
        display: block;
      }
      .lex-breadcrumb {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0;
        padding: 1rem 1.5rem 0.5rem;
        font-size: 0.875rem;
        color: var(--lex-text-secondary);
      }
      .lex-breadcrumb-link {
        color: var(--lex-text-accent);
        text-decoration: none;
        cursor: pointer;
      }
      .lex-breadcrumb-link:hover {
        text-decoration: underline;
      }
      .lex-breadcrumb-sep {
        margin: 0 0.25rem;
        opacity: 0.4;
      }
      .lex-breadcrumb-current {
        font-weight: 500;
        color: var(--lex-text-primary);
      }
      .lex-breadcrumb-ellipsis {
        background: none;
        border: none;
        padding: 0.125rem 0.375rem;
        margin: 0;
        font-size: 0.875rem;
        color: var(--lex-text-accent);
        cursor: pointer;
        border-radius: 0.25rem;
        line-height: 1;
      }
      .lex-breadcrumb-ellipsis:hover {
        background: var(--lex-bg-secondary);
        text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }

  class LexBreadcrumb extends LexElement {
    static get properties() {
      return {
        items: { type: Array, default: [] }
      };
    }

    constructor() {
      super();
      this._expanded = false;
    }

    render() {
      injectStyles();

      const items = this.items || [];
      if (items.length === 0) return '';

      const shouldCollapse = items.length > 5 && !this._expanded;
      const visibleItems = shouldCollapse
        ? [items[0], null, items[items.length - 1]]
        : items;

      const parts = [];

      for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i];

        // Add separator before non-first items
        if (i > 0) {
          parts.push('<span class="lex-breadcrumb-sep" aria-hidden="true">/</span>');
        }

        // Ellipsis placeholder
        if (item === null) {
          parts.push('<button class="lex-breadcrumb-ellipsis" data-action="expand" type="button" aria-label="Show all breadcrumb items">&hellip;</button>');
          continue;
        }

        // Determine original index for event detail
        const originalIndex = shouldCollapse
          ? (i === 0 ? 0 : items.length - 1)
          : i;
        const isLast = originalIndex === items.length - 1;

        if (isLast || !item.href) {
          parts.push('<span class="lex-breadcrumb-current" aria-current="page">' + this.escapeHtml(item.label) + '</span>');
        } else {
          parts.push(
            '<a class="lex-breadcrumb-link" data-index="' + originalIndex + '" href="' + this.escapeHtml(item.href) + '">' +
            this.escapeHtml(item.label) +
            '</a>'
          );
        }
      }

      return '<nav class="lex-breadcrumb" aria-label="Breadcrumb">' + parts.join('') + '</nav>';
    }

    updated() {
      // Delegate link clicks — use Lex.Nav.go() instead of native navigation
      this.delegate('click', '.lex-breadcrumb-link', function (e, target) {
        e.preventDefault();
        var href = target.getAttribute('href');
        var index = Number(target.getAttribute('data-index'));
        var label = target.textContent;

        this.emit('breadcrumb-navigate', { href: href, label: label, index: index });

        if (href && window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go(href);
        }
      });

      // Delegate ellipsis click — expand collapsed items
      this.delegate('click', '[data-action="expand"]', function (e) {
        e.preventDefault();
        this._expanded = true;
        this._scheduleUpdate();
      });
    }
  }

  defineLex('lex-breadcrumb', LexBreadcrumb);
})();
