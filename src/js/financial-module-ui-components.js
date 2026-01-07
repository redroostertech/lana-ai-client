/**
 * Financial Module UI Components - Phase 2 UX Enhancements
 * Pagination, Export, Sort, and Filter components for drilldown tables
 *
 * @module FinancialModuleUIComponents
 * @description Reusable UI components following LANA's vanilla JavaScript + Tailwind CSS architecture
 */

// ==============================================================================
// TASK 1: PAGINATION UI COMPONENT
// ==============================================================================

/**
 * Pagination Component
 * Handles page navigation, page size selection, and results display
 */
class PaginationComponent {
  /**
   * @param {HTMLElement} container - Container element for pagination UI
   * @param {Object} config - Configuration object
   * @param {number} config.defaultPageSize - Default items per page (25)
   * @param {Array<number>} config.pageSizeOptions - Available page size options [10, 25, 50, 100]
   * @param {Function} config.onPageChange - Callback when page/pageSize changes
   */
  constructor(container, config = {}) {
    this.container = container;
    this.currentPage = 1;
    this.pageSize = config.defaultPageSize || 25;
    this.totalItems = 0;
    this.totalPages = 0;
    this.pageSizeOptions = config.pageSizeOptions || [10, 25, 50, 100];
    this.onPageChange = config.onPageChange || (() => {});

    this.render();
    this.attachEventListeners();
  }

  /**
   * Render the pagination UI
   */
  render() {
    this.container.innerHTML = `
      <div class="flex items-center justify-between px-4 py-3 bg-white border-t border-gray-200">
        <!-- Left: Page size selector -->
        <div class="flex items-center space-x-2">
          <span class="text-sm text-gray-700">Show</span>
          <select id="pageSize" class="border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500">
            ${this.pageSizeOptions.map(size => `
              <option value="${size}" ${size === this.pageSize ? 'selected' : ''}>${size}</option>
            `).join('')}
          </select>
          <span class="text-sm text-gray-700">items per page</span>
        </div>

        <!-- Center: Page navigation -->
        <div class="flex items-center space-x-2">
          <button id="firstPage" class="px-2 py-1 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled title="First page">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
          <button id="prevPage" class="px-2 py-1 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled title="Previous page">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <span class="text-sm text-gray-700 flex items-center space-x-2">
            <span>Page</span>
            <input
              type="number"
              id="currentPage"
              value="1"
              min="1"
              max="1"
              class="w-16 px-2 py-1 text-center border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            >
            <span>of <span id="totalPages">1</span></span>
          </span>

          <button id="nextPage" class="px-2 py-1 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" title="Next page">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button id="lastPage" class="px-2 py-1 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" title="Last page">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <!-- Right: Results counter -->
        <div class="text-sm text-gray-700">
          Showing <span id="startItem">1</span>-<span id="endItem">25</span> of <span id="totalItems">0</span> results
        </div>
      </div>
    `;
  }

  /**
   * Update pagination state with new total items count
   * @param {number} totalItems - Total number of items
   */
  updatePagination(totalItems) {
    this.totalItems = totalItems;
    this.totalPages = Math.ceil(totalItems / this.pageSize) || 1;

    // Ensure current page is within bounds
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }

