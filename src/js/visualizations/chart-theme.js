/**
 * Chart Theme — Centralized Lex Design Token Mapping for Chart.js
 *
 * Single source of truth for all chart colors, fonts, and styling.
 * Reads from CSS custom properties (Lex tokens) at runtime so charts
 * automatically adapt to theme changes.
 *
 * To rebrand: change the CSS variables in lex-tokens.css.
 * All charts update automatically.
 *
 * @module visualizations/chart-theme
 */

export const ChartTheme = {

  // ── Color Palette ─────────────────────────────────────────────
  // Ordered by visual distinctiveness. First 6 cover most charts.
  // Reads from CSS vars at call time for live theme support.

  /**
   * Get the chart color palette.
   * Falls back to hardcoded values if CSS vars aren't available (SSR, tests).
   *
   * @param {number} [count] - Number of colors needed (returns full palette if omitted)
   * @returns {string[]}
   */
  getColors: function (count) {
    var root = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    function cv(name, fallback) {
      if (!root) return fallback;
      var val = root.getPropertyValue(name);
      return val && val.trim() ? val.trim() : fallback;
    }

    var palette = [
      cv('--lex-chart-color-1', '#595246'),   // Brand 600 (primary)
      cv('--lex-chart-color-2', '#17B26A'),   // Success 500
      cv('--lex-chart-color-3', '#528BFF'),   // Info 500
      cv('--lex-chart-color-4', '#F79009'),   // Warning 500
      cv('--lex-chart-color-5', '#F04438'),   // Danger 500
      cv('--lex-chart-color-6', '#9E9385'),   // Brand 400
      cv('--lex-chart-color-7', '#7C3AED'),   // Violet
      cv('--lex-chart-color-8', '#06B6D4'),   // Cyan
      cv('--lex-chart-color-9', '#D946EF'),   // Fuchsia
      cv('--lex-chart-color-10', '#84CC16'),  // Lime
    ];

    if (count && count > 0) return palette.slice(0, count);
    return palette;
  },

  // ── Status Colors ─────────────────────────────────────────────

  status: {
    success:  function () { return ChartTheme._cv('--lex-status-success', '#17B26A'); },
    warning:  function () { return ChartTheme._cv('--lex-status-warning', '#F79009'); },
    danger:   function () { return ChartTheme._cv('--lex-status-danger', '#F04438'); },
    info:     function () { return ChartTheme._cv('--lex-status-info', '#528BFF'); },
    neutral:  function () { return ChartTheme._cv('--lex-color-gray-400', '#A9A49D'); },
  },

  // ── Status Background Colors ──────────────────────────────────

  statusBg: {
    success:  function () { return ChartTheme._cv('--lex-status-success-bg', '#ECFDF3'); },
    warning:  function () { return ChartTheme._cv('--lex-status-warning-bg', '#FFFAEB'); },
    danger:   function () { return ChartTheme._cv('--lex-status-danger-bg', '#FEF3F2'); },
    info:     function () { return ChartTheme._cv('--lex-status-info-bg', '#EFF4FF'); },
    neutral:  function () { return ChartTheme._cv('--lex-color-gray-100', '#F5F3F0'); },
  },

  // ── Typography ────────────────────────────────────────────────

  font: {
    family: function () { return ChartTheme._cv('--lex-font-sans', "'Inter', system-ui, sans-serif"); },
    sizeSmall: 11,
    sizeDefault: 12,
    sizeMedium: 13,
    sizeLarge: 14,
    colorPrimary:   function () { return ChartTheme._cv('--lex-text-primary', '#1D1B18'); },
    colorSecondary: function () { return ChartTheme._cv('--lex-text-secondary', '#736B5C'); },
    colorTertiary:  function () { return ChartTheme._cv('--lex-text-tertiary', '#9E9385'); },
  },

  // ── Grid & Borders ────────────────────────────────────────────

  grid: {
    color:       function () { return ChartTheme._cv('--lex-border-subtle', '#F5F3F0'); },
    borderColor: function () { return ChartTheme._cv('--lex-border-default', '#E8E5E1'); },
  },

  // ── Backgrounds ───────────────────────────────────────────────

  bg: {
    card:    function () { return ChartTheme._cv('--lex-bg-primary', '#FFFFFF'); },
    tooltip: function () { return ChartTheme._cv('--lex-color-gray-900', '#1D1B18'); },
  },

  // ── Spacing & Sizing ──────────────────────────────────────────

  radius: {
    sm: 4,
    md: 8,
    lg: 12,
  },

  // ── Chart.js Global Defaults ──────────────────────────────────
  // Call once at startup to set Chart.js defaults from Lex tokens.

  /**
   * Apply Lex theme to Chart.js global defaults.
   * Call this once when the app loads.
   */
  applyDefaults: function () {
    if (typeof Chart === 'undefined') return;

    Chart.defaults.font.family = ChartTheme.font.family();
    Chart.defaults.font.size = ChartTheme.font.sizeDefault;
    Chart.defaults.color = ChartTheme.font.colorSecondary();
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    Chart.defaults.plugins.legend.labels.padding = 16;
    Chart.defaults.plugins.tooltip.backgroundColor = ChartTheme.bg.tooltip();
    Chart.defaults.plugins.tooltip.titleFont = { size: ChartTheme.font.sizeMedium, weight: '600' };
    Chart.defaults.plugins.tooltip.bodyFont = { size: ChartTheme.font.sizeDefault };
    Chart.defaults.plugins.tooltip.cornerRadius = ChartTheme.radius.md;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.elements.line.tension = 0.4;
    Chart.defaults.elements.point.radius = 3;
    Chart.defaults.elements.point.hoverRadius = 5;
    Chart.defaults.elements.bar.borderRadius = ChartTheme.radius.sm;
  },

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Convert hex color to rgba with alpha.
   *
   * @param {string} hex - Hex color (e.g. '#595246')
   * @param {number} alpha - Alpha value 0-1
   * @returns {string} rgba string
   */
  hexToRgba: function (hex, alpha) {
    if (!hex) return 'rgba(0,0,0,' + alpha + ')';
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  },

  /**
   * Get color for a metric status (green/yellow/red/gray).
   *
   * @param {string} status - 'green', 'yellow', 'red', or null
   * @returns {string} hex color
   */
  statusColor: function (status) {
    if (status === 'green') return ChartTheme.status.success();
    if (status === 'yellow') return ChartTheme.status.warning();
    if (status === 'red') return ChartTheme.status.danger();
    return ChartTheme.status.neutral();
  },

  // ── Private ───────────────────────────────────────────────────

  _cv: function (name, fallback) {
    if (typeof document === 'undefined') return fallback;
    var root = getComputedStyle(document.documentElement);
    var val = root.getPropertyValue(name);
    return val && val.trim() ? val.trim() : fallback;
  },
};
