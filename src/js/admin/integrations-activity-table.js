/**
 * integrations-activity-table.js
 * "Recent External API Calls" on admin/integrations.html as a client-side
 * lex-table (docs/TABLE-STANDARD.md). The page loads the activity list in
 * one request (GET /api/integrations/activity), so lex-table sorts, filters
 * and pages it.
 *
 * Public API (window.IntegrationsActivityTable, or module.exports in Node):
 *   - mapActivity(activity, index) -> raw row
 *   - cellRenderers()              -> lex-table renderers
 *   - filterOptions(rows)          -> header filters
 *   - statusClass(code)            -> 'success' | 'redirect' | 'client_error' | 'server_error' | ''
 *
 * @requires admin-table-kit.js, admin-client-tables.js, lex.utils.js
 */

(function (global) {
  'use strict';

  var STATUS_CLASSES = {
    success: { label: 'Success (2xx)', color: 'green' },
    redirect: { label: 'Redirect (3xx)', color: 'blue' },
    client_error: { label: 'Client error (4xx)', color: 'yellow' },
    server_error: { label: 'Server error (5xx)', color: 'red' }
  };
  var DURATION_RANGES = [
    { value: 'lt100', label: 'Under 100 ms', max: 100 },
    { value: '100-1000', label: '100–999 ms', min: 100, max: 1000 },
    { value: 'gte1000', label: '1 s or more', min: 1000 }
  ];

  function kit() { return global.AdminTableKit; }
  function client() { return global.AdminClientTables; }

  function statusClass(code) {
    var n = Number(code);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 300) return 'success';
    if (n < 400) return 'redirect';
    if (n < 500) return 'client_error';
    return 'server_error';
  }

  function mapActivity(activity, index) {
    var a = activity || {};
    var duration = Number(a.duration);
    var code = Number(a.status);
    return {
      _key: String(a.id || 'call-' + index),
      endpoint: a.endpoint || '',
      service: a.service || '',
      status: Number.isFinite(code) ? code : null,
      status_class: statusClass(a.status),
      duration_ms: a.duration === null || a.duration === undefined || !Number.isFinite(duration) ? null : duration,
      created_at: a.timestamp || a.created_at || '',
      _raw: a
    };
  }

  function cellRenderers() {
    var k = kit();
    return {
      endpoint: function (val) {
        return val ? '<span class="admin-table-name" style="font-family:var(--lex-font-mono,monospace)" title="' + k.esc(val) + '">' + k.esc(val) + '</span>' : k.muted('');
      },
      service: function (val) {
        return val ? '<span class="admin-table-text">' + k.esc(global.Lex.Utils.capitalizeFirst(String(val))) + '</span>' : k.muted('');
      },
      status: function (val, row) {
        if (val === null || val === undefined) return k.muted('');
        var cls = STATUS_CLASSES[row && row.status_class] || { color: 'gray' };
        return k.badge(String(val), cls.color);
      },
      duration_ms: function (val) {
        return val === null || val === undefined ? k.muted('') : '<span class="admin-table-text">' + k.esc(Math.round(val).toLocaleString('en-US') + ' ms') + '</span>';
      },
      created_at: function (val) { return k.timeCell(val); }
    };
  }

  function filterOptions(rows) {
    var c = client();
    return {
      endpoint: { text: true, placeholder: 'Endpoint contains...' },
      service: { options: c.valueOptions(rows, 'service', function (v) { return global.Lex.Utils.capitalizeFirst(String(v)); }) },
      status: {
        options: Object.keys(STATUS_CLASSES).map(function (key) { return { value: key, label: STATUS_CLASSES[key].label }; }),
        match: function (cell, values) { return values.indexOf(statusClass(cell)) !== -1; }
      },
      duration_ms: c.rangeFilter(DURATION_RANGES),
      created_at: c.dateFilter()
    };
  }

  var moduleApi = {
    mapActivity: mapActivity,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    statusClass: statusClass
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.IntegrationsActivityTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
