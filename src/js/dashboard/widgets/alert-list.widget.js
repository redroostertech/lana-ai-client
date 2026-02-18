/**
 * Alert List Widget (Placeholder)
 *
 * Reserved for Phase 4: system-level alerts and notifications including
 * connector sync failures, document processing errors, storage warnings,
 * and matter deadline reminders.
 *
 * Currently renders a "coming soon" placeholder state.
 * Will be replaced with full implementation in Phase 4.
 *
 * Design system: bg-gray-50 rounded-xl border border-gray-200 container,
 * indigo icon color matching module-execution.html placeholder pattern.
 */
(function() {
  WidgetRenderer.registerRenderer('alert_list', {
    /**
     * Render the alert list placeholder.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data (unused in placeholder)
     * @param {Object} config - Widget config (unused in placeholder)
     */
    render: function(container, data, config) {
      container.innerHTML = '<div class="flex flex-col items-center justify-center py-8 px-4 bg-gray-50 rounded-xl border border-gray-200">'
        + '<svg class="w-10 h-10 text-indigo-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" '
        + 'd="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9">'
        + '</path>'
        + '</svg>'
        + '<p class="text-sm font-medium text-gray-500">Alerts coming soon</p>'
        + '<p class="text-xs text-gray-400 mt-1">Phase 4 feature</p>'
        + '</div>';
    }
  });
})();
