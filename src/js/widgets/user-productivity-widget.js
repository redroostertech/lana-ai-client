/**
 * User Productivity Widget
 * Displays personal productivity metrics on the dashboard
 *
 * @requires api.js - Base API client
 * @requires session-tracking-service.js - Session tracking API
 */

const UserProductivityWidget = {
  widgetId: 'userProductivityWidget',
  refreshInterval: null,
  currentData: null,

  /**
   * Initialize the widget
   */
  async init() {
    try {
      await this.loadData();

      // Setup auto-refresh (every 5 minutes)
      this.refreshInterval = setInterval(() => {
        this.loadData(false); // Silent refresh
      }, 5 * 60 * 1000);

      // Setup manual refresh button
      this.setupEventListeners();

    } catch (error) {
      console.error('[UserProductivityWidget] Initialization error:', error);
      this.renderError('Failed to load productivity data');
    }
  },

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    const refreshBtn = document.getElementById('refreshProductivityBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await this.loadData(true); // Show loading state
      });
    }
  },

  /**
   * Load widget data from API
   * @param {boolean} showLoading - Show loading indicator
   */
  async loadData(showLoading = true) {
    try {
      const widget = document.getElementById(this.widgetId);
      if (!widget) return;

      if (showLoading) {
        this.renderLoading();
      }

      // Fetch user's personal analytics
      // Note: Backend should return current user's data when no user_id specified
      const response = await SessionTrackingService.getTeamAnalytics({ range: '7d' });

      // Filter to current user's data
      const currentUserId = api.user?.id;
      if (currentUserId && response?.data?.top_contributors) {
        const userData = response.data.top_contributors.find(u => u.user_id === currentUserId);

        if (userData) {
          this.currentData = {
            sessionsCount: userData.sessions_count || 0,
            totalActiveTime: userData.total_active_time_seconds || 0,
            focusPercentage: userData.focus_percentage || 0,
            topMatter: this.extractTopMatter(response.data),
          };
        } else {
          // User has no sessions in this period
          this.currentData = {
            sessionsCount: 0,
            totalActiveTime: 0,
            focusPercentage: 0,
            topMatter: null,
          };
        }
      } else {
        // Fallback to summary data
        this.currentData = {
          sessionsCount: response?.data?.summary?.total_sessions || 0,
          totalActiveTime: response?.data?.summary?.total_active_time_seconds || 0,
          focusPercentage: response?.data?.summary?.focus_percentage || 0,
          topMatter: null,
        };
      }

      this.render();

    } catch (error) {
      console.error('[UserProductivityWidget] Error loading data:', error);
      this.renderError('Failed to load productivity data');
    }
  },

  /**
   * Extract top matter from analytics data
   * @param {Object} data - Analytics data
   * @returns {Object|null} Top matter info
   */
  extractTopMatter(data) {
    // This would ideally come from a per-user endpoint
    // For now, return null (feature for future enhancement)
    return null;
  },

  /**
   * Render widget content
   */
  render() {
    const widget = document.getElementById(this.widgetId);
    if (!widget) return;

    const { sessionsCount, totalActiveTime, focusPercentage, topMatter } = this.currentData;

    // Determine if user has data
    const hasData = sessionsCount > 0;

    if (!hasData) {
      this.renderNoData();
      return;
    }

    // Format data
    const formattedTime = this.formatDuration(totalActiveTime);
    const focusPct = focusPercentage.toFixed(1);

    // Determine focus color
    let focusColor = 'text-green-600';
    let focusBgColor = 'bg-green-100';
    if (focusPercentage < 60) {
      focusColor = 'text-red-600';
      focusBgColor = 'bg-red-100';
    } else if (focusPercentage < 75) {
      focusColor = 'text-yellow-600';
      focusBgColor = 'bg-yellow-100';
    }

    widget.innerHTML = `
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
          </svg>
          <h3 class="text-lg font-semibold text-gray-900">My Productivity</h3>
        </div>
        <button id="refreshProductivityBtn" class="text-gray-400 hover:text-gray-600 transition-colors" title="Refresh">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
        </button>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-3 gap-4 mb-4">
        <!-- Sessions -->
        <div class="text-center">
          <div class="text-2xl font-bold text-gray-900 mb-1">${sessionsCount}</div>
          <div class="text-xs text-gray-500">Sessions</div>
        </div>

        <!-- Active Time -->
        <div class="text-center">
          <div class="text-2xl font-bold text-indigo-600 mb-1">${formattedTime}</div>
          <div class="text-xs text-gray-500">Active Time</div>
        </div>

        <!-- Focus % -->
        <div class="text-center">
          <div class="text-2xl font-bold ${focusColor} mb-1">${focusPct}%</div>
          <div class="text-xs text-gray-500">Focus</div>
        </div>
      </div>

      <!-- Focus Bar -->
      <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-gray-700">Focus Time</span>
          <span class="text-sm ${focusColor} font-medium">${focusPct}%</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-2.5">
          <div class="${focusBgColor} h-2.5 rounded-full transition-all duration-500" style="width: ${focusPct}%"></div>
        </div>
      </div>

      ${topMatter ? `
        <!-- Top Matter -->
        <div class="bg-indigo-50 rounded-lg p-3">
          <div class="text-xs text-indigo-700 font-medium mb-1">Top Matter</div>
          <div class="text-sm text-gray-900">${topMatter.name}</div>
          <div class="text-xs text-gray-500 mt-1">${this.formatDuration(topMatter.time)} spent</div>
        </div>
      ` : `
        <!-- Last 7 Days Label -->
        <div class="text-center pt-2 border-t border-gray-200">
          <div class="text-xs text-gray-500">Last 7 days</div>
        </div>
      `}
    `;

    // Re-attach event listener for refresh button
    this.setupEventListeners();
  },

  /**
   * Render loading state
   */
  renderLoading() {
    const widget = document.getElementById(this.widgetId);
    if (!widget) return;

    widget.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12">
        <div class="animate-spin w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full mb-3"></div>
        <p class="text-sm text-gray-500">Loading productivity data...</p>
      </div>
    `;
  },

  /**
   * Render error state
   * @param {string} message - Error message
   */
  renderError(message) {
    const widget = document.getElementById(this.widgetId);
    if (!widget) return;

    widget.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <svg class="w-12 h-12 text-red-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p class="text-sm text-gray-600 mb-3">${message}</p>
        <button id="refreshProductivityBtn" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition">
          Try Again
        </button>
      </div>
    `;

    // Re-attach event listener
    this.setupEventListeners();
  },

  /**
   * Render no data state (user is new or inactive)
   */
  renderNoData() {
    const widget = document.getElementById(this.widgetId);
    if (!widget) return;

    widget.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
          </svg>
          <h3 class="text-lg font-semibold text-gray-900">My Productivity</h3>
        </div>
      </div>

      <div class="flex flex-col items-center justify-center py-8 text-center">
        <svg class="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
        </svg>
        <h4 class="text-base font-medium text-gray-900 mb-2">No Activity Yet</h4>
        <p class="text-sm text-gray-500 mb-4 px-4">
          Start using LANA AI to track your productivity metrics
        </p>
        <button id="refreshProductivityBtn" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
          Refresh Data
        </button>
      </div>
    `;

    // Re-attach event listener
    this.setupEventListeners();
  },

  /**
   * Format seconds into human-readable duration
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration
   */
  formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0m';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
  },

  /**
   * Destroy the widget (cleanup)
   */
  destroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.currentData = null;
  }
};

// Auto-initialize on DOM ready if widget container exists
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('userProductivityWidget')) {
    UserProductivityWidget.init();
  }
});
