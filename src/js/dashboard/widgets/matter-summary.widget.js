/**
 * Matter Summary Widget
 *
 * Displays a 2x2 grid of key matter statistics pulled from the
 * matter_analytics_summary database view.
 * Shows total matters, active matters, closed matters, and document count.
 * Styled to match the module-execution.html design system card pattern.
 *
 * Expected data shape from backend:
 *   {
 *     data: {
 *       total_matters: number,
 *       active_matters: number,
 *       closed_matters: number,
 *       total_documents: number
 *     }
 *   }
 *
 * Design system: matches module-execution.html card styling with rounded-xl,
 * shadow-sm, uppercase tracking-wide labels, and text-2xl font-bold values.
 */
(function() {
  WidgetRenderer.registerRenderer('matter_summary', {
    /**
     * Render the matter summary stat grid.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data returned by the backend
     * @param {Object} config - Widget config (currently unused)
     */
    render: function(container, data, config) {
      var stats = (data && data.data) ? data.data : {};

      var items = [
        {
          label: 'Total Matters',
          value: stats.total_matters || 0,
          iconPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
          iconColor: 'text-indigo-500'
        },
        {
          label: 'Active',
          value: stats.active_matters || 0,
          iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
          iconColor: 'text-green-500'
        },
        {
          label: 'Closed',
          value: stats.closed_matters || 0,
          iconPath: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
          iconColor: 'text-gray-400'
        },
        {
          label: 'Documents',
          value: stats.total_documents || 0,
          iconPath: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
          iconColor: 'text-purple-500'
        }
      ];

      var html = '<div class="grid grid-cols-2 gap-3">';

      items.forEach(function(item) {
        html += '<div class="rounded-xl shadow-sm border border-gray-100 p-4 bg-white hover:shadow-md transition-shadow">'

          // Icon + label row
          + '<div class="flex items-center gap-2 mb-2">'
          + '<svg class="w-4 h-4 flex-shrink-0 ' + item.iconColor + '" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
          + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + item.iconPath + '"></path>'
          + '</svg>'
          + '<span class="text-sm font-medium text-gray-500 uppercase tracking-wide">' + escapeHtml(item.label) + '</span>'
          + '</div>'

          // Value
          + '<div class="text-2xl font-bold text-gray-900 tabular-nums">' + formatNumber(item.value) + '</div>'

          + '</div>';
      });

      html += '</div>';
      container.innerHTML = html;
    }
  });

  /**
   * Format a number with K/M suffix for large values.
   * @param {number|string} num - The value to format
   * @returns {string} Formatted string
   */
  function formatNumber(num) {
    var n = typeof num === 'number' ? num : parseFloat(num);
    if (isNaN(n)) return String(num || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
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