    this.updateUI();
  }

  /**
   * Navigate to a specific page
   * @param {number} page - Page number (1-indexed)
   */
  goToPage(page) {
    const targetPage = parseInt(page);
    if (targetPage < 1 || targetPage > this.totalPages || isNaN(targetPage)) {
      // Reset to current page if invalid
      this.container.querySelector('#currentPage').value = this.currentPage;
      return;
    }

    this.currentPage = targetPage;
    this.updateUI();
    this.onPageChange({ page: this.currentPage, pageSize: this.pageSize });
  }

  /**
   * Change page size
   * @param {number} newSize - New page size
   */
  changePageSize(newSize) {
    this.pageSize = parseInt(newSize);
    this.currentPage = 1; // Reset to first page when changing page size
    this.totalPages = Math.ceil(this.totalItems / this.pageSize) || 1;
    this.updateUI();
    this.onPageChange({ page: this.currentPage, pageSize: this.pageSize });
  }

  /**
   * Navigate to first page
   */
  firstPage() {
    this.goToPage(1);
  }

  /**
   * Navigate to last page
   */
  lastPage() {
    this.goToPage(this.totalPages);
  }

  /**
   * Navigate to previous page
   */
  prevPage() {
    this.goToPage(this.currentPage - 1);
  }

  /**
   * Navigate to next page
   */
  nextPage() {
    this.goToPage(this.currentPage + 1);
  }

  /**
   * Update UI elements with current state
   */
  updateUI() {
    // Update page numbers
    const currentPageInput = this.container.querySelector('#currentPage');
    const totalPagesSpan = this.container.querySelector('#totalPages');

    if (currentPageInput) {
      currentPageInput.value = this.currentPage;
      currentPageInput.max = this.totalPages;
    }

    if (totalPagesSpan) {
      totalPagesSpan.textContent = this.totalPages;
    }

    // Update results counter
    const startItem = this.totalItems === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
    const endItem = Math.min(this.currentPage * this.pageSize, this.totalItems);

    const startItemSpan = this.container.querySelector('#startItem');
    const endItemSpan = this.container.querySelector('#endItem');
    const totalItemsSpan = this.container.querySelector('#totalItems');

    if (startItemSpan) startItemSpan.textContent = startItem;
    if (endItemSpan) endItemSpan.textContent = endItem;
    if (totalItemsSpan) totalItemsSpan.textContent = this.totalItems;

    // Enable/disable buttons
    const firstBtn = this.container.querySelector('#firstPage');
    const prevBtn = this.container.querySelector('#prevPage');
    const nextBtn = this.container.querySelector('#nextPage');
    const lastBtn = this.container.querySelector('#lastPage');

    if (firstBtn) firstBtn.disabled = this.currentPage === 1;
    if (prevBtn) prevBtn.disabled = this.currentPage === 1;
    if (nextBtn) nextBtn.disabled = this.currentPage === this.totalPages;
    if (lastBtn) lastBtn.disabled = this.currentPage === this.totalPages;
  }

  /**
   * Attach event listeners to pagination controls
   */
  attachEventListeners() {
    // Page navigation buttons
    this.container.querySelector('#firstPage')?.addEventListener('click', () => this.firstPage());
    this.container.querySelector('#prevPage')?.addEventListener('click', () => this.prevPage());
    this.container.querySelector('#nextPage')?.addEventListener('click', () => this.nextPage());
    this.container.querySelector('#lastPage')?.addEventListener('click', () => this.lastPage());

    // Current page input (change on blur or Enter key)
    const currentPageInput = this.container.querySelector('#currentPage');
    currentPageInput?.addEventListener('change', (e) => this.goToPage(e.target.value));
    currentPageInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.goToPage(e.target.value);
      }
    });

    // Page size selector
    this.container.querySelector('#pageSize')?.addEventListener('change', (e) => {
      this.changePageSize(e.target.value);
    });
  }

  /**
   * Get current pagination state
   * @returns {Object} Current state
   */
  getState() {
    return {
      page: this.currentPage,
      pageSize: this.pageSize,
      totalItems: this.totalItems,
      totalPages: this.totalPages
    };
  }

  /**
   * Reset pagination to initial state
   */
  reset() {
    this.currentPage = 1;
    this.totalItems = 0;
    this.totalPages = 0;
    this.updateUI();
  }
}

// ==============================================================================
// TASK 2: EXPORT BUTTON UI COMPONENT
// ==============================================================================

/**
 * Export Component
 * Handles CSV and Excel export functionality
 */
