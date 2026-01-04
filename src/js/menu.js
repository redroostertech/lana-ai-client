/**
 * LanaAI Dynamic Menu System
 * 
 * Centralized, reusable menu configuration with support for:
 * - Path-based rendering (different menus for different pages)
 * - User role-based visibility (system_admin, admin, user, etc.)
 * - Custom visibility logic (functions that return true/false)
 * 
 * Hierarchy: Path -> User Role -> Custom Logic
 */

// ============================================================
// SVG ICON LIBRARY
// ============================================================
const MenuIcons = {
  home: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>',
  chat: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>',
  matters: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>',
  connectors: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>',
  insights: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>',
  workflows: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path></svg>',
  users: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>',
  roles: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>',
  audit: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>',
  health: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>',
  plugins: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"></path></svg>',
  settings: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>',
  organizations: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>',
  sessions: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>',
  integrations: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"></path></svg>',
  reporting: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
  back: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>',
  dashboard: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path></svg>',
  templates: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path></svg>',
  builder: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>',
  active: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
  logs: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
  cadences: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>',
  retargeting: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>',
  sync: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>',
  document: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
  
  // Additional insights icons
  trends: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>',
  performance: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>',
  entities: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>',
  network: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>',
  timeline: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
  search: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>',
  onboarding: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>',
  help: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
  analytics: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>',
  label: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>',
};

// ============================================================
// ROLE DEFINITIONS
// ============================================================
const UserRoles = {
  SYSTEM_ADMIN: 'system_admin',
  ORG_ADMIN: 'org_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  USER: 'user',
  VIEWER: 'viewer'
};

// ============================================================
// MENU CONFIGURATION
// ============================================================

/**
 * Menu sections and items configuration
 * 
 * Each section has:
 * - id: unique identifier
 * - title: display title (null for main navigation without header)
 * - requiredRoles: array of roles that can see this section (empty = all roles)
 * - showOnPaths: array of path patterns where this section appears (empty = all paths)
 * - hiddenOnPaths: array of path patterns where this section is hidden
 * - customVisibility: function(user, currentPath) => boolean for custom logic
 * - items: array of menu items
 * 
 * Each item has:
 * - id: unique identifier
 * - label: display text
 * - href: URL to navigate to
 * - icon: key from MenuIcons
 * - requiredRoles: array of roles that can see this item (empty = inherit from section)
 * - showOnPaths: array of path patterns (empty = inherit from section)
 * - hiddenOnPaths: array of path patterns where this item is hidden
 * - customVisibility: function(user, currentPath) => boolean
 * - badge: { text: string, class: string } for showing badges
 * - external: boolean - if true, opens in new tab
 */
