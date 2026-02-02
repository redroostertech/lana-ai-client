/**
 * BarChartRenderer - Reusable horizontal/vertical bar chart visualization component
 *
 * Extracted from module-execution.html for component reusability.
 * Supports Chart.js-based rendering with configurable orientation, colors, and data formats.
 *
 * @module visualizations/renderers/bar-chart-renderer
 * @requires Chart.js (must be loaded globally)
 *
 * @example
 * import { BarChartRenderer } from './visualizations/renderers/bar-chart-renderer.js';
 *
 * const renderer = new BarChartRenderer('chart-container', data, {
 *   orientation: 'horizontal',
 *   title: 'Matter Distribution',
 *   colors: { positive: '#10b981', negative: '#ef4444', neutral: '#6b7280' },
 *   colorRule: "value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'"
 * });
 *
 * renderer.render();
 *
 * // Cleanup when done
 * renderer.destroy();
 */

/**
 * BarChartRenderer class
 * Renders horizontal or vertical bar charts using Chart.js
 */
export class BarChartRenderer {
  /**
   * Create a BarChartRenderer instance
   *
   * @param {string|HTMLElement} container - Container element ID or element reference
   * @param {Object} data - Chart data object
   * @param {Array} data.labels - Array of label strings for each bar
   * @param {Array} data.values - Array of numeric values for each bar
   * @param {Object} config - Configuration options
   * @param {string} [config.orientation='horizontal'] - Chart orientation: 'horizontal' or 'vertical'
   * @param {string} [config.title='Chart'] - Chart title
   * @param {string} [config.description] - Optional description text
   * @param {string} [config.metricName] - Name of the metric being displayed
   * @param {string} [config.unit] - Unit of measurement (e.g., 'count', 'percent', 'percent_change')
   * @param {boolean} [config.isPercentage=false] - Whether values are percentages
   * @param {Object} [config.colors] - Color scheme for bars
   * @param {string} [config.colors.positive='#10b981'] - Color for positive values
   * @param {string} [config.colors.negative='#ef4444'] - Color for negative values
   * @param {string} [config.colors.neutral='#6b7280'] - Color for neutral values
   * @param {string} [config.colorRule] - JavaScript expression to evaluate color for each value
   * @param {Function} [config.onBarClick] - Callback when a bar is clicked (receives index and label)
   * @param {Object} [config.helpText] - Help text configuration
   * @param {string} [config.helpText.content] - Help text content
   * @param {string} [config.uniqueId] - Unique identifier for this chart instance
   */
  constructor(container, data, config = {}) {
    // Resolve container element
    this.container = typeof container === 'string'
      ? document.getElementById(container) || document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error(`BarChartRenderer: Container not found - ${container}`);
    }

    // Validate Chart.js availability
    if (typeof Chart === 'undefined') {
      throw new Error('BarChartRenderer: Chart.js library not found. Please ensure Chart.js is loaded.');
    }

    // Store data and configuration
    this.data = data;

    // Default colors that will be merged with user-provided colors
    const defaultColors = {
      positive: '#10b981',
      negative: '#ef4444',
      neutral: '#6b7280',
      default: '#6366f1' // Default indigo color
    };

