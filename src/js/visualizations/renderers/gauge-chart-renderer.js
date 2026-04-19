/**
 * GaugeChartRenderer - Reusable semicircle gauge visualization component
 *
 * Renders a single value within a min/max range as a half-doughnut gauge,
 * with optional target marker, status color bands, and a center value label.
 *
 * Used by modules that need to express a single "where am I against my goal"
 * metric (client satisfaction score, completion rate, capacity utilization, etc.).
 *
 * @module visualizations/renderers/gauge-chart-renderer
 * @requires Chart.js (must be loaded globally)
 *
 * @example
 * import { GaugeChartRenderer } from './gauge-chart-renderer.js';
 *
 * const renderer = new GaugeChartRenderer('chart-container', {
 *   value: 4.2,
 *   min: 0,
 *   max: 5,
 *   target: 4.5
 * }, {
 *   title: 'Client Satisfaction Score',
 *   format: 'number',
 *   decimals: 1,
 *   suffix: ' / 5',
 *   colorBands: [
 *     { from: 0,   to: 2.5, color: '#F04438' },
 *     { from: 2.5, to: 4,   color: '#F79009' },
 *     { from: 4,   to: 5,   color: '#17B26A' }
 *   ]
 * });
 *
 * renderer.render();
 * renderer.destroy();
 */

import { escapeHtml, destroyChart } from '../chart-utils.js';
import { ChartTheme } from '../chart-theme.js';

const DEFAULT_HEIGHT = 240;

