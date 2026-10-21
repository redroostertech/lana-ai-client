/**
 * Generic Drilldown Renderer Component
 * Renders metric drilldown data in a modal with table, pagination, and summary
 *
 * @module DrilldownRenderer
 * @description Data-driven component that fetches and renders drilldown data based on metric configuration
 */

// Marked library is loaded globally via script tag (see module-execution.html)
// The UMD build creates a global 'marked' object
// Configure marked if available
if (typeof marked !== 'undefined' && marked) {
  try {
    marked.use({
      breaks: true,
      gfm: true
    });
    console.log('[DrilldownRenderer] Marked library loaded successfully');
  } catch (e) {
    console.warn('[DrilldownRenderer] Error configuring marked:', e);
  }
} else {
  console.warn('[DrilldownRenderer] Marked library not available, markdown will not be rendered');
}

// Where this script was loaded from, so missing Lex components load from
// the same js/ folder (see ensureComponents).
const DRILLDOWN_SCRIPT_BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
  ? document.currentScript.src.replace(/drilldown-renderer\.js.*$/, '')
  : '';

class DrilldownRenderer {
  constructor() {
    this.modal = null;
    this.currentConfig = null;
    this.currentData = null;
    this.allRows = []; // Store all fetched rows for client-side filtering
    this.filteredRows = []; // Filtered rows after search/filter
    this.currentPage = 1;
    this.pageSize = 20;
    this.sortBy = null;
    this.sortDirection = 'asc';
    this.filters = {};
    this.searchQuery = '';
    this.initialized = false;
    this.currentTableView = null; // Stores current table view filter state
    this.contextGeneration = 0;
    this.dataGeneration = 0;
    this.facetLabels = new Map();

    // Active breakdown card filter: { column: string, value: string, key: string } or null.
    // Only one breakdown filter active at a time (v1 single-card filter rule).
    this.activeBreakdownFilter = null;

    // Bind pagination methods to preserve 'this' context when called from onclick
    this.prevPage = this.prevPage.bind(this);
    this.nextPage = this.nextPage.bind(this);
    this.goToPage = this.goToPage.bind(this);

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
    this.ensureComponents();
  }

