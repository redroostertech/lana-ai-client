/**
 * Module Metric Widget (Placeholder)
 *
 * Reserved for Phase 3: module-level key performance indicators
 * such as workflow completion rates, document processing throughput,
 * and chat session usage metrics.
 *
 * Currently renders a "coming soon" placeholder state.
 * Will be replaced with full implementation in Phase 3.
 *
 * Design system: bg-gray-50 rounded-xl border border-gray-200 container,
 * indigo icon color matching module-execution.html placeholder pattern.
 */
(function() {
  WidgetRenderer.registerRenderer('module_metric', {
    /**
     * Render the module metric placeholder.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data (unused in placeholder)
     * @param {Object} config - Widget config (unused in placeholder)
     */
    render: function(container, data, config) {
      container.innerHTML = '<div class="flex flex-col items-center justify-center py-8 px-4 bg-gray-50 rounded-xl border border-gray-200">'
        + '<svg class="w-10 h-10 text-indigo-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" '
        + 'd="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z">'
        + '</path>'
        + '</svg>'
        + '<p class="text-sm font-medium text-gray-500">Module metrics coming soon</p>'
        + '<p class="text-xs text-gray-400 mt-1">Phase 3 feature</p>'
        + '</div>';
    }
  });
})();