export class GaugeChartRenderer {
  /**
   * @param {string|HTMLElement} container - Container element or its ID
   * @param {Object|number} data - Either a number (treated as value, 0..100 default range)
   *   or an object: { value, min?, max?, target?, status? }
   * @param {Object} [config={}]
   * @param {string} [config.title]
   * @param {string} [config.description]
   * @param {string} [config.format]   'number' | 'percentage' | 'currency' | 'score'
   * @param {number} [config.decimals=1]
   * @param {string} [config.prefix='']
   * @param {string} [config.suffix='']
   * @param {Array<{from:number,to:number,color:string}>} [config.colorBands]
   *   Color ranges painted under the gauge arc. If absent, derives bands from
   *   `status` ('green'|'yellow'|'red') or falls back to a single brand color.
   * @param {string} [config.trackColor]   Color of the empty (remaining) arc segment
   * @param {boolean} [config.showTarget=true]   Draw target marker if data.target present
   * @param {boolean} [config.showRange=true]    Show min/max labels under the arc
   * @param {number} [config.height=240]
   * @param {Object} [config.helpText]
   */
  constructor(container, data, config = {}) {
    this.container = typeof container === 'string'
      ? document.getElementById(container) || document.querySelector(container)
      : container;

    if (!this.container) {
      throw new Error(`GaugeChartRenderer: Container not found - ${container}`);
    }

    if (typeof Chart === 'undefined') {
      throw new Error('GaugeChartRenderer: Chart.js library not found. Please ensure Chart.js is loaded.');
    }

    this.data = this._normalizeData(data);
    this.config = {
      title: null,
      description: null,
      format: 'number',
      decimals: 1,
      prefix: '',
      suffix: '',
      colorBands: null,
      trackColor: null,
      showTarget: true,
      showRange: true,
      height: DEFAULT_HEIGHT,
      helpText: null,
      uniqueId: `gauge-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...config
    };

    this.chartInstance = null;
    this.canvas = null;
    this.wrapper = null;
    this.canvasId = `gauge-canvas-${this.config.uniqueId}`;
  }

  /**
   * Coerce loose input into the canonical { value, min, max, target, status } shape.
   *
   * @private
   */
  _normalizeData(input) {
    if (input == null) {
      return { value: 0, min: 0, max: 100, target: null, status: null };
    }
    if (typeof input === 'number') {
      return { value: input, min: 0, max: 100, target: null, status: null };
    }
    const value = Number(input.value ?? input.current ?? 0);
    const min = Number(input.min ?? 0);
    const maxRaw = input.max ?? input.maximum;
    // If no explicit max, infer from value or default to 100
    const max = Number(maxRaw != null ? maxRaw : (value > 100 ? Math.ceil(value * 1.2) : 100));
    const target = input.target != null ? Number(input.target) : null;
    const status = typeof input.status === 'string' ? input.status : null;
    return { value, min, max, target, status };
  }

  /**
   * Build the color band list. Priority:
   *   1) Explicit config.colorBands
   *   2) Derived from data.status ('green'|'yellow'|'red')
   *   3) Single-color brand fill
   *
   * @private
   */
  _resolveBands() {
    if (Array.isArray(this.config.colorBands) && this.config.colorBands.length) {
      return this.config.colorBands;
    }
    const { min, max, status } = this.data;
    let color;
    if (status === 'green') color = ChartTheme.status.success();
    else if (status === 'yellow') color = ChartTheme.status.warning();
    else if (status === 'red') color = ChartTheme.status.danger();
    else color = ChartTheme.getColors(1)[0];
    return [{ from: min, to: max, color }];
  }

  /**
   * Build the doughnut dataset. Each band becomes its own segment, plus
   * a final "track" segment for the un-filled portion above the value.
   *
   * @private
   */
  _buildDataset() {
    const { value, min, max } = this.data;
    const bands = this._resolveBands();
    const range = Math.max(max - min, 0.0001);
    const clampedValue = Math.max(min, Math.min(max, value));

    const segments = [];
    const colors = [];
    let painted = 0;

    for (const band of bands) {
      const bandStart = Math.max(min, band.from);
      const bandEnd = Math.min(max, band.to);
      const span = Math.max(bandEnd - bandStart, 0);
      if (span <= 0) continue;

      const filled = Math.max(0, Math.min(span, clampedValue - bandStart));
      if (filled > 0) {
        segments.push(filled);
        colors.push(band.color);
        painted += filled;
      }
    }

    const remaining = Math.max(range - (clampedValue - min), 0);
    if (remaining > 0) {
      segments.push(remaining);
      colors.push(this.config.trackColor || ChartTheme.statusBg.neutral());
    }

    return { segments, colors };
  }

  /**
   * Format the gauge's center value.
   *
   * @private
   */
  _formatValue(value) {
    const { format, decimals, prefix, suffix } = this.config;
    if (value == null || isNaN(value)) return '—';

    if (format === 'percentage') {
      return `${prefix}${value.toFixed(decimals)}%${suffix}`;
    }
    if (format === 'currency') {
      return `${prefix}${new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
      }).format(value)}${suffix}`;
    }
    return `${prefix}${Number(value).toFixed(decimals)}${suffix}`;
  }

  /**
   * Centered-text Chart.js plugin. Draws value + optional target line inside
   * the gauge cutout. Built fresh per instance so there's no global plugin
   * registration leak.
   *
   * @private
   */
  _centerTextPlugin() {
    const renderer = this;
    return {
      id: `gauge-center-${this.config.uniqueId}`,
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const { value, target, max } = renderer.data;

        const centerX = (chartArea.left + chartArea.right) / 2;
        const baselineY = chartArea.bottom - 10;
        const valueText = renderer._formatValue(value);

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = ChartTheme.font.colorPrimary();
        ctx.font = `600 28px ${ChartTheme.font.family()}`;
        ctx.fillText(valueText, centerX, baselineY - 10);

        if (renderer.config.showTarget && target != null) {
          ctx.fillStyle = ChartTheme.font.colorSecondary
            ? ChartTheme.font.colorSecondary()
            : '#6B6258';
          ctx.font = `400 12px ${ChartTheme.font.family()}`;
          ctx.fillText(
            `Target: ${renderer._formatValue(target)}`,
            centerX,
            baselineY + 8
          );
        }

        if (renderer.config.showRange) {
          ctx.fillStyle = ChartTheme.font.colorTertiary
            ? ChartTheme.font.colorTertiary()
            : '#9E9385';
          ctx.font = `400 11px ${ChartTheme.font.family()}`;
          ctx.fillText(
            `${renderer.data.min} – ${max}`,
            centerX,
            baselineY + 24
          );
        }
        ctx.restore();
      }
    };
  }

  _getChartConfig() {
    const { segments, colors } = this._buildDataset();

    return {
      type: 'doughnut',
      data: {
        datasets: [{
          data: segments,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        rotation: -90,
        circumference: 180,
        cutout: '70%',
        layout: {
          padding: { top: 8, bottom: 8 }
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        },
        animation: { duration: 600 }
      },
      plugins: [this._centerTextPlugin()]
    };
  }

  _createWrapper() {
    const div = document.createElement('div');
    div.className = 'gauge-chart-wrapper';
    div.style.cssText = 'background: var(--lex-color-bg-card, #ffffff); border-radius: 12px; padding: 20px; margin-bottom: 16px;';

    const titleHTML = this.config.title
      ? `<h3 style="font-size: 14px; font-weight: 600; color: ${ChartTheme.font.colorPrimary()}; margin: 0 0 4px 0;">${escapeHtml(this.config.title)}</h3>`
      : '';
    const descHTML = this.config.description
      ? `<p style="font-size: 12px; color: ${ChartTheme.font.colorTertiary ? ChartTheme.font.colorTertiary() : '#9E9385'}; margin: 0 0 12px 0;">${escapeHtml(this.config.description)}</p>`
      : '';

    div.innerHTML = `
      ${titleHTML}
      ${descHTML}
      <div style="position: relative; height: ${this.config.height}px;">
        <canvas id="${this.canvasId}"></canvas>
      </div>
    `;
    return div;
  }

  /**
   * Render the gauge into the container.
   *
   * @public
   * @returns {HTMLElement} The wrapper element appended to the container
   */
  render() {
    this.wrapper = this._createWrapper();
    this.container.appendChild(this.wrapper);

    // Defer chart creation one tick so the canvas has dimensions
    setTimeout(() => {
      this.canvas = document.getElementById(this.canvasId);
      if (!this.canvas) {
        console.error(`GaugeChartRenderer: canvas "${this.canvasId}" not found`);
        return;
      }
      this.chartInstance = destroyChart(this.chartInstance);
      this.chartInstance = new Chart(this.canvas, this._getChartConfig());
    }, 0);

    return this.wrapper;
  }

  /**
   * Replace the gauge value (and optionally min/max/target) without recreating the wrapper.
   *
   * @public
   * @param {Object|number} newData
   */
  update(newData) {
    this.data = this._normalizeData(newData);
    if (!this.chartInstance) return;
    const { segments, colors } = this._buildDataset();
    this.chartInstance.data.datasets[0].data = segments;
    this.chartInstance.data.datasets[0].backgroundColor = colors;
    this.chartInstance.update();
  }

  /**
   * Clean up Chart.js instance and remove DOM nodes.
   *
   * @public
   */
  destroy() {
    this.chartInstance = destroyChart(this.chartInstance);
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
      this.wrapper = null;
    }
    this.canvas = null;
  }

  /**
   * Get the current Chart.js instance (advanced).
   *
   * @public
   * @returns {Chart|null}
   */
  getChartInstance() {
    return this.chartInstance;
  }
}

/**
 * Convenience factory mirroring other renderers in this directory.
 */
export function createGaugeChartRenderer(container, data, config = {}) {
  return new GaugeChartRenderer(container, data, config);
}