const MenuConfig = {
  // Default menu for main portal pages
  portal: {
    sections: [
      {
        id: 'main',
        title: null, // No header for main nav
        requiredRoles: [],
        items: [
          { id: 'dashboard', label: 'Dashboard', href: '/index.html', icon: 'home' },
          { id: 'chat', label: 'Chat', href: '/chat.html', icon: 'chat' },
          { id: 'matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
          { id: 'workflows', label: 'Workflows', href: '/workflows/dashboard.html', icon: 'workflows' },
        ]
      },
      {
        id: 'data-insights',
        title: 'Data & Insights',
        requiredRoles: [],
        items: [
          { id: 'connectors', label: 'Data Connectors', href: '/integrations/connectors.html', icon: 'connectors' },
          { id: 'module-execution', label: 'Reports', href: '/insights/module-execution.html', icon: 'insights' },
          { id: 'predictions', label: 'Predictions', href: '/insights/predictions.html', icon: 'performance' },
        ]
      },
      {
        id: 'administration',
        title: 'Administration',
        requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN],
        items: [
          { id: 'users', label: 'Users', href: '/admin/users.html', icon: 'users' },
          { id: 'roles', label: 'Roles & Permissions', href: '/admin/roles.html', icon: 'roles' },
          { id: 'organizations', label: 'Organizations', href: '/admin/organizations.html', icon: 'organizations' },
          { id: 'sessions', label: 'Sessions', href: '/admin/sessions.html', icon: 'sessions' },
          { id: 'audit', label: 'Audit Logs', href: '/admin/audit.html', icon: 'audit' },
          { id: 'health', label: 'System Health', href: '/admin/health.html', icon: 'health' },
          // { id: 'integrations', label: 'Integrations', href: '/admin/integrations.html', icon: 'integrations' },
          // { id: 'plugins', label: 'Plugins', href: '/admin/plugins.html', icon: 'plugins' },
          // { id: 'reporting', label: 'Reporting', href: '/admin/reporting.html', icon: 'reporting' },
          // { 
          //   id: 'onboarding', 
          //   label: 'Onboarding', 
          //   href: '/admin/onboarding_management.html', 
          //   icon: 'onboarding',
          //   requiredRoles: [UserRoles.SYSTEM_ADMIN] // Only system admins
          // },
        ]
      },
      {
        id: 'account',
        title: 'Account',
        requiredRoles: [],
        isFooter: true, // Push to bottom of sidebar
        items: [
          { id: 'settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'help', label: 'Help & Support', href: '/help.html', icon: 'help' },
        ]
      }
    ]
  },

  // Admin panel specific menu
  admin: {
    sections: [
      {
        id: 'admin-main',
        title: null,
        requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN],
        items: [
          { id: 'admin-dashboard', label: 'Dashboard', href: '/admin/dashboard.html', icon: 'dashboard' },
          { id: 'admin-users', label: 'Users', href: '/admin/users.html', icon: 'users' },
          { id: 'admin-roles', label: 'Roles', href: '/admin/roles.html', icon: 'roles' },
          { id: 'admin-organizations', label: 'Organizations', href: '/admin/organizations.html', icon: 'organizations' },
          { id: 'admin-matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
          { id: 'admin-sessions', label: 'Sessions', href: '/admin/sessions.html', icon: 'sessions' },
          { id: 'admin-audit', label: 'Audit Logs', href: '/admin/audit.html', icon: 'audit' },
          { id: 'admin-health', label: 'System Health', href: '/admin/health.html', icon: 'health' },
          // { id: 'admin-integrations', label: 'Integrations', href: '/admin/integrations.html', icon: 'integrations' },
          // { id: 'admin-plugins', label: 'Plugins', href: '/admin/plugins.html', icon: 'plugins' },
          // { id: 'admin-reporting', label: 'Reporting', href: '/admin/reporting.html', icon: 'reporting' },
          { id: 'admin-settings', label: 'Settings', href: '/admin/settings.html', icon: 'settings' },
          // { 
          //   id: 'admin-onboarding', 
          //   label: 'Onboarding', 
          //   href: '/admin/onboarding_management.html', 
          //   icon: 'onboarding',
          //   requiredRoles: [UserRoles.SYSTEM_ADMIN] // Only system admins
          // },
        ]
      },
      {
        id: 'admin-back',
        title: null,
        requiredRoles: [],
        isFooter: true, // Push to bottom of sidebar
        items: [
          { id: 'back-to-portal', label: 'Back to Portal', href: '/index.html', icon: 'back' },
        ]
      }
    ]
  },

  // Workflows section menu (matches portal menu style)
  workflows: {
    sections: [
      {
        id: 'workflows-main',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'workflows-home', label: 'Dashboard', href: '/index.html', icon: 'home' },
          { id: 'workflows-chat', label: 'Chat', href: '/chat.html', icon: 'chat' },
          { id: 'workflows-matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
          { id: 'workflows-list', label: 'Workflows', href: '/workflows/dashboard.html', icon: 'workflows' },
        ]
      },
      {
        id: 'workflows-data',
        title: 'Data & Insights',
        requiredRoles: [],
        items: [
          { id: 'workflows-connectors', label: 'Data Connectors', href: '/integrations/connectors.html', icon: 'connectors' },
          { id: 'workflows-module-execution', label: 'Reports', href: '/insights/module-execution.html', icon: 'insights' },
          { id: 'workflows-predictions', label: 'Predictions', href: '/insights/predictions.html', icon: 'performance' },
        ]
      },
      {
        id: 'workflows-automation',
        title: 'Workflow Tools',
        requiredRoles: [],
        items: [
          { 
            id: 'workflows-templates', 
            label: 'Templates', 
            href: '/workflows/templates.html', 
            icon: 'templates',
            customVisibility: () => window.LanaConfig?.WORKFLOWS_TEMPLATES_ENABLED !== false
          },
          { 
            id: 'workflows-builder', 
            label: 'Visual Builder', 
            href: '/workflows/builder.html', 
            icon: 'builder',
            customVisibility: () => window.LanaConfig?.WORKFLOWS_VISUAL_BUILDER_ENABLED !== false
          },
          { 
            id: 'workflows-active', 
            label: 'Active Workflows', 
            href: '/workflows/active.html', 
            icon: 'active',
            customVisibility: () => window.LanaConfig?.WORKFLOWS_ACTIVE_ENABLED !== false
          },
          { id: 'workflows-logs', label: 'Execution Logs', href: '/workflows/execution-logs.html', icon: 'logs' },
          { id: 'workflows-cadences', label: 'Follow-up Cadences', href: '/workflows/follow-up-cadences.html', icon: 'cadences' },
          // { id: 'workflows-retargeting', label: 'Retargeting', href: '/workflows/retargeting.html', icon: 'retargeting' },
          { id: 'workflows-docgen', label: 'Document Generation', href: '/workflows/document-generation.html', icon: 'document' },
        ]
      },
      {
        id: 'workflows-admin',
        title: 'Administration',
        requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN],
        items: [
          { id: 'workflows-users', label: 'Users', href: '/admin/users.html', icon: 'users' },
          { id: 'workflows-roles', label: 'Roles & Permissions', href: '/admin/roles.html', icon: 'roles' },
          { id: 'workflows-organizations', label: 'Organizations', href: '/admin/organizations.html', icon: 'organizations' },
          { id: 'workflows-sessions', label: 'Sessions', href: '/admin/sessions.html', icon: 'sessions' },
          { id: 'workflows-audit', label: 'Audit Logs', href: '/admin/audit.html', icon: 'audit' },
          { id: 'workflows-health', label: 'System Health', href: '/admin/health.html', icon: 'health' },
          // { id: 'workflows-integrations', label: 'Integrations', href: '/admin/integrations.html', icon: 'integrations' },
          // { id: 'workflows-plugins', label: 'Plugins', href: '/admin/plugins.html', icon: 'plugins' },
          // { id: 'workflows-reporting', label: 'Reporting', href: '/admin/reporting.html', icon: 'reporting' },
          // {
          //   id: 'workflows-onboarding',
          //   label: 'Onboarding',
          //   href: '/admin/onboarding_management.html',
          //   icon: 'onboarding',
          //   requiredRoles: [UserRoles.SYSTEM_ADMIN]
          // },
        ]
      },
      {
        id: 'workflows-account',
        title: 'Account',
        requiredRoles: [],
        isFooter: true,
        items: [
          { id: 'workflows-settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'workflows-help', label: 'Help & Support', href: '/help.html', icon: 'help' },
        ]
      }
    ]
  },

  // Insights section menu
  insights: {
    sections: [
      {
        id: 'insights-main',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'insights-home', label: 'Dashboard', href: '/index.html', icon: 'home' },
          { id: 'insights-chat', label: 'Chat', href: '/chat.html', icon: 'chat' },
          { id: 'insights-matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
          { id: 'insights-workflows', label: 'Workflows', href: '/workflows/dashboard.html', icon: 'workflows' },
        ]
      },
      {
        id: 'insights-data',
        title: 'Data & Insights',
        requiredRoles: [],
        items: [
          { id: 'insights-connectors', label: 'Data Connectors', href: '/integrations/connectors.html', icon: 'connectors' },
          { id: 'insights-modules', label: 'Reports', href: '/insights/module-execution.html', icon: 'insights' },
          { id: 'insights-predictions', label: 'Predictions', href: '/insights/predictions.html', icon: 'performance' },
        ]
      },
      {
        id: 'insights-admin',
        title: 'Administration',
        requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN],
        items: [
          { id: 'insights-users', label: 'Users', href: '/admin/users.html', icon: 'users' },
          { id: 'insights-roles', label: 'Roles & Permissions', href: '/admin/roles.html', icon: 'roles' },
          { id: 'insights-organizations', label: 'Organizations', href: '/admin/organizations.html', icon: 'organizations' },
          { id: 'insights-sessions', label: 'Sessions', href: '/admin/sessions.html', icon: 'sessions' },
          { id: 'insights-audit', label: 'Audit Logs', href: '/admin/audit.html', icon: 'audit' },
          { id: 'insights-health', label: 'System Health', href: '/admin/health.html', icon: 'health' },
          // { id: 'insights-integrations', label: 'Integrations', href: '/admin/integrations.html', icon: 'integrations' },
          // { id: 'insights-plugins', label: 'Plugins', href: '/admin/plugins.html', icon: 'plugins' },
          // { id: 'insights-reporting', label: 'Reporting', href: '/admin/reporting.html', icon: 'reporting' },
          // {
          //   id: 'insights-onboarding',
          //   label: 'Onboarding',
          //   href: '/admin/onboarding_management.html',
          //   icon: 'onboarding',
          //   requiredRoles: [UserRoles.SYSTEM_ADMIN]
          // },
        ]
      },
      {
        id: 'insights-account',
        title: 'Account',
        requiredRoles: [],
        isFooter: true,
        items: [
          { id: 'insights-settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'insights-help', label: 'Help & Support', href: '/help.html', icon: 'help' },
        ]
      }
    ]
  },

  // Integrations section menu (matches portal menu style)
  integrations: {
    sections: [
      {
        id: 'integrations-main',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'integrations-home', label: 'Dashboard', href: '/index.html', icon: 'home' },
          { id: 'integrations-chat', label: 'Chat', href: '/chat.html', icon: 'chat' },
          { id: 'integrations-matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
          { id: 'integrations-workflows', label: 'Workflows', href: '/workflows/dashboard.html', icon: 'workflows' },
        ]
      },
      {
        id: 'integrations-data',
        title: 'Data & Insights',
        requiredRoles: [],
        items: [
          { id: 'integrations-connectors', label: 'Data Connectors', href: '/integrations/connectors.html', icon: 'connectors' },
          { id: 'integrations-module-execution', label: 'Reports', href: '/insights/module-execution.html', icon: 'insights' },
          { id: 'integrations-predictions', label: 'Predictions', href: '/insights/predictions.html', icon: 'performance' },
        ]
      },
      {
        id: 'integrations-admin',
        title: 'Administration',
        requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN],
        items: [
          { id: 'integrations-users', label: 'Users', href: '/admin/users.html', icon: 'users' },
          { id: 'integrations-roles', label: 'Roles & Permissions', href: '/admin/roles.html', icon: 'roles' },
          { id: 'integrations-organizations', label: 'Organizations', href: '/admin/organizations.html', icon: 'organizations' },
          { id: 'integrations-sessions', label: 'Sessions', href: '/admin/sessions.html', icon: 'sessions' },
          { id: 'integrations-audit', label: 'Audit Logs', href: '/admin/audit.html', icon: 'audit' },
          { id: 'integrations-health', label: 'System Health', href: '/admin/health.html', icon: 'health' },
          // { id: 'integrations-integrations', label: 'Integrations', href: '/admin/integrations.html', icon: 'integrations' },
          // { id: 'integrations-plugins', label: 'Plugins', href: '/admin/plugins.html', icon: 'plugins' },
          // { id: 'integrations-reporting', label: 'Reporting', href: '/admin/reporting.html', icon: 'reporting' },
          // {
          //   id: 'integrations-onboarding',
          //   label: 'Onboarding',
          //   href: '/admin/onboarding_management.html',
          //   icon: 'onboarding',
          //   requiredRoles: [UserRoles.SYSTEM_ADMIN]
          // },
        ]
      },
      {
        id: 'integrations-account',
        title: 'Account',
        requiredRoles: [],
        isFooter: true,
        items: [
          { id: 'integrations-settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'integrations-help', label: 'Help & Support', href: '/help.html', icon: 'help' },
        ]
      }
    ]
  }
};

