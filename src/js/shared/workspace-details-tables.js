/**
 * workspace-details-tables.js
 * Rows, cell renderers and column filters for the two tables that open over
 * Workspace Details: the Connected Data modal (cdModalTable) and the
 * Activity drawer (activityDrawerTable). See docs/TABLE-STANDARD.md.
 *
 * Rows keep raw values (entity_type codes, status codes, ISO timestamps) plus
 * the original record as _raw; formatting happens in the renderers.
 *
 * Public API (window.LanaWorkspaceDetailsTables, or module.exports in Node):
 *   Connected data (client-side table: contacts + linked + available records)
 *   - CD_STATUS_OPTIONS, CD_SEARCH_PAGE_SIZE, CD_SEARCH_MAX_PAGES
 *   - contactRow(contact, index)              -> row
 *   - connectorRow(record, status)            -> row ('linked' | 'available')
 *   - buildConnectedDataRows(input)           -> rows (contacts, linked, available; deduped)
 *   - connectedDataRenderers()                -> lex-table cell renderers
 *   - connectedDataFilterOptions(rows, ranges)-> setColumnFilterOptions map
 *   - connectedDataEmptyText(filtered)        -> empty-state copy
 *   Activity (server-paged: GET /api/v1/activity/matter/:id?limit&offset)
 *   - activityRow(activity, index)            -> row
 *   - activityRequest(query)                  -> { limit, offset }
 *   - activityPagination(response, query, n)  -> { page, limit, total }
 *   - activityRenderers({ describe })         -> lex-table cell renderers
 */

