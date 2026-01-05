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
    this.allRows = []; // Store all fetched rows for client-side filtering
    this.filteredRows = []; // Filtered rows after search/filter
    this.currentPage = 1;
    this.pageSize = 25;
    this.sortBy = null;
    this.sortDirection = 'asc';
    this.filters = {};
    this.searchQuery = '';
    this.initialized = false;
    this.currentTableView = null; // Stores current table view filter state

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

        <!-- Modal panel (full-screen) -->
        <div class="fixed inset-0 flex">
          <div class="relative w-full h-full bg-white overflow-y-auto">
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

              <!-- Insights/Alerts (if any) -->
              <div id="drilldown-insights" class="hidden mt-4 space-y-2">
                <!-- Insights will be rendered here -->
              </div>

              <!-- Filters and controls -->
              <div class="mt-4 flex flex-wrap items-center gap-4">
                <!-- Filter toggles -->
                <div id="drilldown-filter-container" class="hidden flex items-center space-x-2">
                  <!-- Filter buttons will be rendered here -->
                </div>
              </div>
            </div>

            <!-- Summary (if enabled) -->
            <div id="drilldown-summary-container" class="hidden bg-gray-50 px-4 py-3 sm:px-6">
              <div id="drilldown-summary" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                <!-- Summary fields will be rendered here -->
              </div>
            </div>

            <!-- Search bar with sort dropdown (positioned after filters, before table) -->
            <div class="bg-white px-4 sm:px-6 pt-4">
              <div class="flex items-center gap-3">
                <!-- Search input -->
                <div class="flex-1">
                  <label for="drilldown-search" class="sr-only">Search</label>
                  <input type="text" id="drilldown-search" placeholder="Search..." autocomplete="off"
                    class="block w-full rounded-md border border-gray-300 shadow-sm px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all">
                </div>

                <!-- Search button -->
                <button type="button" id="drilldown-search-btn" class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors">
                  <svg class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </button>

                <!-- Sort dropdown -->
                <div id="drilldown-sort-container" class="hidden">
                  <label for="drilldown-sort-select" class="sr-only">Sort by</label>
                  <select id="drilldown-sort-select" class="block rounded-md border border-gray-300 shadow-sm px-3 py-2 pr-10 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all">
                    <!-- Sort options will be rendered here -->
                  </select>
                </div>
              </div>
            </div>

            <!-- Table container -->
            <div class="bg-white px-4 sm:px-6 pb-4">
              <div class="mt-4 flex flex-col">
                <div class="overflow-x-auto">
                  <div class="inline-block min-w-full align-middle">
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

    // Get search input element
    const searchInput = document.getElementById('drilldown-search');

    // Search button (click to search)
    document.getElementById('drilldown-search-btn')?.addEventListener('click', () => {
      const searchInput = document.getElementById('drilldown-search');
      this.searchQuery = searchInput?.value || '';
      this.currentPage = 1;
      this.fetchData();
    });

    // Search on Enter key
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.searchQuery = e.target.value;
        this.currentPage = 1;
        this.fetchData();
      }
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
  async open(moduleKey, metricKey, options = {}) {
    // Initialize if not already done (lazy initialization)
    this.init();

    // Extract options (support both object and legacy separate params)
    const { periodStart, periodEnd, organizationId } = options;

    if (!periodStart || !periodEnd) {
      console.error('[DrilldownRenderer] Missing periodStart or periodEnd in options');
      return;
    }

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
        organizationId,
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

      // Inject custom CSS to override browser autofill styling
      this.injectCustomCSS();

      // Fetch and render data
      await this.fetchData();
    } catch (error) {
      console.error('[DrilldownRenderer] Error opening drilldown:', error);
      this.showError(error.message || 'Failed to load drilldown configuration');
    }
  }

  /**
   * Inject custom CSS to override browser autofill and focus styling
   */
  injectCustomCSS() {
    // Check if custom styles already exist
    if (document.getElementById('drilldown-custom-styles')) return;

    const style = document.createElement('style');
    style.id = 'drilldown-custom-styles';
    style.textContent = `
      /* Override browser autofill yellow background */
      #drilldown-search:-webkit-autofill,
      #drilldown-search:-webkit-autofill:hover,
      #drilldown-search:-webkit-autofill:focus,
      #drilldown-search:-webkit-autofill:active {
        -webkit-box-shadow: 0 0 0 30px white inset !important;
        -webkit-text-fill-color: #111827 !important;
        transition: background-color 5000s ease-in-out 0s;
      }

      /* Remove yellow border from all inputs and selects */
      #drilldown-search:focus,
      #drilldown-sort-select:focus {
        outline: none !important;
        box-shadow: 0 0 0 2px #3b82f6 !important;
        border-color: transparent !important;
      }

      /* Ensure select dropdown arrow is visible */
      #drilldown-sort-select {
        background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
        background-position: right 0.5rem center;
        background-repeat: no-repeat;
        background-size: 1.5em 1.5em;
        padding-right: 2.5rem;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
      }
    `;
    document.head.appendChild(style);
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
    // Use global api helper instead of fetch to support Electron backend URLs
    // Check both window.api and global api (defined in api.js)
    const apiClient = window.api || (typeof api !== 'undefined' ? api : null);

    if (apiClient) {
      const response = await apiClient.get(`/api/v1/modules/${moduleKey}/metrics/${metricKey}/drilldown`);
      // api helper returns response.data, which contains {success: true, drilldown: {...}}
      return response.data || response;
    }

    // Fallback to fetch for non-Electron environments
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
      let result;

      // Use global api helper instead of fetch to support Electron backend URLs
      // Check both window.api and global api (defined in api.js)
      const apiClient = window.api || (typeof api !== 'undefined' ? api : null);

      if (apiClient) {
        const requestBody = {
          periodStart: this.currentConfig.periodStart,
          periodEnd: this.currentConfig.periodEnd,
          organizationId: this.currentConfig.organizationId,
          page: this.currentPage,
          pageSize: this.pageSize,
          sortBy: this.sortBy,
          sortDirection: this.sortDirection,
          filters: this.filters,
          search: this.searchQuery
        };

        // Add view filter if set (from clicking summary cards)
        if (this.currentViewFilter) {
          requestBody.viewFilter = this.currentViewFilter;
        }
        if (this.currentViewType) {
          requestBody.viewType = this.currentViewType;
        }

        const response = await apiClient.post(
          `/api/v1/modules/${this.currentConfig.moduleKey}/metrics/${this.currentConfig.metricKey}/drilldown/execute`,
          requestBody
        );
        result = response;
      } else {
        // Fallback to fetch for non-Electron environments
        const requestBody = {
          periodStart: this.currentConfig.periodStart,
          periodEnd: this.currentConfig.periodEnd,
          organizationId: this.currentConfig.organizationId,
          page: this.currentPage,
          pageSize: this.pageSize,
          sortBy: this.sortBy,
          sortDirection: this.sortDirection,
          filters: this.filters,
          search: this.searchQuery
        };

        // Add view filter if set (from clicking summary cards)
        if (this.currentViewFilter) {
          requestBody.viewFilter = this.currentViewFilter;
        }
        if (this.currentViewType) {
          requestBody.viewType = this.currentViewType;
        }

        const response = await fetch(
          `/api/v1/modules/${this.currentConfig.moduleKey}/metrics/${this.currentConfig.metricKey}/drilldown/execute`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.getAuthToken()}`
            },
            body: JSON.stringify(requestBody)
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch drilldown data: ${response.statusText}`);
        }

        result = await response.json();
      }

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
   * Render summary statistics (detects structure and delegates)
   */
  renderSummary() {
    // Check if summary.sections exists (new structure)
    if (this.currentConfig.summary?.sections) {
      this.renderSectionedSummary();
    } else if (this.currentConfig.summary?.fields) {
      // Render flat layout (backwards compatibility)
      this.renderFlatSummary();
    } else {
      // No summary configured
      const container = document.getElementById('drilldown-summary-container');
      container.classList.add('hidden');
    }
  }

  /**
   * Render flat summary (legacy/backwards compatible)
   */
  renderFlatSummary() {
    const container = document.getElementById('drilldown-summary-container');
    const summaryEl = document.getElementById('drilldown-summary');

    if (!this.currentData.summary || !this.currentConfig.summary?.fields) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    // Restore grid classes for flat layout (backwards compatibility)
    summaryEl.className = 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4';

    const summaryHTML = this.currentConfig.summary.fields.map(field => {
      const value = this.currentData.summary[field.field];
      const formattedValue = this.formatValue(value, field.format);
      const highlightClass = field.highlight ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200';
      const clickableClass = field.clickable ? 'cursor-pointer hover:bg-blue-100 hover:border-blue-300' : '';
      const badgeHTML = field.badge ? this.renderBadge(field.badge) : '';

      return `
        <div class="border ${highlightClass} ${clickableClass} rounded-lg px-3 py-2 relative group"
             ${field.clickable ? `data-clickable="true" data-filter-field="${field.filterBy?.field}" data-filter-value='${JSON.stringify(field.filterBy?.value)}'` : ''}>
          <dt class="text-xs font-medium text-gray-500 truncate flex items-center justify-between">
            <span>${field.label}</span>
            ${badgeHTML}
          </dt>
          <dd class="mt-1 text-lg font-semibold text-gray-900">${formattedValue}</dd>
          ${field.description ? `<p class="text-xs text-gray-500 mt-1">${field.description}</p>` : ''}
          ${field.helpText ? `
            <div class="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none w-64 z-10">
              ${field.helpText}
              <div class="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900"></div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    summaryEl.innerHTML = summaryHTML;

    // Attach click handlers to clickable summary items
    const clickableItems = summaryEl.querySelectorAll('[data-clickable="true"]');
    clickableItems.forEach(item => {
      item.addEventListener('click', () => {
        const filterField = item.getAttribute('data-filter-field');
        const filterValue = JSON.parse(item.getAttribute('data-filter-value'));
        this.applySummaryFilter(filterField, filterValue);
      });
    });
  }

  /**
   * Render sectioned summary (new structure)
   */
  renderSectionedSummary() {
    const container = document.getElementById('drilldown-summary-container');
    const summaryEl = document.getElementById('drilldown-summary');

    if (!this.currentData.summary || !this.currentConfig.summary?.sections) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');

    // Remove grid classes from summary element for sectioned layout
    summaryEl.className = ''; // Clear all classes

    // Render each section
    const sectionsHTML = this.currentConfig.summary.sections.map(section => {
      if (section.type === 'hero') {
        return this.renderHeroSection(section);
      } else if (section.type === 'metrics_grid') {
        return this.renderMetricsGridSection(section);
      }
      return '';
    }).join('');

    summaryEl.innerHTML = sectionsHTML;

    // Attach click handlers to clickable summary items
    const clickableItems = summaryEl.querySelectorAll('[data-clickable="true"]');
    clickableItems.forEach(item => {
      item.addEventListener('click', () => {
        const filterRaw = item.getAttribute('data-table-view-filter');
        const viewType = item.getAttribute('data-table-view-type');

        if (filterRaw) {
          try {
            const filter = JSON.parse(filterRaw);
            this.currentTableView = { filter, viewType };
            console.log('[DrilldownRenderer] Summary field clicked - Table view:', this.currentTableView);

            // Apply the table view filter
            this.applyTableViewFilter(filter, viewType);
          } catch (e) {
            console.error('[DrilldownRenderer] Failed to parse table view filter:', e);
          }
        }
      });
    });
  }

  /**
   * Apply table view filter when a summary card is clicked
   * @param {Object|String} filter - Filter criteria (can be string like "all", "qualified", or object with criteria)
   * @param {String} viewType - Type of view ("contacts", "opportunities", etc.)
   */
  applyTableViewFilter(filter, viewType) {
    console.log('[DrilldownRenderer] Applying table view filter:', { filter, viewType });

    // Reset to page 1 when applying new filter
    this.currentPage = 1;

    // Clear existing filters and search
    this.filters = {};
    this.searchQuery = '';

    // Update UI to reflect cleared filters
    const searchInput = document.getElementById('drilldown-search');
    if (searchInput) searchInput.value = '';

    // Store the filter type for the API request
    this.currentViewFilter = filter;
    this.currentViewType = viewType;

    // Re-fetch data with the new filter
    this.fetchData();
  }

  /**
   * Render hero section (large highlighted metric)
   */
  renderHeroSection(section) {
    if (!section.fields || section.fields.length === 0) return '';

    const field = section.fields[0]; // Hero sections typically have one field
    const value = this.currentData.summary[field.field];
    const formattedValue = this.formatValue(value, field.format);

    // Support dynamic description templates
    let description = field.description;
    if (field.descriptionTemplate) {
      description = this.substituteTemplate(field.descriptionTemplate, this.currentData.summary);
    }

    // Check if hero card is clickable
    const clickable = field.clickable && field.tableView;
    const clickableClass = clickable ? 'cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-200' : '';

    const dataAttrs = clickable
      ? `data-clickable="true" data-table-view-filter='${JSON.stringify(field.tableView?.filter || 'all')}' data-table-view-type="${field.tableView?.viewType || 'all'}"`
      : '';

    // Icon mapping
    const iconMap = {
      'percentage': `<svg class="h-8 w-8 text-indigo-400 absolute top-6 right-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>`,
      'default': ''
    };

    const icon = iconMap[field.icon] || iconMap.default;

    return `
      <div class="mb-6 p-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 relative ${clickableClass}" ${dataAttrs}>
        <p class="text-sm text-gray-600 mb-1">${this.escapeHtml(field.label)}</p>
        <p class="text-4xl font-bold text-indigo-600">${formattedValue}</p>
        ${description ? `<p class="text-xs text-gray-500 mt-1">${this.escapeHtml(description)}${clickable ? ' · <span class="text-indigo-600 font-medium">Click to view all leads</span>' : ''}</p>` : ''}
        ${icon}
      </div>
    `;
  }

  /**
   * Render metrics grid section (grid of metric cards)
   */
  renderMetricsGridSection(section) {
    if (!section.fields || section.fields.length === 0) return '';

    const fieldsHTML = section.fields.map(field => {
      const value = this.currentData.summary[field.field];
      const formattedValue = this.formatValue(value, field.format);

      // Extract color from emoji/badge
      const color = this.extractColorFromField(field, value);

      const clickable = field.tableView ? true : false;
      const clickableClass = clickable ? 'cursor-pointer hover:shadow-md hover:scale-105 transition-transform' : '';

      const dataAttrs = clickable
        ? `data-clickable="true" data-table-view-filter='${JSON.stringify(field.tableView?.filter || {})}' data-table-view-type="${field.tableView?.viewType || 'all'}"`
        : '';

      return `
        <div class="bg-${color}-50 border border-${color}-200 rounded-lg px-3 py-2 ${clickableClass}" ${dataAttrs}>
          <p class="text-sm font-medium text-${color}-900">${this.escapeHtml(field.label)}</p>
          <p class="text-3xl font-bold text-${color}-700 mt-1">${formattedValue}</p>
          ${field.description ? `<p class="text-xs text-${color}-600 mt-1">${this.escapeHtml(field.description)}${clickable ? ' · Click to view' : ''}</p>` : ''}
        </div>
      `;
    }).join('');

    // Support configurable columns (default: 2)
    const columns = section.columns || 2;
    const gridColsClass = `grid-cols-${columns}`;

    return `
      <div class="mb-6">
        ${section.title ? `<h4 class="font-semibold text-gray-900 mb-4">${this.escapeHtml(section.title)}</h4>` : ''}
        ${section.description ? `<p class="text-sm text-gray-600 mb-4">${this.escapeHtml(section.description)}</p>` : ''}

        <div class="grid ${gridColsClass} gap-4">
          ${fieldsHTML}
        </div>

        ${section.footer ? `<div class="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">${this.escapeHtml(section.footer)}</div>` : ''}
      </div>
    `;
  }

  /**
   * Extract color from field based on emoji/badge/value
   */
  extractColorFromField(field, value) {
    // Check for explicit badge emoji
    const label = field.label || '';
    const description = field.description || '';

    // Color mapping based on emoji/semantic meaning
    if (label.includes('✅') || description.includes('✅')) return 'green';
    if (label.includes('⚠️') || description.includes('⚠️')) return 'yellow';
    if (label.includes('ℹ️') || description.includes('ℹ️')) return 'blue';
    if (label.includes('📋') || description.includes('📋')) return 'purple';
    if (label.includes('🔴') || description.includes('🔴')) return 'red';
    if (label.includes('🔄') || description.includes('🔄')) return 'orange';

    // Check for orphaned opportunities (red if > 0)
    if (field.field === 'orphaned_opportunities' && value > 0) return 'red';
    if (field.field === 'orphaned_opportunities') return 'yellow';

    // Semantic field mapping
    if (field.field.includes('without') || field.field.includes('missing')) return 'yellow';
    if (field.field.includes('with') || field.field.includes('success')) return 'green';
    if (field.field.includes('total') || field.field.includes('count')) return 'blue';
    if (field.field.includes('avg') || field.field.includes('average')) return 'orange';

    // Default
    return 'gray';
  }

  /**
   * Render badge for summary field
   */
  renderBadge(badgeType) {
    const badges = {
      warning: '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">⚠️</span>',
      info: '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">ℹ️</span>',
      success: '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">✓</span>',
      error: '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">✕</span>'
    };
    return badges[badgeType] || '';
  }

  /**
   * Apply filter from summary item click
   */
  applySummaryFilter(filterField, filterValue) {
    // Set the filter
    this.filters[filterField] = filterValue;

    // Update the filter UI if exists
    const filterSelect = document.querySelector(`select[name="${filterField}"], input[name="${filterField}"]`);
    if (filterSelect) {
      if (filterSelect.tagName === 'SELECT' && filterSelect.multiple) {
        // Multi-select
        Array.from(filterSelect.options).forEach(option => {
          option.selected = filterValue.includes(option.value);
        });
      } else if (filterSelect.tagName === 'SELECT') {
        filterSelect.value = filterValue[0] || filterValue;
      }
    }

    // Reset to page 1 and re-render
    this.currentPage = 1;
    this.renderTable();
    this.renderPagination();
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
      case 'percentage':
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
    // Handle non-string values
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);

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
   * Format entity names as tag-style badges
   * Looks for capitalized entity names (Contact, Opportunity, Contact ID, etc.) and wraps them in badge styles
   */
  formatEntityNames(text) {
    // Entity names to format as tags
    const entities = [
      'Contact ID',
      'Contact',
      'Opportunity',
      'Opportunities',
      'Lead',
      'Leads',
      'Case',
      'Cases',
      'Matter',
      'Matters'
    ];

    // Sort by length (longest first) to avoid partial replacements
    entities.sort((a, b) => b.length - a.length);

    let formattedText = text;
    entities.forEach(entity => {
      // Use word boundaries to match whole words only
      const regex = new RegExp(`\\b(${entity})\\b`, 'g');
      formattedText = formattedText.replace(
        regex,
        '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 mx-0.5">$1</span>'
      );
    });

    return formattedText;
  }

  /**
   * Substitute template variables with values from data object
   * Example: "{{contacts_with_opportunities}} of {{total_contacts}} contacts" → "7 of 32 contacts"
   */
  substituteTemplate(template, data) {
    if (!template) return '';

    let result = template;
    // Match {{variable_name}} patterns
    const matches = template.match(/\{\{([^}]+)\}\}/g);

    if (matches) {
      matches.forEach(match => {
        const fieldName = match.replace(/\{\{|\}\}/g, '').trim();
        const value = data[fieldName];
        // Format numbers nicely
        const formattedValue = typeof value === 'number' ? Math.round(value) : (value || '');
        result = result.replace(match, formattedValue);
      });
    }

    return result;
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
   * Render export buttons (deprecated - export buttons removed from UI)
   */
  renderExportButtons() {
    // Export buttons have been removed from the UI
    // This method is kept for backwards compatibility but does nothing
    return;
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
    const helpModalTitle = document.getElementById('help-modal-title');
    const helpContent = document.getElementById('drilldown-help-content');
    const helpText = this.currentConfig?.helpText;

    if (!helpText) {
      alert('No help documentation available for this drilldown.');
      return;
    }

    helpModal.classList.remove('hidden');

    // Set modal title to drilldown title (from helpText.title or current config title)
    const modalTitle = helpText?.title || this.currentConfig?.title || 'Help & Documentation';
    helpModalTitle.textContent = modalTitle;

    // Render help content
    let html = '';

    if (helpText.sections && helpText.sections.length > 0) {
      helpText.sections.forEach(section => {
        html += `<div class="mb-6">`;
        if (section.heading) {
          html += `<h3 class="text-lg font-semibold text-gray-900 mb-2">${this.escapeHtml(section.heading)}</h3>`;
        }
        if (section.content) {
          html += `<p class="text-sm text-gray-700 mb-2">${this.formatEntityNames(this.escapeHtml(section.content))}</p>`;
        }
        if (section.bullets && section.bullets.length > 0) {
          html += '<ul class="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">';
          section.bullets.forEach(bullet => {
            html += `<li>${this.formatEntityNames(this.escapeHtml(bullet))}</li>`;
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

    let displayValue = value;
    let legendKey = String(value); // Convert to string for lookup

    // First, try exact match in legend (for component scores like 0, 15, 20, 30, 50)
    if (!column.legend[legendKey] && typeof value === 'number') {
      // No exact match - try range mapping for quality scores (80-100, 60-79, etc.)
      if (value >= 80) {
        legendKey = '80-100';
      } else if (value >= 60) {
        legendKey = '60-79';
      } else if (value >= 40) {
        legendKey = '40-59';
      } else if (value >= 0) {
        legendKey = '0-39';
      }
    }

    // Get legend text for this value
    const legendText = column.legend[legendKey];

    // If we have legend text, show that instead of the raw value
    // Keep the raw value as a tooltip for context
    if (legendText) {
      displayValue = legendText;
    }

    // Color mapping based on score value and type
    const getColorClass = (key, val) => {
      // Exact value colors (component scores)
      const exactColors = {
        '50': 'bg-green-100 text-green-800',
        '30': 'bg-green-100 text-green-800',
        '25': 'bg-blue-100 text-blue-800',
        '20': 'bg-blue-100 text-blue-800',
        '15': 'bg-yellow-100 text-yellow-800',
        '10': 'bg-red-100 text-red-800',
        '0': 'bg-gray-100 text-gray-800'
      };

      // Range colors (quality scores)
      const rangeColors = {
        '80-100': 'bg-green-100 text-green-800',
        '60-79': 'bg-yellow-100 text-yellow-800',
        '40-59': 'bg-orange-100 text-orange-800',
        '0-39': 'bg-blue-100 text-blue-800'
      };

      // Status colors
      const statusColors = {
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

      return exactColors[key] || rangeColors[key] || statusColors[key] || 'bg-gray-100 text-gray-800';
    };

    const colorClass = getColorClass(legendKey, value);

    // Tooltip shows original value for reference (e.g., "Score: 20")
    const title = typeof value === 'number' ? `Score: ${value}` : '';

    return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}" title="${title}">${this.escapeHtml(displayValue)}</span>`;
  }
}


// Export and create global instance
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrilldownRenderer;
} else {
  window.DrilldownRenderer = DrilldownRenderer;
  window.drilldownRenderer = new DrilldownRenderer();
}
