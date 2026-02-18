/**
 * Metric Card Widget
 *
 * Displays a single aggregated numeric value with a descriptive label,
 * change indicator, and optional prior/target comparison grid.
 * Styled to match the module-execution.html design system.
 *
 * Config options (widget.config):
 *   entity_type  {string} - Human-readable label / sub-description (e.g. 'contact', 'invoice')
 *   metric       {string} - 'count' | 'sum' | 'avg'
 *   connector_id {string} - Optional connector filter
 *
 * Expected data shape from backend:
 *   { data: [{ metric_value: number, count: number, change: number, prior: number, target: number, changeDirection: string }] }
 *   OR { value: number }
 *   OR { count: number }
 *
 * Design system: matches module-execution.html createMetricCard() pattern.
 */
(function() {
  WidgetRenderer.registerRenderer('metric_card', {
    /**
     * Render the metric card.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data returned by the backend
     * @param {Object} config - Widget config (entity_type, metric, connector_id)
     */
    render: function(container, data, config) {
      var value = '-';
      var label = (config && config.entity_type) ? config.entity_type : 'Records';
      var change = null;
      var prior = null;
      var target = null;
      var changeDirection = 'flat';
      var statusColor = 'gray';

      // Attempt to extract the metric value and enrichment fields from various response shapes
      if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
        var row = data.data[0];
        if (row.metric_value !== undefined) {
          value = formatNumber(row.metric_value);
        } else if (row.count !== undefined) {
          value = formatNumber(row.count);
        }
        // Optional enrichment fields
        if (row.change !== undefined && row.change !== null) {
          change = row.change;
        }
        if (row.prior !== undefined && row.prior !== null) {
          prior = row.prior;
        }
        if (row.target !== undefined && row.target !== null) {
          target = row.target;
        }
        if (row.changeDirection) {
          changeDirection = row.changeDirection;
        }
        if (row.status) {
          statusColor = row.status;
        }
      } else if (data && data.value !== undefined) {
        value = formatNumber(data.value);
      } else if (data && typeof data.count === 'number') {
        value = formatNumber(data.count);
      }

      var colors = getStatusColors(statusColor);

      // Build change indicator arrow SVG (no regex - string comparison only)
      var arrowHtml = '';
      if (change !== null) {
        var arrowSvgUp = '<svg class="w-4 h-4 text-green-600 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
          + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>'
          + '</svg>';
        var arrowSvgDown = '<svg class="w-4 h-4 text-red-600 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
          + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>'
          + '</svg>';
        var arrowSvgFlat = '<svg class="w-4 h-4 text-gray-400 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
          + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14"></path>'
          + '</svg>';

        var changeColorClass = 'text-gray-500';
        var arrowIcon = arrowSvgFlat;
        if (changeDirection === 'up') {
          arrowIcon = arrowSvgUp;
          changeColorClass = 'text-green-600';
        } else if (changeDirection === 'down') {
          arrowIcon = arrowSvgDown;
          changeColorClass = 'text-red-600';
        }

        var absChange = change < 0 ? -change : change;
        arrowHtml = '<div class="flex items-center gap-1 mt-1">'
          + arrowIcon
          + '<span class="text-sm font-medium ' + changeColorClass + '">'
          + formatNumber(absChange)
          + '</span>'
          + '</div>';
      }

      // Build prior / target comparison grid
      var gridHtml = '';
      if (prior !== null || target !== null) {
        gridHtml = '<div class="grid grid-cols-2 gap-4 text-sm mt-4 pt-4 border-t border-gray-100">';
        if (prior !== null) {
          gridHtml += '<div>'
            + '<div class="text-xs text-gray-500 uppercase tracking-wide">Prior</div>'
            + '<div class="font-semibold text-gray-700">' + formatNumber(prior) + '</div>'
            + '</div>';
        }
        if (target !== null) {
          gridHtml += '<div>'
            + '<div class="text-xs text-gray-500 uppercase tracking-wide">Target</div>'
            + '<div class="font-semibold text-gray-700">' + formatNumber(target) + '</div>'
            + '</div>';
        }
        gridHtml += '</div>';
      }

      container.innerHTML = '<div class="' + colors.bg + ' rounded-xl shadow-sm border ' + colors.border + ' p-6 hover:shadow-md transition-shadow h-full">'

        // Metric name header
        + '<div class="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">'
        + escapeHtml(label)
        + '</div>'

        // Entity type as description (if separate from label)
        + (config && config.description
          ? '<div class="text-xs text-gray-400 mb-3">' + escapeHtml(config.description) + '</div>'
          : '<div class="mb-3"></div>'
        )

        // Current value
        + '<div class="text-3xl font-bold text-gray-900 tabular-nums">' + escapeHtml(value) + '</div>'

        // Change indicator
        + arrowHtml

        // Prior / Target grid
        + gridHtml

        + '</div>';
    }
  });

  /**
   * Return Tailwind color classes for a given status color name.
   * Maps status strings to consistent bg/border/text class sets.
   * Uses object lookup - no string pattern matching.
   * @param {string} color - 'green' | 'yellow' | 'red' | 'gray'
   * @returns {{ bg: string, border: string, text: string }}
   */
  function getStatusColors(color) {
    var colors = {
      green:  { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700'  },
      yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
      red:    { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700'    },
      gray:   { bg: 'bg-white',     border: 'border-gray-100',   text: 'text-gray-700'   }
    };
    return colors[color] || colors.gray;
  }

  /**
   * Format a number with K/M suffix for large values.
   * Uses locale formatting for smaller numbers.
   * @param {number|string} num - The value to format
   * @returns {string} Formatted string
   */
  function formatNumber(num) {
    var n = typeof num === 'number' ? num : parseFloat(num);
    if (isNaN(n)) return String(num);
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
