/**
 * Team Performance Board - Modal Renderer
 * Full-screen modal renderer for Team Performance system board
 *
 * @requires session-tracking-service.js - Session tracking API
 * @requires Chart.js - Loaded via CDN
 */

class TeamPerformanceBoard {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.options = {
      dateRange: options.dateRange || '7d',
      refreshInterval: options.refreshInterval || 300000, // 5 minutes
      isModal: options.isModal || false,
      onClose: options.onClose || null,
      ...options
    };
    this.refreshTimer = null;
    this.chartInstances = {};
    this.currentUser = null;
  }

  /**
   * Initialize board
   */
  async init() {
    try {
      console.log('[TeamPerformanceBoard] Initializing...');

      // Get current user
      if (typeof api !== 'undefined' && api.user) {
        this.currentUser = api.user;
      } else {
        // Fetch user profile
        const response = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        if (response.ok) {
          this.currentUser = await response.json();
        }
      }

      // Check admin authorization (check role name, not level)
      const roleName = this.currentUser?.role?.name || this.currentUser?.role_name || '';
      const isAdmin = ['system_admin', 'org_admin', 'admin', 'System Administrator', 'system_administrator'].includes(roleName);

      if (!isAdmin) {
        this.renderError('Unauthorized', 'Admin access required to view this board.');
        return;
      }

      // Render loading state
      this.renderLoading();

      // Fetch analytics data
      const response = await SessionTrackingService.getTeamAnalytics(this.options.dateRange);

      // Transform API response (snake_case) to UI format (camelCase)
      const analytics = this.transformApiResponse(response);

      // Render board
      this.render(analytics);

      // Setup auto-refresh
      this.startAutoRefresh();

      console.log('[TeamPerformanceBoard] Initialized successfully');
    } catch (error) {
      console.error('[TeamPerformanceBoard] Initialization failed:', error);
      this.renderError('Failed to Load', error.message || 'An unexpected error occurred');
    }
  }

  /**
   * Render loading state
   */
  renderLoading() {
    this.container.innerHTML = `
      <div class="flex flex-col h-full">
        <!-- Header -->
        <div class="flex-shrink-0 bg-white border-b border-gray-200 px-8 py-6">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-3xl font-bold text-gray-900">Team Performance</h2>
              <p class="text-gray-600 mt-1">Real-time productivity insights and team metrics</p>
            </div>
            ${this.options.isModal ? `
              <button onclick="closeTeamPerformanceModal()" class="text-gray-400 hover:text-gray-600 transition">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Loading State -->
        <div class="flex-1 flex items-center justify-center bg-gray-50">
          <div class="text-center">
            <div class="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mx-auto mb-4"></div>
            <p class="text-gray-600 text-lg">Loading team performance data...</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render error state
   */
  renderError(title, message) {
    this.container.innerHTML = `
      <div class="flex flex-col h-full">
        <!-- Header -->
        <div class="flex-shrink-0 bg-white border-b border-gray-200 px-8 py-6">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-3xl font-bold text-gray-900">Team Performance</h2>
              <p class="text-gray-600 mt-1">Real-time productivity insights and team metrics</p>
            </div>
            ${this.options.isModal ? `
              <button onclick="closeTeamPerformanceModal()" class="text-gray-400 hover:text-gray-600 transition">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Error State -->
        <div class="flex-1 flex items-center justify-center bg-gray-50 p-8">
          <div class="bg-red-50 border-2 border-red-200 rounded-xl p-8 max-w-md">
            <div class="flex items-start">
              <svg class="w-8 h-8 text-red-600 mr-4 mt-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <div>
                <h3 class="text-xl font-semibold text-red-900 mb-2">${title}</h3>
                <p class="text-red-700">${message}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render main board layout
   */
  render(analytics) {
    this.container.innerHTML = `
      <div class="flex flex-col h-full">
        <!-- Header -->
        <div class="flex-shrink-0 bg-white border-b border-gray-200 px-8 py-6">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-3xl font-bold text-gray-900">Team Performance</h2>
              <p class="text-gray-600 mt-1">Last ${this.getDateRangeLabel()}</p>
            </div>
            <div class="flex items-center gap-3">
              <!-- Date Range Selector -->
              <div class="flex bg-gray-100 rounded-lg p-1">
                <button data-range="7d" class="px-4 py-2 text-sm font-medium rounded-md ${this.options.dateRange === '7d' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}">7 Days</button>
                <button data-range="30d" class="px-4 py-2 text-sm font-medium rounded-md ${this.options.dateRange === '30d' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}">30 Days</button>
                <button data-range="90d" class="px-4 py-2 text-sm font-medium rounded-md ${this.options.dateRange === '90d' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}">90 Days</button>
              </div>

              <!-- Refresh Button -->
              <button id="refreshBtn" class="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </button>

              <!-- Close Button (if modal) -->
              ${this.options.isModal ? `
                <button onclick="closeTeamPerformanceModal()" class="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto bg-gray-50 p-8">
          <!-- Section 1: Team Performance Overview -->
          <div class="mb-8">
            <h3 class="text-xl font-semibold text-gray-900 mb-4">Team Performance Overview</h3>
            <div id="kpi-cards" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <!-- KPI cards will be rendered here -->
            </div>
          </div>

          <!-- Section 2: Feature Adoption & Hot Areas -->
          <div class="mb-8">
            <h3 class="text-xl font-semibold text-gray-900 mb-4">Feature Adoption & Hot Areas</h3>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div id="usage-breakdown-chart" class="bg-white rounded-lg shadow p-6">
                <h4 class="text-lg font-semibold text-gray-800 mb-4">Usage by Feature</h4>
                <canvas id="usage-pie-chart"></canvas>
              </div>
              <div id="improvement-opportunities" class="bg-white rounded-lg shadow p-6">
                <h4 class="text-lg font-semibold text-gray-800 mb-4">Improvement Opportunities</h4>
                <div id="opportunities-list">
                  <!-- Opportunities will be rendered here -->
                </div>
              </div>
            </div>
          </div>

          <!-- Section 3: Top Contributors -->
          <div class="mb-8">
            <h3 class="text-xl font-semibold text-gray-900 mb-4">Top Contributors</h3>
            <div id="leaderboard-container" class="bg-white rounded-lg shadow overflow-hidden">
              <!-- Leaderboard table will be rendered here -->
            </div>
          </div>
        </div>
      </div>

      <!-- User Drill-Down Modal -->
      <div id="user-drilldown-modal" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div class="flex items-center justify-between p-6 border-b flex-shrink-0">
            <h3 id="modal-user-name" class="text-2xl font-bold text-gray-900"></h3>
            <button id="close-modal-btn" class="text-gray-500 hover:text-gray-700 transition">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div id="modal-content" class="flex-1 overflow-y-auto p-6">
            <!-- User session timeline will be rendered here -->
          </div>
        </div>
      </div>
    `;

    // Render sub-components
    this.renderKPICards(analytics.overview);
    this.renderUsageBreakdown(analytics.featureAdoption);
    this.renderImprovementOpportunities(analytics.featureAdoption);
    this.renderLeaderboard(analytics.topContributors);

    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Get date range label
   */
  getDateRangeLabel() {
    const labels = {
      '7d': '7 Days',
      '30d': '30 Days',
      '90d': '90 Days'
    };
    return labels[this.options.dateRange] || '7 Days';
  }

  /**
   * Transform API response from snake_case to camelCase and restructure for UI
   */
  transformApiResponse(response) {
    // API returns: { status: 'success', data: { time_range, active_users_count, total_sessions, avg_session_duration_seconds, top_users } }
    const data = response?.data || {};

    // Calculate engagement rate (users with >30min avg session / total users)
    const topUsers = data.top_users || [];
    const engagedUsers = topUsers.filter(u => u.avg_session_duration_seconds > 1800).length;
    const engagementRate = topUsers.length > 0 ? engagedUsers / topUsers.length : 0;

    return {
      overview: {
        activeUsers: data.active_users_count || 0,
        totalSessions: data.total_sessions || 0,
        avgSessionDuration: data.avg_session_duration_seconds || 0,
        engagementRate: engagementRate
      },
      featureAdoption: {
        breakdown: (data.feature_adoption || []).map(feature => ({
          feature: feature.feature_name,
          percentage: feature.usage_percentage,
          usageCount: feature.usage_count,
          uniqueUsers: feature.unique_users
        })),
        improvementOpportunities: (data.improvement_opportunities || []).map(opp => ({
          feature: opp.feature,
          currentAdoption: opp.currentAdoption,
          suggestion: opp.suggestion
        }))
      },
      topContributors: topUsers.map(user => ({
        userId: user.user_id,
        userName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
        email: user.email,
        sessionsCount: user.session_count || 0,
        avgSessionDuration: user.avg_session_duration_seconds || 0,
        lastActiveAt: user.last_active_at
      }))
    };
  }

  /**
   * Render KPI cards
   */
  renderKPICards(overview) {
    const container = document.getElementById('kpi-cards');
    if (!container) return;

    const kpis = [
      {
        label: 'Active Users',
        value: overview.activeUsers || 0,
        icon: 'users',
        color: 'blue',
        bgColor: 'rgba(59, 130, 246, 0.1)',
        iconColor: '#3B82F6'
      },
      {
        label: 'Avg Session Duration',
        value: this.formatDuration(overview.avgSessionDuration || 0),
        icon: 'clock',
        color: 'green',
        bgColor: 'rgba(16, 185, 129, 0.1)',
        iconColor: '#10B981'
      },
      {
        label: 'Total Sessions',
        value: (overview.totalSessions || 0).toLocaleString(),
        icon: 'activity',
        color: 'purple',
        bgColor: 'rgba(139, 92, 246, 0.1)',
        iconColor: '#8B5CF6'
      },
      {
        label: 'Engagement Rate',
        value: `${Math.round((overview.engagementRate || 0) * 100)}%`,
        icon: 'trending-up',
        color: 'orange',
        bgColor: 'rgba(245, 158, 11, 0.1)',
        iconColor: '#F59E0B'
      }
    ];

    container.innerHTML = kpis.map(kpi => `
      <div class="bg-white rounded-lg overflow-hidden border border-gray-200 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5" style="box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);">
        <div class="p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-md flex items-center justify-center" style="background-color: ${kpi.bgColor};">
                <svg class="w-5 h-5" style="color: ${kpi.iconColor};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  ${this.getIconSVG(kpi.icon)}
                </svg>
              </div>
              <span class="text-sm font-medium text-gray-600" style="letter-spacing: -0.01em;">${kpi.label}</span>
            </div>
          </div>
          <div class="text-3xl font-bold text-gray-900" style="letter-spacing: -0.02em;">${kpi.value}</div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Render usage breakdown pie chart
   */
  renderUsageBreakdown(featureAdoption) {
    const canvas = document.getElementById('usage-pie-chart');
    if (!canvas) return;

    // Handle empty or missing data
    if (!featureAdoption || !featureAdoption.breakdown || featureAdoption.breakdown.length === 0) {
      // Hide the chart canvas and show "no data" message
      canvas.style.display = 'none';
      const chartContainer = canvas.closest('.bg-white');
      if (chartContainer) {
        const noDataDiv = document.createElement('div');
        noDataDiv.className = 'flex items-center justify-center py-12 text-gray-500';
        noDataDiv.innerHTML = `
          <svg class="w-12 h-12 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
          <p>Feature usage tracking coming soon</p>
        `;
        chartContainer.appendChild(noDataDiv);
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    const labels = featureAdoption.breakdown.map(item => item.feature);
    const data = featureAdoption.breakdown.map(item => item.percentage);

    // Destroy existing chart if present
    if (this.chartInstances.usagePieChart) {
      this.chartInstances.usagePieChart.destroy();
    }

    this.chartInstances.usagePieChart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: [
            '#3B82F6',  // blue
            '#10B981',  // green
            '#F59E0B',  // orange
            '#8B5CF6',  // purple
            '#EF4444',  // red
            '#6B7280'   // gray
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom'
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return `${context.label}: ${context.parsed}%`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Render improvement opportunities
   */
  renderImprovementOpportunities(featureAdoption) {
    const container = document.getElementById('opportunities-list');
    if (!container) return;

    if (!featureAdoption.improvementOpportunities || featureAdoption.improvementOpportunities.length === 0) {
      container.innerHTML = `
        <div class="flex items-center justify-center py-8 text-gray-500">
          <svg class="w-12 h-12 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p>No improvement opportunities identified - great work!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = featureAdoption.improvementOpportunities.map(opportunity => `
      <div class="border-l-4 border-yellow-500 bg-yellow-50 p-4 mb-3 rounded-r-lg hover:bg-yellow-100 transition">
        <div class="flex items-start">
          <svg class="w-5 h-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <div class="flex-1">
            <p class="font-semibold text-gray-900 mb-1">${opportunity.feature}</p>
            <p class="text-gray-700 text-sm mb-2">${opportunity.suggestion}</p>
            <span class="inline-block bg-yellow-200 text-yellow-800 text-xs px-2 py-1 rounded">Low adoption: ${opportunity.currentAdoption}%</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  /**
   * Render leaderboard table
   */
  renderLeaderboard(topContributors) {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    if (!topContributors || topContributors.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-500">
          <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
          </svg>
          <p class="text-lg font-medium">No contributor data available</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="w-full">
        <thead class="bg-gray-50 border-b border-gray-200">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sessions</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Time</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Duration</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          ${topContributors.map((user, index) => `
            <tr class="hover:bg-gray-50 transition">
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="inline-flex items-center justify-center w-8 h-8 rounded-full ${
                  index === 0 ? 'bg-yellow-100 text-yellow-800' :
                  index === 1 ? 'bg-gray-100 text-gray-800' :
                  index === 2 ? 'bg-orange-100 text-orange-800' :
                  'bg-gray-50 text-gray-600'
                } font-semibold text-sm">
                  ${index + 1}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <div class="flex items-center">
                  <div class="w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center font-semibold mr-3">
                    ${user.userName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div class="text-sm font-medium text-gray-900">${user.userName}</div>
                    <div class="text-sm text-gray-500">${user.userEmail || ''}</div>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${user.sessionCount}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${this.formatDuration(user.totalActiveTime)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${this.formatDuration(user.avgSessionDuration)}</td>
              <td class="px-6 py-4 whitespace-nowrap text-sm">
                <button
                  class="text-indigo-600 hover:text-indigo-800 font-medium view-details-btn"
                  data-user-id="${user.userId}"
                  data-user-name="${user.userName}"
                >
                  View Details →
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Date range selector
    const rangeButtons = document.querySelectorAll('[data-range]');
    rangeButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const range = e.currentTarget.dataset.range;
        if (range === this.options.dateRange) return;

        this.options.dateRange = range;
        await this.refresh();
      });
    });

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await this.refresh();
      });
    }

    // View details buttons
    document.querySelectorAll('.view-details-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.currentTarget.dataset.userId;
        const userName = e.currentTarget.dataset.userName;
        await this.showUserDrillDown(userId, userName);
      });
    });

    // Close modal button
    const closeModalBtn = document.getElementById('close-modal-btn');
    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', () => {
        this.hideUserDrillDown();
      });
    }

    // Close modal on backdrop click
    const drilldownModal = document.getElementById('user-drilldown-modal');
    if (drilldownModal) {
      drilldownModal.addEventListener('click', (e) => {
        if (e.target.id === 'user-drilldown-modal') {
          this.hideUserDrillDown();
        }
      });
    }
  }

  /**
   * Show user drill-down modal
   */
  async showUserDrillDown(userId, userName) {
    try {
      const modal = document.getElementById('user-drilldown-modal');
      const modalContent = document.getElementById('modal-content');
      const modalUserName = document.getElementById('modal-user-name');

      // Show modal with loading state
      modal.classList.remove('hidden');
      modalUserName.textContent = userName;
      modalContent.innerHTML = `
        <div class="text-center py-12">
          <div class="animate-spin rounded-full h-12 w-12 border-b-4 border-indigo-600 mx-auto"></div>
          <p class="text-gray-600 mt-4">Loading session details...</p>
        </div>
      `;

      // Fetch user session details
      const userAnalytics = await SessionTrackingService.getTeamAnalytics(this.options.dateRange, userId);

      // Render session timeline
      this.renderUserSessionTimeline(modalContent, userAnalytics);
    } catch (error) {
      console.error('[TeamPerformanceBoard] Failed to load user details:', error);
      const modalContent = document.getElementById('modal-content');
      modalContent.innerHTML = `
        <div class="text-center py-12">
          <svg class="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-red-600 font-medium">Failed to load user details</p>
          <p class="text-gray-600 text-sm mt-2">${error.message}</p>
        </div>
      `;
    }
  }

  /**
   * Hide user drill-down modal
   */
  hideUserDrillDown() {
    const modal = document.getElementById('user-drilldown-modal');
    modal.classList.add('hidden');
  }

  /**
   * Render user session timeline
   */
  renderUserSessionTimeline(container, analytics) {
    const sessions = analytics.userSessions || [];

    if (sessions.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-lg font-medium">No session data available</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="space-y-6">
        <!-- Summary cards -->
        <div class="grid grid-cols-3 gap-4">
          <div class="bg-blue-50 rounded-lg p-4">
            <div class="text-sm text-gray-600 mb-1">Total Sessions</div>
            <div class="text-2xl font-bold text-gray-900">${sessions.length}</div>
          </div>
          <div class="bg-green-50 rounded-lg p-4">
            <div class="text-sm text-gray-600 mb-1">Total Active Time</div>
            <div class="text-2xl font-bold text-gray-900">${this.formatDuration(analytics.totalActiveTime || 0)}</div>
          </div>
          <div class="bg-purple-50 rounded-lg p-4">
            <div class="text-sm text-gray-600 mb-1">Avg Session Duration</div>
            <div class="text-2xl font-bold text-gray-900">${this.formatDuration(analytics.avgSessionDuration || 0)}</div>
          </div>
        </div>

        <!-- Session timeline -->
        <div>
          <h4 class="text-lg font-semibold text-gray-900 mb-4">Session Timeline</h4>
          <div class="space-y-4">
            ${sessions.map(session => `
              <div class="border-l-4 border-indigo-500 bg-gray-50 p-4 rounded-r-lg">
                <div class="flex justify-between items-start mb-2">
                  <div>
                    <div class="font-semibold text-gray-900">${new Date(session.startedAt).toLocaleString()}</div>
                    <div class="text-sm text-gray-600">Duration: ${this.formatDuration(session.duration || 0)}</div>
                  </div>
                  <span class="px-3 py-1 rounded-full text-xs font-medium ${
                    session.endReason === 'app_quit' ? 'bg-green-100 text-green-800' :
                    session.endReason === 'timeout' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }">
                    ${session.endReason || 'Active'}
                  </span>
                </div>
                ${session.matterContext ? `
                  <div class="mt-3 bg-white p-3 rounded border border-gray-200">
                    <div class="text-sm font-medium text-gray-700 mb-1">Matter Context:</div>
                    <div class="text-sm text-gray-900">${session.matterContext.matterName || session.matterContext.matterId}</div>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Refresh board data
   */
  async refresh() {
    try {
      this.renderLoading();
      const response = await SessionTrackingService.getTeamAnalytics(this.options.dateRange);
      const analytics = this.transformApiResponse(response);
      this.render(analytics);
    } catch (error) {
      console.error('[TeamPerformanceBoard] Refresh failed:', error);
      this.renderError('Refresh Failed', error.message || 'An unexpected error occurred');
    }
  }

  /**
   * Start auto-refresh timer
   */
  startAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.refreshTimer = setInterval(() => {
      this.refresh();
    }, this.options.refreshInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Destroy board (cleanup)
   */
  destroy() {
    this.stopAutoRefresh();

    // Destroy chart instances
    Object.values(this.chartInstances).forEach(chart => chart.destroy());
    this.chartInstances = {};
  }

  /**
   * Format duration in seconds to human-readable string
   */
  formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0m';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Get SVG icon path
   */
  getIconSVG(iconName) {
    const icons = {
      'users': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>',
      'clock': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>',
      'activity': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>',
      'trending-up': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>'
    };
    return icons[iconName] || '';
  }
}
