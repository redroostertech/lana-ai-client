/* Analytics Index — Page controller for admin/analytics.html.
   Hub page linking to Firm Reporting, Workspace Analytics,
   Data Visualization, and Predictions. Wires action-click
   navigation on lex-action-card elements via event delegation.

   Pattern: IIFE + direct init() call.
*/

(function () {
  'use strict';

  var OPTIONAL_DASHBOARD_TIMEOUT_MS = 3500;

  // ── Helpers ────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value == null ? '-' : String(value);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dashboards() {
    return Array.isArray(window.LanaInsightsDashboards) ? window.LanaInsightsDashboards : [];
  }

  function optionalRequestOptions(timeoutMs) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return { signal: AbortSignal.timeout(timeoutMs) };
    }
    if (typeof AbortController === 'undefined') return {};
    var controller = new AbortController();
    setTimeout(function () { controller.abort(); }, timeoutMs);
    return { signal: controller.signal };
  }

  function normalizeDashboardRecord(record, index) {
    var layout = record.layout || {};
    var type = layout.dashboard_type || record.key || 'owner';
    var id = record.id || record.key;
    return {
      key: id,
      name: record.name,
      description: record.description,
      audience: layout.dashboard_type ? layout.dashboard_type : record.audience,
      category: layout.category || record.category || 'Dashboard',
      scope: record.scope || 'Organization-wide',
      visibility: layout.visibility_label || record.visibility || 'Resource shares',
      state: record.state || 'Active',
      tags: layout.category || record.tags || record.category,
      href: record.id ? 'admin/dashboard-detail.html?id=' + encodeURIComponent(record.id) : (record.href || 'admin/dashboard-detail.html?type=' + encodeURIComponent(type)),
      usageRank: record.usageRank || index + 1,
      recentRank: record.recentRank || index + 1,
    };
  }

  async function loadDashboards() {
    if (!window.api || typeof window.api.listBIDashboards !== 'function') {
      return dashboards();
    }

    try {
      var response = await window.api.listBIDashboards(
        { limit: 50, sort: 'updated_at', order: 'desc' },
        optionalRequestOptions(OPTIONAL_DASHBOARD_TIMEOUT_MS)
      );
      var rows = response && Array.isArray(response.data) ? response.data : [];
      if (!rows.length) return dashboards();
      return rows.map(normalizeDashboardRecord);
    } catch (err) {
      console.warn('[AnalyticsIndex] Could not load BI dashboards:', err.message);
      return dashboards();
    }
  }

  async function loadSharedDashboards() {
    if (!window.api || typeof window.api.listBIDashboards !== 'function') {
      return [];
    }

    try {
      var response = await window.api.listBIDashboards(
        {
          sharedWithMe: true,
          limit: 6,
          sort: 'updated_at',
          order: 'desc',
        },
        optionalRequestOptions(OPTIONAL_DASHBOARD_TIMEOUT_MS)
      );
      var rows = response && Array.isArray(response.data) ? response.data : [];
      return rows.map(normalizeDashboardRecord);
    } catch (err) {
      console.warn('[AnalyticsIndex] Could not load shared BI dashboards:', err.message);
      return [];
    }
  }

  function onActionClick(e) {
    var card = e.target.closest('lex-action-card');
    var href = card && card.dataset && card.dataset.href;
    if (href) {
      Lex.Nav.go(href);
    }
  }

  function onDashboardCardClick(e) {
    if (e.target.closest('#createDashboardBtn')) {
      Lex.Nav.go('admin/dashboard-builder.html');
      return;
    }

    var card = e.target.closest('[data-dashboard-href]');
    var href = card && card.dataset && card.dataset.dashboardHref;
    if (href) {
      Lex.Nav.go(href);
    }
  }

  function renderDashboardCard(item, meta) {
    return ''
      + '<article class="insights-dashboard-card" data-dashboard-href="' + escapeHtml(item.href) + '">'
      + '<div>'
      + '<div class="insights-dashboard-card__eyebrow">' + escapeHtml(meta) + '</div>'
      + '<div class="insights-dashboard-card__title">' + escapeHtml(item.name) + '</div>'
      + '<div class="insights-dashboard-card__description">' + escapeHtml(item.description) + '</div>'
      + '</div>'
      + '<div class="insights-dashboard-card__meta">'
      + '<span>' + escapeHtml(item.tags || item.category) + '</span>'
      + '<span>' + escapeHtml(item.visibility) + '</span>'
      + '</div>'
      + '</article>';
  }

  function renderDashboardLoadingCards(containerId, count) {
    var container = el(containerId);
    if (!container) return;
    var html = '';
    for (var i = 0; i < count; i += 1) {
      html += ''
        + '<article class="insights-dashboard-card insights-dashboard-card--loading" aria-hidden="true">'
        + '<span class="insights-dashboard-skeleton insights-dashboard-skeleton--eyebrow"></span>'
        + '<span class="insights-dashboard-skeleton insights-dashboard-skeleton--title"></span>'
        + '<span class="insights-dashboard-skeleton insights-dashboard-skeleton--description"></span>'
        + '<span class="insights-dashboard-skeleton insights-dashboard-skeleton--description-short"></span>'
        + '<div class="insights-dashboard-card__meta">'
        + '<span class="insights-dashboard-skeleton insights-dashboard-skeleton--pill"></span>'
        + '<span class="insights-dashboard-skeleton insights-dashboard-skeleton--pill"></span>'
        + '</div>'
        + '</article>';
    }
    container.innerHTML = html;
  }

  function renderDashboardCollection(containerId, sortKey, limit, metaPrefix, sourceDashboards) {
    var container = el(containerId);
    if (!container) return;

    var cards = sourceDashboards
      .slice()
      .sort(function (a, b) {
        return (a[sortKey] || 999) - (b[sortKey] || 999);
      })
      .slice(0, limit);

    if (!cards.length) {
      container.innerHTML = '<div class="insights-empty-row">No dashboards to show.</div>';
      return;
    }

    container.innerHTML = cards.map(function (item) {
      return renderDashboardCard(item, metaPrefix);
    }).join('');
  }

  async function renderDashboardShortcuts() {
    var fallbackDashboards = dashboards();
    renderDashboardCollection('mostUsedDashboards', 'usageRank', 3, 'Most used', fallbackDashboards);
    renderDashboardCollection('recentDashboards', 'recentRank', 3, 'Recently used', fallbackDashboards);
    renderDashboardLoadingCards('sharedDashboards', 3);

    var results = await Promise.all([
      loadDashboards(),
      loadSharedDashboards()
    ]);
    var sourceDashboards = results[0];
    var sharedDashboards = results[1];
    renderDashboardCollection('mostUsedDashboards', 'usageRank', 3, 'Most used', sourceDashboards);
    renderDashboardCollection('recentDashboards', 'recentRank', 3, 'Recently used', sourceDashboards);
    renderDashboardCollection('sharedDashboards', 'recentRank', 6, 'Shared with me', sharedDashboards);
  }

  function normalizeCatalogResponse(response) {
    var payload = response || {};
    var summary = payload.summary || (payload.data && payload.data.summary) || {};
    var pagination = payload.pagination || (payload.data && payload.data.pagination) || {};
    var rows = Array.isArray(payload.data) ? payload.data : [];

    return {
      total: summary.total || pagination.total || rows.length || 0,
      executable: summary.executableCatalogMetrics || 0,
      planned: summary.plannedCatalogMetrics || 0,
      registryKeys: summary.executableRegistryKeys || 0,
    };
  }

  async function loadMetricCatalogSummary() {
    if (!window.api || typeof window.api.getMetricCatalog !== 'function') return;

    try {
      var response = await window.api.getMetricCatalog({ limit: 1 });
      var summary = normalizeCatalogResponse(response);
      setText('metricCatalogTotal', summary.total);
      setText('metricCatalogExecutable', summary.executable);
      setText('metricCatalogPlanned', summary.planned);
      setText('metricRegistryKeys', summary.registryKeys);
    } catch (err) {
      console.warn('[AnalyticsIndex] Could not load metric catalog summary:', err.message);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Admin gate: matches admin-index / workspace-analytics. Non-admins should
    // never boot the analytics hub or trigger its dashboard API calls.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    content.addEventListener('action-click', onActionClick);
    content.addEventListener('click', onDashboardCardClick);
    renderDashboardShortcuts();
    // Catalog summary cards were removed from the page; skip the API call.
  }

  // ── Boot ───────────────────────────────────────────────────────────

  init();

})();
