/**
 * DataOverridePanel - Reusable ES6 component for managing metric data overrides
 *
 * This component provides a lex-drawer side panel for:
 * - Viewing current metric targets/values
 * - Creating manual overrides for specific time periods
 * - Viewing and managing existing overrides
 * - Deleting overrides
 *
 * @module DataOverridePanel
 * @requires API client (must be passed in config)
 *
 * @example
 * import { DataOverridePanel } from './data-override-panel.js';
 *
 * // Basic usage with default endpoints
 * const panel = new DataOverridePanel({
 *   apiClient: api,
 *   onSaveSuccess: (metricName) => {
 *     console.log(`Override saved for ${metricName}`);
 *   },
 *   onDeleteSuccess: (overrideId) => {
 *     console.log(`Override ${overrideId} deleted`);
 *   }
 * });
 *
 * // Advanced usage with custom API endpoints
 * const customPanel = new DataOverridePanel({
 *   apiClient: api,
 *   apiEndpoints: {
 *     overrides: '/api/v2/custom/overrides/{moduleKey}',
 *     targets: '/api/v2/custom/targets/{moduleKey}'
 *   },
 *   onSaveSuccess: (metricName) => {
 *     console.log(`Override saved for ${metricName}`);
 *   }
 * });
 *
 * panel.open('revenue', 'Monthly Revenue', 'Total revenue for the period', 50000, {
 *   periodStart: '2024-01-01',
 *   periodEnd: '2024-01-31',
 *   periodType: 'monthly',
 *   moduleKey: 'finance-module'
 * });
 *
 * @author LANA AI Platform Team
 * @version 1.1.0
 */

export class DataOverridePanel {
  /**
   * Create a new DataOverridePanel instance
   *
   * @param {Object} config - Configuration object
   * @param {Object} config.apiClient - API client instance with get/post/delete methods
   * @param {Object} [config.apiEndpoints] - Custom API endpoint configuration
   * @param {string} [config.apiEndpoints.overrides='/api/v1/modules/{moduleKey}/data-overrides'] - Override CRUD endpoint
   * @param {string} [config.apiEndpoints.targets='/api/v1/modules/{moduleKey}/targets'] - Target values endpoint
   * @param {Function} [config.onSaveSuccess] - Callback after successful save (metricName) => void
   * @param {Function} [config.onDeleteSuccess] - Callback after successful delete (overrideId) => void
   * @param {Function} [config.onError] - Callback for errors (error) => void
   * @param {Function} [config.formatNumber] - Custom number formatter (value, decimals) => string
   * @param {Function} [config.formatDateRange] - Custom date range formatter (startDate, endDate) => string
   */
  constructor(config = {}) {
    this.apiClient = config.apiClient;

    // Default API endpoints (can be overridden via config)
    this.apiEndpoints = {
      overrides: '/api/v1/modules/{moduleKey}/data-overrides',
      targets: '/api/v1/modules/{moduleKey}/targets',
      ...(config.apiEndpoints || {})
    };

    this.onSaveSuccess = config.onSaveSuccess || (() => {});
    this.onDeleteSuccess = config.onDeleteSuccess || (() => {});
    this.onError = config.onError || ((error) => {
      // Default error handling - show an error dialog
      Lex.Modal.alertAsync('Something went wrong', error.message || 'An unexpected error occurred');
    });
    this.formatNumber = config.formatNumber || this._defaultFormatNumber.bind(this);
    this.formatDateRange = config.formatDateRange || this._defaultFormatDateRange.bind(this);

    // Internal state
    this.currentMetric = null;
    this.currentPeriod = null;

    // DOM references (will be set when panel is initialized)
    this.panel = null;
    this.form = null;

    // Ensure DOM elements exist
    this._ensureDOMElements();

    // Bind event listeners
    this._bindEvents();
  }

