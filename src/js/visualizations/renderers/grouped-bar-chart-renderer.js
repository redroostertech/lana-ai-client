/**
 * GroupedBarChartRenderer - Reusable grouped bar chart visualization component
 *
 * Extracted from module-execution.html for component reusability.
 * Supports Chart.js-based rendering with multiple data series, group labels, and configurable styling.
 *
 * @module visualizations/renderers/grouped-bar-chart-renderer
 * @requires Chart.js (must be loaded globally)
 *
 * @example
 * import { GroupedBarChartRenderer } from './visualizations/renderers/grouped-bar-chart-renderer.js';
 *
 * const renderer = new GroupedBarChartRenderer('chart-container', data, {
 *   title: 'Lead Source Performance',
 *   xAxis: { label: 'Source', field: 'source_name' },
 *   yAxis: { label: 'Conversion Rate (%)', min: 0, max: 100 },
 *   series: [
 *     { label: 'Contact Rate', field: 'contact_rate', color: '#3b82f6' },
 *     { label: 'Qualified Rate', field: 'qualified_rate', color: '#10b981' }
 *   ],
 *   annotations: { field: 'lead_count', label: 'Leads: {value}' }
 * });
 *
 * renderer.render();
 *
 * // Update with new data
 * renderer.update(newData);
 *
 * // Cleanup when done
 * renderer.destroy();
 */

/**
 * GroupedBarChartRenderer class
 * Renders grouped (multi-series) bar charts using Chart.js
 */
export class GroupedBarChartRenderer {
  /**
   * Create a GroupedBarChartRenderer instance
   *
   * @param {string|HTMLElement} container - Container element ID or element reference
   * @param {Array<Object>} data - Array of data objects with fields matching series configuration
   * @param {Object} config - Configuration options
   * @param {string} [config.title='Grouped Bar Chart'] - Chart title
   * @param {string} [config.description] - Optional description text
   * @param {Object} [config.xAxis] - X-axis configuration
   * @param {string} [config.xAxis.field='category'] - Field name for x-axis labels
   * @param {string} [config.xAxis.label='Categories'] - X-axis label text
   * @param {Object} [config.yAxis] - Y-axis configuration
   * @param {string} [config.yAxis.label='Value'] - Y-axis label text
   * @param {number} [config.yAxis.min=0] - Y-axis minimum value
   * @param {number} [config.yAxis.max] - Y-axis maximum value (auto if not specified)
   * @param {boolean} [config.yAxis.beginAtZero=true] - Whether y-axis should begin at zero
   * @param {Array<Object>} config.series - Array of series configurations
   * @param {string} config.series[].label - Series display label
   * @param {string} config.series[].field - Data field name for this series
   * @param {string} config.series[].color - Color for this series (hex or rgb)
   * @param {Object} [config.annotations] - Optional annotations configuration
   * @param {string} [config.annotations.field] - Field containing annotation values
   * @param {string} [config.annotations.label] - Annotation label template (use {value} placeholder)
   * @param {Object} [config.legend] - Legend configuration
   * @param {string} [config.legend.position='bottom'] - Legend position ('top', 'bottom', 'left', 'right')
   * @param {boolean} [config.legend.display=true] - Whether to show legend
   * @param {Object} [config.helpText] - Help text configuration
   * @param {string} [config.helpText.content] - Help text content
   * @param {Function} [config.onBarClick] - Callback when a bar is clicked (receives dataIndex, seriesIndex, value)
   * @param {string} [config.uniqueId] - Unique identifier for this chart instance
   */
  constructor(container, data, config = {}) {
    // Resolve container element
    this.container = typeof container === 'string'
      ? document.getElementById(container) || document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error(`GroupedBarChartRenderer: Container not found - ${container}`);
    }

    // Validate Chart.js availability
    if (typeof Chart === 'undefined') {
      throw new Error('GroupedBarChartRenderer: Chart.js library not found. Please ensure Chart.js is loaded.');
    }