  /**
   * Create the modal HTML structure
   */
createModalStructure() {
    // One lex-modal (full size) holds the header text, insights, summary,
    // breakdown cards, the toolbar and the record table (docs/TABLE-STANDARD.md).
    const helpButton = '<button type="button" id="drilldown-help" class="drilldown-help-btn" title="Help and documentation" aria-label="Help and documentation">' +
      '<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>' +
      '</button>';
    const modalHTML = `
      <lex-modal id="drilldown-modal" size="full" heading="Loading..." hide-actions="true" header-actions="${this.escapeHtml(helpButton)}">
        <div class="drilldown-body">
          <p class="drilldown-description" id="drilldown-description"></p>

          <!-- Insights/Alerts (if any) -->
          <div id="drilldown-insights" class="hidden mt-4 space-y-2"></div>

          <!-- Filter toggles -->
          <div id="drilldown-filter-container" class="hidden flex items-center space-x-2 mt-4"></div>

          <!-- Summary (if enabled) -->
          <div id="drilldown-summary-container" class="hidden bg-gray-50 px-4 py-3 mt-4 rounded-lg">
            <div id="drilldown-summary" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4"></div>
          </div>

          <!-- Breakdown cards (data.breakdown_cards from v2 drilldown schema) -->
          <div id="drilldown-breakdown-cards-container" class="drilldown-breakdown-cards-container hidden">
            <div id="drilldown-breakdown-cards" class="drilldown-breakdown-cards-grid"></div>
          </div>

          <!-- Toolbar: search, Sort by, order, count -->
          <div class="drilldown-toolbar" role="search" aria-label="Search and sort records">
            <div class="drilldown-toolbar-search">
              <lex-input id="drilldown-search" placeholder="Search..." clearable="true" leading-icon="search"></lex-input>
            </div>
            <div id="drilldown-sort-container" class="drilldown-toolbar-group hidden">
              <label class="drilldown-toolbar-label">Sort by:</label>
              <lex-select id="drilldown-sort-select" options="[]"></lex-select>
            </div>
            <lex-btn id="drilldown-sort-order" variant="ghost" icon="true" title="Toggle sort order" data-order="asc">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path></svg>
            </lex-btn>
            <div id="drilldown-count" class="drilldown-toolbar-label" aria-live="polite"></div>
          </div>

          <!-- Filters outside the table's columns (report selectors, breakdown cards) -->
          <div id="drilldown-active-filters" class="flex flex-wrap items-center gap-2 mb-3"></div>

          <!-- Loading state (first load of a drilldown) -->
          <div id="drilldown-loading" class="flex items-center justify-center py-12">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>

          <!-- Error state (metadata or request refused) -->
          <div id="drilldown-error" class="hidden text-center py-12">
            <h3 class="mt-2 text-sm font-medium text-gray-900">Error loading data</h3>
            <p class="mt-1 text-sm text-gray-500" id="drilldown-error-message">An error occurred while fetching drilldown data.</p>
            <lex-btn id="drilldown-retry" variant="primary" size="sm" class="mt-4">Retry</lex-btn>
          </div>

          <!-- Records: columns come from the drilldown metadata -->
          <lex-table id="drilldown-table" class="drilldown-table lex-table--card" hidden
            server-paging column-filters limit="20" id-key="_row_id"
            empty-text="No data found" aria-label="Drilldown records"></lex-table>
        </div>
      </lex-modal>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  /**
   * Attach event listeners to modal elements
   */
  attachEventListeners() {
    const modal = document.getElementById('drilldown-modal');
    // The modal's own close button, overlay and Escape emit lex-close.
    modal?.addEventListener('lex-close', (e) => { if (e.target === modal) this.close(); });
    // Header actions render inside the modal; delegate the help click.
    modal?.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('#drilldown-help')) this.showHelp();
    });

    // Search: 350 ms after typing stops, reload from page 1.
    const searchInput = document.getElementById('drilldown-search');
    let searchTimer = null;
    ['lex-input', 'lex-change'].forEach((name) => {
      searchInput?.addEventListener(name, (e) => {
        const value = String((e.detail && e.detail.value) || '').trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          if (value === (this.searchQuery || '')) return;
          this.searchQuery = value;
          this.currentPage = 1;
          this.fetchData();
        }, 350);
      });
    });

    // Sort by + order button (kept in sync with header sorting in onTableSort).
    document.getElementById('drilldown-sort-select')?.addEventListener('lex-change', (e) => {
      const value = String((e.detail && e.detail.value) || '');
      if (!value || value === this.sortBy) return;
      this.sortBy = value;
      this.currentPage = 1;
      this.fetchData();
    });
    const orderBtn = document.getElementById('drilldown-sort-order');
    orderBtn?.addEventListener('click', () => {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      orderBtn.dataset.order = this.sortDirection;
      if (!this.sortBy) return;
      this.currentPage = 1;
      this.fetchData();
    });

    // Retry button
    document.getElementById('drilldown-retry')?.addEventListener('click', () => this.fetchData());

    const table = document.getElementById('drilldown-table');
    if (table) {
      // Paging, header sort and column filters: the table asks, we fetch.
      table.addEventListener('lex-query-change', (e) => {
        if (e.target === table) this.applyTableQuery(e.detail);
      });
      table.addEventListener('row-click', (e) => {
        const row = e.detail && e.detail.row;
        if (row) this.showRawData(row._raw || row);
      });
      // Buttons inside cells: lex-table's row-click ignores them.
      table.addEventListener('click', (e) => {
        const target = e.target;
        if (!target || !target.closest) return;
        const view = target.closest('[data-raw-row]');
        if (view) {
          e.stopPropagation();
          const row = (this.currentData?.rows || [])[Number(view.getAttribute('data-raw-row'))];
          if (row) this.showRawData(row);
          return;
        }
        // Column help is the trigger's native tooltip (title); a click must
        // not open the row's details.
        if (target.closest('.cell-tooltip-trigger')) e.stopPropagation();
      });
    }
  }

  /**
   * Open drilldown modal for a specific metric
   * @param {string} moduleKey - Module identifier
   * @param {string} metricKey - Metric identifier
   * @param {string} periodStart - Start date (ISO 8601)
   * @param {string} periodEnd - End date (ISO 8601)
   */
  async open(moduleKey, metricKey, options = {}) {
    const generation = ++this.contextGeneration;
    this.facetLabels.clear();
    // Initialize if not already done (lazy initialization)
    this.init();

    const { periodStart, periodEnd, organizationId, filters = {}, search = '',
      sortBy, sortDirection, viewFilter, viewType, ...extraFilters } = options;

    // Show modal (lex-modal locks the page scroll itself)
    this.modal.open = true;
    this._tableContext = null;

    // Reset state
    this.currentPage = 1;
    this.sortBy = null;
    this.sortDirection = 'asc';
    this.filters = {};
    this.searchQuery = '';
    this.activeBreakdownFilter = null;
    this.currentConfig = null;
    this.currentData = null;
    this.currentViewFilter = viewFilter;
    this.currentViewType = viewType;
    this.filters = filters;
    this.searchQuery = search;

    // Clear search input so previous drilldown's query is not persisted
    const searchInput = document.getElementById('drilldown-search');
    if (searchInput) searchInput.value = search;

    // Show loading state
    this.showLoading();

    try {
      // Fetch drilldown configuration
      const config = await this.fetchDrilldownConfig(moduleKey, metricKey);
      if (generation !== this.contextGeneration) return;
      if (!config.drilldown || typeof config.drilldown !== 'object' || Array.isArray(config.drilldown)) {
        throw new Error('Invalid drilldown metadata');
      }
      // Presentation metadata cannot replace the host-selected request context.
      for (const field of ['moduleKey', 'metricKey', 'organizationId', 'periodStart', 'periodEnd', 'extraFilters']) {
        if (Object.hasOwn(config.drilldown, field)) {
          throw new Error(`Drilldown metadata cannot override ${field}`);
        }
      }
      this.getTemporalMode(config.drilldown);
      this.currentConfig = {
        ...config.drilldown,
        moduleKey,
        metricKey,
        periodStart,
        periodEnd,
        organizationId,
        extraFilters
      };

      // A current snapshot deliberately ignores the surrounding report dates.
      // Legacy metadata still requires them. Validate before any data request.
      this.buildRequestBody('execute');

      // Update modal header
      this.modal.heading = config.drilldown.title || 'Drilldown Data';
      document.getElementById('drilldown-description').textContent = config.drilldown.description || '';

      // Set default sort if configured
      if (config.drilldown.defaultSort) {
        this.sortBy = config.drilldown.defaultSort.field;
        this.sortDirection = config.drilldown.defaultSort.direction || 'asc';
      }
      if (sortBy !== undefined) this.sortBy = sortBy;
      if (sortDirection !== undefined) this.sortDirection = sortDirection;

      // Inject custom CSS to override browser autofill styling
      this.injectCustomCSS();

      // Fetch and render data
      await this.fetchData();
    } catch (error) {
      if (generation !== this.contextGeneration) return;
      this.currentConfig = null;
      console.error('[DrilldownRenderer] Error opening drilldown:', error);
      this.showError(error.message || 'Failed to load drilldown configuration');
    }
  }

  getTemporalMode(config = this.currentConfig) {
    const mode = Object.hasOwn(config, 'temporal_mode') ? config.temporal_mode : 'report_period';
    if (mode !== 'report_period' && mode !== 'current_snapshot') {
      throw new Error('Unsupported drilldown temporal_mode');
    }
    return mode;
  }

  /** Map UI state to the endpoint shape; the server validates business scope. */
  buildRequestBody(action, { columnField, format } = {}) {
    if (!['execute', 'distinct', 'export'].includes(action)) throw new Error('Unsupported drilldown action');
    const config = this.currentConfig;
    const mode = this.getTemporalMode(config);
    const extras = config.extraFilters || {};
    const reserved = ['moduleKey', 'module_key', 'metricKey', 'metric_key', 'registryKey',
      'organizationId', 'organization_id', 'tenantId', 'tenant_id',
      'periodStart', 'periodEnd', 'period_start', 'period_end', 'startDate', 'endDate',
      'page', 'pageSize', 'page_size', 'limit', 'offset', 'filters', 'search',
      'sortBy', 'sortDirection', 'sort_by', 'sort_direction', 'format', 'temporal_mode',
      'extraFilters', '__proto__', 'constructor', 'prototype'];
    if (typeof extras !== 'object' || Array.isArray(extras)) throw new Error('Invalid drilldown extra selectors');
    for (const field of Object.keys(extras)) {
      if (reserved.includes(field)) throw new Error(`Drilldown extra selectors cannot override ${field}`);
    }
    const body = { ...extras, filters: { ...this.filters }, search: this.searchQuery || '' };
    if (mode === 'report_period') {
      if (!config.periodStart || !config.periodEnd) throw new Error('Missing periodStart or periodEnd in options');
      body.periodStart = config.periodStart;
      body.periodEnd = config.periodEnd;
    }
    if (action === 'distinct') {
      delete body.filters[columnField];
    } else {
      body.organizationId = config.organizationId;
      body.sortBy = this.sortBy;
      body.sortDirection = this.sortDirection;
      if (action === 'execute') {
        body.page = this.currentPage;
        body.pageSize = this.pageSize;
      } else {
        body.format = format;
      }
    }
    if (this.currentViewFilter) body.viewFilter = this.currentViewFilter;
    if (this.currentViewType) body.viewType = this.currentViewType;
    return body;
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
      #drilldown-modal .drilldown-body { padding: 0 4px 16px; }
      #drilldown-modal .drilldown-description { color: var(--lex-text-secondary); font-size: 14px; margin: 0; }
      #drilldown-modal .drilldown-help-btn { background: none; border: 0; color: var(--lex-text-secondary); cursor: pointer; padding: 4px; }
      #drilldown-modal .drilldown-help-btn:hover { color: var(--lex-text-accent, #3b5bdb); }
      #drilldown-modal .drilldown-toolbar {
        align-items: center; background: var(--lex-bg-primary, #fff); border: 1px solid var(--lex-border-default);
        border-radius: 8px; display: flex; flex-wrap: wrap; gap: 16px; margin: 16px 0; padding: 16px;
      }
      #drilldown-modal .drilldown-toolbar-search { flex: 1; min-width: 200px; }
      #drilldown-modal .drilldown-toolbar-group { align-items: center; display: flex; gap: 8px; }
      #drilldown-modal .drilldown-toolbar-group.hidden { display: none; }
      #drilldown-modal .drilldown-toolbar-label { color: var(--lex-text-secondary); font-size: 14px; white-space: nowrap; }
      /* Columns come from metadata: every column gets a floor and the table scrolls sideways. */
      #drilldown-table table { min-width: 960px; }
      #drilldown-table th { min-width: 120px; white-space: nowrap; }
      #drilldown-table th:last-child { min-width: 72px; width: 72px; }
      #drilldown-table .drilldown-cell { display: block; white-space: nowrap; }
      #drilldown-table .drilldown-cell--right { text-align: right; }
      #drilldown-table .drilldown-cell--center { text-align: center; }
      #drilldown-table .drilldown-view-btn {
        background: none; border: 0; color: var(--lex-text-accent, #3b5bdb); cursor: pointer;
        font-size: 13px; font-weight: 600; padding: 0; text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Close the drilldown modal
   */
  close() {
    this.contextGeneration++;
    if (!this.modal) {
      this.modal = document.getElementById('drilldown-modal');
    }

    if (this.modal && this.modal.open) {
      this.modal.open = false;
    }
    this._tableContext = null;
    this.currentConfig = null;
    this.currentData = null;
    this.activeBreakdownFilter = null;

    console.log('[DrilldownRenderer] Modal closed, state cleared');
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
    const context = this.currentConfig;
    const generation = this.contextGeneration;
    const requestGeneration = ++this.dataGeneration;
    const isCurrent = () => generation === this.contextGeneration
      && context === this.currentConfig && requestGeneration === this.dataGeneration;

    this.showLoading();

    try {
      let result;
      const requestBody = this.buildRequestBody('execute');

      // Use global api helper instead of fetch to support Electron backend URLs
      // Check both window.api and global api (defined in api.js)
      const apiClient = window.api || (typeof api !== 'undefined' ? api : null);

      if (apiClient) {
        console.log('[DrilldownRenderer] Executing drilldown request:', {
          moduleKey: this.currentConfig.moduleKey,
          metricKey: this.currentConfig.metricKey,
          requestBody
        });

        const response = await apiClient.post(
          `/api/v1/modules/${context.moduleKey}/metrics/${context.metricKey}/drilldown/execute`,
          requestBody
        );
        result = response;

        console.log('[DrilldownRenderer] Received response:', result);
      } else {
        // Fallback to fetch for non-Electron environments
        const response = await fetch(
          `/api/v1/modules/${context.moduleKey}/metrics/${context.metricKey}/drilldown/execute`,
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

        console.log('[DrilldownRenderer] Received response (fetch):', result);
      }

      if (!isCurrent()) return;
      console.log('[DrilldownRenderer] Setting currentData:', result.data);
      console.log('[DrilldownRenderer] Data structure check:', {
        hasData: !!result.data,
        hasRows: !!(result.data && result.data.rows),
        rowsLength: result.data && result.data.rows ? result.data.rows.length : 0,
        hasSummary: !!(result.data && result.data.summary),
        summaryKeys: result.data && result.data.summary ? Object.keys(result.data.summary) : [],
        hasInsights: !!(result.data && result.data.insights),
        insightsLength: result.data && result.data.insights ? result.data.insights.length : 0
      });

      this.currentData = result.data;

      // Render the data
      this.render();
    } catch (error) {
      if (!isCurrent()) return;
      console.error('[DrilldownRenderer] Error fetching drilldown data:', error);
      this.showError(error.message || 'Failed to load drilldown data');
    }
  }

  /**
   * Render the drilldown data
   */
  render() {
    console.log('[DrilldownRenderer] render() called');
    console.log('[DrilldownRenderer] Render checks:', {
      hasCurrentData: !!this.currentData,
      hasCurrentConfig: !!this.currentConfig,
      currentDataType: typeof this.currentData,
      currentConfigType: typeof this.currentConfig
    });

    if (!this.currentData || !this.currentConfig) {
      console.warn('[DrilldownRenderer] Missing data or config, aborting render');
      return;
    }

    // Hide loading state
    document.getElementById('drilldown-loading')?.classList.add('hidden');
    document.getElementById('drilldown-error')?.classList.add('hidden');

    // Render advanced features
    this.renderExportButtons();

    // Render insights first (even if no rows)
    console.log('[DrilldownRenderer] Checking insights:', {
      insightsEnabled: this.currentConfig.insights?.enabled,
      hasInsightsData: !!this.currentData.insights,
      insightsLength: this.currentData.insights ? this.currentData.insights.length : 0
    });

    if (this.currentConfig.insights?.enabled && this.currentData.insights) {
      console.log('[DrilldownRenderer] Rendering insights...');
      this.renderInsights();
    }

    // Render summary (even if no rows)
    console.log('[DrilldownRenderer] Checking summary:', {
      summaryEnabled: this.currentConfig.summary?.enabled,
      hasSummaryData: !!this.currentData.summary,
      summaryKeys: this.currentData.summary ? Object.keys(this.currentData.summary) : []
    });

    if (this.currentConfig.summary?.enabled && this.currentData.summary) {
      console.log('[DrilldownRenderer] Rendering summary...');
      this.renderSummary();
    }

    // Render v2 breakdown cards (between summary and table) when the
    // executor includes data.breakdown_cards. Missing or empty array hides
    // the section entirely per the drilldown v2 spec.
    this.renderBreakdownCards();

    // Rows, the empty state and paging live in the lex-table.
    this.renderTable();

    console.log('[DrilldownRenderer] render() complete');
  }

  /**
   * Render insights/alerts based on data patterns
   */
  renderInsights() {
    console.log('[DrilldownRenderer] renderInsights() called');
    const container = document.getElementById('drilldown-insights');

    console.log('[DrilldownRenderer] Insights data check:', {
      hasInsights: !!this.currentData.insights,
      isArray: Array.isArray(this.currentData.insights),
      length: this.currentData.insights ? this.currentData.insights.length : 0,
      insights: this.currentData.insights
    });

    // Check if insights data exists
    if (!this.currentData.insights || !Array.isArray(this.currentData.insights) || this.currentData.insights.length === 0) {
      console.log('[DrilldownRenderer] No insights to render, hiding container');
      container.classList.add('hidden');
      return;
    }

    console.log('[DrilldownRenderer] Rendering', this.currentData.insights.length, 'insights');

    // Show container
    container.classList.remove('hidden');

    // Render each insight as a card
    const insightsHTML = this.currentData.insights.map(insight => {
      // Determine background and border colors based on insight type
      const colorClasses = this.getInsightColorClasses(insight.type);

      // Substitute template variables in message
      const message = this.substituteInsightTemplate(insight.message, insight.data);

      // Render action if provided
      const actionHTML = insight.action
        ? `<div class="mt-2">
             <p class="${colorClasses.text}"><strong>What to do:</strong> ${this.escapeHtml(insight.action)}</p>
           </div>`
        : '';

      // Map insight type to a default SVG icon when the JSON rule doesn't
      // ship its own. Avoids rendering literal "undefined" in the badge slot.
      const iconHTML = insight.icon
        ? `<span class="text-2xl">${this.escapeHtml(insight.icon)}</span>`
        : this._defaultInsightIcon(insight.type, colorClasses);

      return `
        <div class="rounded-md ${colorClasses.bg} p-4 border-l-4 ${colorClasses.border}">
          <div class="flex">
            <div class="flex-shrink-0">
              ${iconHTML}
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium ${colorClasses.title}">${this.escapeHtml(insight.title)}</h3>
              <div class="mt-2 text-sm ${colorClasses.text}">
                <p>${this.escapeHtml(message)}</p>
              </div>
              ${actionHTML}
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = insightsHTML;
  }