class ExportComponent {
  /**
   * @param {HTMLElement} container - Container element for export buttons
   * @param {Object} config - Configuration object
   * @param {string} config.metric - Metric key (e.g., 'expected_income')
   * @param {string} config.endpoint - API endpoint for drilldown data
   * @param {Function} config.getFilters - Function to get current active filters
   * @param {Function} config.getSort - Function to get current sort configuration
   * @param {Function} config.getPeriod - Function to get period_start and period_end
   * @param {Function} config.getOrgId - Function to get organization ID
   */
  constructor(container, config = {}) {
    this.container = container;
    this.metric = config.metric;
    this.endpoint = config.endpoint;
    this.getFilters = config.getFilters || (() => ({}));
    this.getSort = config.getSort || (() => ({}));
    this.getPeriod = config.getPeriod || (() => ({ start: null, end: null }));
    this.getOrgId = config.getOrgId || (() => null);

    this.render();
    this.attachEventListeners();
  }

  /**
   * Render the export buttons UI
   */
  render() {
    this.container.innerHTML = `
      <div class="flex items-center space-x-2">
        <button id="exportCSV" class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>

        <button id="exportExcel" class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export Excel
        </button>
      </div>
    `;
  }

  /**
   * Export data in specified format
   * @param {string} format - 'csv' or 'excel'
   */
  async exportData(format) {
    try {
      // Show loading state
      this.setLoading(format, true);

      // Build query params
      const period = this.getPeriod();
      const filters = this.getFilters();
      const sort = this.getSort();
      const orgId = this.getOrgId();

      const params = new URLSearchParams({
        format: format,
        org_id: orgId,
        period_start: period.start,
        period_end: period.end
      });

      // Add filters if present
      if (Object.keys(filters).length > 0) {
        params.append('filters', JSON.stringify(filters));
      }

      // Add sort if present
      if (sort.field) {
        params.append('sort', JSON.stringify(sort));
      }

      // Fetch export file
      const response = await fetch(`${this.endpoint}/export?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      // Get filename from Content-Disposition header or generate default
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = this.extractFilename(contentDisposition) ||
                      `${this.metric}_drilldown_${this.formatDate(new Date())}.${format === 'csv' ? 'csv' : 'xlsx'}`;

      // Download file
      const blob = await response.blob();
      this.downloadFile(blob, filename);

      // Hide loading state
      this.setLoading(format, false);

      // Show success message
      this.showToast(`Exported ${filename} successfully`, 'success');

    } catch (error) {
      console.error('[ExportComponent] Export error:', error);
      this.setLoading(format, false);
      this.showToast('Export failed. Please try again.', 'error');
    }
  }

  /**
   * Download blob as file
   * @param {Blob} blob - File blob
   * @param {string} filename - Filename
   */
  downloadFile(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  /**
   * Extract filename from Content-Disposition header
   * @param {string} contentDisposition - Content-Disposition header value
   * @returns {string|null} Filename or null
   */
  extractFilename(contentDisposition) {
    if (!contentDisposition) return null;
    const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (match && match[1]) {
      return match[1].replace(/['"]/g, '');
    }
    return null;
  }

  /**
   * Format date as YYYY-MM-DD
   * @param {Date} date - Date object
   * @returns {string} Formatted date
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Set loading state on export button
   * @param {string} format - 'csv' or 'excel'
   * @param {boolean} isLoading - Loading state
   */
  setLoading(format, isLoading) {
    const button = this.container.querySelector(format === 'csv' ? '#exportCSV' : '#exportExcel');
    if (!button) return;

    button.disabled = isLoading;

    if (isLoading) {
      const icon = `
        <svg class="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      `;
      button.innerHTML = `${icon} Exporting...`;
    } else {
      const csvIcon = `
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      `;
      const excelIcon = `
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      `;
      button.innerHTML = format === 'csv'
        ? `${csvIcon} Export CSV`
        : `${excelIcon} Export Excel`;
    }
  }

  /**
   * Get authentication token from sessionStorage
   * @returns {string} JWT token
   */
  getAuthToken() {
    return sessionStorage.getItem('token') || '';
  }

  /**
   * Show toast notification
   * @param {string} message - Message to display
   * @param {string} type - 'success' or 'error'
   */
  showToast(message, type = 'success') {
    // This would integrate with existing LANA toast notification system
    // For now, use console
    console.log(`[ExportComponent] ${type.toUpperCase()}: ${message}`);

    // TODO: Integrate with LANA's notification system (notifications.js)
    if (window.showNotification) {
      window.showNotification(message, type);
    }
  }

  /**
   * Attach event listeners to export buttons
   */
  attachEventListeners() {
    this.container.querySelector('#exportCSV')?.addEventListener('click', () => this.exportData('csv'));
    this.container.querySelector('#exportExcel')?.addEventListener('click', () => this.exportData('excel'));
  }
}

// ==============================================================================
// TASK 3: SORT DROPDOWN UI COMPONENT
// ==============================================================================

/**
 * Sort Component
 * Handles sort dropdown with configurable options
 */
class SortComponent {
  /**
   * @param {HTMLElement} container - Container element for sort dropdown
   * @param {Object} config - Configuration object
   * @param {Array<Object>} config.sortOptions - Sort options from metric config
   * @param {Function} config.onSortChange - Callback when sort changes
   */
  constructor(container, config = {}) {
    this.container = container;
    this.sortOptions = config.sortOptions || [];
    this.currentSort = this.findDefaultSort();
    this.onSortChange = config.onSortChange || (() => {});

    this.render();
    this.attachEventListeners();

    // Apply default sort on initialization
    if (this.currentSort) {
      this.applySort(this.currentSort);
    }
  }

