/**
 * Normalize the admin-users API response for the page controller.
 *
 * The API returns pagination metadata in a nested `pagination` object. Using
 * only the current page's array length incorrectly collapses multi-page lists
 * into a single page.
 */
(function (root, factory) {
  'use strict';

  var api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.AdminUsersPagination = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function firstNonNegativeNumber(values, fallback) {
    for (var i = 0; i < values.length; i += 1) {
      var number = Number(values[i]);
      if (Number.isFinite(number) && number >= 0) {
        return number;
      }
    }
    return fallback;
  }

  function normalizeAdminUsersResponse(result) {
    if (Array.isArray(result)) {
      return { users: result, total: result.length };
    }

    var users = [];
    if (result && Array.isArray(result.users)) {
      users = result.users;
    } else if (result && Array.isArray(result.data)) {
      users = result.data;
    }

    var pagination = result && result.pagination ? result.pagination : {};
    var total = firstNonNegativeNumber([
      pagination.total_count,
      pagination.total,
      result && result.total,
      result && result.count
    ], users.length);

    return { users: users, total: total };
  }

  return {
    normalizeAdminUsersResponse: normalizeAdminUsersResponse
  };
});
