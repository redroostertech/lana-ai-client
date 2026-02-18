/* Lex UI — Chart Component
   Chart.js wrapper with optional endpoint binding and cross-filtering.
   Requires Chart.js to be loaded (existing vendor/chart.js).

   Usage (inline data):
     <lex-chart type="bar" chart-data='{"labels":["Jan","Feb"],"datasets":[{"data":[10,20]}]}'></lex-chart>

   Usage (endpoint):
     <lex-chart type="doughnut" endpoint="/api/v1/analytics/matters-by-status"></lex-chart>

   Usage (linked to table/list for cross-filtering):
     <lex-table id="my-table" endpoint="/api/v1/data" searchable filterable></lex-table>
     <lex-chart linked-to="#my-table" type="bar"></lex-chart>

   Types: bar | line | doughnut | pie | polarArea
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withDataSource } = window.Lex;

  class LexChart extends withDataSource(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        type:       { type: String, default: 'bar' },
        chartData:  { type: Object },
        height:     { type: String, default: '300px' },
        title:      { type: String },
        autoFetch:  { type: Boolean, default: true }
      };
    }

    connected() {
      super.connected();
      this._chart = null;
      this._linkedCleanup = null;

      // Cross-filtering: listen for filter changes from a linked component
      if (this.linkedTo) {
        this._setupLinkedFiltering();
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
    }

    _setupLinkedFiltering() {
      const target = document.querySelector(this.linkedTo);
      if (!target) return;

      const handler = (e) => {
        const { filters, searchQuery, sortBy, sortDir } = e.detail;

        if (this.dataSource) {
          // Apply the same filters/search from the linked component
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

    transformData(data) {
      // If the API returns chart-ready format, use it directly
      if (data && data.labels && data.datasets) return data;

      // Otherwise, try to convert array data to chart format
      if (Array.isArray(data) && data.length > 0) {
        const keys = Object.keys(data[0]);
        const labelKey = keys[0];
        const valueKey = keys[1] || keys[0];
        return {
          labels: data.map(d => d[labelKey]),
          datasets: [{
            label: valueKey.replace(/_/g, ' '),
            data: data.map(d => d[valueKey]),
            backgroundColor: this._defaultColors()
          }]
        };
      }

      return data;
    }

    _defaultColors() {
      return [
        'rgba(79, 70, 229, 0.8)',   // indigo
        'rgba(16, 185, 129, 0.8)',   // green
        'rgba(245, 158, 11, 0.8)',   // yellow
        'rgba(239, 68, 68, 0.8)',    // red
        'rgba(59, 130, 246, 0.8)',   // blue
        'rgba(139, 92, 246, 0.8)',   // purple
        'rgba(236, 72, 153, 0.8)',   // pink
        'rgba(20, 184, 166, 0.8)'    // teal
      ];
    }

    render() {
      if (this.dataSource?.loading) {
        return `<div class="flex items-center justify-center" style="height: ${this.height}"><lex-spinner label="Loading chart..."></lex-spinner></div>`;
      }

      if (this.dataSource?.error) {
        return `<div class="lex-text-danger text-sm p-4">${this.escapeHtml(this.dataSource.error)}</div>`;
      }

      return `
        <div>
          ${this.title ? `<h4 class="text-sm font-semibold lex-text-primary mb-3">${this.escapeHtml(this.title)}</h4>` : ''}
          <div style="height: ${this.height}; position: relative;">
            <canvas data-chart="canvas"></canvas>
          </div>
        </div>
      `;
    }

    updated() {
      const canvas = this.$('[data-chart="canvas"]');
      if (!canvas || typeof Chart === 'undefined') return;

      const data = this.chartData || this.dataSource?.data;
      if (!data || !data.labels) return;

      // Destroy existing chart before creating new one
      if (this._chart) {
        this._chart.destroy();
      }

      this._chart = new Chart(canvas, {
        type: this.type,
        data: data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: this.type !== 'bar' }
          }
        }
      });
    }
  }

  defineLex('lex-chart', LexChart);
})();
