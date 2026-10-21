/**
 * connector-table.js
 * The connector catalog table shared by Data Connectors (data-connectors.html)
 * and the automation app's Connectors view (docs/TABLE-STANDARD.md): toolbar
 * card, section heading with the count, and one client-side lex-table.
 *
 * The catalog is one small list (installed sources merged with the local
 * connector packages, well under 500 rows) that no API pages, so the table
 * runs in client mode: setData(rows), the table sorts, filters and pages.
 *
 * Each page maps its own connectors to rows of raw values:
 *   { id, pin_key, pinned: 'yes'|'no', name, vendor, description, logo_url,
 *     category, auth_type, scope: 'org'|'user', status, version, created_at, _raw }
 * and supplies its status vocabulary and the Actions cell.
 *
 * Public API (window.LanaConnectorTable, or module.exports in Node):
 *   - COLUMNS, LABELS, SORTABLE_COLUMNS, SEARCH_KEYS, SORT_OPTIONS
 *   - AUTOMATION_STATUSES, automationStatusKey(status)  (automation app readiness)
 *   - authLabel(value), categoryLabel(value), scopeLabel(value), versionLabel(value)
 *   - columnFilterOptions(rows, statuses)  -> setColumnFilterOptions map
 *   - cellRenderers(config)                -> lex-table renderers
 *   - sectionMarkup(config)                -> toolbar + heading + lex-table HTML
 *   - snapshot(table)                      -> restoreQuery() state of a table
 *   - countText(n), emptyText(filtered)
 *   - mount(config)                        -> wires a rendered section (browser)
 */

