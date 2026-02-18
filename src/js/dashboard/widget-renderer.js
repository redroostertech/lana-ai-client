/**
 * Widget Renderer - Dashboard Command Center
 *
 * Orchestrates widget lifecycle: fetch configs, batch-load data,
 * render each widget via its registered renderer, set up auto-refresh,
 * and expose add/remove/refresh helpers.
 *
 * Usage:
 *   WidgetRenderer.init()              - Called on DOMContentLoaded
 *   WidgetRenderer.registerRenderer(type, renderer) - Called by widget files
 *   WidgetRenderer.refreshSingleWidget(id)
 *   WidgetRenderer.removeWidget(id)
 *   WidgetRenderer.getWidgets()        - Returns current widget array
 *   WidgetRenderer.destroy()           - Clears all timers
 */
const WidgetRenderer = (function() {
  /** Map of widget_type -> { render(container, data, config) } */
  const WIDGET_RENDERERS = {};

  /** Array of widget config objects fetched from the backend */
  let widgets = [];

  /** Map of widgetId -> setInterval handle */
  let refreshTimers = {};

  /**
   * Register a renderer for a given widget type.
   * Called by each individual widget file on load.
   * @param {string} type - The widget_type string (e.g. 'metric_card')
   * @param {{ render: Function }} renderer - Object with a render method
   */
  function registerRenderer(type, renderer) {
    WIDGET_RENDERERS[type] = renderer;
  }

  /**
   * Initialize the widget grid.
   * Fetches widget configs, batch-loads data, renders each widget.
   * Safe to call multiple times (re-renders the grid).
   * @returns {Promise<void>}
   */
  async function init() {
    var container = document.getElementById('widgetGrid');
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="col-span-full text-center py-8">'
      + '<div class="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div>'
      + '<p class="text-gray-500 mt-3 text-sm">Loading widgets...</p>'
      + '</div>';

    // Clear existing refresh timers before re-init
    destroy();

    try {
      var response = await api.getDashboardWidgets({ limit: 50 });
      widgets = (response && response.data)
        ? (response.data.data || response.data)
        : [];

      if (!widgets || widgets.length === 0) {
        renderEmptyState(container);
        return;
      }

      // Batch-load data for all widgets in a single request
      var widgetIds = widgets.map(function(w) { return w.id; });
      var batchResponse = await api.getDashboardWidgetsBatchData(widgetIds);
      var batchData = (batchResponse && batchResponse.data) ? batchResponse.data : {};

      // Render each widget into the grid
      container.innerHTML = '';
      widgets.forEach(function(widget) {
        var widgetData = batchData[widget.id] || { data: [], error: null };
        renderWidget(container, widget, widgetData);
      });

    } catch (error) {
      console.error('[WidgetRenderer] Failed to load widgets', error);
      renderEmptyState(container);
    }
  }

  /**
   * Render a single widget into the grid container.
   * Creates the wrapper shell, wires action buttons, and calls the renderer.
   * @param {HTMLElement} container - The #widgetGrid element
   * @param {Object} widget - Widget config object from backend
   * @param {Object} widgetData - Pre-fetched data for this widget
   */
  function renderWidget(container, widget, widgetData) {
    var renderer = WIDGET_RENDERERS[widget.widget_type];
    if (!renderer) {
      console.warn('[WidgetRenderer] No renderer registered for type:', widget.widget_type);
      return;
    }

    // Create responsive grid wrapper
    var wrapper = document.createElement('div');
    wrapper.id = 'widget-' + widget.id;
    wrapper.className = getWidgetSizeClass(widget);

    wrapper.innerHTML = '<div class="bg-white rounded-xl shadow-sm border border-gray-100 h-full flex flex-col">'
      + '<div class="flex items-center justify-between p-4 border-b border-gray-100">'
      + '<h4 class="text-sm font-semibold text-gray-900">' + escapeHtml(widget.title || widget.widget_type) + '</h4>'
      + '<div class="flex items-center gap-1">'
      + '<button class="widget-refresh-btn p-1 text-gray-400 hover:text-gray-600 transition-colors" data-widget-id="' + widget.id + '" title="Refresh">'
      + '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>'
      + '</svg>'
      + '</button>'
      + '<button class="widget-remove-btn p-1 text-gray-400 hover:text-red-500 transition-colors" data-widget-id="' + widget.id + '" title="Remove widget">'
      + '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>'
      + '</svg>'
      + '</button>'
      + '</div>'
      + '</div>'
      + '<div class="widget-body flex-1 p-4 overflow-auto"></div>'
      + '</div>';

    container.appendChild(wrapper);

    // Render widget body content
    var body = wrapper.querySelector('.widget-body');
    try {
      renderer.render(body, widgetData, widget.config || {});
    } catch (err) {
      body.innerHTML = '<p class="text-sm text-red-500">Failed to render widget</p>';
      console.error('[WidgetRenderer] Render error for widget ' + widget.id + ':', err);
    }

    // Wire up refresh button
    wrapper.querySelector('.widget-refresh-btn').addEventListener('click', function() {
      refreshSingleWidget(widget.id);
    });

    // Wire up remove button
    wrapper.querySelector('.widget-remove-btn').addEventListener('click', function() {
      removeWidget(widget.id);
    });

    // Set up auto-refresh if configured
    if (widget.refresh_interval_seconds && widget.refresh_interval_seconds > 0) {
      refreshTimers[widget.id] = setInterval(function() {
        refreshSingleWidget(widget.id);
      }, widget.refresh_interval_seconds * 1000);
    }
  }

  /**
   * Determine the CSS grid span class based on widget type/size config.
   * Larger widget types get wider columns.
   * @param {Object} widget - Widget config object
   * @returns {string} Tailwind CSS class string
   */
  function getWidgetSizeClass(widget) {
    var config = widget.config || {};
    var size = config.size || 'small';

    if (size === 'large' || widget.widget_type === 'data_table') {
      return 'col-span-1 md:col-span-2 lg:col-span-3';
    }
    if (size === 'medium' || widget.widget_type === 'chart') {
      return 'col-span-1 md:col-span-2';
    }
    return 'col-span-1';
  }

  /**
   * Refresh a single widget by re-fetching its data and re-rendering.
   * Does not re-fetch widget config, only the live data.
   * @param {string} widgetId - UUID of the widget to refresh
   * @returns {Promise<void>}
   */
  async function refreshSingleWidget(widgetId) {
    try {
      var response = await api.getDashboardWidgetData(widgetId);
      var widgetData = (response && response.data) ? response.data : {};
      var widget = widgets.find(function(w) { return w.id === widgetId; });
      if (!widget) return;

      var body = document.querySelector('#widget-' + widgetId + ' .widget-body');
      if (!body) return;

      var renderer = WIDGET_RENDERERS[widget.widget_type];
      if (renderer) {
        body.innerHTML = '';
        try {
          renderer.render(body, widgetData, widget.config || {});
        } catch (err) {
          body.innerHTML = '<p class="text-sm text-red-500">Failed to render widget</p>';
          console.error('[WidgetRenderer] Render error on refresh for widget ' + widgetId + ':', err);
        }
      }
    } catch (err) {
      console.error('[WidgetRenderer] Refresh failed for widget ' + widgetId + ':', err);
    }
  }

  /**
   * Remove a widget from both the DOM and the backend.
   * Prompts for confirmation before deleting.
   * @param {string} widgetId - UUID of the widget to remove
   * @returns {Promise<void>}
   */
  async function removeWidget(widgetId) {
    if (!confirm('Remove this widget from your dashboard?')) return;

    try {
      await api.deleteDashboardWidget(widgetId);

      // Remove from DOM
      var el = document.getElementById('widget-' + widgetId);
      if (el) el.remove();

      // Remove from in-memory widget list
      widgets = widgets.filter(function(w) { return w.id !== widgetId; });

      // Clear auto-refresh timer
      if (refreshTimers[widgetId]) {
        clearInterval(refreshTimers[widgetId]);
        delete refreshTimers[widgetId];
      }

      // Show empty state if no widgets remain
      if (widgets.length === 0) {
        var container = document.getElementById('widgetGrid');
        if (container) renderEmptyState(container);
      }
    } catch (err) {
      console.error('[WidgetRenderer] Failed to remove widget ' + widgetId + ':', err);
    }
  }

  /**
   * Render the empty state when no widgets are configured.
   * Includes a call-to-action button that opens the config modal.
   * @param {HTMLElement} container - The #widgetGrid element
   */
  function renderEmptyState(container) {
    container.innerHTML = '<div class="col-span-full text-center py-12">'
      + '<svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path>'
      + '</svg>'
      + '<h4 class="text-lg font-medium text-gray-500 mb-2">No widgets configured</h4>'
      + '<p class="text-sm text-gray-400 mb-4">Add widgets to monitor your connected data sources</p>'
      + '<button id="emptyStateAddWidget" class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">'
      + '+ Add Widget'
      + '</button>'
      + '</div>';

    var btn = container.querySelector('#emptyStateAddWidget');
    if (btn) {
      btn.addEventListener('click', function() {
        if (typeof WidgetConfigModal !== 'undefined') {
          WidgetConfigModal.open();
        }
      });
    }
  }

  /**
   * Escape text for safe insertion into innerHTML.
   * Uses the browser's built-in text escaping via textContent.
   * @param {string} text - Raw text to escape
   * @returns {string} HTML-safe string
   */
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * Destroy all refresh timers and clear widget state.
   * Call before re-initializing or when leaving the dashboard page.
   */
  function destroy() {
    Object.keys(refreshTimers).forEach(function(id) {
      clearInterval(refreshTimers[id]);
    });
    refreshTimers = {};
    widgets = [];
  }

  // Public API
  return {
    init: init,
    registerRenderer: registerRenderer,
    refreshSingleWidget: refreshSingleWidget,
    removeWidget: removeWidget,
    destroy: destroy,
    /** Returns the current in-memory widget list. */
    getWidgets: function() { return widgets; }
  };
})();
