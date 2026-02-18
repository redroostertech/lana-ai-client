/**
 * Data Table Widget
 *
 * Renders a scrollable table of connector data records.
 * Extracts columns from the first row's normalized or raw data.
 * Caps display at 5 columns and respects the config.limit setting.
 * Status-like column values are rendered as badge pills.
 * Styled to match the module-execution.html design system table pattern.
 *
 * Config options (widget.config):
 *   entity_type  {string} - Label for the data being shown
 *   limit        {number} - Max rows to display (default: 10)
 *   connector_id {string} - Optional connector filter
 *
 * Expected data shape from backend:
 *   {
 *     data: [
 *       { normalized: { field: value, ... }, raw_data: { ... } },
 *       ...
 *     ],
 *     pagination: { total: number }
 *   }
 *
 * Design system: matches module-execution.html table header (uppercase tracking-wider),
 * alternating rows (bg-white/bg-gray-50), hover:bg-indigo-50, and status badge pills.
 */
(function() {
  /**
   * Column names that should be rendered as status badge pills.
   * Checked using indexOf - no regex.
   */
  var STATUS_COLUMN_NAMES = ['status', 'sync_status', 'state', 'result', 'outcome'];

  WidgetRenderer.registerRenderer('data_table', {
    /**
     * Render the data table.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data returned by the backend
     * @param {Object} config - Widget config (entity_type, limit)
     */
    render: function(container, data, config) {
      var rows = [];
      if (data && data.data && Array.isArray(data.data)) {
        rows = data.data;
      }

      if (rows.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-sm text-gray-400">No data available</div>';
        return;
      }

      var displayLimit = (config && config.limit) ? config.limit : 10;

      // Derive columns from the first row (max 5 columns for readability)
      var firstRow = rows[0];
      var rowData = firstRow.normalized || firstRow.raw_data || firstRow;
      var columns = Object.keys(rowData).slice(0, 5);

      var html = '<div class="overflow-x-auto">';
      html += '<table class="w-full text-sm">';

      // Table header
      html += '<thead><tr class="border-b border-gray-200 bg-gray-50">';
      columns.forEach(function(col) {
        html += '<th class="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">'
          + escapeHtml(col.split('_').join(' '))
          + '</th>';
      });
      html += '</tr></thead>';

      // Table body
      html += '<tbody class="divide-y divide-gray-100">';
      rows.slice(0, displayLimit).forEach(function(row, idx) {
        var rd = row.normalized || row.raw_data || row;
        html += '<tr class="' + (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50') + ' hover:bg-indigo-50 transition-colors">';
        columns.forEach(function(col) {
          var val = rd[col];
          if (val === null || val === undefined) {
            val = '-';
          } else if (typeof val === 'object') {
            val = JSON.stringify(val);
          } else {
            val = String(val);
          }

          // Render status columns as badge pills
          if (isStatusColumn(col)) {
            html += '<td class="py-2 px-3">'
              + '<span class="px-2 py-1 text-xs font-semibold rounded-full ' + resolveStatusBadgeClasses(val) + '">'
              + escapeHtml(val)
              + '</span>'
              + '</td>';
          } else {
            html += '<td class="py-2 px-3 text-gray-700 truncate max-w-[180px]" title="' + escapeHtml(val) + '">'
              + escapeHtml(val)
              + '</td>';
          }
        });
        html += '</tr>';
      });
      html += '</tbody>';
      html += '</table>';
      html += '</div>';

      // Pagination summary
      if (data.pagination && data.pagination.total > displayLimit) {
        html += '<div class="mt-2 text-xs text-gray-400 text-right">'
          + 'Showing ' + Math.min(rows.length, displayLimit) + ' of ' + data.pagination.total
          + '</div>';
      }

      container.innerHTML = html;
    }
  });

  /**
   * Determine whether a column name represents a status field.
   * Uses indexOf for exact membership check - no regex.
   * @param {string} colName - Column name
   * @returns {boolean}
   */
  function isStatusColumn(colName) {
    return STATUS_COLUMN_NAMES.indexOf(colName) !== -1;
  }

  /**
   * Map a status value string to Tailwind badge classes.
   * Uses exact string equality comparison - no regex.
   * @param {string} val - Status value string
   * @returns {string} Tailwind class string
   */
  function resolveStatusBadgeClasses(val) {
    var lower = val.toLowerCase();
    if (lower === 'active' || lower === 'success' || lower === 'completed' || lower === 'approved') {
      return 'bg-green-100 text-green-800';
    }
    if (lower === 'error' || lower === 'failed' || lower === 'rejected') {
      return 'bg-red-100 text-red-800';
    }
    if (lower === 'syncing' || lower === 'running' || lower === 'pending' || lower === 'processing') {
      return 'bg-blue-100 text-blue-800';
    }
    return 'bg-gray-100 text-gray-800';
  }

  /**
   * Escape text for safe insertion into innerHTML.
   * @param {string} text - Raw text
   * @returns {string} HTML-safe string
   */
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();
