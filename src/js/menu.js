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
  tasks: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 11l3 3L22 4"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"></path></svg>',
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
  lex: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg>',
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
  folder: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>',
  plus: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>',
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
  // Default menu for main portal pages - three sections: static top (4 items), scrollable (Your Chats + conversations), static footer
  portal: {
    sections: [
      // Section 1: Non-scrollable – Dashboard, Search Conversations, Matters, Drive
      {
        id: 'main',
        title: null,
        requiredRoles: [],
        isStaticTop: true,
        items: [
          { id: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'home' },
          { id: 'lex-ui', label: 'Lex UI', href: '/lex-test.html', icon: 'lex' },
          {
            id: 'search-conversations',
            label: 'Search Conversations',
            href: '/search-conversations.html',
            icon: 'search'
          },
          { id: 'matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
          { id: 'my-tasks', label: 'My Tasks', href: '/my-tasks.html', icon: 'tasks' },
        ]
      },
      // Section 2: Infinite scrolling – Your Chats, New Chat, {{conversations}} (Data Connectors + Reports scroll with this)
      {
        id: 'nav-links',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'connectors', label: 'Data Connectors', href: '/data-connectors.html', icon: 'connectors' },
          { id: 'insights', label: 'Analytics', href: '/admin/analytics.html', icon: 'analytics' },
        ]
      },
      {
        id: 'projects',
        title: 'Your Chats',
        requiredRoles: [],
        isConversationList: true,
        items: [
          {
            id: 'new-matter-chat',
            label: 'New Chat',
            href: '#',
            icon: 'plus',
            isButton: true,
            onClick: 'openNewProjectModal'
          }
        ]
      },
      // Section 3: Non-scrollable static footer (user block + version rendered separately)
      {
        id: 'account',
        title: null,
        requiredRoles: [],
        isFooter: true,
        items: [
          {
            id: 'administration',
            label: 'Administration',
            href: '/admin/index.html',
            icon: 'users',
            requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN]
          },
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
          { id: 'admin-task-plans', label: 'Task Plans', href: '/admin/task-plans.html', icon: 'tasks' },
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
          { id: 'back-to-portal', label: 'Back to Portal', href: '/dashboard.html', icon: 'back' },
        ]
      }
    ]
  },

  // Workflows section menu (same static/scroll structure as portal)
  workflows: {
    sections: [
      {
        id: 'main',
        title: null,
        requiredRoles: [],
        isStaticTop: true,
        items: [
          { id: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'home' },
          { id: 'lex-ui', label: 'Lex UI', href: '/lex-test.html', icon: 'lex' },
          {
            id: 'search-conversations',
            label: 'Search Conversations',
            href: '/search-conversations.html',
            icon: 'search'
          },
          { id: 'matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
        ]
      },
      {
        id: 'nav-links',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'connectors', label: 'Data Connectors', href: '/data-connectors.html', icon: 'connectors' },
          { id: 'insights', label: 'Analytics', href: '/admin/analytics.html', icon: 'analytics' },
        ]
      },
      {
        id: 'projects',
        title: 'Your Chats',
        requiredRoles: [],
        isConversationList: true,
        items: [
          {
            id: 'new-matter-chat',
            label: 'New Chat',
            href: '#',
            icon: 'plus',
            isButton: true,
            onClick: 'openNewProjectModal'
          }
        ]
      },
      {
        id: 'account',
        title: null,
        requiredRoles: [],
        isFooter: true,
        items: [
          {
            id: 'administration',
            label: 'Administration',
            href: '/admin/index.html',
            icon: 'users',
            requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN]
          },
          { id: 'settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'help', label: 'Help & Support', href: '/help.html', icon: 'help' },
        ]
      }
    ]
  },

  // Insights section menu (same static/scroll structure as portal)
  insights: {
    sections: [
      {
        id: 'main',
        title: null,
        requiredRoles: [],
        isStaticTop: true,
        items: [
          { id: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'home' },
          { id: 'lex-ui', label: 'Lex UI', href: '/lex-test.html', icon: 'lex' },
          {
            id: 'search-conversations',
            label: 'Search Conversations',
            href: '/search-conversations.html',
            icon: 'search'
          },
          { id: 'matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
        ]
      },
      {
        id: 'nav-links',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'connectors', label: 'Data Connectors', href: '/data-connectors.html', icon: 'connectors' },
          { id: 'insights', label: 'Analytics', href: '/admin/analytics.html', icon: 'analytics' },
        ]
      },
      {
        id: 'projects',
        title: 'Your Chats',
        requiredRoles: [],
        isConversationList: true,
        items: [
          {
            id: 'new-matter-chat',
            label: 'New Chat',
            href: '#',
            icon: 'plus',
            isButton: true,
            onClick: 'openNewProjectModal'
          }
        ]
      },
      {
        id: 'account',
        title: null,
        requiredRoles: [],
        isFooter: true,
        items: [
          {
            id: 'administration',
            label: 'Administration',
            href: '/admin/index.html',
            icon: 'users',
            requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN]
          },
          { id: 'settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'help', label: 'Help & Support', href: '/help.html', icon: 'help' },
        ]
      }
    ]
  },

  // Integrations section menu (same static/scroll structure as portal)
  integrations: {
    sections: [
      {
        id: 'main',
        title: null,
        requiredRoles: [],
        isStaticTop: true,
        items: [
          { id: 'dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'home' },
          { id: 'lex-ui', label: 'Lex UI', href: '/lex-test.html', icon: 'lex' },
          {
            id: 'search-conversations',
            label: 'Search Conversations',
            href: '/search-conversations.html',
            icon: 'search'
          },
          { id: 'matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
        ]
      },
      {
        id: 'nav-links',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'connectors', label: 'Data Connectors', href: '/data-connectors.html', icon: 'connectors' },
          { id: 'insights', label: 'Analytics', href: '/admin/analytics.html', icon: 'analytics' },
        ]
      },
      {
        id: 'projects',
        title: 'Your Chats',
        requiredRoles: [],
        isConversationList: true,
        items: [
          {
            id: 'new-matter-chat',
            label: 'New Chat',
            href: '#',
            icon: 'plus',
            isButton: true,
            onClick: 'openNewProjectModal'
          }
        ]
      },
      {
        id: 'account',
        title: null,
        requiredRoles: [],
        isFooter: true,
        items: [
          {
            id: 'administration',
            label: 'Administration',
            href: '/admin/index.html',
            icon: 'users',
            requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN]
          },
          { id: 'settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'help', label: 'Help & Support', href: '/help.html', icon: 'help' },
        ]
      }
    ]
  },

  // Chat page: same three-section structure – Section 1 static (4 items), Section 2 scrollable (Your Chats + conversations), Section 3 footer
  chat: {
    sections: [
      // Section 1: Non-scrollable – Dashboard, Search Conversations, Matters, Drive
      {
        id: 'chat-main',
        title: null,
        requiredRoles: [],
        isStaticTop: true,
        items: [
          { id: 'chat-dashboard', label: 'Dashboard', href: '/dashboard.html', icon: 'home' },
          { id: 'lex-ui', label: 'Lex UI', href: '/lex-test.html', icon: 'lex' },
          {
            id: 'chat-search',
            label: 'Search Conversations',
            href: '#',
            icon: 'search',
            isButton: true,
            onClick: 'openConversationSearchModal'
          },
          { id: 'chat-matters', label: 'Matters', href: '/matters.html', icon: 'matters' },
        ]
      },
      // Section 2: Infinite scrolling – Your Chats, New Chat, {{conversations}} (Data Connectors + Reports scroll with this)
      {
        id: 'chat-nav-links',
        title: null,
        requiredRoles: [],
        items: [
          { id: 'chat-connectors', label: 'Data Connectors', href: '/data-connectors.html', icon: 'connectors' },
          { id: 'chat-insights', label: 'Analytics', href: '/admin/analytics.html', icon: 'analytics' },
        ]
      },
      {
        id: 'chat-projects',
        title: 'Your Chats',
        requiredRoles: [],
        isConversationList: true,
        items: [
          {
            id: 'chat-new-matter',
            label: 'New Chat',
            href: '#',
            icon: 'plus',
            isButton: true,
            onClick: 'openNewProjectModal'
          }
        ]
      },
      // Section 3: Non-scrollable static footer (user block + version rendered separately)
      {
        id: 'chat-footer',
        title: null,
        requiredRoles: [],
        isFooter: true,
        items: [
          {
            id: 'chat-administration',
            label: 'Administration',
            href: '/admin/index.html',
            icon: 'users',
            requiredRoles: [UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN]
          },
          { id: 'chat-settings', label: 'Settings', href: '/settings.html', icon: 'settings' },
          { id: 'chat-help', label: 'Help & Support', href: '/help.html', icon: 'help' },
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
    const config = MenuConfig[this.menuType];
    const hasFooter = config?.sections?.some(s => s.isFooter);
    this.footerSelector = options.footerSelector !== undefined
      ? options.footerSelector
      : (hasFooter ? '#navFooter' : null);
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

    if (path.includes('chat.html')) return 'chat';
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

    // Handle button items with onclick handlers
    if (item.isButton && item.onClick) {
      return `
        <button onclick="${item.onClick}()"
           class="w-full flex items-center gap-3 py-2 ${activeClass} rounded-lg transition-colors"
           data-menu-id="${item.id}">
          ${icon}
          ${item.label}
          ${badgeHtml}
        </button>
      `;
    }

    // Resolve href for file:// protocol compatibility (Electron on Windows)
    const resolvedHref = this._resolveHref(item.href);

    return `
      <a href="${resolvedHref}"
         class="flex items-center gap-3 py-2 ${activeClass} rounded-lg transition-colors"
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
    if (visibleItems.length === 0 && !section.isConversationList) return '';

    let html = '';

    // Handle conversation list section specially (no inner scroll - entire nav scrolls)
    if (section.isConversationList) {
      html += `
        <div class="mt-8">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">${section.title || ''}</p>
          <div class="mt-3 space-y-1">
            ${visibleItems.map(item => this.renderItem(item)).join('')}
          </div>
          <div class="mt-3 space-y-1" id="conversationListContainer">
            <!-- Conversations will be dynamically loaded here -->
            <p class="text-sm text-gray-400 italic px-3 py-2">Loading conversations...</p>
          </div>
        </div>
      `;
      return html;
    }

    if (section.title) {
      html += `
        <div class="mt-8">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">${section.title}</p>
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
    const staticTopSections = regularSections.filter(s => s.isStaticTop);
    const scrollableSections = regularSections.filter(s => !s.isStaticTop);

    const regularHtml = regularSections
      .map(section => this.renderSection(section))
      .filter(html => html.length > 0)
      .join('');

    const footerHtml = footerSections
      .map(section => this.renderSection(section))
      .filter(html => html.length > 0)
      .join('');

    // When using separate footer (footerSelector), only return scrollable content
    const includeFooterInContent = footerHtml && !this.footerSelector;
    if (includeFooterInContent) {
      const version = window.APP_VERSION?.getVersion() || 'Loading...';
      return `
        <div class="flex flex-col pb-4">
          <div class="pb-4">
            ${regularHtml}
          </div>
          <div class="border-t border-gray-800 pt-4 pb-4">
            ${footerHtml}
            <p id="app-version" class="px-4 mt-3 text-xs text-gray-500">${version}</p>
          </div>
        </div>
      `;
    }

    // When using separate footer and we have static top: static block + scrollable block
    if (this.footerSelector && staticTopSections.length > 0) {
      const staticTopHtml = staticTopSections
        .map(section => this.renderSection(section))
        .filter(html => html.length > 0)
        .join('');
      const scrollableHtml = scrollableSections
        .map(section => this.renderSection(section))
        .filter(html => html.length > 0)
        .join('');
      return `
        <div class="flex flex-col flex-1 min-h-0">
          <div class="flex-shrink-0 space-y-1">
            ${staticTopHtml}
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto">
            ${scrollableHtml}
          </div>
        </div>
      `;
    }

    return `
      <div class="flex flex-col">
        ${regularHtml}
      </div>
    `;
  }

  /**
   * Render footer content. All pages with a footer get the sidebar user block (avatar + first name);
   * tapping the user block opens an overlay with user details, menu options, and version.
   */
  renderFooter() {
    const config = MenuConfig[this.menuType];
    if (!config) return '';
    const footerSections = config.sections.filter(s => s.isFooter);
    if (footerSections.length === 0) return '';

    const user = this.user;
    const fullName = user ? `${user.firstName || user.first_name || ''} ${user.lastName || user.last_name || ''}`.trim() || user.email || 'User' : 'User';
    const firstName = user
      ? (user.firstName || user.first_name || (fullName && fullName.split(/\s+/)[0]) || 'User')
      : 'User';
    const initials = user
      ? ((user.firstName || user.first_name || '')?.[0] || '') + ((user.lastName || user.last_name || '')?.[0] || '') || (user.email || 'U')[0].toUpperCase()
      : 'U';

    return `
      <div class="space-y-1">
        <button type="button" id="sidebarUserMenuTrigger" class="w-full flex items-center gap-3 text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors text-left min-w-0">
          <div class="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span id="sidebarUserInitials" class="text-sm font-medium text-white">${initials}</span>
          </div>
          <span id="sidebarUserName" class="flex-1 min-w-0 truncate text-sm font-medium">${firstName}</span>
          <svg class="w-4 h-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
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

    // Scrollable content only when using separate footer; otherwise full content
    container.innerHTML = this.render();

    // When using separate footer: layout nav and inject footer below nav
    if (this.footerSelector) {
      const config = MenuConfig[this.menuType];
      const hasStaticTop = config && config.sections.filter(s => !s.isFooter).some(s => s.isStaticTop);
      container.classList.add('flex', 'flex-col', 'flex-1', 'min-h-0');
      // Keep overflow-hidden so the nav constrains height; scroll happens in the inner div (scrollable section)
      container.classList.add('overflow-hidden');
      if (!hasStaticTop) {
        container.classList.remove('overflow-hidden');
        container.classList.add('overflow-y-auto');
      }

      const footerHtml = this.renderFooter();
      if (footerHtml) {
        let footerEl = document.querySelector(this.footerSelector);
        if (!footerEl && container.parentNode) {
          footerEl = document.createElement('div');
          footerEl.id = this.footerSelector.replace(/^#/, '');
          footerEl.className = 'flex-shrink-0 border-t border-gray-800 pt-4 pb-4 px-3';
          container.parentNode.appendChild(footerEl);
        }
        if (footerEl) {
          footerEl.innerHTML = footerHtml;
          this._setupSidebarUserMenuOverlay();
        }
      }
    }

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
   * Create sidebar user menu overlay and wire trigger (all pages with footer).
   * Dark-themed panel with user header (avatar, name, handle) and menu: Administration, Settings, Help & Support, Sign Out.
   */
  _setupSidebarUserMenuOverlay() {
    const trigger = document.getElementById('sidebarUserMenuTrigger');
    if (!trigger) return;

    let overlay = document.getElementById('sidebarUserMenuOverlay');
    if (!overlay) {
      const showAdmin = this.hasRole([UserRoles.SYSTEM_ADMIN, UserRoles.ORG_ADMIN, UserRoles.ADMIN]);
      const isAdminPath = (this.currentPath || '').toLowerCase().includes('/admin/');
      const adminHref = this._resolveHref('/admin/index.html');
      const settingsHref = this._resolveHref('/settings.html');
      const helpHref = this._resolveHref('/help.html');
      const portalHref = this._resolveHref('/dashboard.html');

      const user = this.user;
      const fullName = user ? `${user.firstName || user.first_name || ''} ${user.lastName || user.last_name || ''}`.trim() || user.email || 'User' : 'User';
      const nameEsc = String(fullName).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const initials = user
        ? ((user.firstName || user.first_name || '')?.[0] || '') + ((user.lastName || user.last_name || '')?.[0] || '') || (user.email || 'U')[0].toUpperCase()
        : 'U';
      const rawHandle = (user && (user.username || user.email)) ? (user.username ? `@${user.username}` : user.email) : '';
      const handle = rawHandle ? String(rawHandle).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
      const version = window.APP_VERSION?.getVersion() || 'Loading...';

      overlay = document.createElement('div');
      overlay.id = 'sidebarUserMenuOverlay';
      overlay.className = 'fixed inset-0 z-[100] hidden';
      overlay.innerHTML = `
        <div class="fixed inset-0" data-dismiss="sidebarUserMenuOverlay" aria-hidden="true"></div>
        <div class="fixed bottom-0 left-0 w-64 bg-gray-800 rounded-t-2xl shadow-2xl max-h-[85vh] overflow-hidden flex flex-col z-[101]" onclick="event.stopPropagation()">
          <div class="p-4 pb-3">
            <div class="flex justify-center mb-3">
              <div class="w-10 h-1 bg-gray-600 rounded-full"></div>
            </div>
            <div class="flex items-center gap-3 px-2">
              <div class="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
                <span class="text-lg font-medium text-white">${initials}</span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-white font-medium text-sm break-words leading-tight min-w-0">${nameEsc}</p>
                ${handle ? `<p class="text-gray-400 text-sm truncate">${handle}</p>` : ''}
              </div>
            </div>
          </div>
          <nav class="px-2 pb-4 overflow-y-auto flex-1 min-h-0">
            ${showAdmin ? `<a href="${adminHref}" class="sidebar-user-menu-item flex items-center gap-3 py-2 text-gray-200 hover:bg-gray-700 rounded-xl transition-colors w-full">
              <span class="text-gray-400 w-5 h-5 flex-shrink-0">${MenuIcons.users}</span>
              <span>Administration</span>
            </a>` : ''}
            <a href="${settingsHref}" class="sidebar-user-menu-item flex items-center gap-3 py-2 text-gray-200 hover:bg-gray-700 rounded-xl transition-colors w-full">
              <span class="text-gray-400 w-5 h-5 flex-shrink-0">${MenuIcons.settings}</span>
              <span>Settings</span>
            </a>
            <a href="${helpHref}" class="sidebar-user-menu-item flex items-center gap-3 py-2 text-gray-200 hover:bg-gray-700 rounded-xl transition-colors w-full">
              <span class="text-gray-400 w-5 h-5 flex-shrink-0">${MenuIcons.help}</span>
              <span>Help & Support</span>
              <svg class="w-4 h-4 ml-auto text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </a>
            ${isAdminPath ? `<a href="${portalHref}" class="sidebar-user-menu-item flex items-center gap-3 py-2 text-gray-200 hover:bg-gray-700 rounded-xl transition-colors w-full">
              <span class="text-gray-400 w-5 h-5 flex-shrink-0">${MenuIcons.back}</span>
              <span>Back to Portal</span>
            </a>` : ''}
            <button type="button" id="sidebarUserMenuSignOut" class="sidebar-user-menu-item flex items-center gap-3 py-2 text-left w-full rounded-xl transition-colors text-red-400 hover:bg-gray-700 hover:text-red-300">
              <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
              <span>Sign Out</span>
            </button>
          </nav>
          <p id="app-version" class="px-4 pt-2 pb-4 text-xs text-gray-500 border-t border-gray-700 mt-1">${version}</p>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('[data-dismiss="sidebarUserMenuOverlay"]').addEventListener('click', () => overlay.classList.add('hidden'));
      overlay.querySelectorAll('.sidebar-user-menu-item').forEach(link => {
        link.addEventListener('click', () => overlay.classList.add('hidden'));
      });
      overlay.querySelector('#sidebarUserMenuSignOut').addEventListener('click', () => {
        overlay.classList.add('hidden');
        var resolveHref = this._resolveHref.bind(this);
        var doLogout = function () {
          if (window.api && typeof window.api.logout === 'function') {
            window.api.logout()
              .then(function () { window.location.href = resolveHref('/login.html'); })
              .catch(function () { window.location.href = resolveHref('/login.html'); });
          } else {
            window.location.href = resolveHref('/login.html');
          }
        };
        if (window.Lex && window.Lex.Modal && typeof window.Lex.Modal.confirm === 'function') {
          window.Lex.Modal.confirm(
            'Sign Out',
            'Are you sure you want to sign out? Any unsaved changes will be lost.',
            doLogout,
            { confirmText: 'Sign Out', variant: 'danger' }
          );
        } else {
          doLogout();
        }
      });
    }

    trigger.addEventListener('click', () => overlay.classList.remove('hidden'));
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
        link.className = `flex items-center gap-3 py-2 ${isActive ? this.activeItemClass : this.inactiveItemClass} rounded-lg transition-colors`;
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
    this.brandHref = options.brandHref || '/dashboard.html';
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
          <a href="${this.brandHref}"><img src="img/logo-light.png" alt="${this.brandName}" class="h-7"></a>
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
