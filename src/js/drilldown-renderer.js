/**
 * Generic Drilldown Renderer Component
 * Renders metric drilldown data in a modal with table, pagination, and summary
 *
 * @module DrilldownRenderer
 * @description Data-driven component that fetches and renders drilldown data based on metric configuration
 */

class DrilldownRenderer {
  constructor() {
    this.modal = null;
    this.currentConfig = null;
    this.currentData = null;
    this.currentPage = 1;
    this.pageSize = 25;
    this.sortBy = null;
    this.sortDirection = 'asc';
    this.filters = {};
    this.searchQuery = '';
    this.initialized = false;

    // Don't call init() here - defer until first use
  }

  /**
   * Initialize the drilldown modal and event listeners (lazy initialization)
   */
  init() {
    if (this.initialized) return;

    // Create modal container if it doesn't exist
    if (!document.getElementById('drilldown-modal')) {
      this.createModalStructure();
    }

    this.modal = document.getElementById('drilldown-modal');
    this.attachEventListeners();
    this.initialized = true;
  }

  /**
   * Create the modal HTML structure
   */
  createModalStructure() {
    const modalHTML = `
      <div id="drilldown-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
        <!-- Background overlay -->
        <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" id="drilldown-backdrop"></div>

        <!-- Modal panel -->
        <div class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          <div class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-7xl">
            <!-- Header -->
            <div class="bg-white px-4 py-5 sm:px-6 border-b border-gray-200">
              <div class="flex items-center justify-between">
                <div class="flex-1">
                  <h3 class="text-lg font-semibold leading-6 text-gray-900" id="drilldown-title">
                    Loading...
                  </h3>
                  <p class="mt-1 text-sm text-gray-500" id="drilldown-description">
                    <!-- Description -->
                  </p>
                </div>
                <div class="flex items-center space-x-2">
                  <button type="button" class="rounded-md bg-white text-gray-400 hover:text-blue-600 focus:outline-none" id="drilldown-help" title="Help & Documentation">
                    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                    </svg>
                  </button>
                  <button type="button" class="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none" id="drilldown-close">
                    <span class="sr-only">Close</span>
                    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- How We Match Data (if configured) -->
              <div id="drilldown-how-we-match" class="hidden mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 class="text-sm font-semibold text-blue-900 mb-2" id="drilldown-match-title">How We Match This Data</h4>
                <p class="text-sm text-blue-800 mb-2" id="drilldown-match-method"></p>
                <div id="drilldown-match-content"></div>
              </div>

              <!-- Insights/Alerts (if any) -->
              <div id="drilldown-insights" class="hidden mt-4 space-y-2">
                <!-- Insights will be rendered here -->
              </div>

              <!-- Search, filters, and controls -->
              <div class="mt-4 flex flex-wrap items-center gap-4">
                <div class="flex-1 min-w-[200px]">
                  <label for="drilldown-search" class="sr-only">Search</label>
                  <input type="text" id="drilldown-search" placeholder="Search..."
                    class="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                </div>

                <!-- Sort dropdown -->
                <div id="drilldown-sort-container" class="hidden">
                  <label for="drilldown-sort-select" class="sr-only">Sort by</label>
                  <select id="drilldown-sort-select" class="block rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm">
                    <!-- Sort options will be rendered here -->
                  </select>
                </div>

                <!-- Filter toggles -->
                <div id="drilldown-filter-container" class="hidden flex items-center space-x-2">
                  <!-- Filter buttons will be rendered here -->
                </div>

                <!-- Export buttons -->
                <div id="drilldown-export-container" class="hidden flex items-center space-x-2">
                  <button type="button" id="drilldown-export-csv" class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    <svg class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    CSV
                  </button>
                  <button type="button" id="drilldown-export-excel" class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    <svg class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Excel
                  </button>
                </div>

                <button type="button" id="drilldown-refresh" class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                  <svg class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </button>
              </div>
            </div>

            <!-- Summary (if enabled) -->
            <div id="drilldown-summary-container" class="hidden bg-gray-50 px-4 py-3 sm:px-6">
              <div id="drilldown-summary" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                <!-- Summary fields will be rendered here -->
              </div>
            </div>

            <!-- Table container -->
            <div class="bg-white px-4 sm:px-6">
              <div class="mt-4 flex flex-col">
                <div class="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
                  <div class="inline-block min-w-full py-2 align-middle">
                    <div class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                      <!-- Loading state -->
                      <div id="drilldown-loading" class="flex items-center justify-center py-12">
                        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                      </div>

                      <!-- Table -->
                      <table id="drilldown-table" class="min-w-full divide-y divide-gray-300 hidden">
                        <thead class="bg-gray-50">
                          <tr id="drilldown-table-header">
                            <!-- Column headers will be rendered here -->
                          </tr>
                        </thead>
                        <tbody id="drilldown-table-body" class="divide-y divide-gray-200 bg-white">
                          <!-- Rows will be rendered here -->
                        </tbody>
                      </table>

                      <!-- Empty state -->
                      <div id="drilldown-empty" class="hidden text-center py-12">
                        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                        <h3 class="mt-2 text-sm font-medium text-gray-900">No data found</h3>
                        <p class="mt-1 text-sm text-gray-500">Try adjusting your filters or search query.</p>
                      </div>

                      <!-- Error state -->
                      <div id="drilldown-error" class="hidden text-center py-12">
                        <svg class="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <h3 class="mt-2 text-sm font-medium text-gray-900">Error loading data</h3>
                        <p class="mt-1 text-sm text-gray-500" id="drilldown-error-message">An error occurred while fetching drilldown data.</p>
                        <button type="button" id="drilldown-retry" class="mt-4 inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
                          Retry
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pagination -->
            <div class="bg-white px-4 py-3 sm:px-6 border-t border-gray-200">
              <div class="flex items-center justify-between">
                <div class="flex-1 flex justify-between sm:hidden">
                  <button type="button" id="drilldown-prev-mobile" class="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    Previous
                  </button>
                  <button type="button" id="drilldown-next-mobile" class="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                    Next
                  </button>
                </div>
                <div class="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <p class="text-sm text-gray-700" id="drilldown-pagination-info">
                      <!-- Pagination info -->
                    </p>
                  </div>
                  <div>
                    <nav class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" id="drilldown-pagination">
                      <!-- Page numbers will be rendered here -->
                    </nav>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Help Modal -->
      <div id="drilldown-help-modal" class="fixed inset-0 z-50 hidden overflow-y-auto" aria-labelledby="help-modal-title" role="dialog" aria-modal="true">
        <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" id="drilldown-help-backdrop"></div>
        <div class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          <div class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl">
            <div class="bg-white px-4 py-5 sm:px-6 border-b border-gray-200">
              <div class="flex items-center justify-between">
                <h3 class="text-lg font-semibold leading-6 text-gray-900" id="help-modal-title">Help & Documentation</h3>
                <button type="button" class="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none" id="drilldown-help-close">
                  <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="bg-white px-4 py-5 sm:px-6 max-h-[70vh] overflow-y-auto">
              <div id="drilldown-help-content">
                <!-- Help content will be rendered here -->
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  /**
   * Attach event listeners to modal elements
   */
  attachEventListeners() {
    // Close button
    document.getElementById('drilldown-close')?.addEventListener('click', () => this.close());
    document.getElementById('drilldown-backdrop')?.addEventListener('click', () => this.close());

    // Help button
    document.getElementById('drilldown-help')?.addEventListener('click', () => this.showHelp());
    document.getElementById('drilldown-help-close')?.addEventListener('click', () => this.closeHelp());
    document.getElementById('drilldown-help-backdrop')?.addEventListener('click', () => this.closeHelp());

    // Search
    const searchInput = document.getElementById('drilldown-search');
    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.searchQuery = e.target.value;
        this.currentPage = 1;
        this.fetchData();
      }, 300);
    });

    // Sort dropdown
    document.getElementById('drilldown-sort-select')?.addEventListener('change', (e) => {
      const value = e.target.value;
      if (value) {
        const [field, direction] = value.split('|');
        this.sortBy = field;
        this.sortDirection = direction || 'asc';
        this.currentPage = 1;
        this.fetchData();
      }
    });

    // Export buttons
    document.getElementById('drilldown-export-csv')?.addEventListener('click', () => this.exportData('csv'));
    document.getElementById('drilldown-export-excel')?.addEventListener('click', () => this.exportData('excel'));

    // Refresh button
    document.getElementById('drilldown-refresh')?.addEventListener('click', () => this.fetchData());

    // Retry button
    document.getElementById('drilldown-retry')?.addEventListener('click', () => this.fetchData());

    // Mobile pagination
    document.getElementById('drilldown-prev-mobile')?.addEventListener('click', () => this.prevPage());
    document.getElementById('drilldown-next-mobile')?.addEventListener('click', () => this.nextPage());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const helpModal = document.getElementById('drilldown-help-modal');

      if (e.key === 'Escape') {
        if (helpModal && !helpModal.classList.contains('hidden')) {
          this.closeHelp();
        } else if (!this.modal.classList.contains('hidden')) {
          this.close();
        }
      }
    });
  }

  /**
   * Open drilldown modal for a specific metric
   * @param {string} moduleKey - Module identifier
   * @param {string} metricKey - Metric identifier
   * @param {string} periodStart - Start date (ISO 8601)
   * @param {string} periodEnd - End date (ISO 8601)
   */
  async open(moduleKey, metricKey, periodStart, periodEnd) {
    // Initialize if not already done (lazy initialization)
    this.init();

    // Show modal
    this.modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');

    // Reset state
    this.currentPage = 1;
    this.sortBy = null;
    this.sortDirection = 'asc';
    this.filters = {};
    this.searchQuery = '';

    // Show loading state
    this.showLoading();

    try {
      // Fetch drilldown configuration
      const config = await this.fetchDrilldownConfig(moduleKey, metricKey);
      this.currentConfig = {
        moduleKey,
        metricKey,
        periodStart,
        periodEnd,
        ...config.drilldown
      };

      // Update modal header
      document.getElementById('drilldown-title').textContent = config.drilldown.title || 'Drilldown Data';
      document.getElementById('drilldown-description').textContent = config.drilldown.description || '';

      // Set default sort if configured
      if (config.drilldown.defaultSort) {
        this.sortBy = config.drilldown.defaultSort.field;
        this.sortDirection = config.drilldown.defaultSort.direction || 'asc';
      }

      // Fetch and render data
      await this.fetchData();
    } catch (error) {
      console.error('[DrilldownRenderer] Error opening drilldown:', error);
      this.showError(error.message || 'Failed to load drilldown configuration');
    }
  }

  /**
   * Close the drilldown modal
   */
  close() {
    this.modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    this.currentConfig = null;
    this.currentData = null;
  }

  /**
   * Fetch drilldown configuration from API
   */
  async fetchDrilldownConfig(moduleKey, metricKey) {
    const response = await fetch(`/api/v1/modules/${moduleKey}/metrics/${metricKey}/drilldown`, {
      headers: {
        'Authorization': `Bearer ${this.getAuthToken()}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch drilldown config: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Fetch drilldown data from API
   */
  async fetchData() {
    if (!this.currentConfig) return;

    this.showLoading();

    try {
      const response = await fetch(
        `/api/v1/modules/${this.currentConfig.moduleKey}/metrics/${this.currentConfig.metricKey}/drilldown/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.getAuthToken()}`
          },
          body: JSON.stringify({
            periodStart: this.currentConfig.periodStart,
            periodEnd: this.currentConfig.periodEnd,
            page: this.currentPage,
            pageSize: this.pageSize,
            sortBy: this.sortBy,
            sortDirection: this.sortDirection,
            filters: this.filters,
            search: this.searchQuery
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch drilldown data: ${response.statusText}`);
      }

      const result = await response.json();
      this.currentData = result.data;

      // Render the data
      this.render();
    } catch (error) {
      console.error('[DrilldownRenderer] Error fetching drilldown data:', error);
      this.showError(error.message || 'Failed to load drilldown data');
    }
  }

  /**
   * Render the drilldown data
   */
  render() {
    if (!this.currentData || !this.currentConfig) return;

    // Hide loading state
    document.getElementById('drilldown-loading').classList.add('hidden');
    document.getElementById('drilldown-error').classList.add('hidden');

    // Render advanced features
    this.renderHowWeMatch();
    this.renderSortOptions();
    this.renderExportButtons();

    // Check if we have data
    if (this.currentData.rows.length === 0) {
      document.getElementById('drilldown-table').classList.add('hidden');
      document.getElementById('drilldown-empty').classList.remove('hidden');
      return;
    }

    // Show table
    document.getElementById('drilldown-empty').classList.add('hidden');
    document.getElementById('drilldown-table').classList.remove('hidden');

    // Render summary (if enabled)
    if (this.currentConfig.summary?.enabled && this.currentData.summary) {
      this.renderSummary();
    }

    // Render table
    this.renderTable();

    // Render pagination
    this.renderPagination();
  }

  /**
   * Render summary statistics
   */
  renderSummary() {
    const container = document.getElementById('drilldown-summary-container');
    const summaryEl = document.getElementById('drilldown-summary');

    if (!this.currentData.summary || !this.currentConfig.summary?.fields) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    const summaryHTML = this.currentConfig.summary.fields.map(field => {
      const value = this.currentData.summary[field.field];
      const formattedValue = this.formatValue(value, field.format);
      const highlightClass = field.highlight ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200';

      return `
        <div class="border ${highlightClass} rounded-lg px-3 py-2">
          <dt class="text-xs font-medium text-gray-500 truncate">${field.label}</dt>
          <dd class="mt-1 text-lg font-semibold text-gray-900">${formattedValue}</dd>
        </div>
      `;
    }).join('');

    summaryEl.innerHTML = summaryHTML;
  }

  /**
   * Render the data table
   */
  renderTable() {
    // Render header
    const headerHTML = this.currentConfig.columns.map(col => {
      const sortable = col.sortable !== false;
      const isSorted = this.sortBy === col.field;
      const sortIcon = isSorted
        ? (this.sortDirection === 'asc' ? '↑' : '↓')
        : '';
      const tooltip = col.description ? `title="${this.escapeHtml(col.description)}"` : '';

      return `
        <th scope="col" class="px-3 py-3.5 text-${col.align || 'left'} text-xs font-semibold text-gray-900 ${sortable ? 'cursor-pointer hover:bg-gray-100' : ''}"
            ${sortable ? `data-sort="${col.field}"` : ''} ${tooltip}>
          <div class="flex items-center ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}">
            ${col.header}
            ${col.description ? `<svg class="ml-1 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>` : ''}
            ${sortable ? `<span class="ml-1 text-gray-400">${sortIcon}</span>` : ''}
          </div>
        </th>
      `;
    }).join('');

    document.getElementById('drilldown-table-header').innerHTML = headerHTML;

    // Attach sort handlers
    document.querySelectorAll('[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (this.sortBy === field) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortBy = field;
          this.sortDirection = 'asc';
        }
        this.fetchData();
      });
    });

    // Render rows
    const rowsHTML = this.currentData.rows.map(row => {
      const cellsHTML = this.currentConfig.columns.map(col => {
        const value = row[col.field];
        // Use badge renderer for badge columns, otherwise use standard formatter
        const formattedValue = col.type === 'badge' ? this.renderBadgeColumn(value, col) : this.formatValue(value, col.format || {type: col.type});
        return `
          <td class="whitespace-nowrap px-3 py-4 text-sm text-gray-900 text-${col.align || 'left'}">
            ${formattedValue}
          </td>
        `;
      }).join('');

      return `<tr class="hover:bg-gray-50">${cellsHTML}</tr>`;
    }).join('');

    document.getElementById('drilldown-table-body').innerHTML = rowsHTML;
  }

  /**
   * Render pagination controls
   */
  renderPagination() {
    const { page, totalRecords, totalPages, hasNextPage, hasPreviousPage } = this.currentData.pagination;

    // Update pagination info
    const start = (page - 1) * this.pageSize + 1;
    const end = Math.min(page * this.pageSize, totalRecords);
    document.getElementById('drilldown-pagination-info').textContent =
      `Showing ${start} to ${end} of ${totalRecords} results`;

    // Generate page numbers
    const pages = this.generatePageNumbers(page, totalPages);
    const paginationHTML = `
      <button type="button" ${!hasPreviousPage ? 'disabled' : ''}
              class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 ${!hasPreviousPage ? 'cursor-not-allowed opacity-50' : ''}"
              onclick="window.drilldownRenderer.prevPage()">
        <span class="sr-only">Previous</span>
        <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
        </svg>
      </button>
      ${pages.map(p => {
        if (p === '...') {
          return `<span class="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">...</span>`;
        }
        const isActive = p === page;
        return `
          <button type="button"
                  class="relative inline-flex items-center px-4 py-2 border ${isActive ? 'z-10 bg-blue-50 border-blue-500 text-blue-600' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'} text-sm font-medium"
                  onclick="window.drilldownRenderer.goToPage(${p})">
            ${p}
          </button>
        `;
      }).join('')}
      <button type="button" ${!hasNextPage ? 'disabled' : ''}
              class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 ${!hasNextPage ? 'cursor-not-allowed opacity-50' : ''}"
              onclick="window.drilldownRenderer.nextPage()">
        <span class="sr-only">Next</span>
        <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
        </svg>
      </button>
    `;

    document.getElementById('drilldown-pagination').innerHTML = paginationHTML;

    // Update mobile buttons
    const prevMobile = document.getElementById('drilldown-prev-mobile');
    const nextMobile = document.getElementById('drilldown-next-mobile');
    if (prevMobile) prevMobile.disabled = !hasPreviousPage;
    if (nextMobile) nextMobile.disabled = !hasNextPage;
  }

  /**
   * Generate page number array for pagination
   */
  generatePageNumbers(currentPage, totalPages) {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];
    let l;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
        range.push(i);
      }
    }

    for (let i of range) {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    return rangeWithDots;
  }

  /**
   * Format a value according to format specification
   */
  formatValue(value, format) {
    if (value === null || value === undefined || value === '') {
      return '<span class="text-gray-400">—</span>';
    }

    if (!format) {
      return this.escapeHtml(String(value));
    }

    switch (format.type) {
      case 'currency':
        const prefix = format.prefix || '$';
        const decimals = format.decimals !== undefined ? format.decimals : 2;
        return `${prefix}${parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

      case 'number':
        const numDecimals = format.decimals !== undefined ? format.decimals : 0;
        const suffix = format.suffix || '';
        return `${parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: numDecimals, maximumFractionDigits: numDecimals })}${suffix}`;

      case 'percent':
        return `${parseFloat(value).toFixed(format.decimals || 1)}%`;

      case 'date':
        return new Date(value).toLocaleDateString('en-US', format.dateFormat || {});

      case 'datetime':
        return new Date(value).toLocaleString('en-US', format.dateFormat || {});

      default:
        return this.escapeHtml(String(value));
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Show loading state
   */
  showLoading() {
    document.getElementById('drilldown-loading').classList.remove('hidden');
    document.getElementById('drilldown-table').classList.add('hidden');
    document.getElementById('drilldown-empty').classList.add('hidden');
    document.getElementById('drilldown-error').classList.add('hidden');
  }

  /**
   * Show error state
   */
  showError(message) {
    document.getElementById('drilldown-loading').classList.add('hidden');
    document.getElementById('drilldown-table').classList.add('hidden');
    document.getElementById('drilldown-empty').classList.add('hidden');
    document.getElementById('drilldown-error').classList.remove('hidden');
    document.getElementById('drilldown-error-message').textContent = message;
  }

  /**
   * Pagination methods
   */
  prevPage() {
    if (this.currentData?.pagination.hasPreviousPage) {
      this.currentPage--;
      this.fetchData();
    }
  }

  nextPage() {
    if (this.currentData?.pagination.hasNextPage) {
      this.currentPage++;
      this.fetchData();
    }
  }

  goToPage(page) {
    this.currentPage = page;
    this.fetchData();
  }

  /**
   * Get authentication token from localStorage or session
   */
  getAuthToken() {
    return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
  }

  /**
   * Render howWeMatch section if configured
   */
  renderHowWeMatch() {
    const container = document.getElementById('drilldown-how-we-match');
    const howWeMatch = this.currentConfig.howWeMatch;

    if (!howWeMatch) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    document.getElementById('drilldown-match-method').textContent = howWeMatch.method || '';

    let contentHTML = '';

    // Steps
    if (howWeMatch.steps && howWeMatch.steps.length > 0) {
      contentHTML += '<div class="mt-3"><h5 class="text-xs font-semibold text-blue-900 mb-2">How It Works:</h5><ol class="list-decimal list-inside text-sm text-blue-800 space-y-1">';
      howWeMatch.steps.forEach(step => {
        contentHTML += `<li>${this.escapeHtml(step)}</li>`;
      });
      contentHTML += '</ol></div>';
    }

    // Accuracy
    if (howWeMatch.accuracy) {
      contentHTML += `<div class="mt-3"><h5 class="text-xs font-semibold text-blue-900 mb-1">Accuracy:</h5><p class="text-sm text-blue-800">${this.escapeHtml(howWeMatch.accuracy)}</p></div>`;
    }

    // Limitations
    if (howWeMatch.limitations && howWeMatch.limitations.length > 0) {
      contentHTML += '<div class="mt-3"><h5 class="text-xs font-semibold text-blue-900 mb-2">Limitations:</h5><ul class="list-disc list-inside text-sm text-blue-800 space-y-1">';
      howWeMatch.limitations.forEach(limitation => {
        contentHTML += `<li>${this.escapeHtml(limitation)}</li>`;
      });
      contentHTML += '</ul></div>';
    }

    document.getElementById('drilldown-match-content').innerHTML = contentHTML;
  }

  /**
   * Render sort options dropdown
   */
  renderSortOptions() {
    const container = document.getElementById('drilldown-sort-container');
    const select = document.getElementById('drilldown-sort-select');
    const sortOptions = this.currentConfig.sortOptions;

    if (!sortOptions || sortOptions.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    const optionsHTML = sortOptions.map(option => {
      const value = `${option.field}|${option.direction}`;
      const selected = (option.default && !this.sortBy) || (this.sortBy === option.field && this.sortDirection === option.direction);
      return `<option value="${value}" ${selected ? 'selected' : ''}>${this.escapeHtml(option.label)}</option>`;
    }).join('');

    select.innerHTML = `<option value="">Sort by...</option>${optionsHTML}`;
  }

  /**
   * Render export buttons
   */
  renderExportButtons() {
    const container = document.getElementById('drilldown-export-container');
    const exportConfig = this.currentConfig.export;

    if (!exportConfig || !exportConfig.enabled) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    // Show/hide individual export buttons based on formats
    const csvBtn = document.getElementById('drilldown-export-csv');
    const excelBtn = document.getElementById('drilldown-export-excel');

    if (exportConfig.formats && exportConfig.formats.includes('csv')) {
      csvBtn.classList.remove('hidden');
    } else {
      csvBtn.classList.add('hidden');
    }

    if (exportConfig.formats && exportConfig.formats.includes('excel')) {
      excelBtn.classList.remove('hidden');
    } else {
      excelBtn.classList.add('hidden');
    }
  }

  /**
   * Export data to CSV or Excel
   */
  async exportData(format) {
    if (!this.currentConfig) return;

    try {
      const response = await fetch(
        `/api/v1/modules/${this.currentConfig.moduleKey}/metrics/${this.currentConfig.metricKey}/drilldown/export`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.getAuthToken()}`
          },
          body: JSON.stringify({
            periodStart: this.currentConfig.periodStart,
            periodEnd: this.currentConfig.periodEnd,
            format: format,
            filters: this.filters,
            search: this.searchQuery
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.currentConfig.metricKey}_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('[DrilldownRenderer] Export error:', error);
      alert(`Failed to export data: ${error.message}`);
    }
  }

  /**
   * Show help modal
   */
  showHelp() {
    const helpModal = document.getElementById('drilldown-help-modal');
    const helpContent = document.getElementById('drilldown-help-content');
    const helpText = this.currentConfig?.helpText;

    if (!helpText) {
      alert('No help documentation available for this drilldown.');
      return;
    }

    helpModal.classList.remove('hidden');

    // Render help content
    let html = '';

    if (helpText.title) {
      html += `<h2 class="text-xl font-bold text-gray-900 mb-4">${this.escapeHtml(helpText.title)}</h2>`;
    }

    if (helpText.sections && helpText.sections.length > 0) {
      helpText.sections.forEach(section => {
        html += `<div class="mb-6">`;
        if (section.heading) {
          html += `<h3 class="text-lg font-semibold text-gray-900 mb-2">${this.escapeHtml(section.heading)}</h3>`;
        }
        if (section.content) {
          html += `<p class="text-sm text-gray-700 mb-2">${this.escapeHtml(section.content)}</p>`;
        }
        if (section.bullets && section.bullets.length > 0) {
          html += '<ul class="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">';
          section.bullets.forEach(bullet => {
            html += `<li>${this.escapeHtml(bullet)}</li>`;
          });
          html += '</ul>';
        }
        html += '</div>';
      });
    }

    helpContent.innerHTML = html;
  }

  /**
   * Close help modal
   */
  closeHelp() {
    const helpModal = document.getElementById('drilldown-help-modal');
    helpModal.classList.add('hidden');
  }

  /**
   * Render column with badge and legend support
   */
  renderBadgeColumn(value, column) {
    if (column.type !== 'badge' || !column.legend) {
      return this.formatValue(value, column.format);
    }

    // Get legend text for this value
    const legendText = column.legend[value];
    const colorMap = {
      'Showed': 'bg-green-100 text-green-800',
      'No-Show': 'bg-red-100 text-red-800',
      'Cancelled': 'bg-gray-100 text-gray-800',
      'Rescheduled': 'bg-yellow-100 text-yellow-800',
      'Pending': 'bg-blue-100 text-blue-800',
      'Converted to Case': 'bg-green-100 text-green-800',
      'Won in CRM (No Case)': 'bg-yellow-100 text-yellow-800',
      'In Pipeline': 'bg-blue-100 text-blue-800',
      'Lost/Abandoned': 'bg-red-100 text-red-800',
      'Contact + Opportunity': 'bg-green-100 text-green-800',
      'Contact Only': 'bg-gray-100 text-gray-800',
      'Opportunity Only': 'bg-blue-100 text-blue-800'
    };

    const colorClass = colorMap[value] || 'bg-gray-100 text-gray-800';
    const title = legendText ? this.escapeHtml(legendText) : '';

    return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}" title="${title}">${this.escapeHtml(value)}</span>`;
  }
}


// Export and create global instance
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrilldownRenderer;
} else {
  window.DrilldownRenderer = DrilldownRenderer;
  window.drilldownRenderer = new DrilldownRenderer();
}
