/* Lex UI — Router Page Descriptors
   Registry of all navigable pages with their titles, nav identifiers,
   and page-specific scripts/stylesheets.

   Loaded before lex-router.js. Calls LexRouter.setPageDescriptors()
   and LexRouter.setFullReloadPages() once lex-router.js is ready.

   To add a new page: add an entry to PAGE_DESCRIPTORS below.
   Scripts are loaded sequentially in order. Stylesheets are loaded in parallel.
*/

(function () {
  'use strict';

  // =========================================================================
  // Pages that require a full browser reload (no shell, no routing)
  // =========================================================================

  var FULL_RELOAD_PAGES = [
    'login.html',
    'activate.html',
    'password-reset.html',
    'password-reset-request.html',
    'error.html',
    'auth_error.html',
    'logged_out.html',
    'session_expired.html',
    'onboarding.html',
    'demo.html',
    'update-dialog.html',
    'blank.html',
    'app.html',
    'index.html',
    'matters.html',
    'storage.html',
    'connectors.html'
  ];

  // =========================================================================
  // Page Descriptors
  // Key: path relative to src/ (no leading slash)
  // =========================================================================

  var PAGE_DESCRIPTORS = {

    // ── Dashboard ──
    'dashboard.html': {
      title: 'Dashboard',
      activeNav: 'dashboard',
      scripts: [
        // Additional Lex components used only by the dashboard
        'js/lex/components/foundation/lex-banner.js',
        'js/lex/components/foundation/lex-metric.js',
        'js/lex/components/foundation/lex-action-card.js',
        'js/lex/components/foundation/lex-badge.js',
        'js/lex/components/foundation/lex-stack.js',
        'js/lex/components/foundation/lex-text.js',
        'js/lex/components/foundation/lex-modal.js',
        'js/lex/components/foundation/lex-drawer.js',
        'js/lex/components/foundation/lex-card.js',
        'js/lex/components/foundation/lex-divider.js',
        'js/lex/components/form/lex-select.js',
        'js/utils/event-display-names.js',
        'js/services/feature-tracker.js',
        'js/activity.js',
        'js/activity-heatmap.js',
        'js/vendor/chart.js',
        'js/dashboard/widget-renderer.js',
        'js/dashboard/widget-config-modal.js',
        'js/dashboard/widgets/metric-card.widget.js',
        'js/dashboard/widgets/data-table.widget.js',
        'js/dashboard/widgets/chart.widget.js',
        'js/dashboard/widgets/activity-feed.widget.js',
        'js/dashboard/widgets/matter-summary.widget.js',
        'js/dashboard/widgets/connector-status.widget.js',
        'js/dashboard/widgets/module-metric.widget.js',
        'js/dashboard/widgets/alert-list.widget.js',
        'js/services/session-tracking-service.js',
        'js/dashboard/dashboard.js'
      ],
      stylesheets: [
        'css/session-tracking.css',
        'css/dashboard-command-center.css'
      ]
    },

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

    // ── Workspaces ──
    'workspaces.html': {
      title: 'Workspaces',
      activeNav: 'workspaces',
      scripts: [
        'js/services/feature-tracker.js',
        'js/vendor/mammoth.min.js',
        'js/conflict-detection.js',
        'js/similar-matters-widget.js',
        'js/analytics.js',
        'js/utils/metadata-formatter.js',
        'js/services/metadata-service.js',
        'js/vendor/marked.min.js',
        'js/components/document-metadata-viewer.js',
        'js/tiptap-bundle-built.js',
        'js/api/matter-notes-api.client.js',
        'js/components/note-list.component.js',
        'js/components/note-editor.component.js',
        'js/matter-notes.js',
        'js/matter-skills.js',
        'https://cdn.jsdelivr.net/npm/drawflow@0.0.60/dist/drawflow.min.js',
        'js/workflow-builder.js',
        'js/workspace.js'
      ],
      stylesheets: [
        'css/components/document-metadata.css',
        'css/matter-notes.css',
        'https://cdn.jsdelivr.net/npm/drawflow@0.0.60/dist/drawflow.min.css'
      ]
    },

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

    // ── My Drive ──
    'drive.html': {
      title: 'My Drive',
      activeNav: 'storage',
      scripts: [
        'js/vendor/mammoth.min.js',
        'js/utils/metadata-formatter.js',
        'js/services/metadata-service.js',
        'js/vendor/marked.min.js',
        'js/components/document-metadata-viewer.js',
        'js/file-viewer.js',
        'js/drive.js'
      ],
      stylesheets: [
        'css/components/document-metadata.css',
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
    'search-results.html': {
      title: 'Search Results',
      activeNav: '',
      scripts: [],
      stylesheets: []
    },

    // ── Skills ──
    'skills-marketplace.html': {
      title: 'Skills Marketplace',
      activeNav: '',
      scripts: [
        'js/skills-marketplace.js'
      ],
      stylesheets: [
        'css/skills-marketplace.css'
      ]
    },

    // ── Admin ──
    'admin/index.html': {
      title: 'Administration',
      activeNav: 'admin',
      scripts: [],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    'admin/dashboard.html': {
      title: 'Admin Dashboard',
      activeNav: 'admin',
      scripts: [],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
      ]
    },

    'admin/users.html': {
      title: 'User Management',
      activeNav: 'admin',
      scripts: [],
      stylesheets: []
    },

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

    'admin/health.html': {
      title: 'System Health',
      activeNav: 'admin',
      scripts: [
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
      ],
      stylesheets: []
    },

    'admin/organizations.html': {
      title: 'Organization Details',
      activeNav: 'admin',
      scripts: [],
      stylesheets: []
    },

    'admin/roles.html': {
      title: 'Roles & Permissions',
      activeNav: 'admin',
      scripts: [],
      stylesheets: []
    },

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
      title: 'Reporting',
      activeNav: 'admin',
      scripts: [
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
      ],
      stylesheets: [
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
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
      title: 'Reports',
      activeNav: 'reports',
      scripts: [
        'js/vendor/chart.js',
        'js/vendor/jspdf.umd.min.js',
        'js/vendor/jspdf.plugin.autotable.min.js',
        'js/vendor/marked.min.js',
        'js/drilldown-renderer.js',
        'raw-data-viewer.js'
      ],
      stylesheets: [
        'raw-data-viewer.css'
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
    'integrations/data_connectors.html': {
      title: 'Data Connectors',
      activeNav: 'connectors',
      scripts: [
        'js/connectors.js',
        'js/data_connectors.js'
      ],
      stylesheets: []
    },

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

    'integrations/integration-config.html': {
      title: 'Integration Configuration',
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
  window.Lex._fullReloadPages = FULL_RELOAD_PAGES;

  // If router is already loaded, set immediately
  if (window.LexRouter) {
    window.LexRouter.setPageDescriptors(PAGE_DESCRIPTORS);
    window.LexRouter.setFullReloadPages(FULL_RELOAD_PAGES);
  } else {
    // Router not loaded yet — defer until it's ready
    // lex-router.js will check window.Lex._pageDescriptors on init
    document.addEventListener('DOMContentLoaded', function () {
      if (window.LexRouter) {
        window.LexRouter.setPageDescriptors(PAGE_DESCRIPTORS);
        window.LexRouter.setFullReloadPages(FULL_RELOAD_PAGES);
      }
    });
  }

})();
