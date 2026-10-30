/**
 * Lana AI Frontend Configuration
 *
 * Edit this file to configure the frontend for your deployment environment.
 *
 * DEPLOYMENT OPTIONS:
 *
 * 1. Production (Default) - Uses current origin for API calls
 *    API_BASE_URL: '',
 *    DEMO_MODE: false,
 *
 * 2. LAN Deployment - Frontend on user's computer, API on static IP
 *    API_BASE_URL: '',
 *    DEMO_MODE: false,
 *
 * 3. Demo/Presentation Mode - Show mock data without server
 *    API_BASE_URL: '',
 *    DEMO_MODE: false,
 */

window.LanaConfig = {
  // ============================================================
  // APP VERSION
  // ============================================================
  APP_VERSION: '2.0.0',

  // ============================================================
  // API CONFIGURATION
  // ============================================================

  /**
   * Backend API server URL
   *
   * AUTO-DISCOVERY MODE (Electron Client):
   *   - Set to empty string ('') for auto-discovery
   *   - Electron app will discover server via Bonjour/mDNS
   *   - Server URL is stored in electron-storage.js after discovery
   *
   * TRADITIONAL MODE (Web Browser):
   *   - Empty string ('') = Use current origin (window.location.origin)
   *   - Set to server IP/URL for LAN deployments
   *
   * DEVELOPMENT MODE:
   *   - Use the "API Override" field in login.html instead of setting this
   *   - Requires DEVELOPMENT_MODE: true
   *
   * Examples:
   *   ''                              - Auto-discovery (Electron) or same origin (browser)
   *   'http://192.168.1.100:3000'     - LAN server IP (traditional mode)
   *   'http://api.company.local:3000' - Local DNS name
   *   'https://api.lana.company.com'  - Production server
   */
  API_BASE_URL: (function () {
    // When lana-client is served under the @automation app's /lex-framework
    // mount, route API calls through same-origin so they pass through the
    // automation server's /api proxy to LANA-AI. Prevents cross-origin CORS
    // issues and keeps the auth cookie/header pipeline single-hop.
    if (typeof window !== 'undefined' && window.location && window.location.pathname &&
        window.location.pathname.indexOf('/lex-framework/') === 0) {
      return '';
    }
    return 'http://localhost:8080';
  })(),

  /**
   * LANA document editor/redline service URL.
   *
   * Empty string means the file viewer will use, in order:
   *   1. window.LANA_EDITOR_SERVICE
   *   2. localStorage["lana-editor-service"]
   *   3. http://127.0.0.1:4710
   *
   * Production builds can inject window.LANA_EDITOR_SERVICE before this file
   * loads, or set this value during packaging.
   */
  LANA_EDITOR_SERVICE_URL: '',

  // ============================================================
  // DEMO MODE CONFIGURATION
  // ============================================================

  /**
   * Enable Demo Mode
   *
   * When true:
   * - All API calls return mock data
   * - No server connection required
   * - Perfect for demos and presentations
   * - A prominent banner shows on all pages
   */
  DEMO_MODE: false,

  /**
   * Demo fixture manifest
   *
   * Only used when DEMO_MODE is true. Paths are resolved relative to
   * js/mock-data.js so subdirectory pages keep working.
   */
  DEMO_DATA_MANIFEST: '../mock-data/demo/manifest.json',

  /**
   * Enable Multi-Factor Authentication (MFA)
   *
   * When false:
   * - MFA setup/status UI elements are hidden
   * - MFA API calls are skipped
   * - Useful for deployments that don't require MFA
   */
  MFA_ENABLED: false,

  /**
   * Enable User Preferences Editing
   *
   * When false:
   * - Preferences section is hidden in settings
   * - Users cannot change their preferences
   * - Useful for deployments with fixed settings
   */
  USER_PREFERENCES_EDIT_ENABLED: false,

  // ============================================================
  // WORKFLOW FEATURE FLAGS
  // ============================================================

  /**
   * Enable Workflow Templates
   *
   * When false:
   * - Templates menu item is hidden in Workflow Tools section
   * - Templates page is not accessible from navigation
   */
  WORKFLOWS_TEMPLATES_ENABLED: false,

  /**
   * Enable Visual Builder
   *
   * When false:
   * - Visual Builder menu item is hidden in Workflow Tools section
   * - Visual Builder page is not accessible from navigation
   */
  WORKFLOWS_VISUAL_BUILDER_ENABLED: false,

  /**
   * Enable Active Workflows
   *
   * When false:
   * - Active Workflows menu item is hidden in Workflow Tools section
   * - Active Workflows page is not accessible from navigation
   */
  WORKFLOWS_ACTIVE_ENABLED: false,

  // ============================================================
  // OPTIONAL APP FEATURE FLAGS
  // ============================================================

  /**
   * Enable the optional Heartbeat app surfaces.
   *
   * When false:
   * - Heartbeat topbar indicator is hidden
   * - Heartbeat settings tab is hidden
   * - Heartbeat polling is skipped
   */
  HEARTBEAT_APP_ENABLED: false,

  /**
   * Enable the optional My Action Queue dashboard surface.
   *
   * When false:
   * - Dashboard Zone C is hidden
   * - Action queue API polling is skipped
   */
  ACTION_QUEUE_ENABLED: false,

  /**
   * Demo User Profile
   * Used when DEMO_MODE is true for simulating authentication
   */
  DEMO_USER: {
    id: 'u-001',
    email: 'john.doe@acmecorp.com',
    username: 'john_doe',
    first_name: 'John',
    last_name: 'Doe',
    roles: ['admin', 'user'],
    organization_id: 'demo-org-001',
    organization_name: 'Acme Legal Group',
    permissions: [
      'admin:access',
      'users:read',
      'users:write',
      'matters:read',
      'matters:write',
      'documents:read',
      'documents:write',
      'chat:access',
      'settings:read',
      'settings:write'
    ],
    created_at: '2026-01-15T10:00:00Z',
    last_login: new Date().toISOString()
  },

  /**
   * Demo Organization
   * Used for organization-level mock data
   */
  DEMO_ORGANIZATION: {
    id: 'demo-org-001',
    name: 'Acme Legal Group',
    slug: 'acme-legal-group',
    status: 'active',
    tier: 'professional',
    settings: {
      features: {
        chat: true,
        documents: true,
        canvas: true,
        plugins: true,
        api: true
      },
      limits: {
        max_users: 100,
        max_storage_gb: 100,
        max_matters: 500
      }
    },
    created_at: '2024-01-01T00:00:00Z'
  },

  // ============================================================
  // ADVANCED OPTIONS
  // ============================================================

  /**
   * Request timeout in milliseconds
   * Default: 30000 (30 seconds)
   */
  REQUEST_TIMEOUT: 30000,

  /**
   * Enable console logging for API calls
   * Useful for debugging in demo mode
   */
  DEBUG_MODE: false,

  /**
   * Development mode flag
   * Set to true for local development
   */
  DEVELOPMENT_MODE: true,

  /**
   * Templates and Document Studio (Library > Templates and Library > Studio
   * nav items, and the "Use as Template" / "Unmark Template" / "Generate"
   * file actions). Hidden, not removed, until the 3.1.0 rollout: flip to
   * true to show them again. Pages without this config read it as off.
   *
   * Plan for 3.1.0: test Document Studio and templates end to end, then set
   * this to true and ship both to everyone. Once they are live, remove this
   * flag and the checks that read it (lex-app.js Library nav, lex-sidebar.js
   * app launcher, matter-documents-view.js file menu, chip and badge,
   * file-viewer-page.js overflow menu, document-create-modal.js type choice,
   * folder.js plus its drive.css rule for the create menus) so the code goes
   * back to always showing them. The Template Library
   * page, Document Studio and all their code are still in place and do not
   * need to be rebuilt.
   */
  TEMPLATES_AND_STUDIO_ENABLED: false,

  /**
   * Admin Task Plans, Run Books and Communications (admin sidebar menu,
   * admin page switcher, Administration home cards, and My Tasks "New Task
   * Plan"). Hidden, not removed, until the 3.2.0 rollout: flip to true to
   * show them again. Pages without this config read it as off.
   *
   * Plan for 3.2.0: test all three end to end, set this to true, then
   * remove the flag and the checks that read it (menu.js admin items,
   * admin-switcher.js, admin-index.js, my-tasks.js) so they always show.
   * The pages and their code are still in place.
   */
  ADMIN_PLANS_RUNBOOKS_COMMS_ENABLED: false,

  /**
   * Top Movers section in the LanaInsights sidebar (metric movement list
   * under the Dashboard, Library, Firm Reporting and Billable Hours nav).
   * Hidden, not removed, until the 3.2.0 rollout of the dynamic analytics
   * and LanaInsights menu. While off, the sidebar also skips the top
   * movers API call. Pages without this config read it as off.
   *
   * Plan for 3.2.0: fold Top Movers into the dynamic analytics menu, set
   * this to true, then remove the flag and its two checks in lex-app.js
   * (_buildSidebarSections and _loadTopMoversForSidebar).
   */
  INSIGHTS_TOP_MOVERS_ENABLED: false,

  /**
   * Slash commands in the chat composer (the "/" command picker, and running
   * a typed command such as /search or /export instead of sending it to
   * LANA). Hidden, not removed, until the next version: while off, "/" text
   * is sent to LANA as an ordinary message. Pages without this config read
   * it as off.
   *
   * Plan for the next version: review the command list in
   * services/slash-commands.service.js (several commands, such as /noshow
   * and /staff, are not law firm commands), test each one end to end, set
   * this to true, then remove the flag and its two checks
   * (lex-chat.composer.js _checkSlashTrigger and lex-chat.js
   * _maybeRunSlashCommand, both through SlashHelpers.slashCommandsEnabled).
   */
  SLASH_COMMANDS_ENABLED: false,

  /**
   * Guided Connect wizard on Data Connectors (the step by step drawer that
   * walks a user through a connector's setup guide, saves and tests the
   * credentials, runs OAuth, and offers auto sync). Hidden until it is
   * verified end to end against the backend `connectors.guidedConnect`
   * flag: while off, clicking a connector that is not connected opens the
   * connector viewer exactly as before (including the silent configure
   * that creates its source row). Pages without this config read it as off.
   *
   * Turned on 2026-10-30 for live verification (the backend needs
   * FEATURE_CONNECTORS_GUIDED_CONNECT=true for a wizard test to mark a
   * credential connector connected). Set back to false to return to the
   * viewer-only flow.
   *
   * Plan: run the wizard live with a Stripe test key, Google (LANA managed
   * OAuth), a BYO OAuth connector and a second Postgres instance, then
   * remove the flag and its check (data_connectors.js connectorOpenRoute
   * through isConnectWizardEnabled) so the wizard always opens for
   * connectors that are not connected.
   */
  CONNECT_WIZARD_ENABLED: true,

  /**
   * Third-party MCP servers as connectors on Data Connectors: the "Add MCP
   * server" action, the MCP server rows, the MCP steps of the connect wizard
   * (Lex.ConnectWizard.open({ connectorType: 'mcp-server' })) and the server
   * panel with tool review. Hidden until it is verified end to end. It must
   * also stay off until the backend's FEATURE_MCP_CONNECTORS is on: with the
   * backend flag off every /api/v1/integrations/mcp-servers route answers 404.
   * Pages without this config read it as off.
   *
   * Even with the flag on, the MCP UI shows only for the two roles the
   * backend accepts, system_admin and org_admin (McpConnectModel.isVisible).
   * organization_admin is not shown the UI, although Lex.Auth.isOrgAdmin()
   * counts it, because the backend refuses that role with a 403.
   *
   * Turned on 2026-10-30 for live verification; the backend must also run
   * with FEATURE_MCP_CONNECTORS=true or the UI reports that MCP servers are
   * not turned on. Set back to false to hide the MCP UI.
   *
   * Plan: connect one OAuth server (dynamic registration), one with a
   * manual client and one with a bearer token, approve one tool and run it
   * from chat with its approval, then remove the flag and its single check
   * (McpConnectModel.isVisible).
   */
  MCP_CONNECTORS_ENABLED: true
};
