/* Dashboard Library — searchable catalog of completed LanaInsights dashboards. */

(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

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

  function normalizeDashboardRecord(record, index) {
    var layout = record.layout || {};
    var type = layout.dashboard_type || record.key || 'owner';
    return {
      key: record.id || record.key,
      id: record.id || null,
      name: record.name,
      description: record.description,
      audience: layout.dashboard_type || record.audience || 'Configurable',
      category: layout.category || record.category || 'Dashboard',
      scope: record.scope || 'Organization-wide',
      visibility: layout.visibility_label || record.visibility || 'Resource shares',
      state: record.state || 'Active',
      actions: record.id ? 'Actions' : '',
      tags: record.tags || layout.category || '',
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
      var response = await api.listBIDashboards({ limit: 100, sort: 'name', order: 'asc' });
      var rows = response && Array.isArray(response.data) ? response.data : [];
      if (!rows.length) return dashboards();
      return rows.map(normalizeDashboardRecord);
    } catch (err) {
      console.warn('[DashboardLibrary] Could not load BI dashboards:', err.message);
      return dashboards();
    }
  }

  function renderActions(item) {
    return item && item.id
        ? '<div class="insights-action-menu">'
          + '<button class="insights-action-menu__trigger" type="button" aria-label="Dashboard actions" data-dashboard-actions="' + escapeHtml(item.id) + '">&hellip;</button>'
          + '<div class="insights-action-menu__panel" data-dashboard-actions-panel="' + escapeHtml(item.id) + '" hidden>'
          + '<button type="button" data-dashboard-edit="' + escapeHtml(item.id) + '">Edit</button>'
          + '<button type="button" class="is-danger" data-dashboard-delete="' + escapeHtml(item.id) + '" data-dashboard-name="' + escapeHtml(item.name) + '">Delete</button>'
          + '</div>'
          + '</div>'
        : '';
  }

  function renderDashboardLibrary(sourceDashboards) {
    var table = el('dashboardLibraryTable');
    if (!table) return;

    if (typeof table.setCellRenderers === 'function') {
      table.setCellRenderers({
        name: function (value, row) {
          return '<div class="insights-library-name">' + escapeHtml(value) + '</div>';
        },
        state: function (value) {
          return '<span class="insights-library-pill insights-library-pill--active">' + escapeHtml(value || 'Active') + '</span>';
        },
        actions: function (value, row) {
          return '<div class="insights-library-actions">' + renderActions(row) + '</div>';
        },
      });
    }

    if (typeof table.setData === 'function') {
      table.setData(sourceDashboards);
    }
  }

  function closeActionMenus() {
    document.querySelectorAll('[data-dashboard-actions-panel]').forEach(function (panel) {
      panel.hidden = true;
    });
  }

  async function deleteDashboard(id, name, sourceDashboards) {
    if (!id) return sourceDashboards;
    var confirmed = window.confirm('Delete "' + (name || 'this dashboard') + '"?');
    if (!confirmed) return sourceDashboards;

    try {
      await api.deleteBIDashboard(id);
      if (window.Lex && Lex.Toast) Lex.Toast.success('Dashboard deleted');
      return sourceDashboards.filter(function (item) { return item.id !== id; });
    } catch (err) {
      if (window.Lex && Lex.Toast) Lex.Toast.error(err.message || 'Could not delete dashboard');
      else console.error(err);
      return sourceDashboards;
    }
  }

  function onDashboardLibraryClick(event, state) {
    if (event.target.closest('#createDashboardBtn')) {
      Lex.Nav.go('admin/dashboard-builder.html');
      return;
    }

    var actions = event.target.closest('[data-dashboard-actions]');
    if (actions) {
      var panel = document.querySelector('[data-dashboard-actions-panel="' + actions.getAttribute('data-dashboard-actions') + '"]');
      var wasHidden = !panel || panel.hidden;
      closeActionMenus();
      if (panel) panel.hidden = !wasHidden;
      return;
    }

    var edit = event.target.closest('[data-dashboard-edit]');
    if (edit) {
      Lex.Nav.go('admin/dashboard-builder.html?id=' + encodeURIComponent(edit.getAttribute('data-dashboard-edit')));
      return;
    }

    var remove = event.target.closest('[data-dashboard-delete]');
    if (remove) {
      deleteDashboard(
        remove.getAttribute('data-dashboard-delete'),
        remove.getAttribute('data-dashboard-name'),
        state.sourceDashboards
      ).then(function (nextDashboards) {
        state.sourceDashboards = nextDashboards;
        renderDashboardLibrary(state.sourceDashboards);
      });
      return;
    }

    var row = event.target.closest('[data-dashboard-href]');
    var href = row && row.dataset && row.dataset.dashboardHref;
    if (href) Lex.Nav.go(href);
  }

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Admin gate: dashboard library exposes share/delete actions, admin-only.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    var table = el('dashboardLibraryTable');
    var state = { sourceDashboards: dashboards() };

    content.addEventListener('click', function (event) { onDashboardLibraryClick(event, state); });
    if (table) {
      table.addEventListener('row-click', function (event) {
        var row = event.detail && event.detail.row;
        if (row && row.href) Lex.Nav.go(row.href);
      });
    }
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.insights-action-menu')) closeActionMenus();
    });
    renderDashboardLibrary(state.sourceDashboards);
    loadDashboards().then(function (loadedDashboards) {
      state.sourceDashboards = loadedDashboards;
      renderDashboardLibrary(state.sourceDashboards);
    });
  }

  init();
})();
