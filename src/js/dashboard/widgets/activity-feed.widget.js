/**
 * Activity Feed Widget
 *
 * Displays a scrollable list of recent organization activity events.
 * Shows actor initials avatar, event_type badge, event description,
 * username, and relative time.
 * Styled to match the module-execution.html design system badge pattern.
 *
 * Config options (widget.config):
 *   limit {number} - Max activity items to display (default: 10)
 *
 * Expected data shape from backend:
 *   {
 *     data: [
 *       {
 *         description: string,
 *         event_type: string,
 *         user_name: string,   // or actor
 *         created_at: string,  // ISO 8601 or timestamp
 *         timestamp: string
 *       },
 *       ...
 *     ]
 *   }
 *
 * Design system: w-9 h-9 avatar, event_type badge pill next to description,
 * matches module-execution.html status badge styling.
 */
(function() {
  WidgetRenderer.registerRenderer('activity_feed', {
    /**
     * Render the activity feed.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data returned by the backend
     * @param {Object} config - Widget config (limit)
     */
    render: function(container, data, config) {
      var activities = [];
      if (data && data.data && Array.isArray(data.data)) {
        activities = data.data;
      }

      if (activities.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-sm text-gray-400">No recent activity</div>';
        return;
      }

      var displayLimit = (config && config.limit) ? config.limit : 10;

      var html = '<div class="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">';

      activities.slice(0, displayLimit).forEach(function(activity) {
        var timeAgo = formatTimeAgo(activity.created_at || activity.timestamp);
        var description = activity.description || activity.event_type || 'Activity';
        var userName = activity.user_name || activity.actor || '';
        var eventType = activity.event_type || '';
        var initial = userName ? userName.charAt(0).toUpperCase() : 'A';

        // Build event_type badge if available
        var eventTypeBadge = '';
        if (eventType) {
          eventTypeBadge = '<span class="ml-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 flex-shrink-0">'
            + escapeHtml(eventType)
            + '</span>';
        }

        html += '<div class="py-3 flex items-start gap-3">'

          // Avatar circle - w-9 h-9 per design system
          + '<div class="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">'
          + '<span class="text-xs font-medium text-indigo-600">' + escapeHtml(initial) + '</span>'
          + '</div>'

          // Content
          + '<div class="flex-1 min-w-0">'
          + '<div class="flex items-center flex-wrap gap-1">'
          + '<p class="text-sm text-gray-900 truncate">' + escapeHtml(description) + '</p>'
          + eventTypeBadge
          + '</div>'
          + (userName
              ? '<p class="text-xs text-gray-500 mt-0.5">' + escapeHtml(userName) + '</p>'
              : '')
          + '<p class="text-xs text-gray-400 mt-0.5">' + escapeHtml(timeAgo) + '</p>'
          + '</div>'

          + '</div>';
      });

      html += '</div>';
      container.innerHTML = html;
    }
  });

  /**
   * Format an ISO date string as a human-readable relative time.
   * Returns times like "Just now", "5m ago", "3h ago", "2d ago".
   * @param {string} dateStr - ISO 8601 date string
   * @returns {string} Relative time string
   */
  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    var date = new Date(dateStr);
    var now = new Date();
    var diffMs = now - date;
    if (isNaN(diffMs)) return '';
    var diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    var diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + 'h ago';
    var diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return diffDays + 'd ago';
    return date.toLocaleDateString();
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