  /**
   * Find default sort option from configuration
   * @returns {Object|null} Default sort option or first option
   */
  findDefaultSort() {
    const defaultSort = this.sortOptions.find(opt => opt.default);
    return defaultSort || (this.sortOptions.length > 0 ? this.sortOptions[0] : null);
  }

  /**
   * Render the sort dropdown UI
   */
  render() {
    if (this.sortOptions.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    this.container.innerHTML = `
      <div class="flex items-center space-x-2">
        <label for="sortSelect" class="text-sm font-medium text-gray-700">Sort by:</label>
        <select id="sortSelect" class="block border-gray-300 rounded-md text-sm min-w-[200px] focus:ring-blue-500 focus:border-blue-500">
          ${this.sortOptions.map(option => {
            const value = `${option.field}:${option.direction}`;
            const selected = this.currentSort &&
                           this.currentSort.field === option.field &&
                           this.currentSort.direction === option.direction;
            return `<option value="${value}" ${selected ? 'selected' : ''}>${option.label}</option>`;
          }).join('')}
        </select>
      </div>
    `;
  }

  /**
   * Apply sort configuration
   * @param {Object} sortOption - Sort option object
   */
  applySort(sortOption) {
    this.currentSort = sortOption;
    this.onSortChange({
      field: sortOption.field,
      direction: sortOption.direction
    });
  }

  /**
   * Attach event listeners to sort dropdown
   */
  attachEventListeners() {
    this.container.querySelector('#sortSelect')?.addEventListener('change', (e) => {
      const [field, direction] = e.target.value.split(':');
      const sortOption = this.sortOptions.find(opt =>
        opt.field === field && opt.direction === direction
      );
      if (sortOption) {
        this.applySort(sortOption);
      }
    });
  }

  /**
   * Get current sort configuration
   * @returns {Object} Current sort
   */
  getSort() {
    return this.currentSort ? {
      field: this.currentSort.field,
      direction: this.currentSort.direction
    } : {};
  }

  /**
   * Reset to default sort
   */
  reset() {
    this.currentSort = this.findDefaultSort();
    const selectElement = this.container.querySelector('#sortSelect');
    if (selectElement && this.currentSort) {
      selectElement.value = `${this.currentSort.field}:${this.currentSort.direction}`;
      this.applySort(this.currentSort);
    }
  }
}

// ==============================================================================
// TASK 4: FILTER PANEL UI COMPONENT
// ==============================================================================

/**
 * Multi-Select Filter Component
 * Checkbox-based multi-selection filter
 */
class MultiSelectFilter {
  constructor(config) {
    this.field = config.field;
    this.label = config.label;
    this.options = config.options || [];
    this.dynamic = config.dynamic || false;
    this.description = config.description;
    this.selectedValues = [];
    this.endpoint = config.endpoint;
  }

