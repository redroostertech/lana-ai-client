/**
 * Feature Tracker Service
 * Tracks feature usage for analytics and adoption metrics
 *
 * @description Records feature-level events to backend for Team Performance analytics
 * @requires api.js - Base API client must be loaded first
 */

const FeatureTracker = {
  baseUrl: '/api/v1/features',

  // Rate limiting to prevent spam
  recentEvents: new Map(), // feature_name -> last_tracked_timestamp
  rateLimitMs: 30000, // Only track same feature once per 30 seconds

  /**
   * Track feature usage
   * @param {string} featureName - Feature identifier (e.g., 'chat', 'document_upload', 'workflow_create')
   * @param {Object} metadata - Optional feature-specific context
   * @returns {Promise<void>}
   */
  async trackFeature(featureName, metadata = {}) {
    try {
      // Rate limiting: Don't track same feature too frequently
      const now = LanaTime.nowMs();
      const lastTracked = this.recentEvents.get(featureName);

      if (lastTracked && (now - lastTracked) < this.rateLimitMs) {
        console.debug(`[FeatureTracker] Rate limited: ${featureName}`);
        return;
      }

      // Track the event
      await api.post(`${this.baseUrl}/track`, {
        feature_name: featureName,
        metadata: metadata
      });

      // Update rate limit tracker
      this.recentEvents.set(featureName, now);

      console.debug(`[FeatureTracker] Tracked: ${featureName}`, metadata);
    } catch (error) {
      // Silently fail - don't disrupt user experience
      console.warn('[FeatureTracker] Failed to track feature:', featureName, error);
    }
  },

  /**
   * Track multiple features in a batch
   * Useful for tracking multiple related actions
   * @param {Array<{feature: string, metadata: Object}>} features - Array of features to track
   */
  async trackBatch(features) {
    try {
      await api.post(`${this.baseUrl}/track-batch`, {
        features: features.map(f => ({
          feature_name: f.feature,
          metadata: f.metadata || {}
        }))
      });

      console.debug(`[FeatureTracker] Tracked batch:`, features.map(f => f.feature));
    } catch (error) {
      console.warn('[FeatureTracker] Failed to track batch:', error);
    }
  },

  /**
   * Clear rate limit cache (useful for testing)
   */
  clearCache() {
    this.recentEvents.clear();
  }
};

// Common feature tracking helpers
const Features = {
  // Chat
  CHAT_MESSAGE_SENT: 'chat.message_sent',
  CHAT_FILE_ATTACHED: 'chat.file_attached',
  CHAT_CONVERSATION_CREATED: 'chat.conversation_created',

  // Documents
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_VIEWED: 'document.viewed',
  DOCUMENT_DOWNLOADED: 'document.downloaded',
  DOCUMENT_DELETED: 'document.deleted',

  // Search
  SEARCH_PERFORMED: 'search.performed',
  SEARCH_FILTER_APPLIED: 'search.filter_applied',

  // Workflows
  WORKFLOW_CREATED: 'workflow.created',
  WORKFLOW_EXECUTED: 'workflow.executed',
  WORKFLOW_EDITED: 'workflow.edited',

  // Integrations
  INTEGRATION_CONNECTED: 'integration.connected',
  INTEGRATION_SYNCED: 'integration.synced',
  INTEGRATION_DISCONNECTED: 'integration.disconnected',

  // Matters
  MATTER_CREATED: 'matter.created',
  MATTER_UPDATED: 'matter.updated',
  MATTER_VIEWED: 'matter.viewed',

  // Management Boards
  BOARD_CREATED: 'management_board.created',
  BOARD_VIEWED: 'management_board.viewed',
  METRIC_SUBMITTED: 'management_board.metric_submitted',

  // Settings
  SETTINGS_UPDATED: 'settings.updated',
  USER_INVITED: 'settings.user_invited',

  // Analytics
  ANALYTICS_VIEWED: 'analytics.viewed',
  REPORT_GENERATED: 'analytics.report_generated',

  // Session
  SESSION_STARTED: 'session.started',
  SESSION_ENDED: 'session.ended'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FeatureTracker, Features };
}
