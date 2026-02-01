/**
 * Bubble Chart Renderer Module
 *
 * @module visualizations/renderers/bubble-chart-renderer
 * @description Reusable ES6 class for rendering interactive bubble charts using Chart.js.
 * Supports dynamic data updates, customizable styling, and advanced tooltip formatting.
 *
 * @requires Chart.js v4.x
 *
 * @example
 * import { BubbleChartRenderer } from './visualizations/renderers/bubble-chart-renderer.js';
 *
 * const data = [
 *   { x: 75, y: 45, r: 10, label: 'Source A' },
 *   { x: 60, y: 30, r: 15, label: 'Source B' }
 * ];
 *
 * const config = {
 *   xAxis: { label: 'Quality Score', min: 0, max: 100 },
 *   yAxis: { label: 'Booking Rate (%)', min: 0, max: 100 },
 *   bubbleSize: { label: 'Lead Count', scaleFactor: 3 }
 * };
 *
 * const chart = new BubbleChartRenderer('chart-container', data, config);
 * chart.render();
 *
 * @author Red Rooster Technologies
 * @version 2.0.0
 * @since 2025-02-01
 */

/**
 * BubbleChartRenderer Class
 *
 * Creates and manages interactive bubble chart visualizations with Chart.js.
 * Provides methods for rendering, updating, and destroying chart instances.
 */
export class BubbleChartRenderer {
  /**
   * Create a BubbleChartRenderer instance
   *
   * @param {string} containerId - DOM element ID where the chart canvas will be rendered
   * @param {Array<Object>} data - Array of bubble data points
   * @param {number} data[].x - X-axis value
   * @param {number} data[].y - Y-axis value
   * @param {number} data[].r - Bubble radius value
   * @param {string} data[].label - Bubble label for tooltips
   * @param {Object} [config={}] - Chart configuration options
   * @param {string} [config.title] - Chart title
   * @param {string} [config.description] - Chart description
   * @param {Object} [config.xAxis] - X-axis configuration
   * @param {string} [config.xAxis.label='X Axis'] - X-axis label
   * @param {number} [config.xAxis.min=0] - X-axis minimum value
   * @param {number} [config.xAxis.max=100] - X-axis maximum value
   * @param {Object} [config.yAxis] - Y-axis configuration
   * @param {string} [config.yAxis.label='Y Axis'] - Y-axis label
   * @param {number} [config.yAxis.min=0] - Y-axis minimum value
   * @param {number} [config.yAxis.max=100] - Y-axis maximum value
   * @param {Object} [config.bubbleSize] - Bubble size configuration
   * @param {string} [config.bubbleSize.label='Size'] - Bubble size label for tooltip
   * @param {number} [config.bubbleSize.scaleFactor=3] - Scale factor for bubble radius
   * @param {Object} [config.colors] - Color configuration
   * @param {string} [config.colors.backgroundColor='rgba(99, 102, 241, 0.6)'] - Bubble fill color
   * @param {string} [config.colors.borderColor='rgba(99, 102, 241, 1)'] - Bubble border color
   * @param {number} [config.colors.borderWidth=1] - Bubble border width
   * @param {Object} [config.tooltip] - Custom tooltip configuration
   * @param {Function} [config.tooltip.formatter] - Custom tooltip formatter function
   * @param {boolean} [config.responsive=true] - Enable responsive sizing
   * @param {boolean} [config.maintainAspectRatio=false] - Maintain aspect ratio
   *
   * @throws {Error} If containerId is not provided or element doesn't exist
   * @throws {Error} If Chart.js library is not loaded
   */
  constructor(containerId, data = [], config = {}) {
    // Validate container
    if (!containerId) {
      throw new Error('BubbleChartRenderer: containerId is required');
    }

    this.containerId = containerId;
    this.container = document.getElementById(containerId);

    if (!this.container) {
      throw new Error(`BubbleChartRenderer: Container element with id "${containerId}" not found`);
    }

    // Validate Chart.js is loaded
    if (typeof Chart === 'undefined') {
      throw new Error('BubbleChartRenderer: Chart.js library is not loaded');
    }

    // Store data and configuration
    this.data = data;
    this.config = this._mergeConfig(config);

    // Chart instance
    this.chartInstance = null;

    // Canvas element
    this.canvas = null;
    this.canvasId = `bubble-chart-${containerId}-${Date.now()}`;
  }

