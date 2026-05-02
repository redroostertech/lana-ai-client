/* Lex UI — Router Page Descriptors
   Registry of all SPA-routed pages with their titles, nav identifiers,
   and page-specific scripts/stylesheets.

   Loaded before lex-router.js. Calls LexRouter.setPageDescriptors()
   once lex-router.js is ready.

   Standalone pages (dashboard, workspaces, settings-v2, admin/index,
   admin/users, admin/health, admin/organizations, admin/roles) have no
   descriptor — the router naturally ignores links to unknown pages,
   letting the browser do a full navigation.

   To add a new SPA page: add an entry to PAGE_DESCRIPTORS below.
   Scripts are loaded sequentially in order. Stylesheets are loaded in parallel.
*/

(function () {
  'use strict';

  // =========================================================================
  // Page Descriptors
  // Key: path relative to src/ (no leading slash)
  // =========================================================================

  var PAGE_DESCRIPTORS = {

    // ── Dashboard ── (standalone page — no descriptor needed)

    // ── Chat ──
    'chat.html': {
      title: 'Chat',
      activeNav: 'chat',
      scripts: [
        'js/chat-demo-responses.js',
        'js/file-drawer.js',
        'js/agentic-ui.js',
        'js/chat.js'
      ],
      stylesheets: []
    },

    // ── Workspaces ── (standalone page — no descriptor needed)

    // workspace-details.html — standalone page (not routed)

    'matters/timeline.html': {
      title: 'Matter Timeline',
      activeNav: 'workspaces',
      scripts: [],
      stylesheets: []
    },

    'matter-skills.html': {
      title: 'Matter Skills',
      activeNav: 'workspaces',
      scripts: [
        'js/matter-skills.js'
      ],
      stylesheets: [
        'css/matter-skills.css'
      ]
    },

    // ── My Drive (root matters list) ──
    'drive.html': {
      title: 'My Drive',
      activeNav: 'storage',
      scripts: [
        // Lex components not globally loaded
        'js/lex/components/foundation/lex-banner.js',
        'js/lex/components/foundation/lex-modal.js',
        'js/lex/components/form/lex-input.js',
        'js/lex/components/form/lex-select.js',
        // Page controller
        'js/drive.js'
      ],
      stylesheets: [
        'css/drive.css'
      ]
    },

    // ── Folder (inside a matter — files, subfolders) ──
    'folder.html': {
      title: 'Folder',
      activeNav: 'storage',
      scripts: [
        // Lex components not globally loaded
        'js/lex/components/foundation/lex-banner.js',
        'js/lex/components/foundation/lex-modal.js',
        'js/lex/components/form/lex-input.js',
        'js/lex/components/form/lex-select.js',
        'js/lex/components/form/lex-checkbox.js',
        'js/lex/components/form/lex-textarea.js',
        // Page controller
        'js/folder.js'
      ],
      stylesheets: [
        'css/drive.css'
      ]
    },

    // ── Settings ──
    'settings.html': {
      title: 'Settings',
      activeNav: 'settings',
      scripts: [],
      stylesheets: []
    },

    // ── Settings V2 ── (standalone page — no descriptor needed)

    // ── Help & Support ──
    'help.html': {
      title: 'Help & Support',
      activeNav: 'help',
      scripts: [
        'js/help.js'
      ],
      stylesheets: []
    },

    'faq.html': {
      title: 'FAQ',
      activeNav: 'help',
      scripts: [
        'js/faq.js'
      ],
      stylesheets: []
    },

    'article.html': {
      title: 'Article',
      activeNav: 'help',
      scripts: [
        'js/article.js'
      ],
      stylesheets: []
    },

    // ── Search ──
    // search-conversations.html — standalone page (not routed)

    'search-results.html': {
      title: 'Search Results',
      activeNav: '',
      scripts: [],
      stylesheets: []
    },

    // ── Skills ──
    // skills.html — standalone page (uses <lex-app> shell, not routed)

    // ── Admin ──
    // admin/index.html — standalone page (not routed)

    'admin/dashboard.html': {
      title: 'Admin Dashboard',
      activeNav: 'admin',
      scripts: [],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    // admin/users.html — standalone page (not routed)

    'admin/audit.html': {
      title: 'Audit Logs',
      activeNav: 'admin',
      scripts: [
        'js/utils/event-display-names.js'
      ],
      stylesheets: []
    },

    'admin/sessions.html': {
      title: 'Active Sessions',
      activeNav: 'admin',
      scripts: [],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    'admin/settings.html': {
      title: 'System Settings',
      activeNav: 'admin',
      scripts: [],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    // admin/health.html — standalone page (not routed)
    // admin/organizations.html — standalone page (not routed)
    // admin/roles.html — standalone page (not routed)

    'admin/roles_manager.html': {
      title: 'Role Manager',
      activeNav: 'admin',
      scripts: [],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    'admin/integrations.html': {
      title: 'Integrations',
      activeNav: 'admin',
      scripts: [
        'js/services/feature-tracker.js'
      ],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    'admin/reporting.html': {
      title: 'Analytics',
      activeNav: 'reports',
      scripts: [
        'js/vendor/chart.js',
        'js/vendor/jspdf.umd.min.js',
        'js/vendor/jspdf.plugin.autotable.min.js',
        'js/vendor/marked.min.js',
        'js/drilldown-renderer.js',
        'js/admin/reporting.js'
      ],
      stylesheets: [
        'insights/raw-data-viewer.css'
      ]
    },

    'admin/plugins.html': {
      title: 'Plugins',
      activeNav: 'admin',
      scripts: [],
      stylesheets: []
    },

    'admin/search-analytics.html': {
      title: 'Search Analytics',
      activeNav: 'admin',
      scripts: [
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
        'js/search-analytics.js'
      ],
      stylesheets: []
    },

    'admin/relevance-labeling.html': {
      title: 'Relevance Labeling',
      activeNav: 'admin',
      scripts: [
        'js/relevance-labeling.js'
      ],
      stylesheets: []
    },

    'admin/management-boards.html': {
      title: 'Management Boards',
      activeNav: 'admin',
      scripts: [
        'js/services/feature-tracker.js',
        'js/services/management-board-service.js',
        'js/components/management-board-components.js',
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
        'js/services/session-tracking-service.js',
        'js/pages/management-boards-team-performance.js',
        'js/pages/management-boards-main.js'
      ],
      stylesheets: [
        'css/session-tracking.css',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    'admin/onboarding_management.html': {
      title: 'Onboarding Management',
      activeNav: 'admin',
      scripts: [],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    // ── Insights ──
    'insights/module-execution.html': {
      title: 'Analytics',
      activeNav: 'reports',
      scripts: [
        'js/vendor/chart.js',
        'js/vendor/jspdf.umd.min.js',
        'js/vendor/jspdf.plugin.autotable.min.js',
        'js/vendor/marked.min.js',
        'js/drilldown-renderer.js',
        'insights/raw-data-viewer.js'
      ],
      stylesheets: [
        'insights/raw-data-viewer.css'
      ]
    },

    'insights/dashboard.html': {
      title: 'Module Execution Dashboard',
      activeNav: 'reports',
      scripts: [
        'js/vendor/chart.js',
        'js/vendor/jspdf.umd.min.js',
        'js/vendor/jspdf.plugin.autotable.min.js'
      ],
      stylesheets: []
    },

    'insights/predictions.html': {
      title: 'AI Predictions',
      activeNav: 'reports',
      scripts: [
        'js/insights.js'
      ],
      stylesheets: []
    },

    // ── Integrations ──
    // data-connectors.html — standalone page (not routed)

    'integrations/connector-viewer.html': {
      title: 'Connector',
      activeNav: 'connectors',
      scripts: [
        'js/utils/event-display-names.js',
        'js/services/feature-tracker.js',
        'js/activity-heatmap.js',
        'js/services/session-tracking-service.js'
      ],
      stylesheets: [
        'css/session-tracking.css'
      ]
    },

    'integrations/connector-crm.html': {
      title: 'CRM Connectors',
      activeNav: 'connectors',
      scripts: [
        'js/connectors.js'
      ],
      stylesheets: []
    },

    'integrations/connector-documents.html': {
      title: 'Documents & Storage Connectors',
      activeNav: 'connectors',
      scripts: [],
      stylesheets: []
    },

    'integrations/connector-communications.html': {
      title: 'Communications Connectors',
      activeNav: 'connectors',
      scripts: [
        'js/connectors.js'
      ],
      stylesheets: []
    },

    'integrations/connector-financial.html': {
      title: 'Financial Connectors',
      activeNav: 'connectors',
      scripts: [],
      stylesheets: []
    },

    'integrations/connector-case.html': {
      title: 'Case Management Connectors',
      activeNav: 'connectors',
      scripts: [
        'js/connectors.js'
      ],
      stylesheets: []
    },

    'integrations/sync-status.html': {
      title: 'Sync Status',
      activeNav: 'connectors',
      scripts: [
        'js/connectors.js'
      ],
      stylesheets: []
    },

    'integrations/actionstep.html': {
      title: 'ActionStep Dashboard',
      activeNav: 'connectors',
      scripts: [
        'js/chunked-uploader.js'
      ],
      stylesheets: []
    },

    'integrations/leadly.html': {
      title: 'Leadly CRM Dashboard',
      activeNav: 'connectors',
      scripts: [
        'js/chunked-uploader.js'
      ],
      stylesheets: []
    },

    // ── Workflows ──
    'workflows/dashboard.html': {
      title: 'Workflows',
      activeNav: 'workflows',
      scripts: [
        'js/workflows.js'
      ],
      stylesheets: []
    },

    'workflows/builder.html': {
      title: 'Workflow Builder',
      activeNav: 'workflows',
      scripts: [
        'js/services/feature-tracker.js',
        'js/workflows.js',
        'js/workflow-builder.js',
        'https://cdn.jsdelivr.net/npm/drawflow@0.0.60/dist/drawflow.min.js'
      ],
      stylesheets: [
        'https://cdn.jsdelivr.net/npm/drawflow@0.0.60/dist/drawflow.min.css'
      ]
    },

    'workflows/templates.html': {
      title: 'Workflow Templates',
      activeNav: 'workflows',
      scripts: [
        'js/workflows.js'
      ],
      stylesheets: []
    },

    'workflows/active.html': {
      title: 'Active Workflows',
      activeNav: 'workflows',
      scripts: [
        'js/workflows.js'
      ],
      stylesheets: []
    },

    'workflows/execution-logs.html': {
      title: 'Execution Logs',
      activeNav: 'workflows',
      scripts: [
        'js/workflows.js'
      ],
      stylesheets: []
    },

    'workflows/document-generation.html': {
      title: 'Document Generation',
      activeNav: 'workflows',
      scripts: [
        'js/document-templates-api.js',
        'js/workflows.js',
        'js/tiptap-bundle-built.js',
        'js/chat.js',
        'js/document-chat.js',
        'js/document-actions.js'
      ],
      stylesheets: []
    },

    'workflows/follow-up-cadences.html': {
      title: 'Follow-up Cadences',
      activeNav: 'workflows',
      scripts: [
        'js/workflows.js'
      ],
      stylesheets: []
    },

    'workflows/retargeting.html': {
      title: 'Retargeting',
      activeNav: 'workflows',
      scripts: [
        'js/workflows.js'
      ],
      stylesheets: []
    },

    // ── Chat sub-pages ──
    'chat/index.html': {
      title: 'Chat',
      activeNav: 'chat',
      scripts: [
        'js/chat-demo-responses.js',
        'js/file-drawer.js',
        'js/agentic-ui.js',
        'js/chat.js'
      ],
      stylesheets: []
    },

    'chat/demo.html': {
      title: 'Chat Demo',
      activeNav: 'chat',
      scripts: [
        'js/chat-demo-responses.js',
        'js/chat.js'
      ],
      stylesheets: []
    },

    // chat-v2.html — standalone page (not routed)

    // ── Lex UI demo pages ──
    'lex-test.html': {
      title: 'Lex UI - Component Library',
      activeNav: 'lex-ui',
      scripts: [],
      stylesheets: [
        'css/lex-chat.css'
      ]
    },

    'lex-intent.html': {
      title: 'Lex UI - Intent Demo',
      activeNav: 'lex-ui',
      scripts: [],
      stylesheets: [
        'css/lex-chat.css'
      ]
    },

    // ── Docs ──
    'docs/api-documentation.html': {
      title: 'API Documentation',
      activeNav: '',
      scripts: [],
      stylesheets: []
    }
  };

  // =========================================================================
  // Wire into router (lex-router.js loads after this file)
  // =========================================================================

  // Store on window.Lex for immediate access by lex-router.js
  window.Lex = window.Lex || {};
  window.Lex._pageDescriptors = PAGE_DESCRIPTORS;

  // If router is already loaded, set immediately
  if (window.LexRouter) {
    window.LexRouter.setPageDescriptors(PAGE_DESCRIPTORS);
  } else {
    // Router not loaded yet — defer until it's ready
    // lex-router.js will check window.Lex._pageDescriptors on init
    document.addEventListener('DOMContentLoaded', function () {
      if (window.LexRouter) {
        window.LexRouter.setPageDescriptors(PAGE_DESCRIPTORS);
      }
    });
  }

})();
