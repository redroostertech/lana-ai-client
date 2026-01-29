/**
 * Session Tracking API Service
 * Wrapper for all session tracking API calls
 *
 * @description Provides a centralized API interface for time tracking operations
 * @requires api.js - Base API client must be loaded first
 */

const SessionTrackingService = {
  baseUrl: '/api/v1/session-tracking',
  cache: {
    teamAnalytics: null,
    teamAnalyticsExpiry: 0,
    cacheTTL: 5 * 60 * 1000, // 5 minutes
  },

  /**
   * Start a new work session
   * @param {Object} sessionData - Session initialization data
   * @param {string} sessionData.matter_id - Optional matter context
   * @param {string} sessionData.platform - Platform identifier (e.g., 'electron', 'web')
   * @param {string} sessionData.version - Client version
   * @returns {Promise<{session_id: string, started_at: string}>}
   */
  async startSession(sessionData) {
    try {
      const response = await api.post(`${this.baseUrl}/start`, sessionData);
      return response;
    } catch (error) {
      console.error('[SessionTrackingService] Error starting session:', error);
      throw error;
    }
  },

  /**
   * Send heartbeat to maintain active session
   * @param {Object} heartbeatData - Heartbeat data
   * @param {string} heartbeatData.session_id - Active session ID
   * @param {string} heartbeatData.matter_id - Current matter context (if changed)
   * @param {boolean} heartbeatData.is_idle - Is user currently idle?
   * @returns {Promise<{status: string, active_time_seconds: number}>}
   */
  async sendHeartbeat(heartbeatData) {
    try {
      const response = await api.post(`${this.baseUrl}/heartbeat`, heartbeatData);
      return response;
    } catch (error) {
      console.error('[SessionTrackingService] Error sending heartbeat:', error);
      throw error;
    }
  },

  /**
   * End active work session
   * @param {Object} endData - Session end data
   * @param {string} endData.session_id - Session ID to end
   * @param {string} endData.end_reason - Reason for ending (e.g., 'manual', 'auto', 'logout', 'shutdown')
   * @returns {Promise<{status: string, total_active_time_seconds: number}>}
   */
  async endSession(endData) {
    try {
      const response = await api.post(`${this.baseUrl}/end`, endData);
      return response;
    } catch (error) {
      console.error('[SessionTrackingService] Error ending session:', error);
      throw error;
    }
  },

  /**
   * Get team performance analytics (admin only)
   * @param {Object} options - Query options
   * @param {string} options.range - Time range ('7d', '30d', '90d')
   * @param {boolean} options.skipCache - Skip cache and fetch fresh data
   * @returns {Promise<Object>} Team analytics data
   */
  async getTeamAnalytics(options = {}) {
    const { range = '7d', skipCache = false } = options;

    // Check cache
    const now = Date.now();
    if (!skipCache && this.cache.teamAnalytics && now < this.cache.teamAnalyticsExpiry) {
      console.log('[SessionTrackingService] Returning cached team analytics');
      return this.cache.teamAnalytics;
    }

    try {
      const params = new URLSearchParams({ time_range: range });
      const response = await api.get(`${this.baseUrl}/analytics/team?${params}`);

      // Cache the response
      this.cache.teamAnalytics = response;
      this.cache.teamAnalyticsExpiry = now + this.cache.cacheTTL;

      return response;
    } catch (error) {
      console.error('[SessionTrackingService] Error fetching team analytics:', error);
      throw error;
    }
  },

  /**
   * Get user session history with drill-down details
   * @param {Object} options - Query options
   * @param {string} options.user_id - User ID (required)
   * @param {string} options.range - Time range ('7d', '30d', '90d')
   * @returns {Promise<{sessions: Array, total_active_time_seconds: number, total_sessions: number}>}
   */
  async getUserSessionHistory(options = {}) {
    const { user_id, range = '7d' } = options;

    if (!user_id) {
      throw new Error('user_id is required for getUserSessionHistory');
    }

    try {
      const params = new URLSearchParams({ user_id, range });
      const response = await api.get(`${this.baseUrl}/analytics/team?${params}`);
      return response;
    } catch (error) {
      console.error('[SessionTrackingService] Error fetching user session history:', error);
      throw error;
    }
  },

  /**
   * Clear cached analytics data
   */
  clearCache() {
    this.cache.teamAnalytics = null;
    this.cache.teamAnalyticsExpiry = 0;
  },

  /**
   * Transform API data to UI format
   * @param {Object} apiData - Raw API response
   * @returns {Object} Transformed data for UI consumption
   */
  transformTeamAnalyticsForUI(apiData) {
    if (!apiData || !apiData.data) {
      return {
        summary: {},
        featureAdoption: [],
        topContributors: [],
        insights: []
      };
    }

    const { summary, feature_adoption, top_contributors, insights } = apiData.data;

    return {
      summary: {
        totalSessions: summary?.total_sessions || 0,
        totalActiveTime: this._formatDuration(summary?.total_active_time_seconds || 0),
        avgSessionDuration: this._formatDuration(summary?.avg_session_duration_seconds || 0),
        focusPercentage: summary?.focus_percentage || 0,
      },
      featureAdoption: (feature_adoption || []).map(feature => ({
        name: feature.feature_name,
        usage: feature.usage_count,
        percentage: feature.usage_percentage,
      })),
      topContributors: (top_contributors || []).map(user => ({
        userId: user.user_id,
        userName: user.user_name,
        sessionsCount: user.sessions_count,
        totalActiveTime: this._formatDuration(user.total_active_time_seconds),
        focusPercentage: user.focus_percentage,
      })),
      insights: (insights || []).map(insight => ({
        type: insight.type,
        message: insight.message,
        recommendation: insight.recommendation,
        severity: insight.severity,
      })),
    };
  },

  /**
   * Identify improvement opportunities from analytics data
   * @param {Object} analytics - Team analytics data
   * @returns {Array} Array of improvement opportunities
   */
  identifyImprovementOpportunities(analytics) {
    const opportunities = [];

    if (!analytics || !analytics.data) {
      return opportunities;
    }

    const { summary, feature_adoption, top_contributors } = analytics.data;

    // Low focus percentage
    if (summary && summary.focus_percentage < 60) {
      opportunities.push({
        type: 'focus',
        title: 'Low Focus Time',
        description: `Team focus time is at ${summary.focus_percentage.toFixed(1)}%. Consider reducing interruptions.`,
        recommendation: 'Implement focus time blocks or reduce meeting frequency.',
        severity: 'warning'
      });
    }

    // Low feature adoption
    const lowAdoptionFeatures = (feature_adoption || []).filter(f => f.usage_percentage < 20);
    if (lowAdoptionFeatures.length > 0) {
      opportunities.push({
        type: 'adoption',
        title: 'Underutilized Features',
        description: `${lowAdoptionFeatures.length} features have <20% adoption rate.`,
        recommendation: 'Provide training or review feature relevance.',
        severity: 'info',
        features: lowAdoptionFeatures.map(f => f.feature_name)
      });
    }

    // Short average session duration
    if (summary && summary.avg_session_duration_seconds < 30 * 60) { // Less than 30 minutes
      opportunities.push({
        type: 'engagement',
        title: 'Short Work Sessions',
        description: `Average session duration is ${this._formatDuration(summary.avg_session_duration_seconds)}.`,
        recommendation: 'Investigate workflow interruptions or usability issues.',
        severity: 'warning'
      });
    }

    // High variability in contributor activity
    if (top_contributors && top_contributors.length > 0) {
      const times = top_contributors.map(u => u.total_active_time_seconds);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const variance = times.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) / times.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev / avg > 0.5) { // Coefficient of variation > 50%
        opportunities.push({
          type: 'equity',
          title: 'Uneven Workload Distribution',
          description: 'High variability in team member activity levels.',
          recommendation: 'Review workload distribution and identify bottlenecks.',
          severity: 'info'
        });
      }
    }

    return opportunities;
  },

  /**
   * Format seconds into human-readable duration
   * @param {number} seconds - Duration in seconds
   * @returns {string} Formatted duration (e.g., "2h 30m")
   */
  _formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0m';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
  },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SessionTrackingService;
}