  /**
   * Merge user config with default configuration
   *
   * @private
   * @param {Object} userConfig - User-provided configuration
   * @returns {Object} Merged configuration object
   */
  _mergeConfig(userConfig) {
    const defaultConfig = {
      title: 'Bubble Chart',
      description: null,
      xAxis: {
        label: 'X Axis',
        min: 0,
        max: 100
      },
      yAxis: {
        label: 'Y Axis',
        min: 0,
        max: 100
      },
      bubbleSize: {
        label: 'Size',
        scaleFactor: 3
      },
      colors: {
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderColor: 'rgba(99, 102, 241, 1)',
        borderWidth: 1
      },
      tooltip: {
        formatter: null // Custom formatter function
      },
      responsive: true,
      maintainAspectRatio: false
    };

    return {
      ...defaultConfig,
      ...userConfig,
      xAxis: { ...defaultConfig.xAxis, ...(userConfig.xAxis || {}) },
      yAxis: { ...defaultConfig.yAxis, ...(userConfig.yAxis || {}) },
      bubbleSize: { ...defaultConfig.bubbleSize, ...(userConfig.bubbleSize || {}) },
      colors: { ...defaultConfig.colors, ...(userConfig.colors || {}) },
      tooltip: { ...defaultConfig.tooltip, ...(userConfig.tooltip || {}) }
    };
  }

  /**
   * Transform raw data to Chart.js bubble format
   *
   * @private
   * @param {Array<Object>} data - Raw bubble data
   * @returns {Array<Object>} Transformed data for Chart.js
   */
  _transformData(data) {
    if (!Array.isArray(data)) {
      console.warn('BubbleChartRenderer: Data must be an array');
      return [];
    }

    return data.map(point => ({
      x: parseFloat(point.x) || 0,
      y: parseFloat(point.y) || 0,
      r: parseFloat(point.r) || 1,
      label: point.label || 'Unknown'
    }));
  }

