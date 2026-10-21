/**
 * Search Analytics Dashboard
 * Provides visualization and analysis of search query performance
 */

class SearchAnalytics {
  constructor() {
    this.dateRange = 7; // days
    this.customStartDate = null;
    this.customEndDate = null;
    this.charts = {};
    this.tables = {};
    this.data = {
      overview: null,
      topQueries: [],
      zeroResults: [],
      slowQueries: [],
      volumeData: null,
      latencyData: null
    };
  }

  async init() {
    this.setupEventListeners();
    await this.loadAllData();
  }

  setupEventListeners() {
    // Date range selector (lex-select)
    const range = document.getElementById('dateRange');
    range.addEventListener('lex-change', (e) => {
      const value = String((e.detail && e.detail.value) || '');
      if (value === 'custom') {
        this.showCustomDateModal();
      } else if (value) {
        this.dateRange = parseInt(value, 10);
        this.customStartDate = null;
        this.customEndDate = null;
        this.loadAllData();
      }
    });

    // Export button
    document.getElementById('exportBtn').addEventListener('click', () => {
      this.exportToCSV();
    });

    // Custom date modal (lex-modal: Apply = lex-confirm)
    const modal = document.getElementById('customDateModal');
    modal.addEventListener('lex-confirm', () => {
      const startDate = document.getElementById('customStartDate').value;
      const endDate = document.getElementById('customEndDate').value;

      if (!startDate || !endDate) {
        this.restoreRangeSelect();
        Lex.Toast.error('Please select both start and end dates');
        return;
      }

      this.customStartDate = startDate;
      this.customEndDate = endDate;
      this.loadAllData();
    });
    ['lex-cancel', 'lex-close'].forEach((name) => {
      modal.addEventListener(name, () => {
        if (!this.customStartDate) this.restoreRangeSelect();
      });
    });

    this.setupTables();
  }

  restoreRangeSelect() {
    const range = document.getElementById('dateRange');
    if (range) range.value = this.customStartDate ? 'custom' : this.dateRange.toString();
  }

  /**
   * The three record tables: client-side lex-tables over each endpoint's
   * list (docs/TABLE-STANDARD.md), with toolbar search and Sort by.
   */
  setupTables() {
    const T = window.SearchAnalyticsTables;
    const kit = window.AdminTableKit;
    const specs = [
      { key: 'topQueries', render: T.renderers.top(), noun: ['query', 'queries'] },
      { key: 'zeroResults', render: T.renderers.zero(), noun: ['query', 'queries'] },
      { key: 'slowQueries', render: T.renderers.slow(), noun: ['query', 'queries'] }
    ];
    kit.whenTableReady().then(() => {
      specs.forEach((spec) => {
        const table = document.getElementById(spec.key + 'Table');
        if (!table) return;
        table.setCellRenderers(spec.render);
        const count = window.AdminClientTables.bindCount(table, [spec.key + 'Count', spec.key + 'SectionCount'], spec.noun);
        kit.bindToolbar({
          table: table,
          searchId: spec.key + 'Search',
          sortId: spec.key + 'Sort',
          orderId: spec.key + 'SortOrder',
          noun: spec.noun,
          onSearch: (term) => {
            if (table.dataSource) table.dataSource.setSearch(term);
            count.update();
          }
        });
        this.tables[spec.key] = { table: table, count: count };
      });
      if (this.data.overview) this.renderTables();
    });
  }

  showCustomDateModal() {
    document.getElementById('customDateModal').open = true;
  }

  async loadAllData() {
    try {
      document.getElementById('loadingState').classList.remove('hidden');
      document.getElementById('contentContainer').classList.add('hidden');

      // Load all data in parallel
      await Promise.all([
        this.loadOverview(),
        this.loadTopQueries(),
        this.loadZeroResults(),
        this.loadSlowQueries(),
        this.loadVolumeData(),
        this.loadLatencyData()
      ]);

      // Render all visualizations
      this.renderOverview();
      this.renderTables();
      this.renderVolumeChart();
      this.renderLatencyChart();

      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('contentContainer').classList.remove('hidden');
    } catch (error) {
      console.error('Failed to load analytics data:', error);
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('contentContainer').classList.remove('hidden');
      Object.keys(this.tables).forEach((key) => {
        this.tables[key].table.setError('Search analytics could not be loaded. Check your connection and try again.');
      });
      Lex.Modal.alert('Search analytics', 'Failed to load analytics data. Please try again.');
    }
  }

  async loadOverview() {
    const params = new URLSearchParams();
    if (this.customStartDate && this.customEndDate) {
      params.append('startDate', this.customStartDate);
      params.append('endDate', this.customEndDate);
    } else {
      params.append('days', this.dateRange);
    }

    this.data.overview = await api.get(`/api/analytics/search/overview?${params}`);
  }

  async loadTopQueries() {
    const params = window.SearchAnalyticsTables.periodParams(this.dateRange, this.customStartDate, this.customEndDate);
    this.data.topQueries = await api.get(`/api/analytics/search/top-queries?${params}`);
  }


  async loadZeroResults() {
    const params = window.SearchAnalyticsTables.periodParams(this.dateRange, this.customStartDate, this.customEndDate);
    this.data.zeroResults = await api.get(`/api/analytics/search/zero-results?${params}`);
  }