  /**
   * Build API endpoint URL with module key substitution
   * @private
   * @param {string} endpointTemplate - Endpoint template with {moduleKey} placeholder
   * @param {string} moduleKey - Module key to substitute
   * @param {string} [resourceId] - Optional resource ID to append
   * @returns {string} Complete endpoint URL
   *
   * @example
   * this._buildEndpoint('/api/v1/modules/{moduleKey}/data-overrides', 'finance-module')
   * // Returns: '/api/v1/modules/finance-module/data-overrides'
   *
   * this._buildEndpoint('/api/v1/modules/{moduleKey}/data-overrides', 'finance-module', '12345')
   * // Returns: '/api/v1/modules/finance-module/data-overrides/12345'
   */
  _buildEndpoint(endpointTemplate, moduleKey, resourceId = null) {
    let endpoint = endpointTemplate.replace('{moduleKey}', moduleKey);

    if (resourceId) {
      endpoint = `${endpoint}/${resourceId}`;
    }

    return endpoint;
  }

  /**
   * Ensure required DOM elements exist in the document
   * @private
   */
  _ensureDOMElements() {
    // Reuse a drawer an earlier instance (or the page) already mounted.
    const existing = document.getElementById('dataOverridePanel');
    if (existing && existing.tagName === 'LEX-DRAWER') {
      this._cacheElements();
      return;
    }
    // Replace legacy hand-built overlay/panel markup if a page still ships it.
    if (existing) existing.remove();
    const legacyOverlay = document.getElementById('dataOverrideOverlay');
    if (legacyOverlay) legacyOverlay.remove();

    // lex-drawer supplies the header, close button, backdrop, Escape, focus
    // trap and scroll lock; the Save/Cancel buttons sit in its footer slot.
    const drawer = document.createElement('lex-drawer');
    drawer.id = 'dataOverridePanel';
    drawer.setAttribute('heading', 'Override Target Value');
    drawer.setAttribute('width', 'md');
    drawer.innerHTML = this._getPanelHTML();
    document.body.appendChild(drawer);

    // Cache element references (after the drawer has rendered its content)
    this._cacheElements();
  }

  /**
   * Cache DOM element references for performance
   * @private
   */
  _cacheElements() {
    this.panel = document.getElementById('dataOverridePanel');
    this.form = document.getElementById('overrideForm');

    // Form elements
    this.elements = {
      metricName: document.getElementById('overrideMetricName'),
      metricDescription: document.getElementById('overrideMetricDescription'),
      periodRange: document.getElementById('overridePeriodRange'),
      currentValue: document.getElementById('overrideCurrentValue'),
      currentValueLabel: document.getElementById('overrideCurrentValue')?.parentElement?.querySelector('p.text-xs'),
      overrideValue: document.getElementById('overrideValue'),
      overrideNotes: document.getElementById('overrideNotes'),
      overrideType: document.getElementById('overrideType'),
      periodStart: document.getElementById('overridePeriodStart'),
      periodEnd: document.getElementById('overridePeriodEnd'),
      periodType: document.getElementById('overridePeriodType'),
      moduleKey: document.getElementById('overrideModuleKey'),
      metricKey: document.getElementById('overrideMetricKey'),
      saveBtn: document.getElementById('saveOverrideBtn'),
      cancelBtn: document.getElementById('cancelOverrideBtn'),
      existingSection: document.getElementById('existingOverridesSection'),
      existingList: document.getElementById('existingOverridesList')
    };
  }

  /**
   * Bind event listeners to panel elements
   * @private
   */
  _bindEvents() {
    // The drawer's close button, backdrop and Escape emit lex-close; clear
    // the panel state the same way the Cancel button does.
    if (this.panel) {
      this.panel.addEventListener('lex-close', () => this._resetState());
    }

    if (this.elements.cancelBtn) {
      this.elements.cancelBtn.addEventListener('click', () => this.close());
    }

    // Form submission
    if (this.form) {
      this.form.addEventListener('submit', (e) => this._handleFormSubmit(e));
    }

    // Delete buttons on the rendered existing overrides
    this.attachDeleteHandlers();
  }