  /**
   * Get Tailwind CSS color classes for insight type
   * @param {string} type - Insight type (alert, warning, success, info)
   * @returns {Object} - Object with bg, border, title, and text color classes
   */
  getInsightColorClasses(type) {
    const colorMap = {
      alert: {
        bg: 'bg-red-50',
        border: 'border-red-400',
        title: 'text-red-800',
        text: 'text-red-700'
      },
      warning: {
        bg: 'bg-yellow-50',
        border: 'border-yellow-400',
        title: 'text-yellow-800',
        text: 'text-yellow-700'
      },
      success: {
        bg: 'bg-green-50',
        border: 'border-green-400',
        title: 'text-green-800',
        text: 'text-green-700'
      },
      info: {
        bg: 'bg-blue-50',
        border: 'border-blue-400',
        title: 'text-blue-800',
        text: 'text-blue-700'
      }
    };

    return colorMap[type] || colorMap.info;
  }

  /**
   * Substitute template variables in insight message
   * Supports {{field}} and {{field | currency}} and {{field | number}}
   * @param {string} template - Message template with {{variables}}
   * @param {Object} data - Data object containing field values
   * @returns {string} - Message with substituted values
   */
  substituteInsightTemplate(template, data) {
    if (!template || !data) return template || '';

    let result = template;

    // Match {{variable}} or {{variable | format}} patterns
    const matches = template.match(/\{\{([^}]+)\}\}/g);