    // Store data and configuration
    this.data = data;
    this.config = {
      title: 'Grouped Bar Chart',
      description: null,
      maxDataPoints: 1000,
      enableSampling: true,
      xAxis: {
        field: 'category',
        label: 'Categories'
      },
      yAxis: {
        label: 'Value',
        min: 0,
        max: null,
        beginAtZero: true
      },
      series: [],
      annotations: null,
      legend: {
        position: 'bottom',
        display: true
      },
      helpText: null,
      onBarClick: null,
      uniqueId: `grouped-bar-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...config
    };

    // Merge nested config objects
    if (config.xAxis) {
      this.config.xAxis = { ...this.config.xAxis, ...config.xAxis };
    }
    if (config.yAxis) {
      this.config.yAxis = { ...this.config.yAxis, ...config.yAxis };
    }
    if (config.legend) {
      this.config.legend = { ...this.config.legend, ...config.legend };
    }

    // Chart instance reference (for cleanup)
    this.chartInstance = null;

    // Canvas element reference
    this.canvas = null;

    // Wrapper element reference
    this.wrapper = null;
  }

  /**
   * Samples large datasets to improve rendering performance
   *
   * For large datasets (> 1000 points), automatic data sampling is applied
   * to maintain performance. Configure with `maxDataPoints` and `enableSampling` options.
   *
   * @private
   * @param {Array} data - Original dataset
   * @param {number} maxPoints - Maximum number of points to render (default: 1000)
   * @returns {Array} - Sampled dataset
   */
  _sampleData(data, maxPoints = 1000) {
    if (!Array.isArray(data) || data.length <= maxPoints) {
      return data;
    }

    const step = Math.ceil(data.length / maxPoints);
    const sampled = [];

    for (let i = 0; i < data.length; i += step) {
      sampled.push(data[i]);
    }

    // Always include last data point
    if (sampled[sampled.length - 1] !== data[data.length - 1]) {
      sampled.push(data[data.length - 1]);
    }

    return sampled;
  }

  /**
   * Render the grouped bar chart
   * Creates the DOM structure and initializes Chart.js
   *
   * For large datasets (> 1000 points), automatic data sampling is applied
   * to maintain performance. Configure with `maxDataPoints` and `enableSampling` options.
   */
  render() {
    // Validate data
    if (!this.data || !Array.isArray(this.data)) {
      this._renderError('Invalid data format. Expected an array of objects.');
      return;
    }

    if (this.data.length === 0) {
      this._renderEmpty('No data available');
      return;
    }

    // Validate series configuration
    if (!this.config.series || this.config.series.length === 0) {
      this._renderError('No series configured. Please provide at least one series in config.series');
      return;
    }

    // Apply sampling if enabled and dataset is large
    let dataToRender = this.data;

    if (this.config.enableSampling && this.data.length > this.config.maxDataPoints) {
      dataToRender = this._sampleData(this.data, this.config.maxDataPoints);
      console.info(`[GroupedBarChartRenderer] Sampled ${this.data.length} points to ${dataToRender.length} for performance`);
    }

    // Clear container
    this.container.innerHTML = '';

    // Create wrapper
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6';

    // Create header with title and description
    const header = this._createHeader();
    this.wrapper.appendChild(header);

    // Create chart container
    const chartContainer = document.createElement('div');
    chartContainer.className = 'h-96 relative';
    this.wrapper.appendChild(chartContainer);

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = `canvas-${this.config.uniqueId}`;
    chartContainer.appendChild(this.canvas);

    // Append wrapper to container
    this.container.appendChild(this.wrapper);

    // Render chart after DOM insertion (allows proper sizing)
    setTimeout(() => {
      this._renderChart(dataToRender);
    }, 100);
  }

  /**
   * Destroy the chart and clean up resources
   */
  destroy() {
    // Destroy Chart.js instance
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }

    // Remove from global registry if exists
    if (window.chartInstances && this.config.uniqueId) {
      delete window.chartInstances[this.config.uniqueId];
    }

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }

    // Clear references
    this.canvas = null;
    this.wrapper = null;
  }

  /**
   * Update chart data and re-render
   *
   * @param {Array<Object>} newData - New chart data
   */
  update(newData) {
    this.data = newData;

    if (this.chartInstance && newData && newData.length > 0) {
      // Update existing chart
      const xField = this.config.xAxis.field;
      const labels = newData.map(row => row[xField] || 'Unknown');

      this.chartInstance.data.labels = labels;

      // Update each dataset
      this.config.series.forEach((serie, index) => {
        if (this.chartInstance.data.datasets[index]) {
          this.chartInstance.data.datasets[index].data = newData.map(row =>
            parseFloat(row[serie.field]) || 0
          );
        }
      });

      this.chartInstance.update();
    } else {
      // Re-render from scratch
      this.render();
    }
  }

  /**
   * Create header element with title, help button, and description
   * @private
   */
  _createHeader() {
    const header = document.createElement('div');
    header.className = 'mb-4';

    let helpButtonHTML = '';
    if (this.config.helpText && this.config.helpText.content) {
      const helpId = `help-${this.config.uniqueId}`;
      helpButtonHTML = `
        <button
          type="button"
          class="ml-2 text-gray-400 hover:text-indigo-600 transition-colors"
          onclick="document.getElementById('${helpId}').classList.remove('hidden')"
          aria-label="Show help"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        ${this._createHelpModal(helpId)}
      `;
    }

    const descriptionHTML = this.config.description
      ? `<p class="text-sm text-gray-600 mt-1">${this.config.description}</p>`
      : '';

    header.innerHTML = `
      <div class="flex items-center">
        <h3 class="text-lg font-semibold text-gray-900">${this.config.title}</h3>
        ${helpButtonHTML}
      </div>
      ${descriptionHTML}
    `;

    return header;
  }

  /**
   * Escape HTML to prevent XSS attacks
   * @private
   * @param {string} unsafe - Unsafe string that may contain HTML
   * @returns {string} HTML-escaped safe string
   */
  _escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Create help modal HTML
   * @private
   * @description Sanitizes help text content to prevent XSS attacks
   */
  _createHelpModal(helpId) {
    // Sanitize help text content to prevent XSS attacks
    const sanitizedContent = this._escapeHtml(this.config.helpText.content);

    return `
      <div id="${helpId}" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">Help</h3>
            <button
              type="button"
              class="text-gray-400 hover:text-gray-600"
              onclick="document.getElementById('${helpId}').classList.add('hidden')"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="text-sm text-gray-600 prose prose-sm whitespace-pre-wrap">
            ${sanitizedContent}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render the Chart.js grouped bar chart
   * @private
   */
  _renderChart(data = null) {
    if (!this.canvas) {
      console.error('[GroupedBarChartRenderer] Canvas element not found');
      return;
    }

    // Use provided data or fall back to this.data (for backward compatibility)
    const dataToRender = data || this.data;

    // Extract labels from data using xAxis field
    const xField = this.config.xAxis.field;
    const labels = dataToRender.map(row => row[xField] || 'Unknown');

    // Build datasets from series configuration
    const datasets = this.config.series.map(serie => {
      return {
        label: serie.label,
        data: dataToRender.map(row => parseFloat(row[serie.field]) || 0),
        backgroundColor: this._hexToRgba(serie.color, 0.8),
        borderColor: serie.color,
        borderWidth: 1
      };
    });

    // Chart configuration
    const chartConfig = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: this.config.legend.position,
            display: this.config.legend.display
          },
          tooltip: {
            callbacks: {
              afterLabel: (context) => {
                // Show annotation if available
                if (this.config.annotations && this.config.annotations.field) {
                  const row = this.data[context.dataIndex];
                  const value = row[this.config.annotations.field];
                  return this.config.annotations.label.replace('{value}', value);
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: this.config.xAxis.label || 'Categories'
            }
          },
          y: {
            title: {
              display: true,
              text: this.config.yAxis.label || 'Value'
            },
            min: this.config.yAxis.min !== null ? this.config.yAxis.min : undefined,
            max: this.config.yAxis.max !== null ? this.config.yAxis.max : undefined,
            beginAtZero: this.config.yAxis.beginAtZero
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0 && this.config.onBarClick) {
            const element = elements[0];
            const dataIndex = element.index;
            const seriesIndex = element.datasetIndex;
            const value = datasets[seriesIndex].data[dataIndex];
            const label = labels[dataIndex];
            const series = this.config.series[seriesIndex];

            this.config.onBarClick(dataIndex, seriesIndex, value, label, series);
          }
        }
      }
    };

