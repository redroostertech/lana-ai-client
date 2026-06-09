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
       { id: 'connectors', label: 'Data Connectors', icon: 'plug', href: 'data-connectors.html' },
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
        display: flex;
        flex-direction: column;
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

      .lex-sidebar-app-switcher-wrap {
        padding: 0.75rem 0.75rem 0.5rem;
        border-bottom: 1px solid var(--_sb-border);
        position: relative;
        flex-shrink: 0;
      }

      .lex-sidebar-global-search-wrap {
        padding: 0.75rem 0.75rem 0;
        flex-shrink: 0;
      }

      .lex-sidebar-global-search {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        width: 100%;
        height: 2.5rem;
        padding: 0 0.625rem;
        border: 1px solid var(--_sb-border);
        border-radius: var(--lex-radius-md, 6px);
        background: color-mix(in srgb, var(--_sb-hover-bg) 72%, transparent);
        color: var(--_sb-text);
        cursor: pointer;
        text-align: left;
        transition: background var(--lex-transition-fast), border-color var(--lex-transition-fast), color var(--lex-transition-fast);
      }

      .lex-sidebar-global-search:hover {
        background: var(--_sb-hover-bg);
        border-color: color-mix(in srgb, var(--_sb-border) 70%, var(--_sb-text-muted));
        color: var(--_sb-text-active);
      }

      .lex-sidebar-global-search svg {
        flex-shrink: 0;
        color: var(--_sb-text-muted);
      }

      .lex-sidebar-global-search-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--lex-body-sm-size, 0.875rem);
      }

      .lex-sidebar-global-search-shortcut {
        flex-shrink: 0;
        padding: 0.125rem 0.375rem;
        border: 1px solid var(--_sb-border);
        border-radius: var(--lex-radius-sm, 4px);
        color: var(--_sb-text-muted);
        font-size: 0.6875rem;
        line-height: 1;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-app-switcher-wrap {
        display: flex;
        justify-content: center;
        padding: 0.5rem;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-global-search-wrap {
        display: flex;
        justify-content: center;
        padding: 0.5rem 0.5rem 0;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-global-search {
        width: 2.5rem;
        justify-content: center;
        padding: 0.5rem;
        gap: 0;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-global-search-label,
      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-global-search-shortcut {
        opacity: 0;
        width: 0;
        flex: 0 0 0px;
        overflow: hidden;
        pointer-events: none;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-app-switcher {
        width: 2.5rem;
        height: 2.5rem;
        justify-content: center;
        padding: 0.5rem;
        gap: 0;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-app-mark {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.45rem;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-app-name,
      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-app-chevron {
        opacity: 0;
        width: 0;
        overflow: hidden;
        pointer-events: none;
      }

      .lex-sidebar-app-switcher {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        min-width: 0;
        width: 100%;
        height: 2.875rem;
        padding: 0.35rem 0.45rem;
        border: 1px solid transparent;
        border-radius: var(--lex-radius-lg);
        background: transparent;
        color: var(--_sb-text-active);
        cursor: pointer;
        text-align: left;
        transition: background var(--lex-transition-fast), border-color var(--lex-transition-fast);
      }

      .lex-sidebar-app-switcher:hover,
      .lex-sidebar-app-switcher[data-open="true"] {
        background: var(--_sb-hover-bg);
        border-color: var(--_sb-border);
      }

      .lex-sidebar-app-mark {
        width: 2rem;
        height: 2rem;
        border-radius: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_sb-border) 72%, transparent);
        background:
          radial-gradient(circle at 35% 35%, var(--app-mark-a, #8bd3ff), transparent 32%),
          radial-gradient(circle at 70% 72%, var(--app-mark-b, #5b5ce2), transparent 36%),
          linear-gradient(135deg, var(--app-mark-c, #0f766e), var(--app-mark-d, #1e293b));
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
        flex-shrink: 0;
      }

      .lex-sidebar-app-name {
        flex: 1;
        min-width: 0;
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-semibold);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: opacity 0.25s ease, width 0.25s ease;
      }

      .lex-sidebar-app-chevron {
        display: flex;
        color: var(--_sb-text-muted);
        flex-shrink: 0;
        transition: opacity 0.25s ease, width 0.25s ease;
      }

      .lex-sidebar-app-menu {
        position: fixed;
        top: calc(var(--lex-topbar-height) + 4.25rem);
        left: 0.5rem;
        width: min(27rem, calc(100vw - 1rem));
        background: var(--lex-sidebar-hover-bg, #2f2b25);
        color: var(--lex-sidebar-text-active, #f8f7f4);
        border: 1px solid var(--lex-sidebar-border, rgba(255, 255, 255, 0.08));
        border-radius: var(--lex-radius-xl, 14px);
        box-shadow: var(--lex-shadow-xl, 0 24px 64px rgba(15, 23, 42, 0.18));
        overflow: hidden;
        z-index: 10050;
        display: none;
      }

      .lex-sidebar-app-menu[data-open="true"] {
        display: block;
      }

      .lex-sidebar-app-option {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        width: 100%;
        min-height: 5rem;
        padding: 0.875rem 1rem;
        border: 0;
        border-bottom: 1px solid var(--lex-sidebar-border, rgba(255, 255, 255, 0.08));
        background: transparent;
        color: inherit;
        cursor: pointer;
        text-align: left;
      }

      .lex-sidebar-app-option:last-child {
        border-bottom: 0;
      }

      .lex-sidebar-app-option:hover,
      .lex-sidebar-app-option[data-active="true"] {
        background: var(--lex-sidebar-bg, #1c1a17);
      }

      .lex-sidebar-app-option-copy {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .lex-sidebar-app-option-title {
        display: block;
        font-size: 1rem;
        line-height: 1.25;
        font-weight: 700;
        color: var(--lex-sidebar-text-active, #f8f7f4);
      }

      .lex-sidebar-app-option-desc {
        display: block;
        margin-top: 0.25rem;
        font-size: 0.8125rem;
        line-height: 1.35;
        color: var(--lex-sidebar-text-muted, #a8a29a);
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

      .lex-sidebar-scrollable-wrap {
        flex: 1;
        position: relative;
        min-height: 0;
        min-width: 0;
      }

      /* Top fade — visible only when scrolled down */
      .lex-sidebar-scrollable-wrap::before,
      .lex-sidebar-scrollable-wrap::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 2rem;
        pointer-events: none;
        z-index: 1;
        opacity: 0;
        transition: opacity 0.25s ease;
      }

      .lex-sidebar-scrollable-wrap::before {
        top: 0;
        background: linear-gradient(to bottom, var(--_sb-bg), transparent);
      }

      .lex-sidebar-scrollable-wrap::after {
        bottom: 0;
        background: linear-gradient(to top, var(--_sb-bg), transparent);
      }

      .lex-sidebar-scrollable-wrap[data-scroll-top="true"]::before {
        opacity: 1;
      }

      .lex-sidebar-scrollable-wrap[data-scroll-bottom="true"]::after {
        opacity: 1;
      }

      .lex-sidebar-scrollable {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
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

      /* Conversation list section */
      .lex-sidebar-section-has-conversations {
        display: flex;
        flex-direction: column;
      }

      .lex-sidebar-section-has-conversations .lex-sidebar-conversation-list {
        padding-bottom: 2rem;
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

      .lex-sidebar-nav-item[data-variant="create"] {
        min-height: 2.75rem;
        margin-bottom: 0.25rem;
        border: 1px solid color-mix(in srgb, var(--_sb-text-active) 22%, transparent);
        background: color-mix(in srgb, var(--_sb-text-active) 34%, var(--_sb-bg));
        color: var(--_sb-text-active);
        font-weight: var(--lex-weight-semibold, 600);
      }

      .lex-sidebar-nav-item[data-variant="create"]:hover {
        background: color-mix(in srgb, var(--_sb-text-active) 42%, var(--_sb-bg));
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
        userMenuOpen:  { type: Boolean, default: false },
        appMenuOpen:   { type: Boolean, default: false }
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
        const appMenu = this.querySelector('.lex-sidebar-app-menu');
        if (appMenu) appMenu.dataset.open = String(this.appMenuOpen);
        const appSwitcher = this.querySelector('.lex-sidebar-app-switcher');
        if (appSwitcher) appSwitcher.dataset.open = String(this.appMenuOpen);

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

      html += `<div class="lex-sidebar-global-search-wrap">${this._renderUnifiedSearch()}</div>`;
      html += `<div class="lex-sidebar-app-switcher-wrap">${this._renderAppSwitcher()}</div>`;

      // ── Body ──
      html += `<div class="lex-sidebar-body">`;

      // Static sections (non-scrollable, non-footer)
      for (const section of staticSections) {
        html += this._renderSection(section);
      }

      // Scrollable sections
      if (scrollSections.length > 0) {
        html += `<div class="lex-sidebar-scrollable-wrap">`;
        html += `<div class="lex-sidebar-scrollable">`;
        for (const section of scrollSections) {
          html += this._renderSection(section);
        }
        html += `</div>`;
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

      html += this._renderAppMenu();

      // ── User menu overlay ──
      html += this._renderUserOverlay();

      return html;
    }

    _getAppPrefix() {
      const path = window.location.pathname || '';
      const nestedDirs = ['/admin/', '/automation/', '/brainchild/', '/doc-studio/', '/deck-studio/', '/integrations/', '/insights/', '/matters/', '/voice/'];
      return nestedDirs.some((dir) => path.indexOf(dir) !== -1) ? '../' : '';
    }

    // DEPRECATED FALLBACK. Source of truth is src/js/app-catalog.js
    // (window.LanaClientApps.catalog); this inline copy only runs when that
    // module is absent. Keep in sync or remove once LanaClientApps is
    // guaranteed loaded on every shell page.
    _getAppCatalog() {
      if (window.LanaClientApps && window.LanaClientApps.catalog) {
        return window.LanaClientApps.catalog;
      }
      return {
        'lana-works': {
          id: 'lana-works',
          label: 'LanaWorks',
          description: 'Manage matters, workspaces and client operations',
          route: 'dashboard.html',
          colors: ['#82d8ff', '#4267df', '#126f62', '#111827']
        },
        'lana-agents': {
          id: 'lana-agents',
          label: 'LanaAgents',
          description: 'Browse and run AI agents',
          route: 'agents/index.html',
          colors: ['#a78bfa', '#7c3aed', '#5b21b6', '#1e1b4b']
        },
        'lana-insights': {
          id: 'lana-insights',
          label: 'LanaInsights',
          description: 'Dashboards, reporting, and firm analytics',
          route: 'admin/analytics.html',
          colors: ['#60a5fa', '#2563eb', '#7c3aed', '#0f172a']
        },
        'doc-studio': {
          id: 'doc-studio',
          label: 'Doc Studio',
          description: 'Generate decks, legal documents, PDFs, and pages',
          route: 'doc-studio/index.html',
          colors: ['#2f6f73', '#b56b45', '#17201f', '#f7f4ef']
        },
        'brainchild': {
          id: 'brainchild',
          label: 'Brainchild',
          description: 'Consolidated documents across your org and personal knowledge',
          route: 'brainchild/index.html',
          colors: ['#f4b740', '#e8743b', '#6b3fa0', '#1b1430']
        }
      };
    }

    _getDefaultAppItems() {
      // Safe fallback when discovery hasn't supplied enabled_apps yet
      // (e.g. first launch, missing field, parse error). LanaWorks is the
      // baseline app every org has; other sub-apps must be explicitly enabled.
      if (window.LanaClientApps && typeof window.LanaClientApps.defaultApps === 'function') {
        return window.LanaClientApps.defaultApps();
      }
      const catalog = this._getAppCatalog();
      return [catalog['lana-works'], catalog['lana-agents']];
    }

    // DEPRECATED FALLBACK. The source of truth for the app catalog + aliases is
    // src/js/app-catalog.js (window.LanaClientApps). This inline copy only runs
    // on the rare shell page where app-catalog.js failed to load. Keep it in
    // sync with app-catalog.js, or remove it once LanaClientApps is guaranteed
    // present on every shell page. (Note: 'lana-brain' is intentionally omitted
    // here too — it is the bridge protocol id, not a UI catalog alias.)
    _normalizeAppItem(item) {
      if (window.LanaClientApps && typeof window.LanaClientApps.normalizeApp === 'function') {
        return window.LanaClientApps.normalizeApp(item);
      }
      if (!item) return null;
      const catalog = this._getAppCatalog();
      const rawId = typeof item === 'string'
        ? item
        : (item.id || item.app_id || item.slug || item.key || '');
      const aliases = {
        works: 'lana-works',
        'lana-works': 'lana-works',
        agents: 'lana-agents',
        'lana-agents': 'lana-agents',
        insights: 'lana-insights',
        'business-intelligence': 'lana-insights',
        'lana-insights': 'lana-insights',
        'doc-studio': 'doc-studio',
        'deck-studio': 'doc-studio',
        documents: 'doc-studio',
        brainchild: 'brainchild',
        brain: 'brainchild',
        knowledge: 'brainchild'
      };
      const id = aliases[String(rawId).trim()] || String(rawId).trim();
      const base = catalog[id] || {};
      const normalized = typeof item === 'string'
        ? Object.assign({}, base, { id: id })
        : Object.assign({}, base, item, { id: id });
      if (!normalized.id || !normalized.label || !normalized.route) return null;
      return normalized;
    }

    _getAppItems() {
      const prefix = this._getAppPrefix();
      // Source of truth is the discovery payload persisted at login.
      // Fall back to defaults so sessions cached before enabled_apps shipped still render.
      let items = null;
      try {
        const raw = localStorage.getItem('lana_saved_server');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed && parsed.enabledApps) && parsed.enabledApps.length) {
            items = parsed.enabledApps;
          }
        }
      } catch (_) { /* fall through to defaults */ }
      if (!items) items = this._getDefaultAppItems();
      if (window.LanaClientApps && typeof window.LanaClientApps.normalizeAppList === 'function') {
        items = window.LanaClientApps.normalizeAppList(items);
      } else {
        items = items.map((item) => this._normalizeAppItem(item)).filter(Boolean);
      }
      return items.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        href: prefix + (item.route || ''),
        colors: Array.isArray(item.colors) ? item.colors : []
      }));
    }

    _getCurrentApp() {
      // NOTE: the dropdown filter (enabled_apps) governs tile *visibility* only.
      // It is presentation, not access control: a direct/cached route to a
      // disabled sub-app still loads and falls back to highlighting items[0].
      // True surface gating must be enforced server-side (Phase B/C protocol
      // auth); route-file presence is not an access boundary.
      const path = (window.history && window.history.state && window.history.state.path)
        || window.location.pathname
        || '';
      const items = this._getAppItems();
      const byId = (id) => items.find((it) => it.id === id);
      if (path.indexOf('/automation/') !== -1) return byId('lana-automations') || items[0];
      if (
        path.indexOf('/admin/analytics.html') !== -1 ||
        path.indexOf('admin/analytics.html') !== -1 ||
        path.indexOf('/admin/dashboard-library.html') !== -1 ||
        path.indexOf('admin/dashboard-library.html') !== -1 ||
        path.indexOf('/admin/dashboard-detail.html') !== -1 ||
        path.indexOf('admin/dashboard-detail.html') !== -1 ||
        path.indexOf('/admin/dashboard-builder.html') !== -1 ||
        path.indexOf('admin/dashboard-builder.html') !== -1 ||
        path.indexOf('/admin/reporting.html') !== -1 ||
        path.indexOf('admin/reporting.html') !== -1 ||
        path.indexOf('/admin/billable-hours.html') !== -1 ||
        path.indexOf('admin/billable-hours.html') !== -1 ||
        path.indexOf('/admin/data-visualization.html') !== -1 ||
        path.indexOf('admin/data-visualization.html') !== -1 ||
        path.indexOf('/insights/') !== -1
      ) return byId('lana-insights') || items[0];
      if (path.indexOf('/voice/') !== -1) return byId('lana-voice') || items[0];
      if (path.indexOf('/agents/') !== -1) return byId('lana-agents') || items[0];
      if (path.indexOf('/brainchild/') !== -1) return byId('brainchild') || items[0];
      if (path.indexOf('/doc-studio/') !== -1 || path.indexOf('/deck-studio/') !== -1) return byId('doc-studio') || items[0];
      return byId('lana-works') || items[0];
    }

    _renderAppMark(item) {
      const colors = item.colors || [];
      const style = [
        `--app-mark-a:${colors[0] || '#82d8ff'}`,
        `--app-mark-b:${colors[1] || '#4267df'}`,
        `--app-mark-c:${colors[2] || '#126f62'}`,
        `--app-mark-d:${colors[3] || '#111827'}`
      ].join(';');
      return `<span class="lex-sidebar-app-mark" style="${this.escapeHtml(style)}"></span>`;
    }

    _renderAppSwitcher() {
      const current = this._getCurrentApp();
      return `<button type="button" class="lex-sidebar-app-switcher" data-action="app-menu" data-open="${this.appMenuOpen}" aria-haspopup="menu" aria-expanded="${this.appMenuOpen}">
          ${this._renderAppMark(current)}
          <span class="lex-sidebar-app-name">${this.escapeHtml(current.label)}</span>
          <span class="lex-sidebar-app-chevron">${icon('chevrons-up-down', 'small') || icon('chevron-down', 'small')}</span>
        </button>`;
    }

    _renderUnifiedSearch() {
      const shortcut = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '') ? '⌘K' : 'Ctrl K';
      return `<button type="button" class="lex-sidebar-global-search" data-action="global-search" data-tooltip="Search all data">
        ${icon('search', 'normal')}
        <span class="lex-sidebar-global-search-label">Search all data</span>
        <span class="lex-sidebar-global-search-shortcut">${this.escapeHtml(shortcut)}</span>
      </button>`;
    }

    _renderAppMenu() {
      const current = this._getCurrentApp();
      const options = this._getAppItems().map((item) => {
        const isActive = item.id === current.id;
        return `<button type="button" class="lex-sidebar-app-option" data-app-switch="${this.escapeHtml(item.id)}" data-href="${this.escapeHtml(item.href)}" data-active="${isActive}">
          ${this._renderAppMark(item)}
          <span class="lex-sidebar-app-option-copy">
            <span class="lex-sidebar-app-option-title">${this.escapeHtml(item.label)}</span>
            <span class="lex-sidebar-app-option-desc">${this.escapeHtml(item.description)}</span>
          </span>
        </button>`;
      }).join('');

      return `<div class="lex-sidebar-app-menu" data-open="${this.appMenuOpen}" role="menu">
        ${options}
      </div>`;
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
      const hrefDataAttr = item.isButton && item.href ? ` data-href="${this.escapeHtml(item.href)}"` : '';
      const variantAttr = item.variant ? ` data-variant="${this.escapeHtml(item.variant)}"` : '';
      const iconHtml = item.icon ? icon(item.icon, 'normal') : '';
      const badgeHtml = item.badge
        ? `<span class="lex-sidebar-nav-badge">${this.escapeHtml(item.badge)}</span>`
        : '';

      return `<${tag} class="lex-sidebar-nav-item"${hrefAttr}${typeAttr} data-active="${isActive}" data-id="${this.escapeHtml(item.id || '')}" data-tooltip="${this.escapeHtml(item.label || '')}"${onClickAttr}${hrefDataAttr}${variantAttr}>
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
            { id: 'connectors', label: 'Data Connectors', icon: 'plug', href: 'data-connectors.html' },
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

      this.delegate('click', '[data-action="app-menu"]', () => {
        this.appMenuOpen = !this.appMenuOpen;
      });

      this.delegate('click', '[data-action="global-search"]', () => {
        if (window.UnifiedSearchModal && typeof window.UnifiedSearchModal.open === 'function') {
          window.UnifiedSearchModal.open();
        } else if (window.Lex && window.Lex.Nav && window.Lex.Nav.go) {
          try { sessionStorage.setItem('lana-open-global-search', '1'); } catch (_err) {}
          window.Lex.Nav.go('search-results.html', { replace: true });
        } else {
          try { sessionStorage.setItem('lana-open-global-search', '1'); } catch (_err) {}
          window.location.href = this._getAppPrefix() + 'app.html';
        }
      });

      // Outside-click + Escape dismiss for the app-switcher menu. Bound once
      // per instance via an idempotency flag because updated() fires on every
      // render. mousedown (capture) fires before any click handler, so an
      // outside mousedown closes the menu before a stray click can re-trigger.
      if (!this._appMenuDismissBound) {
        this._appMenuDismissBound = true;
        this._onAppMenuOutside = (e) => {
          if (!this.appMenuOpen) return;
          if (e.target.closest && (
            e.target.closest('[data-action="app-menu"]') ||
            e.target.closest('.lex-sidebar-app-menu')
          )) return;
          this.appMenuOpen = false;
        };
        this._onAppMenuKey = (e) => {
          if (e.key === 'Escape' && this.appMenuOpen) {
            this.appMenuOpen = false;
          }
        };
        document.addEventListener('mousedown', this._onAppMenuOutside, true);
        document.addEventListener('keydown', this._onAppMenuKey);
      }

      this.delegate('click', '[data-app-switch]', (e, target) => {
        e.preventDefault();
        const href = target.dataset.href || '';
        this.appMenuOpen = false;
        if (!href) return;
        if (window.Lex && window.Lex.Nav && !/^(https?:)?\/\//.test(href)) {
          window.Lex.Nav.go(href);
        } else {
          window.location.href = href;
        }
      });

      // Nav item click
      this.delegate('click', '.lex-sidebar-nav-item', (e, target) => {
        const id = target.dataset.id;
        const isButton = target.tagName === 'BUTTON';
        const label = target.querySelector('.lex-sidebar-nav-label');
        const href = target.getAttribute('href') || target.dataset.href || '';
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
        } else if (isButton && href) {
          this.open = false;
          this.emit('sidebar-close');
          if (window.Lex && window.Lex.Nav && window.Lex.Nav.go) {
            window.Lex.Nav.go(href);
          } else {
            window.location.href = href;
          }
        }

        // Close sidebar on mobile after navigation
        if (!isButton) {
          this.open = false;
          this.emit('sidebar-close');
        }
      });

      // Scroll detection: infinite scroll + fade indicators
      const scrollable = this.querySelector('.lex-sidebar-scrollable');
      const scrollWrap = this.querySelector('.lex-sidebar-scrollable-wrap');
      if (scrollable && !scrollable._lexScrollBound) {
        scrollable._lexScrollBound = true;

        const updateFades = () => {
          if (!scrollWrap) return;
          const { scrollTop, scrollHeight, clientHeight } = scrollable;
          scrollWrap.dataset.scrollTop = String(scrollTop > 4);
          scrollWrap.dataset.scrollBottom = String(scrollTop + clientHeight < scrollHeight - 4);
        };

        scrollable.addEventListener('scroll', () => {
          updateFades();

          // Infinite scroll detection (debounced)
          clearTimeout(scrollable._lexScrollTimeout);
          scrollable._lexScrollTimeout = setTimeout(() => {
            const { scrollTop, scrollHeight, clientHeight } = scrollable;
            if (scrollTop + clientHeight >= scrollHeight - 100) {
              this.emit('sidebar-scroll-end');
            }
          }, 150);
        });

        // Initial check after content renders
        requestAnimationFrame(updateFades);
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