  /**
   * Generate the HTML structure for the panel
   * @private
   * @returns {string} Panel HTML
   */
  _getPanelHTML() {
    return `
      <div>
        <!-- Metric Info -->
        <div class="mb-6 p-4 bg-indigo-50 rounded-lg border border-indigo-100">
          <h3 id="overrideMetricName" class="font-semibold text-gray-900 mb-1"></h3>
          <p id="overrideMetricDescription" class="text-sm text-gray-600"></p>
          <div class="mt-3 text-xs text-gray-500">
            <p>Period: <span id="overridePeriodRange" class="font-medium text-gray-700"></span></p>
          </div>
        </div>

        <!-- Current Value Display -->
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-2">Current Target</label>
          <div class="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p id="overrideCurrentValue" class="text-2xl font-bold text-gray-900">-</p>
            <p class="text-xs text-gray-500 mt-1">Default target value</p>
          </div>
        </div>

        <!-- Override Form -->
        <form id="overrideForm" class="space-y-4">
          <div>
            <label for="overrideValue" class="block text-sm font-medium text-gray-700 mb-2">
              New Target Value <span class="text-red-500">*</span>
            </label>
            <input
              type="number"
              id="overrideValue"
              step="0.01"
              required
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter new target value"
            >
            <p class="text-xs text-gray-500 mt-1">This target will replace the default target for this period.</p>
          </div>

          <div>
            <label for="overrideNotes" class="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              id="overrideNotes"
              rows="3"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Why are you overriding this value?"
            ></textarea>
          </div>

          <!-- Hidden form fields -->
          <input type="hidden" id="overrideType" value="manual">
          <input type="hidden" id="overridePeriodStart">
          <input type="hidden" id="overridePeriodEnd">
          <input type="hidden" id="overridePeriodType">
          <input type="hidden" id="overrideModuleKey">
          <input type="hidden" id="overrideMetricKey">

        </form>

        <!-- Existing Overrides -->
        <div id="existingOverridesSection" class="hidden mt-8 pt-6 border-t border-gray-200">
          <h3 class="text-sm font-semibold text-gray-900 mb-3">Existing Override</h3>
          <div id="existingOverridesList" class="space-y-2">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>

      <lex-btn data-slot="footer" id="cancelOverrideBtn" variant="secondary">Cancel</lex-btn>
      <lex-btn data-slot="footer" id="saveOverrideBtn" type="submit" form="overrideForm" variant="primary">Save Override</lex-btn>
    `;
  }

  /**
   * Open the data override panel
   *
   * @param {string} metricKey - Unique identifier for the metric
   * @param {string} metricName - Display name of the metric
   * @param {string} metricDescription - Description of the metric
   * @param {number} currentValue - Current target or value
   * @param {Object} periodData - Period and module information
   * @param {string} periodData.periodStart - Period start date (YYYY-MM-DD)
   * @param {string} periodData.periodEnd - Period end date (YYYY-MM-DD)
   * @param {string} periodData.periodType - Period type (daily, weekly, monthly, etc.)
   * @param {string} periodData.moduleKey - Module identifier
   * @param {string} [overrideType='target'] - Override type (target, value, etc.)
   */
  open(metricKey, metricName, metricDescription, currentValue, periodData, overrideType = 'target') {
    // Validate inputs
    if (!metricKey || !metricName || currentValue === undefined || !periodData) {
      this._handleError(new Error('Missing required parameters for opening override panel'));
      return;
    }

    if (!periodData.periodStart || !periodData.periodEnd) {
      this._handleError(new Error('Please select a date range first'));
      return;
    }

    // Store current state
    this.currentMetric = {
      key: metricKey,
      name: metricName,
      description: metricDescription,
      currentValue: currentValue,
      overrideType: overrideType
    };

    this.currentPeriod = {
      start: periodData.periodStart,
      end: periodData.periodEnd,
      type: periodData.periodType,
      moduleKey: periodData.moduleKey
    };

    // Populate panel UI
    this.elements.metricName.textContent = metricName;
    this.elements.metricDescription.textContent = metricDescription || 'No description available';
    this.elements.periodRange.textContent = this.formatDateRange(
      new Date(LanaTime.utcDayStart(periodData.periodStart)),
      new Date(LanaTime.utcDayEnd(periodData.periodEnd))
    );

    // Update labels based on override type
    const valueLabel = overrideType === 'target' ? 'Current Target' : 'Current Value';
    if (this.elements.currentValueLabel) {
      this.elements.currentValueLabel.textContent = valueLabel;
    }
    this.elements.currentValue.textContent = this.formatNumber(currentValue, 2);

    // Reset form
    this.form.reset();
    this.elements.overrideValue.value = '';
    this.elements.overrideNotes.value = '';
    this.elements.overrideType.value = overrideType;

    // Store period data in hidden form inputs
    this.elements.periodStart.value = periodData.periodStart;
    this.elements.periodEnd.value = periodData.periodEnd;
    this.elements.periodType.value = periodData.periodType;
    this.elements.moduleKey.value = periodData.moduleKey;
    this.elements.metricKey.value = metricKey;

    // Load existing overrides for this metric
    this._loadExistingOverrides(periodData.moduleKey, metricKey, periodData.periodStart, periodData.periodEnd);

    // Show the drawer (it locks body scroll and traps focus)
    this.panel.open = true;
  }