// ============================================================
// MENU SYSTEM CLASS
// ============================================================
class MenuSystem {
  constructor(options = {}) {
    this.user = options.user || this._getUserFromStorage();
    this.currentPath = options.currentPath || window.location.pathname;
    this.containerSelector = options.containerSelector || '#sidebar nav';
    this.menuType = options.menuType || this._detectMenuType();
    this.activeItemClass = options.activeItemClass || 'text-white bg-gray-800';
    this.inactiveItemClass = options.inactiveItemClass || 'text-gray-300 hover:text-white hover:bg-gray-800';
    this.onItemClick = options.onItemClick || null;

    // Detect if we're in Electron file:// mode
    this.isFileProtocol = window.location.protocol === 'file:';

    // Calculate base path for relative navigation in file:// mode
    if (this.isFileProtocol) {
      // Get the directory of the current page
      const pathname = window.location.pathname;
      const lastSlash = pathname.lastIndexOf('/');
      this.currentDir = pathname.substring(0, lastSlash + 1);

      // Find public_html in the path to get the base
      const publicHtmlIndex = pathname.indexOf('public_html');
      if (publicHtmlIndex !== -1) {
        this.basePath = pathname.substring(0, publicHtmlIndex + 'public_html'.length);
      } else {
        this.basePath = this.currentDir;
      }
    }
  }

