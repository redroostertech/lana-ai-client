/* Dashboard tiles: a dashboard's tiles are catalog metric keys in
   layout.metric_keys (the existing BI dashboard model). Shared by Reports
   ("Add to dashboard" on a result, appended by the server) and the dashboard
   page (which reads its tiles by key). Pure, apart from the injected api. */

(function (global) {
  'use strict';

  function unwrap(response) {
    return response && response.data ? response.data : response;
  }

  // The server appends the key in one operation (write access and catalog
  // key checked there), so concurrent adds never overwrite each other.
  async function addTileToDashboard(api, dashboardId, metricKey) {
    var result = unwrap(await api.addBIDashboardTile(dashboardId, metricKey)) || {};
    return { added: !!result.added, name: (result.dashboard && result.dashboard.name) || '' };
  }

  // The metric_keys query value for a dashboard's own tiles, or null when the
  // dashboard has none (it then shows its type's standard cards).
  function cardRequestKeys(layout) {
    var keys = layout && Array.isArray(layout.metric_keys) ? layout.metric_keys.filter(Boolean) : [];
    return keys.length ? keys.join(',') : null;
  }

  global.DashboardTiles = { addTileToDashboard: addTileToDashboard, cardRequestKeys: cardRequestKeys };
})(window);
