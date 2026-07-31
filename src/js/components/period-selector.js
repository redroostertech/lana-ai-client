/**
 * PeriodSelector - Reusable ES6 Module for Period Selection
 *
 * A configuration-driven period selector component that provides:
 * - Period preset buttons (Last 7 Days, Last 30 Days, This Month, etc.)
 * - Date range inputs (Start Date, End Date)
 * - Period type selector (Daily, Weekly, Monthly, Quarterly, Yearly)
 * - onChange callback when period changes
 *
 * @module PeriodSelector
 * @version 1.0.0
 * @created 2026-02-01
 *
 * @example
 * // Initialize period selector
 * const selector = new PeriodSelector({
 *   containerId: 'period-selector-container',
 *   defaultPreset: 'last30days',
 *   defaultPeriodType: 'monthly',
 *   onChange: (period) => {
 *     console.log('Period changed:', period);
 *     // { start: '2026-01-01', end: '2026-01-31', type: 'monthly' }
 *   }
 * });
 *
 * selector.render();
 *
 * // Get current period
 * const currentPeriod = selector.getPeriod();
 *
 * // Set period programmatically
 * selector.setPeriod('2026-01-01', '2026-01-31', 'monthly');
 */

/**
 * PeriodSelector Class
 *
 * Creates an interactive period selector component with preset buttons,
 * date range inputs, and period type selection.
 */
export class PeriodSelector {
  /**
   * Available period presets with their labels and calculation logic
   * @private
   * @static
   */
  static PRESETS = {
    last7days: { label: 'Last 7 Days', days: 6 },
    last30days: { label: 'Last 30 Days', days: 29 },
    thisMonth: { label: 'This Month' },
    lastMonth: { label: 'Last Month' },
    thisQuarter: { label: 'This Quarter' },
    thisYear: { label: 'This Year' },
    lastYear: { label: 'Last Year' }
  };

