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
  // Doc Studio (menu-launched): lazy-load the shared create modal and open it
  // with a matter picker. The modal component is only bundled on a couple of
  // pages, so when "Document Studio" is clicked from the global sidebar we load
  // its assets on demand, then open it in matter-pick mode.
  // ---------------------------------------------------------------------------

  const LEX_APP_SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  const POST_LOGIN_BACK_SUPPRESS_KEY = 'lana:postLoginSuppressDashboardBack';

  function resolveLoginHref() {
    if (typeof window.getLoginPath === 'function') {
      return window.getLoginPath();
    }

    var path = window.location && window.location.pathname ? window.location.pathname : '';
    var nestedPaths = ['/admin/', '/integrations/', '/workflows/', '/insights/', '/automation/', '/voice/'];
    for (var i = 0; i < nestedPaths.length; i += 1) {
      if (path.indexOf(nestedPaths[i]) !== -1) {
        return '../login.html';
      }
    }
    return 'login.html';
  }

  function docStudioAssetBase() {
    // LEX_APP_SCRIPT_SRC looks like '<base>/js/lex/components/layout/lex-app.js'.
    const marker = '/js/';
    const idx = LEX_APP_SCRIPT_SRC.indexOf(marker);
    return idx === -1 ? '' : LEX_APP_SCRIPT_SRC.slice(0, idx + marker.length);
  }

  function loadAssetOnce(kind, href) {
    return new Promise((resolve, reject) => {
      const selector = kind === 'script'
        ? 'script[src="' + href + '"]'
        : 'link[href="' + href + '"]';
      if (document.querySelector(selector)) { resolve(); return; }
      let el;
      if (kind === 'script') {
        el = document.createElement('script');
        el.src = href;
      } else {
        el = document.createElement('link');
        el.rel = 'stylesheet';
        el.href = href;
      }
      el.addEventListener('load', () => resolve());
      el.addEventListener('error', () => reject(new Error('Failed to load ' + href)));
      document.head.appendChild(el);
    });
  }

  // The create modal's form uses Lex components that are not loaded on every
  // page (e.g. lex-textarea is only bundled on a couple of pages). When opening
  // the overlay from the global menu we ensure each required component is
  // registered first; otherwise its element (like the Prompt textarea) never
  // upgrades and the field renders blank.
  const DOC_STUDIO_LEX_COMPONENTS = {
    'lex-modal': 'lex/components/foundation/lex-modal.js',
    'lex-btn': 'lex/components/foundation/lex-btn.js',
    'lex-input': 'lex/components/form/lex-input.js',
    'lex-select': 'lex/components/form/lex-select.js',
    'lex-textarea': 'lex/components/form/lex-textarea.js'
  };

  function ensureLexComponents(base) {
    const pending = [];
    Object.keys(DOC_STUDIO_LEX_COMPONENTS).forEach((tag) => {
      if (!window.customElements || !window.customElements.get(tag)) {
        pending.push(loadAssetOnce('script', base + DOC_STUDIO_LEX_COMPONENTS[tag]));
      }
    });
    return Promise.all(pending);
  }

  async function openDocStudioFromMenu() {
    try {
      const base = docStudioAssetBase();
      await ensureLexComponents(base);
      if (!window.DocStudioCreateModal || !window.DocStudioCreateModal.open) {
        await loadAssetOnce('link', base.replace(/\/js\/$/, '/css/') + 'components/doc-studio-create-modal.css');
        await loadAssetOnce('script', base + 'components/doc-studio-create-modal.js');
      }
      if (!window.DocStudioCreateModal || !window.DocStudioCreateModal.open) {
        throw new Error('Doc Studio modal unavailable.');
      }
      window.DocStudioCreateModal.open({ api: window.api, pickMatter: true });
    } catch (error) {
      console.error('[DocStudio] Failed to open from menu:', error);
      if (window.Lex && window.Lex.Toast && window.Lex.Toast.error) {
        window.Lex.Toast.error('Could not open Document Studio. Please try again.');
      }
    }
  }

  window.openDocStudioFromMenu = openDocStudioFromMenu;

  function currentPageName() {
    try {
      const statePath = window.history && window.history.state && window.history.state.path;
      const pathname = statePath || (window.location && window.location.pathname) || '';
      const clean = pathname.split('?')[0].split('#')[0];
      return clean.substring(clean.lastIndexOf('/') + 1);
    } catch (e) {
      return '';
    }
  }

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

      /* ── Embedded chrome: hide sidebar, full-width body ── */
      lex-app[chrome="embedded"] lex-sidebar {
        display: none;
      }
      lex-app[chrome="embedded"] lex-body {
        margin-left: 0;
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
        height: 100vh;
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
        min-height: 0;
        overflow-y: auto;
        background: var(--lex-bg-secondary);
        transition: opacity var(--lex-transition-normal);
      }
      lex-content:focus {
        outline: none;
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
      .lex-app-offline-banner button:hover:not(:disabled) {
        background: rgba(255,255,255,0.35);
      }
      .lex-app-offline-banner button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      @keyframes lex-retry-spin {
        to { transform: rotate(360deg); }
      }
      .lex-app-offline-banner button .lex-retry-spinner {
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: lex-retry-spin 0.6s linear infinite;
        vertical-align: middle;
        margin-right: 0.35rem;
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
        sidebarOpen:  { type: Boolean, default: false, reflect: true },
        sidebarCollapsed: { type: Boolean, default: false, reflect: true },
        chrome:       { type: String,  default: 'full', reflect: true },
        backHref:     { type: String,  default: '' },
        backLabel:    { type: String,  default: 'Back' }
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
      this._lastShowAdmin = undefined;
      this._lastShellKey = undefined;
      this._topMoverItems = [];
      this._topMoversLoaded = false;
      this._isLanaOne = false;
      this._editionGateStarted = false;
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
      const embedded = this.chrome === 'embedded';
      const sidebarCollapsedAttr = this.sidebarCollapsed ? ' collapsed' : '';
      const suppressAutoBackAttr = this._consumePostLoginBackSuppression()
        ? ' suppress-auto-back'
        : '';
      const topbarBackAttrs = embedded
        ? ` show-back back-label="${this.escapeHtml(this.backLabel)}" back-href="${this.escapeHtml(this.backHref)}"`
        : '';

      this.innerHTML = `
        <a class="lex-app-skip-link" href="#lex-main-content">Skip to content</a>

        <lex-sidebar
          logo-src="${this.escapeHtml(this.logoSrc)}"
          logo-alt="${this.escapeHtml(this.logoAlt)}"
          logo-href="${this.escapeHtml(this.logoHref)}"
          active-id="${this.escapeHtml(this.activeNavId)}"
          ${sidebarCollapsedAttr}
        ></lex-sidebar>

        <lex-body>
          <lex-header role="banner">
            <lex-topbar
              heading="${this.escapeHtml(this.pageTitle)}"
              sticky${topbarBackAttrs}${suppressAutoBackAttr}
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
      `;
    }

    _consumePostLoginBackSuppression() {
      if (currentPageName() !== 'dashboard.html') return false;
      try {
        if (sessionStorage.getItem(POST_LOGIN_BACK_SUPPRESS_KEY) !== 'login.html') return false;
        sessionStorage.removeItem(POST_LOGIN_BACK_SUPPRESS_KEY);
        return true;
      } catch (e) {
        return false;
      }
    }

    // -----------------------------------------------------------------------
    // connected — post-first-render setup
    // -----------------------------------------------------------------------

    connected() {
      this._sidebar = this.$('lex-sidebar');
      this._topbar = this.$('lex-topbar');
      this._content = this.$('#lex-main-content');
      this._notificationPanel = this.$('lex-notification-panel');

      // Resolve edition-gated shell items. Standard Lana builds fail closed;
      // LANA-ONE builds expose isLanaOne through electronAPI.getConfig().
      this._resolveClientEdition();

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

      // Initialize app-level global search on every Lex shell page,
      // including standalone admin/reporting pages that do not load app.html.
      this._ensureGlobalSearchModal();

      // Subscribe to auth changes to refresh user display
      if (window.Lex && window.Lex.state) {
        this._authChangeHandler = () => {
          this._hydrateUser();
          // Re-init ConversationMenu: _hydrateUser() may trigger a full
          // sidebar re-render (if userName/userEmail/version changed),
          // which destroys #lexConversationListContainer. Re-init ensures
          // ConversationMenu gets the new container reference.
          this._initConversationMenu();
        };
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

    _sharedAssetUrl(path) {
      const pathname = window.location.pathname || '';
      let relativePath = '';
      const publicIdx = pathname.lastIndexOf('/public_html/');
      const srcIdx = pathname.lastIndexOf('/src/');
      if (publicIdx !== -1) {
        relativePath = pathname.substring(publicIdx + '/public_html/'.length);
      } else if (srcIdx !== -1) {
        relativePath = pathname.substring(srcIdx + '/src/'.length);
      } else {
        relativePath = pathname.charAt(0) === '/' ? pathname.substring(1) : pathname;
      }
      const directory = relativePath.indexOf('/') === -1
        ? ''
        : relativePath.substring(0, relativePath.lastIndexOf('/'));
      const depth = directory ? directory.split('/').filter(Boolean).length : 0;
      return '../'.repeat(depth) + path;
    }

    _ensureGlobalSearchModal() {
      if (window.UnifiedSearchModal && typeof window.UnifiedSearchModal.init === 'function') {
        window.UnifiedSearchModal.init();
        return;
      }
      // The modal consumes the type-filter helper at search time; inject it
      // first (idempotent) so it is present by the time a query runs.
      if (!window.UnifiedSearchFilter && !document.querySelector('script[data-lana-search-filter="true"]')) {
        const filterScript = document.createElement('script');
        filterScript.src = this._sharedAssetUrl('js/unified-search-filter.js');
        filterScript.dataset.lanaSearchFilter = 'true';
        document.head.appendChild(filterScript);
      }

      const existing = document.querySelector('script[data-lana-global-search="true"], script[src$="js/unified-search-modal.js"]');
      if (existing) return;

      const script = document.createElement('script');
      script.src = this._sharedAssetUrl('js/unified-search-modal.js');
      script.dataset.lanaGlobalSearch = 'true';
      script.onload = () => {
        if (window.UnifiedSearchModal && typeof window.UnifiedSearchModal.init === 'function') {
          window.UnifiedSearchModal.init();
        }
        if (window.UnifiedSearchModal && typeof window.UnifiedSearchModal.openPending === 'function') {
          window.UnifiedSearchModal.openPending();
        }
      };
      document.head.appendChild(script);
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

      if (changedProps.has('sidebarCollapsed')) {
        const sidebar = this.$('lex-sidebar');
        if (sidebar) sidebar.collapsed = this.sidebarCollapsed;
      }

      if (changedProps.has('loading')) {
        const content = this.$('#lex-main-content');
        if (content) content.dataset.loading = String(this.loading);
      }

      if (
        changedProps.has('chrome') ||
        changedProps.has('backHref') ||
        changedProps.has('backLabel')
      ) {
        const topbar = this.$('lex-topbar');
        if (topbar) {
          const embedded = this.chrome === 'embedded';
          topbar.showBack = embedded;
          topbar.backHref = this.backHref;
          topbar.backLabel = this.backLabel;
        }
      }

      // ── Event delegation ──

      // Hamburger toggle
      this.delegate('topbar-menu-toggle', 'lex-topbar', () => {
        this.sidebarOpen = !this.sidebarOpen;
      });

      // Back button (embedded chrome mode)
      this.delegate('topbar-back-click', 'lex-topbar', (e) => {
        const detail = e.detail || {};
        const href = detail.href || this.backHref;

        // When hosted inside a parent modal iframe, dismiss the modal instead
        // of navigating the iframe back to the host page.
        if (this.chrome === 'embedded' && window.parent && window.parent !== window) {
          try {
            window.parent.postMessage({ type: 'lex-embedded-back', href }, '*');
            return;
          } catch (_) { /* fall through to navigation */ }
        }

        if (href && window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go(href);
        } else if (href) {
          window.location.href = href;
        } else if (window.history && window.history.length > 1) {
          window.history.back();
        }
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
        const detail = e.detail || {};
        const action = detail.action;
        if (action === 'signout') {
          this._handleSignOut();
        } else if (detail.href && window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go(detail.href);
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
        if (window.DesktopNotifications) {
          window.DesktopNotifications.enableFromUserGesture();
        }
        if (this._notificationPanel) this._notificationPanel.open();
      });

      // Topbar refresh button — spin icon, dispatch cancelable event, fallback to reload
      this.delegate('topbar-refresh-click', 'lex-topbar', () => {
        var refreshBtn = this.$('[data-action="refresh"]');

        // Spin animation
        if (refreshBtn) refreshBtn.dataset.spinning = 'true';
        var stopSpin = function () {
          if (refreshBtn) refreshBtn.dataset.spinning = 'false';
        };

        // Dispatch cancelable event — page controllers call preventDefault() to
        // signal they handle refresh themselves (prevents the reload fallback).
        var evt = new CustomEvent('lex-refresh', { bubbles: true, cancelable: true });
        var handled = !document.dispatchEvent(evt); // true if preventDefault() was called

        if (handled) {
          // Page handled it — stop spin after a short delay
          setTimeout(stopSpin, 800);
        } else {
          // No page handler — full page reload
          window.location.reload();
        }
      });

      // Topbar settings menu actions (sign out, settings)
      this.delegate('topbar-menu-action', 'lex-topbar', (e) => {
        var actionId = e.detail && e.detail.actionId;
        var routes = {
          admin: 'admin/index.html',
          connectors: 'data-connectors.html',
          settings: 'settings-v2.html',
          help: 'help.html'
        };
        if (actionId === 'logout') {
          this._handleSignOut();
        } else if (routes[actionId] && window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go(routes[actionId]);
        }
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

    _resolveClientEdition() {
      if (this._editionGateStarted) return;
      this._editionGateStarted = true;

      const electronApi = window.electronAPI;
      if (!electronApi || typeof electronApi.getConfig !== 'function') return;

      Promise.resolve(electronApi.getConfig()).then((config) => {
        if (!config || config.isLanaOne !== true || this._isLanaOne) return;
        this._isLanaOne = true;
        this._hydrateUser();
        this._initConversationMenu();
      }).catch(function () { /* Standard client: keep LANA-ONE items hidden. */ });
    }

    _hydrateUser() {
      const sidebar = this._sidebar;
      if (!sidebar) return;

      // Read user from Lex.state (centralized) with localStorage fallback.
      // When reading from localStorage, validate the parsed object to prevent
      // manipulated role fields from elevating UI privileges.
      let user = null;
      if (window.Lex && window.Lex.state && window.Lex.state.user) {
        user = window.Lex.state.user;
      } else {
        try {
          const userJson = localStorage.getItem('user');
          if (userJson) {
            const parsed = JSON.parse(userJson);
            // Basic schema validation: must be a plain object with at least
            // one expected string field. Reject anything that looks tampered.
            if (
              parsed !== null &&
              typeof parsed === 'object' &&
              !Array.isArray(parsed) &&
              (typeof parsed.email === 'string' ||
               typeof parsed.firstName === 'string' ||
               typeof parsed.first_name === 'string')
            ) {
              // Ensure role fields, if present, are strings or arrays of strings
              const roleOk =
                parsed.role_name === undefined || typeof parsed.role_name === 'string';
              const rolesOk =
                parsed.roles === undefined ||
                (Array.isArray(parsed.roles) &&
                  parsed.roles.every(function (r) {
                    return typeof r === 'string' || (typeof r === 'object' && r !== null);
                  }));
              if (roleOk && rolesOk) {
                user = parsed;
              } else {
                // Tampered role data — discard and treat as unauthenticated
                localStorage.removeItem('user');
              }
            } else {
              // Unexpected structure — discard
              localStorage.removeItem('user');
            }
          }
        } catch (e) { /* ignore parse errors */ }
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

      // Version — set once only (avoid async re-render destroying conversation list)
      if (!this._versionSet) {
        this._versionSet = true;
        if (window.APP_VERSION && window.APP_VERSION.getVersion) {
          sidebar.version = window.APP_VERSION.getVersion();
        } else if (window.electronAPI && window.electronAPI.getVersion) {
          var self = this;
          window.electronAPI.getVersion().then(function (v) {
            sidebar.version = 'v' + v;
            // Re-init ConversationMenu since version change triggers full sidebar re-render
            self._initConversationMenu();
          }).catch(function () {});
        }
      }

      // Build sidebar sections with role-gated admin link.
      // Accept the full admin-capable role set (backend returns system_admin/admin
      // plus org_admin variants) so a plain `admin` isn't locked out of Administration.
      const adminRoles = ['system_admin', 'org_admin', 'organization_admin', 'admin'];
      const userRoles = user ? (user.roles || user.role_names || []) : [];
      const userRoleName = user ? (user.role_name || user.role || '') : '';
      const allRoles = new Set([
        ...userRoles.map(function (r) {
          return (typeof r === 'string' ? r : (r && r.name || '')).toLowerCase();
        }),
        ...(userRoleName ? [userRoleName.toLowerCase()] : [])
      ]);
      const showAdmin = adminRoles.some(function (r) { return allRoles.has(r); });

      const appContext = this._getAppContext();
      const editionKey = this._isLanaOne ? 'lana-one' : 'lana-ai';
      const shellKey = (showAdmin ? 'admin' : 'user') + ':' + appContext + ':' + editionKey;

      // Only rebuild sidebar sections and menus when admin visibility or app context changes.
      // Both setSections() and setUserMenuItems() create new arrays which
      // increment the sidebar's generation counters, triggering a full re-render
      // that destroys #lexConversationListContainer.
      if (this._lastShowAdmin !== showAdmin || this._lastShellKey !== shellKey) {
        this._lastShowAdmin = showAdmin;
        this._lastShellKey = shellKey;

        this.setSections(this._buildSidebarSections(appContext));
        if (appContext === 'insights') {
          this._loadTopMoversForSidebar();
        }

        // User menu items (role-gated)
        const menuItems = [];
        if (showAdmin) {
          menuItems.push({ id: 'admin', label: 'Administration', icon: 'users', href: 'admin/index.html' });
        }
        menuItems.push({ id: 'connectors', label: 'Data Connectors', icon: 'plug', href: 'data-connectors.html' });
        if (this._isLanaOne) {
          menuItems.push({ id: 'billing', label: 'Plan and billing', icon: 'credit-card', href: 'settings-v2.html#billing' });
        }
        menuItems.push({ id: 'settings', label: 'Settings', icon: 'settings', href: 'settings-v2.html' });
        menuItems.push({ id: 'help', label: 'Help & Support', icon: 'help-circle', href: 'help.html' });
        menuItems.push({ id: 'signout', label: 'Sign Out', icon: 'log-out', action: 'signout', danger: true });
        this.setUserMenuItems(menuItems);

        // Topbar settings menu — mirror the sidebar user menu links
        const topbarMenuItems = [];
        if (showAdmin) {
          topbarMenuItems.push({ id: 'admin', label: 'Administration', icon: 'users' });
        }
        topbarMenuItems.push({ id: 'connectors', label: 'Data Connectors', icon: 'plug' });
        topbarMenuItems.push({ id: 'settings', label: 'Settings', icon: 'settings' });
        topbarMenuItems.push({ id: 'help', label: 'Help & Support', icon: 'help-circle' });
        topbarMenuItems.push({ divider: true });
        topbarMenuItems.push({ id: 'logout', label: 'Sign out', icon: 'log-out', variant: 'danger' });
        this.setTopbarMenuItems(topbarMenuItems);
      }
    }

    _getAppContext() {
      const path = (window.history && window.history.state && window.history.state.path)
        || window.location.pathname
        || '';
      if (
        path.indexOf('/admin/analytics.html') !== -1 ||
        path.indexOf('admin/analytics.html') !== -1 ||
        path.indexOf('/admin/dashboard-library.html') !== -1 ||
        path.indexOf('admin/dashboard-library.html') !== -1 ||
        path.indexOf('/admin/dashboard-detail.html') !== -1 ||
        path.indexOf('admin/dashboard-detail.html') !== -1 ||
        path.indexOf('/admin/dashboard-builder.html') !== -1 ||
        path.indexOf('admin/dashboard-builder.html') !== -1 ||
        path.indexOf('/admin/metric_detail.html') !== -1 ||
        path.indexOf('admin/metric_detail.html') !== -1 ||
        path.indexOf('/admin/reporting.html') !== -1 ||
        path.indexOf('admin/reporting.html') !== -1 ||
        path.indexOf('/admin/billable-hours.html') !== -1 ||
        path.indexOf('admin/billable-hours.html') !== -1 ||
        path.indexOf('/admin/data-visualization.html') !== -1 ||
        path.indexOf('admin/data-visualization.html') !== -1 ||
        path.indexOf('/insights/') !== -1
      ) {
        return 'insights';
      }
      return 'works';
    }

    _buildSidebarSections(appContext) {
      const mainItems = appContext === 'insights'
        ? [
            { id: 'insights-create', label: 'New Dashboard', icon: 'plus', href: 'admin/dashboard-builder.html', isButton: true, variant: 'create-chat' },
            { id: 'insights-dashboard', label: 'Dashboard', icon: 'home', href: 'admin/analytics.html' },
            { id: 'insights-library', label: 'Library', icon: 'book-open', href: 'admin/dashboard-library.html' },
            { id: 'firm-reporting', label: 'Firm Reporting', icon: 'bar-chart-2', href: 'admin/reporting.html' },
            { id: 'billable-hours', label: 'Billable Hours', icon: 'clock', href: 'admin/billable-hours.html' }
          ]
        : [
            { id: 'new-chat', label: 'New Chat', isButton: true, onClick: 'openNewProjectModal', variant: 'create-chat' },
            { id: 'dashboard', label: 'Dashboard', icon: 'home', href: 'dashboard.html' },
            { id: 'library', label: 'Library', icon: 'folder', href: 'drive.html', children: [
              { id: 'library-all-sources', label: 'All Sources', href: 'drive.html' },
              { id: 'library-document-studio', label: 'Document Studio', isButton: true, onClick: 'openDocStudioFromMenu' }
            ] }
          ];

      const sections = [
        {
          id: 'main',
          isStaticTop: true,
          items: mainItems
        }
      ];

      if (appContext === 'insights') {
        sections.push({
          id: 'top-movers',
          title: 'Top Movers',
          items: this._topMoverItems.length > 0
            ? this._topMoverItems
            : [{ id: 'top-movers-empty', label: 'No movement yet', icon: 'bar-chart-2', href: '#' }]
        });
      } else {
        sections.push({
          id: 'task-recents',
          title: 'Tasks',
          isScrollable: true,
          isTaskList: true,
          items: []
        });
        sections.push({
          id: 'workspace-recents',
          title: 'Workspaces',
          isScrollable: true,
          isWorkspaceList: true,
          items: []
        });
        sections.push({
          id: 'chats',
          title: 'Recents',
          isScrollable: true,
          isConversationList: true,
          items: []
        });
      }

      return sections;
    }

    _formatMoverBadge(metric) {
      if (metric.percent_change === null || metric.percent_change === undefined || !isFinite(Number(metric.percent_change))) {
        return metric.direction === 'down' ? 'Down' : 'Up';
      }
      const sign = metric.direction === 'down' ? '-' : '+';
      return sign + Math.abs(Number(metric.percent_change)).toFixed(1) + '%';
    }

    _humanizeMetricKey(key) {
      if (!key) return '';
      return String(key)
        .split(/[_.]+/)
        .filter(Boolean)
        .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
        .join(' ');
    }

    async _loadTopMoversForSidebar() {
      if (this._topMoversLoaded || !window.api || typeof window.api.getTopMovingMetrics !== 'function') return;
      this._topMoversLoaded = true;

      try {
        const response = await window.api.getTopMovingMetrics({ window: '24h', limit: 8 });
        const rows = response && Array.isArray(response.data) ? response.data : [];
        const self = this;
        this._topMoverItems = rows.slice(0, 8).map((metric) => {
          // Backend now humanizes title server-side, but old data and any
          // edge case where title equals the raw key still falls back here.
          const titleLooksLikeKey = metric.title && metric.title === metric.metric_key;
          const label = (!metric.title || titleLooksLikeKey)
            ? self._humanizeMetricKey(metric.metric_key)
            : metric.title;
          return {
            id: 'top-mover-' + metric.metric_key,
            label,
            icon: metric.direction === 'down' ? 'trending-down' : 'trending-up',
            badge: this._formatMoverBadge(metric),
            href: 'admin/metric_detail.html?metric_key=' + encodeURIComponent(metric.metric_key)
          };
        });
        if (this._getAppContext() === 'insights') {
          this.setSections(this._buildSidebarSections('insights'));
        }
      } catch (_) {
        this._topMoverItems = [];
      }
    }

    // -----------------------------------------------------------------------
    // Internal — conversation menu
    // -----------------------------------------------------------------------

    _initConversationMenu() {
      requestAnimationFrame(() => {
        if (typeof window.ConversationMenu === 'undefined') return;
        if (this._getAppContext() === 'insights') return;

        // Skip if ConversationMenu's container is still in the DOM —
        // avoids a visible flash + unnecessary API call on auth:changed
        // when the sidebar fast-path preserved the container.
        var existing = window.ConversationMenu.container;
        if (existing && existing.isConnected) return;

        if (typeof window.ConversationMenu.setScope === 'function') {
          window.ConversationMenu.setScope(this._getConversationMenuScope());
        }

        if (window.ConversationMenu.init('#lexConversationListContainer')) {
          window.ConversationMenu.loadConversations(true);
        }
      });
    }

    _getConversationMenuScope() {
      const appContext = this._getAppContext();
      if (appContext === 'insights') {
        return {
          type: 'conversation_threads',
          title: 'Insights Chats',
          pageScopes: ['dashboard', 'reporting', 'data_visualization']
        };
      }

      return {
        type: 'chat_sessions',
        title: 'Recents'
      };
    }

    // -----------------------------------------------------------------------
    // Internal — notification polling
    // -----------------------------------------------------------------------

    _startNotificationPolling() {
      // Initial check
      this._checkNotifications();

      // Poll every 60 seconds — but skip when tab is hidden to reduce
      // request volume on memory-constrained machines (GAP-PERF.2 fix)
      this._notificationInterval = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        this._checkNotifications();
      }, 60000);
    }

    _checkNotifications() {
      if (!window.api) return;

      // Use the dedicated unread-count endpoint (O(1) denormalized counter)
      if (typeof window.api.getUnreadNotificationCount === 'function') {
        window.api.getUnreadNotificationCount()
          .then((result) => {
            const count = (result && result.unread_count) || 0;
            const topbar = this.$('lex-topbar');
            if (topbar) topbar.notificationCount = count;
            if (window.DesktopNotifications) {
              window.DesktopNotifications.handleUnreadCount(count);
            }
          })
          .catch(() => {
            // Silently ignore notification fetch errors
          });
        return;
      }

      // Fallback: fetch notifications and read unread_count from response
      if (typeof window.api.getNotifications === 'function') {
        window.api.getNotifications(true, 1, 0)
          .then((result) => {
            const count = (result && result.unread_count) || 0;
            const topbar = this.$('lex-topbar');
            if (topbar) topbar.notificationCount = count;
            if (window.DesktopNotifications) {
              window.DesktopNotifications.handleUnreadCount(count);
            }
          })
          .catch(() => {
            // Silently ignore notification fetch errors
          });
      }
    }

    // -----------------------------------------------------------------------
    // Internal — sign out
    // -----------------------------------------------------------------------

    _handleSignOut() {
      if (window.Lex && window.Lex.Modal && typeof window.Lex.Modal.confirm === 'function') {
        var self = this;
        window.Lex.Modal.confirm(
          'Sign Out',
          'Are you sure you want to sign out? Any unsaved changes will be lost.',
          function () { self._performSignOut(); },
          { confirmText: 'Sign Out', variant: 'danger' }
        );
      } else {
        this._performSignOut();
      }
    }

    _performSignOut() {
      var loginHref = resolveLoginHref();
      if (window.api && typeof window.api.logout === 'function') {
        window.api.logout()
          .then(function () { window.location.href = loginHref; })
          .catch(function () { window.location.href = loginHref; });
      } else {
        window.location.href = loginHref;
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
        // Then poll every 30 seconds — skip when tab is hidden (GAP-PERF.2 fix)
        self._reachabilityInterval = setInterval(function () {
          if (document.visibilityState === 'hidden') return;
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
          if (retryBtn.disabled) return;
          self._checkReachability(true);
        });
      }

      this._reachabilityBanner = banner;
    }

    /**
     * Resolve the backend base URL from all available sources.
     * Returns the URL string or empty string if none found.
     */
    _resolveBaseUrl() {
      // 1. window.api.baseUrl (most common — already resolved)
      if (window.api && window.api.baseUrl) return window.api.baseUrl;

      // 2. Electron saved server in localStorage
      try {
        var saved = localStorage.getItem('lana_saved_server');
        if (saved) {
          var info = JSON.parse(saved);
          if (info && info.url) {
            // Also fix up the api instance so future calls work
            if (window.api) window.api.baseUrl = info.url;
            return info.url;
          }
        }
      } catch (e) { /* ignore */ }

      // 3. Browser origin fallback (non-Electron, non-file)
      if (!window.electronAPI) {
        var origin = window.location.origin;
        if (window.location.protocol !== 'file:' && origin && origin !== 'null') {
          if (window.api) window.api.baseUrl = origin;
          return origin;
        }
      }

      return '';
    }

    /**
     * Perform a single health check against /api/health/discovery.
     * This endpoint is public (no auth header needed), so we can
     * distinguish "server down" from "token expired".
     *
     * @param {boolean} manual - true when triggered by the Retry button
     */
    _checkReachability(manual) {
      var baseUrl = this._resolveBaseUrl();
      if (!baseUrl) {
        // Last resort: wait for the api ready promise then retry once
        if (manual && window.api && window.api._readyPromise) {
          var self = this;
          this._setRetryLoading(true);
          window.api._readyPromise.then(function () {
            self._checkReachability(false);
            self._setRetryLoading(false);
          }).catch(function () {
            self._setRetryLoading(false);
          });
        }
        return;
      }

      var healthUrl = baseUrl + '/api/health/discovery';
      var wasReachable = this._reachable;
      var self = this;

      if (manual) this._setRetryLoading(true);

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
          if (manual) self._setRetryLoading(false);

          if (response.ok) {
            self._reachable = true;
            self._hideOfflineBanner();

            // Update centralized state
            if (window.Lex && window.Lex.state) {
              window.Lex.state.setReachability(true);
            }

            // If we were offline and now back, show a recovery toast
            if (!wasReachable && window.Lex && window.Lex.Toast) {
              window.Lex.Toast.show('Connection restored', 'success');
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
          if (manual) self._setRetryLoading(false);

          self._reachable = false;
          self._showOfflineBanner();
          if (window.Lex && window.Lex.state) {
            window.Lex.state.setReachability(false);
          }
        });
    }

    /**
     * Toggle the retry button between loading and idle states.
     */
    _setRetryLoading(loading) {
      var btn = this._reachabilityBanner &&
        this._reachabilityBanner.querySelector('#lex-offline-retry-btn');
      if (!btn) return;

      if (loading) {
        btn.disabled = true;
        btn.innerHTML = '<span class="lex-retry-spinner"></span>Retrying\u2026';
      } else {
        btn.disabled = false;
        btn.textContent = 'Retry Now';
      }
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
