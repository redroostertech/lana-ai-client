/**
 * Management Board UI Components
 * Reusable UI rendering functions for management boards
 *
 * @description Provides standardized UI components for board display
 * @requires api.js - For user/org context
 */

const ManagementBoardComponents = {

  /**
   * Render board card for grid display
   * @param {Object} board - Board object
   * @returns {string} HTML string for board card
   */
  renderBoardCard(board) {
    const overdueCount = board.overdue_count || board.overdueCount || 0;
    const draftCount = board.draft_count || board.draftCount || 0;
    const metricCount = board.metric_count || board.metricCount || 0;

    return `
      <div class="bg-white rounded-lg shadow hover:shadow-lg transition-all p-6 cursor-pointer group"
           onclick="viewBoardDetail('${board.id}')">
        <div class="flex justify-between items-start mb-4">
          <div class="flex-1">
            <h3 class="text-lg font-semibold text-gray-900 group-hover:text-indigo-600 transition">
              ${this.escapeHtml(board.name)}
            </h3>
            <span class="inline-block px-2 py-1 text-xs font-medium rounded mt-2 ${this.getBoardTypeBadgeClass(board.board_type)}">
              ${this.formatBoardType(board.board_type)}
            </span>
          </div>
        </div>

        <p class="text-sm text-gray-600 mb-4 line-clamp-2">
          ${this.escapeHtml(board.description || 'No description provided')}
        </p>

        <div class="flex items-center justify-between text-sm pt-4 border-t border-gray-100">
          <div class="flex items-center text-gray-500">
            <i class="fas fa-chart-line mr-2"></i>
            <span>${metricCount} metric${metricCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="flex gap-2">
            ${overdueCount > 0 ? `
              <span class="flex items-center px-2 py-1 bg-red-50 text-red-600 rounded-full text-xs font-medium">
                <i class="fas fa-exclamation-circle mr-1"></i>
                ${overdueCount} overdue
              </span>
            ` : ''}
            ${draftCount > 0 ? `
              <span class="flex items-center px-2 py-1 bg-yellow-50 text-yellow-600 rounded-full text-xs font-medium">
                <i class="fas fa-edit mr-1"></i>
                ${draftCount} draft
              </span>
            ` : ''}
            ${overdueCount === 0 && draftCount === 0 ? `
              <span class="flex items-center px-2 py-1 bg-green-50 text-green-600 rounded-full text-xs font-medium">
                <i class="fas fa-check-circle mr-1"></i>
                All current
              </span>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render metric submission card
   * @param {Object} submission - Submission object
   * @returns {string} HTML string for submission card
   */
  renderSubmissionCard(submission) {
    const statusClass = this.getSubmissionStatusClass(submission);
    const statusText = this.getSubmissionStatusText(submission);

    return `
      <div class="border-l-4 border-indigo-500 bg-white rounded-r-lg shadow-sm p-4 hover:shadow transition">
        <div class="flex justify-between items-start mb-2">
          <div class="flex-1">
            <h4 class="font-medium text-gray-900">${this.escapeHtml(submission.metric_label)}</h4>
            <p class="text-sm text-gray-500">${this.escapeHtml(submission.board_name)}</p>
          </div>
          <span class="px-2 py-1 text-xs font-medium rounded ${statusClass}">
            ${statusText}
          </span>
        </div>

        <div class="flex items-center justify-between mt-3">
          <span class="text-2xl font-bold text-indigo-600">
            ${this.formatMetricValue(submission.value, submission.metric_type)}
          </span>
          <span class="text-sm text-gray-500">
            ${this.formatDate(submission.submission_date)}
          </span>
        </div>

        ${submission.notes ? `
          <p class="text-sm text-gray-600 mt-3 pt-3 border-t border-gray-100">
            ${this.escapeHtml(submission.notes)}
          </p>
        ` : ''}
      </div>
    `;
  },

  /**
   * Render table row for all boards view
   * @param {Object} board - Board object
   * @returns {string} HTML string for table row
   */
  renderBoardTableRow(board) {
    const metricCount = board.metric_count || board.metricCount || 0;
    const overdueCount = board.overdue_count || board.overdueCount || 0;
    const draftCount = board.draft_count || board.draftCount || 0;

    return `
      <tr class="hover:bg-gray-50 transition cursor-pointer" onclick="viewBoardDetail('${board.id}')">
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="text-sm font-medium text-gray-900">${this.escapeHtml(board.name)}</div>
          <div class="text-sm text-gray-500">${this.escapeHtml(board.description || '')}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 py-1 text-xs font-medium rounded ${this.getBoardTypeBadgeClass(board.board_type)}">
            ${this.formatBoardType(board.board_type)}
          </span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          ${metricCount}
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          ${overdueCount > 0 ? `
            <span class="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">
              ${overdueCount} overdue
            </span>
          ` : draftCount > 0 ? `
            <span class="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
              ${draftCount} draft
            </span>
          ` : `
            <span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
              Current
            </span>
          `}
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <button onclick="event.stopPropagation(); editBoard('${board.id}')" class="text-indigo-600 hover:text-indigo-900 mr-3">
            <i class="fas fa-edit"></i>
          </button>
          <button onclick="event.stopPropagation(); deleteBoard('${board.id}')" class="text-red-600 hover:text-red-900">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  },

  /**
   * Render empty state for My Boards
   * @returns {string} HTML string for empty state
   */
  renderEmptyState() {
    return `
      <div class="col-span-full max-w-2xl mx-auto text-center py-12 px-6">
        <div class="inline-flex items-center justify-center w-20 h-20 bg-indigo-100 rounded-full mb-6">
          <i class="fas fa-chart-line text-4xl text-indigo-600"></i>
        </div>

        <h3 class="text-2xl font-bold text-gray-900 mb-3">Welcome to Management Boards</h3>
        <p class="text-lg text-gray-600 mb-8">Track KPIs, monitor performance, and measure what matters most to your organization.</p>

        <div class="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8 text-left">
          <h4 class="font-semibold text-blue-900 mb-3 flex items-center">
            <i class="fas fa-lightbulb mr-2"></i>
            What are Management Boards?
          </h4>
          <p class="text-blue-800 mb-4">Management Boards help you organize and track key metrics across different areas of your practice:</p>
          <ul class="space-y-2 text-blue-800">
            <li class="flex items-start">
              <i class="fas fa-check-circle text-blue-600 mt-1 mr-2 flex-shrink-0"></i>
              <span><strong>Intake Boards:</strong> Track lead sources, consultations, and conversion rates</span>
            </li>
            <li class="flex items-start">
              <i class="fas fa-check-circle text-blue-600 mt-1 mr-2 flex-shrink-0"></i>
              <span><strong>Caseload Boards:</strong> Monitor active cases, resolution times, and outcomes</span>
            </li>
            <li class="flex items-start">
              <i class="fas fa-check-circle text-blue-600 mt-1 mr-2 flex-shrink-0"></i>
              <span><strong>Revenue Boards:</strong> Measure billing, collections, and financial performance</span>
            </li>
            <li class="flex items-start">
              <i class="fas fa-check-circle text-blue-600 mt-1 mr-2 flex-shrink-0"></i>
              <span><strong>Custom Boards:</strong> Create boards for any metric important to your firm</span>
            </li>
          </ul>
        </div>

        <div class="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8 text-left">
          <h4 class="font-semibold text-gray-900 mb-3 flex items-center">
            <i class="fas fa-rocket mr-2"></i>
            Getting Started
          </h4>
          <ol class="space-y-3 text-gray-700">
            <li class="flex items-start">
              <span class="inline-flex items-center justify-center w-6 h-6 bg-indigo-600 text-white rounded-full text-sm font-bold mr-3 flex-shrink-0">1</span>
              <span><strong>Create a Board:</strong> Click "New Board" and choose a board type that matches your goals</span>
            </li>
            <li class="flex items-start">
              <span class="inline-flex items-center justify-center w-6 h-6 bg-indigo-600 text-white rounded-full text-sm font-bold mr-3 flex-shrink-0">2</span>
              <span><strong>Add Metrics:</strong> Define the KPIs you want to track (numbers, percentages, or currency)</span>
            </li>
            <li class="flex items-start">
              <span class="inline-flex items-center justify-center w-6 h-6 bg-indigo-600 text-white rounded-full text-sm font-bold mr-3 flex-shrink-0">3</span>
              <span><strong>Assign Team:</strong> Grant access to team members who will submit and view metrics</span>
            </li>
            <li class="flex items-start">
              <span class="inline-flex items-center justify-center w-6 h-6 bg-indigo-600 text-white rounded-full text-sm font-bold mr-3 flex-shrink-0">4</span>
              <span><strong>Submit Data:</strong> Team members enter metrics on a daily, weekly, or monthly basis</span>
            </li>
            <li class="flex items-start">
              <span class="inline-flex items-center justify-center w-6 h-6 bg-indigo-600 text-white rounded-full text-sm font-bold mr-3 flex-shrink-0">5</span>
              <span><strong>Track Progress:</strong> Monitor trends, identify patterns, and make data-driven decisions</span>
            </li>
          </ol>
        </div>

        <button onclick="openNewBoardModal()" class="inline-flex items-center px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition transform hover:scale-105">
          <i class="fas fa-plus-circle text-xl mr-2"></i>
          Create Your First Board
        </button>
      </div>
    `;
  },

  /**
   * Render empty state for All Boards (admin view)
   * @returns {string} HTML string for empty state
   */
  renderAllBoardsEmptyState() {
    return `
      <div class="col-span-full max-w-xl mx-auto text-center py-12 px-6">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
          <i class="fas fa-clipboard-list text-3xl text-gray-400"></i>
        </div>
        <h3 class="text-xl font-bold text-gray-900 mb-2">No Boards Created Yet</h3>
        <p class="text-gray-600 mb-6">Your organization hasn't created any management boards yet.</p>
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-left">
          <p class="text-amber-900 text-sm">
            <i class="fas fa-info-circle mr-2"></i>
            <strong>Admin Tip:</strong> As an administrator, you can create boards that will be visible to all team members based on their assigned roles and permissions.
          </p>
        </div>
        <button onclick="openNewBoardModal()" class="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition">
          <i class="fas fa-plus mr-2"></i>
          Create First Board
        </button>
      </div>
    `;
  },

  /**
   * Render empty state for Submissions tab
   * @returns {string} HTML string for empty state
   */
  renderSubmissionsEmptyState() {
    return `
      <div class="col-span-full max-w-xl mx-auto text-center py-12 px-6">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <i class="fas fa-file-invoice text-3xl text-green-600"></i>
        </div>
        <h3 class="text-xl font-bold text-gray-900 mb-2">No Metric Submissions Yet</h3>
        <p class="text-gray-600 mb-6">Start tracking your performance by submitting metric data.</p>

        <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 text-left space-y-3">
          <div class="flex items-start">
            <i class="fas fa-check text-green-600 mt-1 mr-3 flex-shrink-0"></i>
            <p class="text-green-900 text-sm">Select a board from the "My Boards" tab to view available metrics</p>
          </div>
          <div class="flex items-start">
            <i class="fas fa-check text-green-600 mt-1 mr-3 flex-shrink-0"></i>
            <p class="text-green-900 text-sm">Submit metric values on the scheduled frequency (daily, weekly, or monthly)</p>
          </div>
          <div class="flex items-start">
            <i class="fas fa-check text-green-600 mt-1 mr-3 flex-shrink-0"></i>
            <p class="text-green-900 text-sm">Your submissions will appear here for review and tracking</p>
          </div>
        </div>

        <button onclick="document.getElementById('tab-my-boards').click()" class="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition">
          <i class="fas fa-arrow-left mr-2"></i>
          Go to My Boards
        </button>
      </div>
    `;
  },

  /**
   * Get badge class for board type
   * @param {string} type - Board type
   * @returns {string} CSS classes
   */
  getBoardTypeBadgeClass(type) {
    const classes = {
      'intake': 'bg-blue-100 text-blue-800',
      'caseload': 'bg-purple-100 text-purple-800',
      'revenue': 'bg-green-100 text-green-800',
      'custom': 'bg-gray-100 text-gray-800'
    };
    return classes[type] || classes.custom;
  },

  /**
   * Format board type for display
   * @param {string} type - Board type
   * @returns {string} Formatted type
   */
  formatBoardType(type) {
    const types = {
      'intake': 'Intake',
      'caseload': 'Caseload',
      'revenue': 'Revenue',
      'custom': 'Custom'
    };
    return types[type] || type;
  },

  /**
   * Get submission status class
   * @param {Object} submission - Submission object
   * @returns {string} CSS classes
   */
  getSubmissionStatusClass(submission) {
    if (submission.is_draft) {
      return 'bg-yellow-100 text-yellow-800';
    } else if (submission.approved_at) {
      return 'bg-blue-100 text-blue-800';
    } else {
      return 'bg-green-100 text-green-800';
    }
  },

  /**
   * Get submission status text
   * @param {Object} submission - Submission object
   * @returns {string} Status text
   */
  getSubmissionStatusText(submission) {
    if (submission.is_draft) {
      return 'Draft';
    } else if (submission.approved_at) {
      return 'Approved';
    } else {
      return 'Submitted';
    }
  },

  /**
   * Format metric value based on type
   * @param {number} value - Metric value
   * @param {string} type - Metric type (number/percentage/currency/boolean)
   * @returns {string} Formatted value
   */
  formatMetricValue(value, type) {
    switch (type) {
      case 'percentage':
        return `${value.toFixed(1)}%`;
      case 'currency':
        return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      case 'boolean':
        return value ? 'Yes' : 'No';
      default:
        return value.toLocaleString();
    }
  },

  /**
   * Format date for display
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted date
   */
  formatDate(dateString) {
    if (!dateString) return '';
    return Lex.Utils.formatDateLong(dateString, { month: 'short' });
  },

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ManagementBoardComponents;
}
