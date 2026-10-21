/**
 * heartbeat-runs-table.js
 * Run History on admin/settings.html (System Heartbeat tab) as a
 * server-paged lex-table (docs/TABLE-STANDARD.md). The table sits inside a
 * settings tab, so its toolbar is the lighter kind: Sort by, order, Status
 * and the count.
 *
 * GET /api/v1/heartbeat/runs pages with limit/offset (max 100) and filters by
 * status. sort_by/sort_order, search, triggered_by and the date and duration
 * ranges are sent for the API to read once it supports them (today its
 * validator drops them).
 *
 * Public API (window.HeartbeatRunsTable, or module.exports in Node):
 *   - toApiParams(query, now)  -> URLSearchParams
 *   - mapRun(run)              -> raw row
 *   - cellRenderers()          -> lex-table renderers
 *   - filterOptions()          -> header filters
 *   - detailHtml(run)          -> drawer body for a run
 *   - init(config)             -> wires the table (browser)
 *
 * @requires admin-table-kit.js, library-column-filters.js, lex.utils.js
 */

(function (global) {
  'use strict';

  var STATUS_COLORS = { completed: 'green', running: 'blue', suppressed: 'yellow', failed: 'red' };
  var STATUSES = ['completed', 'running', 'suppressed', 'failed'];
  var TRIGGERS = ['interval', 'manual', 'startup'];
  var TRIGGER_LABELS = { interval: 'Scheduled', manual: 'Manual', startup: 'Startup' };
  var SORT_BY_COLUMN = { created_at: 'started_at', status: 'status', duration_ms: 'duration_ms' };
  var DURATION_RANGES = {
    lt1s: { label: 'Under 1 s', max: 1000 },
    '1-10s': { label: '1–10 s', min: 1000, max: 10000 },
    '10-60s': { label: '10–60 s', min: 10000, max: 60000 },
    gte60s: { label: '1 min or more', min: 60000 }
  };

  function kit() { return global.AdminTableKit; }

  function toApiParams(query, now) {
    var k = kit();
    var q = query || {};
    var filters = q.filters || {};
    var paging = k.pageOffset(q);
    var params = new URLSearchParams();
    params.set('limit', String(Math.min(paging.limit, 100)));
    params.set('offset', String(paging.offset));
    params.set('sort_by', SORT_BY_COLUMN[q.sortBy] || 'started_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    var status = k.filterValues(filters.status);
    if (status.length === 1) params.set('status', status[0]);
    else if (status.length > 1) params.set('statuses', status.join(','));
    var trigger = k.filterValues(filters.triggered_by);
    if (trigger.length) params.set('triggered_by', trigger.join(','));
    var summary = k.firstFilterValue(filters, 'summary');
    if (summary) params.set('search', summary);
    var duration = DURATION_RANGES[k.firstFilterValue(filters, 'duration_ms')];
    if (duration && duration.min !== undefined) params.set('min_duration_ms', String(duration.min));
    if (duration && duration.max !== undefined) params.set('max_duration_ms', String(duration.max));
    k.setRange(params, filters, 'created_at', 'created_after', 'created_before', now);
    return params;
  }

  function mapRun(run) {
    var duration = Number(run.duration_ms);
    return {
      id: String(run.id || ''),
      summary: run.llm_summary || run.suppressed_reason || '',
      triggered_by: run.triggered_by || '',
      status: run.status || '',
      duration_ms: run.duration_ms === null || run.duration_ms === undefined || !Number.isFinite(duration) ? null : duration,
      created_at: run.started_at || run.created_at || '',
      _raw: run
    };
  }

  function humanize(value) {
    return global.Lex && global.Lex.Utils ? global.Lex.Utils.humanizeLabel(value) : String(value || '');
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined) return '';
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    return Math.floor(ms / 60000) + ' min ' + Math.round((ms % 60000) / 1000) + ' s';
  }

  function cellRenderers() {
    var k = kit();
    return {
      summary: function (val) {
        return val ? '<span class="admin-table-name" title="' + k.esc(val) + '">' + k.esc(val.length > 200 ? val.slice(0, 200) + '…' : val) + '</span>' : k.muted('No summary');
      },
      triggered_by: function (val) {
        return val ? '<span class="admin-table-text">' + k.esc(TRIGGER_LABELS[val] || humanize(val)) + '</span>' : k.muted('');
      },
      status: function (val) { return val ? k.badge(humanize(val), STATUS_COLORS[val] || 'gray') : k.muted(''); },
      duration_ms: function (val) {
        return val === null || val === undefined ? k.muted('') : '<span class="admin-table-text">' + k.esc(formatDuration(val)) + '</span>';
      },
      created_at: function (val) { return k.timeCell(val); }
    };
  }

  function filterOptions() {
    var k = kit();
    return {
      summary: { text: true, placeholder: 'Summary contains...' },
      triggered_by: { options: k.labelOptions(TRIGGERS, TRIGGER_LABELS) },
      status: { options: k.labelOptions(STATUSES) },
      duration_ms: {
        single: true,
        options: Object.keys(DURATION_RANGES).map(function (key) { return { value: key, label: DURATION_RANGES[key].label }; })
      },
      created_at: k.dateRangeFilter()
    };
  }

  function detailHtml(run) {
    var k = kit();
    var r = run || {};
    var html = '<div class="space-y-3">';
    var results = r.plugin_results || {};
    var keys = Object.keys(results);
    if (!keys.length) html += '<p class="text-sm" style="color:var(--lex-text-secondary)">No plugin results for this run.</p>';
    keys.forEach(function (key) {
      var plugin = results[key] || {};
      var color = plugin.status === 'error' ? 'red' : (plugin.status === 'warning' ? 'yellow' : 'green');
      html += '<div class="flex items-start gap-2">' + k.badge(humanize(plugin.status || 'ok'), color) +
        '<div><div class="text-sm font-medium" style="color:var(--lex-text-primary)">' + k.esc(plugin.pluginName || key) + '</div>' +
        '<div class="text-xs" style="color:var(--lex-text-secondary)">' + k.esc(plugin.summary || 'No details') + '</div></div></div>';
    });
    if (r.suppressed_reason) {
      html += '<p class="text-sm" style="color:var(--lex-text-secondary)"><strong>Suppressed:</strong> ' + k.esc(r.suppressed_reason) + '</p>';
    }
    // LLM output is escaped because the model may return HTML-like text.
    if (r.llm_summary) {
      html += '<div class="pt-3" style="border-top:1px solid var(--lex-border-default)"><p class="text-sm" style="color:var(--lex-text-secondary)"><strong>AI summary:</strong> ' + k.esc(r.llm_summary) + '</p></div>';
    }
    return html + '</div>';
  }

  /**
   * config: { tableId, sortId, orderId, filterId, countIds, request(url) }
   * Returns { reload() }.
   */
  function init(config) {
    var doc = global.document;
    var table = doc.getElementById(config.tableId);
    if (!table) return { reload: function () {} };
    var gen = 0;
    var toolbar = null;

    function load(query) {
      var seq = ++gen;
      query = query || table.serverQuery;
      var filtered = Object.keys(query.filters || {}).length > 0;
      if (toolbar) toolbar.syncFilter(query.filters);
      config.request('/api/v1/heartbeat/runs?' + toApiParams(query).toString())
        .then(function (response) {
          if (seq !== gen) return;
          var rows = (response && response.data) || [];
          var pagination = (response && response.pagination) || {};
          table.emptyText = filtered ? 'No matching heartbeat runs. Try different filters.' : 'No heartbeat runs recorded yet.';
          table.setServerData(rows.map(mapRun), {
            page: query.page,
            limit: query.limit,
            total: pagination.total !== undefined ? Number(pagination.total) : rows.length
          });
        })
        .catch(function (error) {
          if (seq !== gen) return;
          console.error('Failed to load heartbeat history:', error);
          if (toolbar) toolbar.setCount(null);
          table.setServerError('Heartbeat history could not be loaded. Check your connection and try again.');
        });
    }

    var ready = kit().whenTableReady().then(function () {
      table.setCellRenderers(cellRenderers());
      table.setColumnFilterOptions(filterOptions());
      toolbar = kit().bindToolbar({
        table: table,
        sortId: config.sortId,
        orderId: config.orderId,
        filterId: config.filterId,
        filterKey: 'status',
        countIds: config.countIds,
        noun: ['run', 'runs']
      });
      table.addEventListener('lex-query-change', function (e) {
        if (e.target === table) load(e.detail);
      });
      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        var run = row && (row._raw || row);
        if (!run || !global.Lex || !global.Lex.Drawer) return;
        global.Lex.Drawer.open({
          heading: 'Heartbeat run',
          subtitle: global.Lex.Utils.formatDateTime(run.started_at || run.created_at),
          content: detailHtml(run),
          width: 'md'
        });
      });
    });

    return {
      reload: function () {
        ready.then(function () { table.requestServerQuery({ resetPage: true }); });
      }
    };
  }

  var moduleApi = {
    STATUS_COLORS: STATUS_COLORS,
    toApiParams: toApiParams,
    mapRun: mapRun,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    detailHtml: detailHtml,
    formatDuration: formatDuration,
    init: init
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.HeartbeatRunsTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
