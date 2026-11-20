/* Admin flow topbar switcher: the admin pages, through the shared
   TitleSwitcher (js/shared/title-switcher.js). */

(function () {
  'use strict';

  var ADMIN_PAGES = [
    {
      value: 'admin/index.html',
      label: 'Administration',
      description: 'Admin home and system management entry point'
    },
    {
      value: 'admin/users.html',
      label: 'User Management',
      description: 'Manage user accounts, roles, and access'
    },
    {
      value: 'admin/roles.html',
      label: 'Roles & Permissions',
      description: 'Configure roles and permission levels'
    },
    {
      value: 'admin/organizations.html',
      label: 'Organization Details',
      description: 'Review organization identity and account details'
    },
    {
      value: 'admin/task-plans.html',
      label: 'Task Plans',
      description: 'Create, review, and publish task/checklist plans'
    },
    {
      value: 'admin/run-books.html',
      label: 'Run Books',
      description: 'Package your organization\'s own processes as retrievable evidence',
      allowedRoles: ['system_admin', 'org_admin', 'organization_admin']
    },
    {
      value: 'admin/communications.html',
      label: 'Communications',
      description: 'Coming soon',
      allowedRoles: ['system_admin', 'org_admin', 'organization_admin']
    },
    {
      value: 'admin/sessions.html',
      label: 'Active Sessions',
      description: 'Monitor active user sessions and connections'
    },
    {
      value: 'admin/audit.html',
      label: 'Audit Logs',
      description: 'Review system activity and security events'
    },
    {
      value: 'admin/health.html',
      label: 'System Health',
      description: 'Monitor system status and performance'
    },
    {
      value: 'admin/updates.html',
      label: 'Software Updates',
      description: 'Review and apply backend and client app updates',
      allowedRoles: ['system_admin', 'org_admin', 'organization_admin']
    },
    {
      value: 'admin/custom-objects.html',
      label: 'Custom Objects',
      description: 'Define the records your firm keeps on matters, such as payments',
      allowedRoles: ['system_admin', 'org_admin', 'organization_admin']
    },
    {
      value: 'admin/run-controls.html',
      label: 'Run Controls',
      description: 'Pause automatic agent runs, set daily limits and see agent usage'
    },
    {
      value: 'admin/traces.html',
      label: 'Chat Traces',
      description: 'Debug and observe AI chat interactions'
    }
  ];

  function currentAdminPath() {
    var path = (window.history && window.history.state && window.history.state.path) ||
      window.location.pathname ||
      '';
    var match = path.match(/admin\/[^/?#]+\.html/);
    return match ? match[0] : '';
  }

  function shouldRender() {
    var current = currentAdminPath();
    if (current === 'admin/index.html') return false;
    return ADMIN_PAGES.some(function (page) { return page.value === current; });
  }

  function hasRole(roleName) {
    return !!(window.Lex && Lex.Auth && Lex.Auth.hasRole && Lex.Auth.hasRole(roleName));
  }

  // Task Plans, Run Books and Communications ship in 3.2.0
  // (LanaConfig.ADMIN_PLANS_RUNBOOKS_COMMS_ENABLED).
  var RELEASE_32_PAGES = ['admin/task-plans.html', 'admin/run-books.html', 'admin/communications.html'];

  function canViewPage(page) {
    if (RELEASE_32_PAGES.indexOf(page.value) !== -1 &&
        !(window.LanaConfig && window.LanaConfig.ADMIN_PLANS_RUNBOOKS_COMMS_ENABLED === true)) {
      return false;
    }
    if (!page.allowedRoles || page.allowedRoles.length === 0) return true;
    return page.allowedRoles.some(hasRole);
  }

  function navigate(value) {
    if (!value || value === currentAdminPath()) return;
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go(value);
      return;
    }
    window.location.href = '../' + value.replace(/^admin\//, 'admin/');
  }

  function render() {
    if (!shouldRender()) return false;
    if (!window.TitleSwitcher || !window.customElements || !customElements.get('lex-select')) return false;
    // The shared header title switcher (js/shared/title-switcher.js, css/title-switcher.css).
    return !!window.TitleSwitcher.render({
      id: 'adminFlowSwitcher',
      placeholder: 'Search admin pages...',
      options: ADMIN_PAGES.filter(canViewPage),
      value: currentAdminPath(),
      onPick: navigate
    });
  }

  function init() {
    var attempts = 0;
    function tryRender() {
      attempts += 1;
      if (render() || attempts > 30) return;
      window.setTimeout(tryRender, 50);
    }
    tryRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
