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
  DEVELOPMENT_MODE: true
};
