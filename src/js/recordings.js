// recordings.js - List page for meeting recordings captured by PAC.
//
// View-only: this page browses recordings owned by the current organization
// and links into a per-recording detail page. No capture/upload UI.
//
// One server-paged lex-table (docs/TABLE-STANDARD.md). GET /api/v1/recordings
// pages with limit/offset and filters by status; the other column filters are
// sent under the standard names so they apply once the API reads them.
//
// @requires api.js                    - window.api
// @requires lex.utils.js              - Lex.Utils.formatDateTime, humanizeLabel
// @requires lex-table.js              - server-paged table
// @requires admin-table-kit.js        - AdminTableKit toolbar + query helpers
// @requires library-column-filters.js - date ranges + workspace list

(function () {
  'use strict';

  var TABLE_ID = 'recordingsTable';

  // Statuses GET /api/v1/recordings accepts in ?status= (comma-separated).
  var RECORDING_STATUSES = ['ready', 'transcribing', 'uploading', 'pending', 'failed', 'archived'];

  var STATUS_BADGE_COLOR = {
    ready: 'green',
    transcribing: 'yellow',
    uploading: 'yellow',
    pending: 'gray',
    failed: 'red',
    archived: 'gray'
  };

  var SCOPE_OPTIONS = [
    { value: 'private', label: 'Private' },
    { value: 'organization', label: 'Organization' },
    { value: 'matter', label: 'Matter' }
  ];

  var SCOPE_LABEL = { private: 'Private', organization: 'Organization', matter: 'Matter' };

  // Duration ranges: min inclusive, max exclusive (milliseconds).
  var MINUTE_MS = 60 * 1000;
  var DURATION_RANGES = [
    { value: 'under5', label: 'Under 5 minutes', max: 5 * MINUTE_MS },
    { value: '5to30', label: '5 to 30 minutes', min: 5 * MINUTE_MS, max: 30 * MINUTE_MS },
    { value: '30to60', label: '30 to 60 minutes', min: 30 * MINUTE_MS, max: 60 * MINUTE_MS },
    { value: 'over60', label: 'Over 1 hour', min: 60 * MINUTE_MS }
  ];

  var state = {
    searchTerm: '',
    toolbar: null,
    gen: 0,
    workspaces: {}   // matter uuid -> { name, matter_id }
  };

  function kit() {
    return window.AdminTableKit;
  }

  function table() {
    return document.getElementById(TABLE_ID);
  }

  // -------------------------------------------------------------------------
  // Pure table logic
  // -------------------------------------------------------------------------

  /**
   * GET /api/v1/recordings params for a lex-table server query.
   * @param {Object} query  - { page, limit, sortBy, sortDir, filters }
   * @param {string} search - toolbar search
   * @param {Date} [now]
   * @returns {URLSearchParams}
   */
  function toApiParams(query, search, now) {
    var k = kit();
    var q = query || {};
    var filters = q.filters || {};
    var params = new URLSearchParams();
    var paging = k.pageOffset(q);
    params.set('limit', String(Math.min(paging.limit, 200)));
    params.set('offset', String(paging.offset));
    params.set('sort_by', 'created_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    if (search) params.set('search', search);

    var title = k.firstFilterValue(filters, 'title');
    if (title) params.set('title', title);
    var statuses = k.filterValues(filters.status);
    if (statuses.length) params.set('status', statuses.join(','));
    var scopes = k.filterValues(filters.visibility);
    if (scopes.length) params.set('visibility', scopes.join(','));
    var matters = k.filterValues(filters.matter_id);
    if (matters.length) params.set('matter_id', matters.join(','));
    var owners = k.filterValues(filters.owner_id);
    if (owners.length) params.set('owner_id', owners.join(','));

    var range = durationRange(k.firstFilterValue(filters, 'duration_ms'));
    if (range && range.min !== undefined) params.set('min_duration_ms', String(range.min));
    if (range && range.max !== undefined) params.set('max_duration_ms', String(range.max));

    k.setRange(params, filters, 'created_at', 'created_after', 'created_before', now);
    return params;
  }

  function durationRange(value) {
    for (var i = 0; i < DURATION_RANGES.length; i++) {
      if (DURATION_RANGES[i].value === value) return DURATION_RANGES[i];
    }
    return null;
  }

  function recordingTitle(row) {
    var meta = (row && row.metadata) || {};
    if (meta && typeof meta === 'object' && meta.title) {
      return String(meta.title);
    }
    var id = row && row.id ? String(row.id) : '';
    var short = id ? id.substring(0, 8) : '';
    return short ? 'Recording ' + short : 'Recording';
  }

  function ownerLabel(row) {
    if (!row) return '';
    if (row.owner_name) return String(row.owner_name);
    if (row.owner_email) return String(row.owner_email);
    if (row.owner_id) return 'User ' + String(row.owner_id).substring(0, 8);
    return '';
  }

  /**
   * One row per recording: raw values, the record as _raw.
   * @param {Object} r
   * @returns {Object}
   */
  function mapRecording(r) {
    var row = r || {};
    var duration = Number(row.duration_ms);
    return {
      id: String(row.id || ''),
      title: recordingTitle(row),
      status: String(row.status || 'pending').toLowerCase(),
      visibility: String(row.visibility || 'private').toLowerCase(),
      matter_id: String(row.matter_id || ''),
      owner_id: String(row.owner_id || ''),
      duration_ms: Number.isFinite(duration) && duration > 0 ? duration : null,
      created_at: row.created_at || '',
      _raw: row
    };
  }

  function formatDuration(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    var totalSeconds = Math.round(n / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
    if (hours > 0) {
      return hours + ':' + pad(minutes) + ':' + pad(seconds);
    }
    return pad(minutes) + ':' + pad(seconds);
  }

  function text(value, cls) {
    var k = kit();
    if (!value) return k.muted('');
    return '<span class="' + (cls || 'recordings-cell-text') + '" title="' + k.esc(value) + '">' + k.esc(value) + '</span>';
  }

  function cellRenderers(workspaces) {
    var k = kit();
    var names = workspaces || state.workspaces;
    return {
      title: function (val) {
        return '<span class="recordings-cell-name" title="' + k.esc(val) + '">' + k.esc(val || 'Recording') + '</span>';
      },
      status: function (val) {
        return k.badge(Lex.Utils.humanizeLabel(val), STATUS_BADGE_COLOR[val] || 'gray');
      },
      visibility: function (val) {
        return text(SCOPE_LABEL[val] || Lex.Utils.humanizeLabel(val));
      },
      matter_id: function (val) {
        if (!val) return k.muted('');
        var label = (names[val] && names[val].name) || 'Open workspace';
        return '<button type="button" class="recordings-workspace-link" data-matter-id="' + k.esc(val) + '" title="Open ' + k.esc(label) + '">' +
          '<span>' + k.esc(label) + '</span></button>';
      },
      owner_id: function (val, row) { return text(ownerLabel(row._raw)); },
      duration_ms: function (val) { return text(formatDuration(val), 'recordings-cell-time'); },
      created_at: function (val) {
        if (!val) return k.muted('');
        var full = Lex.Utils.formatDateTime(val);
        return '<time class="recordings-cell-time" datetime="' + k.esc(val) + '" title="' + k.esc(full) + '">' + k.esc(full) + '</time>';
      }
    };
  }

  /**
   * Header filters for every column.
   * @param {Array} workspaceOptions - [{ value: matter uuid, label }]
   * @param {Array} ownerOptions     - [{ value: user id, label }]
   */
  function filterOptions(workspaceOptions, ownerOptions) {
    var k = kit();
    var map = {
      title: { text: true, placeholder: 'Title contains...' },
      status: { options: k.labelOptions(RECORDING_STATUSES) },
      visibility: { options: SCOPE_OPTIONS },
      duration_ms: { single: true, options: DURATION_RANGES.map(function (r) { return { value: r.value, label: r.label }; }) },
      created_at: k.dateRangeFilter()
    };
    if (workspaceOptions && workspaceOptions.length) map.matter_id = { options: workspaceOptions };
    if (ownerOptions && ownerOptions.length) map.owner_id = { options: ownerOptions };
    return map;
  }

  // -------------------------------------------------------------------------
  // Page wiring
  // -------------------------------------------------------------------------

  function init() {
    var target = table();
    if (!target) return;

    var refresh = document.getElementById('recordingsRefresh');
    if (refresh) {
      refresh.addEventListener('click', function () {
        if (table() === target) target.requestServerQuery();
      });
    }

    kit().whenTableReady().then(function () {
      if (table() !== target) return;
      target.setCellRenderers(cellRenderers());
      target.setColumnFilterOptions(filterOptions([], []));
      state.toolbar = kit().bindToolbar({
        table: target,
        searchId: 'recordingsSearch',
        sortId: 'recordingsSort',
        orderId: 'recordingsSortOrder',
        filterId: 'recordingsStatusFilter',
        filterKey: 'status',
        countIds: ['recordingsCount', 'recordingsSectionCount'],
        noun: ['recording', 'recordings'],
        onSearch: function (term) {
          state.searchTerm = term;
          target.requestServerQuery({ resetPage: true });
        }
      });
      target.addEventListener('lex-query-change', function (e) {
        if (e.target !== target) return;
        loadRecordings(e.detail);
      });
      target.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) openRecording(row.id);
      });
      loadFilterSources(target);
      target.requestServerQuery({ resetPage: true });
    });
  }

  function openRecording(id) {
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
      window.Lex.Nav.go('recording-detail.html', { params: { id: id } });
    } else {
      window.location.href = 'recording-detail.html?id=' + encodeURIComponent(id);
    }
  }

  function userOptions(res) {
    var users = Array.isArray(res) ? res : ((res && (res.data || res.users)) || []);
    return users.map(function (u) {
      var name = ((u.first_name || '') + ' ' + (u.last_name || '')).trim();
      return { value: String(u.id || ''), label: String(u.full_name || u.fullName || name || u.email || u.id) };
    }).filter(function (o) { return o.value; });
  }

  // Workspace names (link labels + filter) and owners (filter).
  function loadFilterSources(target) {
    var shared = window.LanaLibraryColumnFilters;
    var workspaces = shared ? shared.loadWorkspaces(api) : Promise.resolve([]);
    var users = api.get('/api/v1/users?limit=100').then(userOptions).catch(function () { return []; });
    Promise.all([workspaces, users]).then(function (results) {
      if (table() !== target) return;
      var names = {};
      (results[0] || []).forEach(function (m) {
        if (m && m.id) names[m.id] = { name: m.name || m.matter_name || m.matter_id || '', matter_id: m.matter_id || '' };
      });
      state.workspaces = names;
      target.setCellRenderers(cellRenderers(names));
      target.setColumnFilterOptions(filterOptions(shared ? shared.workspaceOptions(results[0], 'id') : [], results[1]));
    });
  }

  function loadRecordings(query) {
    var gen = ++state.gen;
    var target = table();
    if (!target) return;
    if (!window.api || !api.isAuthenticated()) return;
    query = query || target.serverQuery;
    var filters = query.filters || {};
    var filtered = Boolean(state.searchTerm || Object.keys(filters).length);
    if (state.toolbar) state.toolbar.syncFilter(filters);

    api.get('/api/v1/recordings?' + toApiParams(query, state.searchTerm).toString())
      .then(function (result) {
        if (gen !== state.gen) return;
        var rows = (result && result.data) || [];
        var pagination = (result && result.pagination) || {};
        target.emptyText = filtered
          ? 'No matching recordings. Try a different search or clear the filters.'
          : 'No recordings yet. Capture a meeting in PAC to see it here.';
        target.setServerData(rows.map(mapRecording), {
          page: query.page,
          limit: query.limit,
          total: typeof pagination.total === 'number' ? pagination.total : rows.length
        });
      })
      .catch(function (err) {
        if (gen !== state.gen) return;
        console.error('[Recordings] Failed to load recordings:', err && err.message ? err.message : err);
        if (state.toolbar) state.toolbar.setCount(null);
        target.setServerError('Recordings could not be loaded. Check your connection and try again.');
      });
  }

  // Pure table logic, exposed for unit tests.
  window.RecordingsTable = {
    toApiParams: toApiParams,
    mapRecording: mapRecording,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    formatDuration: formatDuration,
    DURATION_RANGES: DURATION_RANGES
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
