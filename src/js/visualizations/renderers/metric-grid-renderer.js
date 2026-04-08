/**
 * MetricGridRenderer - Reusable metric card grid visualization component
 *
 * Extracted from module-execution.html for component reusability.
 * Renders a responsive grid of metric cards with current/prior/target values,
 * status indicators, change arrows, and drilldown integration.
 *
 * @module visualizations/renderers/metric-grid-renderer
 * @requires Chart.js (for distribution metric pie charts)
 *
 * @example
 * import { MetricGridRenderer } from './visualizations/renderers/metric-grid-renderer.js';
 *
 * const renderer = new MetricGridRenderer('metrics-container', metrics, {
 *   showComparison: true,
 *   gridColumns: 'md:grid-cols-2 lg:grid-cols-3',
 *   onMetricClick: (metricKey, metricName) => { console.log('Clicked:', metricKey); },
 *   onOverrideClick: (metricKey, metricName, description, targetValue, overrideType) => { ... }
 * });
 *
 * renderer.render();
 *
 * // Update metrics dynamically
 * renderer.update(newMetrics);
 *
 * // Cleanup when done
 * renderer.destroy();
 */

import { destroyChart } from '../chart-utils.js';
import { ChartTheme } from '../chart-theme.js';

/**
 * MetricGridRenderer class
 * Renders a grid of metric cards with status indicators, values, and drilldown integration
 */
export class MetricGridRenderer {
  /**
   * Create a MetricGridRenderer instance
   *
   * @param {string|HTMLElement} container - Container element ID or element reference
   * @param {Array<Object>} metrics - Array of metric objects
   * @param {string} metrics[].key - Unique metric identifier
   * @param {string} metrics[].name - Metric display name
   * @param {string} [metrics[].description] - Optional metric description
   * @param {number|Array} metrics[].current - Current period value (number or array for distributions)
   * @param {number} [metrics[].prior] - Prior period value
   * @param {number} [metrics[].target] - Target value
   * @param {string} [metrics[].formattedCurrent] - Pre-formatted current value
   * @param {string} [metrics[].formattedPrior] - Pre-formatted prior value
   * @param {string} [metrics[].formattedTarget] - Pre-formatted target value
   * @param {string} [metrics[].formattedChange] - Pre-formatted change value
   * @param {number} [metrics[].change] - Absolute change from prior period
   * @param {number} [metrics[].changePercent] - Percentage change from prior period
   * @param {string} [metrics[].changeDirection] - Change direction: 'up', 'down', 'flat'
   * @param {string} [metrics[].status] - Status color: 'green', 'yellow', 'red', 'gray'
   * @param {string} [metrics[].type] - Metric type: 'currency', 'count', 'percentage'
   * @param {string} [metrics[].unit] - Unit of measurement: 'dollars', 'count', 'percent'
   * @param {boolean} [metrics[].invertTrend] - Whether to invert trend colors (true = down is good)
   * @param {boolean} [metrics[].hasDrilldown] - Whether metric has drilldown capability
   * @param {Object} config - Configuration options
   * @param {boolean} [config.showComparison=true] - Whether to show prior period comparison
   * @param {string} [config.gridColumns='md:grid-cols-2 lg:grid-cols-3'] - Tailwind grid classes
   * @param {Function} [config.onMetricClick] - Callback when metric details button clicked (metricKey, metricName)
   * @param {Function} [config.onOverrideClick] - Callback when override button clicked (metricKey, metricName, description, targetValue, overrideType)
   * @param {Function} [config.onGenericDrilldownClick] - Callback for generic drilldown (metricKey, metricName)
   * @param {Function} [config.onDistributionSegmentClick] - Callback when distribution chart segment clicked (metricKey, segmentLabel)
   * @param {string} [config.uniqueId] - Unique identifier for this grid instance
   */
  constructor(container, metrics, config = {}) {
    // Resolve container element
    this.container = typeof container === 'string'
      ? document.getElementById(container) || document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error(`MetricGridRenderer: Container not found - ${container}`);
    }

