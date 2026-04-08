/* Lex UI — Chart Component
   Chart.js wrapper with Lex design token theming, optional endpoint binding,
   cross-filtering, resize handling, and auto-cleanup.
   Requires Chart.js to be loaded (existing vendor/chart.js).

   Usage (inline data):
     <lex-chart type="bar" chart-data='{"labels":["Jan","Feb"],"datasets":[{"data":[10,20]}]}'></lex-chart>

   Usage (endpoint):
     <lex-chart type="doughnut" endpoint="/api/v1/analytics/matters-by-status"></lex-chart>

   Usage (linked to table/list for cross-filtering):
     <lex-table id="my-table" endpoint="/api/v1/data" searchable filterable></lex-table>
     <lex-chart linked-to="#my-table" type="bar"></lex-chart>

   Usage (ad-hoc analytics query):
     <lex-chart type="line" analytics-query='{"data_sources":["client_matters"],"metrics":["count.id"],"time_dimension":{"column":"created_at","granularity":"month"}}'></lex-chart>

   Types: bar | line | doughnut | pie | polarArea | radar | scatter | bubble
   Variants: default | compact | sparkline

   Theme: Reads from Lex CSS variables (--lex-chart-color-*).
   All colors derive from lex-tokens.css — change tokens to rebrand.
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withDataSource } = window.Lex;

  // ── Theme: read chart colors from CSS variables ─────────────────
  function _getThemeColors() {
    var root = getComputedStyle(document.documentElement);
    function cv(name, fallback) {
      var val = root.getPropertyValue(name);
      return val && val.trim() ? val.trim() : fallback;
    }
    return [
      cv('--lex-chart-color-1', '#595246'),
      cv('--lex-chart-color-2', '#17B26A'),
      cv('--lex-chart-color-3', '#528BFF'),
      cv('--lex-chart-color-4', '#F79009'),
      cv('--lex-chart-color-5', '#F04438'),
      cv('--lex-chart-color-6', '#9E9385'),
      cv('--lex-chart-color-7', '#7C3AED'),
      cv('--lex-chart-color-8', '#06B6D4'),
      cv('--lex-chart-color-9', '#D946EF'),
      cv('--lex-chart-color-10', '#84CC16'),
    ];
  }

  function _hexToRgba(hex, alpha) {
    if (!hex) return 'rgba(0,0,0,' + alpha + ')';
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function _getThemedGridColor() {
    var root = getComputedStyle(document.documentElement);
    var val = root.getPropertyValue('--lex-border-subtle');
    return val && val.trim() ? val.trim() : '#F5F3F0';
  }

  function _getThemedTextColor() {
    var root = getComputedStyle(document.documentElement);
    var val = root.getPropertyValue('--lex-text-tertiary');
    return val && val.trim() ? val.trim() : '#9E9385';
  }

  // ── Chart options builder ───────────────────────────────────────
  function _buildOptions(type, variant, customOptions) {
    var gridColor = _getThemedGridColor();
    var textColor = _getThemedTextColor();

    var base = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: type !== 'bar',
          labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, color: textColor }
        },
        tooltip: {
          cornerRadius: 8,
          padding: 10,
        },
      },
    };

    // Add scales for cartesian chart types
    var cartesian = ['bar', 'line', 'scatter', 'bubble'];
    if (cartesian.indexOf(type) !== -1) {
      base.scales = {
        x: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, maxRotation: 45, autoSkip: true },
        },
        y: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor },
          beginAtZero: true,
        },
      };
    }

    // Sparkline variant: minimal, no labels, no legend
    if (variant === 'sparkline') {
      base.plugins.legend = { display: false };
      base.plugins.tooltip = { enabled: false };
      if (base.scales) {
        base.scales.x = { display: false };
        base.scales.y = { display: false };
      }
      base.elements = { point: { radius: 0 }, line: { borderWidth: 2 } };
    }

    // Compact variant: smaller padding, smaller fonts
    if (variant === 'compact') {
      if (base.scales) {
        base.scales.x.ticks = Object.assign({}, base.scales.x.ticks, { font: { size: 10 } });
        base.scales.y.ticks = Object.assign({}, base.scales.y.ticks, { font: { size: 10 } });
      }
      base.plugins.legend.labels = Object.assign({}, base.plugins.legend.labels, { font: { size: 10 }, padding: 8 });
    }

    // Merge custom options (shallow — user options override base)
    if (customOptions && typeof customOptions === 'object') {
      for (var key in customOptions) {
        if (Object.prototype.hasOwnProperty.call(customOptions, key)) {
          base[key] = customOptions[key];
        }
      }
    }

    return base;
  }

  // ── Apply theme colors to datasets ──────────────────────────────
  function _applyThemeToDatasets(datasets, type) {
    if (!datasets || !Array.isArray(datasets)) return datasets;
    var colors = _getThemeColors();

    return datasets.map(function (ds, i) {
      var color = colors[i % colors.length];
      var themed = Object.assign({}, ds);

      // Only set colors if not already specified by the caller
      if (!themed.backgroundColor) {
        if (type === 'line') {
          themed.backgroundColor = _hexToRgba(color, 0.1);
        } else if (type === 'bar') {
          themed.backgroundColor = _hexToRgba(color, 0.8);
        } else {
          // Pie, doughnut, polarArea: need per-segment colors
          themed.backgroundColor = colors.map(function (c) { return _hexToRgba(c, 0.8); });
        }
      }
      if (!themed.borderColor) {
        if (type === 'line' || type === 'radar') {
          themed.borderColor = color;
          themed.borderWidth = themed.borderWidth || 2;
        } else if (type === 'bar') {
          themed.borderColor = color;
          themed.borderWidth = themed.borderWidth || 0;
          themed.borderRadius = themed.borderRadius || 4;
        }
      }
      if (type === 'line' && themed.fill === undefined) {
        themed.fill = true;
        themed.tension = themed.tension || 0.4;
      }

      return themed;
    });
  }

  // ── Component ───────────────────────────────────────────────────

  class LexChart extends withDataSource(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        type:           { type: String, default: 'bar' },
        chartData:      { type: Object },
        chartOptions:   { type: Object },
        height:         { type: String, default: '300px' },
        title:          { type: String },
        subtitle:       { type: String },
        variant:        { type: String, default: 'default' },  // default | compact | sparkline
        autoFetch:      { type: Boolean, default: true },
        analyticsQuery: { type: Object },  // Ad-hoc analytics query spec
        loading:        { type: Boolean, default: false, reflect: true },
      };
    }

    connected() {
      super.connected();
      this._chart = null;
      this._linkedCleanup = null;
      this._resizeObserver = null;

      // Cross-filtering
      if (this.linkedTo) {
        this._setupLinkedFiltering();
      }

      // Resize handling
      this._resizeObserver = new ResizeObserver(this._handleResize.bind(this));
      this._resizeObserver.observe(this);

      // Auto-fetch analytics query if provided
      if (this.analyticsQuery) {
        this._fetchAnalyticsData();
      }
    }

    disconnected() {
      super.disconnected();
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
      }
      if (this._linkedCleanup) {
        this._linkedCleanup();
        this._linkedCleanup = null;
      }
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
    }

    _handleResize() {
      if (this._chart) {
        this._chart.resize();
      }
    }

    _setupLinkedFiltering() {
      const target = document.querySelector(this.linkedTo);
      if (!target) return;

      const handler = (e) => {
        const { filters, searchQuery } = e.detail;

        if (this.dataSource) {
          if (filters && typeof filters === 'object') {
            const filterMap = filters instanceof Map ? filters : new Map(Object.entries(filters).map(([k, v]) => {
              return [k, typeof v === 'object' && v.operator ? v : { operator: 'eq', value: v }];
            }));
            this.dataSource.setFilters(filterMap);
          }
          if (searchQuery !== undefined) {
            this.dataSource.setSearch(searchQuery);
          }
        }
      };

      target.addEventListener('lex-filter-change', handler);
      this._linkedCleanup = () => target.removeEventListener('lex-filter-change', handler);
    }

    async _fetchAnalyticsData() {
      if (!this.analyticsQuery || typeof api === 'undefined') return;

      this.loading = true;
      try {
        var result = await api.post('/api/v1/analytics/query', this.analyticsQuery);
        if (result && result.data) {
          this.chartData = this.transformData(result.data);
        }
      } catch (err) {
        console.error('[lex-chart] Analytics query failed:', err);
      }
      this.loading = false;
    }

    transformData(data) {
      // Chart-ready format
      if (data && data.labels && data.datasets) return data;

      // Array of objects — auto-detect labels and values
      if (Array.isArray(data) && data.length > 0) {
        const keys = Object.keys(data[0]);
        // Skip row_count and time_bucket for auto-detection
        const skipKeys = new Set(['row_count', 'time_bucket', 'organization_id']);
        const labelKey = keys.find(function (k) { return !skipKeys.has(k) && typeof data[0][k] === 'string'; }) || keys[0];
        const valueKeys = keys.filter(function (k) { return !skipKeys.has(k) && k !== labelKey && typeof data[0][k] === 'number'; });

        if (valueKeys.length === 0) {
          // Fallback: use row_count as value
          if (data[0].row_count !== undefined) {
            valueKeys.push('row_count');
          }
        }

        // Use time_bucket as label if present
        var actualLabelKey = data[0].time_bucket !== undefined ? 'time_bucket' : labelKey;

        return {
          labels: data.map(function (d) {
            var val = d[actualLabelKey];
            // Format date strings
            if (typeof val === 'string' && val.indexOf('T') !== -1) {
              return new Date(val).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            }
            return val;
          }),
          datasets: valueKeys.map(function (vk, i) {
            return {
              label: vk.split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' '),
              data: data.map(function (d) { return d[vk]; }),
            };
          }),
        };
      }

      return data;
    }

    render() {
      if (this.loading || (this.dataSource && this.dataSource.loading)) {
        return '<div class="flex items-center justify-center" style="height: ' + this.height + '"><lex-spinner label="Loading chart..."></lex-spinner></div>';
      }

      if (this.dataSource && this.dataSource.error) {
        return '<div class="lex-text-danger text-sm p-4">' + this.escapeHtml(this.dataSource.error) + '</div>';
      }

      var html = '<div>';
      if (this.title && this.variant !== 'sparkline') {
        html += '<h4 class="text-sm font-semibold lex-text-primary mb-1">' + this.escapeHtml(this.title) + '</h4>';
      }
      if (this.subtitle && this.variant !== 'sparkline') {
        html += '<p class="text-xs lex-text-secondary mb-3">' + this.escapeHtml(this.subtitle) + '</p>';
      }
      html += '<div style="height: ' + this.height + '; position: relative;"><canvas data-chart="canvas"></canvas></div>';
      html += '</div>';
      return html;
    }

    updated() {
      const canvas = this.$('[data-chart="canvas"]');
      if (!canvas || typeof Chart === 'undefined') return;

      const data = this.chartData || (this.dataSource && this.dataSource.data);
      if (!data || !data.labels) return;

      // Destroy existing chart
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
      }

      // Apply Lex theme colors to datasets
      var themedData = Object.assign({}, data);
      themedData.datasets = _applyThemeToDatasets(data.datasets, this.type);

      // Build options with theme
      var options = _buildOptions(this.type, this.variant, this.chartOptions);

      this._chart = new Chart(canvas, {
        type: this.type,
        data: themedData,
        options: options,
      });

      // Emit render event
      this.dispatchEvent(new CustomEvent('lex-chart-rendered', {
        bubbles: true,
        detail: { type: this.type, dataPointCount: data.labels.length },
      }));
    }

    // ── Public API ──────────────────────────────────────────────

    /** Update chart data without full re-render */
    updateData(newData) {
      if (this._chart && newData) {
        var themed = Object.assign({}, newData);
        themed.datasets = _applyThemeToDatasets(newData.datasets, this.type);
        this._chart.data = themed;
        this._chart.update('none'); // No animation on update
      }
    }

    /** Force resize */
    resize() {
      if (this._chart) this._chart.resize();
    }

    /** Get base64 image of the chart */
    toImage() {
      if (this._chart) return this._chart.toBase64Image();
      return null;
    }

    /** Destroy the chart instance */
    destroyChart() {
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
      }
    }
  }

  // Expose theme helpers for external use
  LexChart._getThemeColors = _getThemeColors;
  LexChart._hexToRgba = _hexToRgba;

  defineLex('lex-chart', LexChart);
})();
