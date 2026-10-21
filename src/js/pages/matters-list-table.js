/**
 * matters-list-table.js
 * The Matters page list view (matters.html #mattersListTable) on the table
 * standard (docs/TABLE-STANDARD.md): query mapping, raw rows, cell renderers
 * and header filters. matters.html owns the fetch, the grid view and the
 * toggle; this file holds the pure table logic so it can be unit tested.
 *
 * Public API (window.MattersListTable, or module.exports in Node):
 *   - toApiParams(query, context)  -> URLSearchParams for GET /api/v1/matters
 *   - pinnedFilters(query, context) -> filters for api.getPinnedMatters
 *   - mapMatter(matter)            -> one raw table row (record as _raw)
 *   - cellRenderers()              -> lex-table renderers
 *   - filterOptions()              -> header filter config for every column
 *   - emptyText(filtered)          -> { text, actionLabel }
 *   - STATUS_FILTER_OPTIONS, SHARED_FILTER
 *
 * @requires list-query-params.js   - LanaListQueryParams.mattersParams
 * @requires library-column-filters.js - date-range options and bounds
 * @requires admin-table-kit.js     - AdminTableKit cell helpers
 * @requires lex.utils.js           - Lex.Utils.humanizeLabel
 */

(function (global) {
  'use strict';

  // The toolbar Status select adds "Shared with me" to the matter statuses.
  // It rides in the status filter and becomes shared_only=true.
  var SHARED_FILTER = 'shared';

  var STATUS_COLORS = { active: 'green', inactive: 'gray', closed: 'blue', archived: 'gray' };
  var TYPE_LABELS = { matter: 'Client matter', workspace: 'Workspace' };

  var STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'closed', label: 'Closed' },
    { value: 'archived', label: 'Archived' },
    { value: SHARED_FILTER, label: 'Shared with me' }
  ];

  function queryHelpers() {
    return (global && global.LanaListQueryParams) || null;
  }

  function kit() {
    return (global && global.AdminTableKit) || null;
  }

  function humanize(value) {
    var lex = global && global.Lex && global.Lex.Utils;
    if (lex && typeof lex.humanizeLabel === 'function') return lex.humanizeLabel(value);
    var text = String(value == null ? '' : value).split('_').join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function firstValue(filters, col) {
    var helpers = queryHelpers();
    return helpers ? (helpers.filterValues(filters && filters[col])[0] || '') : '';
  }

  /**
   * GET /api/v1/matters params for a lex-table server query.
   * Builds on the Workspaces mapping (mattersParams) and adds what this page
   * has on top: the Client column filter and "Shared with me".
   * @param {Object} query - { page, limit, sortBy, sortDir, filters }
   * @param {Object} [context] - { search, includeAll, now }
   * @returns {URLSearchParams}
   */
  function toApiParams(query, context) {
    var q = query || {};
    var ctx = context || {};
    var filters = q.filters || {};
    var shared = firstValue(filters, 'status') === SHARED_FILTER;
    var scoped = Object.assign({}, filters);
    if (shared) delete scoped.status;
    var params = queryHelpers().mattersParams(Object.assign({}, q, { filters: scoped }), {
      search: ctx.search,
      // "Shared with me" lists other people's matters shared with this user,
      // so it never widens to the whole organization.
      includeAll: Boolean(ctx.includeAll) && !shared,
      now: ctx.now
    });
    if (shared) params.set('shared_only', 'true');
    var client = firstValue(filters, 'client_name');
    if (client) params.set('client_name', client);
    return params;
  }

  /**
   * Filters for the pinned matters shown above the list on page 1.
   * @param {Object} query
   * @param {Object} [context] - { search, includeAll }
   * @returns {Object}
   */
  function pinnedFilters(query, context) {
    var filters = (query && query.filters) || {};
    var ctx = context || {};
    var status = firstValue(filters, 'status');
    var shared = status === SHARED_FILTER;
    var out = { search: ctx.search || '', include_all: Boolean(ctx.includeAll) && !shared };
    if (shared) out.shared_only = true;
    else if (status) out.status = status;
    if (status === 'archived') out.include_archived = true;
    var type = firstValue(filters, 'matter_type');
    if (type) out.matter_type = type;
    return out;
  }

  // Rows keep raw values; the renderers format them.
  function mapMatter(matter) {
    var m = matter || {};
    return {
      matter_id: String(m.matter_id || m.id || ''),
      name: m.name || m.matter_name || 'Untitled',
      client_name: m.client_name || '',
      status: String(m.status || 'active').toLowerCase(),
      matter_type: m.matter_type || 'workspace',
      created_at: m.created_at || '',
      updated_at: m.updated_at || '',
      actions: '',
      source: m.source || 'lana',
      is_pinned: Boolean(m.is_pinned),
      _raw: m
    };
  }

  function actionButton(action, label, row, extraClass) {
    var k = kit();
    return '<button type="button" class="matters-list-action' + (extraClass ? ' ' + extraClass : '') + '"' +
      ' data-action="' + action + '" data-row-matter-id="' + k.esc(row.matter_id) + '"' +
      ' data-source="' + k.esc(row.source || 'lana') + '" data-pinned="' + (row.is_pinned ? 'true' : 'false') + '"' +
      ' title="' + k.esc(label) + '" aria-label="' + k.esc(label + ' ' + row.name) + '">' + k.esc(label) + '</button>';
  }

  function cellRenderers() {
    var k = kit();
    return {
      // The matter opens its details page (workspace-details.html?id=).
      name: function (val, row) {
        var description = row && row._raw && row._raw.description;
        return k.matterLink(row.matter_id, val || 'Untitled') +
          (description ? '<span class="admin-table-sub" title="' + k.esc(description) + '">' + k.esc(description) + '</span>' : '');
      },
      client_name: function (val) {
        return val ? '<span class="admin-table-text" title="' + k.esc(val) + '">' + k.esc(val) + '</span>' : k.muted('');
      },
      matter_id: function (val) {
        return val ? '<span class="admin-table-muted matters-list-id" title="' + k.esc(val) + '">' + k.esc(val) + '</span>' : k.muted('');
      },
      status: function (val) {
        var key = String(val || 'active').toLowerCase();
        return k.badge(humanize(key), STATUS_COLORS[key] || 'gray');
      },
      matter_type: function (val) {
        var key = String(val || '');
        return key ? k.badge(TYPE_LABELS[key] || humanize(key), key === 'matter' ? 'blue' : 'green') : k.muted('');
      },
      created_at: function (val) { return k.timeCell(val); },
      updated_at: function (val) { return k.relativeCell(val); },
      actions: function (val, row) {
        return '<span class="matters-list-actions">' +
          actionButton('pin', row.is_pinned ? 'Unpin' : 'Pin', row) +
          actionButton('edit', 'Edit', row) +
          actionButton('delete', 'Delete', row, 'matters-list-action--danger') +
          '</span>';
      }
    };
  }

  // Every data column filters. Status and Type are single-choice because the
  // API takes one value each.
  function filterOptions() {
    var helpers = queryHelpers();
    var k = kit();
    var map = {
      name: { text: true, placeholder: 'Name contains...' },
      client_name: { text: true, placeholder: 'Client contains...' },
      matter_id: { text: true, placeholder: 'Matter ID contains...' },
      created_at: k.dateRangeFilter(),
      updated_at: k.dateRangeFilter()
    };
    if (helpers) {
      map.status = { single: true, options: helpers.MATTER_STATUS_OPTIONS };
      map.matter_type = { single: true, options: helpers.MATTER_TYPE_OPTIONS };
    }
    return map;
  }

  // A filtered-empty table offers Clear filters instead of the create button.
  function emptyText(filtered) {
    return filtered
      ? { text: 'No matching matters. Try a different search or clear the filters.', actionLabel: '' }
      : { text: 'No matters yet', actionLabel: 'New Matter' };
  }

  var moduleApi = {
    SHARED_FILTER: SHARED_FILTER,
    STATUS_FILTER_OPTIONS: STATUS_FILTER_OPTIONS,
    STATUS_COLORS: STATUS_COLORS,
    TYPE_LABELS: TYPE_LABELS,
    toApiParams: toApiParams,
    pinnedFilters: pinnedFilters,
    mapMatter: mapMatter,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    emptyText: emptyText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.MattersListTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