  /**
   * Close the data override panel
   */
  close() {
    if (this.panel) this.panel.open = false;
    this._resetState();
  }

  /**
   * Clear per-open state
   * @private
   */
  _resetState() {
    this.currentMetric = null;
    this.currentPeriod = null;
  }

  /**
   * Load existing overrides for the current metric and period
   * @private
   * @param {string} moduleKey - Module identifier
   * @param {string} metricKey - Metric identifier
   * @param {string} periodStart - Period start date (YYYY-MM-DD)
   * @param {string} periodEnd - Period end date (YYYY-MM-DD)
   */
  async _loadExistingOverrides(moduleKey, metricKey, periodStart, periodEnd) {
    try {
      // Convert to ISO format
      const periodStartISO = LanaTime.utcDayStart(periodStart);
      const periodEndISO = LanaTime.utcDayEnd(periodEnd);

      // Build endpoint URL using configurable template
      const endpoint = this._buildEndpoint(this.apiEndpoints.overrides, moduleKey);

      // Fetch overrides from API
      const data = await this.apiClient.get(endpoint, {
        periodStart: periodStartISO,
        periodEnd: periodEndISO
      });

      // Filter to current metric
      const metricOverrides = data.filter(o => o.metric_key === metricKey);

      // Update UI
      if (metricOverrides.length > 0) {
        this.elements.existingSection.classList.remove('hidden');
        this.elements.existingList.innerHTML = metricOverrides.map(override => this._renderOverride(override)).join('');
      } else {
        this.elements.existingSection.classList.add('hidden');
      }
    } catch (error) {
      console.error('Failed to load existing overrides:', error);
      // Non-critical - just hide the section
      this.elements.existingSection.classList.add('hidden');
    }
  }

  /**
   * Render a single override item
   * @private
   * @param {Object} override - Override data
   * @returns {string} HTML for override item
   */
  _renderOverride(override) {
    return `
      <div class="p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1">
            <p class="text-sm font-semibold text-gray-900">Override Value: ${this.formatNumber(override.override_value, 2)}</p>
            <p class="text-xs text-gray-500 mt-1">
              Period: ${this.formatDateRange(override.period_start, override.period_end)}
            </p>
            ${override.notes ? `<p class="text-xs text-gray-600 mt-1 italic">"${this._escapeHtml(override.notes)}"</p>` : ''}
          </div>
          <button
            data-override-id="${override.override_id}"
            class="delete-override-btn text-red-600 hover:text-red-800 ml-2"
            title="Delete override"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
        <div class="text-xs text-gray-400">
          Created: ${formatDate(override.created_at)}
        </div>
      </div>
    `;
  }

