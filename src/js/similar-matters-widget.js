// src/js/similar-matters-widget.js
// Similar Matters Discovery Widget
// Displays semantically related matters with similarity scores and matching reasons

/**
 * SimilarMattersWidget
 *
 * A self-contained widget that finds and displays matters similar to the current matter.
 * Uses vector similarity, document overlap, party overlap, and temporal factors.
 *
 * Usage:
 * ```javascript
 * const widget = new SimilarMattersWidget(apiClient);
 * widget.initialize('containerId');
 * widget.loadSimilarMatters(matterId);
 * ```
 */
class SimilarMattersWidget {
  constructor(apiClient) {
    this.api = apiClient;
    this.containerId = null;
    this.matterId = null;
    this.similarMatters = [];
    this.showAll = false;
    this.limit = 10;
    this.threshold = 0.8;  // Default: only show 80%+ matches
    this.loading = false;
    this.error = null;
  }

  /**
   * Initialize the widget in a container
   * @param {string} containerId - DOM element ID to render widget into
   */
  initialize(containerId) {
    this.containerId = containerId;
    this.render();
  }

  /**
   * Load similar matters for a given matter ID
   * @param {string} matterId - Matter UUID
   * @param {Object} options - Search options
   */
  async loadSimilarMatters(matterId, options = {}) {
    this.matterId = matterId;
    this.limit = options.limit || 10;
    this.threshold = options.threshold || 0.8;  // Only show 80%+ matches
    this.loading = true;
    this.error = null;
    this.render();

    try {
      // Use the API client's baseUrl (note: lowercase 'baseUrl' not 'baseURL')
      const baseUrl = this.api.baseUrl || this.api.config?.API_BASE_URL || '';

      const response = await fetch(
        `${baseUrl}/api/v1/similar-matters/${matterId}?limit=${this.limit}&threshold=${this.threshold}`,
        {
          headers: {
            'Authorization': `Bearer ${this.api.token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load similar matters');
      }

      const data = await response.json();
      this.similarMatters = data.data.similar_matters || [];
      this.loading = false;
      this.error = null;
      this.render();

    } catch (error) {
      console.error('[Similar Matters Widget] Load failed:', error);
      this.loading = false;
      this.error = error.message;
      this.render();
    }
  }

  /**
   * Reload/refresh similar matters
   */
  async refresh() {
    if (this.matterId) {
      await this.loadSimilarMatters(this.matterId, {
        limit: this.limit,
        threshold: this.threshold
      });
    }
  }

  /**
   * Toggle show all / show less
   */
  toggleShowAll() {
    this.showAll = !this.showAll;
    this.render();
  }

  /**
   * Navigate to a similar matter
   * @param {string} matterId - Matter ID to navigate to
   */
  navigateToMatter(matterId) {
    // Emit event for parent to handle navigation
    const event = new CustomEvent('similar-matter-selected', {
      detail: { matterId }
    });
    document.dispatchEvent(event);
  }

  /**
   * Main render function
   */
  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.innerHTML = this.getHTML();
    this.attachEventListeners();
  }

  /**
   * Generate HTML for widget
   */
  getHTML() {
    if (this.loading) {
      return this.getLoadingHTML();
    }

    if (this.error) {
      return this.getErrorHTML();
    }

    if (!this.similarMatters || this.similarMatters.length === 0) {
      return this.getEmptyStateHTML();
    }

    return this.getSimilarMattersHTML();
  }

  /**
   * Loading state HTML
   */
  getLoadingHTML() {
    return `
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">Related Matters</h3>
          <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
        </div>

        <!-- Loading skeletons -->
        <div class="space-y-3">
          ${Array(3).fill(0).map(() => `
            <div class="animate-pulse">
              <div class="h-20 bg-gray-200 rounded-lg"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Error state HTML
   */
  getErrorHTML() {
    return `
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">Related Matters</h3>
        </div>

        <div class="text-center py-8">
          <svg class="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 class="mt-2 text-sm font-medium text-gray-900">Unable to load related matters</h3>
          <p class="mt-1 text-sm text-gray-500">${this.escapeHtml(this.error)}</p>
          <div class="mt-6">
            <button
              id="similar-matters-retry"
              type="button"
              class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <svg class="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Retry
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Empty state HTML
   */
  getEmptyStateHTML() {
    return `
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-gray-900">Related Matters</h3>
        </div>

        <div class="text-center py-8">
          <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 class="mt-2 text-sm font-medium text-gray-900">No similar matters found</h3>
          <p class="mt-1 text-sm text-gray-500">
            This matter is unique or needs more details for matching.
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Similar matters list HTML
   */
  getSimilarMattersHTML() {
    const displayCount = this.showAll ? this.similarMatters.length : Math.min(5, this.similarMatters.length);
    const matters = this.similarMatters.slice(0, displayCount);
    const hasMore = this.similarMatters.length > 5;

    return `
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-lg font-semibold text-gray-900">Related Matters</h3>
            <p class="text-sm text-gray-500 mt-1">
              Found ${this.similarMatters.length} similar ${this.similarMatters.length === 1 ? 'matter' : 'matters'}
            </p>
          </div>
          <button
            id="similar-matters-refresh"
            type="button"
            class="inline-flex items-center p-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            title="Refresh similar matters"
          >
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        <!-- Explanatory text -->
        <div class="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-r-lg shadow-sm">
          <div class="flex items-start">
            <svg class="flex-shrink-0 h-5 w-5 text-blue-600 mt-0.5 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div class="flex-1">
              <p class="text-sm font-medium text-gray-900 mb-1">How are these calculated?</p>
              <p class="text-sm text-gray-700">
                Related matters are found using AI-powered semantic similarity that analyzes <strong>matter descriptions (60%)</strong>, <strong>shared document types (15%)</strong>, <strong>common parties (15%)</strong>, and <strong>recent activity (10%)</strong>. Only matters with <strong>80% or higher similarity</strong> are shown to ensure high-quality matches.
              </p>
            </div>
          </div>
        </div>

        <!-- Matters list -->
        <div class="space-y-3">
          ${matters.map(matter => this.getMatterCardHTML(matter)).join('')}
        </div>

        <!-- Show more/less button -->
        ${hasMore ? `
          <div class="mt-4 text-center">
            <button
              id="similar-matters-toggle"
              type="button"
              class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              ${this.showAll ? `
                <svg class="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                </svg>
                Show Less
              ` : `
                <svg class="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
                Show All (${this.similarMatters.length})
              `}
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Individual matter card HTML
   */
  getMatterCardHTML(matter) {
    const scoreColor = this.getScoreColor(matter.combined_score);
    const scorePercentage = Math.round(matter.combined_score * 100);

    return `
      <div
        class="similar-matter-card border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer"
        data-matter-id="${this.escapeHtml(matter.matter_id)}"
      >
        <div class="flex items-start justify-between">
          <!-- Matter info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center space-x-2">
              <span class="text-sm font-medium text-indigo-600">
                ${this.escapeHtml(matter.matter_id)}
              </span>
              ${matter.status ? `
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${this.getStatusBadgeClass(matter.status)}">
                  ${this.escapeHtml(matter.status)}
                </span>
              ` : ''}
            </div>

            <h4 class="mt-1 text-sm font-medium text-gray-900 truncate">
              ${this.escapeHtml(matter.name)}
            </h4>

            ${matter.client_name ? `
              <p class="mt-1 text-sm text-gray-500 truncate">
                ${this.escapeHtml(matter.client_name)}
              </p>
            ` : ''}

            <!-- Matching reasons -->
            <div class="mt-2 flex flex-wrap gap-1">
              ${matter.matching_reasons.slice(0, 2).map(reason => `
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                  ${this.escapeHtml(reason)}
                </span>
              `).join('')}
              ${matter.matching_reasons.length > 2 ? `
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                  +${matter.matching_reasons.length - 2} more
                </span>
              ` : ''}
            </div>

            <!-- Score breakdown -->
            <div class="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500">
              <div class="flex items-center">
                <svg class="h-4 w-4 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                ${matter.document_count || 0} docs
              </div>
              <div class="flex items-center">
                <svg class="h-4 w-4 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                ${this.formatDate(matter.updated_at)}
              </div>
            </div>
          </div>

          <!-- Similarity score -->
          <div class="ml-4 flex-shrink-0 text-center">
            <div class="relative inline-flex items-center justify-center w-16 h-16">
              <!-- Background circle -->
              <svg class="w-full h-full transform -rotate-90">
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="currentColor"
                  stroke-width="4"
                  fill="none"
                  class="text-gray-200"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="currentColor"
                  stroke-width="4"
                  fill="none"
                  class="${scoreColor}"
                  stroke-dasharray="${2 * Math.PI * 28}"
                  stroke-dashoffset="${2 * Math.PI * 28 * (1 - matter.combined_score)}"
                  stroke-linecap="round"
                />
              </svg>
              <div class="absolute inset-0 flex items-center justify-center">
                <span class="text-sm font-bold text-gray-900">${scorePercentage}%</span>
              </div>
            </div>
            <div class="mt-1 text-xs text-gray-500">match</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners after render
   */
  attachEventListeners() {
    // Retry button
    const retryBtn = document.getElementById('similar-matters-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.refresh());
    }

    // Refresh button
    const refreshBtn = document.getElementById('similar-matters-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refresh());
    }

    // Show more/less button
    const toggleBtn = document.getElementById('similar-matters-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleShowAll());
    }

    // Matter cards
    const cards = document.querySelectorAll('.similar-matter-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const matterId = card.dataset.matterId;
        this.navigateToMatter(matterId);
      });
    });
  }

  /**
   * Get color class for similarity score
   */
  getScoreColor(score) {
    if (score >= 0.8) return 'text-green-500';
    if (score >= 0.6) return 'text-blue-500';
    if (score >= 0.4) return 'text-yellow-500';
    return 'text-gray-400';
  }

  /**
   * Get badge class for matter status
   */
  getStatusBadgeClass(status) {
    const statusLower = status.toLowerCase();
    if (statusLower === 'active') return 'bg-green-100 text-green-800';
    if (statusLower === 'closed') return 'bg-gray-100 text-gray-800';
    if (statusLower === 'pending') return 'bg-yellow-100 text-yellow-800';
    return 'bg-blue-100 text-blue-800';
  }

  /**
   * Format date for display
   */
  formatDate(dateString) {
    if (!dateString) return 'N/A';
    return LanaTime.timeAgo(dateString) || 'N/A';
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Reset widget state
   */
  reset() {
    this.matterId = null;
    this.similarMatters = [];
    this.showAll = false;
    this.loading = false;
    this.error = null;
    this.render();
  }
}

// Make available globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SimilarMattersWidget;
}