  /**
   * Convert an absolute href to the correct format for current context
   * In file:// mode (Electron), converts /path.html to proper relative path
   * In http(s):// mode (browser), keeps absolute paths as-is
   */
  _resolveHref(href) {
    // If not file:// protocol, use href as-is (works in browser)
    if (!this.isFileProtocol) {
      return href;
    }

    // In file:// mode, convert absolute paths to full paths based on public_html location
    if (href.startsWith('/')) {
      // Remove leading slash and prepend the base path
      const relativePath = href.substring(1);
      return this.basePath + '/' + relativePath;
    }

    return href;
  }

  /**
   * Get user from localStorage (api.js stores user info here)
   */
  _getUserFromStorage() {
    try {
      const userJson = localStorage.getItem('user');
      return userJson ? JSON.parse(userJson) : null;
    } catch (e) {
      console.error('Failed to parse user from localStorage:', e);
      return null;
    }
  }

  /**
   * Detect menu type based on current path
   */
  _detectMenuType() {
    const path = this.currentPath.toLowerCase();
    
    // All pages use 'portal' menu for consistency
    // Admin pages now show the same menu with role-based Administration section
    // Removed special admin path detection - use portal menu everywhere
    
    if (path.includes('/insights/')) return 'insights';
    if (path.includes('/workflows/')) return 'workflows';
    if (path.includes('/integrations/')) return 'integrations';
    
    return 'portal';
  }

