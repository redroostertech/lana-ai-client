/**
 * Insights breadcrumbs (pure, no DOM): each page's trail reflects the real
 * path, and every crumb but the last links to its page. The page's Back
 * button goes to the parent crumb (backHref). No regex (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.InsightsBreadcrumbs = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var INSIGHTS = { label: 'Insights', href: 'admin/analytics.html' };
  var ALL_DASHBOARDS = { label: 'All dashboards', href: 'admin/dashboard-library.html' };
  var ORIGINS = {
    catalog: { label: 'Metric Catalog', href: 'admin/metric-catalog.html' },
    report: { label: 'Reports', href: 'admin/reports-list.html' },
  };

  function dashboardHref(id, start, end) {
    var parts = ['id=' + encodeURIComponent(id)];
    if (start) parts.push('periodStart=' + encodeURIComponent(start));
    if (end) parts.push('periodEnd=' + encodeURIComponent(end));
    return 'admin/dashboard-detail.html?' + parts.join('&');
  }

  /** opts: { from, dashboardId, dashboardName, periodStart, periodEnd, metricTitle } */
  function metricDetail(opts) {
    var o = opts || {};
    var leaf = { label: o.metricTitle || 'Metric' };
    if (o.from === 'dashboard' && o.dashboardId) {
      return [ALL_DASHBOARDS, { label: o.dashboardName || 'Dashboard', href: dashboardHref(o.dashboardId, o.periodStart, o.periodEnd) }, leaf];
    }
    if (ORIGINS[o.from]) return [ORIGINS[o.from], leaf];
    return [INSIGHTS, leaf];
  }

  /** opts: { name, standard } (standard: a built-in view, not a saved dashboard) */
  function dashboardDetail(opts) {
    var o = opts || {};
    return [o.standard ? INSIGHTS : ALL_DASHBOARDS, { label: o.name || 'Dashboard' }];
  }

  function dashboardLibrary() {
    return [INSIGHTS, { label: 'All dashboards' }];
  }

  function backHref(items) {
    var list = Array.isArray(items) ? items : [];
    return list.length > 1 ? list[list.length - 2].href || '' : '';
  }

  return { metricDetail: metricDetail, dashboardDetail: dashboardDetail, dashboardLibrary: dashboardLibrary, backHref: backHref };
});