    // Store metrics and configuration
    this.metrics = metrics || [];
    this.config = {
      showComparison: true,
      gridColumns: 'md:grid-cols-2 lg:grid-cols-3',
      onMetricClick: null,
      onOverrideClick: null,
      onGenericDrilldownClick: null,
      onDistributionSegmentClick: null,
      uniqueId: `metric-grid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...config
    };

    // Chart instances for distribution metrics (for cleanup)
    this.chartInstances = {};

    // Grid wrapper element
    this.gridWrapper = null;
    this.gridElement = null;
  }

  /**
   * Render the metric grid
   */
  render() {
    // Clear existing content
    this.container.innerHTML = '';

    // Create wrapper div
    this.gridWrapper = document.createElement('div');
    this.gridWrapper.className = 'mb-6';

    // Create grid
    this.gridElement = document.createElement('div');
    this.gridElement.className = `grid grid-cols-1 ${this.config.gridColumns} gap-6`;
    this.gridElement.id = `grid-${this.config.uniqueId}`;

    // Render metric cards
    this.metrics.forEach(metric => {
      const card = this.createMetricCardElement(metric);
      this.gridElement.appendChild(card);
    });

    this.gridWrapper.appendChild(this.gridElement);
    this.container.appendChild(this.gridWrapper);

    // Render distribution charts after DOM insertion
    setTimeout(() => {
      this.metrics.forEach(metric => {
        if (Array.isArray(metric.current)) {
          const canvasId = `chart-${metric.key}-${this.config.uniqueId}`;
          this.renderDistributionChart(metric, canvasId);
        }
      });
    }, 100);
  }

  /**
   * Update metrics and re-render
   * @param {Array<Object>} newMetrics - Updated metrics array
   */
  update(newMetrics) {
    this.metrics = newMetrics || [];
    this.destroy();
    this.render();
  }

  /**
   * Destroy renderer and cleanup resources
   */
  destroy() {
    // Destroy all chart instances
    Object.values(this.chartInstances).forEach(chart => {
      destroyChart(chart);
    });
    this.chartInstances = {};

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }

    this.gridWrapper = null;
    this.gridElement = null;
  }

  /**
   * Create metric card element
   * @private
   * @param {Object} metric - Metric object
   * @returns {HTMLElement} Card element
   */
  createMetricCardElement(metric) {
    const isDistribution = Array.isArray(metric.current);

    if (isDistribution) {
      return this.createDistributionMetricCard(metric);
    } else {
      return this.createStandardMetricCard(metric);
    }
  }

  /**
   * Create standard metric card (non-distribution)
   * @private
   * @param {Object} metric - Metric object
   * @returns {HTMLElement} Card element
   */
  createStandardMetricCard(metric) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow';

    // Format values
    const isCurrency = metric.type === 'currency' || metric.unit === 'dollars';
    const currentValue = this.formatMetricValue(metric.current, metric.formattedCurrent, isCurrency);
    const priorValue = this.formatMetricValue(metric.prior, metric.formattedPrior, isCurrency);
    const targetValue = this.formatMetricValue(metric.target, metric.formattedTarget, isCurrency);

    // Status and change
    const statusColor = metric.status === 'error' ? 'gray' : (metric.status || 'gray');
    const change = metric.change !== null && metric.change !== undefined ? metric.change : null;
    const changeDirection = metric.changeDirection || 'flat';

    // Arrow HTML
    const arrowHTML = this.getChangeArrowHTML(changeDirection, metric.invertTrend);

    // Change text
    const changeText = this.formatChangeText(change, metric.formattedChange, isCurrency);

    // Build HTML
    card.innerHTML = `
      <!-- Metric Header -->
      <div class="mb-4">
        <!-- Row 1: Metric Name, Status Badge, Details Button -->
        <div class="flex items-center justify-between gap-2 mb-2">
          <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wide">${metric.name}</h3>
          <div class="flex items-center gap-2">
            ${this.getStatusBadgeHTML(statusColor)}
            ${this.getDetailsButtonHTML(metric)}
          </div>
        </div>
        <!-- Row 2: Description -->
        <p class="text-xs text-gray-400">${metric.description || ''}</p>
      </div>

      <!-- Current Value -->
      <div class="mb-4">
        <div class="flex items-center justify-between mb-1">
          <p class="text-xs text-gray-500">Current Period</p>
        </div>
        <p class="text-3xl font-bold text-gray-900">${currentValue}</p>
      </div>

      <!-- Change Indicator -->
      ${this.config.showComparison ? `
      <div class="flex items-center gap-2 mb-4 pb-4 border-b border-gray-100">
        ${arrowHTML}
        <span class="text-sm font-medium ${this.getChangeTextColor(change, metric.invertTrend)}">
          ${changeText} ${change !== null && change !== 0 ? (change > 0 ? 'increase' : 'decrease') : 'no change'}
        </span>
      </div>
      ` : ''}

      <!-- Prior Period & Target -->
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p class="text-xs text-gray-500 mb-1">Prior Period</p>
          <p class="font-semibold text-gray-700">${priorValue}</p>
        </div>
        <div>
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs text-gray-500">Target</p>
            ${this.getOverrideButtonHTML(metric)}
          </div>
          <p class="font-semibold text-gray-700">${targetValue}</p>
        </div>
      </div>
    `;

    // Attach event listeners
    this.attachMetricCardListeners(card, metric);

    return card;
  }

  /**
   * Create distribution metric card (with pie chart)
   * @private
   * @param {Object} metric - Metric object with array current value
   * @returns {HTMLElement} Card element
   */
  createDistributionMetricCard(metric) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow';

    const canvasId = `chart-${metric.key}-${this.config.uniqueId}`;
    const statusColor = metric.status === 'error' ? 'gray' : (metric.status || 'gray');

    // Calculate total count
    let totalCount = 0;
    if (Array.isArray(metric.current)) {
      totalCount = metric.current.reduce((sum, item) => sum + (item.count || 0), 0);
    }

    card.innerHTML = `
      <!-- Metric Header -->
      <div class="flex items-start justify-between mb-4">
        <div class="flex-1">
          <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wide">${metric.name}</h3>
          <p class="text-xs text-gray-400 mt-1">${metric.description || ''}</p>
          <p class="text-xs text-indigo-600 mt-2 font-medium">Click any bar to see actual leads</p>
        </div>
        <div class="flex items-center gap-2">
          ${this.getStatusBadgeHTML(statusColor)}
        </div>
      </div>

      <!-- Total Count -->
      <div class="mb-4">
        <p class="text-xs text-gray-500 mb-1">Total Leads</p>
        <p class="text-2xl font-bold text-gray-900">${this.formatNumber(totalCount, 0)}</p>
      </div>

      <!-- Pie Chart -->
      <div class="mb-4">
        <canvas id="${canvasId}" style="max-height: 250px;"></canvas>
      </div>
    `;

    return card;
  }

  /**
   * Render distribution chart for array metrics
   * @private
   * @param {Object} metric - Metric with array current value
   * @param {string} canvasId - Canvas element ID
   */
  renderDistributionChart(metric, canvasId) {
    if (!Array.isArray(metric.current)) {
      return;
    }

    // Validate Chart.js availability
    if (typeof Chart === 'undefined') {
      console.warn('MetricGridRenderer: Chart.js not available, skipping distribution chart');
      return;
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');

    // Destroy existing chart
    this.chartInstances[canvasId] = destroyChart(this.chartInstances[canvasId]);

    // Prepare data for horizontal bar chart (sorted by count descending)
    const sortedData = [...metric.current].sort((a, b) => (b.count || 0) - (a.count || 0));
    const labels = sortedData.map(item => item.label || 'Unknown');
    const counts = sortedData.map(item => item.count || 0);

    // Generate gradient colors (primary chart color with varying opacity)
    const primaryColor = ChartTheme.getColors(1)[0];
    const backgroundColors = labels.map((_, i) => {
      const intensity = 1 - (i / labels.length) * 0.5;
      return ChartTheme.hexToRgba(primaryColor, intensity);
    });

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Leads',
          data: counts,
          backgroundColor: backgroundColors,
          borderWidth: 0,
          barPercentage: 0.8,
          categoryPercentage: 0.9
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const count = context.parsed.x || 0;
                const percentage = sortedData[context.dataIndex]?.value || 0;
                return `${count} leads (${percentage}%)`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          },
          y: {
            ticks: {
              autoSkip: false
            }
          }
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const segmentLabel = labels[index];
            if (this.config.onDistributionSegmentClick) {
              this.config.onDistributionSegmentClick(metric.key, segmentLabel);
            }
          }
        }
      }
    });

    this.chartInstances[canvasId] = chart;
  }

  /**
   * Attach event listeners to metric card buttons
   * @private
   * @param {HTMLElement} card - Card element
   * @param {Object} metric - Metric object
   */
  attachMetricCardListeners(card, metric) {
    // Details button
    const detailsBtn = card.querySelector('[data-details-btn]');
    if (detailsBtn) {
      detailsBtn.addEventListener('click', () => {
        if (metric.hasDrilldown === true && this.config.onGenericDrilldownClick) {
          this.config.onGenericDrilldownClick(metric.key, metric.name);
        } else if (this.config.onMetricClick) {
          this.config.onMetricClick(metric.key, metric.name);
        }
      });
    }

    // Override button
    const overrideBtn = card.querySelector('[data-override-btn]');
    if (overrideBtn) {
      overrideBtn.addEventListener('click', () => {
        if (this.config.onOverrideClick) {
          this.config.onOverrideClick(
            metric.key,
            metric.name,
            metric.description || '',
            metric.target,
            'target'
          );
        }
      });
    }
  }

  /**
   * Format metric value (currency or number)
   * @private
   * @param {number} value - Raw value
   * @param {string} formattedValue - Pre-formatted value (optional)
   * @param {boolean} isCurrency - Whether to format as currency
   * @returns {string} Formatted value
   */
  formatMetricValue(value, formattedValue, isCurrency) {
    if (value === null || value === undefined) {
      return 'N/A';
    }

    if (formattedValue) {
      return formattedValue;
    }

    if (isCurrency) {
      return this.formatCurrency(value);
    }

    return this.formatNumber(value, 0);
  }

  /**
   * Format currency value
   * @private
   * @param {number} value - Numeric value
   * @returns {string} Formatted currency string
   */
  formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) {
      return 'N/A';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  /**
   * Format number value
   * @private
   * @param {number} value - Numeric value
   * @param {number} decimals - Number of decimal places
   * @returns {string} Formatted number string
   */
  formatNumber(value, decimals = 0) {
    if (value === null || value === undefined) {
      return 'N/A';
    }
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }

  /**
   * Format change text
   * @private
   * @param {number} change - Change value
   * @param {string} formattedChange - Pre-formatted change
   * @param {boolean} isCurrency - Whether to format as currency
   * @returns {string} Formatted change text
   */
  formatChangeText(change, formattedChange, isCurrency) {
    if (change === null || change === undefined) {
      return 'N/A';
    }

    if (formattedChange) {
      return formattedChange;
    }

    if (isCurrency) {
      const formatted = this.formatCurrency(Math.abs(change));
      return formatted.replace('$', '').replace('$', ''); // Remove duplicate $
    }

    return this.formatNumber(Math.abs(change), 1);
  }

  /**
   * Get status badge HTML
   * @private
   * @param {string} color - Status color (green, yellow, red, gray)
   * @returns {string} Badge HTML
   */
  getStatusBadgeHTML(color) {
    const colors = {
      green: { bg: 'bg-green-100', text: 'text-green-800', icon: 'M5 13l4 4L19 7' },
      yellow: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      red: { bg: 'bg-red-100', text: 'text-red-800', icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
      gray: { bg: 'bg-gray-100', text: 'text-gray-800', icon: 'M8 7h12M8 12h12M8 17h12' }
    };

    const c = colors[color] || colors.gray;
    return `
      <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${c.bg} ${c.text}">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${c.icon}"></path>
        </svg>
        <span class="text-xs font-medium uppercase">${color}</span>
      </div>
    `;
  }

  /**
   * Get details button HTML
   * @private
   * @param {Object} metric - Metric object
   * @returns {string} Button HTML
   */
  getDetailsButtonHTML(metric) {
    if (metric.hasDrilldown === false) {
      return '';
    }

    const buttonText = metric.hasDrilldown === true ? 'View detailed data breakdown' : 'View details and see how this is calculated';

    return `
      <button
        data-details-btn
        class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
        title="${buttonText}"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          ${metric.hasDrilldown === true
            ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>'
            : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>'
          }
        </svg>
        Details
      </button>
    `;
  }

  /**
   * Get override button HTML
   * @private
   * @param {Object} metric - Metric object
   * @returns {string} Button HTML
   */
  getOverrideButtonHTML(metric) {
    return `
      <button
        data-override-btn
        class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
        title="Override target value"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
        </svg>
        Override
      </button>
    `;
  }

  /**
   * Get change arrow SVG HTML
   * @private
   * @param {string} direction - Change direction (up, down, flat)
   * @param {boolean} invertTrend - Whether to invert trend colors
   * @returns {string} Arrow SVG HTML
   */
  getChangeArrowHTML(direction, invertTrend) {
    const upColor = invertTrend ? 'text-red-600' : 'text-green-600';
    const downColor = invertTrend ? 'text-green-600' : 'text-red-600';

    if (direction === 'up') {
      return `<svg class="w-4 h-4 ${upColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>`;
    } else if (direction === 'down') {
      return `<svg class="w-4 h-4 ${downColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>`;
    } else {
      return '<svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14"></path></svg>';
    }
  }

  /**
   * Get change text color class
   * @private
   * @param {number} change - Change value
   * @param {boolean} invertTrend - Whether to invert trend colors
   * @returns {string} Tailwind color class
   */
  getChangeTextColor(change, invertTrend) {
    if (change === null || change === 0) {
      return 'text-gray-600';
    }

    if (invertTrend) {
      return change > 0 ? 'text-red-600' : 'text-green-600';
    } else {
      return change > 0 ? 'text-green-600' : 'text-red-600';
    }
  }
}
