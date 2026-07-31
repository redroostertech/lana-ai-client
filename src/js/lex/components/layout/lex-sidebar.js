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
  const CHAT_SECTION_COLLAPSED_KEY = 'lana:sidebar:chatsCollapsed';
  const TASK_SECTION_COLLAPSED_KEY = 'lana:sidebar:tasksCollapsed';
  const WORKSPACE_SECTION_COLLAPSED_KEY = 'lana:sidebar:workspacesCollapsed';

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

        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-section-toggle {
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

        .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-section[data-static-top="false"] {
          display: none;
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
        height: 2.5rem;
        justify-content: center;
        padding: 0.5rem;
        gap: 0;
        box-sizing: border-box;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-global-search svg {
        width: 1.25rem;
        height: 1.25rem;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-global-search-label,
      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-global-search-shortcut {
        opacity: 0;
        width: 0;
        flex: 0 0 0px;
        overflow: hidden;
        pointer-events: none;
        /* Zero the residual box (the shortcut keeps its base padding + 1px
           border otherwise) so the icon centers in the collapsed square. */
        padding: 0;
        margin: 0;
        border-width: 0;
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

      .lex-sidebar-section-toggle-row {
        position: relative;
        display: flex;
        align-items: center;
        margin-top: 0.5rem;
        min-width: 0;
      }

      .lex-sidebar-section-toggle {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 0.5rem;
        width: 100%;
        padding: 0.5rem 0.75rem 0.375rem;
        padding-right: 4rem;
        border: 0;
        border-radius: var(--lex-radius-md, 6px);
        background: transparent;
        color: var(--_sb-section-text);
        cursor: pointer;
        font-size: var(--lex-body-xs-size, 0.6875rem);
        font-weight: var(--lex-weight-semibold);
        letter-spacing: 0.06em;
        line-height: 1.4;
        text-align: left;
        text-transform: uppercase;
        transition: background var(--lex-transition-fast), color var(--lex-transition-fast);
      }

      .lex-sidebar-section-toggle:hover {
        background: color-mix(in srgb, var(--_sb-hover-bg) 56%, transparent);
        color: var(--_sb-text-active);
      }

      .lex-sidebar-section-toggle:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_sb-text-muted) 36%, transparent);
      }

      .lex-sidebar-section-toggle-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-sidebar-section-toggle-icon {
        position: absolute;
        top: 50%;
        right: 0.75rem;
        display: inline-flex;
        color: var(--_sb-text-muted);
        transform: translateY(-50%) rotate(0deg);
        transition: transform var(--lex-transition-fast), color var(--lex-transition-fast);
      }

      .lex-sidebar-section-toggle:hover .lex-sidebar-section-toggle-icon {
        color: var(--_sb-text-active);
      }

      .lex-sidebar-section-create {
        position: absolute;
        top: 50%;
        right: 2.125rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        padding: 0;
        border: 0;
        border-radius: var(--lex-radius-md, 6px);
        background: transparent;
        color: var(--_sb-text-muted);
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-50%) scale(0.92);
        transition: opacity var(--lex-transition-fast),
                    transform var(--lex-transition-fast),
                    background var(--lex-transition-fast),
                    color var(--lex-transition-fast);
      }

      .lex-sidebar-section-toggle-row:hover .lex-sidebar-section-create,
      .lex-sidebar-section-toggle-row:focus-within .lex-sidebar-section-create {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(-50%) scale(1);
      }

      .lex-sidebar-section-create:hover,
      .lex-sidebar-section-create:focus-visible {
        background: color-mix(in srgb, var(--_sb-hover-bg) 80%, transparent);
        color: var(--_sb-text-active);
        outline: none;
      }

      .lex-sidebar-collapsible-section[data-collapsed="true"] .lex-sidebar-section-toggle-icon {
        transform: translateY(-50%) rotate(-90deg);
      }

      .lex-sidebar-section-content {
        display: flex;
        flex-direction: column;
        gap: var(--lex-sidebar-item-gap);
        min-width: 0;
      }

      .lex-sidebar-collapsible-section[data-collapsed="true"] .lex-sidebar-section-content {
        display: none;
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

      /* Collapsible dynamic sections */
      .lex-sidebar-collapsible-section {
        display: flex;
        flex-direction: column;
        margin-top: 0.5rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--_sb-border);
      }

      .lex-sidebar-dynamic-list {
        margin-top: 0.25rem;
        overflow: hidden;
        min-width: 0;
      }

      .lex-sidebar-dynamic-empty,
      .lex-sidebar-dynamic-error,
      .lex-sidebar-dynamic-loading {
        padding: 0.5rem 0.75rem;
        color: var(--_sb-text-muted);
        font-size: var(--lex-body-xs-size, 0.75rem);
        line-height: 1.4;
      }

      .lex-sidebar-workspace-group {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
      }

      .lex-sidebar-workspace-group + .lex-sidebar-workspace-group {
        margin-top: 0.375rem;
      }

      .lex-sidebar-workspace-group-title {
        padding: 0.25rem 0.75rem 0.125rem;
        color: var(--_sb-section-text);
        font-size: 0.625rem;
        font-weight: var(--lex-weight-semibold, 600);
        letter-spacing: 0.06em;
        line-height: 1.3;
        text-transform: uppercase;
      }

      .lex-sidebar-workspace-group-title[data-group="pinned"] {
        color: var(--lex-status-warning, #F79009);
      }

      .lex-sidebar-workspace-item {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        width: 100%;
        min-width: 0;
        min-height: 2.25rem;
        padding: 0.375rem 0.75rem;
        border: 0;
        border-radius: var(--lex-radius-lg, 8px);
        background: transparent;
        color: var(--_sb-text);
        cursor: pointer;
        overflow: hidden;
        text-align: left;
        transition: background var(--lex-transition-fast), color var(--lex-transition-fast);
      }

      .lex-sidebar-workspace-item:hover,
      .lex-sidebar-workspace-item:focus-visible {
        background: var(--_sb-hover-bg);
        color: var(--_sb-text-active);
        outline: none;
      }

      .lex-sidebar-workspace-icon {
        display: inline-flex;
        flex: 0 0 auto;
        color: var(--_sb-text-muted);
      }

      .lex-sidebar-workspace-copy {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
      }

      .lex-sidebar-workspace-name {
        display: block;
        overflow: hidden;
        color: currentColor;
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium, 500);
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-sidebar-workspace-meta {
        overflow: hidden;
        color: var(--_sb-text-muted);
        font-size: var(--lex-body-xs-size, 0.75rem);
        line-height: 1.3;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-sidebar-workspace-pin {
        display: inline-flex;
        flex: 0 0 auto;
        color: var(--_sb-text-muted);
      }

      .lex-sidebar-task-group {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        min-width: 0;
      }

      .lex-sidebar-task-group + .lex-sidebar-task-group {
        margin-top: 0.375rem;
      }

      .lex-sidebar-task-group-title {
        padding: 0.25rem 0.75rem 0.125rem;
        color: var(--_sb-section-text);
        font-size: 0.625rem;
        font-weight: var(--lex-weight-semibold, 600);
        letter-spacing: 0.06em;
        line-height: 1.3;
        text-transform: uppercase;
      }

      .lex-sidebar-task-group-title[data-priority="urgent"] {
        color: var(--lex-status-danger, #F04438);
      }

      .lex-sidebar-task-group-title[data-priority="high"] {
        color: var(--lex-status-warning, #F79009);
      }

      .lex-sidebar-task-group-title[data-priority="normal"] {
        color: var(--lex-status-info, #2E90FA);
      }

      .lex-sidebar-task-group-title[data-priority="low"] {
        color: var(--_sb-text-muted);
      }

      .lex-sidebar-task-item {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        width: 100%;
        min-width: 0;
        min-height: 2.25rem;
        padding: 0.375rem 0.75rem;
        border: 0;
        border-radius: var(--lex-radius-lg, 8px);
        background: transparent;
        color: var(--_sb-text);
        cursor: pointer;
        overflow: hidden;
        text-align: left;
        transition: background var(--lex-transition-fast), color var(--lex-transition-fast);
      }

      .lex-sidebar-task-item:hover,
      .lex-sidebar-task-item:focus-visible {
        background: var(--_sb-hover-bg);
        color: var(--_sb-text-active);
        outline: none;
      }

      .lex-sidebar-task-icon {
        display: inline-flex;
        flex: 0 0 auto;
        color: var(--_sb-text-muted);
      }

      .lex-sidebar-task-copy {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
      }

      .lex-sidebar-task-name {
        display: block;
        overflow: hidden;
        color: currentColor;
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium, 500);
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-sidebar-task-meta {
        display: block;
        overflow: hidden;
        color: var(--_sb-text-muted);
        font-size: var(--lex-body-xs-size, 0.75rem);
        line-height: 1.3;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-sidebar-show-more {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 2rem;
        margin-top: 0.25rem;
        padding: 0.375rem 0.75rem;
        border: 1px solid color-mix(in srgb, var(--_sb-text-muted) 24%, transparent);
        border-radius: var(--lex-radius-lg, 8px);
        background: transparent;
        color: var(--_sb-text);
        cursor: pointer;
        font-size: var(--lex-body-xs-size, 0.75rem);
        font-weight: var(--lex-weight-medium, 500);
        transition: background var(--lex-transition-fast),
                    border-color var(--lex-transition-fast),
                    color var(--lex-transition-fast);
      }

      .lex-sidebar-show-more:hover,
      .lex-sidebar-show-more:focus-visible {
        background: var(--_sb-hover-bg);
        border-color: color-mix(in srgb, var(--_sb-text-muted) 44%, transparent);
        color: var(--_sb-text-active);
        outline: none;
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

      .lex-sidebar-nav-item[data-variant="create"],
      .lex-sidebar-nav-item[data-variant="create-chat"] {
        min-height: 2.5rem;
        margin: 0.25rem 0 0.5rem;
        padding: 0 0.75rem;
        gap: 0.625rem;
        border: 1px solid color-mix(in srgb, var(--_sb-text-muted) 32%, transparent);
        border-radius: var(--lex-radius-lg, 8px);
        background: transparent;
        color: var(--_sb-text-active);
        font-weight: var(--lex-weight-semibold, 600);
      }

      .lex-sidebar-nav-item[data-variant="create"][data-active="true"],
      .lex-sidebar-nav-item[data-variant="create-chat"][data-active="true"] {
        background: transparent;
      }

      .lex-sidebar-nav-item[data-variant="create"]:hover,
      .lex-sidebar-nav-item[data-variant="create"]:focus-visible,
      .lex-sidebar-nav-item[data-variant="create-chat"]:hover,
      .lex-sidebar-nav-item[data-variant="create-chat"]:focus-visible {
        background: transparent;
        border-color: color-mix(in srgb, var(--_sb-text-muted) 52%, transparent);
      }

      .lex-sidebar-create-chat-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1rem;
        flex: 0 0 1rem;
        color: currentColor;
        font-size: 1.25rem;
        font-weight: var(--lex-weight-regular, 400);
        line-height: 1;
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

      /* ── Nav group + hover-expand submenu ────────────────── */

      .lex-sidebar-subnav {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        margin-left: 1.625rem;
        padding-left: 0.5rem;
        border-left: 1px solid var(--_sb-border);
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        transition: max-height var(--lex-transition-fast),
                    opacity var(--lex-transition-fast),
                    padding-top var(--lex-transition-fast);
      }

      .lex-sidebar-nav-group[data-expanded="true"] .lex-sidebar-subnav {
        max-height: 12rem;
        opacity: 1;
        padding-top: 0.375rem;
      }

      /* Chevron rotates to signal the dropdown's open/closed state */
      .lex-sidebar-nav-chevron {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        color: var(--_sb-text-muted);
        transition: transform var(--lex-transition-fast),
                    color var(--lex-transition-fast);
      }

      .lex-sidebar-nav-group-toggle:hover .lex-sidebar-nav-chevron {
        color: var(--_sb-text-active);
      }

      .lex-sidebar-nav-group[data-expanded="true"] .lex-sidebar-nav-chevron {
        transform: rotate(90deg);
      }

      .lex-sidebar-nav-item[data-child="true"] {
        padding-top: 0.375rem;
        padding-bottom: 0.375rem;
        font-weight: var(--lex-weight-normal, 400);
        font-size: var(--lex-body-xs-size, 0.8125rem);
        color: var(--_sb-text-active);
      }

      /* Collapsed (icon-only) sidebar: no room for an inline submenu */
      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-subnav {
        display: none;
      }

      .lex-sidebar-root[data-collapsed="true"] .lex-sidebar-nav-chevron {
        display: none;
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

      .lex-sidebar-create-choice-overlay {
        position: fixed;
        inset: 0;
        z-index: calc(var(--lex-z-modal) + 3);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: rgba(17, 24, 39, 0.42);
      }

      .lex-sidebar-create-choice-dialog {
        width: min(22rem, calc(100vw - 2rem));
        border: 1px solid var(--lex-border, #e5e7eb);
        border-radius: var(--lex-radius-lg, 8px);
        background: var(--lex-surface, #fff);
        box-shadow: var(--lex-shadow-xl, 0 20px 40px rgba(0,0,0,0.22));
        color: var(--lex-text-strong, #111827);
        overflow: hidden;
      }

      .lex-sidebar-create-choice-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 1rem 1rem 0.625rem;
        border-bottom: 1px solid var(--lex-border, #e5e7eb);
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-semibold, 600);
      }

      .lex-sidebar-create-choice-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border: 0;
        border-radius: var(--lex-radius-md, 6px);
        background: transparent;
        color: var(--lex-text-muted, #6b7280);
        cursor: pointer;
      }

      .lex-sidebar-create-choice-actions {
        display: grid;
        gap: 0.375rem;
        padding: 0.75rem;
      }

      .lex-sidebar-create-choice-action {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        min-height: 2.75rem;
        border: 0;
        border-radius: var(--lex-radius-md, 6px);
        background: transparent;
        color: var(--lex-text, #374151);
        cursor: pointer;
        font: inherit;
        font-size: var(--lex-body-sm-size, 0.875rem);
        text-align: left;
        padding: 0.625rem 0.75rem;
      }

      .lex-sidebar-create-choice-close:hover,
      .lex-sidebar-create-choice-close:focus-visible,
      .lex-sidebar-create-choice-action:hover,
      .lex-sidebar-create-choice-action:focus-visible {
        background: var(--lex-surface-muted, #f3f4f6);
        color: var(--lex-text-strong, #111827);
        outline: none;
      }

      .lex-sidebar-create-choice-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 1.25rem;
        height: 1.25rem;
        color: var(--lex-text-muted, #6b7280);
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

      /* Text column must be allowed to shrink so a long email truncates
         instead of bleeding past the fixed-width panel. */
      .lex-sidebar-user-panel-text {
        min-width: 0;
        flex: 1 1 auto;
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
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-sidebar-user-panel-role {
        font-size: var(--lex-body-xs-size, 0.6875rem);
        color: var(--lex-sidebar-text-muted);
        margin-top: 0.125rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
      this._appCatalogGen = 0;

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

    connected() {
      this._hydrateAppItemsFromElectronStorage();
      this._bindDynamicListRefreshEvents();
    }

    disconnected() {
      if (window.Lex && window.Lex.state && this._dynamicListRefreshHandler) {
        window.Lex.state.off('auth:changed', this._dynamicListRefreshHandler);
        window.Lex.state.off('connection:changed', this._dynamicListRefreshHandler);
      }
      this._dynamicListRefreshHandler = null;
    }

    _hydrateAppItemsFromElectronStorage() {
      if (this._appStorageHydrationStarted) return;
      this._appStorageHydrationStarted = true;
      if (!window.electronAPI || typeof window.electronAPI.getSavedServer !== 'function') return;

      window.electronAPI.getSavedServer().then((result) => {
        const server = result && result.success && result.server ? result.server : null;
        if (!server || !Array.isArray(server.enabledApps) || !server.enabledApps.length) return;

        let previousApps = [];
        try {
          const raw = localStorage.getItem('lana_saved_server');
          const parsed = raw ? JSON.parse(raw) : {};
          previousApps = Array.isArray(parsed.enabledApps) ? parsed.enabledApps : [];
          localStorage.setItem('lana_saved_server', JSON.stringify(Object.assign({}, parsed, server)));
        } catch (_) {
          localStorage.setItem('lana_saved_server', JSON.stringify(server));
        }

        const before = JSON.stringify(previousApps.map((item) => item && (item.id || item.app_id || item.slug || item.key || item)).filter(Boolean));
        const after = JSON.stringify(server.enabledApps.map((item) => item && (item.id || item.app_id || item.slug || item.key || item)).filter(Boolean));
        if (before !== after) {
          this._appCatalogGen += 1;
          this._scheduleUpdate();
        }
      }).catch(() => {});
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
            && this._lastMenuItemsGen === this._menuItemsGen
            && this._lastAppCatalogGen === this._appCatalogGen) {
          return null; // Skip innerHTML, preserve conversation list DOM
        }
      }

      // ── Full render ──
      this._lastSectionsGen = this._sectionsGen;
      this._lastUserName = this.userName;
      this._lastUserEmail = this.userEmail;
      this._lastVersion = this.version;
      this._lastMenuItemsGen = this._menuItemsGen;
      this._lastAppCatalogGen = this._appCatalogGen;

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
        'lana-automations': {
          id: 'lana-automations',
          label: 'LanaAutomate',
          description: 'Build, deploy and monitor automated workflows',
          route: 'automation/index.html',
          colors: ['#ffd16f', '#f97316', '#7c3aed', '#4c1d95']
        },
        'doc-studio': {
          id: 'doc-studio',
          label: 'Doc Studio',
          description: 'Generate decks, legal documents, PDFs, and pages',
          route: 'doc-studio/index.html',
          colors: ['#2f6f73', '#b56b45', '#17201f', '#f7f4ef']
        },
        'lana-voice': {
          id: 'lana-voice',
          label: 'LanaVoice',
          description: 'Realtime voice agents and call handling',
          route: 'voice/index.html',
          colors: ['#fcd34d', '#f59e0b', '#b45309', '#1c1917']
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
        automation: 'lana-automations',
        automations: 'lana-automations',
        'lana-automate': 'lana-automations',
        'lana-automations': 'lana-automations',
        voice: 'lana-voice',
        'lana-voice': 'lana-voice',
        'doc-studio': 'doc-studio',
        'deck-studio': 'doc-studio',
        documents: 'doc-studio',
        brainchild: 'brainchild',
        brain: 'brainchild',
        knowledge: 'brainchild'
      };
      const trimmed = String(rawId).trim();
      // Mirror LanaClientApps.canonicalId: strip the legacy @-prefix used by
      // older control-plane payloads ('@insights') before alias resolution.
      const stripped = trimmed.charAt(0) === '@' ? trimmed.slice(1) : trimmed;
      const id = aliases[trimmed] || aliases[stripped] || stripped;

      // Mirror LanaClientApps.normalizeApp's EMBEDDED branch (see
      // docs/EMBEDDED-APPS-SPEC.md and app-catalog.js — keep in sync). Many
      // shell pages (dashboard.html, admin/*) run this fallback because they
      // never load app-catalog.js, so without this branch embedded partner
      // tiles silently vanish exactly there. Route objects may only be
      // 'embedded' + https, and the tile routes to the generic embed host
      // with just the id — never to a payload-chosen target.
      let embeddedRoute = null;
      if (item && typeof item === 'object' && item.route && typeof item.route === 'object') {
        embeddedRoute = item.route;
      } else if (
        item && typeof item === 'object' &&
        item.embed && typeof item.embed === 'object' &&
        item.route === 'embed.html?app=' + encodeURIComponent(id)
      ) {
        // Login persists the normalized form. Accept it on later passes only
        // when the string route is the exact generic host route for this id.
        embeddedRoute = item.embed;
      }
      if (embeddedRoute) {
        const embedRoute = embeddedRoute;
        if (embedRoute.type !== 'embedded') return null;
        let httpsOk = false;
        try {
          const parsed = new URL(embedRoute.url);
          httpsOk = parsed.protocol === 'https:' && !!parsed.hostname;
        } catch (_) { httpsOk = false; }
        if (!httpsOk) return null;
        if (!id || !item.label) return null;
        return {
          id: id,
          label: item.label,
          description: item.description || '',
          colors: Array.isArray(item.colors) ? item.colors : [],
          route: 'embed.html?app=' + encodeURIComponent(id)
        };
      }

      const base = catalog[id];
      // Fail closed: no catalog entry means no page in this bundle. Do not let a
      // caller-supplied label+route conjure a tile that navigates into a blank page.
      if (!base) return null;
      const normalized = typeof item === 'string'
        ? Object.assign({}, base)
        : Object.assign({}, base, item, { id: id, route: base.route });
      if (!normalized.id || !normalized.label || !normalized.route) return null;
      return normalized;
    }

    /**
     * True when `href` points at a surface this bundle can actually render.
     *
     * The app switcher may only navigate to routes emitted by the fail-closed
     * normalized item list: built-in catalog files or the generic embedded-app
     * host. Anything else — notably a legacy control-plane route like
     * '/insights' — is treated as unrenderable so the caller can show a message
     * instead of navigating into a blank page.
     */
    _isRenderableAppHref(href) {
      // _getAppItems is already the fail-closed boundary: built-in routes come
      // from the catalog, while embedded routes can only be the generic host
      // produced by the validated embedded descriptor. Checking that resolved
      // list keeps the click gate aligned with what the switcher rendered.
      return this._getAppItems().some((item) => item.href === href);
    }

    _notifyAppUnavailable(label) {
      const message = `${label} isn't available in this version of the desktop app. Please update, or contact your administrator.`;
      if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.error === 'function') {
        window.Lex.Toast.error(message);
        return;
      }
      // Toast component not loaded on this page — still fail loudly rather than
      // silently swallowing the click.
      try { window.alert(message); } catch (_) { /* non-interactive context */ }
      if (window.console && console.error) console.error('[lex-sidebar] ' + message);
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
      if (path.indexOf('/embed.html') !== -1 || path.indexOf('embed.html') !== -1) {
        try {
          const embeddedId = new URLSearchParams(window.location.search || '').get('app');
          if (embeddedId && byId(embeddedId)) return byId(embeddedId);
        } catch (_) { /* fall through to the workspace */ }
      }
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
      return `<button type="button" class="lex-sidebar-global-search" data-action="global-search" data-tooltip="Search Lana">
        ${icon('search', 'normal')}
        <span class="lex-sidebar-global-search-label">Search Lana</span>
        <span class="lex-sidebar-global-search-shortcut">${this.escapeHtml(shortcut)}</span>
      </button>`;
    }

    _renderAppMenu() {
      const current = this._getCurrentApp();
      const options = this._getAppItems().map((item) => {
        const isActive = item.id === current.id;
        return `<button type="button" class="lex-sidebar-app-option" data-app-switch="${this.escapeHtml(item.id)}" data-href="${this.escapeHtml(item.href)}" data-app-label="${this.escapeHtml(item.label)}" data-active="${isActive}">
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
      const isConversationList = !!section.isConversationList;
      const isTaskList = !!section.isTaskList;
      const isWorkspaceList = !!section.isWorkspaceList;
      const isCollapsible = isConversationList || isTaskList || isWorkspaceList;
      const sectionClass = [
        'lex-sidebar-section',
        isCollapsible ? 'lex-sidebar-collapsible-section' : '',
        isConversationList ? 'lex-sidebar-section-has-conversations' : '',
        isTaskList ? 'lex-sidebar-section-has-tasks' : '',
        isWorkspaceList ? 'lex-sidebar-section-has-workspaces' : ''
      ].filter(Boolean).join(' ');
      const contentId = isCollapsible ? this._getSectionContentId(section) : '';
      const isCollapsed = isCollapsible ? this._getSectionCollapsed(section) : false;
      const collapsedAttr = isCollapsible ? ` data-collapsed="${isCollapsed}" data-section-id="${this.escapeHtml(section.id || '')}"` : '';
      let html = `<div class="${sectionClass}" data-static-top="${section.isStaticTop ? 'true' : 'false'}"${collapsedAttr}>`;
      if (section.title) {
        if (isCollapsible) {
          const action = isTaskList ? 'create-task' : (isWorkspaceList ? 'create-workspace' : 'create-conversation');
          const actionLabel = isTaskList ? 'New task' : (isWorkspaceList ? 'New workspace' : 'New chat');
          const actionIcon = isTaskList
            ? (icon('plus', 'small') || icon('clipboard-check', 'small'))
            : isWorkspaceList
            ? (icon('plus', 'small') || icon('briefcase', 'small'))
            : (icon('edit', 'small') || icon('file-plus', 'small') || icon('plus', 'small'));
          html += `<div class="lex-sidebar-section-toggle-row">
            <button type="button" class="lex-sidebar-section-toggle" data-action="toggle-dynamic-section" aria-expanded="${!isCollapsed}" aria-controls="${contentId}">
              <span class="lex-sidebar-section-toggle-label">${this.escapeHtml(section.title)}</span>
              <span class="lex-sidebar-section-toggle-icon">${icon('chevron-down', 'small')}</span>
            </button>
            <button type="button" class="lex-sidebar-section-create" data-action="${action}" aria-label="${actionLabel}" title="${actionLabel}">
              ${actionIcon}
            </button>
          </div>`;
        } else {
          html += `<div class="lex-sidebar-section-title">${this.escapeHtml(section.title)}</div>`;
        }
      }
      if (isCollapsible) {
        html += `<div class="lex-sidebar-section-content" id="${contentId}">`;
      }
      html += this._renderSectionItems(section.items);
      if (isConversationList) {
        html += `<div class="lex-sidebar-conversation-list" id="lexConversationListContainer"></div>`;
      } else if (isTaskList) {
        html += `<div class="lex-sidebar-dynamic-list lex-sidebar-task-list" id="lexTaskListContainer"></div>`;
      } else if (isWorkspaceList) {
        html += `<div class="lex-sidebar-dynamic-list lex-sidebar-workspace-list" id="lexWorkspaceListContainer"></div>`;
      }
      if (isCollapsible) {
        html += `</div>`;
      }
      html += `</div>`;
      return html;
    }

    _getSectionContentId(section) {
      const rawId = section && section.id ? String(section.id) : 'conversations';
      const safeId = rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'conversations';
      return 'lex-sidebar-section-content-' + safeId;
    }

    _getSectionCollapsed(section) {
      const isTaskList = section && section.isTaskList;
      const isWorkspaceList = section && section.isWorkspaceList;
      const key = isTaskList ? TASK_SECTION_COLLAPSED_KEY : (isWorkspaceList ? WORKSPACE_SECTION_COLLAPSED_KEY : CHAT_SECTION_COLLAPSED_KEY);
      const fallback = isTaskList ? this._taskSectionCollapsed : (isWorkspaceList ? this._workspaceSectionCollapsed : this._chatSectionCollapsed);
      try {
        return localStorage.getItem(key) === 'true';
      } catch (_) {
        return fallback === true;
      }
    }

    _setSectionCollapsed(section, collapsed) {
      const isTaskList = section && section.classList && section.classList.contains('lex-sidebar-section-has-tasks');
      const isWorkspaceList = section && section.classList && section.classList.contains('lex-sidebar-section-has-workspaces');
      const key = isTaskList ? TASK_SECTION_COLLAPSED_KEY : (isWorkspaceList ? WORKSPACE_SECTION_COLLAPSED_KEY : CHAT_SECTION_COLLAPSED_KEY);
      if (isTaskList) {
        this._taskSectionCollapsed = collapsed === true;
      } else if (isWorkspaceList) {
        this._workspaceSectionCollapsed = collapsed === true;
      } else {
        this._chatSectionCollapsed = collapsed === true;
      }
      try {
        localStorage.setItem(key, String(collapsed === true));
      } catch (_) { /* localStorage can be unavailable in restricted contexts */ }
    }

    _syncDynamicSectionState(section, collapsed) {
      if (!section) return;
      section.dataset.collapsed = String(collapsed);
      const toggle = section.querySelector('[data-action="toggle-dynamic-section"]');
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
      }
    }

    _renderSectionItems(items) {
      if (!items || items.length === 0) return '';
      let html = '';
      for (const item of items) {
        html += this._renderNavItem(item);
      }
      return html;
    }

    _renderNavItem(item, isChild = false) {
      // Items with children render a click-toggle group: the parent does NOT
      // navigate — clicking it expands/collapses the indented child links, and
      // a chevron on the right rotates to signal the dropdown state.
      if (!isChild && item.children && item.children.length) {
        const childrenHtml = item.children.map((child) => this._renderNavItem(child, true)).join('');
        const iconHtml = item.icon ? icon(item.icon, 'normal') : '';
        const chevronHtml = `<span class="lex-sidebar-nav-chevron">${icon('chevron-right', 'small')}</span>`;
        const defaultChild = item.children.find((child) => child && child.href);
        const defaultHref = item.href || (defaultChild && defaultChild.href) || '';
        return `<div class="lex-sidebar-nav-group" data-expanded="false">
          <button type="button" class="lex-sidebar-nav-item lex-sidebar-nav-group-toggle" data-nav-toggle data-id="${this.escapeHtml(item.id || '')}" data-href="${this.escapeHtml(defaultHref)}" data-tooltip="${this.escapeHtml(item.label || '')}">
            ${iconHtml}
            <span class="lex-sidebar-nav-label">${this.escapeHtml(item.label || '')}</span>
            ${chevronHtml}
          </button>
          <div class="lex-sidebar-subnav">${childrenHtml}</div>
        </div>`;
      }

      const isActive = item.id === this.activeId;
      const tag = item.isButton ? 'button' : 'a';
      const hrefAttr = item.isButton ? '' : ` href="${this.escapeHtml(item.href || '#')}"`;
      const typeAttr = item.isButton ? ' type="button"' : '';
      const onClickAttr = item.onClick ? ` data-onclick="${this.escapeHtml(item.onClick)}"` : '';
      const hrefDataAttr = item.isButton && item.href ? ` data-href="${this.escapeHtml(item.href)}"` : '';
      const variantAttr = item.variant ? ` data-variant="${this.escapeHtml(item.variant)}"` : '';
      const isCreateChat = item.variant === 'create-chat';
      const iconHtml = isCreateChat
        ? '<span class="lex-sidebar-create-chat-glyph" aria-hidden="true">+</span>'
        : (item.icon ? icon(item.icon, 'normal') : '');
      const badgeHtml = item.badge
        ? `<span class="lex-sidebar-nav-badge">${this.escapeHtml(item.badge)}</span>`
        : '';

      const childAttr = isChild ? ' data-child="true"' : '';

      return `<${tag} class="lex-sidebar-nav-item"${hrefAttr}${typeAttr} data-active="${isActive}" data-id="${this.escapeHtml(item.id || '')}" data-tooltip="${this.escapeHtml(item.label || '')}"${onClickAttr}${hrefDataAttr}${variantAttr}${childAttr}>
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

    _openCollapsedCreateChooser() {
      this._closeCollapsedCreateChooser();

      const overlay = document.createElement('div');
      overlay.className = 'lex-sidebar-create-choice-overlay';
      overlay.setAttribute('role', 'presentation');
      overlay.innerHTML = `<div class="lex-sidebar-create-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="lexSidebarCreateChoiceTitle">
        <div class="lex-sidebar-create-choice-header">
          <span id="lexSidebarCreateChoiceTitle">Create</span>
          <button type="button" class="lex-sidebar-create-choice-close" data-create-choice="close" aria-label="Close">${icon('x', 'small') || '&times;'}</button>
        </div>
        <div class="lex-sidebar-create-choice-actions">
          <button type="button" class="lex-sidebar-create-choice-action" data-create-choice="chat">
            <span class="lex-sidebar-create-choice-icon">${icon('message-square', 'small') || icon('edit', 'small')}</span>
            <span>New Chat</span>
          </button>
          <button type="button" class="lex-sidebar-create-choice-action" data-create-choice="task">
            <span class="lex-sidebar-create-choice-icon">${icon('clipboard-check', 'small')}</span>
            <span>New Task</span>
          </button>
          <button type="button" class="lex-sidebar-create-choice-action" data-create-choice="workspace">
            <span class="lex-sidebar-create-choice-icon">${icon('briefcase', 'small') || icon('folder', 'small')}</span>
            <span>New Workspace</span>
          </button>
        </div>
      </div>`;

      const close = () => this._closeCollapsedCreateChooser();
      overlay.addEventListener('click', (event) => {
        const action = event.target && event.target.closest ? event.target.closest('[data-create-choice]') : null;
        if (!action) {
          if (event.target === overlay) close();
          return;
        }

        const choice = action.dataset.createChoice;
        close();
        if (choice === 'chat') {
          if (typeof window.openNewProjectModal === 'function') window.openNewProjectModal();
        } else if (choice === 'task') {
          this._openTasksIndex({ create: true });
        } else if (choice === 'workspace') {
          this._openWorkspacesIndex({ create: true });
        }
      });

      this._collapsedCreateKeyHandler = (event) => {
        if (event.key === 'Escape') close();
      };
      document.addEventListener('keydown', this._collapsedCreateKeyHandler);
      document.body.appendChild(overlay);
      this._collapsedCreateOverlay = overlay;

      const firstAction = overlay.querySelector('[data-create-choice="chat"]');
      if (firstAction && typeof firstAction.focus === 'function') firstAction.focus();
    }

    _closeCollapsedCreateChooser() {
      if (this._collapsedCreateKeyHandler) {
        document.removeEventListener('keydown', this._collapsedCreateKeyHandler);
        this._collapsedCreateKeyHandler = null;
      }
      if (this._collapsedCreateOverlay && this._collapsedCreateOverlay.parentNode) {
        this._collapsedCreateOverlay.parentNode.removeChild(this._collapsedCreateOverlay);
      }
      this._collapsedCreateOverlay = null;
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
              <div class="lex-sidebar-user-panel-text">
                <div class="lex-sidebar-user-panel-name" title="${this.escapeHtml(this.userName || '')}">${this.escapeHtml(this.userName || '')}</div>
                ${this.userEmail ? `<div class="lex-sidebar-user-panel-role" title="${this.escapeHtml(this.userEmail)}">${this.escapeHtml(this.userEmail)}</div>` : ''}
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
    // Workspace section
    // -----------------------------------------------------------------------

    _getApiClient() {
      if (window.api) return window.api;
      if (typeof api !== 'undefined') return api;
      return null;
    }

    async _waitForApiReady(client) {
      if (!client || !client._readyPromise || typeof client._readyPromise.then !== 'function') return;
      try {
        await client._readyPromise;
      } catch (_) {
        // request() still has its own Electron/localStorage fallback path.
      }
    }

    _bindDynamicListRefreshEvents() {
      if (this._dynamicListRefreshHandler) return;
      this._dynamicListRefreshHandler = () => {
        this._taskItems = null;
        this._taskHasMore = false;
        this._pinnedWorkspaceItems = null;
        this._workspaceItems = null;
        this._workspaceHasMore = false;
        this._initTaskList();
        this._initWorkspaceList();
      };

      if (window.Lex && window.Lex.state) {
        window.Lex.state.on('auth:changed', this._dynamicListRefreshHandler);
        window.Lex.state.on('connection:changed', this._dynamicListRefreshHandler);
      }
    }

    // -----------------------------------------------------------------------
    // Task section
    // -----------------------------------------------------------------------

    async _initTaskList() {
      const container = this.querySelector('#lexTaskListContainer');
      if (!container) return;

      if (Array.isArray(this._taskItems)) {
        this._renderTaskList(container);
        return;
      }

      if (this._taskListLoading) return;
      this._taskListLoading = true;
      container.innerHTML = '<div class="lex-sidebar-dynamic-loading">Loading tasks...</div>';

      try {
        const client = this._getApiClient();
        if (!client || typeof client.getMyTasks !== 'function') {
          throw new Error('Task API unavailable');
        }
        await this._waitForApiReady(client);

        const result = await client.getMyTasks({
          limit: 11,
          offset: 0,
          sort_by: 'updated_at',
          sort_dir: 'DESC'
        });
        const rows = this._normalizeTasks(result)
          .filter(Boolean)
          .sort((a, b) => {
            const aTime = new Date(a.updated_at || a.created_at || a.due_date || 0).getTime();
            const bTime = new Date(b.updated_at || b.created_at || b.due_date || 0).getTime();
            return bTime - aTime;
          });

        const total = Number(result && (result.total || result.count || (result.pagination && result.pagination.total)) || 0);
        this._taskItems = rows.slice(0, 10);
        this._taskHasMore = total > 10 || rows.length > 10;
        this._renderTaskList(container);
      } catch (error) {
        console.error('[lex-sidebar] Failed to load tasks:', error);
        container.innerHTML = '<div class="lex-sidebar-dynamic-error">Could not load tasks</div>';
      } finally {
        this._taskListLoading = false;
        requestAnimationFrame(() => this._updateScrollableFades());
      }
    }

    _normalizeTasks(response) {
      if (!response) return [];
      if (response.data) return this._normalizeTasks(response.data);
      if (Array.isArray(response)) return response;
      if (Array.isArray(response.tasks)) return response.tasks;
      if (Array.isArray(response.items)) return response.items;
      return [];
    }

    _renderTaskList(container) {
      const rows = Array.isArray(this._taskItems) ? this._taskItems : [];
      if (!rows.length) {
        container.innerHTML = '<div class="lex-sidebar-dynamic-empty">No tasks assigned</div>';
        return;
      }

      const groups = this._groupTasks(rows);
      const html = groups.map((group) => {
        const items = group.items.map((task) => this._renderTaskItem(task)).join('');
        return `<div class="lex-sidebar-task-group">
          <div class="lex-sidebar-task-group-title" data-priority="${this.escapeHtml(group.priorityKey)}">${this.escapeHtml(group.label)}</div>
          ${items}
        </div>`;
      }).join('');
      const showMore = this._taskHasMore
        ? '<button type="button" class="lex-sidebar-show-more" data-action="show-more-tasks">Show More Tasks</button>'
        : '';
      container.innerHTML = html + showMore;
    }

    _groupTasks(tasks) {
      const order = [];
      const groups = {};
      tasks.forEach((task) => {
        const priority = this._getTaskPriorityLabel(task);
        const due = this._getTaskDueBucket(task);
        const key = priority.label + '|' + due.label;
        if (!groups[key]) {
          groups[key] = {
            label: priority.label + ' Priority · ' + due.label,
            priorityKey: priority.key,
            rank: priority.rank + due.rank,
            items: []
          };
          order.push(key);
        }
        groups[key].items.push(task);
      });
      return order
        .map((key) => groups[key])
        .sort((a, b) => a.rank - b.rank);
    }

    _getTaskPriorityLabel(task) {
      const raw = String((task && (task.priority || task.task_priority || task.urgency)) || 'normal').toLowerCase();
      const normalized = raw === 'urgent' || raw === 'critical'
        ? 'Urgent'
        : raw === 'high'
        ? 'High'
        : raw === 'low'
        ? 'Low'
        : 'Normal';
      const ranks = { Urgent: 0, High: 10, Normal: 20, Low: 30 };
      return { label: normalized, key: normalized.toLowerCase(), rank: ranks[normalized] };
    }

    _getTaskDueBucket(task) {
      const value = task && (task.due_date || task.due_at || task.deadline);
      if (!value) return { label: 'No Due Date', rank: 900 };
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return { label: 'No Due Date', rank: 900 };

      const today = Lex.Utils.startOfLocalDay();
      const due = Lex.Utils.startOfLocalDay(date);
      const days = Lex.Utils.daysBetween(today, due);

      if (days < 0) return { label: 'Overdue', rank: 0 };
      if (days === 0) return { label: 'Due Today', rank: 1 };
      if (days === 1) return { label: 'Due Tomorrow', rank: 2 };
      if (days <= 7) return { label: 'Due This Week', rank: 3 };
      return { label: 'Later', rank: 4 };
    }

    _renderTaskItem(task) {
      const id = task.id || task.task_id || '';
      const title = task.title || task.name || task.task_title || 'Untitled Task';
      const titleParts = this._splitTaskTitle(title);
      const displayTitle = this._truncateTaskTitle(titleParts.taskTitle);
      const matter = this._getTaskMatterName(task);
      const meta = matter || titleParts.matterName;
      return `<button type="button" class="lex-sidebar-task-item" data-task-id="${this.escapeHtml(id)}" title="${this.escapeHtml(title)}">
        <span class="lex-sidebar-task-icon">${icon('clipboard-check', 'small')}</span>
        <span class="lex-sidebar-task-copy">
          <span class="lex-sidebar-task-name">${this.escapeHtml(displayTitle)}</span>
          ${meta ? `<span class="lex-sidebar-task-meta">${this.escapeHtml(meta)}</span>` : ''}
        </span>
      </button>`;
    }

    _getTaskMatterName(task) {
      return (
        task?.matter_name ||
        task?.matterName ||
        task?.client_matter_name ||
        task?.workspace_name ||
        task?.workspaceName ||
        task?.matter?.matter_name ||
        task?.matter?.name ||
        task?.workspace?.name ||
        ''
      );
    }

    _splitTaskTitle(title) {
      const value = String(title || '').trim();
      const separators = [' — ', ' – ', ' - '];
      for (const separator of separators) {
        const index = value.lastIndexOf(separator);
        if (index > 0 && index < value.length - separator.length) {
          return {
            taskTitle: value.slice(0, index).trim(),
            matterName: value.slice(index + separator.length).trim()
          };
        }
      }
      return { taskTitle: value, matterName: '' };
    }

    _truncateTaskTitle(title) {
      const value = String(title || '').trim();
      const maxLength = 30;
      if (value.length <= maxLength) return value;
      return value.slice(0, maxLength - 1).trimEnd() + '…';
    }

    _openTask(taskId) {
      const href = 'my-tasks.html' + (taskId ? '?task=' + encodeURIComponent(taskId) : '');
      const currentPage = ((window.location && window.location.pathname) || '').split('/').pop();
      if (currentPage === 'my-tasks.html') {
        window.location.href = this._getAppPrefix() + href;
        return;
      }
      if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
        window.Lex.Nav.go('my-tasks.html', taskId ? { params: { task: taskId } } : undefined);
      } else {
        window.location.href = this._getAppPrefix() + href;
      }
    }

    _openTasksIndex(options = {}) {
      if (options.create) {
        const createMenuItem = document.querySelector('#myTasksNewMenu [data-new-action="task"]');
        if (createMenuItem) {
          createMenuItem.click();
          return;
        }
      }

      const href = 'my-tasks.html' + (options.create ? '?action=create' : '');
      if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function' && !options.create) {
        window.Lex.Nav.go('my-tasks.html');
      } else {
        window.location.href = this._getAppPrefix() + href;
      }
    }

    // -----------------------------------------------------------------------
    // Workspace section
    // -----------------------------------------------------------------------

    async _initWorkspaceList() {
      const container = this.querySelector('#lexWorkspaceListContainer');
      if (!container) return;

      if (Array.isArray(this._workspaceItems)) {
        this._renderWorkspaceList(container);
        return;
      }

      if (this._workspaceListLoading) {
        if (!container.innerHTML.trim()) {
          container.innerHTML = '<div class="lex-sidebar-dynamic-loading">Loading workspaces...</div>';
        }
        return;
      }
      this._workspaceListLoading = true;
      const requestId = (this._workspaceListRequestId || 0) + 1;
      this._workspaceListRequestId = requestId;
      container.innerHTML = '<div class="lex-sidebar-dynamic-loading">Loading workspaces...</div>';

      try {
        const client = this._getApiClient();
        if (!client || typeof client.getMatters !== 'function') {
          throw new Error('Workspace API unavailable');
        }
        await this._waitForApiReady(client);

        const pinnedRows = typeof client.getPinnedMatters === 'function'
          ? await this._loadPinnedWorkspaces(client)
          : [];

        const result = await client.getMatters(1, 25, {
          status: 'active',
          sort_by: 'created_at',
          sort_order: 'desc'
        });
        const rows = (result.matters || result.data || result.items || [])
          .filter(Boolean)
          .sort((a, b) => {
            const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
            const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
            return bTime - aTime;
          });

        const pinnedIds = new Set(pinnedRows.map((workspace) => this._getWorkspaceId(workspace)).filter(Boolean));
        const recentRows = rows.filter((workspace) => !pinnedIds.has(this._getWorkspaceId(workspace)));
        const total = Number(result.total || result.count || (result.pagination && result.pagination.total) || 0);
        this._pinnedWorkspaceItems = pinnedRows;
        this._workspaceItems = recentRows.slice(0, 10);
        this._workspaceHasMore = total > this._workspaceItems.length + pinnedRows.length || recentRows.length > 10;
        if (this._workspaceListRequestId === requestId) {
          const liveContainer = this.querySelector('#lexWorkspaceListContainer');
          if (liveContainer) this._renderWorkspaceList(liveContainer);
        }
      } catch (error) {
        console.error('[lex-sidebar] Failed to load workspaces:', error);
        if (this._workspaceListRequestId === requestId) {
          const liveContainer = this.querySelector('#lexWorkspaceListContainer');
          if (liveContainer) {
            liveContainer.innerHTML = '<div class="lex-sidebar-dynamic-error">Could not load workspaces</div>';
          }
        }
      } finally {
        if (this._workspaceListRequestId === requestId) {
          this._workspaceListLoading = false;
          const liveContainer = this.querySelector('#lexWorkspaceListContainer');
          if (liveContainer && Array.isArray(this._workspaceItems) && !liveContainer.querySelector('.lex-sidebar-workspace-item, .lex-sidebar-dynamic-empty')) {
            this._renderWorkspaceList(liveContainer);
          }
        }
        requestAnimationFrame(() => this._updateScrollableFades());
      }
    }

    async _loadPinnedWorkspaces(client) {
      const pageSize = 100;
      const rows = [];
      let page = 1;
      let total = 0;

      do {
        const result = await client.getPinnedMatters(page, pageSize, { status: 'active' });
        const batch = (result.matters || result.data || result.items || []).filter(Boolean);
        rows.push(...batch);
        total = Number(result.total || result.count || (result.pagination && result.pagination.total) || rows.length);
        if (!batch.length || rows.length >= total) break;
        page += 1;
      } while (page <= 10);

      return rows;
    }

    _renderWorkspaceList(container) {
      const rows = Array.isArray(this._workspaceItems) ? this._workspaceItems : [];
      const pinnedRows = Array.isArray(this._pinnedWorkspaceItems) ? this._pinnedWorkspaceItems : [];
      if (!pinnedRows.length && !rows.length) {
        container.innerHTML = '<div class="lex-sidebar-dynamic-empty">No workspaces yet</div>';
        return;
      }

      const sections = [];
      if (pinnedRows.length) {
        sections.push(`<div class="lex-sidebar-workspace-group">
          <div class="lex-sidebar-workspace-group-title" data-group="pinned">Pinned Workspaces</div>
          ${pinnedRows.map((workspace) => this._renderWorkspaceItem(workspace)).join('')}
        </div>`);
      }
      if (rows.length) {
        sections.push(`<div class="lex-sidebar-workspace-group">
          <div class="lex-sidebar-workspace-group-title" data-group="recent">${pinnedRows.length ? 'Recent Workspaces' : 'Recent'}</div>
          ${rows.map((workspace) => this._renderWorkspaceItem(workspace)).join('')}
        </div>`);
      }
      const showMore = this._workspaceHasMore
        ? '<button type="button" class="lex-sidebar-show-more" data-action="show-more-workspaces">Show More Workspaces</button>'
        : '';
      container.innerHTML = sections.join('') + showMore;
    }

    _renderWorkspaceItem(workspace) {
      const id = this._getWorkspaceId(workspace);
      const name = workspace.name || workspace.matter_name || workspace.title || 'Untitled Workspace';
      const displayName = this._truncateWorkspaceTitle(name);
      const isPinned = !!(workspace.is_pinned || workspace.pinned || workspace.is_favorite);
      const pinMarkup = isPinned
        ? `<span class="lex-sidebar-workspace-pin" aria-label="Pinned" title="Pinned">${icon('pin', 'small')}</span>`
        : '';
      return `<button type="button" class="lex-sidebar-workspace-item" data-workspace-id="${this.escapeHtml(id)}" title="${this.escapeHtml(name)}">
        <span class="lex-sidebar-workspace-icon">${icon('briefcase', 'small') || icon('folder', 'small')}</span>
        <span class="lex-sidebar-workspace-copy">
          <span class="lex-sidebar-workspace-name">${this.escapeHtml(displayName)}</span>
        </span>
        ${pinMarkup}
      </button>`;
    }

    _getWorkspaceId(workspace) {
      return (workspace && (workspace.matter_id || workspace.id || workspace.uuid)) || '';
    }

    _truncateWorkspaceTitle(title) {
      const value = String(title || '').trim();
      const maxLength = 28;
      if (value.length <= maxLength) return value;
      return value.slice(0, maxLength - 1).trimEnd() + '…';
    }

    _openWorkspace(workspaceId) {
      if (!workspaceId) return;
      const href = 'workspace-details.html?id=' + encodeURIComponent(workspaceId);
      if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
        window.Lex.Nav.go('workspace-details.html', {
          params: { id: workspaceId, tab: 'activity' },
          context: { matterId: workspaceId, tab: 'activity' }
        });
      } else {
        window.location.href = this._getAppPrefix() + href;
      }
    }

    _openWorkspacesIndex(options = {}) {
      const href = 'workspaces.html' + (options.create ? '?action=create' : '');
      const createBtn = options.create ? document.getElementById('createMatterBtn') : null;
      if (createBtn) {
        createBtn.click();
        return;
      }
      if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function' && !options.create) {
        window.Lex.Nav.go('workspaces.html');
      } else {
        window.location.href = this._getAppPrefix() + href;
      }
    }


    // -----------------------------------------------------------------------
    // Event binding
    // -----------------------------------------------------------------------

    _updateScrollableFades() {
      const scrollable = this.querySelector('.lex-sidebar-scrollable');
      const scrollWrap = this.querySelector('.lex-sidebar-scrollable-wrap');
      if (!scrollable || !scrollWrap) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollable;
      scrollWrap.dataset.scrollTop = String(scrollTop > 4);
      scrollWrap.dataset.scrollBottom = String(scrollTop + clientHeight < scrollHeight - 4);
    }

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

      this.delegate('click', '[data-action="toggle-dynamic-section"]', (e, target) => {
        e.preventDefault();
        e.stopPropagation();
        const section = target.closest('.lex-sidebar-collapsible-section');
        if (!section) return;
        const collapsed = section.dataset.collapsed !== 'true';
        this._setSectionCollapsed(section, collapsed);
        this._syncDynamicSectionState(section, collapsed);
        requestAnimationFrame(() => this._updateScrollableFades());
      });

      this.delegate('click', '[data-action="create-conversation"]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openNewProjectModal === 'function') {
          window.openNewProjectModal();
        }
      });

      this.delegate('click', '[data-action="create-task"]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openTasksIndex({ create: true });
      });

      this.delegate('click', '[data-action="show-more-tasks"]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openTasksIndex();
      });

      this.delegate('click', '[data-task-id]', (e, target) => {
        e.preventDefault();
        this._openTask(target.dataset.taskId || '');
      });

      this.delegate('click', '[data-action="create-workspace"]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openWorkspacesIndex({ create: true });
      });

      this.delegate('click', '[data-action="show-more-workspaces"]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openWorkspacesIndex();
      });

      this.delegate('click', '[data-workspace-id]', (e, target) => {
        e.preventDefault();
        this._openWorkspace(target.dataset.workspaceId || '');
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
        const label = target.dataset.appLabel || 'That app';
        this.appMenuOpen = false;
        // Fail loudly, never blank. _getAppItems only emits catalog-resolved
        // routes, so an unresolvable href should be unreachable — but a stale
        // cached payload or a future catalog gap must surface as a message the
        // user can act on, not a white window they cannot navigate out of.
        if (!href || !this._isRenderableAppHref(href)) {
          this._notifyAppUnavailable(label);
          return;
        }
        if (window.Lex && window.Lex.Nav && !/^(https?:)?\/\//.test(href)) {
          window.Lex.Nav.go(href);
        } else {
          window.location.href = href;
        }
      });

      // Nav group toggle: expand/collapse the submenu instead of navigating
      this.delegate('click', '[data-nav-toggle]', (e, target) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.collapsed) {
          const href = target.dataset.href || '';
          this.emit('sidebar-nav-click', {
            id: target.dataset.id,
            label: target.textContent ? target.textContent.trim() : '',
            href: href,
            isButton: false
          });
          this.open = false;
          this.emit('sidebar-close');
          return;
        }
        const group = target.closest('.lex-sidebar-nav-group');
        if (group) {
          const expanded = group.getAttribute('data-expanded') === 'true';
          group.setAttribute('data-expanded', expanded ? 'false' : 'true');
        }
      });

      // Nav item click
      this.delegate('click', '.lex-sidebar-nav-item', (e, target) => {
        // Group toggles are handled separately and never navigate
        if (target.hasAttribute('data-nav-toggle')) return;
        const id = target.dataset.id;
        const isButton = target.tagName === 'BUTTON';
        const label = target.querySelector('.lex-sidebar-nav-label');
        const href = target.getAttribute('href') || target.dataset.href || '';
        const onClickFn = target.dataset.onclick;

        if (this.collapsed && id === 'new-chat') {
          e.preventDefault();
          e.stopPropagation();
          this._openCollapsedCreateChooser();
          return;
        }

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

        scrollable.addEventListener('scroll', () => {
          this._updateScrollableFades();

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
        requestAnimationFrame(() => this._updateScrollableFades());
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
      this._initTaskList();
      this._initWorkspaceList();
    }
  }

  defineLex('lex-sidebar', LexSidebar);
})();