  /**
   * Check if user has any of the required roles
   */
  hasRole(requiredRoles) {
    if (!requiredRoles || requiredRoles.length === 0) return true;
    if (!this.user) return false;

    // Handle different role formats from the backend
    const userRoles = this.user.roles || this.user.role_names || [];
    const userRoleName = this.user.role_name || this.user.role;
    
    // Extract role name from various formats (string or object with name property)
    const extractRoleName = (r) => {
      if (typeof r === 'string') return r.toLowerCase();
      if (r && typeof r === 'object' && r.name) return r.name.toLowerCase();
      return null;
    };
    
    // Create a set of all user roles
    const allUserRoles = new Set([
      ...userRoles.map(extractRoleName).filter(Boolean),
      ...(userRoleName ? [extractRoleName(userRoleName)].filter(Boolean) : [])
    ]);

    return requiredRoles.some(role => allUserRoles.has(role.toLowerCase()));
  }

  /**
   * Check if path matches a pattern
   */
  pathMatches(patterns, path = this.currentPath) {
    if (!patterns || patterns.length === 0) return true;
    
    return patterns.some(pattern => {
      // Support wildcard patterns
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(path);
      }
      return path.includes(pattern);
    });
  }

  /**
   * Check if a section or item is visible
   */
  isVisible(config) {
    // Check role requirements
    if (config.requiredRoles && config.requiredRoles.length > 0) {
      if (!this.hasRole(config.requiredRoles)) return false;
    }

    // Check path restrictions
    if (config.showOnPaths && config.showOnPaths.length > 0) {
      if (!this.pathMatches(config.showOnPaths)) return false;
    }

    // Check hidden paths
    if (config.hiddenOnPaths && config.hiddenOnPaths.length > 0) {
      if (this.pathMatches(config.hiddenOnPaths)) return false;
    }

    // Check custom visibility function
    if (typeof config.customVisibility === 'function') {
      if (!config.customVisibility(this.user, this.currentPath)) return false;
    }

    return true;
  }

  /**
   * Check if an item is the active page
   */
  isActive(item) {
    // Normalize paths - remove leading slash and trailing slashes
    const normalizePathForComparison = (path) => {
      return path
        .replace(/^\/+/, '')  // Remove leading slashes
        .replace(/\/+$/, '')  // Remove trailing slashes
        .replace(/\.html$/, '') // Remove .html extension
        .toLowerCase();
    };

    const itemPath = normalizePathForComparison(item.href);
    const currentPath = normalizePathForComparison(this.currentPath);
    
    // Handle root/index page specially
    const itemIsIndex = itemPath === 'index' || itemPath === '';
    const currentIsIndex = currentPath === 'index' || currentPath === '';
    
    // If item is index/root, only match if current is also index/root
    if (itemIsIndex) {
      return currentIsIndex;
    }
    
    // Exact match (after normalization)
    if (itemPath === currentPath) return true;
    
    // For subdirectory index pages (e.g., /admin/dashboard.html)
    // Check if the paths match when considering directory structure
    // But be strict - don't match partial paths
    
    return false;
  }

  /**
   * Render a single menu item
   */
  renderItem(item) {
    if (!this.isVisible(item)) return '';

    const isActive = this.isActive(item);
    const activeClass = isActive ? this.activeItemClass : this.inactiveItemClass;
    const icon = MenuIcons[item.icon] || '';
    const target = item.external ? 'target="_blank" rel="noopener"' : '';
    
    let badgeHtml = '';
    if (item.badge) {
      badgeHtml = `<span class="ml-auto px-2 py-0.5 text-xs rounded-full ${item.badge.class || 'bg-indigo-100 text-indigo-800'}">${item.badge.text}</span>`;
    }

    // Resolve href for file:// protocol compatibility (Electron on Windows)
    const resolvedHref = this._resolveHref(item.href);

    return `
      <a href="${resolvedHref}"
         class="flex items-center gap-3 px-4 py-3 ${activeClass} rounded-lg transition-colors"
         data-menu-id="${item.id}"
         ${target}>
        ${icon}
        ${item.label}
        ${badgeHtml}
      </a>
    `;
  }

  /**
   * Render a section
   */
  renderSection(section) {
    if (!this.isVisible(section)) return '';

    const visibleItems = section.items.filter(item => this.isVisible(item));
    if (visibleItems.length === 0) return '';

    let html = '';
    
    if (section.title) {
      html += `
        <div class="mt-8">
          <p class="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider">${section.title}</p>
          <div class="mt-3 space-y-1">
            ${visibleItems.map(item => this.renderItem(item)).join('')}
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="space-y-1">
          ${visibleItems.map(item => this.renderItem(item)).join('')}
        </div>
      `;
    }

    return html;
  }

  /**
   * Render the complete menu
   */
  render() {
    const config = MenuConfig[this.menuType];
    if (!config) {
      console.error(`Menu type '${this.menuType}' not found`);
      return '';
    }

    // Separate regular sections from footer sections
    const regularSections = config.sections.filter(s => !s.isFooter);
    const footerSections = config.sections.filter(s => s.isFooter);

    const regularHtml = regularSections
      .map(section => this.renderSection(section))
      .filter(html => html.length > 0)
      .join('');

    const footerHtml = footerSections
      .map(section => this.renderSection(section))
      .filter(html => html.length > 0)
      .join('');

    // If there are footer sections, wrap in a flex container to push footer to bottom
    if (footerHtml) {
      // Get version from centralized version system
      const version = window.APP_VERSION?.getVersion() || 'Loading...';

      return `
        <div class="flex flex-col h-full">
          <div class="flex-1 overflow-y-auto pb-4">
            ${regularHtml}
          </div>
          <div class="flex-shrink-0 border-t border-gray-800 pt-4 pb-4">
            ${footerHtml}
            <p id="app-version" class="px-4 mt-3 text-xs text-gray-500">v${version}</p>
          </div>
        </div>
      `;
    }

    // Even without footer, make the menu scrollable
    return `
      <div class="overflow-y-auto h-full pb-4">
        ${regularHtml}
      </div>
    `;
  }

  /**
   * Inject the menu into the DOM
   */
  inject(containerSelector = this.containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) {
      console.error(`Menu container '${containerSelector}' not found`);
      return false;
    }

    container.innerHTML = this.render();

    // Add click handlers if provided
    if (this.onItemClick) {
      container.querySelectorAll('a[data-menu-id]').forEach(link => {
        link.addEventListener('click', (e) => {
          this.onItemClick(e, link.dataset.menuId);
        });
      });
    }

    // Update version from Electron API if available
    this._updateVersionFromElectron();

    return true;
  }

  /**
   * Update version display
   */
  async _updateVersionFromElectron() {
    const versionEl = document.getElementById('app-version');
    if (!versionEl) return;

    // Use centralized version if available
    if (window.APP_VERSION) {
      versionEl.textContent = window.APP_VERSION.getVersion();
      return;
    }

    // Fallback to Electron API if centralized version not available
    try {
      if (window.electronAPI?.getVersion) {
        const version = await window.electronAPI.getVersion();
        versionEl.textContent = `v${version}`;
      }
    } catch (e) {
      console.error('Failed to get version:', e);
    }
  }

  /**
   * Update the active state (useful for SPA navigation)
   */
  updateActive(newPath) {
    this.currentPath = newPath;
    
    const container = document.querySelector(this.containerSelector);
    if (!container) return;

    container.querySelectorAll('a[data-menu-id]').forEach(link => {
      const itemId = link.dataset.menuId;
      const item = this._findItemById(itemId);
      if (item) {
        const isActive = this.isActive(item);
        link.className = `flex items-center gap-3 px-4 py-3 ${isActive ? this.activeItemClass : this.inactiveItemClass} rounded-lg transition-colors`;
      }
    });
  }

  /**
   * Find an item by ID across all sections
   */
  _findItemById(id) {
    const config = MenuConfig[this.menuType];
    if (!config) return null;

    for (const section of config.sections) {
      const item = section.items.find(i => i.id === id);
      if (item) return item;
    }
    return null;
  }
}

