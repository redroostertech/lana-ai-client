/* Dashboard Library — searchable catalog of completed LanaInsights dashboards. */

(function () {
  'use strict';

  var OPTIONAL_DASHBOARD_TIMEOUT_MS = 3500;

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

  function optionalRequestOptions(timeoutMs) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return { signal: AbortSignal.timeout(timeoutMs) };
    }
    if (typeof AbortController === 'undefined') return {};
    var controller = new AbortController();
    setTimeout(function () { controller.abort(); }, timeoutMs);
    return { signal: controller.signal };
  }

  // Tracks dashboards the current user has pinned. Hydrated by
  // loadPinnedDashboards() on init and kept in sync as the user toggles
  // pins so the table and the Pinned strip stay consistent without a
  // server round-trip per render.
  var pinnedIds = new Set();

  function tables() {
    return window.LanaMetricTables;
  }

  // Rows keep raw values (docs/TABLE-STANDARD.md section 5); renderers format.
  function normalizeDashboardRecord(record, index) {
    return tables().mapDashboardRecord(record, index);
  }

  function builtInDashboards() {
    return dashboards().map(normalizeDashboardRecord);
  }

  // The library is small, so the table holds the whole set (client-side):
  // read every page of the BI list rather than one capped page.
  async function loadDashboards() {
    if (!window.api || typeof window.api.listBIDashboards !== 'function') {
      return builtInDashboards();
    }

    try {
      var result = await tables().fetchAllPages(async function (limit, offset) {
        var response = await api.listBIDashboards(
          { limit: limit, offset: offset, sort: 'updated_at', order: 'desc' },
          optionalRequestOptions(OPTIONAL_DASHBOARD_TIMEOUT_MS)
        );
        return {
          rows: response && Array.isArray(response.data) ? response.data : [],
          total: response && response.pagination ? response.pagination.total : undefined
        };
      }, 100, 20);
      if (!result.rows.length) return builtInDashboards();
      return result.rows.map(normalizeDashboardRecord);
    } catch (err) {
      console.warn('[DashboardLibrary] Could not load BI dashboards:', err.message);
      return builtInDashboards();
    }
  }

  // Row actions are plain buttons (no custom dropdown menu).
  function renderActions(item) {
    return item && item.id
      ? '<button type="button" class="insights-library-action" data-dashboard-edit="' + escapeHtml(item.id) + '">Edit</button>'
        + '<button type="button" class="insights-library-action is-danger" data-dashboard-delete="' + escapeHtml(item.id) + '" data-dashboard-name="' + escapeHtml(item.name) + '">Delete</button>'
      : '';
  }

  // SVG icons lifted from the workspaces matters table so the dashboard
  // pin toggle matches it pixel-for-pixel. Filled thumbtack = pinned,
  // outline bookmark = not pinned.
  var PIN_ICON_FILLED = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg>';
  var PIN_ICON_OUTLINE = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';

  function renderPinCell(item) {
    if (!item || !item.id) return '';
    var pinned = pinnedIds.has(item.id);
    var label = pinned ? 'Unpin dashboard' : 'Pin dashboard';
    var cls = 'insights-pin-toggle' + (pinned ? ' is-pinned' : '');
    var icon = pinned ? PIN_ICON_FILLED : PIN_ICON_OUTLINE;
    return '<button type="button" class="' + cls + '" data-dashboard-pin-toggle="' + escapeHtml(item.id) + '" aria-pressed="' + pinned + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + icon + '</button>';
  }

  function statePill(state) {
    var label = (state || 'Active');
    return '<span class="insights-pinned-card__pill insights-pinned-card__pill--active">' + escapeHtml(String(label).toLowerCase()) + '</span>';
  }

  function audiencePill(audience) {
    if (!audience) return '';
    return '<span class="insights-pinned-card__pill">' + escapeHtml(String(audience)) + '</span>';
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
        + '<button type="button" class="insights-pinned-card__pin" data-dashboard-pin-toggle="' + escapeHtml(item.id) + '" aria-label="Unpin dashboard" title="Unpin dashboard">' + PIN_ICON_FILLED + '</button>'
        + '<div class="insights-pinned-card__name">' + escapeHtml(item.name || 'Untitled dashboard') + '</div>'
        + '<div class="insights-pinned-card__sub">' + escapeHtml(tables().humanizeLabel(item.audience) || tables().capitalizeFirst(item.category)) + '</div>'
        + '<div class="insights-pinned-card__pills">' + audiencePill(tables().capitalizeFirst(item.category)) + statePill(item.state) + '</div>'
        + '</a>';
    }).join('');
  }

  async function loadPinnedDashboards() {
    if (!window.api || typeof window.api.listPinnedBIDashboards !== 'function') return;
    try {
      var response = await api.listPinnedBIDashboards(optionalRequestOptions(OPTIONAL_DASHBOARD_TIMEOUT_MS));
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

  function muted() {
    return '<span class="insights-library-muted">—</span>';
  }

  function labelCell(text) {
    return text ? escapeHtml(text) : muted();
  }

  // Dates go through Lex.Utils (API time is UTC; shown in the user's zone).
  function absoluteTime(value) {
    if (!value || !window.Lex || !Lex.Utils) return '';
    var text = Lex.Utils.formatDateTime(value);
    return text === 'Never' ? '' : text;
  }

  function relativeTime(value) {
    if (!value || !window.Lex || !Lex.Utils) return '';
    var text = Lex.Utils.timeAgo(value);
    return text === '-' ? '' : text;
  }

  function cellRenderers() {
    var shared = tables();
    return {
      pin: function (value, row) {
        return renderPinCell(row);
      },
      name: function (value) {
        return '<div class="insights-library-name">' + escapeHtml(value || 'Untitled dashboard') + '</div>';
      },
      audience: function (value) { return labelCell(shared.humanizeLabel(value)); },
      category: function (value) { return labelCell(shared.capitalizeFirst(value)); },
      scope: function (value) { return labelCell(shared.capitalizeFirst(value)); },
      visibility: function (value) { return labelCell(shared.capitalizeFirst(value)); },
      state: function (value) {
        var label = shared.humanizeLabel(value || 'Active');
        return '<lex-badge label="' + escapeHtml(label) + '" color="' + (/^active$/i.test(label) ? 'green' : 'gray') + '"></lex-badge>';
      },
      created_at: function (value) {
        var text = absoluteTime(value);
        return text ? '<time class="insights-library-time" datetime="' + escapeHtml(value) + '">' + escapeHtml(text) + '</time>' : muted();
      },
      updated_at: function (value) {
        var text = relativeTime(value);
        return text
          ? '<time class="insights-library-time" datetime="' + escapeHtml(value) + '" title="' + escapeHtml(absoluteTime(value)) + '">' + escapeHtml(text) + '</time>'
          : muted();
      },
      actions: function (value, row) {
        return '<div class="insights-library-actions">' + renderActions(row) + '</div>';
      },
    };
  }

  var toolbar = null;

  function syncEmptyState(table) {
    var filtered = tables().emptyText(table, '', 'filtered') === 'filtered';
    table.emptyText = filtered ? 'No matching dashboards. Try a different search or clear the filters.' : 'No dashboards yet';
    table.emptyActionLabel = filtered ? '' : 'Create Dashboard';
  }

  function renderDashboardLibrary(sourceDashboards) {
    var table = el('dashboardLibraryTable');
    if (!table || typeof table.setData !== 'function') return;

    // Filter pinned dashboards out of the main table — they live in the
    // strip above and shouldn't be duplicated below. Mirrors the matters
    // list behavior in workspace.js (currentMatters minus pinned ids).
    var unpinned = sourceDashboards.filter(function (item) {
      return !(item && item.id && pinnedIds.has(item.id));
    });
    var filters = tables().dashboardFilterOptions(unpinned);
    table.setColumnFilterOptions(filters);
    var audienceSelect = el('dashboardLibraryAudienceFilter');
    if (audienceSelect) {
      audienceSelect.options = [{ value: 'all', label: 'All' }].concat(filters.audience.options);
    }
    syncEmptyState(table);
    table.setData(unpinned);
    if (toolbar) {
      toolbar.updateCount();
      toolbar.syncToolbar();
    }
  }

  function confirmDelete(name) {
    return Lex.Modal.confirmAsync('Delete dashboard', 'Delete "' + (name || 'this dashboard') + '"?', {
      variant: 'danger',
      confirmText: 'Delete'
    });
  }

  async function deleteDashboard(id, name, sourceDashboards) {
    if (!id) return sourceDashboards;
    var confirmed = await confirmDelete(name);
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
    var state = { sourceDashboards: [] };

    content.addEventListener('click', function (event) { onDashboardLibraryClick(event, state); });
    if (table) {
      table.addEventListener('row-click', function (event) {
        var row = event.detail && event.detail.row;
        if (row && row.href) Lex.Nav.go(row.href);
      });
    }
    var ready = window.customElements && typeof window.customElements.whenDefined === 'function'
      ? window.customElements.whenDefined('lex-table')
      : Promise.resolve();
    ready.then(function () { startTable(table, state); });
  }

  function startTable(table, state) {
    if (table) {
      // Renderers must be registered before the first setData.
      table.setCellRenderers(cellRenderers());
      // Search also covers the description, which has no column.
      table._getSearchColumns = function () {
        return ['name', 'description', 'audience', 'category', 'scope', 'visibility', 'state'];
      };
      toolbar = tables().bindClientToolbar(table, {
        search: 'dashboardLibrarySearch',
        sort: 'dashboardLibrarySort',
        order: 'dashboardLibrarySortOrder',
        filter: 'dashboardLibraryAudienceFilter',
        counts: ['dashboardLibraryCount', 'dashboardLibrarySectionCount']
      }, { filterKey: 'audience', noun: ['dashboard', 'dashboards'], defaultSort: 'updated_at' });
      table.addEventListener('lex-filter-change', function () { syncEmptyState(table); });
      table.addEventListener('empty-action', function () { Lex.Nav.go('admin/dashboard-builder.html'); });
    }
    state.sourceDashboards = builtInDashboards();
    renderDashboardLibrary(state.sourceDashboards);
    renderPinnedStrip(state.sourceDashboards);

    loadDashboards().then(function (dashboardsResult) {
      state.sourceDashboards = dashboardsResult;
      renderDashboardLibrary(state.sourceDashboards);
      renderPinnedStrip(state.sourceDashboards);
    });

    loadPinnedDashboards().then(function () {
      renderDashboardLibrary(state.sourceDashboards);
      renderPinnedStrip(state.sourceDashboards);
    });
  }

  init();
})();
