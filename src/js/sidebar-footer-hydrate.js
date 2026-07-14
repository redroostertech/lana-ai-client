/* Sidebar Footer Hydration — shared helper for sub-app pages.

   Mirrors the user-block + version + canonical user menu that <lex-app>
   renders on host pages, without dictating the primary nav. Each app sets
   its own `sidebar.sections`; this helper only owns the footer concerns
   (userName, userInitials, userEmail, userRole, version, userMenuItems).

   Usage from a sub-app (voice/, automation/, future business-intelligence/):

     LanaSidebarFooter.hydrate(document.getElementById('app-sidebar'), {
       pathPrefix: '../'   // for pages in subdirectories of src/
     });

   Sign Out stays as `action: 'signout'` so the local app's
   sidebar-user-action handler owns the logout sequence (clear token, stop
   timers, redirect). All other items are href-based and route to host
   pages so "Settings", "Help", etc. mean the same thing everywhere. */

(function () {
  'use strict';

  var ADMIN_ROLE_NAMES = ['system_admin', 'org_admin', 'organization_admin', 'admin'];

  function readUser() {
    if (window.Lex && window.Lex.state && window.Lex.state.user) {
      return window.Lex.state.user;
    }
    try {
      var raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('user') : null;
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_e) { /* ignore */ }
    return null;
  }

  function deriveHandle(user) {
    if (user.username) return '@' + user.username;
    if (user.email && user.email.indexOf('@') > 0) {
      return '@' + user.email.split('@')[0];
    }
    return user.email || '';
  }

  function deriveDisplay(user) {
    if (!user) return { firstName: 'User', initials: 'U', emailHandle: '', role: '' };
    var first = user.firstName || user.first_name || '';
    var last = user.lastName || user.last_name || '';
    var fullName = (first + ' ' + last).trim() || user.email || 'User';
    var firstName = first || fullName.split(' ')[0] || 'User';
    var initials = ((first[0] || '') + (last[0] || ''))
      || (user.email ? user.email[0].toUpperCase() : 'U');
    var role = user.role_name || user.role || '';
    return { firstName: firstName, initials: initials, emailHandle: deriveHandle(user), role: role };
  }

  function userIsAdmin(user) {
    if (!user) return false;
    var rolesField = user.roles || user.role_names || [];
    var primary = user.role_name || user.role || '';
    var allRoles = new Set();
    rolesField.forEach(function (r) {
      var name = (typeof r === 'string') ? r : (r && r.name) || '';
      if (name) allRoles.add(name.toLowerCase());
    });
    if (primary) allRoles.add(String(primary).toLowerCase());
    return ADMIN_ROLE_NAMES.some(function (r) { return allRoles.has(r); });
  }

  function buildUserMenu(prefix, isAdmin) {
    var items = [];
    if (isAdmin) {
      items.push({ id: 'admin', label: 'Administration', icon: 'users', href: prefix + 'admin/index.html' });
    }
    items.push({ id: 'connectors', label: 'Data Connectors', icon: 'plug', href: prefix + 'data-connectors.html' });
    items.push({ id: 'billing', label: 'Plan and billing', icon: 'credit-card', href: prefix + 'settings-v2.html#billing' });
    items.push({ id: 'personalization', label: 'Personalization', icon: 'sparkles', href: prefix + 'settings-v2.html#personalization' });
    items.push({ id: 'profile', label: 'Profile', icon: 'user', href: prefix + 'settings-v2.html#profile' });
    items.push({ id: 'settings', label: 'Settings', icon: 'settings', href: prefix + 'settings-v2.html' });
    items.push({ id: 'help', label: 'Help & Support', icon: 'help-circle', href: prefix + 'help.html' });
    items.push({ id: 'signout', label: 'Sign Out', icon: 'log-out', action: 'signout', danger: true });
    return items;
  }

  function applyVersion(sidebar) {
    if (window.APP_VERSION && typeof window.APP_VERSION.getVersion === 'function') {
      sidebar.version = window.APP_VERSION.getVersion();
      return;
    }
    if (window.electronAPI && typeof window.electronAPI.getVersion === 'function') {
      window.electronAPI.getVersion().then(function (v) {
        sidebar.version = String(v);
      }).catch(function () { /* leave version unset */ });
    }
  }

  function hydrate(sidebar, options) {
    if (!sidebar) return;
    options = options || {};
    var prefix = (typeof options.pathPrefix === 'string') ? options.pathPrefix : '';

    // Caller may pass an enriched user (e.g. automation's state.userProfile,
    // which has been hydrated via /api/users/me/profile and includes
    // role_name + username). Falls back to Lex.state.user → localStorage.user.
    var user = options.user || readUser();
    var display = deriveDisplay(user);

    sidebar.userName = display.firstName;
    sidebar.userInitials = display.initials;
    sidebar.userEmail = display.emailHandle;
    sidebar.userRole = display.role;
    applyVersion(sidebar);

    sidebar.userMenuItems = buildUserMenu(prefix, userIsAdmin(user));
  }

  window.LanaSidebarFooter = { hydrate: hydrate };
})();