// ============================================================
// SIDEBAR COMPONENT
// ============================================================

/**
 * Complete sidebar component with menu system
 * Renders the full sidebar including logo, menu, and mobile toggle functionality
 */
class SidebarComponent {
  constructor(options = {}) {
    this.brandName = options.brandName || 'LanaAI';
    this.brandHref = options.brandHref || '/index.html';
    this.menuOptions = options.menuOptions || {};
    this.sidebarId = options.sidebarId || 'sidebar';
    this.overlayId = options.overlayId || 'sidebarOverlay';
    this.openBtnId = options.openBtnId || 'openSidebar';
    this.closeBtnId = options.closeBtnId || 'closeSidebar';
  }

  /**
   * Render the complete sidebar HTML
   */
  render() {
    const menuSystem = new MenuSystem({
      ...this.menuOptions,
      containerSelector: `#${this.sidebarId} nav`
    });

    const isAdminPanel = menuSystem.menuType === 'admin';
    const brandSuffix = isAdminPanel ? '<span class="text-sm font-normal text-gray-400 ml-2">Admin</span>' : '';

    return `
      <!-- Sidebar -->
      <aside id="${this.sidebarId}" class="fixed inset-y-0 left-0 w-64 bg-gray-900 text-white transform -translate-x-full lg:translate-x-0 transition-transform z-30">
        <div class="flex items-center justify-between h-16 px-6 border-b border-gray-800">
          <a href="${this.brandHref}" class="text-xl font-bold text-indigo-400">${this.brandName}</a>
          ${brandSuffix}
          <button id="${this.closeBtnId}" class="lg:hidden text-gray-400 hover:text-white">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        <nav class="mt-6 px-3">
          ${menuSystem.render()}
        </nav>
      </aside>
      
      <!-- Overlay for mobile sidebar -->
      <div id="${this.overlayId}" class="fixed inset-0 bg-black bg-opacity-50 z-20 hidden lg:hidden"></div>
    `;
  }

