/* Lex UI — Sidebar Component
   Dark-themed sidebar navigation with logo, menu sections, scrollable area,
   user profile block, and mobile slide-in behavior.

   Usage:
     <lex-sidebar
       logo-src="img/logo-light.png"
       active-id="dashboard"
     ></lex-sidebar>

     // Set sections, user data, and menu items via JS
     sidebar.sections = [
       { id: 'main', items: [...] },
       { id: 'chats', title: 'Your Chats', isScrollable: true, isConversationList: true,
         items: [{ id: 'new-chat', label: 'New Chat', icon: 'plus', isButton: true, onClick: 'openNewProjectModal' }] }
     ];
     sidebar.userName = 'Michael';
     sidebar.userEmail = '@michael.westbrooks';
     sidebar.userInitials = 'MW';
     sidebar.version = '4.0.0';
     sidebar.userMenuItems = [
       { id: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' },
       { id: 'signout', label: 'Sign Out', icon: 'log-out', action: 'signout', danger: true }
     ];

   Section flags:
     isScrollable        — placed in the scrollable middle area
     isConversationList  — renders #lexConversationListContainer for ConversationMenu injection
     isFooter            — pinned at the bottom above the user block

   Item flags:
     isButton  — renders as <button> instead of <a>
     onClick   — global function name to call when button is clicked (e.g. 'openNewProjectModal')

   Events: sidebar-close, sidebar-nav-click, sidebar-user-action, sidebar-scroll-end
*/

