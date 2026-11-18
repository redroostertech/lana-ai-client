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

  function canAccessAdminPages() {
    return hasRole('system_admin') || hasRole('org_admin');
  }

  // Whether this person may set or remove metric goals. The backend answers
  // (GET /api/v1/modules/metric-goals/permission) with the same rule its
  // requireAdminRole enforces on the goal writes, so the client holds no role
  // list of its own and the two cannot disagree. Until the answer arrives,
  // and on any failure, the Goal actions stay hidden.
  var goalPermission = null;
  var goalPermissionUser = null;
  var canEditGoals = false;

  function currentUserId() {
    var user = getUser();
    return user ? (user.id || user.user_id || null) : null;
  }

  function loadMetricGoalPermission() {
    var userId = currentUserId();
    if (goalPermission && goalPermissionUser === userId) return goalPermission;
    goalPermissionUser = userId;
    canEditGoals = false;
    if (!userId || typeof api === 'undefined' || !api || typeof api.get !== 'function') {
      goalPermission = Promise.resolve(false);
      return goalPermission;
    }
    goalPermission = Promise.resolve(api.get('/api/v1/modules/metric-goals/permission')).then(function (resp) {
      var body = resp && resp.data && typeof resp.data === 'object' ? resp.data : resp;
      canEditGoals = !!(body && body.can_edit_goals === true);
      return canEditGoals;
    }).catch(function () {
      goalPermission = null;
      canEditGoals = false;
      return false;
    });
    return goalPermission;
  }

  function canEditMetricGoals() {
    return canEditGoals && goalPermissionUser === currentUserId();
  }

  global.Lex.Auth = {
    get user() { return getUser(); },

    hasRole: hasRole,

    isSystemAdmin: function () { return hasRole('system_admin'); },

    isOrgAdmin: function () { return hasRole('org_admin') || hasRole('organization_admin'); },

    isAdmin: function () { return hasRole('system_admin') || hasRole('org_admin') || hasRole('organization_admin') || hasRole('admin'); },

    canAccessAdminPages: canAccessAdminPages,

    canEditMetricGoals: canEditMetricGoals,

    loadMetricGoalPermission: loadMetricGoalPermission,

    canViewSystemStatus: function () { return hasRole('system_admin') || hasRole('org_admin') || hasRole('organization_admin'); }
  };

})(window);
