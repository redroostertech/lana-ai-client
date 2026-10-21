/**
 * Admin Plugins — page controller (admin/plugins.html).
 *
 * Installed tab: one client-side lex-table (docs/TABLE-STANDARD.md). The
 * installed list API returns the organization's whole set in one request
 * (GET /api/v1/plugins/installed, no paging), so the table sorts, filters and
 * pages it in the browser. Start / Stop / Restart / Uninstall are buttons in
 * the last cell.
 * Marketplace tab: a gallery, kept as cards.
 *
 * @requires api.js              - getInstalledPlugins, getMarketplacePlugins,
 *                                 start/stop/restart/uninstall/installPlugin
 * @requires lex.utils.js        - Lex.Utils.humanizeLabel
 * @requires lex-table.js        - client-side table
 * @requires admin-table-kit.js  - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range filter predicates
 */

(function () {
  'use strict';

  var TABLE_ID = 'installedPluginsTable';

  // Status values the plugin write paths set (plugin.routes.js).
  var PLUGIN_STATUSES = ['active', 'installed', 'disabled'];

  var STATUS_COLORS = { active: 'green', installed: 'blue', disabled: 'gray', error: 'red', failed: 'red' };

  var _toolbar = null;
  var _gen = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function kit() {
    return window.AdminTableKit;
  }

  function humanize(value) {
    return kit().capitalize(value);
  }

  // =========================================================================
  // Installed table: pure pieces (exposed for unit tests)
  // =========================================================================

  /** One row per installed plugin: raw values, the record as _raw. */
  function mapPlugin(p) {
    return {
      id: String(p.id || ''),
      name: String(p.name || ''),
      version: String(p.version || ''),
      status: String(p.status || '').toLowerCase(),
      created_at: p.created_at || '',
      updated_at: p.updated_at || '',
      actions: '',
      _raw: p
    };
  }

  function actionButton(action, label, id, variant) {
    return '<lex-btn size="sm" variant="' + variant + '" data-plugin-action="' + action + '" data-plugin-id="' + kit().esc(id) + '">' + label + '</lex-btn>';
  }

  function cellRenderers() {
    var k = kit();
    return {
      name: function (val) { return k.nameCell(val); },
      version: function (val) { return val ? '<span class="admin-table-text">v' + k.esc(val) + '</span>' : k.muted(''); },
      status: function (val) {
        var key = String(val || '').toLowerCase();
        return key ? k.badge(humanize(key), STATUS_COLORS[key] || 'gray') : k.muted('');
      },
      created_at: function (val) { return k.timeCell(val); },
      updated_at: function (val) { return k.relativeCell(val); },
      actions: function (val, row) {
        var running = row.status === 'active';
        return '<div class="admin-plugin-actions">' +
          (running ? actionButton('stop', 'Stop', row.id, 'secondary') : actionButton('start', 'Start', row.id, 'secondary')) +
          actionButton('restart', 'Restart', row.id, 'ghost') +
          actionButton('uninstall', 'Uninstall', row.id, 'danger') +
          '</div>';
      }
    };
  }

  function dateRange() {
    var shared = window.LanaLibraryColumnFilters;
    var base = kit().dateRangeFilter();
    return {
      single: true,
      options: base.options,
      match: function (cell, values) { return shared ? shared.inEditedRange(cell, values[0]) : true; }
    };
  }

  /** Header filters for every column but the actions column. */
  function filterOptions(rows) {
    var statuses = PLUGIN_STATUSES.slice();
    (rows || []).forEach(function (r) {
      if (r.status && statuses.indexOf(r.status) === -1) statuses.push(r.status);
    });
    var versions = [];
    (rows || []).forEach(function (r) {
      if (r.version && versions.indexOf(r.version) === -1) versions.push(r.version);
    });
    return {
      name: { text: true, placeholder: 'Plugin name contains...' },
      version: { options: versions.sort().map(function (v) { return { value: v, label: 'v' + v }; }) },
      status: { options: kit().labelOptions(statuses) },
      created_at: dateRange(),
      updated_at: dateRange()
    };
  }

  // =========================================================================
  // Installed table: wiring
  // =========================================================================

  function table() {
    return el(TABLE_ID);
  }

  function updateCount() {
    var t = table();
    if (!t || !_toolbar) return;
    if (Array.isArray(t.filteredRows)) _toolbar.setCount(t.filteredRows.length);
    else _toolbar.refreshCount();
  }

  function initTable() {
    var t = table();
    if (!t || t.dataset.pluginsBound === 'true') return;
    t.dataset.pluginsBound = 'true';
    kit().whenTableReady().then(function () {
      if (table() !== t) return;
      t.setCellRenderers(cellRenderers());
      t.setColumnFilterOptions(filterOptions([]));
      _toolbar = kit().bindToolbar({
        table: t,
        searchId: 'pluginsSearch',
        sortId: 'pluginsSort',
        orderId: 'pluginsSortOrder',
        filterId: 'pluginsStatusFilter',
        filterKey: 'status',
        countIds: ['pluginsCount', 'pluginsSectionCount'],
        noun: ['plugin', 'plugins']
      });
      ['lex-data-loaded', 'lex-filter-change'].forEach(function (name) {
        t.addEventListener(name, function (e) {
          if (e.target === t) updateCount();
        });
      });
      t.addEventListener('lex-filter-change', function (e) {
        if (e.target !== t) return;
        var filters = (e.detail && e.detail.filters) || {};
        t.emptyText = kit().emptyText(Object.keys(filters).length > 0 || Boolean(t.searchText), 'plugins');
      });
      t.addEventListener('empty-action', function () { showTab('marketplace'); });
      t.addEventListener('click', onActionClick);
      loadInstalled();
    });
  }

  function onActionClick(event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-plugin-action]') : null;
    if (!button) return;
    event.stopPropagation();
    var id = button.getAttribute('data-plugin-id');
    var action = button.getAttribute('data-plugin-action');
    if (action === 'uninstall') uninstallPlugin(id);
    else runAction(action, id);
  }

  async function loadInstalled() {
    var t = table();
    if (!t) return;
    var gen = ++_gen;
    try {
      var result = await api.getInstalledPlugins();
      if (gen !== _gen) return;
      var rows = ((result && result.plugins) || []).map(mapPlugin);
      t.setColumnFilterOptions(filterOptions(rows));
      t.setData(rows);
      updateCount();
    } catch (error) {
      if (gen !== _gen) return;
      console.error('[admin-plugins] load installed failed:', error);
      if (_toolbar) _toolbar.setCount(null);
      var message = 'Installed plugins could not be loaded. Check your connection and try again.';
      if (typeof t.setError === 'function') {
        t.setError(message);
      } else {
        t.emptyText = message;
        t.setData([]);
      }
    }
  }

  var ACTIONS = {
    start: { call: 'startPlugin', done: 'Plugin started' },
    stop: { call: 'stopPlugin', done: 'Plugin stopped' },
    restart: { call: 'restartPlugin', done: 'Plugin restarted' }
  };

  async function runAction(action, pluginId) {
    var spec = ACTIONS[action];
    if (!spec || !pluginId) return;
    try {
      await api[spec.call](pluginId);
      Lex.Toast.success(spec.done);
      loadInstalled();
    } catch (error) {
      Lex.Toast.error((error && error.message) || 'The plugin action failed');
    }
  }

  function uninstallPlugin(pluginId) {
    if (!pluginId) return;
    Lex.Modal.confirm('Uninstall plugin', 'Are you sure you want to uninstall this plugin?', async function () {
      try {
        await api.uninstallPlugin(pluginId);
        Lex.Toast.success('Plugin uninstalled');
        loadInstalled();
      } catch (error) {
        Lex.Toast.error((error && error.message) || 'The plugin could not be uninstalled');
      }
    }, { variant: 'danger', confirmText: 'Uninstall' });
  }

  // =========================================================================
  // Tabs + Marketplace (cards)
  // =========================================================================

  function showTab(id) {
    var tabs = el('pluginTabs');
    if (tabs && tabs.active !== id) tabs.active = id;
    var installed = el('installedContent');
    var marketplace = el('marketplaceContent');
    if (installed) installed.classList.toggle('hidden', id !== 'installed');
    if (marketplace) marketplace.classList.toggle('hidden', id !== 'marketplace');
    if (id === 'marketplace') loadMarketplace();
  }

  function marketplaceCard(plugin) {
    var k = kit();
    var downloads = Number(plugin.downloads);
    return '<div class="admin-plugin-card">' +
      '<div class="flex items-start justify-between mb-2">' +
        '<h3>' + k.esc(plugin.name) + '</h3>' +
        (plugin.installed ? k.badge('Installed', 'green') : '') +
      '</div>' +
      '<p class="mb-2">' + k.esc(plugin.description || '') + '</p>' +
      '<div class="admin-plugin-meta flex items-center gap-4 mb-4">' +
        (plugin.version ? '<span>v' + k.esc(plugin.version) + '</span>' : '') +
        (plugin.author ? '<span>by ' + k.esc(plugin.author) + '</span>' : '') +
        (Number.isFinite(downloads) ? '<span>' + k.esc(downloads.toLocaleString()) + ' downloads</span>' : '') +
        (plugin.rating !== undefined && plugin.rating !== null ? '<span>Rating ' + k.esc(plugin.rating) + '</span>' : '') +
      '</div>' +
      (plugin.installed
        ? '<lex-btn variant="secondary" disabled>Already installed</lex-btn>'
        : '<lex-btn variant="primary" data-install-name="' + k.esc(plugin.name) + '" data-install-version="' + k.esc(plugin.version || '') + '">Install</lex-btn>') +
    '</div>';
  }

  var _marketGen = 0;

  async function loadMarketplace() {
    var container = el('marketplacePlugins');
    if (!container) return;
    var search = el('marketplaceSearch');
    var category = el('categoryFilter');
    var gen = ++_marketGen;
    try {
      var result = await api.getMarketplacePlugins(
        search ? String(search.value || '').trim() : '',
        category ? String(category.value || '') : ''
      );
      if (gen !== _marketGen) return;
      var plugins = (result && result.plugins) || [];
      var categories = (result && result.categories) || [];
      if (category && categories.length && (!category.options || category.options.length <= 1)) {
        var options = [{ value: '', label: 'All categories' }].concat(categories.map(function (cat) {
          return { value: String(cat), label: humanize(cat) };
        }));
        category.options = options;
        category.setAttribute('options', JSON.stringify(options));
      }
      container.innerHTML = plugins.length
        ? plugins.map(marketplaceCard).join('')
        : '<lex-empty icon="search" message="No plugins found" description="Try a different search or category."></lex-empty>';
    } catch (error) {
      if (gen !== _marketGen) return;
      Lex.Toast.error('Failed to load marketplace');
    }
  }

  async function installPlugin(name, version) {
    try {
      await api.installPlugin(name, version);
      Lex.Toast.success('Plugin installed');
      loadMarketplace();
      loadInstalled();
    } catch (error) {
      Lex.Toast.error((error && error.message) || 'The plugin could not be installed');
    }
  }

  function bindMarketplace() {
    var container = el('marketplacePlugins');
    if (!container || container.dataset.bound === 'true') return;
    container.dataset.bound = 'true';
    container.addEventListener('click', function (event) {
      var button = event.target.closest('[data-install-name]');
      if (button) installPlugin(button.getAttribute('data-install-name'), button.getAttribute('data-install-version'));
    });
    var debounce = null;
    var search = el('marketplaceSearch');
    if (search) {
      ['lex-input', 'lex-change'].forEach(function (name) {
        search.addEventListener(name, function () {
          clearTimeout(debounce);
          debounce = setTimeout(loadMarketplace, 300);
        });
      });
    }
    var category = el('categoryFilter');
    if (category) category.addEventListener('lex-change', loadMarketplace);
    var tabs = el('pluginTabs');
    if (tabs) {
      tabs.addEventListener('tab-change', function (e) {
        showTab((e.detail && e.detail.tab) || 'installed');
      });
    }
  }

  function init() {
    if (!el(TABLE_ID)) return;
    bindMarketplace();
    initTable();
  }

  // Pure table logic, exposed for unit tests.
  window.AdminPluginsTable = {
    mapPlugin: mapPlugin,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    marketplaceCard: marketplaceCard,
    PLUGIN_STATUSES: PLUGIN_STATUSES,
    STATUS_COLORS: STATUS_COLORS
  };

  if (typeof LexRouter !== 'undefined' && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('admin/plugins.html', init);
  }
  init();
})();
