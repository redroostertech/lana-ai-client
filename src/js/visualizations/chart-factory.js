/**
 * ChartFactory - Unified factory pattern for creating chart renderer instances
 *
 * Provides a centralized interface for instantiating all chart renderer types
 * used throughout the LANA AI platform. Abstracts renderer selection logic
 * and provides graceful error handling for unknown visualization types.
 *
 * @module visualizations/chart-factory
 * @requires visualizations/renderers/time-series-renderer
 * @requires visualizations/renderers/pie-chart-renderer
 * @requires visualizations/renderers/funnel-chart-renderer
 * @requires visualizations/renderers/bar-chart-renderer
 * @requires visualizations/renderers/bubble-chart-renderer
 * @requires visualizations/renderers/metric-grid-renderer
 *
 * @example
 * import { ChartFactory, createChart } from './visualizations/chart-factory.js';
 *
 * // Using the factory class
 * const renderer = ChartFactory.createRenderer(
 *   { type: 'time_series', title: 'Revenue Trends' },
 *   'chart-container-id',
 *   timeSeriesData,
 *   { fill: true, tension: 0.4 }
 * );
 * renderer.render();
 *
 * // Using the convenience function
 * const pieRenderer = createChart(
 *   { type: 'pie_chart', title: 'Matter Distribution' },
 *   'pie-container',
 *   pieData
 * );
 * pieRenderer.render();
 *
 * @example
 * // Error handling for unknown types
 * try {
 *   const renderer = ChartFactory.createRenderer(
 *     { type: 'unknown_chart' },
 *     'container',
 *     data
 *   );
 * } catch (error) {
 *   console.error('Failed to create renderer:', error.message);
 *   // Display fallback UI or error message
 * }
 */

// Import all chart renderer classes
import { TimeSeriesRenderer } from './renderers/time-series-renderer.js';
import { PieChartRenderer } from './renderers/pie-chart-renderer.js';
import { FunnelChartRenderer } from './renderers/funnel-chart-renderer.js';
import { BarChartRenderer } from './renderers/bar-chart-renderer.js';
import { BubbleChartRenderer } from './renderers/bubble-chart-renderer.js';
import { MetricGridRenderer } from './renderers/metric-grid-renderer.js';

/**
 * ChartFactory class
 *
 * Factory pattern implementation for creating chart renderer instances.
 * Centralizes renderer instantiation logic and provides type validation.
 */
export class ChartFactory {
  /**
   * Supported visualization types mapped to their renderer classes
   *
   * @private
   * @static
   * @readonly
   * @type {Object.<string, Function>}
   */
  static RENDERER_MAP = {
    time_series: TimeSeriesRenderer,
    pie_chart: PieChartRenderer,
    funnel_chart: FunnelChartRenderer,
    bar_chart: BarChartRenderer,
    bubble_chart: BubbleChartRenderer,
    metric_grid: MetricGridRenderer,

    // Aliases for common variations
    timeseries: TimeSeriesRenderer,
    pie: PieChartRenderer,
    funnel: FunnelChartRenderer,
    bar: BarChartRenderer,
    horizontal_bar: BarChartRenderer,
    vertical_bar: BarChartRenderer,
    bubble: BubbleChartRenderer,
    grid: MetricGridRenderer,
    metrics: MetricGridRenderer,
    metric: MetricGridRenderer
  };