  /**
   * Inject sidebar into the page and setup event listeners
   */
  inject(targetSelector = 'body', position = 'afterbegin') {
    const target = document.querySelector(targetSelector);
    if (!target) {
      console.error(`Target '${targetSelector}' not found for sidebar injection`);
      return false;
    }

    target.insertAdjacentHTML(position, this.render());
    this._setupEventListeners();
    return true;
  }

  /**
   * Setup mobile sidebar toggle event listeners
   */
  _setupEventListeners() {
    const sidebar = document.getElementById(this.sidebarId);
    const overlay = document.getElementById(this.overlayId);
    const openBtn = document.getElementById(this.openBtnId);
    const closeBtn = document.getElementById(this.closeBtnId);

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        sidebar?.classList.remove('-translate-x-full');
        overlay?.classList.remove('hidden');
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        sidebar?.classList.add('-translate-x-full');
        overlay?.classList.add('hidden');
      });
    }

    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar?.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
      });
    }
  }
}

// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================

/**
 * Quick function to render menu into an existing nav container
 */
function renderMenu(containerSelector = '#sidebar nav', options = {}) {
  const menuSystem = new MenuSystem({
    ...options,
    containerSelector
  });
  return menuSystem.inject();
}

/**
 * Quick function to check if current user is admin
 */
function isAdmin() {
  const menuSystem = new MenuSystem();
  return menuSystem.hasRole([UserRoles.SYSTEM_ADMIN, UserRoles.ADMIN]);
}

/**
 * Quick function to check if current user is system admin
 */
function isSystemAdmin() {
  const menuSystem = new MenuSystem();
  return menuSystem.hasRole([UserRoles.SYSTEM_ADMIN]);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MenuSystem,
    SidebarComponent,
    MenuConfig,
    MenuIcons,
    UserRoles,
    renderMenu,
    isAdmin,
    isSystemAdmin
  };
}