  /**
   * Build Chart.js configuration object
   *
   * @private
   * @returns {Object} Chart.js configuration
   */
  _buildChartConfig() {
    const { config } = this;
    const transformedData = this._transformData(this.data);

    return {
      type: 'bubble',
      data: {
        datasets: [{
          label: config.title,
          data: transformedData,
          backgroundColor: config.colors.backgroundColor,
          borderColor: config.colors.borderColor,
          borderWidth: config.colors.borderWidth
        }]
      },
      options: {
        responsive: config.responsive,
        maintainAspectRatio: config.maintainAspectRatio,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                // Use custom formatter if provided
                if (config.tooltip.formatter && typeof config.tooltip.formatter === 'function') {
                  return config.tooltip.formatter(context);
                }

                // Default tooltip formatter
                const point = context.raw;
                const actualSize = Math.round((point.r / config.bubbleSize.scaleFactor) ** 2);

                return [
                  `${point.label}`,
                  `${config.xAxis.label}: ${point.x}`,
                  `${config.yAxis.label}: ${point.y}`,
                  `${config.bubbleSize.label}: ${actualSize}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: config.xAxis.label
            },
            min: config.xAxis.min,
            max: config.xAxis.max
          },
          y: {
            title: {
              display: true,
              text: config.yAxis.label
            },
            min: config.yAxis.min,
            max: config.yAxis.max
          }
        }
      }
    };
  }

  /**
   * Create canvas element and inject into container
   *
   * @private
   */
  _createCanvas() {
    // Create wrapper div
    const wrapper = document.createElement('div');
    wrapper.className = 'bubble-chart-wrapper';
    wrapper.style.height = '100%';
    wrapper.style.width = '100%';

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = this.canvasId;

    wrapper.appendChild(this.canvas);
    this.container.innerHTML = ''; // Clear existing content
    this.container.appendChild(wrapper);
  }

  /**
   * Render the bubble chart
   *
   * @public
   * @returns {BubbleChartRenderer} Returns this for method chaining
   *
   * @example
   * const chart = new BubbleChartRenderer('container', data, config);
   * chart.render();
   */
  render() {
    // Destroy existing chart if present
    if (this.chartInstance) {
      this.destroy();
    }

    // Validate data
    if (!this.data || this.data.length === 0) {
      this.container.innerHTML = `
        <div class="flex items-center justify-center h-full text-gray-500">
          No data available
        </div>
      `;
      return this;
    }

    // Create canvas element
    this._createCanvas();

    // Small delay to ensure DOM is ready
    setTimeout(() => {
      const ctx = this.canvas.getContext('2d');
      if (!ctx) {
        console.error('BubbleChartRenderer: Failed to get canvas context');
        return;
      }

      // Create Chart.js instance
      const chartConfig = this._buildChartConfig();
      this.chartInstance = new Chart(ctx, chartConfig);

      // Store in global registry for cleanup (optional)
      if (!window.chartInstances) {
        window.chartInstances = {};
      }
      window.chartInstances[this.canvasId] = this.chartInstance;
    }, 10);

    return this;
  }

  /**
   * Update chart with new data
   *
   * @public
   * @param {Array<Object>} newData - New bubble data points
   * @param {Object} [newConfig] - Optional new configuration to merge
   * @returns {BubbleChartRenderer} Returns this for method chaining
   *
   * @example
   * chart.update([
   *   { x: 80, y: 50, r: 12, label: 'Updated Source' }
   * ]);
   */
  update(newData, newConfig = null) {
    if (!this.chartInstance) {
      console.warn('BubbleChartRenderer: Chart not rendered yet. Call render() first.');
      return this;
    }

    // Update data
    this.data = newData;

    // Update config if provided
    if (newConfig) {
      this.config = this._mergeConfig({ ...this.config, ...newConfig });
    }

    // Transform new data
    const transformedData = this._transformData(this.data);

    // Update chart data
    this.chartInstance.data.datasets[0].data = transformedData;
    this.chartInstance.data.datasets[0].label = this.config.title;
    this.chartInstance.data.datasets[0].backgroundColor = this.config.colors.backgroundColor;
    this.chartInstance.data.datasets[0].borderColor = this.config.colors.borderColor;
    this.chartInstance.data.datasets[0].borderWidth = this.config.colors.borderWidth;

    // Update chart options
    this.chartInstance.options.scales.x.title.text = this.config.xAxis.label;
    this.chartInstance.options.scales.x.min = this.config.xAxis.min;
    this.chartInstance.options.scales.x.max = this.config.xAxis.max;

    this.chartInstance.options.scales.y.title.text = this.config.yAxis.label;
    this.chartInstance.options.scales.y.min = this.config.yAxis.min;
    this.chartInstance.options.scales.y.max = this.config.yAxis.max;

    // Re-render chart
    this.chartInstance.update();

    return this;
  }

  /**
   * Destroy chart instance and clean up resources
   *
   * @public
   * @returns {BubbleChartRenderer} Returns this for method chaining
   *
   * @example
   * chart.destroy();
   */
  destroy() {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }

    // Remove from global registry
    if (window.chartInstances && window.chartInstances[this.canvasId]) {
      delete window.chartInstances[this.canvasId];
    }

    // Clear canvas
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }

    return this;
  }

  /**
   * Get current chart instance
   *
   * @public
   * @returns {Chart|null} Chart.js instance or null if not rendered
   */
  getChartInstance() {
    return this.chartInstance;
  }

  /**
   * Get current data
   *
   * @public
   * @returns {Array<Object>} Current bubble data
   */
  getData() {
    return this.data;
  }

  /**
   * Get current configuration
   *
   * @public
   * @returns {Object} Current configuration object
   */
  getConfig() {
    return this.config;
  }

  /**
   * Export chart as base64 image
   *
   * @public
   * @param {string} [format='image/png'] - Image format (image/png, image/jpeg)
   * @returns {string|null} Base64 encoded image or null if chart not rendered
   *
   * @example
   * const imageData = chart.exportAsImage('image/png');
   */
  exportAsImage(format = 'image/png') {
    if (!this.chartInstance || !this.canvas) {
      console.warn('BubbleChartRenderer: Chart not rendered. Cannot export.');
      return null;
    }

    return this.canvas.toDataURL(format);
  }

  /**
   * Resize chart (useful after container size changes)
   *
   * @public
   * @returns {BubbleChartRenderer} Returns this for method chaining
   *
   * @example
   * window.addEventListener('resize', () => chart.resize());
   */
  resize() {
    if (this.chartInstance) {
      this.chartInstance.resize();
    }
    return this;
  }
}

/**
 * Factory function for creating BubbleChartRenderer instances
 *
 * @param {string} containerId - DOM element ID
 * @param {Array<Object>} data - Bubble data points
 * @param {Object} config - Configuration options
 * @returns {BubbleChartRenderer} New renderer instance
 *
 * @example
 * import { createBubbleChart } from './visualizations/renderers/bubble-chart-renderer.js';
 *
 * const chart = createBubbleChart('container', data, config);
 * chart.render();
 */
export function createBubbleChart(containerId, data, config) {
  return new BubbleChartRenderer(containerId, data, config);
}

// Default export
export default BubbleChartRenderer;
