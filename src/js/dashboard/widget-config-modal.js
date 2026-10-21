/**
 * Widget Configuration Modal
 *
 * Provides a modal dialog for adding new dashboard widgets.
 * Fetches available widget types from the backend and renders
 * type-specific configuration fields dynamically.
 *
 * Usage:
 *   WidgetConfigModal.open()   - Opens the modal
 *   WidgetConfigModal.close()  - Closes the modal
 *
 * Depends on: api (global ApiClient), WidgetRenderer (global), lex-select
 */
const WidgetConfigModal = (function() {
  /** Cached modal DOM element */
  var modalElement = null;

  /** Available widget type descriptors from the backend */
  var widgetTypes = [];

  /**
   * Default widget types used as fallback when the backend endpoint
   * is unavailable (e.g., during initial setup or network issues).
   */
  var DEFAULT_WIDGET_TYPES = [
    { type: 'metric_card', label: 'Metric Card', description: 'Single value metric from connected data' },
    { type: 'data_table', label: 'Data Table', description: 'Paginated table of connector records' },
    { type: 'chart', label: 'Chart', description: 'Bar, pie, doughnut, or line visualization' },
    { type: 'activity_feed', label: 'Activity Feed', description: 'Recent organization activity' },
    { type: 'matter_summary', label: 'Matter Summary', description: 'Matter count and status statistics' },
    { type: 'connector_status', label: 'Connector Status', description: 'Integration sync health at a glance' }
  ];

  /**
   * Markup for a lex-select with static { value, label } options.
   * @param {string} id
   * @param {Array<{value: string, label: string}>} options
   * @param {string} value
   * @returns {string}
   */
  function lexSelectHtml(id, options, value) {
    var json = JSON.stringify(options).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return '<lex-select id="' + id + '" options="' + json + '" value="' + value + '"></lex-select>';
  }

  /**
   * Create the modal DOM element and attach it to the body.
   * Only created once; subsequent calls to open() reuse it.
   */
  function createModal() {
    if (modalElement) return;

    var modal = document.createElement('div');
    modal.id = 'widgetConfigModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4';
    modal.style.zIndex = '9999';

    // Click outside to close
    modal.addEventListener('click', function(e) {
      if (e.target === modal) close();
    });

    modal.innerHTML = '<div class="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">'

      // Header
      + '<div class="flex items-center justify-between p-6 border-b border-gray-200">'
      + '<h2 class="text-xl font-semibold text-gray-900">Add Widget</h2>'
      + '<button id="closeWidgetModal" class="text-gray-400 hover:text-gray-600 transition-colors">'
      + '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>'
      + '</svg>'
      + '</button>'
      + '</div>'

      // Body
      + '<div class="p-6">'

      // Widget type selector
      + '<div class="mb-4">'
      + '<label class="block text-sm font-medium text-gray-700 mb-1">Widget Type</label>'
      + '<lex-select id="widgetTypeSelect" placeholder="Select widget type..." options="[]" value=""></lex-select>'
      + '</div>'

      // Widget title input
      + '<div class="mb-4">'
      + '<label class="block text-sm font-medium text-gray-700 mb-1">Title</label>'
      + '<input type="text" id="widgetTitleInput" class="w-full rounded-lg border-gray-300 text-sm focus:border-indigo-500 focus:ring-indigo-500" placeholder="Widget title (auto-generated if blank)">'
      + '</div>'

      // Dynamic type-specific config area
      + '<div id="widgetTypeConfig" class="mb-4"></div>'

      // Action buttons
      + '<div class="flex justify-end gap-3">'
      + '<button id="cancelWidgetBtn" class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>'
      + '<button id="saveWidgetBtn" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">Add Widget</button>'
      + '</div>'

      + '</div>'
      + '</div>';

    document.body.appendChild(modal);
    modalElement = modal;

    // Wire up buttons
    modal.querySelector('#closeWidgetModal').addEventListener('click', close);
    modal.querySelector('#cancelWidgetBtn').addEventListener('click', close);
    modal.querySelector('#saveWidgetBtn').addEventListener('click', save);
    modal.querySelector('#widgetTypeSelect').addEventListener('lex-change', onTypeChange);
  }

  /**
   * Open the widget config modal.
   * Fetches available widget types from the backend on every open
   * to ensure the list stays current.
   * @returns {Promise<void>}
   */
  async function open() {
    createModal();

    // Fetch widget types from backend, fall back to defaults
    try {
      var response = await api.getDashboardWidgetTypes();
      widgetTypes = (response && response.data) ? response.data : DEFAULT_WIDGET_TYPES;
    } catch (err) {
      console.warn('[WidgetConfigModal] Could not fetch widget types, using defaults:', err.message);
      widgetTypes = DEFAULT_WIDGET_TYPES;
    }

    // Populate type select
    var select = modalElement.querySelector('#widgetTypeSelect');
    select.options = [{ value: '', label: 'Select widget type...' }].concat(widgetTypes.map(function(wt) {
      return { value: String(wt.type), label: wt.label || wt.type };
    }));
    select.value = '';

    // Reset form state
    modalElement.querySelector('#widgetTitleInput').value = '';
    modalElement.querySelector('#widgetTypeConfig').innerHTML = '';

    // Show modal
    modalElement.classList.remove('hidden');
    modalElement.classList.add('flex');
  }

  /**
   * Close the widget config modal.
   */
  function close() {
    if (modalElement) {
      modalElement.classList.add('hidden');
      modalElement.classList.remove('flex');
    }
  }

  /**
   * Handle widget type selection change.
   * Renders type-specific configuration fields dynamically.
   */
  function onTypeChange() {
    var selectedType = modalElement.querySelector('#widgetTypeSelect').value;
    var configContainer = modalElement.querySelector('#widgetTypeConfig');
    configContainer.innerHTML = '';

    if (!selectedType) return;

    // Connector-data-backed widget types share common entity/connector filters
    var isConnectorType = (
      selectedType === 'metric_card'
      || selectedType === 'data_table'
      || selectedType === 'chart'
    );

    if (isConnectorType) {
      configContainer.innerHTML = '<div class="mb-3">'
        + '<label class="block text-sm font-medium text-gray-700 mb-1">Entity Type</label>'
        + '<input type="text" id="widgetEntityType" class="w-full rounded-lg border-gray-300 text-sm focus:border-indigo-500 focus:ring-indigo-500" placeholder="e.g. contact, invoice, email">'
        + '</div>'
        + '<div class="mb-3">'
        + '<label class="block text-sm font-medium text-gray-700 mb-1">Connector ID <span class="text-gray-400 font-normal">(optional)</span></label>'
        + '<input type="text" id="widgetConnectorId" class="w-full rounded-lg border-gray-300 text-sm focus:border-indigo-500 focus:ring-indigo-500" placeholder="Filter by specific connector">'
        + '</div>';

      if (selectedType === 'metric_card') {
        configContainer.innerHTML += '<div class="mb-3">'
          + '<label class="block text-sm font-medium text-gray-700 mb-1">Metric</label>'
          + lexSelectHtml('widgetMetric', [
            { value: 'count', label: 'Count' },
            { value: 'sum', label: 'Sum' },
            { value: 'avg', label: 'Average' }
          ], 'count')
          + '</div>';
      }

      if (selectedType === 'chart') {
        configContainer.innerHTML += '<div class="mb-3">'
          + '<label class="block text-sm font-medium text-gray-700 mb-1">Chart Type</label>'
          + lexSelectHtml('widgetChartType', [
            { value: 'bar', label: 'Bar' },
            { value: 'pie', label: 'Pie' },
            { value: 'doughnut', label: 'Doughnut' },
            { value: 'line', label: 'Line' }
          ], 'bar')
          + '</div>'
          + '<div class="mb-3">'
          + '<label class="block text-sm font-medium text-gray-700 mb-1">Group By</label>'
          + lexSelectHtml('widgetGroupBy', [
            { value: 'connector_id', label: 'Connector' },
            { value: 'entity_type', label: 'Entity Type' }
          ], 'connector_id')
          + '</div>';
      }
    }
  }

  /**
   * Collect form values, validate, and create the widget via the API.
   * On success, closes the modal and re-initializes the widget grid.
   * @returns {Promise<void>}
   */
  async function save() {
    var widgetType = modalElement.querySelector('#widgetTypeSelect').value;
    var titleRaw = modalElement.querySelector('#widgetTitleInput').value.trim();

    if (!widgetType) {
      Lex.Modal.alertAsync('Widget type required', 'Please select a widget type.');
      return;
    }

    // Build config from type-specific fields
    var config = {};

    var entityTypeInput = modalElement.querySelector('#widgetEntityType');
    if (entityTypeInput && entityTypeInput.value.trim()) {
      config.entity_type = entityTypeInput.value.trim();
    }

    var connectorIdInput = modalElement.querySelector('#widgetConnectorId');
    if (connectorIdInput && connectorIdInput.value.trim()) {
      config.connector_id = connectorIdInput.value.trim();
    }

    var metricSelect = modalElement.querySelector('#widgetMetric');
    if (metricSelect) {
      config.metric = metricSelect.value;
    }

    var chartTypeSelect = modalElement.querySelector('#widgetChartType');
    if (chartTypeSelect) {
      config.chart_type = chartTypeSelect.value;
    }

    var groupBySelect = modalElement.querySelector('#widgetGroupBy');
    if (groupBySelect) {
      config.group_by = groupBySelect.value;
    }

    // Auto-generate a human-readable title from the type name if not provided
    var autoTitle = widgetType.split('_').map(function(word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');

    var payload = {
      widget_type: widgetType,
      title: titleRaw || autoTitle,
      config: config,
      position: {},
      refresh_interval_seconds: 300
    };

    var saveBtn = modalElement.querySelector('#saveWidgetBtn');
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Adding...';

      await api.createDashboardWidget(payload);
      close();

      // Reload widget grid to show the new widget
      if (typeof WidgetRenderer !== 'undefined') {
        await WidgetRenderer.init();
      }
    } catch (err) {
      console.error('[WidgetConfigModal] Failed to save widget:', err);
      Lex.Modal.alertAsync('Could not add widget', 'Failed to add widget. Please try again.');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Add Widget';
      }
    }
  }

  // Public API
  return {
    open: open,
    close: close
  };
})();