(function (global) {
  'use strict';

  // The search-connector-data endpoint serves at most 50 per page.
  var CD_SEARCH_PAGE_SIZE = 50;
  // Stop after 10 pages (500 rows): past that the modal is no longer a
  // client-side table and needs server paging (see the backend gaps).
  var CD_SEARCH_MAX_PAGES = 10;

  var CD_STATUS_OPTIONS = [
    { value: 'linked', label: 'Linked' },
    { value: 'available', label: 'Available' }
  ];

  var CD_STATUS_COLORS = { linked: 'green', available: 'gray' };

  function utils() {
    return global && global.Lex && global.Lex.Utils ? global.Lex.Utils : null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function muted(text) {
    return '<span class="wd-table-muted">' + esc(text || '—') + '</span>';
  }

  /** An enum, slug or dotted event code as a label: "time_entry" -> "Time entry". */
  function label(value) {
    var text = value == null ? '' : String(value).split('.').join(' ');
    var u = utils();
    if (u && typeof u.humanizeLabel === 'function') return u.humanizeLabel(text);
    text = text.split('_').join(' ').split('-').join(' ').split(' ').filter(Boolean).join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function dateTime(value) {
    var u = utils();
    if (!value || !u || typeof u.formatDateTime !== 'function') return '';
    var text = u.formatDateTime(value);
    return text === 'Never' ? '' : text;
  }

  function relative(value) {
    var u = utils();
    if (!value || !u || typeof u.timeAgo !== 'function') return '';
    var text = u.timeAgo(value);
    return text === '-' ? '' : text;
  }

  // "Created": full date and time; the relative time goes in the tooltip.
  function createdCell(value) {
    var full = dateTime(value);
    if (!full) return muted('');
    return '<time class="wd-table-time" datetime="' + esc(value) + '" title="' + esc(relative(value)) + '">' + esc(full) + '</time>';
  }

  // -------------------------------------------------------------------------
  // Connected data
  // -------------------------------------------------------------------------

  function contactRow(contact, index) {
    var c = contact || {};
    var name = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || c.display_name || 'Unknown';
    return {
      id: 'contact_' + (c.id || index),
      name: name,
      type: 'contact',
      source: 'LANA',
      detail: c.email || c.phone || '',
      status: 'linked',
      created_at: c.created_at || '',
      _linkType: 'contact',
      _raw: c
    };
  }

  function connectorRow(record, status) {
    var r = record || {};
    var data = r.data || {};
    return {
      id: r.id || '',
      name: data.name || data.title || r.external_id || '',
      type: r.entity_type || '',
      source: r.connector_name || r.connector_id || '',
      detail: data.description || data.email || data.status || r.external_id || '',
      status: status === 'linked' ? 'linked' : 'available',
      created_at: r.created_at || '',
      _linkType: 'connector',
      _raw: r
    };
  }

  /**
   * The modal's rows: the matter's contacts, its linked connector records and
   * the records available to link. The toolbar's search, type and connector
   * apply to contacts and linked records here; the server applies them to
   * the available ones.
   * @param {{contacts: Array, linkedGroups: Object, available: Array,
   *          search: string, entityType: string, connectorId: string}} input
   * @returns {Array}
   */
  function buildConnectedDataRows(input) {
    var opts = input || {};
    var searchLower = String(opts.search || '').trim().toLowerCase();
    var entityType = opts.entityType || '';
    var connectorId = opts.connectorId || '';
    var rows = [];

    if (!entityType || entityType === 'contact') {
      (opts.contacts || []).forEach(function (contact, index) {
        var row = contactRow(contact, index);
        if (searchLower) {
          var haystack = (row.name + ' ' + (contact.email || '') + ' ' + (contact.phone || '')).toLowerCase();
          if (haystack.indexOf(searchLower) === -1) return;
        }
        rows.push(row);
      });
    }

    var linkedIds = {};
    var groups = opts.linkedGroups || {};
    Object.keys(groups).forEach(function (key) {
      var records = groups[key];
      if (!Array.isArray(records)) return;
      records.forEach(function (record) {
        if (entityType && record.entity_type !== entityType) return;
        if (connectorId && record.connector_id !== connectorId) return;
        var row = connectorRow(record, 'linked');
        if (searchLower) {
          var haystack = (row.name + ' ' + row.detail + ' ' + (record.connector_name || '')).toLowerCase();
          if (haystack.indexOf(searchLower) === -1) return;
        }
        if (record.id) linkedIds[record.id] = true;
        rows.push(row);
      });
    });

    (opts.available || []).forEach(function (record) {
      if (record && linkedIds[record.id]) return;
      rows.push(connectorRow(record, 'available'));
    });

    return rows;
  }

  function connectedDataRenderers() {
    return {
      name: function (value) {
        if (!value) return muted('');
        return '<span class="wd-table-name" title="' + esc(value) + '">' + esc(value) + '</span>';
      },
      type: function (value) {
        return value ? '<span class="wd-table-text">' + esc(label(value)) + '</span>' : muted('');
      },
      source: function (value) {
        return value ? '<span class="wd-table-text" title="' + esc(value) + '">' + esc(value) + '</span>' : muted('');
      },
      detail: function (value) {
        return value ? '<span class="wd-table-text wd-table-muted" title="' + esc(value) + '">' + esc(value) + '</span>' : muted('');
      },
      status: function (value) {
        if (!value) return muted('');
        return '<lex-badge label="' + esc(label(value)) + '" color="' + (CD_STATUS_COLORS[value] || 'gray') + '"></lex-badge>';
      },
      created_at: createdCell
    };
  }

  function uniqueSorted(rows, key) {
    var seen = {};
    var values = [];
    (rows || []).forEach(function (row) {
      var value = row && row[key];
      if (!value || seen[value]) return;
      seen[value] = true;
      values.push(String(value));
    });
    return values.sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); });
  }

  /**
   * Header filters for every column. Type labels are humanized; sources are
   * connector names and display as stored.
   * @param {Array} rows
   * @param {Object} [ranges] - LanaLibraryColumnFilters
   */
  function connectedDataFilterOptions(rows, ranges) {
    var map = {
      name: { text: true, placeholder: 'Name contains...' },
      type: { options: uniqueSorted(rows, 'type').map(function (v) { return { value: v, label: label(v) }; }) },
      source: { options: uniqueSorted(rows, 'source').map(function (v) { return { value: v, label: v }; }) },
      detail: { text: true, placeholder: 'Detail contains...' },
      status: { options: CD_STATUS_OPTIONS }
    };
    if (ranges && ranges.EDITED_RANGE_OPTIONS) {
      map.created_at = {
        single: true,
        options: ranges.EDITED_RANGE_OPTIONS,
        match: function (cell, values) { return ranges.inEditedRange(cell, values[0]); }
      };
    }
    return map;
  }

  function connectedDataEmptyText(filtered) {
    return filtered
      ? 'No matching records. Try a different search or clear the filters.'
      : 'No data available. Connect an integration to sync data.';
  }

  // -------------------------------------------------------------------------
  // Activity
  // -------------------------------------------------------------------------

  function activityRow(activity, index) {
    var act = activity || {};
    return {
      id: act.id != null ? String(act.id) : 'idx-' + index,
      message: act.display_message || act.event_type || act.action_type || act.type || '',
      type: act.resource_type || '',
      created_at: act.created_at || act.activity_timestamp || '',
      _raw: act,
      _activity: act
    };
  }

  /** lex-table query -> the endpoint's limit/offset. */
  function activityRequest(query) {
    var q = query || {};
    var limit = Math.max(1, Number(q.limit) || 20);
    var page = Math.max(1, Number(q.page) || 1);
    return { limit: limit, offset: (page - 1) * limit };
  }

  /** The endpoint answers { total, limit, offset }; lex-table wants a page. */
  function activityPagination(response, query, visibleCount) {
    var request = activityRequest(query);
    var source = (response && response.pagination) || {};
    var limit = Number(source.limit) || request.limit;
    var offset = Number(source.offset);
    var total = Number(source.total);
    return {
      page: Number.isFinite(offset) ? Math.floor(offset / limit) + 1 : Math.floor(request.offset / limit) + 1,
      limit: limit,
      total: Number.isFinite(total) ? total : request.offset + Number(visibleCount || 0)
    };
  }

  /**
   * @param {{describe: function(Object): string}} options - describe returns
   *   the activity sentence as safe HTML (the page's getActivityDescription).
   */
  function activityRenderers(options) {
    var describe = options && typeof options.describe === 'function' ? options.describe : null;
    return {
      message: function (value, row) {
        var html = describe && row && row._raw ? describe(row._raw) : esc(label(value));
        return '<span class="wd-table-name">' + (html || esc('—')) + '</span>';
      },
      type: function (value) {
        return value ? '<span class="wd-table-text">' + esc(label(value)) + '</span>' : muted('');
      },
      created_at: createdCell
    };
  }

  var moduleApi = {
    CD_STATUS_OPTIONS: CD_STATUS_OPTIONS,
    CD_SEARCH_PAGE_SIZE: CD_SEARCH_PAGE_SIZE,
    CD_SEARCH_MAX_PAGES: CD_SEARCH_MAX_PAGES,
    label: label,
    contactRow: contactRow,
    connectorRow: connectorRow,
    buildConnectedDataRows: buildConnectedDataRows,
    connectedDataRenderers: connectedDataRenderers,
    connectedDataFilterOptions: connectedDataFilterOptions,
    connectedDataEmptyText: connectedDataEmptyText,
    activityRow: activityRow,
    activityRequest: activityRequest,
    activityPagination: activityPagination,
    activityRenderers: activityRenderers
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaWorkspaceDetailsTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
