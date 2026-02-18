/**
 * Chart Widget
 *
 * Renders a Chart.js visualization from connector data aggregation results.
 * Supports bar, pie, doughnut, and line chart types.
 * Manages chart instance lifecycle to prevent memory leaks on re-render.
 * Shows a total count label below the chart for context.
 *
 * Config options (widget.config):
 *   entity_type  {string} - Used as the dataset label
 *   chart_type   {string} - 'bar' | 'pie' | 'doughnut' | 'line' (default: 'bar')
 *   group_by     {string} - 'connector_id' | 'entity_type'
 *
 * Expected data shape from backend:
 *   {
 *     data: [
 *       { group_value: string, metric_value: number },
 *       { label: string, count: number },
 *       ...
 *     ]
 *   }
 *
 * Requires Chart.js to be loaded at js/vendor/chart.js.
 *
 * Design system: indigo-focused color palette matching module-execution.html,
 * with a text-xs text-gray-400 total count label below the chart.
 */
(function() {
  /**
   * Map of container element ID -> Chart.js instance.
   * Used to destroy previous charts before re-rendering.
   */
  var chartInstances = {};

  /**
   * Brand-aligned indigo-focused color palette for chart series.
   * Ordered to lead with indigo/violet matching the design system.
   */
  var CHART_COLORS = [
    '#6366f1', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b',
    '#ec4899', '#14b8a6', '#f97316', '#3b82f6', '#a855f7',
    '#ef4444', '#eab308', '#84cc16', '#d946ef', '#0ea5e9'
  ];

  WidgetRenderer.registerRenderer('chart', {
    /**
     * Render the chart widget.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data returned by the backend
     * @param {Object} config - Widget config (entity_type, chart_type, group_by)
     */
    render: function(container, data, config) {
      var rows = [];
      if (data && data.data && Array.isArray(data.data)) {
        rows = data.data;
      }

      if (rows.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-sm text-gray-400">No data to chart</div>';
        return;
      }

      if (typeof Chart === 'undefined') {
        container.innerHTML = '<div class="text-center py-8 text-sm text-gray-400">Chart.js not loaded</div>';
        return;
      }

      var chartType = (config && config.chart_type) ? config.chart_type : 'bar';
      var entityLabel = (config && config.entity_type) ? config.entity_type : 'Count';

      // Extract labels and values from backend aggregation rows
      var labels = rows.map(function(r) { return r.group_value || r.label || 'Unknown'; });
      var values = rows.map(function(r) { return r.metric_value !== undefined ? r.metric_value : (r.count || 0); });

      // Compute total for the summary label below the chart
      var total = values.reduce(function(sum, v) { return sum + (typeof v === 'number' ? v : 0); }, 0);

      // Ensure the container has a stable unique ID for chart instance tracking
      if (!container.id) {
        container.id = 'chart-widget-' + Math.random().toString(36).slice(2, 9);
      }

      // Destroy any existing chart on this container to prevent canvas reuse errors
      if (chartInstances[container.id]) {
        chartInstances[container.id].destroy();
        delete chartInstances[container.id];
      }

      // Clear container and build wrapper
      container.innerHTML = '';
      var wrapper = document.createElement('div');
      wrapper.className = 'flex flex-col';
      container.appendChild(wrapper);

      // Create canvas element with constrained height
      var canvas = document.createElement('canvas');
      canvas.style.maxHeight = '250px';
      wrapper.appendChild(canvas);

      // Total count label below chart
      var totalLabel = document.createElement('div');
      totalLabel.className = 'text-xs text-gray-400 text-center mt-2';
      totalLabel.textContent = 'Total: ' + total.toLocaleString() + ' ' + entityLabel;
      wrapper.appendChild(totalLabel);

      // Categorical chart types (pie, doughnut) need one color per slice
      var isMultiColor = (chartType === 'pie' || chartType === 'doughnut');
      var backgroundColors = isMultiColor
        ? CHART_COLORS.slice(0, labels.length)
        : CHART_COLORS[0];

      var chartConfig = {
        type: chartType,
        data: {
          labels: labels,
          datasets: [{
            label: entityLabel,
            data: values,
            backgroundColor: backgroundColors,
            borderColor: chartType === 'line' ? CHART_COLORS[0] : undefined,
            borderWidth: chartType === 'line' ? 2 : 0,
            fill: chartType === 'line' ? false : undefined,
            tension: chartType === 'line' ? 0.3 : undefined
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: isMultiColor,
              position: 'bottom',
              labels: { font: { size: 11 }, padding: 8 }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  var val = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
                  return ' ' + (typeof val === 'number' ? val.toLocaleString() : val);
                }
              }
            }
          },
          scales: (chartType === 'bar' || chartType === 'line') ? {
            y: {
              beginAtZero: true,
              ticks: { font: { size: 11 } }
            },
            x: {
              ticks: { font: { size: 11 } }
            }
          } : undefined
        }
      };

      chartInstances[container.id] = new Chart(canvas.getContext('2d'), chartConfig);
    }
  });
})();