    this.config = {
      orientation: 'horizontal',
      title: 'Chart',
      description: null,
      metricName: 'Value',
      unit: null,
      isPercentage: false,
      maxDataPoints: 1000,
      enableSampling: true,
      colors: defaultColors,
      colorRule: null,
      onBarClick: null,
      helpText: null,
      uniqueId: `bar-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...config,
      // Merge colors properly to preserve defaults
      colors: {
        ...defaultColors,
        ...(config.colors || {})
      }
    };

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
   * Render the bar chart
   * Creates the DOM structure and initializes Chart.js
   *
   * For large datasets (> 1000 points), automatic data sampling is applied
   * to maintain performance. Configure with `maxDataPoints` and `enableSampling` options.
   */
  render() {
    // Validate data
    if (!this.data || !this.data.labels || !this.data.values) {
      this._renderError('Invalid data format. Expected { labels: [], values: [] }');
      return;
    }

    if (this.data.labels.length === 0 || this.data.values.length === 0) {
      this._renderEmpty('No data available for this period');
      return;
    }

    if (this.data.labels.length !== this.data.values.length) {
      this._renderError('Data mismatch: labels and values arrays must have the same length');
      return;
    }

    // Apply sampling if enabled and dataset is large
    let labelsToRender = this.data.labels;
    let valuesToRender = this.data.values;

    if (this.config.enableSampling && this.data.labels.length > this.config.maxDataPoints) {
      labelsToRender = this._sampleData(this.data.labels, this.config.maxDataPoints);
      valuesToRender = this._sampleData(this.data.values, this.config.maxDataPoints);
      console.info(`[BarChartRenderer] Sampled ${this.data.labels.length} points to ${labelsToRender.length} for performance`);
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
      this._renderChart(labelsToRender, valuesToRender);
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
   * @param {Object} newData - New chart data
   * @param {Array} newData.labels - Array of label strings
   * @param {Array} newData.values - Array of numeric values
   */
  update(newData) {
    this.data = newData;

    if (this.chartInstance) {
      // Update existing chart
      this.chartInstance.data.labels = newData.labels;
      this.chartInstance.data.datasets[0].data = newData.values;

      // Recalculate colors if colorRule is defined
      if (this.config.colorRule) {
        const { backgroundColors, borderColors } = this._calculateColors(newData.values);
        this.chartInstance.data.datasets[0].backgroundColor = backgroundColors;
        this.chartInstance.data.datasets[0].borderColor = borderColors;
      }

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
      ? `<p class="text-sm text-gray-600">${this.config.description}</p>`
      : '';

    header.innerHTML = `
      <div class="flex items-center mb-1">
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
   * Render the Chart.js chart
   * @private
   */
  _renderChart(labels = null, values = null) {
    if (!this.canvas) {
      console.error('[BarChartRenderer] Canvas element not found');
      return;
    }

    // Use provided data or fall back to this.data (for backward compatibility)
    const labelsToRender = labels || this.data.labels;
    const valuesToRender = values || this.data.values;
    const { backgroundColors, borderColors } = this._calculateColors(valuesToRender);

    // Determine if percentage formatting should be used
    const isPercentage = this.config.isPercentage || this.config.unit === 'percent';
    const isPercentChange = this.config.unit === 'percent_change';

    // Chart configuration
    const chartConfig = {
      type: 'bar',
      data: {
        labels: labelsToRender,
        datasets: [{
          label: this.config.metricName,
          data: valuesToRender,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: this.config.orientation === 'horizontal' ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = this.config.orientation === 'horizontal'
                  ? context.parsed.x
                  : context.parsed.y;

                // Handle percent_change unit (growth/change percentages)
                if (isPercentChange) {
                  const sign = value > 0 ? '+' : '';
                  return `${sign}${value}%`;
                }

                // Handle regular percentages
                if (isPercentage) {
                  return `${value}%`;
                }

                // Handle other units
                const unit = this.config.unit || '';
                return `${value} ${unit}`.trim();
              }
            }
          }
        },
        scales: this._getScalesConfig(isPercentage),
        onClick: (event, elements) => {
          if (elements.length > 0 && this.config.onBarClick) {
            const index = elements[0].index;
            const label = labels[index];
            const value = values[index];
            this.config.onBarClick(index, label, value);
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
   * Calculate bar colors based on values and color rules
   * SECURITY: Uses safe expression parser instead of eval() to prevent code injection
   * @private
   */
  _calculateColors(values) {
    let backgroundColors;
    let borderColors;

    if (this.config.colorRule) {
      // Conditional coloring: evaluate colorRule for each value using safe parser
      backgroundColors = values.map(value => {
        try {
          const colorKey = this._evaluateColorRule(this.config.colorRule, value);
          const colorHex = this.config.colors[colorKey] || this.config.colors.neutral || '#6b7280';
          return this._hexToRgba(colorHex, 0.8);
        } catch (error) {
          console.warn('[BarChartRenderer] Error evaluating colorRule:', error);
          return this._hexToRgba(this.config.colors.default, 0.8);
        }
      });

      borderColors = values.map(value => {
        try {
          const colorKey = this._evaluateColorRule(this.config.colorRule, value);
          const colorHex = this.config.colors[colorKey] || this.config.colors.neutral || '#6b7280';
          return colorHex;
        } catch (error) {
          console.warn('[BarChartRenderer] Error evaluating colorRule:', error);
          return this.config.colors.default;
        }
      });
    } else {
      // Default single color (indigo)
      backgroundColors = this._hexToRgba(this.config.colors.default, 0.8);
      borderColors = this.config.colors.default;
    }

    return { backgroundColors, borderColors };
  }

  /**
   * Safely evaluate a color rule expression without using eval()
   * Supports simple comparison expressions like "value > 50" or ternary operators
   *
   * SECURITY: This method replaces dangerous eval() with a safe expression parser
   * that only allows numeric comparisons and predefined color keys.
   *
   * Supported patterns:
   * - "value > 50 ? 'positive' : 'negative'"
   * - "value >= 0 ? 'positive' : 'negative'"
   * - "value < 0 ? 'negative' : 'neutral'"
   * - "value == 0 ? 'neutral' : 'positive'"
   *
   * @private
   * @param {string} rule - The color rule expression
   * @param {number} value - The numeric value to evaluate
   * @returns {string} Color key ('positive', 'negative', 'neutral', 'default')
   */
  _evaluateColorRule(rule, value) {
    if (typeof rule !== 'string') {
      return 'default';
    }

    // Sanitize input: remove whitespace for easier parsing
    const sanitized = rule.replace(/\s+/g, '');

    // Pattern 1: Ternary operator (value > 0 ? 'positive' : 'negative')
    const ternaryMatch = sanitized.match(/value([><=!]+)([-\d.]+)\?['"](\w+)['"](?::['"](\w+)['"])?/);
    if (ternaryMatch) {
      const [, operator, threshold, trueKey, falseKey] = ternaryMatch;
      const num = parseFloat(threshold);

      if (isNaN(num)) {
        console.warn('[BarChartRenderer] Invalid threshold in colorRule:', threshold);
        return 'default';
      }

      const result = this._compareValues(value, operator, num);
      return result ? trueKey : (falseKey || 'default');
    }

    // Pattern 2: Simple comparison (value > 50)
    const simpleMatch = sanitized.match(/value([><=!]+)([-\d.]+)/);
    if (simpleMatch) {
      const [, operator, threshold] = simpleMatch;
      const num = parseFloat(threshold);

      if (isNaN(num)) {
        console.warn('[BarChartRenderer] Invalid threshold in colorRule:', threshold);
        return 'default';
      }

      return this._compareValues(value, operator, num) ? 'positive' : 'negative';
    }

    // No valid pattern found
    console.warn('[BarChartRenderer] Unrecognized colorRule format:', rule);
    return 'default';
  }

  /**
   * Compare two values using a comparison operator
   * @private
   * @param {number} value - The value to compare
   * @param {string} operator - Comparison operator (>, <, >=, <=, ==, !=)
   * @param {number} threshold - The threshold to compare against
   * @returns {boolean} Comparison result
   */
  _compareValues(value, operator, threshold) {
    switch (operator) {
      case '>':
        return value > threshold;
      case '<':
        return value < threshold;
      case '>=':
        return value >= threshold;
      case '<=':
        return value <= threshold;
      case '==':
      case '===':
        return value === threshold;
      case '!=':
      case '!==':
        return value !== threshold;
      default:
        console.warn('[BarChartRenderer] Unsupported operator:', operator);
        return false;
    }
  }

  /**
   * Get Chart.js scales configuration based on orientation and data type
   * @private
   */
  _getScalesConfig(isPercentage) {
    const valueAxis = this.config.orientation === 'horizontal' ? 'x' : 'y';
    const labelAxis = this.config.orientation === 'horizontal' ? 'y' : 'x';

    return {
      [valueAxis]: {
        beginAtZero: true,
        title: {
          display: true,
          text: isPercentage ? 'Percentage (%)' : (this.config.unit || 'Value')
        },
        ticks: {
          callback: (value) => {
            return isPercentage ? `${value}%` : value;
          }
        }
      },
      [labelAxis]: {
        title: {
          display: false
        }
      }
    };
  }

  /**
   * Convert hex color to rgba format
   * @private
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
        <p class="text-red-800 text-sm">${message}</p>
      </div>
    `;
  }

  /**
   * Render empty state message
   * @private
   */
  _renderEmpty(message) {
    this.container.innerHTML = `
      <div class="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <p class="text-gray-500">${message}</p>
      </div>
    `;
  }
}

/**
 * Factory function for creating BarChartRenderer instances
 * Convenience wrapper for users who prefer functional API
 *
 * @param {string|HTMLElement} container - Container element ID or element reference
 * @param {Object} data - Chart data
 * @param {Object} config - Configuration options
 * @returns {BarChartRenderer} New BarChartRenderer instance
 */
export function createBarChart(container, data, config = {}) {
  const renderer = new BarChartRenderer(container, data, config);
  renderer.render();
  return renderer;
}
