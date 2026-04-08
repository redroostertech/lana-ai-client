/**
 * PieChartRenderer - Reusable ES6 module for rendering pie charts using Chart.js
 *
 * @module PieChartRenderer
 * @description Encapsulates pie chart rendering logic for LANA AI platform analytics.
 * Provides a clean, reusable interface for creating Chart.js pie charts with
 * configurable data, colors, and styling options.
 *
 * @example
 * const renderer = new PieChartRenderer('myChartContainer', [
 *   { label: 'Category A', value: 30 },
 *   { label: 'Category B', value: 50 },
 *   { label: 'Category C', value: 20 }
 * ], {
 *   title: 'Distribution Chart',
 *   legendPosition: 'right',
 *   colors: ['#6366f1', '#10b981', '#f59e0b']
 * });
 *
 * renderer.render();
 *
 * // Later, when component is unmounted
 * renderer.destroy();
 */

import { escapeHtml, destroyChart } from '../chart-utils.js';
import { ChartTheme } from '../chart-theme.js';

export class PieChartRenderer {

  /**
   * Creates an instance of PieChartRenderer
   *
   * @param {string} containerId - DOM element ID where the chart canvas will be created
   * @param {Array<{label: string, value: number}>} data - Array of data points with label and value
   * @param {Object} [config={}] - Configuration options
   * @param {string} [config.title] - Chart title (optional)
   * @param {string} [config.description] - Chart description (optional)
   * @param {string} [config.legendPosition='right'] - Legend position ('top'|'right'|'bottom'|'left')
   * @param {Array<string>} [config.colors] - Custom color palette (optional)
   * @param {number} [config.height=256] - Chart height in pixels (default: 256px / h-64)
   * @param {boolean} [config.responsive=true] - Enable responsive behavior
   * @param {boolean} [config.maintainAspectRatio=false] - Maintain aspect ratio
   * @param {number} [config.legendFontSize=10] - Legend font size in pixels
   * @param {number} [config.legendPadding=10] - Legend label padding in pixels
   * @param {string} [config.helpText] - Help text for info modal (optional)
   *
   * @throws {Error} If containerId is not provided
   * @throws {Error} If data is not an array or is empty
   */
  constructor(containerId, data, config = {}) {
    // Validation
    if (!containerId) {
      throw new Error('PieChartRenderer: containerId is required');
    }

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('PieChartRenderer: data must be a non-empty array');
    }

    // Store configuration
    this.containerId = containerId;
    this.data = data;
    this.config = {
      title: config.title || null,
      description: config.description || null,
      legendPosition: config.legendPosition || 'right',
      colors: config.colors || ChartTheme.getColors(),
      height: config.height || 256,
      responsive: config.responsive !== undefined ? config.responsive : true,
      maintainAspectRatio: config.maintainAspectRatio !== undefined ? config.maintainAspectRatio : false,
      legendFontSize: config.legendFontSize || ChartTheme.font.sizeSmall,
      legendPadding: config.legendPadding || 10,
      helpText: config.helpText || null,
      ...config
    };

