/**
 * TimeSeriesRenderer - Reusable time-series chart visualization component
 *
 * Renders line charts for time-series data using Chart.js.
 * Supports multiple metric series with customizable styling and configuration.
 *
 * @module TimeSeriesRenderer
 * @requires Chart.js
 *
 * @example
 * const renderer = new TimeSeriesRenderer('my-canvas-id', timeSeriesData, ['metric1', 'metric2'], {
 *   chartType: 'line',
 *   fill: true,
 *   responsive: true
 * });
 * renderer.render();
 *
 * // Later, clean up
 * renderer.destroy();
 */

import { sampleData, keyToLabel, destroyChart } from '../chart-utils.js';
import { ChartTheme } from '../chart-theme.js';

export class TimeSeriesRenderer {
  /**
   * Create a TimeSeriesRenderer instance
   *
   * @param {string} containerId - DOM element ID for the canvas container
   * @param {Array<Object>} timeSeries - Array of time-series data points
   * @param {Array<string>} metricKeys - Array of metric keys to display
   * @param {Object} [config={}] - Configuration options
   * @param {string} [config.chartType='line'] - Chart type (line, bar, etc.)
   * @param {boolean} [config.fill=true] - Fill area under the line
   * @param {number} [config.tension=0.4] - Line tension (curvature)
   * @param {boolean} [config.responsive=true] - Responsive sizing
   * @param {boolean} [config.maintainAspectRatio=false] - Maintain aspect ratio
   * @param {Array<string>} [config.colors] - Custom color palette
   * @param {Object} [config.legend] - Legend configuration
   * @param {Object} [config.tooltip] - Tooltip configuration
   * @param {Object} [config.scales] - Axes configuration
   *
   * @example
   * const timeSeries = [
   *   {
   *     date: '2024-01-01',
   *     metrics: [
   *       { key: 'revenue', value: 1000 },
   *       { key: 'expenses', value: 500 }
   *     ]
   *   },
   *   {
   *     date: '2024-01-02',
   *     metrics: [
   *       { key: 'revenue', value: 1200 },
   *       { key: 'expenses', value: 600 }
   *     ]
   *   }
   * ];
   *
   * const renderer = new TimeSeriesRenderer('chart-canvas', timeSeries, ['revenue', 'expenses']);
   */
  constructor(containerId, timeSeries, metricKeys, config = {}) {
    this.containerId = containerId;
    this.timeSeries = timeSeries || [];
    this.metricKeys = metricKeys || [];
    this.config = this._mergeConfig(config);
    this.chartInstance = null;
  }

