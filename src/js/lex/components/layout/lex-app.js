/* Lex UI — App Shell Component
   Single-layout shell for the LANA AI platform. Composes <lex-sidebar> and
   <lex-topbar> into a persistent shell with a content area that the router
   swaps on navigation.

   Usage:
     <lex-app
       logo-src="img/logo-light.png"
       page-title="Dashboard"
       active-nav-id="dashboard"
     ></lex-app>

   The shell renders once. Property changes patch child components in place
   rather than rebuilding the DOM (render returns null after first paint).

   The router injects page content into <main id="lex-main-content">.

   Events:
     lex-app-ready       — shell has finished first render
     lex-app-navigate    — sidebar nav item was clicked (detail: { id, href })
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  // ---------------------------------------------------------------------------
  // Style injection (once per document)
  // ---------------------------------------------------------------------------

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-app-styles';
    style.textContent = `
      /* ── Shell ── */
      lex-app {
        display: block;
        min-height: 100vh;
        background: var(--lex-bg-secondary);
      }

      /* ── Skip link ── */
      .lex-app-skip-link {
        position: absolute;
        top: -100px;
        left: 1rem;
        z-index: var(--lex-z-loader, 9999);
        padding: 0.5rem 1rem;
        background: var(--lex-bg-accent);
        color: var(--lex-text-on-accent);
        font-size: var(--lex-body-sm-size);
        font-weight: var(--lex-weight-semibold);
        border-radius: var(--lex-radius-md);
        text-decoration: none;
        transition: top var(--lex-transition-fast);
      }
      .lex-app-skip-link:focus {
        top: 1rem;
        outline: none;
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--lex-input-border-focus) 30%, transparent);
      }

      /* ── Body (content + topbar beside sidebar) ── */
      /* NOTE: transition must match lex-sidebar.js line 80 exactly */
      lex-body {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        margin-left: var(--lex-sidebar-current-width, var(--lex-sidebar-width, 256px));
        transition: margin-left var(--lex-transition-slide);
      }
      @media (max-width: 1023px) {
        lex-body {
          margin-left: 0;
          transition: none;
        }
      }

      /* ── Topbar sticky header wrapper ── */
      lex-header {
        display: block;
        position: sticky;
        top: 0;
        z-index: var(--lex-z-sticky, 20);
      }

      /* ── Page-specific topbar actions slot ── */
      #topbar-page-actions {
        display: contents;
      }

      /* ── Content area ── */
      lex-content {
        display: block;
        flex: 1;
        overflow-y: auto;
        background: var(--lex-bg-secondary);
        min-height: calc(100vh - var(--lex-topbar-height, 64px));
        transition: opacity var(--lex-transition-normal);
      }
      lex-content[data-loading="true"] {
        opacity: 0.4;
        pointer-events: none;
      }

      /* ── Reachability banner ── */
      .lex-app-offline-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: var(--lex-z-loader, 9999);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: var(--lex-color-warning-500, #f59e0b);
        color: #fff;
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium, 500);
        font-family: var(--lex-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        transform: translateY(-100%);
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        /* Dismiss: slide up + fade out, then flip visibility after animation */
        transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
                    opacity 0.3s ease,
                    visibility 0s 0.4s;
      }
      .lex-app-offline-banner.lex-app-offline-visible {
        transform: translateY(0);
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        /* Show: slide down + fade in, visibility flips immediately */
        transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1),
                    opacity 0.3s ease,
                    visibility 0s;
      }
      .lex-app-offline-banner svg {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
      }
      .lex-app-offline-banner button {
        margin-left: 0.75rem;
        padding: 0.25rem 0.75rem;
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.4);
        border-radius: var(--lex-radius-md, 6px);
        color: #fff;
        font-size: var(--lex-form-font-size, 0.8125rem);
        cursor: pointer;
        transition: background 0.15s;
      }
      .lex-app-offline-banner button:hover {
        background: rgba(255,255,255,0.35);
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // LexApp Component
  // ---------------------------------------------------------------------------

  class LexApp extends LexElement {

    static get properties() {
      return {
        pageTitle:    { type: String,  default: '' },
        activeNavId:  { type: String,  default: '' },
        logoSrc:      { type: String,  default: 'img/logo-light.png' },
        logoAlt:      { type: String,  default: 'LANA AI' },
        logoHref:     { type: String,  default: 'dashboard.html' },
        loading:      { type: Boolean, default: false },
        sidebarOpen:  { type: Boolean, default: false, reflect: true }
      };
    }

    constructor() {
      super();
      this._shellRendered = false;
      this._sections = [];
      this._userMenuItems = [];
      this._topbarMenuItems = [];
      this._notificationCount = 0;
      this._notificationInterval = null;
    }

    // -----------------------------------------------------------------------
    // Render — returns null after first paint to protect the DOM
    // -----------------------------------------------------------------------

    render() {
      injectStyles();

      if (!this._shellRendered) {
        this._shellRendered = true;
        this._buildShell();
      }

      // Return null on ALL renders — never let the framework clobber our DOM
      return null;
    }

    _buildShell() {
      this.innerHTML = `
        <a class="lex-app-skip-link" href="#lex-main-content">Skip to content</a>

        <lex-sidebar
          logo-src="${this.escapeHtml(this.logoSrc)}"
          logo-alt="${this.escapeHtml(this.logoAlt)}"
          logo-href="${this.escapeHtml(this.logoHref)}"
          active-id="${this.escapeHtml(this.activeNavId)}"
        ></lex-sidebar>

        <lex-body>
          <lex-header role="banner">
            <lex-topbar
              heading="${this.escapeHtml(this.pageTitle)}"
              sticky
            ></lex-topbar>
          </lex-header>

          <lex-content
            id="lex-main-content"
            tabindex="-1"
            role="main"
            aria-label="Page content"
            aria-live="polite"
            aria-atomic="false"
          ></lex-content>
        </lex-body>

        <lex-notification-panel></lex-notification-panel>

        <div class="lex-app-offline-banner" id="lex-offline-banner" role="alert" aria-live="assertive">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"/>
          </svg>
          <span>Unable to reach the server. Checking connection\u2026</span>
          <button type="button" id="lex-offline-retry-btn">Retry Now</button>
        </div>

        <div id="conversationActionsModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4" style="z-index: 9999;">
          <div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 class="text-xl font-semibold text-gray-900">Conversation Options</h2>
              <button onclick="ConversationActionsModal.close()" class="text-gray-400 hover:text-gray-600 transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
            <div class="p-6">
              <h3 id="modalConversationTitle" class="text-lg font-medium text-gray-900 mb-6"></h3>
              <div class="space-y-3">
                <button onclick="ConversationActionsModal.editConversation()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all group">
                  <div class="flex-shrink-0 w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                    <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                    </svg>
                  </div>
                  <div class="flex-1">
                    <div class="font-medium text-gray-900">Rename Conversation</div>
                    <div class="text-sm text-gray-500">Change the conversation name</div>
                  </div>
                </button>
                <button id="viewMatterDetailsBtn" onclick="ConversationActionsModal.viewMatterDetails()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50 transition-all group hidden">
                  <div class="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                    <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                  </div>
                  <div class="flex-1">
                    <div class="font-medium text-gray-900">View Matter Details</div>
                    <div class="text-sm text-gray-500">Open the associated matter</div>
                  </div>
                </button>
                <button onclick="ConversationActionsModal.deleteConversation()" class="w-full flex items-center gap-3 p-4 text-left bg-white border-2 border-gray-200 rounded-xl hover:border-red-300 hover:bg-red-50 transition-all group">
                  <div class="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center group-hover:bg-red-200 transition-colors">
                    <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                  </div>
                  <div class="flex-1">
                    <div class="font-medium text-gray-900">Delete Conversation</div>
                    <div class="text-sm text-gray-500">Permanently remove this conversation</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div id="renameConversationModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4" style="z-index: 10000;">
          <div class="bg-white rounded-xl shadow-2xl w-full max-w-md" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 class="text-xl font-semibold text-gray-900">Rename Conversation</h2>
              <button onclick="ConversationActionsModal.closeRename()" class="text-gray-400 hover:text-gray-600 transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
              </button>
            </div>
            <div class="p-6">
              <label class="block text-sm font-medium text-gray-700 mb-2">New Conversation Name</label>
              <input type="text" id="renameInput" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="Enter new name">
            </div>
            <div class="flex justify-end gap-3 p-6 border-t border-gray-200">
              <button onclick="ConversationActionsModal.closeRename()" class="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">Cancel</button>
              <button onclick="ConversationActionsModal.confirmRename()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Rename</button>
            </div>
          </div>
        </div>
      `;
    }

    // -----------------------------------------------------------------------
    // connected — post-first-render setup
    // -----------------------------------------------------------------------

    connected() {
      this._sidebar = this.$('lex-sidebar');
      this._topbar = this.$('lex-topbar');
      this._content = this.$('#lex-main-content');
      this._notificationPanel = this.$('lex-notification-panel');

      // Populate sidebar with user data from localStorage
      this._hydrateUser();

      // Set sidebar sections
      if (this._sidebar && this._sections.length > 0) {
        this._sidebar.sections = this._sections;
      }
      if (this._sidebar && this._userMenuItems.length > 0) {
        this._sidebar.userMenuItems = this._userMenuItems;
      }

      // Set topbar menu items
      if (this._topbar) {
        this._topbar.menuItems = this._topbarMenuItems || [];
      }

      // Initialize notification polling
      this._startNotificationPolling();

      // Initialize conversation menu in sidebar
      this._initConversationMenu();

      // Initialize backend reachability monitoring
      this._startReachabilityMonitor();

      // Subscribe to auth changes to refresh user display
      if (window.Lex && window.Lex.state) {
        this._authChangeHandler = () => { this._hydrateUser(); };
        window.Lex.state.on('auth:changed', this._authChangeHandler);
      }

      // Listen for notification count updates from the notification panel
      this._notifCountHandler = (e) => {
        var count = (e.detail && e.detail.count) || 0;
        var topbar = this.$('lex-topbar');
        if (topbar) topbar.notificationCount = count;
      };
      document.addEventListener('lex-notification-count', this._notifCountHandler);

      // Signal ready
      this.emit('lex-app-ready');
    }

    // -----------------------------------------------------------------------
    // updated — patch child components on property changes
    // -----------------------------------------------------------------------

    updated(changedProps) {
      if (changedProps.has('pageTitle')) {
        const topbar = this.$('lex-topbar');
        if (topbar) topbar.heading = this.pageTitle;
        document.title = this.pageTitle ? this.pageTitle + ' - LANA AI' : 'LANA AI';
      }

      if (changedProps.has('activeNavId')) {
        const sidebar = this.$('lex-sidebar');
        if (sidebar) sidebar.activeId = this.activeNavId;
      }

      if (changedProps.has('sidebarOpen')) {
        const sidebar = this.$('lex-sidebar');
        if (sidebar) sidebar.open = this.sidebarOpen;
      }

      if (changedProps.has('loading')) {
        const content = this.$('#lex-main-content');
        if (content) content.dataset.loading = String(this.loading);
      }

      // ── Event delegation ──

      // Hamburger toggle
      this.delegate('topbar-menu-toggle', 'lex-topbar', () => {
        this.sidebarOpen = !this.sidebarOpen;
      });

      // Sidebar close (mobile close button, or nav click on mobile)
      this.delegate('sidebar-close', 'lex-sidebar', () => {
        this.sidebarOpen = false;
      });

      // Sidebar nav click — forward to Lex.Nav (single navigation entry point)
      this.delegate('sidebar-nav-click', 'lex-sidebar', (e) => {
        this.sidebarOpen = false; // close mobile sidebar on nav
        var detail = e.detail || {};
        if (detail.href && !detail.isButton && window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go(detail.href);
        } else {
          // Legacy fallback — router listens for lex-app-navigate
          this.emit('lex-app-navigate', detail);
        }
      });

      // Sidebar user action (sign out, etc.)
      this.delegate('sidebar-user-action', 'lex-sidebar', (e) => {
        const action = e.detail && e.detail.action;
        if (action === 'signout') {
          this._handleSignOut();
        }
      });

      // Sidebar scroll end (conversation pagination)
      this.delegate('sidebar-scroll-end', 'lex-sidebar', () => {
        if (typeof window.ConversationMenu !== 'undefined') {
          window.ConversationMenu.loadMore();
        }
      });

      // Notification bell → open notification panel
      this.delegate('topbar-notification-click', 'lex-topbar', () => {
        if (this._notificationPanel) this._notificationPanel.open();
      });
    }

    // -----------------------------------------------------------------------
    // disconnected — cleanup
    // -----------------------------------------------------------------------

    disconnected() {
      if (this._notificationInterval) {
        clearInterval(this._notificationInterval);
        this._notificationInterval = null;
      }
      this._stopReachabilityMonitor();

      // Unsubscribe from state changes
      if (window.Lex && window.Lex.state && this._authChangeHandler) {
        window.Lex.state.off('auth:changed', this._authChangeHandler);
        this._authChangeHandler = null;
      }

      // Unsubscribe from notification count
      if (this._notifCountHandler) {
        document.removeEventListener('lex-notification-count', this._notifCountHandler);
        this._notifCountHandler = null;
      }
    }

    // -----------------------------------------------------------------------
    // Public API — for router and external callers
    // -----------------------------------------------------------------------

    /** Update page metadata after a route change */
    setPage({ title, activeNav }) {
      if (title !== undefined) this.pageTitle = title;
      if (activeNav !== undefined) this.activeNavId = activeNav;
    }

    /** Set the content area loading state */
    setContentLoading(loading) {
      this.loading = loading;
    }

    /** Clear page-specific topbar actions */
    clearTopbarActions() {
      const slot = this.$('#topbar-page-actions');
      if (slot) slot.innerHTML = '';
    }

    /** Focus the main content area (for accessibility after route change) */
    focusContent() {
      const main = this.$('#lex-main-content');
      if (main) {
        requestAnimationFrame(() => {
          main.focus({ preventScroll: true });
        });
      }
    }

    /** Get the content container element */
    getContentEl() {
      return this.$('#lex-main-content');
    }

    /** Set sidebar sections (nav structure) */
    setSections(sections) {
      this._sections = sections;
      const sidebar = this.$('lex-sidebar');
      if (sidebar) sidebar.sections = sections;
    }

    /** Set user menu items for the sidebar profile */
    setUserMenuItems(items) {
      this._userMenuItems = items;
      const sidebar = this.$('lex-sidebar');
      if (sidebar) sidebar.userMenuItems = items;
    }

    /** Set topbar menu items (settings dropdown) */
    setTopbarMenuItems(items) {
      this._topbarMenuItems = items;
      const topbar = this.$('lex-topbar');
      if (topbar) topbar.menuItems = items;
    }

    // -----------------------------------------------------------------------
    // Internal — user hydration from localStorage
    // -----------------------------------------------------------------------

    _hydrateUser() {
      const sidebar = this._sidebar;
      if (!sidebar) return;

      // Read user from Lex.state (centralized) with localStorage fallback
      let user = null;
      if (window.Lex && window.Lex.state && window.Lex.state.user) {
        user = window.Lex.state.user;
      } else {
        try {
          const userJson = localStorage.getItem('user');
          if (userJson) user = JSON.parse(userJson);
        } catch (e) { /* ignore */ }
      }

      const fullName = user
        ? ((user.firstName || user.first_name || '') + ' ' + (user.lastName || user.last_name || '')).trim() || user.email || 'User'
        : 'User';
      const firstName = user
        ? (user.firstName || user.first_name || fullName.split(' ')[0] || 'User')
        : 'User';
      const initials = user
        ? (((user.firstName || user.first_name || '')[0] || '') + ((user.lastName || user.last_name || '')[0] || '')) || (user.email || 'U')[0].toUpperCase()
        : 'U';
      const handle = user ? (user.username ? '@' + user.username : (user.email || '')) : '';

      sidebar.userName = firstName;
      sidebar.userInitials = initials;
      sidebar.userEmail = handle;

      // Version from app or Electron
      if (window.APP_VERSION && window.APP_VERSION.getVersion) {
        sidebar.version = window.APP_VERSION.getVersion();
      } else if (window.electronAPI && window.electronAPI.getVersion) {
        window.electronAPI.getVersion().then((v) => {
          sidebar.version = 'v' + v;
        }).catch(() => {});
      }

      // Build sidebar sections with role-gated admin link
      const adminRoles = ['system_admin', 'org_admin', 'admin'];
      const userRoles = user ? (user.roles || user.role_names || []) : [];
      const userRoleName = user ? (user.role_name || user.role || '') : '';
      const allRoles = new Set([
        ...userRoles.map(function (r) {
          return (typeof r === 'string' ? r : (r && r.name || '')).toLowerCase();
        }),
        ...(userRoleName ? [userRoleName.toLowerCase()] : [])
      ]);
      const showAdmin = adminRoles.some(function (r) { return allRoles.has(r); });

      // Sidebar sections
      this.setSections([
        {
          id: 'main',
          isStaticTop: true,
          items: [
            { id: 'dashboard', label: 'Dashboard', icon: 'home', href: 'dashboard.html' },
            { id: 'search', label: 'Search Conversations', icon: 'search', isButton: true, onClick: 'openConversationSearchModal' },
            { id: 'workspaces', label: 'Workspaces', icon: 'briefcase', href: 'workspaces.html' },
            { id: 'storage', label: 'My Drive', icon: 'folder', href: 'drive.html' }
          ]
        },
        {
          id: 'tools',
          items: [
            { id: 'connectors', label: 'Data Connectors', icon: 'plug', href: 'integrations/data_connectors.html' },
            { id: 'reports', label: 'Reports', icon: 'bar-chart-2', href: 'insights/module-execution.html' }
          ]
        },
        {
          id: 'chats',
          title: 'Your Chats',
          isScrollable: true,
          isConversationList: true,
          items: [
            { id: 'new-chat', label: 'New Chat', icon: 'plus', isButton: true, onClick: 'openNewProjectModal' }
          ]
        }
      ]);

      // User menu items (role-gated)
      const menuItems = [];
      if (showAdmin) {
        menuItems.push({ id: 'admin', label: 'Administration', icon: 'users', href: 'admin/index.html' });
      }
      menuItems.push({ id: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' });
      menuItems.push({ id: 'help', label: 'Help & Support', icon: 'help-circle', href: 'help.html' });
      menuItems.push({ id: 'signout', label: 'Sign Out', icon: 'log-out', action: 'signout', danger: true });
      this.setUserMenuItems(menuItems);

      // Topbar settings menu
      this.setTopbarMenuItems([
        { id: 'settings', label: 'Settings', icon: 'settings' },
        { divider: true },
        { id: 'logout', label: 'Sign out', variant: 'danger' }
      ]);
    }

    // -----------------------------------------------------------------------
    // Internal — conversation menu
    // -----------------------------------------------------------------------

    _initConversationMenu() {
      requestAnimationFrame(() => {
        if (typeof window.ConversationMenu !== 'undefined') {
          if (window.ConversationMenu.init('#lexConversationListContainer')) {
            window.ConversationMenu.loadConversations(true);
          }
        }
      });
    }

    // -----------------------------------------------------------------------
    // Internal — notification polling
    // -----------------------------------------------------------------------

    _startNotificationPolling() {
      // Initial check
      this._checkNotifications();

      // Poll every 60 seconds
      this._notificationInterval = setInterval(() => {
        this._checkNotifications();
      }, 60000);
    }

    _checkNotifications() {
      if (!api || typeof api.getNotifications !== 'function') return;

      api.getNotifications({ unread: true, limit: 1 })
        .then((result) => {
          const count = (result && result.pagination && result.pagination.total) || 0;
          const topbar = this.$('lex-topbar');
          if (topbar) topbar.notificationCount = count;
        })
        .catch(() => {
          // Silently ignore notification fetch errors
        });
    }

    // -----------------------------------------------------------------------
    // Internal — sign out
    // -----------------------------------------------------------------------

    _handleSignOut() {
      if (api && typeof api.logout === 'function') {
        api.logout()
          .then(() => { window.location.href = 'login.html'; })
          .catch(() => { window.location.href = 'login.html'; });
      } else {
        window.location.href = 'login.html';
      }
    }

    // -----------------------------------------------------------------------
    // Internal — reachability monitoring
    // -----------------------------------------------------------------------

    /**
     * Start periodic health checks to detect backend unavailability.
     * Polls /api/health/discovery every 30 seconds. Shows a fixed
     * top banner when the backend is unreachable; auto-hides when it
     * comes back.
     */
    _startReachabilityMonitor() {
      this._reachable = true;
      this._reachabilityBanner = null;

      // Build the banner element (hidden by default via CSS transform)
      this._buildOfflineBanner();

      // Initial check after a short delay (let the first page load)
      var self = this;
      this._reachabilityTimer = setTimeout(function () {
        self._checkReachability();
        // Then poll every 30 seconds
        self._reachabilityInterval = setInterval(function () {
          self._checkReachability();
        }, 30000);
      }, 5000);
    }

    /**
     * Stop reachability monitoring and clean up the banner.
     */
    _stopReachabilityMonitor() {
      if (this._reachabilityTimer) {
        clearTimeout(this._reachabilityTimer);
        this._reachabilityTimer = null;
      }
      if (this._reachabilityInterval) {
        clearInterval(this._reachabilityInterval);
        this._reachabilityInterval = null;
      }
      this._reachabilityBanner = null;
    }

    /**
     * Wire up the offline banner that lives inside the shell template.
     */
    _buildOfflineBanner() {
      var banner = this.$('#lex-offline-banner');
      if (!banner) return;

      // Wire retry button
      var self = this;
      var retryBtn = banner.querySelector('#lex-offline-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          self._checkReachability();
        });
      }

      this._reachabilityBanner = banner;
    }

    /**
     * Perform a single health check against /api/health/discovery.
     * This endpoint is public (no auth header needed), so we can
     * distinguish "server down" from "token expired".
     */
    _checkReachability() {
      if (!api || !api.baseUrl) return;

      var healthUrl = api.baseUrl + '/api/health/discovery';
      var wasReachable = this._reachable;
      var self = this;

      // Build fetch options with an 8-second timeout
      var fetchOptions = {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        fetchOptions.signal = AbortSignal.timeout(8000);
      }

      fetch(healthUrl, fetchOptions)
        .then(function (response) {
          if (response.ok) {
            self._reachable = true;
            self._hideOfflineBanner();

            // Update centralized state
            if (window.Lex && window.Lex.state) {
              window.Lex.state.setReachability(true);
            }

            // If we were offline and now back, show a recovery toast
            if (!wasReachable && window.Lex && window.Lex.Toast) {
              window.Lex.Toast.show({
                message: 'Connection restored',
                variant: 'success'
              });
            }
          } else {
            self._reachable = false;
            self._showOfflineBanner();
            if (window.Lex && window.Lex.state) {
              window.Lex.state.setReachability(false);
            }
          }
        })
        .catch(function () {
          self._reachable = false;
          self._showOfflineBanner();
          if (window.Lex && window.Lex.state) {
            window.Lex.state.setReachability(false);
          }
        });
    }

    /**
     * Show the offline banner with a slide-down animation.
     */
    _showOfflineBanner() {
      if (!this._reachabilityBanner) return;
      if (!this._reachabilityBanner.classList.contains('lex-app-offline-visible')) {
        requestAnimationFrame(function () {
          this._reachabilityBanner.classList.add('lex-app-offline-visible');
        }.bind(this));
      }
    }

    /**
     * Hide the offline banner with a slide-up animation.
     */
    _hideOfflineBanner() {
      if (!this._reachabilityBanner) return;
      this._reachabilityBanner.classList.remove('lex-app-offline-visible');
    }
  }

  // =========================================================================
  // Register
  // =========================================================================

  defineLex('lex-app', LexApp);

})();