  /**
   * Handle form submission to save override
   * @private
   * @param {Event} e - Form submit event
   */
  async _handleFormSubmit(e) {
    e.preventDefault();

    if (!this.currentMetric) {
      this._handleError(new Error('No metric selected for override'));
      return;
    }

    // Read form values
    const moduleKey = this.elements.moduleKey.value;
    const periodType = this.elements.periodType.value;
    const periodStart = this.elements.periodStart.value;
    const periodEnd = this.elements.periodEnd.value;
    const overrideValue = parseFloat(this.elements.overrideValue.value);
    const overrideNotes = this.elements.overrideNotes.value.trim();
    const overrideType = this.elements.overrideType.value;

    // Validation
    if (!periodStart || !periodEnd) {
      this._handleError(new Error('Period dates are missing. Please close and reopen the panel.'));
      return;
    }

    if (isNaN(overrideValue)) {
      this._handleError(new Error('Please enter a valid numeric value'));
      return;
    }

    // Convert to ISO format
    const periodStartISO = LanaTime.utcDayStart(periodStart);
    const periodEndISO = LanaTime.utcDayEnd(periodEnd);

    // Show loading state
    this._setLoadingState(true);

    try {
      // Build endpoint URL using configurable template
      const endpoint = this._buildEndpoint(this.apiEndpoints.overrides, moduleKey);

      await this.apiClient.post(endpoint, {
        metricKey: this.currentMetric.key,
        periodStart: periodStartISO,
        periodEnd: periodEndISO,
        periodType: periodType,
        overrideValue: overrideValue,
        overrideType: overrideType,
        notes: overrideNotes || null
      });

      // Success callback
      if (this.onSaveSuccess) {
        this.onSaveSuccess(this.currentMetric.name);
      }

      // Close panel
      this.close();

    } catch (error) {
      console.error('Failed to save override:', error);
      this._handleError(error);
    } finally {
      this._setLoadingState(false);
    }
  }

  /**
   * Delete an existing override
   *
   * @param {string} overrideId - Override identifier
   * @returns {Promise<void>}
   */
  async delete(overrideId) {
    const confirmed = await Lex.Modal.confirmAsync('Delete override', 'Are you sure you want to delete this override?', {
      confirmText: 'Delete',
      variant: 'danger'
    });
    if (!confirmed) {
      return;
    }

    if (!this.currentPeriod || !this.currentMetric) {
      this._handleError(new Error('Invalid panel state for delete operation'));
      return;
    }

    const moduleKey = this.currentPeriod.moduleKey;

    try {
      // Build endpoint URL using configurable template
      const endpoint = this._buildEndpoint(
        this.apiEndpoints.overrides,
        moduleKey,
        overrideId
      );

      await this.apiClient.delete(endpoint);

      // Success callback
      if (this.onDeleteSuccess) {
        this.onDeleteSuccess(overrideId);
      }

      // Reload existing overrides
      await this._loadExistingOverrides(
        moduleKey,
        this.currentMetric.key,
        this.currentPeriod.start,
        this.currentPeriod.end
      );

    } catch (error) {
      console.error('Failed to delete override:', error);
      this._handleError(error);
    }
  }

  /**
   * Set loading state for save button
   * @private
   * @param {boolean} isLoading - Loading state
   */
  _setLoadingState(isLoading) {
    // lex-btn shows its spinner and disables itself while loading
    if (this.elements.saveBtn) this.elements.saveBtn.loading = isLoading;
  }

  /**
   * Handle errors with user feedback
   * @private
   * @param {Error} error - Error object
   */
  _handleError(error) {
    // Always call error handler (defaults to alert if not provided)
    this.onError(error);
  }

  /**
   * Default number formatter
   * @private
   * @param {number} value - Number to format
   * @param {number} decimals - Number of decimal places
   * @returns {string} Formatted number
   */
  _defaultFormatNumber(value, decimals = 2) {
    if (value === null || value === undefined) return '-';
    return parseFloat(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
   * Default date range formatter
   * @private
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {string} Formatted date range
   */
  _defaultFormatDateRange(startDate, endDate) {
    return `${formatDateLong(startDate, { month: 'short' })} - ${formatDateLong(endDate, { month: 'short' })}`;
  }

  /**
   * Escape HTML to prevent XSS
   * @private
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Attach event delegation for delete buttons (done by the constructor;
   * idempotent)
   */
  attachDeleteHandlers() {
    const list = this.elements.existingList;
    // One delegated listener per list element, however many instances or calls.
    if (!list || list.__overrideDeleteBound) return;
    list.__overrideDeleteBound = true;
    list.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.delete-override-btn');
      if (deleteBtn) {
        const overrideId = deleteBtn.dataset.overrideId;
        if (overrideId) {
          this.delete(overrideId);
        }
      }
    });
  }
}

// Export as default for convenience
export default DataOverridePanel;