  async render() {
    const container = document.createElement('div');
    container.className = 'space-y-2';

    // Label
    const label = document.createElement('label');
    label.className = 'block text-sm font-medium text-gray-700';
    label.textContent = this.label;
    container.appendChild(label);

    // Description
    if (this.description) {
      const desc = document.createElement('p');
      desc.className = 'text-xs text-gray-500';
      desc.textContent = this.description;
      container.appendChild(desc);
    }

    // Options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'space-y-2';

    // Load options (static or dynamic)
    let options = this.options;
    if (this.dynamic) {
      options = await this.loadDynamicOptions();
    }

    // Render checkboxes
    options.forEach(option => {
      const checkbox = this.createCheckbox(option);
      optionsContainer.appendChild(checkbox);
    });

    container.appendChild(optionsContainer);
    return container;
  }

  createCheckbox(option) {
    const wrapper = document.createElement('label');
    wrapper.className = 'flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors';

    const value = typeof option === 'object' ? option.value : option;
    const displayLabel = typeof option === 'object' ? option.label : option;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    checkbox.className = 'rounded border-gray-300 text-blue-600 focus:ring-blue-500';
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        if (!this.selectedValues.includes(value)) {
          this.selectedValues.push(value);
        }
      } else {
        this.selectedValues = this.selectedValues.filter(v => v !== value);
      }
    });

    const labelText = document.createElement('span');
    labelText.className = 'text-sm text-gray-700';
    labelText.textContent = displayLabel;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(labelText);

    return wrapper;
  }

  async loadDynamicOptions() {
    if (!this.endpoint) {
      console.error(`[MultiSelectFilter] No endpoint provided for dynamic filter: ${this.field}`);
      return [];
    }

    try {
      const response = await fetch(`${this.endpoint}/filter-options/${this.field}`, {
        headers: {
          'Authorization': `Bearer ${sessionStorage.getItem('token') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load filter options: ${response.statusText}`);
      }

      const data = await response.json();
      return data.options || [];
    } catch (error) {
      console.error(`[MultiSelectFilter] Error loading dynamic options for ${this.field}:`, error);
      return [];
    }
  }

  getValue() {
    return this.selectedValues.length > 0 ? this.selectedValues : null;
  }

  reset() {
    this.selectedValues = [];
    const checkboxes = document.querySelectorAll(`input[type="checkbox"]`);
    checkboxes.forEach(cb => cb.checked = false);
  }
}

/**
 * Range Filter Component
 * Min/max numeric input filter
 */
class RangeFilter {
  constructor(config) {
    this.field = config.field;
    this.label = config.label;
    this.min = config.min;
    this.max = config.max;
    this.description = config.description;
  }

