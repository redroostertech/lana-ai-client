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
    this.currentSort = { column: 'frequency', direction: 'desc' };
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
    // Date range selector
    document.getElementById('dateRange').addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        this.showCustomDateModal();
      } else {
        this.dateRange = parseInt(e.target.value);
        this.customStartDate = null;
        this.customEndDate = null;
        this.loadAllData();
      }
    });

    // Export button
    document.getElementById('exportBtn').addEventListener('click', () => {
      this.exportToCSV();
    });

    // Custom date modal
    document.getElementById('cancelCustomDate').addEventListener('click', () => {
      this.hideCustomDateModal();
      document.getElementById('dateRange').value = this.dateRange.toString();
    });

    document.getElementById('applyCustomDate').addEventListener('click', () => {
      const startDate = document.getElementById('customStartDate').value;
      const endDate = document.getElementById('customEndDate').value;

      if (!startDate || !endDate) {
        alert('Please select both start and end dates');
        return;
      }

      this.customStartDate = startDate;
      this.customEndDate = endDate;
      this.hideCustomDateModal();
      this.loadAllData();
    });

    // Table sorting
    document.querySelectorAll('[data-sort]').forEach(header => {
      header.addEventListener('click', () => {
        const column = header.getAttribute('data-sort');
        this.sortTable(column);
      });
    });
  }

  showCustomDateModal() {
    document.getElementById('customDateModal').classList.remove('hidden');
  }

  hideCustomDateModal() {
    document.getElementById('customDateModal').classList.add('hidden');
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
      this.renderTopQueries();
      this.renderZeroResults();
      this.renderSlowQueries();
      this.renderVolumeChart();
      this.renderLatencyChart();

      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('contentContainer').classList.remove('hidden');
    } catch (error) {
      console.error('Failed to load analytics data:', error);
      alert('Failed to load analytics data. Please try again.');
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

    const response = await fetch(`/api/analytics/search/overview?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load overview data');
    }

    this.data.overview = await response.json();
  }

  async loadTopQueries() {
    const params = new URLSearchParams();
    params.append('limit', '50');
    if (this.customStartDate && this.customEndDate) {
      params.append('startDate', this.customStartDate);
      params.append('endDate', this.customEndDate);
    } else {
      params.append('days', this.dateRange);
    }

    const response = await fetch(`/api/analytics/search/top-queries?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load top queries');
    }

    this.data.topQueries = await response.json();
  }

  async loadZeroResults() {
    const params = new URLSearchParams();
    params.append('limit', '50');
    if (this.customStartDate && this.customEndDate) {
      params.append('startDate', this.customStartDate);
      params.append('endDate', this.customEndDate);
    } else {
      params.append('days', this.dateRange);
    }

    const response = await fetch(`/api/analytics/search/zero-results?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load zero-result queries');
    }

    this.data.zeroResults = await response.json();
  }

  async loadSlowQueries() {
    const params = new URLSearchParams();
    params.append('threshold', '100');
    params.append('limit', '50');
    if (this.customStartDate && this.customEndDate) {
      params.append('startDate', this.customStartDate);
      params.append('endDate', this.customEndDate);
    } else {
      params.append('days', this.dateRange);
    }

    const response = await fetch(`/api/analytics/search/slow-queries?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load slow queries');
    }

    this.data.slowQueries = await response.json();
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

    const response = await fetch(`/api/analytics/search/volume?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load volume data');
    }

    this.data.volumeData = await response.json();
  }

  async loadLatencyData() {
    const params = new URLSearchParams();
    if (this.customStartDate && this.customEndDate) {
      params.append('startDate', this.customStartDate);
      params.append('endDate', this.customEndDate);
    } else {
      params.append('days', this.dateRange);
    }

    const response = await fetch(`/api/analytics/search/latency-distribution?${params}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load latency data');
    }

    this.data.latencyData = await response.json();
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

  renderTopQueries() {
    const tbody = document.getElementById('topQueriesTable');
    tbody.innerHTML = '';

    const queries = this.data.topQueries.top_queries || this.data.topQueries;

    if (!queries || queries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-gray-500">No data available</td></tr>';
      return;
    }

    queries.forEach(query => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50 cursor-pointer';
      row.innerHTML = `
        <td class="px-6 py-4 text-sm text-gray-900">${this.escapeHtml(query.query_text)}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${query.frequency.toLocaleString()}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${query.avg_latency_ms}ms</td>
        <td class="px-6 py-4 text-sm text-gray-900">${query.zero_result_rate_percent.toFixed(1)}%</td>
        <td class="px-6 py-4 text-sm text-gray-900">${query.ctr_percent.toFixed(1)}%</td>
      `;
      tbody.appendChild(row);
    });
  }

  renderZeroResults() {
    const tbody = document.getElementById('zeroResultsTable');
    tbody.innerHTML = '';

    const queries = this.data.zeroResults.zero_result_queries || this.data.zeroResults;

    if (!queries || queries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">No zero-result queries</td></tr>';
      return;
    }

    queries.forEach(query => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50 bg-red-50';
      row.innerHTML = `
        <td class="px-6 py-4 text-sm text-gray-900">${this.escapeHtml(query.query_text)}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${this.formatTimestamp(query.created_at)}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${this.escapeHtml(query.user_email || 'Unknown')}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${this.escapeHtml(query.matter_name || 'N/A')}</td>
      `;
      tbody.appendChild(row);
    });
  }

  renderSlowQueries() {
    const tbody = document.getElementById('slowQueriesTable');
    tbody.innerHTML = '';

    const queries = this.data.slowQueries.slow_queries || this.data.slowQueries;

    if (!queries || queries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-500">No slow queries</td></tr>';
      return;
    }

    queries.forEach(query => {
      const row = document.createElement('tr');
      const isVerySlow = query.latency_ms > 500;
      row.className = `hover:bg-gray-50 ${isVerySlow ? 'bg-red-50' : ''}`;
      row.innerHTML = `
        <td class="px-6 py-4 text-sm text-gray-900">${this.escapeHtml(query.query_text)}</td>
        <td class="px-6 py-4 text-sm ${isVerySlow ? 'text-red-600 font-semibold' : 'text-gray-900'}">${Math.round(query.latency_ms)}ms</td>
        <td class="px-6 py-4 text-sm text-gray-900">${this.formatTimestamp(query.created_at)}</td>
        <td class="px-6 py-4 text-sm text-gray-900">${this.escapeHtml(query.user_email || 'Unknown')}</td>
      `;
      tbody.appendChild(row);
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

  sortTable(column) {
    if (this.currentSort.column === column) {
      this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort.column = column;
      this.currentSort.direction = 'desc';
    }

    const queries = this.data.topQueries.top_queries || this.data.topQueries;

    queries.sort((a, b) => {
      let aVal, bVal;

      switch (column) {
        case 'query':
          aVal = a.query_text.toLowerCase();
          bVal = b.query_text.toLowerCase();
          break;
        case 'frequency':
          aVal = a.frequency;
          bVal = b.frequency;
          break;
        case 'latency':
          aVal = a.avg_latency_ms;
          bVal = b.avg_latency_ms;
          break;
        case 'zero':
          aVal = a.zero_result_rate_percent;
          bVal = b.zero_result_rate_percent;
          break;
        case 'ctr':
          aVal = a.ctr_percent;
          bVal = b.ctr_percent;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return this.currentSort.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return this.currentSort.direction === 'asc' ? 1 : -1;
      return 0;
    });

    this.renderTopQueries();
  }

  exportToCSV() {
    const csvData = [];

    // Header
    csvData.push(['Query Text', 'Frequency', 'Avg Latency (ms)', 'Zero-Result Rate (%)', 'CTR (%)']);

    // Data
    const queries = this.data.topQueries.top_queries || this.data.topQueries;
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

  formatTimestamp(timestamp) {
    return formatDateTime(timestamp);
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