(function () {
  'use strict';

  const { LexElement, defineLex, Icons } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-sidebar-styles';
    style.textContent = `
      lex-sidebar {
        display: block;
      }

      /* ── Root container ─────────────────────────────────── */

      .lex-sidebar-root {
        --_sb-bg:           var(--lex-sidebar-bg);
        --_sb-text:         var(--lex-sidebar-text);
        --_sb-text-active:  var(--lex-sidebar-text-active);
        --_sb-text-muted:   var(--lex-sidebar-text-muted);
        --_sb-section-text: var(--lex-sidebar-section-text);
        --_sb-hover-bg:     var(--lex-sidebar-hover-bg);
        --_sb-active-bg:    var(--lex-sidebar-active-bg);
        --_sb-border:       var(--lex-sidebar-border);
        --_sb-avatar-bg:    var(--lex-sidebar-avatar-bg);

        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: var(--lex-sidebar-width);
        background: var(--_sb-bg);
        color: var(--_sb-text);
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        z-index: var(--lex-z-overlay);
        transform: translateX(-100%);
        transition: transform var(--lex-transition-slide), width var(--lex-transition-slide);
        font-family: var(--lex-font-sans);
      }

      @media (min-width: 1024px) {
        .lex-sidebar-root {
          transform: translateX(0);
          overflow: hidden;
        }
      }

      .lex-sidebar-root[data-open="true"] {
        transform: translateX(0);
      }

      /* ── Collapsed state ─────────────────────────────────── */
      /* Strategy: overflow:hidden on root clips content uniformly.
         Text elements fade out via opacity (transitionable).
         Layout stays the same — no justify-content or display:none snaps. */

      @media (min-width: 1024px) {
        .lex-sidebar-root[data-collapsed="true"] {
          width: var(--lex-sidebar-collapsed-width, 64px);
          overflow: hidden;
        }

        /* Collapse logo + its <a> wrapper so they take no layout space */
        .lex-sidebar-root .lex-sidebar-logo {
          transition: opacity 0.3s ease 0.05s, width 0.3s ease;
        }
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-header > a {
          width: 0;
          overflow: hidden;
          flex-shrink: 1;
        }
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-logo {
          opacity: 0;
          width: 0;
          overflow: hidden;
          pointer-events: none;
        }

        /* Center the header (collapse button only) when collapsed */
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-header {
          justify-content: center;
          padding: 0 0.5rem;
        }

        /* Fade out + collapse text elements so they take no layout space */
        .lex-sidebar-root .lex-sidebar-section-title,
        .lex-sidebar-root .lex-sidebar-nav-label,
        .lex-sidebar-root .lex-sidebar-nav-badge,
        .lex-sidebar-root .lex-sidebar-user-name,
        .lex-sidebar-root .lex-sidebar-user-chevron {
          transition: opacity 0.25s ease, width 0.25s ease, margin 0.25s ease;
          white-space: nowrap;
        }

        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-section-title {
          opacity: 0;
          height: 0;
          overflow: hidden;
          padding: 0;
          margin: 0;
          pointer-events: none;
        }

        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-nav-label,
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-nav-badge,
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-user-name,
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-user-chevron {
          opacity: 0;
          width: 0;
          flex: 0 0 0px;
          overflow: hidden;
          pointer-events: none;
        }

        /* Conversation list fades + collapses height */
        .lex-sidebar-root .lex-sidebar-conversation-list {
          transition: opacity 0.25s ease, max-height var(--lex-transition-slide);
        }
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-conversation-list {
          opacity: 0;
          max-height: 0;
          pointer-events: none;
        }

        /* Icon-only nav items when collapsed */
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-section {
          padding: 0.5rem;
          align-items: center;
        }

        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-nav-item {
          width: auto;
          gap: 0;
          justify-content: center;
          padding: 0.5rem;
          position: relative;
        }

        /* Center avatar in footer when collapsed */
        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-footer {
          padding: 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-user {
          width: auto;
          gap: 0;
          justify-content: center;
          padding: 0.5rem;
        }

        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-nav-item:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          left: calc(100% + 8px);
          top: 50%;
          transform: translateY(-50%);
          background: var(--lex-sidebar-bg, #1C1A17);
          color: var(--lex-sidebar-text-active, #fff);
          font-size: 12px;
          font-weight: 500;
          padding: 4px 10px;
          border-radius: var(--lex-radius-md, 6px);
          white-space: nowrap;
          z-index: 999;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
      }

      /* ── Header (logo area) ─────────────────────────────── */

      .lex-sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--lex-topbar-height);
        padding: 0 1.25rem;
        border-bottom: 1px solid var(--_sb-border);
        flex-shrink: 0;
      }

      .lex-sidebar-logo {
        height: var(--lex-sidebar-logo-height);
        display: block;
      }

      .lex-sidebar-close {
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0.25rem;
        border: none;
        background: none;
        color: var(--_sb-text-muted);
        cursor: pointer;
        border-radius: var(--lex-radius-sm);
        transition: color var(--lex-transition-fast);
      }

      .lex-sidebar-close:hover {
        color: var(--_sb-text-active);
      }

      @media (max-width: 1023px) {
        .lex-sidebar-close {
          display: flex;
        }
      }

      .lex-sidebar-collapse-btn {
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0.25rem;
        border: none;
        background: none;
        color: var(--_sb-text-muted);
        cursor: pointer;
        border-radius: var(--lex-radius-sm);
        transition: color var(--lex-transition-fast), transform 0.2s ease;
      }

      .lex-sidebar-collapse-btn:hover {
        color: var(--_sb-text-active);
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-collapse-btn svg {
        transform: rotate(180deg);
      }

      @media (min-width: 1024px) {
        .lex-sidebar-collapse-btn {
          display: flex;
        }
      }

      /* ── Body (scrollable menu area) ────────────────────── */
      /* min-height: 0 is critical so grid child can shrink below content size */
      .lex-sidebar-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
        min-width: 0;
      }

      .lex-sidebar-section {
        padding: 0.5rem 0.75rem;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: var(--lex-sidebar-item-gap);
      }

      .lex-sidebar-section-title {
        font-size: var(--lex-body-xs-size, 0.6875rem);
        font-weight: var(--lex-weight-semibold);
        color: var(--_sb-section-text);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 0.5rem 0.75rem 0.375rem;
        margin-top: 0.5rem;
      }

      .lex-sidebar-section-title:first-child {
        margin-top: 0;
      }

      .lex-sidebar-scrollable {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 0;
        min-width: 0;
        scrollbar-width: thin;
        scrollbar-color: var(--_sb-border) transparent;
      }

      .lex-sidebar-scrollable::-webkit-scrollbar {
        width: 4px;
      }

      .lex-sidebar-scrollable::-webkit-scrollbar-track {
        background: transparent;
      }

      .lex-sidebar-scrollable::-webkit-scrollbar-thumb {
        background: var(--_sb-border);
        border-radius: 2px;
      }

      .lex-sidebar-scrollable::-webkit-scrollbar-thumb:hover {
        background: var(--_sb-text-muted);
      }

      /* First section (e.g. Tools) stays at natural height */
      .lex-sidebar-scrollable > .lex-sidebar-section:not(.lex-sidebar-section-has-conversations) {
        flex-shrink: 0;
      }

      /* Conversation list section: fills remaining space so the list can scroll */
      .lex-sidebar-section-has-conversations {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .lex-sidebar-section-has-conversations .lex-sidebar-conversation-list {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding-bottom: 2rem;
        scroll-padding-bottom: 1rem;
      }

      .lex-sidebar-section-has-conversations .lex-sidebar-conversation-list::-webkit-scrollbar {
        width: 4px;
      }

      .lex-sidebar-section-has-conversations .lex-sidebar-conversation-list::-webkit-scrollbar-track {
        background: transparent;
      }

      .lex-sidebar-section-has-conversations .lex-sidebar-conversation-list::-webkit-scrollbar-thumb {
        background: var(--_sb-border);
        border-radius: 2px;
      }

      /* ── Nav item ───────────────────────────────────────── */

      .lex-sidebar-nav-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: var(--lex-radius-lg);
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium);
        color: var(--_sb-text);
        text-decoration: none;
        cursor: pointer;
        border: none;
        background: transparent;
        width: 100%;
        text-align: left;
        transition: background var(--lex-transition-fast),
                    color var(--lex-transition-fast);
        line-height: 1.4;
        box-sizing: border-box;
      }

      .lex-sidebar-nav-item:hover {
        background: var(--_sb-hover-bg);
        color: var(--_sb-text-active);
      }

      .lex-sidebar-nav-item[data-active="true"] {
        background: var(--_sb-active-bg);
        color: var(--_sb-text-active);
      }

      .lex-sidebar-nav-item svg {
        flex-shrink: 0;
      }

      .lex-sidebar-nav-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-sidebar-nav-badge {
        margin-left: auto;
        padding: 0.0625rem 0.4375rem;
        font-size: var(--lex-body-xs-size, 0.6875rem);
        font-weight: var(--lex-weight-semibold);
        border-radius: var(--lex-badge-radius);
        background: var(--_sb-avatar-bg);
        color: var(--_sb-text-active);
        line-height: 1.4;
      }

      /* ── Conversation list container ─────────────────────── */

      .lex-sidebar-conversation-list {
        margin-top: 0.25rem;
        padding-bottom: 2rem;
        overflow: hidden;
        min-width: 0;
      }

      .lex-sidebar-conversation-list .conversation-item {
        margin-bottom: 0.25rem;
      }

      /* ── Divider ────────────────────────────────────────── */

      .lex-sidebar-divider {
        height: 1px;
        background: var(--_sb-border);
        margin: 0.5rem 0.75rem;
      }

      /* ── Footer ─────────────────────────────────────────── */

      .lex-sidebar-footer {
        flex-shrink: 0;
        border-top: 1px solid var(--_sb-border);
        padding: 0.5rem 0.75rem;
        background: var(--_sb-bg);
        overflow: hidden;
        min-width: 0;
      }

      /* ── User profile trigger ───────────────────────────── */

      .lex-sidebar-user {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: var(--lex-radius-lg);
        cursor: pointer;
        border: none;
        background: transparent;
        width: 100%;
        text-align: left;
        color: var(--_sb-text);
        transition: background var(--lex-transition-fast),
                    color var(--lex-transition-fast);
      }

      .lex-sidebar-user:hover {
        background: var(--_sb-hover-bg);
        color: var(--_sb-text-active);
      }

      .lex-sidebar-avatar {
        width: 2rem;
        height: 2rem;
        border-radius: var(--lex-radius-full);
        background: var(--_sb-avatar-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .lex-sidebar-avatar-text {
        font-size: var(--lex-body-xs-size, 0.6875rem);
        font-weight: var(--lex-weight-medium);
        color: var(--_sb-text-active);
      }

      .lex-sidebar-user-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium);
      }

      .lex-sidebar-user-chevron {
        flex-shrink: 0;
        color: var(--_sb-text-muted);
      }

      .lex-sidebar-user-chevron svg {
        display: block;
      }

      /* ── User menu overlay ──────────────────────────────── */
      /* NOTE: The overlay is a sibling of .lex-sidebar-root (not a child),
         so we use --lex-sidebar-* tokens directly instead of --_sb-* aliases. */

      .lex-sidebar-user-overlay {
        position: fixed;
        inset: 0;
        z-index: calc(var(--lex-z-modal) + 1);
        display: none;
      }

      .lex-sidebar-user-overlay[data-open="true"] {
        display: block;
      }

      .lex-sidebar-user-overlay-backdrop {
        position: fixed;
        inset: 0;
      }

      .lex-sidebar-user-panel {
        position: fixed;
        bottom: 0;
        left: 0;
        width: var(--lex-sidebar-width);
        background: var(--lex-sidebar-hover-bg);
        border-top-left-radius: var(--lex-radius-2xl);
        border-top-right-radius: var(--lex-radius-2xl);
        box-shadow: var(--lex-shadow-xl);
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        z-index: calc(var(--lex-z-modal) + 2);
      }

      .lex-sidebar-user-panel-header {
        padding: 1rem 1rem 0.75rem;
      }

      .lex-sidebar-user-panel-handle {
        width: 2.5rem;
        height: 0.25rem;
        background: var(--lex-sidebar-border);
        border-radius: var(--lex-radius-full);
        margin: 0 auto 0.75rem;
      }

      .lex-sidebar-user-panel-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .lex-sidebar-user-panel-avatar {
        width: 3rem;
        height: 3rem;
        border-radius: var(--lex-radius-full);
        background: var(--lex-sidebar-avatar-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .lex-sidebar-user-panel-avatar-text {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-semibold);
        color: var(--lex-sidebar-text-active);
      }

      .lex-sidebar-user-panel-name {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-semibold);
        color: var(--lex-sidebar-text-active);
      }

      .lex-sidebar-user-panel-role {
        font-size: var(--lex-body-xs-size, 0.6875rem);
        color: var(--lex-sidebar-text-muted);
        margin-top: 0.125rem;
      }

      .lex-sidebar-user-panel-nav {
        padding: 0.5rem;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }

      .lex-sidebar-user-panel-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        border-radius: var(--lex-radius-lg);
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-sidebar-text);
        cursor: pointer;
        border: none;
        background: transparent;
        width: 100%;
        text-align: left;
        text-decoration: none;
        transition: background var(--lex-transition-fast),
                    color var(--lex-transition-fast);
      }

      .lex-sidebar-user-panel-item:hover {
        background: var(--lex-sidebar-bg);
        color: var(--lex-sidebar-text-active);
      }

      .lex-sidebar-user-panel-item--danger {
        color: var(--lex-color-danger-500);
      }

      .lex-sidebar-user-panel-item--danger:hover {
        color: var(--lex-color-danger-100);
      }

      .lex-sidebar-user-panel-footer {
        padding: 0.5rem 1rem 1rem;
        border-top: 1px solid var(--lex-sidebar-border);
        margin-top: 0.25rem;
      }

      .lex-sidebar-user-panel-version {
        font-size: var(--lex-body-xs-size, 0.6875rem);
        color: var(--lex-sidebar-text-muted);
      }
    `;
    document.head.appendChild(style);
  }


  // =========================================================================
  // Helper — render icon SVG
  // =========================================================================

  function icon(name, size) {
    if (Icons && Icons.has && Icons.has(name)) {
      return Icons.get({ name: name, size: size || 'normal' });
    }
    return '';
  }


  // =========================================================================
  // LexSidebar
  // =========================================================================

  class LexSidebar extends LexElement {

    static get properties() {
      return {
        sections:      { type: Array,   default: [] },
        activeId:      { type: String,  default: '' },
        logoSrc:       { type: String,  default: '' },
        logoAlt:       { type: String,  default: 'LANA AI' },
        logoHref:      { type: String,  default: 'dashboard.html' },
        userName:      { type: String,  default: '' },
        userInitials:  { type: String,  default: '' },
        userRole:      { type: String,  default: '' },
        userEmail:     { type: String,  default: '' },
        userMenuItems: { type: Array,   default: [] },
        version:       { type: String,  default: '' },
        open:          { type: Boolean, default: false, reflect: true },
        collapsed:     { type: Boolean, default: false, reflect: true },
        userMenuOpen:  { type: Boolean, default: false }
      };
    }

    constructor() {
      super();

      // Generation counters for structural Array properties.
      // Incremented each time sections or userMenuItems is assigned so that the
      // render fast-path can detect structural changes with a simple integer
      // comparison instead of JSON.stringify() on every render cycle.
      this._sectionsGen = 0;
      this._menuItemsGen = 0;

      // Wrap the reactive setters installed by LexElement so that each
      // assignment bumps the corresponding generation counter.
      const sectionsDesc = Object.getOwnPropertyDescriptor(this, 'sections');
      if (sectionsDesc && sectionsDesc.set) {
        const baseSetter = sectionsDesc.set;
        Object.defineProperty(this, 'sections', {
          get: sectionsDesc.get,
          set: (val) => { this._sectionsGen++; baseSetter.call(this, val); },
          configurable: true
        });
      }

      const menuDesc = Object.getOwnPropertyDescriptor(this, 'userMenuItems');
      if (menuDesc && menuDesc.set) {
        const baseSetter = menuDesc.set;
        Object.defineProperty(this, 'userMenuItems', {
          get: menuDesc.get,
          set: (val) => { this._menuItemsGen++; baseSetter.call(this, val); },
          configurable: true
        });
      }

      // Track the last-emitted collapsed value so _emitCollapsedState() is
      // a no-op when the collapsed state has not actually changed.
      this._lastEmittedCollapsed = null;
    }

    render() {
      injectStyles();

      // ── Fast-path: toggle-only changes don't need full re-render ──
      // This preserves external DOM content (e.g. ConversationMenu injected
      // into #lexConversationListContainer).
      const root = this.querySelector('.lex-sidebar-root');
      if (root) {
        root.dataset.open = String(this.open);
        root.dataset.collapsed = String(this.collapsed);
        this._emitCollapsedState();
        const overlay = this.querySelector('.lex-sidebar-user-overlay');
        if (overlay) overlay.dataset.open = String(this.userMenuOpen);

        // Update active states
        this.querySelectorAll('.lex-sidebar-nav-item[data-id]').forEach(el => {
          el.dataset.active = String(el.dataset.id === this.activeId);
        });

        // Check if we need a full re-render (structural props changed).
        // Use generation counters instead of JSON.stringify() to avoid O(n)
        // serialization on every property change.
        if (this._lastSectionsGen === this._sectionsGen
            && this._lastUserName === this.userName
            && this._lastUserEmail === this.userEmail
            && this._lastVersion === this.version
            && this._lastMenuItemsGen === this._menuItemsGen) {
          return null; // Skip innerHTML, preserve conversation list DOM
        }
      }

      // ── Full render ──
      this._lastSectionsGen = this._sectionsGen;
      this._lastUserName = this.userName;
      this._lastUserEmail = this.userEmail;
      this._lastVersion = this.version;
      this._lastMenuItemsGen = this._menuItemsGen;

      const sections = this.sections || [];
      const footerSections = sections.filter(s => s.isFooter);
      const staticSections = sections.filter(s => !s.isFooter && s.isStaticTop);
      const scrollSections = sections.filter(s => !s.isFooter && !s.isStaticTop);

      let html = `<div class="lex-sidebar-root" data-open="${this.open}" data-collapsed="${this.collapsed}">`;

      // ── Header ──
      html += `<div class="lex-sidebar-header">`;
      if (this.logoSrc) {
        html += `<a href="${this.escapeHtml(this.logoHref)}"><img class="lex-sidebar-logo" src="${this.escapeHtml(this.logoSrc)}" alt="${this.escapeHtml(this.logoAlt)}"></a>`;
      }
      html += `<button class="lex-sidebar-collapse-btn" data-action="collapse">${icon('chevrons-left', 'small')}</button>`;
      html += `<button class="lex-sidebar-close" data-action="close">${icon('x', 'normal')}</button>`;
      html += `</div>`;

      // ── Body ──
      html += `<div class="lex-sidebar-body">`;

      // Static sections (non-scrollable, non-footer)
      for (const section of staticSections) {
        html += this._renderSection(section);
      }

      // Scrollable sections
      if (scrollSections.length > 0) {
        html += `<div class="lex-sidebar-scrollable">`;
        for (const section of scrollSections) {
          html += this._renderSection(section);
        }
        html += `</div>`;
      }

      html += `</div>`; // end body

      // ── Footer ──
      if (footerSections.length > 0 || this.userName) {
        html += `<div class="lex-sidebar-footer">`;
        for (const section of footerSections) {
          html += this._renderSectionItems(section.items);
        }
        if (this.userName) {
          html += this._renderUserBlock();
        }
        html += `</div>`;
      }

      html += `</div>`; // end root

      // ── User menu overlay ──
      html += this._renderUserOverlay();

      return html;
    }


    _emitCollapsedState() {
      // Guard: only update the CSS variable and fire the event when the
      // collapsed state has actually changed since the last emission.
      // Previously this ran unconditionally on every fast-path render cycle,
      // causing unnecessary CSS variable writes and event dispatches.
      if (this._lastEmittedCollapsed === this.collapsed) return;
      this._lastEmittedCollapsed = this.collapsed;

      // Update the CSS variable so lex-shell-main can adjust its margin
      document.documentElement.style.setProperty(
        '--lex-sidebar-current-width',
        this.collapsed ? 'var(--lex-sidebar-collapsed-width, 64px)' : 'var(--lex-sidebar-width, 256px)'
      );
      this.emit('sidebar-collapse', { collapsed: this.collapsed });
    }

    // -----------------------------------------------------------------------
    // Section rendering
    // -----------------------------------------------------------------------

    _renderSection(section) {
      const sectionClass = section.isConversationList ? 'lex-sidebar-section lex-sidebar-section-has-conversations' : 'lex-sidebar-section';
      let html = `<div class="${sectionClass}">`;
      if (section.title) {
        html += `<div class="lex-sidebar-section-title">${this.escapeHtml(section.title)}</div>`;
      }
      html += this._renderSectionItems(section.items);
      if (section.isConversationList) {
        html += `<div class="lex-sidebar-conversation-list" id="lexConversationListContainer"></div>`;
      }
      html += `</div>`;
      return html;
    }

    _renderSectionItems(items) {
      if (!items || items.length === 0) return '';
      let html = '';
      for (const item of items) {
        html += this._renderNavItem(item);
      }
      return html;
    }

    _renderNavItem(item) {
      const isActive = item.id === this.activeId;
      const tag = item.isButton ? 'button' : 'a';
      const hrefAttr = item.isButton ? '' : ` href="${this.escapeHtml(item.href || '#')}"`;
      const typeAttr = item.isButton ? ' type="button"' : '';
      const onClickAttr = item.onClick ? ` data-onclick="${this.escapeHtml(item.onClick)}"` : '';
      const iconHtml = item.icon ? icon(item.icon, 'normal') : '';
      const badgeHtml = item.badge
        ? `<span class="lex-sidebar-nav-badge">${this.escapeHtml(item.badge)}</span>`
        : '';

      return `<${tag} class="lex-sidebar-nav-item"${hrefAttr}${typeAttr} data-active="${isActive}" data-id="${this.escapeHtml(item.id || '')}" data-tooltip="${this.escapeHtml(item.label || '')}"${onClickAttr}>
        ${iconHtml}
        <span class="lex-sidebar-nav-label">${this.escapeHtml(item.label || '')}</span>
        ${badgeHtml}
      </${tag}>`;
    }


    // -----------------------------------------------------------------------
    // User profile block
    // -----------------------------------------------------------------------

    _renderUserBlock() {
      return `<button type="button" class="lex-sidebar-user" data-action="user-menu">
        <div class="lex-sidebar-avatar">
          <span class="lex-sidebar-avatar-text">${this.escapeHtml(this.userInitials || '')}</span>
        </div>
        <span class="lex-sidebar-user-name">${this.escapeHtml(this.userName || '')}</span>
        <span class="lex-sidebar-user-chevron">${icon('chevron-down', 'small')}</span>
      </button>`;
    }


    // -----------------------------------------------------------------------
    // User menu overlay
    // -----------------------------------------------------------------------

    _renderUserOverlay() {
      const menuItems = this.userMenuItems && this.userMenuItems.length > 0
        ? this.userMenuItems
        : [
            { id: 'settings', label: 'Settings', icon: 'settings', action: 'settings' },
            { id: 'help', label: 'Help & Support', icon: 'help-circle', action: 'help' },
            { id: 'signout', label: 'Sign Out', icon: 'log-out', action: 'signout', danger: true }
          ];

      let menuHtml = '';
      for (const item of menuItems) {
        const dangerClass = item.danger ? ' lex-sidebar-user-panel-item--danger' : '';
        const tag = item.href ? 'a' : 'button';
        const hrefAttr = item.href ? ` href="${this.escapeHtml(item.href)}"` : '';
        const typeAttr = tag === 'button' ? ' type="button"' : '';
        const actionAttr = item.action ? ` data-user-action="${this.escapeHtml(item.action)}"` : ` data-user-action="${this.escapeHtml(item.id)}"`;
        const iconHtml = item.icon ? icon(item.icon, 'normal') : '';
        menuHtml += `<${tag} class="lex-sidebar-user-panel-item${dangerClass}"${hrefAttr}${typeAttr}${actionAttr}>
          ${iconHtml}
          <span>${this.escapeHtml(item.label || '')}</span>
        </${tag}>`;
      }

      const versionText = this.version || '';

      return `<div class="lex-sidebar-user-overlay" data-open="${this.userMenuOpen}">
        <div class="lex-sidebar-user-overlay-backdrop" data-action="close-user-menu"></div>
        <div class="lex-sidebar-user-panel">
          <div class="lex-sidebar-user-panel-header">
            <div class="lex-sidebar-user-panel-handle"></div>
            <div class="lex-sidebar-user-panel-info">
              <div class="lex-sidebar-user-panel-avatar">
                <span class="lex-sidebar-user-panel-avatar-text">${this.escapeHtml(this.userInitials || '')}</span>
              </div>
              <div>
                <div class="lex-sidebar-user-panel-name">${this.escapeHtml(this.userName || '')}</div>
                ${this.userEmail ? `<div class="lex-sidebar-user-panel-role">${this.escapeHtml(this.userEmail)}</div>` : ''}
              </div>
            </div>
          </div>
          <nav class="lex-sidebar-user-panel-nav">
            ${menuHtml}
          </nav>
          ${versionText ? `<div class="lex-sidebar-user-panel-footer">
            <span class="lex-sidebar-user-panel-version">${this.escapeHtml(versionText)}</span>
          </div>` : ''}
        </div>
      </div>`;
    }


    // -----------------------------------------------------------------------
    // Event binding
    // -----------------------------------------------------------------------

    updated() {
      // Close button (mobile)
      this.delegate('click', '[data-action="close"]', () => {
        this.open = false;
        this.emit('sidebar-close');
      });

      // Collapse toggle (desktop)
      this.delegate('click', '[data-action="collapse"]', () => {
        this.collapsed = !this.collapsed;
      });

      // Nav item click
      this.delegate('click', '.lex-sidebar-nav-item', (e, target) => {
        const id = target.dataset.id;
        const isButton = target.tagName === 'BUTTON';
        const label = target.querySelector('.lex-sidebar-nav-label');
        const href = target.getAttribute('href') || '';
        const onClickFn = target.dataset.onclick;

        // Prevent browser from following <a> tags — the router handles navigation
        if (!isButton && href) {
          e.preventDefault();
        }

        this.emit('sidebar-nav-click', {
          id: id,
          label: label ? label.textContent : '',
          href: href,
          isButton: isButton
        });

        // Call global onClick function if specified
        if (isButton && onClickFn && typeof window[onClickFn] === 'function') {
          window[onClickFn]();
        }

        // Close sidebar on mobile after navigation
        if (!isButton) {
          this.open = false;
          this.emit('sidebar-close');
        }
      });

      // Infinite scroll detection on scrollable area
      const scrollable = this.querySelector('.lex-sidebar-scrollable');
      if (scrollable && !scrollable._lexScrollBound) {
        scrollable._lexScrollBound = true;
        let scrollTimeout;
        scrollable.addEventListener('scroll', () => {
          clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            const { scrollTop, scrollHeight, clientHeight } = scrollable;
            if (scrollTop + clientHeight >= scrollHeight - 100) {
              this.emit('sidebar-scroll-end');
            }
          }, 150);
        });
      }

      // User menu toggle
      this.delegate('click', '[data-action="user-menu"]', () => {
        this.userMenuOpen = !this.userMenuOpen;
      });

      // Close user menu
      this.delegate('click', '[data-action="close-user-menu"]', () => {
        this.userMenuOpen = false;
      });

      // User menu actions — prevent default on <a> tags so the router handles navigation
      this.delegate('click', '[data-user-action]', (e, target) => {
        const action = target.dataset.userAction;
        const href = target.getAttribute('href') || '';
        if (href && target.tagName === 'A') {
          e.preventDefault();
        }
        this.userMenuOpen = false;
        this.emit('sidebar-user-action', { action: action, href: href });
      });

      // Sync collapsed CSS variable after a full re-render.
      // _emitCollapsedState() is guarded internally — it is a no-op when the
      // collapsed value has not changed since the last emission.
      this._emitCollapsedState();
    }
  }

  defineLex('lex-sidebar', LexSidebar);
})();
