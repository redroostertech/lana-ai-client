/**
 * admin-table-kit.js
 * Shared pieces for the admin list tables (docs/TABLE-STANDARD.md): query
 * helpers, cell markup and the toolbar wiring (search, Sort by, order
 * button, one main filter, counts). Each page keeps its own query mapping
 * and renderers; this file holds what every page would otherwise copy.
 *
 * Public API (window.AdminTableKit, or module.exports in Node):
 *   - filterValues(filter)                    -> string[] from a lex-table filter
 *   - firstFilterValue(filters, col)          -> string ('' when unset)
 *   - setRange(params, filters, col, after, before, now) -> adds ISO bounds for a date-range filter
 *   - pageOffset(query)                       -> { limit, offset } for limit/offset APIs
 *   - esc(value), muted(text), timeCell(value), relativeCell(value), dateCell(value)
 *   - badge(label, color), matterLink(id, name), nameCell(name, sub)
 *   - countText(n, singular, plural)
 *   - labelOptions(values, labels)            -> [{ value, label }] with capitalised labels
 *   - dateRangeFilter()                       -> { single, options } for a date column
 *   - bindToolbar(config)                     -> wires a toolbar to a lex-table (browser only)
 */

(function (global) {
  'use strict';

  var DASH = '—';

  function utils() {
    return (global && global.Lex && global.Lex.Utils) || null;
  }

  function ranges() {
    return (global && global.LanaLibraryColumnFilters) || null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Values a column filter selected: lex-table sends { operator: 'in', value: [...] }
  // or { operator: 'contains', value }.
  function filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value]).map(String).map(function (v) { return v.trim(); }).filter(Boolean);
  }

  function firstFilterValue(filters, col) {
    return filterValues(filters && filters[col])[0] || '';
  }

  /**
   * Adds the ISO bounds of a date-range filter (Today / Last 7 days / ...)
   * to params under the given names. Returns the bounds.
   */
  function setRange(params, filters, col, afterName, beforeName, now) {
    var shared = ranges();
    var value = firstFilterValue(filters, col);
    var bounds = shared && value ? shared.editedRangeBounds(value, now) : { after: '', before: '' };
    if (params && bounds.after) params.set(afterName, bounds.after);
    if (params && bounds.before) params.set(beforeName, bounds.before);
    return bounds;
  }

  function pageOffset(query) {
    var limit = Number(query && query.limit) || 20;
    var page = Math.max(1, Number(query && query.page) || 1);
    return { limit: limit, offset: (page - 1) * limit };
  }

  function muted(text) {
    var value = text === null || text === undefined || text === '' ? DASH : text;
    return '<span class="admin-table-muted">' + esc(value) + '</span>';
  }

  function formatted(fn, value, empty) {
    var lex = utils();
    if (!value || !lex || typeof lex[fn] !== 'function') return '';
    var text = lex[fn](value);
    return text === empty ? '' : text;
  }

  // Created and other timestamps: "1/20/2026 3:16 PM" in the user's timezone.
  function timeCell(value) {
    var text = formatted('formatDateTime', value, 'Never');
    if (!text) return muted('');
    return '<time class="admin-table-time" datetime="' + esc(value) + '" title="' + esc(text) + '">' + esc(text) + '</time>';
  }

  // Last activity / Last edited: relative, the full value in the title.
  function relativeCell(value) {
    var text = formatted('timeAgo', value, '-');
    if (!text) return muted('');
    return '<time class="admin-table-time" datetime="' + esc(value) + '" title="' + esc(formatted('formatDateTime', value, 'Never')) + '">' + esc(text) + '</time>';
  }

  // Date-only values (due dates, expiry dates).
  function dateCell(value) {
    var text = formatted('formatDate', value, 'Never');
    if (!text) return muted('');
    return '<time class="admin-table-time" datetime="' + esc(value) + '">' + esc(text) + '</time>';
  }

  function badge(label, color) {
    if (!label) return muted('');
    return '<lex-badge label="' + esc(label) + '" color="' + esc(color || 'gray') + '" size="sm"></lex-badge>';
  }

  // Workspace links open workspace-details.html?id=<matter_id> through one
  // delegated listener (lex-table's row-click ignores buttons).
  function matterLink(id, name) {
    var label = name || id;
    if (!id) return muted(label);
    return '<button type="button" class="admin-table-link" data-matter-id="' + esc(id) + '" title="Open ' + esc(label) + '">' +
      '<span>' + esc(label) + '</span></button>';
  }

  function nameCell(name, sub) {
    return '<span class="admin-table-name" title="' + esc(name) + '">' + esc(name || DASH) + '</span>' +
      (sub ? '<span class="admin-table-sub" title="' + esc(sub) + '">' + esc(sub) + '</span>' : '');
  }

  function countText(n, singular, plural) {
    var total = Number(n) || 0;
    return total + ' ' + (total === 1 ? singular : (plural || singular + 's'));
  }

  function capitalize(value) {
    var lex = utils();
    if (lex && typeof lex.humanizeLabel === 'function') return lex.humanizeLabel(value);
    var text = String(value == null ? '' : value).split('_').join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  // Filter options with readable, capitalised labels; labels map overrides.
  function labelOptions(values, labels) {
    return (values || []).map(function (value) {
      var label = labels && labels[value] !== undefined ? labels[value] : capitalize(value);
      return { value: String(value), label: String(label) };
    });
  }

  function dateRangeFilter() {
    var shared = ranges();
    return { single: true, options: shared ? shared.EDITED_RANGE_OPTIONS : [] };
  }

  // -------------------------------------------------------------------------
  // Toolbar wiring (browser)
  // -------------------------------------------------------------------------

  /**
   * Wires a standard toolbar to a lex-table.
   * config: {
   *   table, searchId, sortId, orderId, filterId, filterKey,
   *   countIds: [...], noun: ['user', 'users'],
   *   onSearch(term)       // server tables: store the term and reload page 1
   * }
   * Client-side tables search through the table's own pipeline.
   * Returns { setCount(n), syncFilter(filters), refreshCount() }.
   */
  function bindToolbar(config) {
    var doc = global.document;
    var table = config.table;
    var byId = function (id) { return id ? doc.getElementById(id) : null; };
    var debounce = null;
    var lastTerm = '';

    function setCount(n) {
      var text = n === null || n === undefined ? '' : countText(n, config.noun[0], config.noun[1]);
      (config.countIds || []).forEach(function (id) {
        var node = byId(id);
        if (node) node.textContent = text;
      });
    }

    function refreshCount() {
      var source = table.dataSource;
      if (!source) return;
      var pg = source._clientSideMode ? source._displayPagination : source._pagination;
      if (pg) setCount(pg.total);
    }

    function sortOrder() {
      var button = byId(config.orderId);
      return button && button.dataset.order === 'asc' ? 'asc' : 'desc';
    }

    function applySort(column, direction) {
      table.sortBy = column;
      table.sortDir = direction;
      if (table.dataSource) table.dataSource.setSort(column, direction);
    }

    function syncFilter(filters) {
      var select = byId(config.filterId);
      if (!select || !config.filterKey) return;
      var value = firstFilterValue(filters, config.filterKey) || 'all';
      if (select.value !== value) select.value = value;
    }

    var search = byId(config.searchId);
    if (search) {
      ['lex-input', 'lex-change'].forEach(function (name) {
        search.addEventListener(name, function (event) {
          var value = String((event.detail && event.detail.value) || '').trim();
          global.clearTimeout(debounce);
          debounce = global.setTimeout(function () {
            if (value === lastTerm) return;
            lastTerm = value;
            if (typeof config.onSearch === 'function') config.onSearch(value);
            else if (table.dataSource) table.dataSource.setSearch(value);
          }, 350);
        });
      });
    }

    var sort = byId(config.sortId);
    if (sort) {
      sort.addEventListener('lex-change', function (event) {
        var value = String((event.detail && event.detail.value) || '');
        if (value) applySort(value, sortOrder());
      });
    }

    var order = byId(config.orderId);
    if (order) {
      order.addEventListener('click', function () {
        order.dataset.order = sortOrder() === 'asc' ? 'desc' : 'asc';
        var select = byId(config.sortId);
        applySort((select && select.value) || table.sortBy, sortOrder());
      });
    }

    var filter = byId(config.filterId);
    if (filter && config.filterKey) {
      filter.addEventListener('lex-change', function (event) {
        var value = String((event.detail && event.detail.value) || '');
        // Held in the table's filter state, so Clear filters resets it too.
        if (value && value !== 'all') table.addFilter(config.filterKey, 'in', [value]);
        else table.removeFilter(config.filterKey);
      });
    }

    // A header click sorted the table: mirror it in the toolbar.
    table.addEventListener('sort-change', function (event) {
      if (event.target !== table || !event.detail) return;
      var select = byId(config.sortId);
      var button = byId(config.orderId);
      if (select && select.value !== event.detail.sortBy) select.value = event.detail.sortBy;
      if (button) button.dataset.order = event.detail.sortDir === 'asc' ? 'asc' : 'desc';
    });

    table.addEventListener('lex-data-loaded', function (event) {
      if (event.target !== table) return;
      var pg = event.detail && event.detail.pagination;
      if (pg) setCount(pg.total);
    });

    table.addEventListener('lex-filter-change', function (event) {
      if (event.target !== table) return;
      syncFilter(event.detail && event.detail.filters);
      if (table.dataSource && table.dataSource._clientSideMode) refreshCount();
    });

    // Workspace links (rendered by matterLink).
    table.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('[data-matter-id]') : null;
      if (!link) return;
      event.stopPropagation();
      openWorkspace(link.getAttribute('data-matter-id'));
    });

    return { setCount: setCount, syncFilter: syncFilter, refreshCount: refreshCount };
  }

  function openWorkspace(matterId) {
    if (!matterId) return;
    if (global.Lex && global.Lex.Nav && typeof global.Lex.Nav.go === 'function') {
      global.Lex.Nav.go('workspace-details.html', { params: { id: matterId } });
      return;
    }
    global.location.href = '../workspace-details.html?id=' + encodeURIComponent(matterId);
  }

  // Empty copy that knows whether the user filtered the table empty.
  function emptyText(filtered, noun) {
    return filtered
      ? 'No matching ' + noun + '. Try a different search or clear the filters.'
      : 'No ' + noun + ' yet';
  }

  function whenTableReady() {
    return global.customElements && typeof global.customElements.whenDefined === 'function'
      ? global.customElements.whenDefined('lex-table')
      : Promise.resolve();
  }

  var moduleApi = {
    DASH: DASH,
    esc: esc,
    filterValues: filterValues,
    firstFilterValue: firstFilterValue,
    setRange: setRange,
    pageOffset: pageOffset,
    muted: muted,
    timeCell: timeCell,
    relativeCell: relativeCell,
    dateCell: dateCell,
    badge: badge,
    matterLink: matterLink,
    nameCell: nameCell,
    countText: countText,
    capitalize: capitalize,
    labelOptions: labelOptions,
    dateRangeFilter: dateRangeFilter,
    emptyText: emptyText,
    bindToolbar: bindToolbar,
    openWorkspace: openWorkspace,
    whenTableReady: whenTableReady
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AdminTableKit = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