    // Create chart instance
    this.chartInstance = new Chart(this.canvas, chartConfig);

    // Store in global registry for external access (if needed)
    if (!window.chartInstances) {
      window.chartInstances = {};
    }
    window.chartInstances[this.config.uniqueId] = this.chartInstance;
  }

  /**
   * Convert hex color to rgba format
   * @private
   * @param {string} hex - Hex color code
   * @param {number} alpha - Alpha transparency (0-1)
   * @returns {string} RGBA color string
   */
  _hexToRgba(hex, alpha = 1) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Handle 3-digit hex codes
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }

    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Render error message
   * @private
   */
  _renderError(message) {
    this.container.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <p class="text-red-800 text-sm font-medium">Error</p>
        <p class="text-red-600 text-sm mt-1">${message}</p>
      </div>
    `;
  }

  /**
   * Render empty state message
   * @private
   */
  _renderEmpty(message) {
    this.container.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">${this.config.title}</h3>
        <div class="flex items-center justify-center h-64 text-gray-500">
          ${message}
        </div>
      </div>
    `;
  }
}

/**
 * Factory function for creating GroupedBarChartRenderer instances
 * Convenience wrapper for users who prefer functional API
 *
 * @param {string|HTMLElement} container - Container element ID or element reference
 * @param {Array<Object>} data - Chart data
 * @param {Object} config - Configuration options
 * @returns {GroupedBarChartRenderer} New GroupedBarChartRenderer instance
 */
export function createGroupedBarChart(container, data, config = {}) {
  const renderer = new GroupedBarChartRenderer(container, data, config);
  renderer.render();
  return renderer;
}
