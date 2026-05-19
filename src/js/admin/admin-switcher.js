/* Admin flow topbar switcher. */

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

    var heading = document.querySelector('lex-topbar .lex-topbar-heading');
    var wrapper = document.querySelector('lex-topbar .admin-flow-switcher');
    if (!wrapper && !heading) return false;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'admin-flow-switcher';
      heading.replaceWith(wrapper);
    }

    if (!window.customElements || !customElements.get('lex-select')) return false;

    wrapper.innerHTML = '<lex-select id="adminFlowSwitcher" name="adminFlowSwitcher" placeholder="Search admin pages..." searchable></lex-select>';
    var select = wrapper.querySelector('lex-select');
    if (!select) return true;

    select.options = ADMIN_PAGES;
    select.value = currentAdminPath();
    select.addEventListener('lex-change', function (event) {
      var value = event.detail && event.detail.value;
      navigate(value);
    });

    return true;
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