  /**
   * Available period types for comparison
   * @private
   * @static
   */
  static PERIOD_TYPES = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' }
  ];

  /**
   * Create a PeriodSelector instance
   *
   * @param {Object} config - Configuration object
   * @param {string} config.containerId - ID of the container element to render into
   * @param {string} [config.defaultPreset='last7days'] - Default period preset
   * @param {string} [config.defaultPeriodType='daily'] - Default period type
   * @param {Function} [config.onChange] - Callback when period changes (start, end, type)
   * @param {Array<string>} [config.presets] - Array of preset keys to show (default: all)
   * @param {Array<string>} [config.periodTypes] - Array of period type values to show (default: all)
   */
  constructor(config = {}) {
    // Validate configuration
    if (!config.containerId) {
      throw new Error('PeriodSelector: containerId is required');
    }

    this.containerId = config.containerId;
    this.defaultPreset = config.defaultPreset || 'last7days';
    this.defaultPeriodType = config.defaultPeriodType || 'daily';
    this.onChange = config.onChange || (() => {});

    // Filter presets and period types if custom lists provided
    this.presets = config.presets
      ? Object.keys(PeriodSelector.PRESETS).filter(key => config.presets.includes(key))
      : Object.keys(PeriodSelector.PRESETS);

    this.periodTypes = config.periodTypes
      ? PeriodSelector.PERIOD_TYPES.filter(pt => config.periodTypes.includes(pt.value))
      : PeriodSelector.PERIOD_TYPES;

    // Internal state
    this.state = {
      startDate: '',
      endDate: '',
      periodType: this.defaultPeriodType
    };

    // Generate unique IDs for elements
    this.ids = {
      presetContainer: `${this.containerId}-presets`,
      periodStart: `${this.containerId}-start`,
      periodEnd: `${this.containerId}-end`,
      periodType: `${this.containerId}-type`
    };
  }

  /**
   * Render the period selector UI into the container
   *
   * Creates the HTML structure with:
   * - Period preset buttons
   * - Date range inputs
   * - Period type selector
   *
   * @public
   * @returns {void}
   */
  render() {
    const container = document.getElementById(this.containerId);

    if (!container) {
      throw new Error(`PeriodSelector: Container with id "${this.containerId}" not found`);
    }

    // Build HTML structure
    container.innerHTML = `
      <div class="period-selector">
        <!-- Period Presets -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-2">Quick Select</label>
          <div id="${this.ids.presetContainer}" class="flex flex-wrap gap-2">
            ${this.presets.map(key => `
              <button
                data-preset="${key}"
                class="period-preset-btn px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ${PeriodSelector.PRESETS[key].label}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Date Range Inputs -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <!-- Start Date -->
          <div>
            <label for="${this.ids.periodStart}" class="block text-sm font-medium text-gray-700 mb-2">
              Start Date
            </label>
            <input
              type="date"
              id="${this.ids.periodStart}"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <!-- End Date -->
          <div>
            <label for="${this.ids.periodEnd}" class="block text-sm font-medium text-gray-700 mb-2">
              End Date
            </label>
            <input
              type="date"
              id="${this.ids.periodEnd}"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <!-- Period Type -->
          <div>
            <label for="${this.ids.periodType}" class="block text-sm font-medium text-gray-700 mb-2">
              Compare By
            </label>
            <select
              id="${this.ids.periodType}"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              ${this.periodTypes.map(pt => `
                <option value="${pt.value}">${pt.label}</option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>
    `;

    // Attach event listeners
    this._attachEventListeners();

    // Initialize with default preset
    this._selectPreset(this.defaultPreset);
  }

  /**
   * Attach event listeners to UI elements
   *
   * @private
   * @returns {void}
   */
  _attachEventListeners() {
    // Preset buttons
    const presetButtons = document.querySelectorAll(`#${this.ids.presetContainer} .period-preset-btn`);
    presetButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const preset = btn.getAttribute('data-preset');
        this._selectPreset(preset);
      });
    });

    // Date inputs
    const startInput = document.getElementById(this.ids.periodStart);
    const endInput = document.getElementById(this.ids.periodEnd);

    startInput.addEventListener('change', () => this._handleDateChange());
    endInput.addEventListener('change', () => this._handleDateChange());

    // Period type selector
    const typeSelect = document.getElementById(this.ids.periodType);
    typeSelect.addEventListener('change', () => this._handleTypeChange());
  }

  /**
   * Select a period preset and update date inputs
   *
   * @private
   * @param {string} preset - Preset key (e.g., 'last7days', 'thisMonth')
   * @returns {void}
   */
  _selectPreset(preset) {
    const today = Lex.Utils.nowDate();
    let startDate, endDate;

    switch (preset) {
      case 'last7days':
        endDate = new Date(today);
        startDate = Lex.Utils.addDays(today, -6);  // 7 days inclusive (today + 6 prior days)
        break;

      case 'last30days':
        endDate = new Date(today);
        startDate = Lex.Utils.addDays(today, -29);  // 30 days inclusive (today + 29 prior days)
        break;

      case 'thisMonth':
        startDate = Lex.Utils.startOfLocalMonth(today);
        endDate = new Date(today);
        break;

      case 'lastMonth':
        startDate = Lex.Utils.startOfLocalMonth(Lex.Utils.addUtcMonths(today, -1));
        endDate = Lex.Utils.endOfLocalMonth(Lex.Utils.addUtcMonths(today, -1));
        break;

      case 'thisQuarter':
        const currentQuarter = Math.floor(today.getMonth() / 3);
        startDate = new Date(today.getFullYear(), currentQuarter * 3, 1);
        endDate = new Date(today);
        break;

      case 'thisYear':
        startDate = Lex.Utils.startOfLocalYear(today);
        endDate = new Date(today);
        break;

      case 'lastYear':
        startDate = Lex.Utils.startOfLocalYear(Lex.Utils.addUtcMonths(today, -12));
        endDate = Lex.Utils.endOfLocalYear(Lex.Utils.addUtcMonths(today, -12));
        break;

      default:
        // Default: Last 7 days
        endDate = new Date(today);
        startDate = Lex.Utils.addDays(today, -6);
    }

    // Update input fields
    document.getElementById(this.ids.periodStart).value = this._formatDate(startDate);
    document.getElementById(this.ids.periodEnd).value = this._formatDate(endDate);

    // Update internal state
    this.state.startDate = this._formatDate(startDate);
    this.state.endDate = this._formatDate(endDate);

    // Trigger onChange callback
    this.onChange(this.getPeriod());
  }

  /**
   * Handle date input change event
   *
   * @private
   * @returns {void}
   */
  _handleDateChange() {
    const startInput = document.getElementById(this.ids.periodStart);
    const endInput = document.getElementById(this.ids.periodEnd);

    this.state.startDate = startInput.value;
    this.state.endDate = endInput.value;

    // Trigger onChange callback
    this.onChange(this.getPeriod());
  }

  /**
   * Handle period type change event
   *
   * @private
   * @returns {void}
   */
  _handleTypeChange() {
    const typeSelect = document.getElementById(this.ids.periodType);
    this.state.periodType = typeSelect.value;

    // Trigger onChange callback
    this.onChange(this.getPeriod());
  }

  /**
   * Format a Date object as YYYY-MM-DD
   *
   * @private
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string (YYYY-MM-DD)
   */
  _formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Get the current period selection
   *
   * @public
   * @returns {Object} Period object with start, end, and type
   * @returns {string} return.start - Start date (YYYY-MM-DD)
   * @returns {string} return.end - End date (YYYY-MM-DD)
   * @returns {string} return.type - Period type (daily, weekly, monthly, quarterly, yearly)
   *
   * @example
   * const period = selector.getPeriod();
   * // { start: '2026-01-01', end: '2026-01-31', type: 'monthly' }
   */
  getPeriod() {
    return {
      start: this.state.startDate,
      end: this.state.endDate,
      type: this.state.periodType
    };
  }

  /**
   * Set the period selection programmatically
   *
   * @public
   * @param {string} start - Start date (YYYY-MM-DD)
   * @param {string} end - End date (YYYY-MM-DD)
   * @param {string} [type] - Period type (daily, weekly, monthly, quarterly, yearly)
   * @returns {void}
   *
   * @example
   * selector.setPeriod('2026-01-01', '2026-01-31', 'monthly');
   */
  setPeriod(start, end, type) {
    // Validate inputs
    if (!start || !end) {
      throw new Error('PeriodSelector: start and end dates are required');
    }

    // Update input fields
    document.getElementById(this.ids.periodStart).value = start;
    document.getElementById(this.ids.periodEnd).value = end;

    if (type) {
      document.getElementById(this.ids.periodType).value = type;
      this.state.periodType = type;
    }

    // Update internal state
    this.state.startDate = start;
    this.state.endDate = end;

    // Trigger onChange callback
    this.onChange(this.getPeriod());
  }

  /**
   * Validate the current period selection
   *
   * @public
   * @returns {Object} Validation result
   * @returns {boolean} return.valid - Whether the period is valid
   * @returns {string} [return.error] - Error message if invalid
   *
   * @example
   * const validation = selector.validate();
   * if (!validation.valid) {
   *   console.error(validation.error);
   * }
   */
  validate() {
    const { start, end } = this.getPeriod();

    // Check if dates are set
    if (!start || !end) {
      return {
        valid: false,
        error: 'Both start and end dates are required'
      };
    }

    // Validate date order
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (startDate > endDate) {
      return {
        valid: false,
        error: 'Start date must be before or equal to end date'
      };
    }

    return { valid: true };
  }

  /**
   * Destroy the period selector and remove event listeners
   *
   * @public
   * @returns {void}
   */
  destroy() {
    const container = document.getElementById(this.containerId);
    if (container) {
      container.innerHTML = '';
    }
  }
}

/**
 * Export the PeriodSelector class as the default export
 */
export default PeriodSelector;
