/**
 * Chart Utilities — Shared helpers for all visualization renderers.
 *
 * Extracted from duplicate code across TimeSeriesRenderer, BarChartRenderer,
 * BubbleChartRenderer, and GroupedBarChartRenderer. Import from here
 * instead of re-implementing.
 *
 * @module visualizations/chart-utils
 */

/**
 * Sample a large dataset to improve rendering performance.
 * Preserves first and last points to maintain data boundaries.
 *
 * @param {Array} data - Original dataset
 * @param {number} [maxPoints=1000] - Maximum number of points
 * @returns {Array} Sampled dataset (or original if within limit)
 */
export function sampleData(data, maxPoints) {
  if (maxPoints === undefined) maxPoints = 1000;
  if (!Array.isArray(data) || data.length <= maxPoints) return data;

  var step = Math.ceil(data.length / maxPoints);
  var sampled = [];
  for (var i = 0; i < data.length; i += step) {
    sampled.push(data[i]);
  }
  // Always include the last point
  if (sampled[sampled.length - 1] !== data[data.length - 1]) {
    sampled.push(data[data.length - 1]);
  }
  return sampled;
}

/**
 * Escape HTML special characters to prevent XSS.
 * Uses string split/join — no regex.
 *
 * @param {string} unsafe - Unescaped string
 * @returns {string} Escaped string safe for innerHTML
 */
export function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

/**
 * Convert hex color to rgba string.
 *
 * @param {string} hex - Hex color (e.g. '#595246' or '#abc')
 * @param {number} alpha - Alpha value 0-1
 * @returns {string} rgba string
 */
export function hexToRgba(hex, alpha) {
  if (!hex) return 'rgba(0,0,0,' + alpha + ')';
  var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  var r = parseInt(h.slice(0, 2), 16);
  var g = parseInt(h.slice(2, 4), 16);
  var b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/**
 * Convert a snake_case or underscore-separated key to Title Case.
 *
 * @param {string} key - e.g. 'total_revenue' or 'tasks_completed'
 * @returns {string} e.g. 'Total Revenue' or 'Tasks Completed'
 */
export function keyToLabel(key) {
  if (!key) return '';
  return key.split('_').map(function (word) {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/**
 * Format a number for display with appropriate suffixes.
 *
 * @param {number} value - The number to format
 * @param {string} [format] - Format type: 'currency', 'percent', 'compact', or default
 * @returns {string} Formatted string
 */
export function formatValue(value, format) {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value !== 'number') value = Number(value);
  if (isNaN(value)) return 'N/A';

  if (format === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(value);
  }
  if (format === 'percent') {
    return (value * 100).toFixed(1) + '%';
  }
  if (format === 'compact') {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
    return value.toFixed(0);
  }
  // Default: locale number
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Create a standard Chart.js scales config with Lex theming.
 *
 * @param {Object} [options]
 * @param {boolean} [options.showGrid=true] - Show grid lines
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.yLabel] - Y-axis label
 * @param {boolean} [options.beginAtZero=true] - Start Y at zero
 * @returns {Object} Chart.js scales config
 */
export function createScalesConfig(options) {
  var opts = options || {};
  var showGrid = opts.showGrid !== false;

  // Import theme at call time (lazy) to avoid circular deps
  var gridColor, borderColor, textColor;
  try {
    var theme = window._lexChartTheme;
    gridColor = theme ? theme.grid.color() : '#F5F3F0';
    borderColor = theme ? theme.grid.borderColor() : '#E8E5E1';
    textColor = theme ? theme.font.colorTertiary() : '#9E9385';
  } catch (e) {
    gridColor = '#F5F3F0';
    borderColor = '#E8E5E1';
    textColor = '#9E9385';
  }

  var scales = {
    x: {
      grid: { display: showGrid, color: gridColor, drawBorder: false },
      border: { display: true, color: borderColor },
      ticks: { color: textColor, maxRotation: 45, autoSkip: true },
    },
    y: {
      grid: { display: showGrid, color: gridColor, drawBorder: false },
      border: { display: false },
      ticks: { color: textColor },
      beginAtZero: opts.beginAtZero !== false,
    },
  };

  if (opts.xLabel) {
    scales.x.title = { display: true, text: opts.xLabel, color: textColor };
  }
  if (opts.yLabel) {
    scales.y.title = { display: true, text: opts.yLabel, color: textColor };
  }

  return scales;
}

/**
 * Safely destroy a Chart.js instance and clean up.
 *
 * @param {Object|null} chartInstance - Chart.js instance
 * @returns {null}
 */
export function destroyChart(chartInstance) {
  if (chartInstance && typeof chartInstance.destroy === 'function') {
    try { chartInstance.destroy(); } catch (e) { /* ignore */ }
  }
  return null;
}