    // Internal state
    this.chartInstance = null;
    this.canvasId = `pie-chart-${this._generateUniqueId()}`;
    this.containerElement = null;
  }

  /**
   * Generates a unique ID for the canvas element
   *
   * @private
   * @returns {string} Unique identifier
   */
  _generateUniqueId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Creates the chart container HTML structure
   *
   * @private
   * @returns {HTMLElement} Container div element
   */
  _createContainer() {
    const div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';

    const titleHTML = this.config.title
      ? `<h3 class="text-lg font-semibold text-gray-900">${this.config.title}</h3>`
      : '';

    const descriptionHTML = this.config.description
      ? `<p class="text-sm text-gray-600">${this.config.description}</p>`
      : '';

    const helpTextHTML = this.config.helpText
      ? this._renderHelpTextButton()
      : '';

    div.innerHTML = `
      <div class="mb-4">
        <div class="flex items-center mb-1">
          ${titleHTML}
          ${helpTextHTML}
        </div>
        ${descriptionHTML}
      </div>
      <div style="height: ${this.config.height}px;">
        <canvas id="${this.canvasId}"></canvas>
      </div>
    `;

    return div;
  }

  /**
   * Renders help text button (optional)
   *
   * @private
   * @returns {string} HTML string for help button
   * @description Creates a help button that can be enhanced with modal functionality.
   * If modal is added, ensure helpText content is sanitized using _escapeHtml().
   */
  _renderHelpTextButton() {
    // Simple help button - can be enhanced with modal functionality
    // NOTE: If adding a modal, use escapeHtml() from chart-utils to sanitize helpText content
    return `
      <button
        class="ml-2 text-gray-400 hover:text-gray-600 transition-colors"
        title="Help"
        aria-label="Show help information"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </button>
    `;
  }

  /**
   * Prepares Chart.js configuration object
   *
   * @private
   * @returns {Object} Chart.js configuration
   */
  _getChartConfig() {
    return {
      type: 'pie',
      data: {
        labels: this.data.map(d => d.label),
        datasets: [{
          data: this.data.map(d => d.value),
          backgroundColor: this.config.colors.slice(0, this.data.length),
          borderWidth: 0
        }]
      },
      options: {
        responsive: this.config.responsive,
        maintainAspectRatio: this.config.maintainAspectRatio,
        plugins: {
          legend: {
            position: this.config.legendPosition,
            labels: {
              padding: this.config.legendPadding,
              font: {
                size: this.config.legendFontSize
              },
              boxWidth: 12,
              usePointStyle: false
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.label || '';
                const value = context.parsed;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    };
  }

  /**
   * Renders the pie chart into the DOM
   *
   * @public
   * @returns {HTMLElement} The container element
   * @throws {Error} If container element not found in DOM
   */
  render() {
    // Get container element
    const container = document.getElementById(this.containerId);
    if (!container) {
      throw new Error(`PieChartRenderer: Container element with id "${this.containerId}" not found`);
    }

    // Create and insert chart container
    this.containerElement = this._createContainer();
    container.appendChild(this.containerElement);

    // Render chart with slight delay to ensure DOM is ready
    setTimeout(() => {
      const canvas = document.getElementById(this.canvasId);
      if (!canvas) {
        console.error(`PieChartRenderer: Canvas element with id "${this.canvasId}" not found`);
        return;
      }

      // Destroy existing chart instance if present
      this.chartInstance = destroyChart(this.chartInstance);

      // Create Chart.js instance
      this.chartInstance = new Chart(canvas, this._getChartConfig());
    }, 100);

    return this.containerElement;
  }

  /**
   * Updates chart data without re-rendering entire component
   *
   * @public
   * @param {Array<{label: string, value: number}>} newData - New data points
   * @throws {Error} If newData is invalid
   */
  updateData(newData) {
    if (!Array.isArray(newData) || newData.length === 0) {
      throw new Error('PieChartRenderer: newData must be a non-empty array');
    }

    this.data = newData;

    if (this.chartInstance) {
      this.chartInstance.data.labels = newData.map(d => d.label);
      this.chartInstance.data.datasets[0].data = newData.map(d => d.value);
      this.chartInstance.data.datasets[0].backgroundColor = this.config.colors.slice(0, newData.length);
      this.chartInstance.update();
    }
  }

  /**
   * Updates chart configuration without re-rendering
   *
   * @public
   * @param {Object} newConfig - New configuration options (same format as constructor config)
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };

    if (this.chartInstance) {
      // Update relevant chart options
      if (newConfig.legendPosition) {
        this.chartInstance.options.plugins.legend.position = newConfig.legendPosition;
      }
      if (newConfig.colors) {
        this.chartInstance.data.datasets[0].backgroundColor = newConfig.colors.slice(0, this.data.length);
      }
      this.chartInstance.update();
    }
  }

  /**
   * Destroys the chart instance and removes DOM elements
   *
   * @public
   */
  destroy() {
    // Destroy Chart.js instance
    this.chartInstance = destroyChart(this.chartInstance);

    // Remove container from DOM
    if (this.containerElement && this.containerElement.parentNode) {
      this.containerElement.parentNode.removeChild(this.containerElement);
      this.containerElement = null;
    }
  }

  /**
   * Gets the current Chart.js instance (for advanced customization)
   *
   * @public
   * @returns {Chart|null} Chart.js instance or null if not rendered
   */
  getChartInstance() {
    return this.chartInstance;
  }

  /**
   * Exports chart as base64 image (PNG)
   *
   * @public
   * @returns {string|null} Base64 encoded image or null if chart not rendered
   */
  exportAsImage() {
    if (!this.chartInstance) {
      console.error('PieChartRenderer: Chart not rendered, cannot export image');
      return null;
    }
    return this.chartInstance.toBase64Image();
  }
}

/**
 * Factory function for creating PieChartRenderer instances (alternative to new)
 *
 * @param {string} containerId - DOM element ID
 * @param {Array<{label: string, value: number}>} data - Chart data
 * @param {Object} [config={}] - Configuration options
 * @returns {PieChartRenderer} New renderer instance
 */
export function createPieChartRenderer(containerId, data, config = {}) {
  return new PieChartRenderer(containerId, data, config);
}