  render() {
    const container = document.createElement('div');
    container.className = 'space-y-2';

    // Label
    const label = document.createElement('label');
    label.className = 'block text-sm font-medium text-gray-700';
    label.textContent = this.label;
    container.appendChild(label);

    // Description
    if (this.description) {
      const desc = document.createElement('p');
      desc.className = 'text-xs text-gray-500';
      desc.textContent = this.description;
      container.appendChild(desc);
    }

    // Min/Max inputs
    const inputsWrapper = document.createElement('div');
    inputsWrapper.className = 'flex items-center space-x-2';

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.id = `${this.field}_min`;
    minInput.placeholder = 'Min';
    if (this.min !== undefined) minInput.min = this.min;
    minInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500';

    const separator = document.createElement('span');
    separator.textContent = '—';
    separator.className = 'text-gray-500';

    const maxInput = document.createElement('input');
    maxInput.type = 'number';
    maxInput.id = `${this.field}_max`;
    maxInput.placeholder = 'Max';
    if (this.max !== undefined) maxInput.max = this.max;
    maxInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500';

    inputsWrapper.appendChild(minInput);
    inputsWrapper.appendChild(separator);
    inputsWrapper.appendChild(maxInput);

    container.appendChild(inputsWrapper);
    return container;
  }

  getValue() {
    const minValue = document.getElementById(`${this.field}_min`)?.value;
    const maxValue = document.getElementById(`${this.field}_max`)?.value;

    if (!minValue && !maxValue) return null;

    return {
      min: minValue ? parseFloat(minValue) : null,
      max: maxValue ? parseFloat(maxValue) : null
    };
  }

  reset() {
    const minInput = document.getElementById(`${this.field}_min`);
    const maxInput = document.getElementById(`${this.field}_max`);
    if (minInput) minInput.value = '';
    if (maxInput) maxInput.value = '';
  }
}

/**
 * Date Range Filter Component
 * Start/end date picker filter
 */
class DateRangeFilter {
  constructor(config) {
    this.field = config.field;
    this.label = config.label;
    this.description = config.description;
  }

  render() {
    const container = document.createElement('div');
    container.className = 'space-y-2';

    // Label
    const label = document.createElement('label');
    label.className = 'block text-sm font-medium text-gray-700';
    label.textContent = this.label;
    container.appendChild(label);

    // Description
    if (this.description) {
      const desc = document.createElement('p');
      desc.className = 'text-xs text-gray-500';
      desc.textContent = this.description;
      container.appendChild(desc);
    }

    // Date inputs
    const inputsWrapper = document.createElement('div');
    inputsWrapper.className = 'flex items-center space-x-2';

    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.id = `${this.field}_start`;
    startInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500';

    const separator = document.createElement('span');
    separator.textContent = '—';
    separator.className = 'text-gray-500';

    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.id = `${this.field}_end`;
    endInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500';

    inputsWrapper.appendChild(startInput);
    inputsWrapper.appendChild(separator);
    inputsWrapper.appendChild(endInput);

    container.appendChild(inputsWrapper);
    return container;
  }

  getValue() {
    const startValue = document.getElementById(`${this.field}_start`)?.value;
    const endValue = document.getElementById(`${this.field}_end`)?.value;

    if (!startValue && !endValue) return null;

    return {
      start: startValue || null,
      end: endValue || null
    };
  }

  reset() {
    const startInput = document.getElementById(`${this.field}_start`);
    const endInput = document.getElementById(`${this.field}_end`);
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
  }
}

/**
 * Filter Panel Component
 * Manages all filters in a collapsible panel
 */
class FilterPanelComponent {
  /**
   * @param {HTMLElement} container - Container element for filter panel
   * @param {Object} config - Configuration object
   * @param {Object} config.filterConfig - Filter configuration from metric
   * @param {string} config.endpoint - API endpoint for dynamic filter options
   * @param {Function} config.onFilterApply - Callback when filters are applied
   */
  constructor(container, config = {}) {
    this.container = container;
    this.filterConfig = config.filterConfig || { filters: [] };
    this.endpoint = config.endpoint;
    this.filters = [];
    this.onFilterApply = config.onFilterApply || (() => {});

    this.render();
  }