(function (global) {
  'use strict';

  var DASH = '—';

  // Pin and Actions have blank labels, so they take no header filter.
  var COLUMNS = ['pin', 'name', 'category', 'auth_type', 'scope', 'status', 'version', 'created_at', 'actions'];
  var LABELS = ['', 'Name', 'Category', 'Auth', 'Scope', 'Status', 'Version', 'Created', ''];
  var SORTABLE_COLUMNS = ['name', 'category', 'auth_type', 'scope', 'status', 'version', 'created_at'];
  var SEARCH_KEYS = ['name', 'vendor', 'description', 'category', 'auth_type'];
  var SORT_OPTIONS = [
    { value: 'created_at', label: 'Created' },
    { value: 'name', label: 'Name' },
    { value: 'category', label: 'Category' },
    { value: 'auth_type', label: 'Auth' },
    { value: 'scope', label: 'Scope' },
    { value: 'status', label: 'Status' },
    { value: 'version', label: 'Version' }
  ];
  var SHOW_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'yes', label: 'Pinned' }
  ];

  var AUTH_LABELS = {
    oauth2: 'OAuth 2.0',
    oauth2_or_api_key: 'OAuth 2.0 or API key',
    api_key: 'API key',
    basic: 'Basic auth',
    none: 'None',
    unknown: 'Unknown'
  };
  var CATEGORY_LABELS = { crm: 'CRM', case: 'Case management', unknown: 'Other' };
  var SEARCH_DEBOUNCE_MS = 350;

  // The automation app's readiness vocabulary. The backend pre-creates an
  // integration source per known connector, so presence is not readiness;
  // the status is (see automation/js/views/connectors.js).
  var AUTOMATION_STATUSES = {
    ready:         { label: 'Ready',         color: 'green' },
    syncing:       { label: 'Syncing',       color: 'blue' },
    error:         { label: 'Error',         color: 'red' },
    coming_soon:   { label: 'Coming soon',   color: 'yellow' },
    not_installed: { label: 'Not installed', color: 'gray' }
  };
  var AUTOMATION_STATUS_KEYS = {
    connected: 'ready',
    active: 'ready',
    installed: 'ready',
    syncing: 'syncing',
    error: 'error',
    coming_soon: 'coming_soon'
  };

  /** Raw connector status -> AUTOMATION_STATUSES key (not_installed by default). */
  function automationStatusKey(status) {
    return AUTOMATION_STATUS_KEYS[String(status || '').trim().toLowerCase()] || 'not_installed';
  }

  var SORT_ICON = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>';
  var STAR_FILLED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.39 6.96L22 9.27l-5.45 4.73L17.82 22 12 18.27 6.18 22l1.27-7.99L2 9.27l7.61-.31L12 2z"/></svg>';
  var STAR_OUTLINE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.39 6.96L22 9.27l-5.45 4.73L17.82 22 12 18.27 6.18 22l1.27-7.99L2 9.27l7.61-.31L12 2z"/></svg>';

  function utils() {
    return (global && global.Lex && global.Lex.Utils) || null;
  }

  function columnFilters() {
    if (global && global.LanaLibraryColumnFilters) return global.LanaLibraryColumnFilters;
    if (typeof require === 'function') {
      try { return require('./library-column-filters.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function humanize(value) {
    var lex = utils();
    if (lex && typeof lex.humanizeLabel === 'function') return lex.humanizeLabel(value);
    var text = String(value == null ? '' : value).replace(/[_-]+/g, ' ').trim().toLowerCase();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function authLabel(value) {
    var key = String(value || '').trim().toLowerCase();
    if (!key) return '';
    return AUTH_LABELS[key] || humanize(key);
  }

  function categoryLabel(value) {
    var key = String(value || '').trim().toLowerCase();
    if (!key) return '';
    return CATEGORY_LABELS[key] || humanize(key);
  }

  function scopeLabel(value) {
    return String(value || '').toLowerCase() === 'user' ? 'Personal' : 'Firm';
  }

  function versionLabel(value) {
    var text = String(value || '').trim().replace(/^v/i, '');
    return text ? 'v' + text : '';
  }

  function muted(text) {
    return '<span class="connector-table-muted">' + esc(text || DASH) + '</span>';
  }

  function countText(n) {
    var total = Number(n) || 0;
    return total + (total === 1 ? ' connector' : ' connectors');
  }

  function emptyText(filtered) {
    return filtered
      ? 'No matching connectors. Try a different search or clear the filters.'
      : 'No connectors available yet';
  }

  function statusInfo(statuses, value) {
    return (statuses && statuses[value]) || { label: humanize(value), color: 'gray' };
  }

  // Distinct non-empty values of a row field, sorted by their label.
  function distinctOptions(rows, key, labelFn) {
    var seen = {};
    var options = [];
    (rows || []).forEach(function (row) {
      var value = row && row[key];
      if (value === null || value === undefined || value === '') return;
      value = String(value);
      if (seen[value]) return;
      seen[value] = true;
      options.push({ value: value, label: labelFn(value) || value });
    });
    return options.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  /**
   * Header filters for every labelled column, with readable labels.
   * @param {Array} rows
   * @param {Object} statuses - { key: { label, color } } in display order
   */
  function columnFilterOptions(rows, statuses) {
    var ranges = columnFilters();
    var statusOptions = Object.keys(statuses || {}).map(function (key) {
      return { value: key, label: statuses[key].label };
    });
    distinctOptions(rows, 'status', function (v) { return statusInfo(statuses, v).label; }).forEach(function (option) {
      if (!statusOptions.some(function (o) { return o.value === option.value; })) statusOptions.push(option);
    });
    return {
      name: { text: true, placeholder: 'Name contains...' },
      category: { options: distinctOptions(rows, 'category', categoryLabel) },
      auth_type: { options: distinctOptions(rows, 'auth_type', authLabel) },
      scope: { options: [{ value: 'org', label: 'Firm' }, { value: 'user', label: 'Personal' }] },
      status: { options: statusOptions },
      version: { options: distinctOptions(rows, 'version', versionLabel) },
      created_at: {
        single: true,
        options: ranges ? ranges.EDITED_RANGE_OPTIONS : [],
        match: function (cell, values) {
          return ranges ? ranges.inEditedRange(cell, values[0]) : true;
        }
      }
    };
  }

  function timeCell(value) {
    var lex = utils();
    var text = value && lex && typeof lex.formatDateTime === 'function' ? lex.formatDateTime(value) : '';
    if (!text || text === 'Never') return muted('');
    return '<time class="connector-table-time" datetime="' + esc(value) + '" title="' + esc(text) + '">' + esc(text) + '</time>';
  }

  function logoCell(row) {
    var initial = esc(String(row.name || '?').charAt(0).toUpperCase());
    if (!row.logo_url) return '<span class="connector-table-logo" aria-hidden="true">' + initial + '</span>';
    return '<span class="connector-table-logo" aria-hidden="true"><img src="' + esc(row.logo_url) + '" alt="" ' +
      'onerror="this.parentNode.textContent=\'' + initial + '\'"></span>';
  }

  /**
   * Cell renderers. config: { statuses, actionsCell(row) -> html }
   */
  function cellRenderers(config) {
    var statuses = (config && config.statuses) || {};
    var actionsCell = config && typeof config.actionsCell === 'function' ? config.actionsCell : function () { return ''; };
    return {
      pin: function (_value, row) {
        var pinned = row && row.pinned === 'yes';
        var label = pinned ? 'Unpin connector' : 'Pin connector';
        return '<button type="button" class="connector-table-pin' + (pinned ? ' is-pinned' : '') + '" data-connector-pin="' + esc(row && row.pin_key) + '"' +
          ' aria-pressed="' + (pinned ? 'true' : 'false') + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
          (pinned ? STAR_FILLED : STAR_OUTLINE) + '</button>';
      },
      name: function (value, row) {
        var name = value || 'Unknown connector';
        return '<div class="connector-table-name-cell">' + logoCell(row || {}) +
          '<span class="connector-table-name-text"><span class="connector-table-name" title="' + esc(name) + '">' + esc(name) + '</span>' +
          (row && row.vendor ? '<span class="connector-table-sub" title="' + esc(row.vendor) + '">' + esc(row.vendor) + '</span>' : '') +
          '</span></div>';
      },
      category: function (value) {
        return value ? '<span class="connector-table-text">' + esc(categoryLabel(value)) + '</span>' : muted('');
      },
      auth_type: function (value) {
        return value ? '<span class="connector-table-text">' + esc(authLabel(value)) + '</span>' : muted('');
      },
      scope: function (value) {
        var label = scopeLabel(value);
        return '<lex-badge label="' + label + '" color="' + (label === 'Personal' ? 'blue' : 'gray') + '" size="sm"></lex-badge>';
      },
      status: function (value) {
        if (!value) return muted('');
        var info = statusInfo(statuses, value);
        return '<lex-badge label="' + esc(info.label) + '" color="' + esc(info.color || 'gray') + '" size="sm"></lex-badge>';
      },
      version: function (value) {
        return value ? '<span class="connector-table-text">' + esc(versionLabel(value)) + '</span>' : muted('');
      },
      created_at: function (value) { return timeCell(value); },
      actions: function (_value, row) {
        return '<div class="connector-table-actions">' + actionsCell(row || {}) + '</div>';
      }
    };
  }

  function optionsAttr(options) {
    return esc(JSON.stringify(options));
  }

  /**
   * Toolbar card, section heading and the lex-table.
   * config: { prefix, tableId, title, subtitle?, query? (snapshot), showPinned? }
   */
  function sectionMarkup(config) {
    var prefix = config.prefix;
    var query = config.query || {};
    var sortBy = query.sortBy || 'created_at';
    var sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
    var pinnedFilter = query.filters && query.filters.pinned ? 'yes' : 'all';
    return '' +
      '<div class="connector-table-toolbar bg-white rounded-lg shadow-sm border mb-4 mt-4 p-4" style="border-color: var(--lex-border-default)" role="search" aria-label="Search and filter connectors">' +
        '<div class="flex items-center gap-4 flex-wrap">' +
          '<div class="flex-1 min-w-[200px]">' +
            '<lex-input id="' + esc(prefix) + 'Search" placeholder="Search connectors by name, vendor, or description..." clearable="true" leading-icon="search" value="' + esc(query.search || '') + '"></lex-input>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Sort by:</label>' +
            '<lex-select id="' + esc(prefix) + 'Sort" options=\'' + optionsAttr(SORT_OPTIONS) + '\' value="' + esc(sortBy) + '"></lex-select>' +
          '</div>' +
          '<lex-btn id="' + esc(prefix) + 'SortOrder" variant="ghost" icon="true" title="Toggle sort order" data-order="' + sortDir + '">' + SORT_ICON + '</lex-btn>' +
          '<div class="flex items-center gap-2">' +
            '<label class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)">Show:</label>' +
            '<lex-select id="' + esc(prefix) + 'Pinned" options=\'' + optionsAttr(SHOW_OPTIONS) + '\' value="' + pinnedFilter + '"></lex-select>' +
          '</div>' +
          '<div id="' + esc(prefix) + 'Count" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)"></div>' +
        '</div>' +
      '</div>' +
      '<section class="connector-table-section" aria-labelledby="' + esc(prefix) + 'Heading">' +
        '<div class="flex items-center justify-between mb-3">' +
          '<div>' +
            '<h2 id="' + esc(prefix) + 'Heading" class="text-lg font-semibold" style="color: var(--lex-text-primary)">' + esc(config.title) + '</h2>' +
            (config.subtitle ? '<p class="text-sm mt-1" style="color: var(--lex-text-secondary)">' + esc(config.subtitle) + '</p>' : '') +
          '</div>' +
          '<span id="' + esc(prefix) + 'SectionCount" class="text-sm whitespace-nowrap" style="color: var(--lex-text-secondary)" aria-live="polite"></span>' +
        '</div>' +
        '<lex-table' +
          ' id="' + esc(config.tableId) + '"' +
          ' class="connector-table lex-table--card"' +
          ' column-filters' +
          ' columns="' + COLUMNS.join(',') + '"' +
          ' labels="' + LABELS.join(',') + '"' +
          ' sortable-columns="' + SORTABLE_COLUMNS.join(',') + '"' +
          ' search-keys="' + SEARCH_KEYS.join(',') + '"' +
          ' sort-by="' + esc(sortBy) + '" sort-dir="' + sortDir + '"' +
          ' limit="' + esc(String(query.limit || 20)) + '"' +
          ' id-key="id"' +
          ' empty-text="' + esc(emptyText(false)) + '"' +
          ' aria-label="Connectors"' +
        '></lex-table>' +
      '</section>';
  }

  /** The table's whole query, for restoreQuery() after a re-render or setData. */
  function snapshot(table) {
    if (!table || !table.dataSource) return null;
    var query = table.dataSource.query || {};
    return {
      search: query.search || '',
      sortBy: query.sortBy || table.sortBy || 'created_at',
      sortDir: query.sortDir || table.sortDir || 'desc',
      filters: JSON.parse(JSON.stringify(query.filters || {})),
      page: query.page || 1,
      limit: query.limit || 20
    };
  }

  // -------------------------------------------------------------------------
  // Browser wiring
  // -------------------------------------------------------------------------

  /**
   * Wires a section rendered by sectionMarkup and fills it.
   * config: {
   *   prefix, tableId, rows, statuses, actionsCell(row),
   *   store?        // object kept across re-renders: store.query holds the snapshot
   *   onRowClick(row),
   *   onPinClick?(pinKey)   // omit when a document-level handler owns [data-connector-pin]
   * }
   * Returns a Promise of { table, setRows(rows) }.
   */
  function mount(config) {
    var doc = global.document;
    var ready = global.customElements && typeof global.customElements.whenDefined === 'function'
      ? global.customElements.whenDefined('lex-table')
      : Promise.resolve();

    return ready.then(function () {
      var table = doc.getElementById(config.tableId);
      if (!table) return null;
      var byId = function (suffix) { return doc.getElementById(config.prefix + suffix); };
      var store = config.store || {};
      var searchTimer = null;

      function remember() {
        store.query = snapshot(table);
      }

      function setCount() {
        var rows = table.filteredRows || [];
        var text = countText(rows.length);
        ['Count', 'SectionCount'].forEach(function (suffix) {
          var node = byId(suffix);
          if (node) node.textContent = text;
        });
        var query = table.dataSource ? table.dataSource.query : {};
        var filtered = Boolean((query && query.search) || Object.keys((query && query.filters) || {}).length);
        table.emptyText = emptyText(filtered);
      }

      function syncToolbar() {
        var query = table.dataSource ? table.dataSource.query : {};
        var sort = byId('Sort');
        var order = byId('SortOrder');
        var pinned = byId('Pinned');
        if (sort && query.sortBy && sort.value !== query.sortBy) sort.value = query.sortBy;
        if (order) order.dataset.order = query.sortDir === 'asc' ? 'asc' : 'desc';
        var pinValue = query.filters && query.filters.pinned ? 'yes' : 'all';
        if (pinned && pinned.value !== pinValue) pinned.value = pinValue;
      }

      function setRows(rows) {
        var saved = store.query || snapshot(table);
        table.setColumnFilterOptions(columnFilterOptions(rows, config.statuses));
        table.setData(rows || []);
        if (saved) table.restoreQuery(saved);
        syncToolbar();
        setCount();
        remember();
      }

      function restoreWith(changes) {
        var next = Object.assign({}, snapshot(table) || {}, changes);
        table.restoreQuery(next);
        syncToolbar();
        setCount();
        remember();
      }

      table.setCellRenderers(cellRenderers(config));

      table.addEventListener('lex-filter-change', function (event) {
        if (event.target !== table) return;
        syncToolbar();
        setCount();
        remember();
      });
      table.addEventListener('sort-change', function (event) {
        if (event.target !== table) return;
        syncToolbar();
        remember();
      });
      // Pager clicks (page and page size) change no filter: remember them on click.
      table.addEventListener('click', function (event) {
        var pin = event.target && event.target.closest ? event.target.closest('[data-connector-pin]') : null;
        if (pin && typeof config.onPinClick === 'function') {
          event.preventDefault();
          event.stopPropagation();
          config.onPinClick(pin.getAttribute('data-connector-pin'));
          return;
        }
        global.setTimeout(remember, 0);
      });
      table.addEventListener('change', function () { global.setTimeout(remember, 0); });
      table.addEventListener('lex-change', function () { global.setTimeout(remember, 0); });
      table.addEventListener('row-click', function (event) {
        var row = event.detail && event.detail.row;
        if (row && typeof config.onRowClick === 'function') config.onRowClick(row);
      });

      ['lex-input', 'lex-change'].forEach(function (name) {
        var search = byId('Search');
        if (!search) return;
        search.addEventListener(name, function (event) {
          var value = String((event.detail && event.detail.value) || '').trim();
          global.clearTimeout(searchTimer);
          searchTimer = global.setTimeout(function () {
            if (value === table.searchText) return;
            restoreWith({ search: value, page: 1 });
          }, SEARCH_DEBOUNCE_MS);
        });
      });

      var sortOrder = function () {
        var button = byId('SortOrder');
        return button && button.dataset.order === 'asc' ? 'asc' : 'desc';
      };
      var sortSelect = byId('Sort');
      if (sortSelect) {
        sortSelect.addEventListener('lex-change', function (event) {
          var value = String((event.detail && event.detail.value) || '');
          if (value) restoreWith({ sortBy: value, sortDir: sortOrder(), page: 1 });
        });
      }
      var orderButton = byId('SortOrder');
      if (orderButton) {
        orderButton.addEventListener('click', function () {
          orderButton.dataset.order = sortOrder() === 'asc' ? 'desc' : 'asc';
          restoreWith({ sortBy: (sortSelect && sortSelect.value) || table.sortBy, sortDir: sortOrder(), page: 1 });
        });
      }
      // "Show: Pinned" lives in the table's filter state, so Clear filters resets it.
      var pinnedSelect = byId('Pinned');
      if (pinnedSelect) {
        pinnedSelect.addEventListener('lex-change', function (event) {
          var value = String((event.detail && event.detail.value) || 'all');
          if (value === 'yes') table.addFilter('pinned', 'in', ['yes']);
          else table.removeFilter('pinned');
        });
      }

      setRows(config.rows || []);
      return { table: table, setRows: setRows };
    });
  }

  var moduleApi = {
    COLUMNS: COLUMNS,
    LABELS: LABELS,
    SORTABLE_COLUMNS: SORTABLE_COLUMNS,
    SEARCH_KEYS: SEARCH_KEYS,
    SORT_OPTIONS: SORT_OPTIONS,
    AUTOMATION_STATUSES: AUTOMATION_STATUSES,
    automationStatusKey: automationStatusKey,
    authLabel: authLabel,
    categoryLabel: categoryLabel,
    scopeLabel: scopeLabel,
    versionLabel: versionLabel,
    columnFilterOptions: columnFilterOptions,
    cellRenderers: cellRenderers,
    sectionMarkup: sectionMarkup,
    snapshot: snapshot,
    countText: countText,
    emptyText: emptyText,
    mount: mount
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaConnectorTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
