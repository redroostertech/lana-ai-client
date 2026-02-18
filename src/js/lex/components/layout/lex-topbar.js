/* Lex UI — Topbar Component
   Top navigation bar with hamburger toggle, page title,
   notification bell, and settings button.

   Usage:
     <lex-topbar heading="Dashboard" notification-count="3"></lex-topbar>
     <lex-topbar heading="Dashboard" sticky></lex-topbar>

   Attributes:
     sticky  — pins the topbar to the top of the viewport (default: false)

   Events: topbar-menu-toggle, topbar-notification-click, topbar-settings-click
*/

(function () {
  'use strict';

  const { LexElement, defineLex, Icons } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-topbar-styles';
    style.textContent = `
      lex-topbar {
        display: block;
      }

      lex-topbar[data-sticky="true"] {
        position: sticky;
        top: 0;
        z-index: var(--lex-z-sticky);
      }

      .lex-topbar-root {
        display: flex;
        align-items: center;
        height: var(--lex-topbar-height);
        padding: 0 1rem;
        background: var(--lex-topbar-bg);
        border-bottom: 1px solid var(--lex-topbar-border);
        box-shadow: var(--lex-topbar-shadow);
        font-family: var(--lex-font-sans);
      }

      @media (min-width: 1024px) {
        .lex-topbar-root {
          padding: 0 2rem;
        }
      }

      /* ── Left section ───────────────────────────────────── */

      .lex-topbar-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .lex-topbar-hamburger {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.375rem;
        border: none;
        background: none;
        color: var(--lex-topbar-icon-color);
        cursor: pointer;
        border-radius: var(--lex-radius-md);
        transition: color var(--lex-transition-fast),
                    background var(--lex-transition-fast);
      }

      .lex-topbar-hamburger:hover {
        color: var(--lex-topbar-icon-hover);
        background: var(--lex-bg-tertiary);
      }

      @media (min-width: 1024px) {
        .lex-topbar-hamburger {
          display: none;
        }
      }

      /* ── Center section ─────────────────────────────────── */

      .lex-topbar-center {
        flex: 1;
        min-width: 0;
        padding: 0 0.75rem;
      }

      @media (min-width: 1024px) {
        .lex-topbar-center {
          padding: 0;
        }
      }

      .lex-topbar-heading {
        font-size: var(--lex-h5-size, 1.125rem);
        font-weight: var(--lex-weight-semibold);
        color: var(--lex-topbar-text);
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ── Right section ──────────────────────────────────── */

      .lex-topbar-right {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .lex-topbar-action {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem;
        border: none;
        background: none;
        color: var(--lex-topbar-icon-color);
        cursor: pointer;
        border-radius: var(--lex-radius-md);
        transition: color var(--lex-transition-fast),
                    background var(--lex-transition-fast);
      }

      .lex-topbar-action:hover {
        color: var(--lex-topbar-icon-hover);
        background: var(--lex-bg-tertiary);
      }

      .lex-topbar-action svg {
        display: block;
      }

      /* ── Notification badge ─────────────────────────────── */

      .lex-topbar-badge {
        position: absolute;
        top: 0.125rem;
        right: 0.125rem;
        min-width: 1rem;
        height: 1rem;
        padding: 0 0.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--lex-topbar-badge-bg);
        color: var(--lex-topbar-badge-text);
        font-size: 0.625rem;
        font-weight: var(--lex-weight-bold);
        border-radius: var(--lex-radius-full);
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  }


  // =========================================================================
  // Helper — render icon SVG
  // =========================================================================

  function icon(name, size) {
    if (Icons && Icons.has && Icons.has(name)) {
      return Icons.get({ name: name, size: size || 'medium' });
    }
    return '';
  }


  // =========================================================================
  // LexTopbar
  // =========================================================================

  class LexTopbar extends LexElement {

    static get properties() {
      return {
        heading:           { type: String,  default: '' },
        sticky:            { type: Boolean, default: false },
        showMenuToggle:    { type: Boolean, default: true },
        notificationCount: { type: Number,  default: 0 },
        showNotifications: { type: Boolean, default: true },
        showSettings:      { type: Boolean, default: true }
      };
    }

    render() {
      injectStyles();

      // ── Smart re-render: update data attrs without clobbering injected DOM ──
      this.dataset.sticky = String(this.sticky);

      const root = this.querySelector('.lex-topbar-root');
      if (root) {

        // Update heading text in-place
        const h1 = root.querySelector('.lex-topbar-heading');
        if (h1) h1.textContent = this.heading || '';

        // Update notification badge in-place
        const badge = root.querySelector('.lex-topbar-badge');
        const count = this.notificationCount;
        if (badge) {
          if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
          } else {
            badge.remove();
          }
        } else if (count > 0) {
          const bellBtn = root.querySelector('[data-action="notifications"]');
          if (bellBtn) {
            const span = document.createElement('span');
            span.className = 'lex-topbar-badge';
            span.textContent = count > 99 ? '99+' : count;
            bellBtn.appendChild(span);
          }
        }

        return null; // preserve injected DOM (e.g. sticky toggle)
      }

      // ── Full render (first paint only) ──
      let html = `<div class="lex-topbar-root">`;

      // ── Left ──
      html += `<div class="lex-topbar-left">`;
      if (this.showMenuToggle) {
        html += `<button type="button" class="lex-topbar-hamburger" data-action="menu-toggle">
          ${icon('menu', 'medium')}
        </button>`;
      }
      html += `</div>`;

      // ── Center ──
      html += `<div class="lex-topbar-center">`;
      if (this.heading) {
        html += `<h1 class="lex-topbar-heading">${this.escapeHtml(this.heading)}</h1>`;
      }
      html += `</div>`;

      // ── Right ──
      html += `<div class="lex-topbar-right">`;

      if (this.showNotifications) {
        const count = this.notificationCount;
        const badgeHtml = count > 0
          ? `<span class="lex-topbar-badge">${count > 99 ? '99+' : count}</span>`
          : '';
        html += `<button type="button" class="lex-topbar-action" data-action="notifications">
          ${icon('bell', 'normal')}
          ${badgeHtml}
        </button>`;
      }

      if (this.showSettings) {
        html += `<button type="button" class="lex-topbar-action" data-action="settings">
          ${icon('settings', 'normal')}
        </button>`;
      }

      html += `</div>`;
      html += `</div>`;

      return html;
    }

    updated() {
      this.delegate('click', '[data-action="menu-toggle"]', () => {
        this.emit('topbar-menu-toggle');
      });

      this.delegate('click', '[data-action="notifications"]', () => {
        this.emit('topbar-notification-click');
      });

      this.delegate('click', '[data-action="settings"]', () => {
        this.emit('topbar-settings-click');
      });
    }
  }

  defineLex('lex-topbar', LexTopbar);
})();