  async render() {
    // Create collapsible panel structure
    this.container.innerHTML = `
      <div class="bg-gray-50 border-b border-gray-200">
        <!-- Filter Toggle Button -->
        <button id="filterToggle" class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-100 transition-colors">
          <span class="flex items-center space-x-2">
            <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span class="font-medium text-gray-900">Filters</span>
            <span id="activeFilterCount" class="hidden px-2 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-full">0</span>
          </span>
          <svg id="filterChevron" class="w-5 h-5 text-gray-600 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <!-- Filter Panel (Collapsible) -->
        <div id="filterPanel" class="hidden px-4 py-4 space-y-4">
          <p class="text-sm text-gray-600">${this.filterConfig.description || 'Filter your results'}</p>

          <!-- Filters Container -->
          <div id="filterContainer" class="space-y-4">
            <!-- Filters will be rendered here -->
          </div>

          <!-- Action Buttons -->
          <div class="flex items-center justify-end space-x-2 pt-4 border-t border-gray-200">
            <button id="clearFilters" class="px-3 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Clear All
            </button>
            <button id="applyFilters" class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    `;

    // Render individual filters
    await this.renderFilters();

    // Attach event listeners
    this.attachEventListeners();
  }

  async renderFilters() {
    const filterContainer = this.container.querySelector('#filterContainer');
    if (!filterContainer) return;

    for (const filterConfig of this.filterConfig.filters || []) {
      let filter;

      // Add endpoint for dynamic filters
      const config = { ...filterConfig, endpoint: this.endpoint };

      switch (filterConfig.type) {
        case 'multiselect':
        case 'select':
          filter = new MultiSelectFilter(config);
          break;
        case 'range':
          filter = new RangeFilter(config);
          break;
        case 'date_range':
          filter = new DateRangeFilter(config);
          break;
        default:
          console.warn(`[FilterPanelComponent] Unknown filter type: ${filterConfig.type}`);
          continue;
      }

      if (filter) {
        this.filters.push(filter);
        const filterElement = await filter.render();
        filterContainer.appendChild(filterElement);
      }
    }
  }

  getActiveFilters() {
    const activeFilters = {};

    this.filters.forEach(filter => {
      const value = filter.getValue();
      if (value !== null) {
        activeFilters[filter.field] = value;
      }
    });

    return activeFilters;
  }

  applyFilters() {
    const filters = this.getActiveFilters();
    this.updateActiveFilterCount(Object.keys(filters).length);
    this.onFilterApply(filters);
  }

  clearFilters() {
    this.filters.forEach(filter => filter.reset());
    this.updateActiveFilterCount(0);
    this.onFilterApply({});
  }

  updateActiveFilterCount(count) {
    const badge = this.container.querySelector('#activeFilterCount');
    if (!badge) return;

    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  togglePanel() {
    const panel = this.container.querySelector('#filterPanel');
    const chevron = this.container.querySelector('#filterChevron');

    if (panel && chevron) {
      panel.classList.toggle('hidden');
      chevron.classList.toggle('rotate-180');
    }
  }

  attachEventListeners() {
    this.container.querySelector('#filterToggle')?.addEventListener('click', () => this.togglePanel());
    this.container.querySelector('#applyFilters')?.addEventListener('click', () => this.applyFilters());
    this.container.querySelector('#clearFilters')?.addEventListener('click', () => this.clearFilters());
  }

  /**
   * Open filter panel if defaultOpen is true
   */
  openIfDefault() {
    if (this.filterConfig.defaultOpen) {
      this.togglePanel();
    }
  }
}

// ==============================================================================
// EXPORT COMPONENTS
// ==============================================================================

// Export all components for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PaginationComponent,
    ExportComponent,
    SortComponent,
    FilterPanelComponent,
    MultiSelectFilter,
    RangeFilter,
    DateRangeFilter
  };
}

// Also make available globally for browser usage
if (typeof window !== 'undefined') {
  window.FinancialModuleUI = {
    PaginationComponent,
    ExportComponent,
    SortComponent,
    FilterPanelComponent,
    MultiSelectFilter,
    RangeFilter,
    DateRangeFilter
  };
}
