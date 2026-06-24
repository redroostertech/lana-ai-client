/* Lex UI — Topbar Component
   Top navigation bar with hamburger toggle, page title,
   notification bell, and settings dropdown menu.

   Usage:
     <lex-topbar heading="Dashboard" notification-count="3"></lex-topbar>
     <lex-topbar heading="Dashboard" sticky></lex-topbar>

   Set menuItems programmatically:
     topbar.menuItems = [
       { id: 'settings', label: 'Settings', icon: 'settings' },
       { id: 'logout', label: 'Sign out', variant: 'danger' }
     ];

   Attributes:
     sticky  — pins the topbar to the top of the viewport (default: false)

   Events: topbar-menu-toggle, topbar-notification-click, topbar-settings-click, topbar-menu-action
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
        position: relative;
        z-index: var(--lex-z-sticky, 20);
      }

      lex-topbar[data-sticky="true"] {
        position: sticky;
        top: 0;
        z-index: var(--lex-z-sticky, 50);
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

      /* ── Back button (embedded chrome mode) ── */

      .lex-topbar-back {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        font-family: inherit;
        font-size: 12px;
        font-weight: var(--lex-weight-semibold);
        color: var(--lex-text-primary);
        background: var(--lex-bg-primary);
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-sm);
        cursor: pointer;
        white-space: nowrap;
        transition: background var(--lex-transition-fast),
                    border-color var(--lex-transition-fast);
      }

      .lex-topbar-back:hover {
        background: var(--lex-bg-secondary);
        border-color: var(--lex-border-strong);
      }

      .lex-topbar-back svg {
        display: block;
      }

      .lex-topbar-back-label {
        line-height: 1;
      }

      /* ── Center section ─────────────────────────────────── */

      .lex-topbar-center {
        flex: 1;
        min-width: 0;
        padding: 0 0.75rem;
      }

      @media (min-width: 1024px) {
        .lex-topbar-center {
          padding: 0 0 0 1rem;
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
        font-size: var(--lex-badge-count-size, 0.625rem);
        font-weight: var(--lex-weight-bold);
        border-radius: var(--lex-radius-full);
        line-height: 1;
      }

      /* ── Settings dropdown ─────────────────────────────── */

      .lex-topbar-dropdown-anchor {
        position: relative;
      }

      .lex-topbar-dropdown {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 180px;
        background: var(--lex-bg-primary, #FFFFFF);
        border: 1px solid var(--lex-border-default, #E8E5E1);
        border-radius: var(--lex-radius-lg, 8px);
        box-shadow: var(--lex-shadow-lg);
        padding: 4px;
        z-index: var(--lex-z-dropdown, 100);
        opacity: 0;
        transform: translateY(-4px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }

      .lex-topbar-dropdown--open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }

      .lex-topbar-dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 10px 12px;
        border: none;
        background: none;
        cursor: pointer;
        font-family: var(--lex-font-sans);
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: 500;
        color: var(--lex-text-primary, #26211C);
        border-radius: var(--lex-radius-md, 6px);
        transition: background 0.15s ease, color 0.15s ease;
        text-align: left;
      }

      .lex-topbar-dropdown-item:hover {
        background: var(--lex-bg-secondary, #F5F3F0);
      }

      .lex-topbar-dropdown-item--danger {
        color: var(--lex-color-danger-500, #F04438);
      }

      .lex-topbar-dropdown-item--danger:hover {
        background: var(--lex-color-danger-50, #FEF3F2);
      }

      .lex-topbar-dropdown-item svg {
        flex-shrink: 0;
        opacity: 0.7;
      }

      .lex-topbar-dropdown-divider {
        height: 1px;
        background: var(--lex-border-subtle, #E8E5E1);
        margin: 4px 8px;
      }

      /* ── Refresh button spin animation ───────────────── */

      [data-action="refresh"][data-spinning="true"] svg {
        animation: lex-topbar-spin 0.8s linear infinite;
      }

      @keyframes lex-topbar-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
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
        showSettings:      { type: Boolean, default: true },
        showBack:          { type: Boolean, default: false },
        backLabel:         { type: String,  default: 'Back' },
        backHref:          { type: String,  default: '' },
        menuItems:         { type: Array,   default: [] }
      };
    }

    constructor() {
      super();
      this._dropdownOpen = false;
      this._onOutsideClick = (e) => {
        if (this._dropdownOpen && !e.target.closest('.lex-topbar-dropdown-anchor')) {
          this._closeDropdown();
        }
      };
    }

    // Universal back: there is somewhere to go back to when the session has more
    // than one history entry. Decided at first paint (the left zone is not
    // rebuilt on the smart re-render path).
    _canGoBack() {
      try {
        return typeof window !== 'undefined' && !!window.history && window.history.length > 1;
      } catch (e) {
        return false;
      }
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
      // Auto-show the back button whenever the session can go back, even if the
      // page did not explicitly opt in via show-back. It replaces the hamburger
      // on inner pages (the sidebar has its own collapse control).
      const showBackBtn = this.showBack || this._canGoBack();
      if (showBackBtn) {
        html += `<button type="button" class="lex-topbar-back" data-action="back" aria-label="${this.escapeHtml(this.backLabel)}">
          ${icon('arrow-left', 'small')}
          <span class="lex-topbar-back-label">${this.escapeHtml(this.backLabel)}</span>
        </button>`;
      } else if (this.showMenuToggle) {
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

      // Refresh button (always present)
      html += `<lex-btn data-action="refresh" variant="primary" leading-icon="refresh-cw" size="sm">Refresh</lex-btn>`;

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
        html += `<div class="lex-topbar-dropdown-anchor">`;
        html += `<button type="button" class="lex-topbar-action" data-action="settings">
          ${icon('settings', 'normal')}
        </button>`;
        html += `<div class="lex-topbar-dropdown" data-dropdown></div>`;
        html += `</div>`;
      }

      html += `</div>`;
      html += `</div>`;

      return html;
    }

    updated() {
      this.delegate('click', '[data-action="menu-toggle"]', () => {
        this.emit('topbar-menu-toggle');
      });

      this.delegate('click', '[data-action="back"]', () => {
        // Emit a cancelable event first so a page can take over the back action
        // (e.g. navigate to a specific destination with context). If the page
        // calls preventDefault(), we skip the default navigation entirely.
        const ev = this.emit('topbar-back-click', { href: this.backHref }, { cancelable: true });
        if (ev && ev.defaultPrevented) return;
        // Default behavior so every page gets a working back with no per-page
        // wiring: honor an explicit backHref, otherwise step back in history.
        if (this.backHref) {
          if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
            window.Lex.Nav.go(this.backHref);
          } else {
            window.location.href = this.backHref;
          }
        } else if (window.history && window.history.length > 1) {
          window.history.back();
        }
      });

      this.delegate('click', '[data-action="refresh"]', () => {
        this.emit('topbar-refresh-click');
      });

      this.delegate('click', '[data-action="notifications"]', () => {
        this.emit('topbar-notification-click');
      });

      this.delegate('click', '[data-action="settings"]', () => {
        const items = this.menuItems || [];
        if (items.length > 0) {
          this._toggleDropdown();
        } else {
          this.emit('topbar-settings-click');
        }
      });

      this.delegate('click', '[data-menu-action]', (e, target) => {
        const actionId = target.dataset.menuAction;
        const item = (this.menuItems || []).find(m => m.id === actionId);
        this._closeDropdown();
        this.emit('topbar-menu-action', { actionId, label: item ? item.label : '' });
      });

      // Render dropdown items
      this._renderDropdownItems();
    }

    _renderDropdownItems() {
      const dropdown = this.querySelector('[data-dropdown]');
      if (!dropdown) return;

      const items = this.menuItems || [];
      if (items.length === 0) {
        dropdown.innerHTML = '';
        return;
      }

      dropdown.innerHTML = items.map((item, i) => {
        if (item.divider) return '<div class="lex-topbar-dropdown-divider"></div>';
        const variant = item.variant === 'danger' ? ' lex-topbar-dropdown-item--danger' : '';
        const iconHtml = item.icon ? icon(item.icon, 'small') : '';
        return `<button type="button" class="lex-topbar-dropdown-item${variant}" data-menu-action="${this.escapeHtml(item.id)}">${iconHtml}${this.escapeHtml(item.label)}</button>`;
      }).join('');
    }

    _toggleDropdown() {
      if (this._dropdownOpen) {
        this._closeDropdown();
      } else {
        this._openDropdown();
      }
    }

    _openDropdown() {
      const dropdown = this.querySelector('[data-dropdown]');
      if (!dropdown) return;
      this._dropdownOpen = true;
      dropdown.classList.add('lex-topbar-dropdown--open');
      // Defer so the opening click doesn't immediately close it
      requestAnimationFrame(() => {
        document.addEventListener('click', this._onOutsideClick);
      });
    }

    _closeDropdown() {
      const dropdown = this.querySelector('[data-dropdown]');
      if (!dropdown) return;
      this._dropdownOpen = false;
      dropdown.classList.remove('lex-topbar-dropdown--open');
      document.removeEventListener('click', this._onOutsideClick);
    }

    disconnected() {
      document.removeEventListener('click', this._onOutsideClick);
    }
  }

  defineLex('lex-topbar', LexTopbar);
})();
