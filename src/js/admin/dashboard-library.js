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

  // Tracks dashboards the current user has pinned. Hydrated by
  // loadPinnedDashboards() on init and kept in sync as the user toggles
  // pins so the table and the Pinned strip stay consistent without a
  // server round-trip per render.
  var pinnedIds = new Set();

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
      pin: record.id ? 'pin' : '',
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

  function renderPinCell(item) {
    if (!item || !item.id) return '';
    var pinned = pinnedIds.has(item.id);
    var label = pinned ? 'Unpin dashboard' : 'Pin dashboard';
    var cls = 'insights-pin-toggle' + (pinned ? ' is-pinned' : '');
    // Outline + filled bookmark glyph mirrors the matters list. The button
    // stops propagation so a row-click handler doesn't navigate when the
    // user is toggling the pin.
    var icon = pinned ? '★' : '☆';
    return '<button type="button" class="' + cls + '" data-dashboard-pin-toggle="' + escapeHtml(item.id) + '" aria-pressed="' + pinned + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + icon + '</button>';
  }

  function renderPinnedStrip(sourceDashboards) {
    var section = el('dashboardLibraryPinnedSection');
    var grid = el('dashboardLibraryPinnedGrid');
    var count = el('dashboardLibraryPinnedCount');
    if (!section || !grid) return;

    var pinned = sourceDashboards.filter(function (item) { return item.id && pinnedIds.has(item.id); });
    if (pinned.length === 0) {
      section.hidden = true;
      grid.innerHTML = '';
      if (count) count.textContent = '0 items';
      return;
    }

    section.hidden = false;
    if (count) count.textContent = pinned.length + (pinned.length === 1 ? ' item' : ' items');
    grid.innerHTML = pinned.map(function (item) {
      return '<a class="insights-pinned-card" href="' + escapeHtml(item.href) + '" data-dashboard-pinned-card="' + escapeHtml(item.id) + '">'
        + '<button type="button" class="insights-pinned-card__pin" data-dashboard-pin-toggle="' + escapeHtml(item.id) + '" aria-label="Unpin dashboard" title="Unpin dashboard">★</button>'
        + '<div class="insights-pinned-card__name">' + escapeHtml(item.name || 'Untitled dashboard') + '</div>'
        + '<div class="insights-pinned-card__meta">' + escapeHtml(item.audience || '-') + '</div>'
        + '</a>';
    }).join('');
  }

  async function loadPinnedDashboards() {
    if (!window.api || typeof window.api.listPinnedBIDashboards !== 'function') return;
    try {
      var response = await api.listPinnedBIDashboards();
      var rows = response && Array.isArray(response.data) ? response.data : [];
      pinnedIds = new Set(rows.map(function (row) { return row.id; }).filter(Boolean));
    } catch (err) {
      console.warn('[DashboardLibrary] Could not load pinned dashboards:', err.message);
    }
  }

  async function togglePin(dashboardId, sourceDashboards) {
    if (!dashboardId || !window.api) return sourceDashboards;
    var wasPinned = pinnedIds.has(dashboardId);
    // Optimistic update so the pin UI feels instant; rolled back on error.
    if (wasPinned) pinnedIds.delete(dashboardId);
    else pinnedIds.add(dashboardId);
    renderPinnedStrip(sourceDashboards);
    renderDashboardLibrary(sourceDashboards);

    try {
      if (wasPinned) await api.unpinBIDashboard(dashboardId);
      else await api.pinBIDashboard(dashboardId);
    } catch (err) {
      // Rollback
      if (wasPinned) pinnedIds.add(dashboardId);
      else pinnedIds.delete(dashboardId);
      renderPinnedStrip(sourceDashboards);
      renderDashboardLibrary(sourceDashboards);
      if (window.Lex && Lex.Toast) Lex.Toast.error(err.message || 'Could not update pin');
    }
    return sourceDashboards;
  }

  function renderDashboardLibrary(sourceDashboards) {
    var table = el('dashboardLibraryTable');
    if (!table) return;

    if (typeof table.setCellRenderers === 'function') {
      table.setCellRenderers({
        pin: function (value, row) {
          return renderPinCell(row);
        },
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

    var pinToggle = event.target.closest('[data-dashboard-pin-toggle]');
    if (pinToggle) {
      // Stop the row-click / card-click navigation when toggling a pin.
      event.preventDefault();
      event.stopPropagation();
      togglePin(pinToggle.getAttribute('data-dashboard-pin-toggle'), state.sourceDashboards);
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
    renderPinnedStrip(state.sourceDashboards);

    // Load pins and dashboards in parallel; render the strip when both are
    // available so the pinned cards carry full dashboard metadata.
    Promise.all([loadDashboards(), loadPinnedDashboards()]).then(function (results) {
      state.sourceDashboards = results[0];
      renderDashboardLibrary(state.sourceDashboards);
      renderPinnedStrip(state.sourceDashboards);
    });
  }

  init();
})();
