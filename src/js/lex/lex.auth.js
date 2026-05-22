/* Lex.Auth — role and permission helpers (Category A: stateless singleton).
   Reads from api.user on each call — no cached state, no race conditions.
   Loaded once in the SPA shell after api.js. */

(function (global) {
  'use strict';

  global.Lex = global.Lex || {};

  function getUser() {
    return (typeof api !== 'undefined' && api.user) ? api.user : null;
  }

  function hasRole(roleName) {
    var user = getUser();
    if (!user) return false;
    var roles = user.roles || user.role_names || [];
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      if (r === roleName) return true;
      if (r && r.name === roleName) return true;
    }
    if (user.role_name === roleName || user.role === roleName) return true;
    return false;
  }

  global.Lex.Auth = {
    get user() { return getUser(); },

    hasRole: hasRole,

    isSystemAdmin: function () { return hasRole('system_admin'); },

    isOrgAdmin: function () { return hasRole('org_admin') || hasRole('organization_admin'); },

    isAdmin: function () { return hasRole('system_admin') || hasRole('org_admin') || hasRole('organization_admin') || hasRole('admin'); },

    canViewSystemStatus: function () { return hasRole('system_admin') || hasRole('org_admin') || hasRole('organization_admin'); }
  };

})(window);