  async loadSlowQueries() {
    const params = window.SearchAnalyticsTables.periodParams(this.dateRange, this.customStartDate, this.customEndDate);
    params.set('threshold', String(window.SearchAnalyticsTables.SLOW_THRESHOLD_MS));
    this.data.slowQueries = await api.get(`/api/analytics/search/slow-queries?${params}`);
  }


  async loadVolumeData() {
    const params = new URLSearchParams();
    params.append('granularity', this.dateRange <= 1 ? 'hour' : 'day');
    if (this.customStartDate && this.customEndDate) {
      params.append('startDate', this.customStartDate);
      params.append('endDate', this.customEndDate);
    } else {
      params.append('days', this.dateRange);
    }

    this.data.volumeData = await api.get(`/api/analytics/search/volume?${params}`);
  }

  async loadLatencyData() {
    const params = new URLSearchParams();
    if (this.customStartDate && this.customEndDate) {
      params.append('startDate', this.customStartDate);
      params.append('endDate', this.customEndDate);
    } else {
      params.append('days', this.dateRange);
    }

    this.data.latencyData = await api.get(`/api/analytics/search/latency-distribution?${params}`);
  }

  renderOverview() {
    const metrics = this.data.overview.metrics || this.data.overview;

    document.getElementById('totalQueries').textContent = metrics.total_queries.toLocaleString();
    document.getElementById('avgLatency').textContent = `${metrics.latency.p50_ms}ms`;
    document.getElementById('p95Latency').textContent = `${metrics.latency.p95_ms}ms`;
    document.getElementById('p99Latency').textContent = `${metrics.latency.p99_ms}ms`;
    document.getElementById('zeroResultRate').textContent = `${metrics.zero_result_rate_percent.toFixed(1)}%`;
    document.getElementById('clickThroughRate').textContent = `${metrics.ctr_percent.toFixed(1)}%`;
  }

  /**
   * Hand each table its rows (raw values; renderers format them) and the
   * header filters built from those rows.
   */
  renderTables() {
    const T = window.SearchAnalyticsTables;
    const lists = {
      topQueries: (this.data.topQueries && this.data.topQueries.top_queries) || [],
      zeroResults: (this.data.zeroResults && this.data.zeroResults.zero_result_queries) || [],
      slowQueries: (this.data.slowQueries && this.data.slowQueries.slow_queries) || []
    };
    const mappers = { topQueries: T.mapTopQuery, zeroResults: T.mapZeroResult, slowQueries: T.mapSlowQuery };
    const filters = { topQueries: T.filters.top, zeroResults: T.filters.zero, slowQueries: T.filters.slow };
    Object.keys(lists).forEach((key) => {
      const entry = this.tables[key];
      if (!entry) return;
      const rows = lists[key].map(mappers[key]);
      entry.table.setColumnFilterOptions(filters[key](rows));
      entry.table.setData(rows);
      entry.count.update();
      const note = document.getElementById(key + 'CapNote');
      if (note) note.textContent = T.capNote(rows.length);
    });
  }

  renderVolumeChart() {
    const ctx = document.getElementById('queryVolumeChart').getContext('2d');

    // Destroy existing chart if it exists
    if (this.charts.volume) {
      this.charts.volume.destroy();
    }

    const timeSeries = this.data.volumeData.time_series || this.data.volumeData;

    const labels = timeSeries.map(item => {
      const date = new Date(item.time_bucket);
      if (this.dateRange <= 1) {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: Lex.Utils.getOrganizationTimezone() });
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: Lex.Utils.getOrganizationTimezone() });
      }
    });

    const data = timeSeries.map(item => item.query_count);

    this.charts.volume = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Queries',
          data: data,
          borderColor: 'rgb(99, 102, 241)',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0
            }
          }
        }
      }
    });
  }

  renderLatencyChart() {
    const ctx = document.getElementById('latencyDistributionChart').getContext('2d');

    // Destroy existing chart if it exists
    if (this.charts.latency) {
      this.charts.latency.destroy();
    }

    // Backend returns distribution buckets, so we need to extract percentiles from overview
    const latency = this.data.overview.metrics?.latency || {};

    this.charts.latency = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['P50', 'P75', 'P90', 'P95', 'P99'],
        datasets: [{
          label: 'Latency (ms)',
          data: [
            latency.p50_ms || 0,
            latency.p75_ms || 0,
            latency.p90_ms || 0,
            latency.p95_ms || 0,
            latency.p99_ms || 0
          ],
          backgroundColor: [
            'rgba(34, 197, 94, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(249, 115, 22, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(220, 38, 38, 0.8)'
          ],
          borderColor: [
            'rgb(34, 197, 94)',
            'rgb(59, 130, 246)',
            'rgb(249, 115, 22)',
            'rgb(239, 68, 68)',
            'rgb(220, 38, 38)'
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Milliseconds'
            }
          }
        }
      }
    });
  }

  exportToCSV() {
    const csvData = [];

    // Header
    csvData.push(['Query Text', 'Frequency', 'Avg Latency (ms)', 'Zero-Result Rate (%)', 'CTR (%)']);

    // Data
    const queries = (this.data.topQueries && this.data.topQueries.top_queries) || [];
    queries.forEach(query => {
      csvData.push([
        query.query_text,
        query.frequency,
        query.avg_latency_ms,
        query.zero_result_rate_percent.toFixed(1),
        query.ctr_percent.toFixed(1)
      ]);
    });

    const csv = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `search-analytics-${LanaTime.formatUtcDateOnly()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const analytics = new SearchAnalytics();
  analytics.init();
});