    if (matches) {
      matches.forEach(match => {
        // Extract field name and optional format filter
        const content = match.replace(/\{\{|\}\}/g, '').trim();
        const parts = content.split('|').map(p => p.trim());
        const fieldName = parts[0];
        const formatFilter = parts[1]; // 'currency', 'number', or undefined

        const value = data[fieldName];

        // Format the value based on filter
        let formattedValue;
        if (formatFilter === 'currency') {
          formattedValue = this.formatValue(value, { type: 'currency', prefix: '$', decimals: 0 });
        } else if (formatFilter === 'number') {
          formattedValue = this.formatValue(value, { type: 'number', decimals: 1 });
        } else {
          // No format filter - use raw value or format as number if numeric
          formattedValue = typeof value === 'number'
            ? this.formatValue(value, { type: 'number', decimals: 1 })
            : (value || '');
        }

        // Replace the match with formatted value
        result = result.replace(match, formattedValue);
      });
    }

    return result;
  }

  /**
   * Render summary statistics (detects structure and delegates)
   */
  renderSummary() {
    const intakeSummary = window.OpportunityIntakePresentation?.renderDrilldownSummary(this.currentData, this.currentConfig);
    if (intakeSummary != null) {
      const container = document.getElementById('drilldown-summary-container');
      const summary = document.getElementById('drilldown-summary');
      container.classList.remove('hidden');
      summary.className = '';
      summary.innerHTML = intakeSummary;
      return;
    }
    const acquisitionSummary = window.AcquisitionSourcePresentation?.renderDrilldownSummary(this.currentData, this.currentConfig);
    if (acquisitionSummary != null) {
      const container = document.getElementById('drilldown-summary-container');
      const summary = document.getElementById('drilldown-summary');
      container.classList.remove('hidden');
      summary.className = '';
      summary.innerHTML = acquisitionSummary;
      return;
    }
    console.log('[DrilldownRenderer] renderSummary() called');
    console.log('[DrilldownRenderer] Summary config check:', {
      hasSections: !!(this.currentConfig.summary?.sections),
      hasFields: !!(this.currentConfig.summary?.fields),
      summaryConfig: this.currentConfig.summary
    });
    console.log('[DrilldownRenderer] Summary data:', this.currentData.summary);

    // Check if summary.sections exists (new structure)
    if (this.currentConfig.summary?.sections) {
      console.log('[DrilldownRenderer] Using sectioned summary layout');
      this.renderSectionedSummary();
    } else if (this.currentConfig.summary?.fields) {
      console.log('[DrilldownRenderer] Using flat summary layout (legacy)');
      // Render flat layout (backwards compatibility)
      this.renderFlatSummary();
    } else {
      console.log('[DrilldownRenderer] No summary configured, hiding container');
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

    // Reset to page 1 and re-fetch (the server filters)
    this.currentPage = 1;
    this.fetchData();
  }

  /**
   * Render the v2 breakdown_cards row between summary and table.
   *
   * Contract: response.data.breakdown_cards is an array of objects matching
   * the drilldown v2 spec:
   *   { key, title, value, count, description, filter_column, filter_value }
   *
   * Rules:
   *   - Missing or empty array hides the section entirely.
   *   - Max 6 cards rendered (extras dropped with a console warning).
   *   - Cards with non-null filter_column AND filter_value are clickable
   *     and participate in the single-card filter toggle.
   *   - Cards with either null render as "is-static" (no hover/cursor).
   *   - The active card is highlighted via the "is-active" class and
   *     reflects this.activeBreakdownFilter.
   *   - No emojis, no em or en dashes in card text per spec.
   */
  renderBreakdownCards() {
    const container = document.getElementById('drilldown-breakdown-cards-container');
    const grid = document.getElementById('drilldown-breakdown-cards');

    if (!container || !grid) {
      return;
    }

    const cards = this.currentData && Array.isArray(this.currentData.breakdown_cards)
      ? this.currentData.breakdown_cards
      : null;

    // Spec: missing or empty -> do not render the section
    if (!cards || cards.length === 0) {
      container.classList.add('hidden');
      grid.innerHTML = '';
      return;
    }

    // Cap at 6 visible cards
    const MAX_VISIBLE_CARDS = 6;
    let visibleCards = cards;
    if (cards.length > MAX_VISIBLE_CARDS) {
      console.warn(
        `[DrilldownRenderer] breakdown_cards returned ${cards.length} rows; capping display at ${MAX_VISIBLE_CARDS}`
      );
      visibleCards = cards.slice(0, MAX_VISIBLE_CARDS);
    }

    const active = this.activeBreakdownFilter;

    const cardsHTML = visibleCards.map((card, idx) => {
      const filterColumn = card.filter_column != null ? String(card.filter_column) : null;
      const filterValue = card.filter_value != null ? String(card.filter_value) : null;
      const clickable = Boolean(filterColumn && filterValue);

      const isActive = Boolean(
        clickable && active && active.column === filterColumn && active.value === filterValue
      );

      const formattedValue = this.formatBreakdownCardValue(card.value, card.title);
      const formattedCount = this.formatBreakdownCardCount(card.count);

      const stateClass = clickable
        ? (isActive ? 'is-clickable is-active' : 'is-clickable')
        : 'is-static';

      const role = clickable ? 'button' : 'group';
      const tabIndex = clickable ? '0' : '-1';
      const ariaPressed = clickable ? `aria-pressed="${isActive ? 'true' : 'false'}"` : '';

      // Persist filter data on the element for the click + keydown handlers
      const dataAttrs = clickable
        ? `data-clickable="true" data-filter-column="${this.escapeHtml(filterColumn)}" data-filter-value="${this.escapeHtml(filterValue)}" data-card-key="${this.escapeHtml(card.key != null ? String(card.key) : '')}"`
        : 'data-clickable="false"';

      const countHTML = card.count != null && Number.isFinite(Number(card.count)) && Number(card.count) !== 0
        ? `<div class="drilldown-breakdown-card__count">${formattedCount}</div>`
        : '';

      const descriptionHTML = card.description
        ? `<div class="drilldown-breakdown-card__description">${this.escapeHtml(String(card.description))}</div>`
        : '';

      return `
        <div class="drilldown-breakdown-card ${stateClass}"
             role="${role}"
             tabindex="${tabIndex}"
             ${ariaPressed}
             ${dataAttrs}
             data-card-index="${idx}">
          <span class="drilldown-breakdown-card__active-badge">Active filter</span>
          <div class="drilldown-breakdown-card__title">${this.escapeHtml(String(card.title != null ? card.title : ''))}</div>
          <div class="drilldown-breakdown-card__value">${formattedValue}</div>
          ${countHTML}
          ${descriptionHTML}
        </div>
      `;
    }).join('');

    grid.innerHTML = cardsHTML;
    container.classList.remove('hidden');

    // Attach click + keyboard handlers to clickable cards only. The grid is
    // re-rendered on every fetchData(), so wiring listeners per-render is
    // intentional (innerHTML replacement discards previous listeners).
    grid.querySelectorAll('.drilldown-breakdown-card.is-clickable').forEach(el => {
      el.addEventListener('click', () => this.onBreakdownCardClick(el));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.onBreakdownCardClick(el);
        }
      });
    });
  }

  /**
   * Handle a click (or Enter/Space) on a clickable breakdown card.
   *
   * Behavior:
   *   - Clicking the currently-active card REMOVES that filter from
   *     this.filters and clears this.activeBreakdownFilter.
   *   - Clicking any other card SETS the filter (and clears the prior
   *     breakdown filter, since only one can be active at a time).
   *   - In both cases pagination resets to page 1 and fetchData() re-fires
   *     the /drilldown/execute request with the merged filters payload.
   */
  onBreakdownCardClick(cardEl) {
    if (!cardEl) return;

    const column = cardEl.getAttribute('data-filter-column');
    const value = cardEl.getAttribute('data-filter-value');
    const key = cardEl.getAttribute('data-card-key') || '';

    if (!column || !value) {
      console.warn('[DrilldownRenderer] Breakdown card clicked without filter column/value');
      return;
    }

    const active = this.activeBreakdownFilter;
    const isAlreadyActive = active && active.column === column && active.value === value;

    if (isAlreadyActive) {
      // Toggle off: remove the filter entirely
      delete this.filters[column];
      this.activeBreakdownFilter = null;
      console.log('[DrilldownRenderer] Breakdown filter cleared:', { column, value, key });
    } else {
      // Swap or set: only one breakdown filter active at a time.
      // Clear any prior breakdown filter column first.
      if (active && active.column && active.column !== column) {
        delete this.filters[active.column];
      }
      // Drop any stale value on this column from a prior click.
      delete this.filters[column];

      this.filters[column] = value;
      this.activeBreakdownFilter = { column, value, key };
      console.log('[DrilldownRenderer] Breakdown filter applied:', this.activeBreakdownFilter);
    }

    // Reset to page 1 and re-fetch so both the table and the cards refresh
    // against the new filter scope.
    this.currentPage = 1;
    this.fetchData();
  }

  /**
   * Format the primary value on a breakdown card.
   *
   * Heuristic (since the v2 spec only ships a raw number):
   *   - Drilldown title or metric key carries a money/percent hint (best signal)
   *   - Card title contains "rate" or "%" -> percent
   *   - Card title contains currency-shaped keywords -> currency
   *   - Card title contains count-shaped keywords -> integer
   *   - Otherwise: fall back to drilldown-level format if known, else default
   *     to integer for whole numbers and 1 decimal for fractions.
   */
  formatBreakdownCardValue(value, title) {
    if (value === null || value === undefined || value === '') {
      return '<span class="text-gray-400">--</span>';
    }

    const num = Number(value);
    if (!Number.isFinite(num)) {
      return this.escapeHtml(String(value));
    }

    const titleLower = (title || '').toString().toLowerCase();

    // Percent hints (card-level wins)
    if (/(\brate\b|%|percent|percentage)/.test(titleLower)) {
      return this.formatValue(num, { type: 'percent', decimals: 1 });
    }

    // Card-level currency hints
    if (/(\$|amount|balance|revenue|invoice|invoiced|paid|outstanding|\bar\b|aging|owed|due|cost|expense|fees?)/.test(titleLower)) {
      return this.formatValue(num, { type: 'currency', prefix: '$', decimals: 2 });
    }

    // Card-level count hints
    if (/(\bcount\b|invoices|matters|leads|opportunities|contacts|cases|clients|records|rows|items|files|documents|users)/.test(titleLower)) {
      return this.formatValue(num, { type: 'number', decimals: 0 });
    }

    // Drilldown-level fallback: inspect the parent metric's title or key for
    // a money or percent signal. Many breakdown card titles are just bucket
    // labels (eg "Current (0 to 30 days)") that don't reveal the unit on
    // their own.
    const drilldownTitle = (this.currentConfig?.title || '').toLowerCase();
    const metricKey = (this.currentConfig?.metricKey || '').toLowerCase();
    const drilldownContext = `${drilldownTitle} ${metricKey}`;

    if (/(\brate\b|%|percent|percentage|conversion)/.test(drilldownContext)) {
      return this.formatValue(num, { type: 'percent', decimals: 1 });
    }
    if (/(balance|revenue|invoice|invoiced|paid|outstanding|\bar\b|aging|owed|due|cost|expense|fees?|amount|\$)/.test(drilldownContext)) {
      return this.formatValue(num, { type: 'currency', prefix: '$', decimals: 2 });
    }

    // Final default: integer for whole numbers, 1 decimal for fractions
    const isWhole = Number.isInteger(num);
    return this.formatValue(num, { type: 'number', decimals: isWhole ? 0 : 1 });
  }

  /**
   * Format the secondary count line. Returns "N items" style text. The
   * caller decides whether to render it at all.
   */
  formatBreakdownCardCount(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n === 0) {
      return '';
    }
    const formatted = n.toLocaleString('en-US');
    return n === 1 ? `${formatted} record` : `${formatted} records`;
  }

  /**
   * Default SVG icon for an insight when the JSON rule doesn't ship its
   * own .icon string. Maps insight type to a neutral pictogram so the
   * card never renders the literal text "undefined".
   */
  _defaultInsightIcon(type, colorClasses) {
    const stroke = (colorClasses && colorClasses.title)
      ? colorClasses.title.replace('text-', 'text-').replace('-800', '-600')
      : 'text-gray-600';
    let path;
    switch (type) {
      case 'success':
        path = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />';
        break;
      case 'alert':
      case 'error':
        path = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />';
        break;
      case 'warning':
        path = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
        break;
      case 'info':
      default:
        path = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
    }
    return `<svg class="h-6 w-6 ${stroke}" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">${path}</svg>`;
  }



  /**
   * Fetch DISTINCT values + counts for one column from the drilldown's
   * current row set. Body filters out the column being filtered so the
   * popover always shows the full option set for that column (not just
   * the values currently passing its own active filter).
   *
   * Returns { values: [{value, count}], hasMore, error? }. Never throws;
   * the caller renders an empty list with an error message on failure.
   */
  async fetchDistinctValues(columnField) {
    if (!this.currentConfig) {
      return { values: [], hasMore: false, error: 'No drilldown context' };
    }
    if (this.currentConfig.columns?.find(column => column.field === columnField)?.filterable === false) {
      return { values: [], hasMore: false, error: 'Filtering is not supported for this column' };
    }

    const endpoint = `/api/v1/modules/${this.currentConfig.moduleKey}/metrics/${this.currentConfig.metricKey}/drilldown/distinct/${encodeURIComponent(columnField)}`;

    try {
      const requestBody = this.buildRequestBody('distinct', { columnField });
      const apiClient = window.api || (typeof api !== 'undefined' ? api : null);
      let result;
      if (apiClient) {
        result = await apiClient.post(endpoint, requestBody);
      } else {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.getAuthToken()}`,
          },
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        result = await response.json();
      }

      const data = (result && result.data) ? result.data : result;
      return {
        values: Array.isArray(data?.values) ? data.values : [],
        hasMore: !!data?.has_more,
      };
    } catch (error) {
      console.error('[DrilldownRenderer] fetchDistinctValues failed:', error);
      return { values: [], hasMore: false, error: error.message || 'Failed to load values' };
    }
  }



  /**
   * Render the chips for filters on fields that are not table columns
   * (report selectors passed to open(), breakdown cards on hidden fields).
   * Column filters show in the table's own header menus.
   */
  renderActiveFilters() {
    const container = document.getElementById('drilldown-active-filters');
    if (!container || !this.currentConfig) return;
    const fields = new Set(this.tableColumns().map(col => col.field));
    const entries = Object.entries(this.filters || {}).filter(([field]) => !fields.has(field));
    if (entries.length === 0) {
      container.innerHTML = '';
      return;
    }
    const chips = entries.map(([field, value]) => {
      const values = (Array.isArray(value) ? value : [value]).map(v => this.facetLabels.get(field)?.get(String(v)) ?? String(v));
      const display = values.length <= 2 ? values.join(', ') : `${values.length} selected`;
      const label = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.humanizeLabel)
        ? window.Lex.Utils.humanizeLabel(field) : field;
      return `<span class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 border border-indigo-200">
        <span>${this.escapeHtml(label)}: ${this.escapeHtml(display)}</span>
        <button type="button" data-clear-filter="${this.escapeHtml(field)}" class="text-indigo-500 hover:text-indigo-800" aria-label="Clear filter">&times;</button>
      </span>`;
    }).join('');
    container.innerHTML = chips;
    container.querySelectorAll('[data-clear-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const field = btn.dataset.clearFilter;
        delete this.filters[field];
        if (this.activeBreakdownFilter && this.activeBreakdownFilter.column === field) this.activeBreakdownFilter = null;
        this.currentPage = 1;
        this.renderActiveFilters();
        this.fetchData();
      });
    });
  }

  /**
   * Load the Lex components the drilldown needs when the host page lacks
   * them (module-execution.html and reporting load different sets).
   * @returns {Promise<void>}
   */
  ensureComponents() {
    if (typeof window === 'undefined' || !window.customElements || typeof document === 'undefined' || !DRILLDOWN_SCRIPT_BASE) {
      return Promise.resolve();
    }
    const needed = [
      ['lex-table', 'lex/components/data/lex-table.js'],
      ['lex-input', 'lex/components/form/lex-input.js'],
      ['lex-select', 'lex/components/form/lex-select.js'],
      ['lex-btn', 'lex/components/foundation/lex-btn.js'],
      ['lex-badge', 'lex/components/foundation/lex-badge.js']
    ].filter(([tag]) => !window.customElements.get(tag));
    const load = (path) => new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = DRILLDOWN_SCRIPT_BASE + path;
      script.onload = () => resolve();
      script.onerror = () => { console.error('[DrilldownRenderer] Could not load', path); resolve(); };
      document.head.appendChild(script);
    });
    let chain = Promise.resolve();
    if (needed.some(([tag]) => tag === 'lex-table') && !(window.Lex && window.Lex.withDataSource)) {
      chain = chain.then(() => load('lex/lex.data.js'));
    }
    needed.forEach(([, path]) => { chain = chain.then(() => load(path)); });
    return chain;
  }

  /** The metadata's columns that carry a field. */
  tableColumns(config = this.currentConfig) {
    return ((config && config.columns) || []).filter(col => col && col.field);
  }

  /**
   * Table attributes for the current drilldown: one column per metadata
   * column plus a blank-labelled actions column (no header filter).
   * Pure, for unit tests.
   */
  static tableAttributes(columns) {
    const cols = (columns || []).filter(col => col && col.field);
    const label = (col) => String(col.header || col.field).replace(/,/g, ' ');
    return {
      columns: cols.map(col => col.field).concat('_actions').join(','),
      labels: cols.map(label).concat('').join(','),
      sortableColumns: cols.filter(col => col.sortable !== false).map(col => col.field).join(',')
    };
  }

  /**
   * Rows keep the record's raw values; formatting happens in the renderers.
   * Pure, for unit tests.
   */
  static tableRows(rows, page, pageSize) {
    const offset = (Math.max(1, Number(page) || 1) - 1) * (Number(pageSize) || 20);
    return (rows || []).map((row, index) => Object.assign({}, row, {
      _row_id: String(offset + index),
      _row_index: index,
      _actions: '',
      _raw: row
    }));
  }

  /**
   * Turn the table's column filters into the drilldown body's filters
   * ({ field: [values] }), keeping filters on fields that are not columns
   * (report selectors, breakdown cards). Pure, for unit tests.
   */
  static mergeTableFilters(current, tableFilters, columnFields) {
    const merged = {};
    const fields = new Set(columnFields || []);
    Object.keys(current || {}).forEach((field) => {
      if (!fields.has(field)) merged[field] = current[field];
    });
    Object.keys(tableFilters || {}).forEach((field) => {
      if (!fields.has(field)) return;
      const filter = tableFilters[field];
      const raw = filter && filter.value !== undefined ? filter.value : filter;
      const values = (Array.isArray(raw) ? raw : [raw])
        .map(v => String(v == null ? '' : v).trim()).filter(Boolean);
      if (values.length) merged[field] = values;
    });
    return merged;
  }

  /** The body's filters on table columns, in lex-table's shape. Pure. */
  static tableFilterState(filters, columnFields) {
    const state = {};
    const fields = new Set(columnFields || []);
    Object.keys(filters || {}).forEach((field) => {
      if (!fields.has(field)) return;
      const raw = filters[field];
      const values = (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean);
      if (values.length) state[field] = { operator: 'in', value: values };
    });
    return state;
  }

  /**
   * Header filter options from the distinct endpoint's values. Metadata
   * enum labels win; label-style columns (badge / enum) are capitalised;
   * other values display as stored. Pure, for unit tests.
   */
  static filterOptionsFor(col, values) {
    const labels = {};
    if (Array.isArray(col && col.filter && col.filter.options)) {
      col.filter.options.forEach((opt) => {
        if (opt != null) labels[String(opt.value)] = opt.label != null ? String(opt.label) : String(opt.value);
      });
    }
    const labelStyle = col && (col.type === 'badge' || (col.filter && col.filter.type === 'enum'));
    const capital = (text) => {
      const utils = typeof window !== 'undefined' && window.Lex && window.Lex.Utils;
      if (utils && typeof utils.humanizeLabel === 'function') return utils.humanizeLabel(text);
      const t = String(text).split('_').join(' ');
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    };
    return (values || []).filter(v => v && v.value !== null && v.value !== undefined && v.value !== '').map((v) => {
      const raw = String(v.value);
      let label = typeof v.label === 'string' ? v.label : (labels[raw] !== undefined ? labels[raw] : raw);
      if (labelStyle && typeof v.label !== 'string' && labels[raw] === undefined) label = capital(raw);
      return { value: raw, label };
    });
  }

  /**
   * Point the table at the current drilldown (columns, renderers, header
   * filters) once per open.
   */
  configureTable(table) {
    if (!table || this._tableContext === this.currentConfig) return;
    this._tableContext = this.currentConfig;
    const cols = this.tableColumns();
    const attrs = DrilldownRenderer.tableAttributes(cols);
    table.setAttribute('columns', attrs.columns);
    table.setAttribute('labels', attrs.labels);
    table.setAttribute('sortable-columns', attrs.sortableColumns);

    const renderers = {};
    cols.forEach((col) => {
      renderers[col.field] = (value) => {
        const formatted = col.type === 'badge'
          ? this.renderBadgeColumn(value, col)
          : this.formatValue(value, col.format || { type: col.type });
        const tip = col.tooltip
          ? `<button type="button" class="cell-tooltip-trigger inline-block ml-1 align-middle text-gray-400 hover:text-gray-600" title="${this.escapeHtml(col.tooltip)}" aria-label="${this.escapeHtml(col.tooltip)}"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>`
          : '';
        return `<span class="drilldown-cell drilldown-cell--${this.escapeHtml(col.align || 'left')}">${formatted}${tip}</span>`;
      };
    });
    renderers._actions = (_value, row) =>
      `<button type="button" class="drilldown-view-btn" data-raw-row="${row ? row._row_index : ''}" title="View complete row data">View</button>`;
    table.setCellRenderers(renderers);
    table.setColumnFilterOptions({});
    this.loadColumnFilterOptions(table, cols);
  }

  /**
   * Every filterable column gets a header filter, its values from the
   * drilldown's distinct endpoint (one request per column, once per open).
   */
  loadColumnFilterOptions(table, cols) {
    const context = this.currentConfig;
    const options = {};
    const filterable = cols.filter(col => col.filterable !== false);
    Promise.all(filterable.map(col => this.fetchDistinctValues(col.field).then(({ values }) => {
      const list = DrilldownRenderer.filterOptionsFor(col, values);
      if (list.length) options[col.field] = { options: list };
    }))).then(() => {
      if (context !== this.currentConfig || this._tableContext !== context) return;
      table.setColumnFilterOptions(options);
    });
  }

  /**
   * The table asked for a page, a sort or a filter: copy it into the
   * request state and fetch.
   */
  applyTableQuery(query) {
    if (!query || !this.currentConfig) return;
    const fields = this.tableColumns().map(col => col.field);
    this.currentPage = Number(query.page) || 1;
    if (query.limit) this.pageSize = Number(query.limit) || this.pageSize;
    if (query.sortBy) {
      this.sortBy = query.sortBy;
      this.sortDirection = query.sortDir === 'desc' ? 'desc' : 'asc';
    }
    this.filters = DrilldownRenderer.mergeTableFilters(this.filters, query.filters, fields);
    this.renderActiveFilters();
    this.fetchData();
  }

  /**
   * Hand the current page to the table, after syncing its sort, filters
   * and page from the request state (outside filters, view toggles and
   * breakdown cards change that state directly).
   */
  renderTable() {
    const table = document.getElementById('drilldown-table');
    if (!table || typeof table.setServerData !== 'function') {
      if (typeof window !== 'undefined' && window.customElements && table) {
        window.customElements.whenDefined('lex-table').then(() => this.render());
      }
      return;
    }
    this.configureTable(table);
    const fields = this.tableColumns().map(col => col.field);
    const pagination = (this.currentData && this.currentData.pagination) || {};
    const total = Number(pagination.totalRecords !== undefined ? pagination.totalRecords : pagination.total);
    const rows = (this.currentData && this.currentData.rows) || [];
    const tableFilters = DrilldownRenderer.tableFilterState(this.filters, fields);
    const filtered = Boolean(this.searchQuery) || Object.keys(tableFilters).length > 0;

    table.restoreQuery({
      search: this.searchQuery || '',
      sortBy: this.sortBy || undefined,
      sortDir: this.sortDirection,
      filters: tableFilters,
      page: this.currentPage,
      limit: this.pageSize
    });
    table.emptyText = filtered
      ? 'No matching records. Try a different search or clear the filters.'
      : 'No data found';
    table.hidden = false;
    table.setServerData(DrilldownRenderer.tableRows(rows, this.currentPage, this.pageSize), {
      page: Number(pagination.page) || this.currentPage,
      limit: this.pageSize,
      total: Number.isFinite(total) ? total : rows.length,
      total_pages: pagination.totalPages
    });

    const count = document.getElementById('drilldown-count');
    if (count) {
      const n = Number.isFinite(total) ? total : rows.length;
      count.textContent = `${n} ${n === 1 ? 'record' : 'records'}`;
    }
    this.renderSortOptions();
    this.renderActiveFilters();
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
        if (format.dateFormat) {
          return new Date(value).toLocaleDateString('en-US', Object.assign({ timeZone: getOrganizationTimezone() }, format.dateFormat));
        }
        return window.Lex?.Utils?.formatDate ? this.escapeHtml(window.Lex.Utils.formatDate(value)) : formatDate(value);

      case 'datetime':
        if (format.dateFormat) {
          return new Date(value).toLocaleString('en-US', Object.assign({ timeZone: getOrganizationTimezone() }, format.dateFormat));
        }
        return window.Lex?.Utils?.formatDateTime ? this.escapeHtml(window.Lex.Utils.formatDateTime(value)) : formatDateTime(value);

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
   * Render inline markdown text to HTML (for single lines, headings, etc.)
   * Falls back to escapeHtml if marked library is not available
   */
  renderMarkdownInline(text) {
    // Handle non-string values
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);

    // Drilldown content is LLM/BI-generated and untrusted: use the shared
    // hardened parser (raw HTML escaped, links protocol-restricted, images
    // as alt text) instead of raw marked.
    const safe = window.Lex && window.Lex.Utils && window.Lex.Utils.renderMarkdownSafe
      ? window.Lex.Utils.renderMarkdownSafe(text, { inline: true })
      : null;
    if (safe !== null) return safe;

    // Fallback: escape HTML if the safe parser is not available
    return this.escapeHtml(text);
  }

  /**
   * Render block-level markdown text to HTML (for paragraphs, lists, multi-line content)
   * Falls back to escapeHtml if marked library is not available
   */
  renderMarkdownBlock(text) {
    // Handle non-string values
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);

    // Drilldown content is LLM/BI-generated and untrusted: use the shared
    // hardened parser (raw HTML escaped, links protocol-restricted, images
    // as alt text) instead of raw marked.
    const safe = window.Lex && window.Lex.Utils && window.Lex.Utils.renderMarkdownSafe
      ? window.Lex.Utils.renderMarkdownSafe(text)
      : null;
    if (safe !== null) {
      // Remove outer <p> tags if present (for cleaner rendering in our context)
      // But keep inner structure like lists, line breaks, bold, etc.
      let html = safe.trim();
      if (html.startsWith('<p>') && html.endsWith('</p>') && html.split('<p>').length === 2) {
        html = html.slice(3, -4); // Remove outer <p></p> only
      }
      return html;
    }

    // Fallback: escape HTML and preserve line breaks if the safe parser is
    // not available
    return this.escapeHtml(text).replace(/\n/g, '<br>');
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

  showLoading() {
    // The first load of a drilldown shows the spinner; later loads keep the
    // table on screen (its pager and header stay usable).
    const table = document.getElementById('drilldown-table');
    const firstLoad = !table || this._tableContext !== this.currentConfig || !this.currentConfig;
    document.getElementById('drilldown-loading')?.classList.toggle('hidden', !firstLoad);
    if (firstLoad && table) table.hidden = true;
    document.getElementById('drilldown-error')?.classList.add('hidden');

    const count = document.getElementById('drilldown-count');
    if (count && firstLoad) count.textContent = '';

    // Hide summary and insights containers during loading
    const summaryContainer = document.getElementById('drilldown-summary-container');
    const insightsContainer = document.getElementById('drilldown-insights');
    const breakdownContainer = document.getElementById('drilldown-breakdown-cards-container');
    if (summaryContainer) summaryContainer.classList.add('hidden');
    if (insightsContainer) insightsContainer.classList.add('hidden');
    if (breakdownContainer) breakdownContainer.classList.add('hidden');
  }

  /**
   * Show error state
   */
  showError(message) {
    document.getElementById('drilldown-loading')?.classList.add('hidden');
    const table = document.getElementById('drilldown-table');
    if (table) table.hidden = true;
    document.getElementById('drilldown-error')?.classList.remove('hidden');
    const text = document.getElementById('drilldown-error-message');
    if (text) text.textContent = message;
  }

  /** A failure the user should see (export): Lex.Modal, never window.alert. */
  notifyError(title, message) {
    const lex = typeof window !== 'undefined' ? window.Lex : null;
    if (lex && lex.Toast && typeof lex.Toast.error === 'function') {
      lex.Toast.error(message);
    } else if (lex && lex.Modal && typeof lex.Modal.alertAsync === 'function') {
      lex.Modal.alertAsync(title, message);
    } else {
      console.error('[DrilldownRenderer]', title, message);
    }
  }

  /**
   * Pagination is the table's own (lex-query-change). These stay for
   * callers that page programmatically.
   */
  prevPage() {
    if (this.currentData?.pagination?.hasPreviousPage) {
      this.currentPage--;
      this.fetchData();
    }
  }

  nextPage() {
    if (this.currentData?.pagination?.hasNextPage) {
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

  renderSortOptions() {
    const container = document.getElementById('drilldown-sort-container');
    const select = document.getElementById('drilldown-sort-select');
    const order = document.getElementById('drilldown-sort-order');
    if (!container || !select || !this.currentConfig) return;
    // Sort by lists the sortable columns with their header labels.
    const options = this.tableColumns()
      .filter(col => col.sortable !== false)
      .map(col => ({ value: col.field, label: String(col.header || col.field) }));
    container.classList.toggle('hidden', options.length === 0);
    if (order) {
      order.hidden = options.length === 0;
      order.dataset.order = this.sortDirection === 'desc' ? 'desc' : 'asc';
    }
    const json = JSON.stringify(options);
    if (select.getAttribute('options') !== json) select.setAttribute('options', json);
    const value = this.sortBy || '';
    if (select.value !== value) select.value = value;
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
      // An explicitly requested download remains owned by its original metric,
      // even when the user closes this modal or opens another while it loads.
      const context = this.currentConfig;
      const filename = `${context.metricKey}_${LanaTime.formatUtcDateOnly()}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      const requestBody = this.buildRequestBody('export', { format });
      const response = await fetch(
        `/api/v1/modules/${context.moduleKey}/metrics/${context.metricKey}/drilldown/export`,
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
        throw new Error(`Export failed: ${response.statusText}`);
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('[DrilldownRenderer] Export error:', error);
      this.notifyError('Export failed', `Failed to export data: ${error.message}`);
    }
  }

  /**
   * Show help modal
   */
  showHelp() {
    const helpText = this.currentConfig?.helpText;
    const lex = typeof window !== 'undefined' ? window.Lex : null;

    if (!helpText) {
      if (lex && lex.Modal) lex.Modal.alertAsync('Help', 'No help documentation available for this drilldown.');
      return;
    }

    // Set modal title to drilldown title (from helpText.title or current config title)
    const modalTitle = helpText?.title || this.currentConfig?.title || 'Help & Documentation';

    // Render help content
    let html = '';

    // Support new structure: paragraphs, columnGuide, tips, interpretation
    if (helpText.paragraphs || helpText.columnGuide || helpText.tips || helpText.interpretation) {
      console.log('[DrilldownRenderer] Rendering help text with new structure');

      // Render paragraphs
      if (helpText.paragraphs && helpText.paragraphs.length > 0) {
        helpText.paragraphs.forEach(para => {
          html += `<p class="text-sm text-gray-700 mb-4">${this.escapeHtml(para)}</p>`;
        });
      }

      // Render column guide
      if (helpText.columnGuide) {
        html += '<div class="mb-6">';
        if (helpText.columnGuide.title) {
          html += `<h3 class="text-lg font-semibold text-gray-900 mb-2">${this.escapeHtml(helpText.columnGuide.title)}</h3>`;
        }
        if (helpText.columnGuide.bullets && helpText.columnGuide.bullets.length > 0) {
          html += '<ul class="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">';
          helpText.columnGuide.bullets.forEach(bullet => {
            html += `<li>${this.escapeHtml(bullet)}</li>`;
          });
          html += '</ul>';
        }
        html += '</div>';
      }

      // Render interpretation
      if (helpText.interpretation) {
        html += '<div class="mb-6">';
        if (helpText.interpretation.title) {
          html += `<h3 class="text-lg font-semibold text-gray-900 mb-2">${this.escapeHtml(helpText.interpretation.title)}</h3>`;
        }
        if (helpText.interpretation.bullets && helpText.interpretation.bullets.length > 0) {
          html += '<ul class="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">';
          helpText.interpretation.bullets.forEach(bullet => {
            html += `<li>${this.escapeHtml(bullet)}</li>`;
          });
          html += '</ul>';
        }
        html += '</div>';
      }

      // Render tips
      if (helpText.tips && helpText.tips.length > 0) {
        html += '<div class="mb-6">';
        html += '<h3 class="text-lg font-semibold text-gray-900 mb-2">💡 Tips</h3>';
        html += '<ul class="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">';
        helpText.tips.forEach(tip => {
          html += `<li>${this.escapeHtml(tip)}</li>`;
        });
        html += '</ul>';
        html += '</div>';
      }
    }
    // Support old structure: sections array (backwards compatibility)
    else if (helpText.sections && helpText.sections.length > 0) {
      console.log('[DrilldownRenderer] Rendering help text with old structure (sections)');
      helpText.sections.forEach(section => {
        html += `<div class="mb-6">`;
        if (section.heading) {
          // Headings are inline content
          html += `<h3 class="text-lg font-semibold text-gray-900 mb-2">${this.renderMarkdownInline(section.heading)}</h3>`;
        }
        if (section.content) {
          // Content may contain line breaks, lists, etc. - use block rendering
          // Don't wrap in <p> tags since renderMarkdownBlock may return multiple elements
          html += `<div class="text-sm text-gray-700 mb-2">${this.formatEntityNames(this.renderMarkdownBlock(section.content))}</div>`;
        }
        if (section.bullets && section.bullets.length > 0) {
          html += '<ul class="list-disc list-inside text-sm text-gray-700 space-y-1 ml-4">';
          section.bullets.forEach(bullet => {
            // Bullets may contain inline markdown (bold, etc.)
            html += `<li>${this.formatEntityNames(this.renderMarkdownInline(bullet))}</li>`;
          });
          html += '</ul>';
        }
        html += '</div>';
      });
    } else {
      console.warn('[DrilldownRenderer] No help text content found');
      html = '<p class="text-sm text-gray-500">No help documentation available.</p>';
    }

    if (lex && lex.Modal && typeof lex.Modal.open === 'function') {
      this._helpModal = lex.Modal.open({ heading: modalTitle, content: `<div class="drilldown-help-content">${html}</div>`, size: 'lg' });
    }
  }

  /**
   * Close help modal
   */
  closeHelp() {
    if (this._helpModal && typeof this._helpModal.removeAfterClose === 'function') this._helpModal.removeAfterClose();
    this._helpModal = null;
  }


  /** Tailwind badge classes -> lex-badge colour. Pure, for unit tests. */
  static badgeColor(classes) {
    const text = String(classes || '');
    if (text.includes('green')) return 'green';
    if (text.includes('red')) return 'red';
    if (text.includes('yellow') || text.includes('orange')) return 'yellow';
    if (text.includes('blue')) return 'blue';
    if (text.includes('purple') || text.includes('indigo')) return 'indigo';
    return 'gray';
  }

  /**
   * Render column with badge and legend support
   */
  renderBadgeColumn(value, column) {
    if (column.type !== 'badge' || !column.legend) {
      if (column.type !== 'badge' || value === null || value === undefined || value === '') {
        return this.formatValue(value, column.format);
      }
      const label = window.Lex?.Utils?.humanizeLabel ? window.Lex.Utils.humanizeLabel(String(value)) : String(value);
      return `<lex-badge label="${this.escapeHtml(label)}" color="gray" size="sm"></lex-badge>`;
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
      // If showValueWithLegend is true, display both the number and the legend text
      if (column.showValueWithLegend && typeof value === 'number') {
        displayValue = `${value} - ${legendText}`;
      } else {
        displayValue = legendText;
      }
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
        'Opportunity Only': 'bg-blue-100 text-blue-800',
        // Response speed colors
        'Likely Auto-Reply': 'bg-purple-100 text-purple-800',
        'Instant': 'bg-green-100 text-green-800',
        'Fast': 'bg-yellow-100 text-yellow-800',
        'Slow': 'bg-orange-100 text-orange-800',
        'Very Slow': 'bg-red-100 text-red-800',
        'No Response': 'bg-gray-100 text-gray-800'
      };

      return exactColors[key] || rangeColors[key] || statusColors[key] || 'bg-gray-100 text-gray-800';
    };

    const colorClass = getColorClass(legendKey, value);
    const lexColor = DrilldownRenderer.badgeColor(colorClass);

    // Tooltip shows original value for reference (e.g., "Score: 20")
    const title = typeof value === 'number' ? `Score: ${value}` : '';
    const text = typeof displayValue === 'string' && window.Lex?.Utils?.capitalizeFirst
      ? window.Lex.Utils.capitalizeFirst(displayValue) : displayValue;

    return `<lex-badge label="${this.escapeHtml(text)}" color="${lexColor}" size="sm" title="${this.escapeHtml(title)}"></lex-badge>`;
  }

  /**
   * Show one record's complete data in a lex-modal (the row's View button
   * or a row click).
   * @param {Object} rowData - the record as the API returned it
   */
  showRawData(rowData) {
    if (!rowData) return;
    const lex = typeof window !== 'undefined' ? window.Lex : null;
    let content;
    if (typeof RawDataViewer !== 'undefined') {
      content = new RawDataViewer(rowData).render();
    } else {
      content = `<pre class="bg-gray-100 p-4 rounded overflow-x-auto text-xs">${this.escapeHtml(JSON.stringify(rowData, null, 2))}</pre>`;
    }
    if (lex && lex.Modal && typeof lex.Modal.open === 'function') {
      lex.Modal.open({ heading: 'Record details', content, size: 'lg' });
    }
  }

  /** Kept for callers that pass a row index on the current page. */
  toggleRawData(rowIndex) {
    this.showRawData((this.currentData?.rows || [])[rowIndex]);
  }
}


// Export and create global instance
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DrilldownRenderer;
} else {
  window.DrilldownRenderer = DrilldownRenderer;
  window.drilldownRenderer = new DrilldownRenderer();
}
