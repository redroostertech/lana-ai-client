/**
 * Admin Active Sessions — standalone page controller.
 *
 * One server-paged lex-table (docs/TABLE-STANDARD.md): toolbar search, Sort
 * by, a Device filter and header filters on every column. Row-click opens
 * the session-details page.
 *
 * @requires api.js                  - window.api.get
 * @requires lex.utils.js            - Lex.Utils.formatDateTime, timeAgo, humanizeLabel
 * @requires lex-table.js            - server paging (setServerData)
 * @requires admin-table-kit.js      - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range filter bounds
 * @requires lex-nav.js              - Lex.Nav.go
 */

(function () {
  'use strict';

  var TABLE_ID = 'sessionsTable';

  /** A session is Active when it was used in the last five minutes. */
  var ACTIVE_WINDOW_MS = 5 * 60 * 1000;

  // Table column -> admin sessions API sort_by. last_activity and user_email
  // are on the API's allow-list but break its SQL, so they are not sortable here.
  var SORT_BY_COLUMN = { created_at: 'created_at', expires_at: 'expires_at' };

  var DEVICES = ['Desktop', 'Mobile', 'Tablet'];

  /** Generation counter: drops stale answers. */
  var _gen = 0;
  var _searchTerm = '';
  var _toolbar = null;

  function el(id) {
    return document.getElementById(id);
  }

  function kit() {
    return window.AdminTableKit;
  }

  /**
   * Whether a session was active in the last five minutes.
   * @param {string} lastActivity
   * @param {number} [nowMs]
   */
  function isSessionActive(lastActivity, nowMs) {
    if (!lastActivity) return false;
    var date = Lex.Utils.parseApiUtcDate ? Lex.Utils.parseApiUtcDate(lastActivity) : new Date(lastActivity);
    var time = date ? date.getTime() : NaN;
    if (!Number.isFinite(time)) return false;
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    return now - time < ACTIVE_WINDOW_MS;
  }

  /**
   * The admin sessions API query for a lex-table server query. Filters the
   * API does not read yet go under the standard names (see the report).
   */
  function toApiParams(query, search, now) {
    var k = kit();
    var q = query || {};
    var filters = q.filters || {};
    var params = new URLSearchParams();
    params.set('page', String(q.page || 1));
    params.set('page_size', String(q.limit || 20));
    params.set('sort_by', SORT_BY_COLUMN[q.sortBy] || 'created_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    if (search) params.set('search', search);
    var user = k.firstFilterValue(filters, 'user');
    if (user) params.set('user', user);
    var devices = k.filterValues(filters.device);
    if (devices.length) params.set('device_filter', devices.join(','));
    var ip = k.firstFilterValue(filters, 'ip_address');
    if (ip) params.set('ip_address_filter', ip);
    var status = k.filterValues(filters.status);
    if (status.length === 1) params.set('activity_status', status[0]);
    k.setRange(params, filters, 'created_at', 'created_after', 'created_before', now);
    k.setRange(params, filters, 'last_activity', 'last_activity_after', 'last_activity_before', now);
    k.setRange(params, filters, 'expires_at', 'expires_after', 'expires_before', now);
    return params;
  }

  function mapSession(s, nowMs) {
    return {
      id:            String(s.session_id || s.id || ''),
      user:          String(s.user_name || s.user_email || s.username || ''),
      device:        String(s.device || ''),
      ip_address:    String(s.ip_address || ''),
      created_at:    s.created_at || '',
      last_activity: s.last_activity || '',
      expires_at:    s.expires_at || '',
      status:        isSessionActive(s.last_activity, nowMs) ? 'active' : 'idle',
      _raw:          s
    };
  }

  function cellRenderers() {
    var k = kit();
    return {
      user: function (val, row) {
        var email = String(row._raw.user_email || '');
        return k.nameCell(val || email, email && email !== val ? email : '');
      },
      device: function (val, row) {
        var browser = row._raw.browser && row._raw.browser !== 'Unknown' ? row._raw.browser : '';
        var os = row._raw.os && row._raw.os !== 'Unknown' ? row._raw.os : '';
        var detail = [browser, os].filter(Boolean).join(' / ');
        if (!val && !detail) return k.muted('');
        return '<span class="admin-table-text">' + k.esc(Lex.Utils.capitalizeFirst(val || detail)) + '</span>' +
          (val && detail ? '<span class="admin-table-sub">' + k.esc(detail) + '</span>' : '');
      },
      ip_address: function (val, row) {
        var location = row._raw.location;
        return val ? '<span class="admin-table-text" title="' + k.esc(location || val) + '">' + k.esc(val) + '</span>' : k.muted('');
      },
      created_at: function (val) { return k.timeCell(val); },
      last_activity: function (val) { return k.relativeCell(val); },
      expires_at: function (val) { return k.timeCell(val); },
      status: function (val) {
        return k.badge(val === 'active' ? 'Active' : 'Idle', val === 'active' ? 'green' : 'gray');
      }
    };
  }

  function filterOptions() {
    var k = kit();
    return {
      user:          { text: true, placeholder: 'User contains...' },
      device:        { options: k.labelOptions(DEVICES) },
      ip_address:    { text: true, placeholder: 'IP address is...' },
      created_at:    k.dateRangeFilter(),
      last_activity: k.dateRangeFilter(),
      expires_at:    k.dateRangeFilter(),
      status:        { single: true, options: [{ value: 'active', label: 'Active' }, { value: 'idle', label: 'Idle' }] }
    };
  }

  function fetchSessions(query) {
    var gen = ++_gen;
    var table = el(TABLE_ID);
    if (!table) return;
    query = query || table.serverQuery;
    var filters = query.filters || {};
    var filtered = Boolean(_searchTerm || Object.keys(filters).length);
    if (_toolbar) _toolbar.syncFilter(filters);

    api.get('/api/v1/admin/sessions?' + toApiParams(query, _searchTerm).toString())
      .then(function (result) {
        if (gen !== _gen) return;
        var sessions = (result && (result.sessions || result.data)) || [];
        var pagination = (result && result.pagination) || {};
        var total = pagination.total_count !== undefined ? pagination.total_count
          : (pagination.total !== undefined ? pagination.total : (result && result.total));
        var now = Date.now();
        table.emptyText = kit().emptyText(filtered, 'sessions');
        table.setServerData(sessions.map(function (s) { return mapSession(s, now); }), {
          page: pagination.page || query.page,
          page_size: pagination.page_size || query.limit,
          total: Number.isFinite(Number(total)) ? Number(total) : sessions.length,
          total_pages: pagination.total_pages
        });
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        console.error('[admin-sessions] loadSessions error:', err);
        if (_toolbar) _toolbar.setCount(null);
        table.setServerError('Sessions could not be loaded. Check your connection and try again.');
      });
  }

  function init() {
    var table = el(TABLE_ID);
    if (!table) return;

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      table.requestServerQuery();
    });

    kit().whenTableReady().then(function () {
      if (el(TABLE_ID) !== table) return;
      table.setCellRenderers(cellRenderers());
      table.setColumnFilterOptions(filterOptions());
      _toolbar = kit().bindToolbar({
        table: table,
        searchId: 'sessionsSearch',
        sortId: 'sessionsSort',
        orderId: 'sessionsSortOrder',
        filterId: 'sessionsDeviceFilter',
        filterKey: 'device',
        countIds: ['sessionsCount', 'sessionsSectionCount'],
        noun: ['session', 'sessions'],
        onSearch: function (term) {
          _searchTerm = term;
          table.requestServerQuery({ resetPage: true });
        }
      });
      table.addEventListener('lex-query-change', function (e) {
        if (e.target === table) fetchSessions(e.detail);
      });
      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) {
          Lex.Nav.go('admin/session-details.html', {
            params: { sessionId: row.id },
            context: { session: row._raw }
          });
        }
      });
      table.requestServerQuery({ resetPage: true });
    });
  }

  // Pure table logic, exposed for unit tests.
  window.AdminSessionsTable = {
    toApiParams: toApiParams,
    mapSession: mapSession,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    isSessionActive: isSessionActive,
    SORT_BY_COLUMN: SORT_BY_COLUMN
  };

  init();

})();
