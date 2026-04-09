/**
 * Billable Hours Widget
 *
 * Displays organization-wide billable hours summary with total hours,
 * billable hours, amount, and status breakdown.
 *
 * Config options (widget.config):
 *   period {string} - 'today' | 'week' | 'month' (default 'today')
 *
 * Expected data shape from backend:
 *   { data: [{ total_hours, billable_hours, billable_amount, draft_count, submitted_count, approved_count, attorneys, period }] }
 */
(function() {
  WidgetRenderer.registerRenderer('billable_hours', {
    /**
     * Render the billable hours widget.
     * @param {HTMLElement} container - The .widget-body element
     * @param {Object} data - Live data returned by the backend
     * @param {Object} config - Widget config
     */
    render: function(container, data, config) {
      var row = null;
      if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
        row = data.data[0];
      }

      if (!row) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4 text-sm">No billable hours data available</div>';
        return;
      }

      var totalHours = row.total_hours || 0;
      var billableHours = row.billable_hours || 0;
      var billableAmount = row.billable_amount || 0;
      var draftCount = row.draft_count || 0;
      var submittedCount = row.submitted_count || 0;
      var approvedCount = row.approved_count || 0;
      var attorneys = row.attorneys || 0;
      var period = row.period || 'today';

      var periodLabel = period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month';
      var utilization = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0;

      // Determine utilization color
      var utilColor = 'text-gray-600';
      var utilBg = 'bg-gray-50';
      if (utilization >= 75) {
        utilColor = 'text-green-700';
        utilBg = 'bg-green-50';
      } else if (utilization >= 50) {
        utilColor = 'text-yellow-700';
        utilBg = 'bg-yellow-50';
      } else if (utilization > 0) {
        utilColor = 'text-red-700';
        utilBg = 'bg-red-50';
      }

      var html = '';

      // Period badge
      html += '<div class="text-xs text-gray-400 uppercase tracking-wide mb-3 font-semibold">' + escapeHtml(periodLabel) + '</div>';

      // Main metric — billable hours
      html += '<div class="text-3xl font-bold text-gray-900 tabular-nums">' + billableHours.toFixed(1) + '<span class="text-lg font-medium text-gray-400 ml-1">hrs</span></div>';

      // Billable amount
      html += '<div class="text-sm text-gray-500 mt-1">$' + formatMoney(billableAmount) + ' billable</div>';

      // Utilization bar
      html += '<div class="mt-4 mb-3">';
      html += '<div class="flex justify-between items-center mb-1">';
      html += '<span class="text-xs text-gray-500 font-medium">Utilization</span>';
      html += '<span class="text-xs font-semibold ' + utilColor + '">' + utilization + '%</span>';
      html += '</div>';
      html += '<div class="w-full bg-gray-100 rounded-full h-2">';
      html += '<div class="h-2 rounded-full transition-all" style="width:' + Math.min(utilization, 100) + '%;background:' + (utilization >= 75 ? '#16a34a' : utilization >= 50 ? '#ca8a04' : '#dc2626') + ';"></div>';
      html += '</div>';
      html += '</div>';

      // Status breakdown
      html += '<div class="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-gray-100">';
      html += '<div class="text-center">';
      html += '<div class="text-lg font-bold text-amber-600 tabular-nums">' + draftCount + '</div>';
      html += '<div class="text-xs text-gray-400">Drafts</div>';
      html += '</div>';
      html += '<div class="text-center">';
      html += '<div class="text-lg font-bold text-blue-600 tabular-nums">' + submittedCount + '</div>';
      html += '<div class="text-xs text-gray-400">Submitted</div>';
      html += '</div>';
      html += '<div class="text-center">';
      html += '<div class="text-lg font-bold text-green-600 tabular-nums">' + approvedCount + '</div>';
      html += '<div class="text-xs text-gray-400">Approved</div>';
      html += '</div>';
      html += '</div>';

      // Footer — attorneys count
      if (attorneys > 0) {
        html += '<div class="text-xs text-gray-400 mt-3 text-center">' + attorneys + ' attorney' + (attorneys !== 1 ? 's' : '') + ' tracked</div>';
      }

      container.innerHTML = html;
    }
  });

  function formatMoney(amount) {
    if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();