  /**
   * Merge user config with defaults
   * @private
   * @param {Object} userConfig - User-provided configuration
   * @returns {Object} Merged configuration
   */
  _mergeConfig(userConfig) {
    const defaultConfig = {
      chartType: 'line',
      fill: true,
      tension: 0.4,
      responsive: true,
      maintainAspectRatio: false,
      maxDataPoints: 1000,
      enableSampling: true,
      colors: ChartTheme.getColors(6),
      legend: {
        position: 'bottom',
        labels: {
          padding: 15,
          font: { size: ChartTheme.font.sizeSmall }
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: ChartTheme.grid.color()
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      }
    };

    return {
      ...defaultConfig,
      ...userConfig,
      legend: { ...defaultConfig.legend, ...(userConfig.legend || {}) },
      tooltip: { ...defaultConfig.tooltip, ...(userConfig.tooltip || {}) },
      scales: {
        y: { ...defaultConfig.scales.y, ...(userConfig.scales?.y || {}) },
        x: { ...defaultConfig.scales.x, ...(userConfig.scales?.x || {}) }
      }
    };
  }

  /**
   * Format metric key into human-readable label
   * @private
   * @param {string} key - Metric key (e.g., 'total_revenue')
   * @returns {string} Formatted label (e.g., 'Total Revenue')
   */
  _formatMetricLabel(key) {
    return keyToLabel(key);
  }

  /**
   * Build Chart.js datasets from time series data
   * @private
   * @returns {Array<Object>} Array of Chart.js dataset objects
   */
  _buildDatasets() {
    return this.metricKeys.map((metricKey, index) => {
      const color = this.config.colors[index % this.config.colors.length];

      return {
        label: this._formatMetricLabel(metricKey),
        data: this.timeSeries.map(point => {
          const metric = point.metrics.find(m => m.key === metricKey);
          return metric ? parseFloat(metric.value) || 0 : 0;
        }),
        borderColor: color,
        backgroundColor: color + '20', // Add transparency for fill
        borderWidth: 2,
        fill: this.config.fill,
        tension: this.config.tension
      };
    });
  }

  /**
   * Build Chart.js labels from time series dates
   * @private
   * @returns {Array<string>} Array of formatted date labels
   */
  _buildLabels() {
    return this.timeSeries.map(point => {
      try {
        return new Date(point.date).toLocaleDateString();
      } catch (e) {
        console.warn('[TimeSeriesRenderer] Invalid date format:', point.date);
        return point.date;
      }
    });
  }

  /**
   * Render the time-series chart
   * Creates a Chart.js instance and renders it to the canvas element
   *
   * For large datasets (> 1000 points), automatic data sampling is applied
   * to maintain performance. Configure with `maxDataPoints` and `enableSampling` options.
   *
   * @throws {Error} If canvas element is not found
   * @returns {Chart} Chart.js instance
   *
   * @example
   * const chart = renderer.render();
   */
  render() {
    const ctx = document.getElementById(this.containerId);

    if (!ctx) {
      throw new Error(`[TimeSeriesRenderer] Canvas element with id "${this.containerId}" not found`);
    }

    // Destroy existing chart if present
    if (this.chartInstance) {
      this.destroy();
    }

    // Validate data
    if (!this.timeSeries || this.timeSeries.length === 0) {
      console.warn('[TimeSeriesRenderer] No time series data provided');
      return null;
    }

    if (!this.metricKeys || this.metricKeys.length === 0) {
      console.warn('[TimeSeriesRenderer] No metric keys provided');
      return null;
    }

    // Apply sampling if enabled and dataset is large
    let sampledTimeSeries = this.timeSeries;
    if (this.config.enableSampling && this.timeSeries.length > this.config.maxDataPoints) {
      sampledTimeSeries = sampleData(this.timeSeries, this.config.maxDataPoints);
      console.info(`[TimeSeriesRenderer] Sampled ${this.timeSeries.length} points to ${sampledTimeSeries.length} for performance`);
    }

    // Temporarily override timeSeries for dataset building
    const originalTimeSeries = this.timeSeries;
    this.timeSeries = sampledTimeSeries;

    // Build datasets and labels
    const datasets = this._buildDatasets();
    const labels = this._buildLabels();

    // Restore original timeSeries
    this.timeSeries = originalTimeSeries;

    // Create Chart.js instance
    this.chartInstance = new Chart(ctx, {
      type: this.config.chartType,
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: this.config.responsive,
        maintainAspectRatio: this.config.maintainAspectRatio,
        plugins: {
          legend: this.config.legend,
          tooltip: this.config.tooltip
        },
        scales: this.config.scales
      }
    });

    return this.chartInstance;
  }

  /**
   * Update chart data without re-creating the chart instance
   * Useful for performance when data changes frequently
   *
   * @param {Array<Object>} newTimeSeries - New time-series data
   * @param {Array<string>} [newMetricKeys] - Optional new metric keys
   *
   * @example
   * renderer.update(newTimeSeriesData, ['metric1', 'metric2']);
   */
  update(newTimeSeries, newMetricKeys) {
    if (!this.chartInstance) {
      console.warn('[TimeSeriesRenderer] No chart instance to update. Call render() first.');
      return;
    }

    this.timeSeries = newTimeSeries || this.timeSeries;
    this.metricKeys = newMetricKeys || this.metricKeys;

    // Update datasets and labels
    this.chartInstance.data.datasets = this._buildDatasets();
    this.chartInstance.data.labels = this._buildLabels();

    // Trigger chart update
    this.chartInstance.update();
  }

  /**
   * Destroy the chart instance and clean up resources
   * Important for preventing memory leaks
   *
   * @example
   * renderer.destroy();
   */
  destroy() {
    this.chartInstance = destroyChart(this.chartInstance);
  }

  /**
   * Get the underlying Chart.js instance
   * Useful for advanced customization
   *
   * @returns {Chart|null} Chart.js instance or null if not rendered
   *
   * @example
   * const chartInstance = renderer.getChartInstance();
   * chartInstance.options.plugins.legend.position = 'top';
   * chartInstance.update();
   */
  getChartInstance() {
    return this.chartInstance;
  }

  /**
   * Export chart as base64 image
   *
   * @param {string} [format='image/png'] - Image format (image/png, image/jpeg, etc.)
   * @returns {string|null} Base64 encoded image data URL or null if chart not rendered
   *
   * @example
   * const imageDataUrl = renderer.toBase64Image('image/png');
   * // Use imageDataUrl for download or display
   */
  toBase64Image(format = 'image/png') {
    if (!this.chartInstance) {
      console.warn('[TimeSeriesRenderer] No chart instance to export');
      return null;
    }

    return this.chartInstance.toBase64Image(format);
  }
}
