/**
 * Connector Status Widget
 *
 * Displays a list of configured integrations with their last-sync time
 * and a status badge pill (green=active, red=error, blue=syncing, gray=unknown).
 * Styled to match the module-execution.html design system badge pattern.
 *
 * Config options (widget.config):
 *   (none currently used)
 *
 * Expected data shape from backend:
 *   {
 *     data: [
 *       {
 *         connector_name: string,  // or name
 *         sync_status: string,     // 'active' | 'error' | 'failed' | 'syncing' | 'pending' | 'unknown'
 *         status: string,          // fallback status field
 *         last_synced_at: string   // ISO 8601
 *       },
 *       ...
 *     ]
 *   }
 *
 * Design system: uses px-2 py-0.5 rounded-full badge pills matching
 * module-execution.html status badge pattern.
 */
(function() {
  WidgetRenderer.registerRenderer('connector_status', {
    /**
     * Render the connector status list.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data returned by the backend
     * @param {Object} config - Widget config (currently unused)
     */
    render: function(container, data, config) {
      var connectors = [];
      if (data && data.data && Array.isArray(data.data)) {
        connectors = data.data;
      }

      if (connectors.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-sm text-gray-400">No connectors configured</div>';
        return;
      }

      // Sync icon SVG used before "Last sync" label
      var syncIconSvg = '<svg class="w-3 h-3 inline-block mr-0.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" '
        + 'd="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15">'
        + '</path>'
        + '</svg>';

      var html = '<div class="space-y-2 max-h-[300px] overflow-y-auto">';

      connectors.forEach(function(conn) {
        var status = conn.sync_status || conn.status || 'unknown';
        var badgeClasses = resolveBadgeClasses(status);
        var lastSync = conn.last_synced_at ? formatTimeAgo(conn.last_synced_at) : 'Never';
        var connName = conn.connector_name || conn.name || 'Connector';
        var statusLabel = resolveStatusLabel(status);

        html += '<div class="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors">'

          // Name + status badge
          + '<div class="flex items-center gap-2 min-w-0">'
          + '<span class="text-sm font-medium text-gray-900 truncate max-w-[140px]">'
          + escapeHtml(connName)
          + '</span>'
          + '<span class="px-2 py-0.5 text-xs font-semibold rounded-full flex-shrink-0 ' + badgeClasses + '">'
          + escapeHtml(statusLabel)
          + '</span>'
          + '</div>'

          // Last sync time with sync icon
          + '<div class="text-xs text-gray-500 flex-shrink-0 flex items-center">'
          + syncIconSvg
          + escapeHtml(lastSync)
          + '</div>'

          + '</div>';
      });

      html += '</div>';
      container.innerHTML = html;
    }
  });

  /**
   * Map a sync status string to Tailwind badge class string.
   * Uses exact string equality - no regex or pattern matching.
   * @param {string} status - Status string from backend
   * @returns {string} Tailwind class string for the badge
   */
  function resolveBadgeClasses(status) {
    if (status === 'active' || status === 'success' || status === 'completed') {
      return 'bg-green-100 text-green-800';
    }
    if (status === 'error' || status === 'failed') {
      return 'bg-red-100 text-red-800';
    }
    if (status === 'syncing' || status === 'running' || status === 'pending') {
      return 'bg-blue-100 text-blue-800';
    }
    return 'bg-gray-100 text-gray-800';
  }

  /**
   * Map a sync status string to a human-readable label.
   * Uses exact string equality - no regex or pattern matching.
   * @param {string} status - Status string from backend
   * @returns {string} Display label
   */
  function resolveStatusLabel(status) {
    if (status === 'active') return 'Active';
    if (status === 'success') return 'Success';
    if (status === 'completed') return 'Completed';
    if (status === 'error') return 'Error';
    if (status === 'failed') return 'Failed';
    if (status === 'syncing') return 'Syncing';
    if (status === 'running') return 'Running';
    if (status === 'pending') return 'Pending';
    return 'Unknown';
  }

  /**
   * Format an ISO date string as a human-readable relative time.
   * @param {string} dateStr - ISO 8601 date string
   * @returns {string} Relative time string
   */
  function formatTimeAgo(dateStr) {
    return LanaTime.timeAgo(dateStr);
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