  /**
   * Create a chart renderer instance based on visualization configuration
   *
   * @param {Object} visualizationConfig - Visualization configuration object
   * @param {string} visualizationConfig.type - Visualization type (e.g., 'time_series', 'pie_chart')
   * @param {string} [visualizationConfig.title] - Chart title
   * @param {string} [visualizationConfig.description] - Chart description
   * @param {string|HTMLElement} containerId - DOM element ID or element reference for chart container
   * @param {*} data - Chart data (format varies by renderer type)
   * @param {Object} [config={}] - Renderer-specific configuration options
   *
   * @returns {Object} Chart renderer instance with render() and destroy() methods
   *
   * @throws {Error} If visualizationConfig is missing or invalid
   * @throws {Error} If visualization type is unknown or unsupported
   * @throws {Error} If required renderer dependencies are missing
   *
   * @example
   * const renderer = ChartFactory.createRenderer(
   *   { type: 'time_series', title: 'Revenue Over Time' },
   *   'revenue-chart',
   *   timeSeriesData,
   *   { fill: true, colors: ['#6366f1', '#10b981'] }
   * );
   * renderer.render();
   *
   * @example
   * // With grouped bar chart configuration
   * const renderer = ChartFactory.createRenderer(
   *   { type: 'bar_chart', title: 'Matter Status Distribution' },
   *   'status-chart',
   *   barData,
   *   { orientation: 'horizontal', colors: { positive: '#10b981', negative: '#ef4444' } }
   * );
   */
  static createRenderer(visualizationConfig, containerId, data, config = {}) {
    // Validate visualization configuration
    if (!visualizationConfig || typeof visualizationConfig !== 'object') {
      throw new Error(
        'ChartFactory: visualizationConfig is required and must be an object'
      );
    }

    if (!visualizationConfig.type) {
      throw new Error(
        'ChartFactory: visualizationConfig.type is required (e.g., "time_series", "pie_chart")'
      );
    }

    // Normalize type to lowercase for case-insensitive matching
    const type = visualizationConfig.type.toLowerCase().trim();

    // Lookup renderer class
    const RendererClass = ChartFactory.RENDERER_MAP[type];

    if (!RendererClass) {
      const supportedTypes = Object.keys(ChartFactory.RENDERER_MAP)
        .filter((key) => !key.includes('_') || key === 'time_series' || key === 'pie_chart')
        .join(', ');

      throw new Error(
        `ChartFactory: Unknown visualization type "${visualizationConfig.type}". ` +
        `Supported types: ${supportedTypes}`
      );
    }

    // Merge visualization config with renderer config
    const mergedConfig = {
      ...config,
      title: visualizationConfig.title || config.title,
      description: visualizationConfig.description || config.description
    };

    // Instantiate renderer
    try {
      return new RendererClass(containerId, data, mergedConfig);
    } catch (error) {
      throw new Error(
        `ChartFactory: Failed to instantiate ${type} renderer - ${error.message}`
      );
    }
  }

  /**
   * Get list of all supported visualization types
   *
   * @returns {Array<string>} Array of supported visualization type identifiers
   *
   * @example
   * const supportedTypes = ChartFactory.getSupportedTypes();
   * console.log(supportedTypes);
   * // ['time_series', 'pie_chart', 'funnel_chart', 'bar_chart', 'bubble_chart', 'metric_grid']
   */
  static getSupportedTypes() {
    // Return only primary types (exclude aliases)
    return Object.keys(ChartFactory.RENDERER_MAP).filter((type) =>
      type.includes('_') || type === 'grid'
    );
  }

  /**
   * Check if a visualization type is supported
   *
   * @param {string} type - Visualization type to check
   * @returns {boolean} True if type is supported, false otherwise
   *
   * @example
   * if (ChartFactory.isTypeSupported('time_series')) {
   *   // Safe to use
   * }
   */
  static isTypeSupported(type) {
    if (!type || typeof type !== 'string') {
      return false;
    }
    const normalizedType = type.toLowerCase().trim();
    return normalizedType in ChartFactory.RENDERER_MAP;
  }

  /**
   * Get renderer class for a given visualization type (advanced usage)
   *
   * @param {string} type - Visualization type
   * @returns {Function|null} Renderer class constructor or null if not found
   *
   * @example
   * const RendererClass = ChartFactory.getRendererClass('time_series');
   * if (RendererClass) {
   *   const renderer = new RendererClass('container', data, config);
   * }
   */
  static getRendererClass(type) {
    if (!type || typeof type !== 'string') {
      return null;
    }
    const normalizedType = type.toLowerCase().trim();
    return ChartFactory.RENDERER_MAP[normalizedType] || null;
  }
}

/**
 * Convenience function for creating chart renderers
 *
 * Provides a shorter syntax for the common use case of creating
 * and immediately rendering a chart.
 *
 * @param {Object} visualizationConfig - Visualization configuration
 * @param {string|HTMLElement} containerId - Container element ID or reference
 * @param {*} data - Chart data
 * @param {Object} [config={}] - Renderer configuration
 * @returns {Object} Chart renderer instance
 *
 * @example
 * import { createChart } from './visualizations/chart-factory.js';
 *
 * const renderer = createChart(
 *   { type: 'pie_chart', title: 'Matter Distribution' },
 *   'chart-div',
 *   pieData
 * );
 * renderer.render();
 */
export function createChart(visualizationConfig, containerId, data, config = {}) {
  return ChartFactory.createRenderer(visualizationConfig, containerId, data, config);
}

/**
 * Export all renderer classes for direct usage when needed
 *
 * @example
 * import { TimeSeriesRenderer } from './visualizations/chart-factory.js';
 * const renderer = new TimeSeriesRenderer('container', data, config);
 */
export {
  TimeSeriesRenderer,
  PieChartRenderer,
  FunnelChartRenderer,
  BarChartRenderer,
  BubbleChartRenderer,
  MetricGridRenderer
};
