/**
 * Unified Activity Tracking Service
 *
 * Consolidated service for tracking all user activities including:
 * - Productivity metrics (for heatmap visualization)
 * - Narrative events (for activity feed display)
 * - System events (for audit and monitoring)
 *
 * @module UnifiedActivityTrackerService
 */

const { postgres } = require('../../../shared/database');
const { logInfo, logError } = require('../../../shared/logging/logger');
const { getEventDisplayName } = require('../../../shared/utils/event-display-names');

/**
 * Activity types that can be tracked
 */
const ACTIVITY_TYPES = {
  CHAT_MESSAGE: 'chat_message',
  DOCUMENT_UPLOAD: 'document_upload',
  DOCUMENT_UPLOADED: 'document_uploaded',
  SEARCH_QUERY: 'search_query',
  WORKFLOW_RUN: 'workflow_run',
  MATTER_ACCESS: 'matter_access',
  DOCUMENT_VIEW: 'document_view',
  WORKFLOW_CREATE: 'workflow_create',
  MATTER_CREATE: 'matter_create',
  DOCUMENT_DELETE: 'document_delete',
  MATTER_UPDATE: 'matter_update',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  SESSION_STARTED: 'session.started',
  SESSION_HEARTBEAT: 'session.heartbeat',
  SESSION_ENDED: 'session.ended',
  CHAT_STREAM: 'chat_stream',
  REPORT_GENERATED: 'report_generated',
  TASK_CREATED: 'task_created',
  TASK_UPDATED: 'task_updated',
  TASK_DELETED: 'task_deleted',
  TASK_STARTED: 'task_started',
  TASK_COMPLETED: 'task_completed',
  TASK_CANCELLED: 'task_cancelled',
  TASK_STATUS_CHANGED: 'task_status_changed',
  // Document processing activities
  DOCUMENT_TEXT_EXTRACTION_STARTED: 'document.text_extraction_started',
  DOCUMENT_TEXT_EXTRACTION_COMPLETED: 'document.text_extraction_completed',
  DOCUMENT_TEXT_EXTRACTION_FAILED: 'document.text_extraction_failed',
  DOCUMENT_AI_INGESTION_STARTED: 'document.ai_ingestion_started',
  DOCUMENT_AI_INGESTION_COMPLETED: 'document.ai_ingestion_completed',
  DOCUMENT_AI_INGESTION_FAILED: 'document.ai_ingestion_failed',
  // Contact activities
  CONTACT_CREATED: 'contact.created',
  CONTACT_UPDATED: 'contact.updated',
  CONTACT_DELETED: 'contact.deleted'
};

/**
 * Event categories for grouping
 */
const EVENT_CATEGORIES = {
  PRODUCTIVITY: 'productivity',
  NARRATIVE: 'narrative',
  SYSTEM: 'system'
};

class UnifiedActivityTrackerService {
  /**
   * Track a user activity event
   *
   * @param {Object} params - Activity parameters
   * @param {string} params.userId - User ID (UUID)
   * @param {string} params.organizationId - Organization ID (UUID)
   * @param {string} params.activityType - Type of activity (use ACTIVITY_TYPES constants)
   * @param {string} params.eventCategory - Event category (use EVENT_CATEGORIES constants) - defaults based on activity type
   * @param {string} params.resourceType - Type of resource (e.g., 'document', 'matter', 'workflow')
   * @param {string} params.resourceId - Resource UUID
   * @param {string} params.resourceName - Human-readable resource name
   * @param {Object} params.metadata - Additional metadata (e.g., matter_id, document_id)
   * @param {string} params.displayMessage - Human-readable message for activity feed
   * @param {boolean} params.isVisibleInFeed - Whether to show in activity feed UI
   * @param {Date} params.timestamp - Optional timestamp (defaults to now)
   * @returns {Promise<void>}
   */
  async trackActivity({
    userId,
    organizationId,
    activityType,
    eventCategory = null,
    resourceType = null,
    resourceId = null,
    resourceName = null,
    metadata = {},
    displayMessage = null,
    isVisibleInFeed = null,
    timestamp = new Date()
  }) {
    try {
      // Validate activity type
      if (!Object.values(ACTIVITY_TYPES).includes(activityType)) {
        logError('Invalid activity type', { activityType, validTypes: Object.values(ACTIVITY_TYPES) });
        return;
      }

      // Auto-determine event category if not provided
      const category = eventCategory || this._inferEventCategory(activityType, isVisibleInFeed);

      // Auto-determine visibility if not provided
      const visible = isVisibleInFeed !== null ? isVisibleInFeed : this._shouldBeVisibleInFeed(activityType, category);

      const activityDate = this._toDateString(timestamp);

      // Insert activity record (fire and forget - don't block API response)
      await postgres.query(
        `INSERT INTO activity_feed (
          user_id, organization_id, event_type, event_category,
          resource_type, resource_id, resource_name,
          details, activity_date, activity_timestamp,
          display_message, is_visible_in_feed
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          userId,
          organizationId,
          activityType,
          category,
          resourceType,
          resourceId,
          resourceName,
          JSON.stringify(metadata),
          activityDate,
          timestamp,
          displayMessage,
          visible
        ]
      );

      // Increment daily aggregation in real-time
      await postgres.query(
        `SELECT increment_user_activity_daily($1, $2, $3, $4)`,
        [userId, organizationId, activityDate, activityType]
      );

      // Don't log every activity to avoid noise
      // logInfo('Activity tracked', { userId, activityType });
    } catch (error) {
      // Log error but don't throw - activity tracking should never break the main flow
      logError('Failed to track activity', { error: error.message, userId, activityType });
    }
  }

  /**
   * Track multiple activities in bulk
   *
   * @param {Array<Object>} activities - Array of activity objects
   * @returns {Promise<void>}
   */
  async trackBulk(activities) {
    try {
      if (!Array.isArray(activities) || activities.length === 0) {
        return;
      }

      const values = activities.map((activity, idx) => {
        const offset = idx * 12;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`;
      }).join(', ');

      const params = activities.flatMap(activity => {
        const category = activity.eventCategory || this._inferEventCategory(activity.activityType, activity.isVisibleInFeed);
        const visible = activity.isVisibleInFeed !== null ? activity.isVisibleInFeed : this._shouldBeVisibleInFeed(activity.activityType, category);
        const activityDate = this._toDateString(activity.timestamp || new Date());

        return [
          activity.userId,
          activity.organizationId,
          activity.activityType,
          category,
          activity.resourceType || null,
          activity.resourceId || null,
          activity.resourceName || null,
          JSON.stringify(activity.metadata || {}),
          activityDate,
          activity.timestamp || new Date(),
          activity.displayMessage || null,
          visible
        ];
      });

      await postgres.query(
        `INSERT INTO activity_feed (
          user_id, organization_id, event_type, event_category,
          resource_type, resource_id, resource_name,
          details, activity_date, activity_timestamp,
          display_message, is_visible_in_feed
        )
         VALUES ${values}`,
        params
      );

      logInfo('Bulk activities tracked', { count: activities.length });
    } catch (error) {
      logError('Failed to track bulk activities', { error: error.message, count: activities.length });
    }
  }

  /**
   * Get user's daily activity counts for a date range
   *
   * @param {string} userId - User ID
   * @param {Date} startDate - Start date (defaults to 90 days ago)
   * @param {Date} endDate - End date (defaults to today)
   * @returns {Promise<Array<{date: string, count: number}>>}
   */
  async getUserDailyActivity(userId, startDate = null, endDate = null) {
    try {
      const end = endDate || new Date();
      const start = startDate || this._daysAgo(90);

      const result = await postgres.query(
        `SELECT
           activity_date::text as date,
           total_activities as count
         FROM user_activity_daily
         WHERE user_id = $1
           AND activity_date BETWEEN $2 AND $3
         ORDER BY activity_date ASC`,
        [userId, this._toDateString(start), this._toDateString(end)]
      );

      return result.rows;
    } catch (error) {
      logError('Failed to get user daily activity', { error: error.message, userId });
      return [];
    }
  }

  /**
   * Get organization's aggregated daily activity (all users)
   *
   * @param {string} organizationId - Organization ID
   * @param {Date} startDate - Start date (defaults to 90 days ago)
   * @param {Date} endDate - End date (defaults to today)
   * @returns {Promise<Array<{date: string, count: number}>>}
   */
  async getOrganizationDailyActivity(organizationId, startDate = null, endDate = null) {
    try {
      const end = endDate || new Date();
      const start = startDate || this._daysAgo(90);

      const result = await postgres.query(
        `SELECT
           activity_date::text as date,
           SUM(total_activities)::integer as count
         FROM user_activity_daily
         WHERE organization_id = $1
           AND activity_date BETWEEN $2 AND $3
         GROUP BY activity_date
         ORDER BY activity_date ASC`,
        [organizationId, this._toDateString(start), this._toDateString(end)]
      );

      return result.rows;
    } catch (error) {
      logError('Failed to get organization daily activity', { error: error.message, organizationId });
      return [];
    }
  }

  /**
   * Get user's productivity summary
   *
   * @param {string} userId - User ID
   * @param {Date} startDate - Start date (defaults to 90 days ago)
   * @param {Date} endDate - End date (defaults to today)
   * @returns {Promise<Object>} Summary with total counts by activity type
   */
  async getUserProductivitySummary(userId, startDate = null, endDate = null) {
    try {
      const end = endDate || new Date();
      const start = startDate || this._daysAgo(90);

      const result = await postgres.query(
        `SELECT
           COALESCE(SUM(chat_messages), 0)::integer as total_messages_sent,
           COALESCE(SUM(documents_uploaded), 0)::integer as total_documents_uploaded,
           COALESCE(SUM(searches_performed), 0)::integer as total_searches_performed,
           COALESCE(SUM(workflows_executed), 0)::integer as total_workflows_executed,
           COALESCE(SUM(matters_accessed), 0)::integer as total_matters_accessed,
           COALESCE(SUM(total_activities), 0)::integer as total_activities
         FROM user_activity_daily
         WHERE user_id = $1
           AND activity_date BETWEEN $2 AND $3`,
        [userId, this._toDateString(start), this._toDateString(end)]
      );

      return result.rows[0] || {
        total_messages_sent: 0,
        total_documents_uploaded: 0,
        total_searches_performed: 0,
        total_workflows_executed: 0,
        total_matters_accessed: 0,
        total_activities: 0
      };
    } catch (error) {
      logError('Failed to get user productivity summary', { error: error.message, userId });
      return {
        total_messages_sent: 0,
        total_documents_uploaded: 0,
        total_searches_performed: 0,
        total_workflows_executed: 0,
        total_matters_accessed: 0,
        total_activities: 0
      };
    }
  }

  /**
   * Get organization's productivity summary (all users)
   *
   * @param {string} organizationId - Organization ID
   * @param {Date} startDate - Start date (defaults to 90 days ago)
   * @param {Date} endDate - End date (defaults to today)
   * @returns {Promise<Object>} Summary with total counts by activity type
   */
  async getOrganizationProductivitySummary(organizationId, startDate = null, endDate = null) {
    try {
      const end = endDate || new Date();
      const start = startDate || this._daysAgo(90);

      const result = await postgres.query(
        `SELECT
           COALESCE(SUM(chat_messages), 0)::integer as total_messages_sent,
           COALESCE(SUM(documents_uploaded), 0)::integer as total_documents_uploaded,
           COALESCE(SUM(searches_performed), 0)::integer as total_searches_performed,
           COALESCE(SUM(workflows_executed), 0)::integer as total_workflows_executed,
           COALESCE(SUM(matters_accessed), 0)::integer as total_matters_accessed,
           COALESCE(SUM(total_activities), 0)::integer as total_activities,
           COUNT(DISTINCT user_id)::integer as active_users
         FROM user_activity_daily
         WHERE organization_id = $1
           AND activity_date BETWEEN $2 AND $3`,
        [organizationId, this._toDateString(start), this._toDateString(end)]
      );

      return result.rows[0] || {
        total_messages_sent: 0,
        total_documents_uploaded: 0,
        total_searches_performed: 0,
        total_workflows_executed: 0,
        total_matters_accessed: 0,
        total_activities: 0,
        active_users: 0
      };
    } catch (error) {
      logError('Failed to get organization productivity summary', { error: error.message, organizationId });
      return {
        total_messages_sent: 0,
        total_documents_uploaded: 0,
        total_searches_performed: 0,
        total_workflows_executed: 0,
        total_matters_accessed: 0,
        total_activities: 0,
        active_users: 0
      };
    }
  }

  /**
   * Refresh daily aggregation for a user
   *
   * @param {string} userId - User ID
   * @param {Date} startDate - Start date (defaults to 90 days ago)
   * @param {Date} endDate - End date (defaults to today)
   * @returns {Promise<number>} Number of rows affected
   */
  async refreshUserAggregation(userId, startDate = null, endDate = null) {
    try {
      const end = endDate || new Date();
      const start = startDate || this._daysAgo(90);

      const result = await postgres.query(
        `SELECT refresh_user_activity_daily_from_activity_feed($1, $2, $3) as rows_affected`,
        [userId, this._toDateString(start), this._toDateString(end)]
      );

      const rowsAffected = result.rows[0]?.rows_affected || 0;
      logInfo('User activity aggregation refreshed', { userId, rowsAffected });
      return rowsAffected;
    } catch (error) {
      logError('Failed to refresh user activity aggregation', { error: error.message, userId });
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY METHODS (SELECT from activity_feed)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get activity feed with filtering and pagination
   *
   * @param {Object} options - Query options
   * @param {string} options.organizationId - Organization ID (required)
   * @param {number} options.limit - Maximum number of activities to return (default: 50)
   * @param {number} options.offset - Number of activities to skip for pagination (default: 0)
   * @param {string} options.resourceType - Filter by resource type (optional)
   * @param {Array<string>} options.eventTypes - Filter by event types (optional)
   * @param {Date} options.since - Filter activities after this date (optional)
   * @param {boolean} options.isVisibleInFeed - Filter by visibility (optional, defaults to true if not specified)
   * @returns {Promise<Array>} Array of activity objects with user information
   */
  async getActivityFeed({
    organizationId,
    limit = 50,
    offset = 0,
    resourceType = null,
    eventTypes = null,
    since = null,
    isVisibleInFeed = true
  }) {
    try {
      let query = `
        SELECT
          a.*,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name
        FROM activity_feed a
        JOIN users u ON a.user_id = u.id
        WHERE a.organization_id = $1
          AND a.is_visible_in_feed = $2
      `;
      const params = [organizationId, isVisibleInFeed];
      let paramIndex = 3;

      if (resourceType) {
        query += ` AND a.resource_type = $${paramIndex++}`;
        params.push(resourceType);
      }

      if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
        query += ` AND a.event_type = ANY($${paramIndex++})`;
        params.push(eventTypes);
      }

      if (since) {
        query += ` AND a.activity_timestamp > $${paramIndex++}`;
        params.push(since);
      }

      query += ` ORDER BY a.activity_timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(parseInt(limit), parseInt(offset));

      const result = await postgres.query(query, params);

      return result.rows.map(row => ({
        id: row.id,
        event_type: row.event_type,
        event_category: row.event_category,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        resource_name: row.resource_name,
        display_message: getEventDisplayName(row.event_type, row.display_message),
        is_visible_in_feed: row.is_visible_in_feed,
        details: row.details,
        activity_date: row.activity_date,
        created_at: row.created_at,
        activity_timestamp: row.activity_timestamp,
        user: {
          id: row.user_id,
          email: row.user_email,
          first_name: row.user_first_name,
          last_name: row.user_last_name
        }
      }));
    } catch (error) {
      logError('Failed to get activity feed', { error: error.message, organizationId });
      return [];
    }
  }

  /**
   * Get activity for a specific user
   *
   * @param {Object} options - Query options
   * @param {string} options.userId - User ID (required)
   * @param {string} options.organizationId - Organization ID (required)
   * @param {number} options.limit - Maximum number of activities (default: 50)
   * @param {number} options.offset - Pagination offset (default: 0)
   * @returns {Promise<Array>} Array of activity objects
   */
  async getUserActivity({ userId, organizationId, limit = 50, offset = 0 }) {
    try {
      const result = await postgres.query(
        `SELECT
          a.*,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name
        FROM activity_feed a
        JOIN users u ON a.user_id = u.id
        WHERE a.user_id = $1 AND a.organization_id = $2 AND a.is_visible_in_feed = true
        ORDER BY a.activity_timestamp DESC
        LIMIT $3 OFFSET $4`,
        [userId, organizationId, parseInt(limit), parseInt(offset)]
      );

      return result.rows.map(row => ({
        id: row.id,
        event_type: row.event_type,
        event_category: row.event_category,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        resource_name: row.resource_name,
        display_message: getEventDisplayName(row.event_type, row.display_message),
        is_visible_in_feed: row.is_visible_in_feed,
        details: row.details,
        activity_date: row.activity_date,
        created_at: row.created_at,
        activity_timestamp: row.activity_timestamp,
        user: {
          id: row.user_id,
          email: row.user_email,
          first_name: row.user_first_name,
          last_name: row.user_last_name
        }
      }));
    } catch (error) {
      logError('Failed to get user activity', { error: error.message, userId, organizationId });
      return [];
    }
  }

  /**
   * Get activity for a specific resource
   *
   * @param {Object} options - Query options
   * @param {string} options.resourceType - Resource type (required)
   * @param {string} options.resourceId - Resource ID (required)
   * @param {string} options.organizationId - Organization ID (required)
   * @param {number} options.limit - Maximum number of activities (default: 50)
   * @param {number} options.offset - Pagination offset (default: 0)
   * @returns {Promise<Array>} Array of activity objects
   */
  async getResourceActivity({ resourceType, resourceId, organizationId, limit = 50, offset = 0 }) {
    try {
      const result = await postgres.query(
        `SELECT
          a.*,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name
        FROM activity_feed a
        JOIN users u ON a.user_id = u.id
        WHERE a.resource_type = $1
          AND a.resource_id = $2
          AND a.organization_id = $3
        ORDER BY a.activity_timestamp DESC
        LIMIT $4 OFFSET $5`,
        [resourceType, resourceId, organizationId, parseInt(limit), parseInt(offset)]
      );

      return result.rows.map(row => ({
        id: row.id,
        event_type: row.event_type,
        display_message: getEventDisplayName(row.event_type, row.display_message),
        details: row.details,
        created_at: row.created_at,
        activity_timestamp: row.activity_timestamp,
        user: {
          id: row.user_id,
          email: row.user_email,
          first_name: row.user_first_name,
          last_name: row.user_last_name
        }
      }));
    } catch (error) {
      logError('Failed to get resource activity', {
        error: error.message,
        resourceType,
        resourceId,
        organizationId
      });
      return [];
    }
  }

  /**
   * Get activity for a specific matter (with optional document activity)
   *
   * @param {Object} options - Query options
   * @param {string} options.matterId - Matter ID (required)
   * @param {string} options.organizationId - Organization ID (required)
   * @param {number} options.limit - Maximum number of activities (default: 50)
   * @param {number} options.offset - Pagination offset (default: 0)
   * @param {boolean} options.includeDocuments - Include document activity within matter (default: true)
   * @returns {Promise<{activities: Array, total: number}>} Activities and total count
   */
  async getMatterActivity({ matterId, organizationId, limit = 50, offset = 0, includeDocuments = true }) {
    try {
      let query;
      let countQuery;
      const params = [organizationId, matterId, parseInt(limit), parseInt(offset)];

      if (includeDocuments) {
        query = `
          SELECT
            a.*,
            u.email as user_email,
            u.first_name as user_first_name,
            u.last_name as user_last_name
          FROM activity_feed a
          JOIN users u ON a.user_id = u.id
          WHERE a.organization_id = $1
            AND (
              (a.resource_type = 'matter' AND a.details->>'matter_id' = $2)
              OR (a.resource_type = 'document' AND a.resource_id IN (
                SELECT id FROM documents WHERE client_matter = $2
              ))
              OR (a.details->>'matter_id' = $2)
            )
          ORDER BY a.activity_timestamp DESC
          LIMIT $3 OFFSET $4
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM activity_feed a
          WHERE a.organization_id = $1
            AND (
              (a.resource_type = 'matter' AND a.details->>'matter_id' = $2)
              OR (a.resource_type = 'document' AND a.resource_id IN (
                SELECT id FROM documents WHERE client_matter = $2
              ))
              OR (a.details->>'matter_id' = $2)
            )
        `;
      } else {
        query = `
          SELECT
            a.*,
            u.email as user_email,
            u.first_name as user_first_name,
            u.last_name as user_last_name
          FROM activity_feed a
          JOIN users u ON a.user_id = u.id
          WHERE a.organization_id = $1
            AND (
              (a.resource_type = 'matter' AND a.details->>'matter_id' = $2)
              OR (a.details->>'matter_id' = $2)
            )
          ORDER BY a.activity_timestamp DESC
          LIMIT $3 OFFSET $4
        `;

        countQuery = `
          SELECT COUNT(*) as total
          FROM activity_feed a
          WHERE a.organization_id = $1
            AND (
              (a.resource_type = 'matter' AND a.details->>'matter_id' = $2)
              OR (a.details->>'matter_id' = $2)
            )
        `;
      }

      const [result, countResult] = await Promise.all([
        postgres.query(query, params),
        postgres.query(countQuery, [organizationId, matterId])
      ]);

      const activities = result.rows.map(row => ({
        id: row.id,
        event_type: row.event_type,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        resource_name: row.resource_name,
        display_message: getEventDisplayName(row.event_type, row.display_message),
        details: row.details,
        created_at: row.created_at,
        activity_timestamp: row.activity_timestamp,
        user: {
          id: row.user_id,
          email: row.user_email,
          first_name: row.user_first_name,
          last_name: row.user_last_name
        }
      }));

      return {
        activities,
        total: parseInt(countResult.rows[0].total)
      };
    } catch (error) {
      logError('Failed to get matter activity', { error: error.message, matterId, organizationId });
      return { activities: [], total: 0 };
    }
  }

  /**
   * Get recent activity across the organization
   *
   * @param {Object} options - Query options
   * @param {string} options.organizationId - Organization ID (required)
   * @param {number} options.hours - Number of hours to look back (default: 24)
   * @param {number} options.limit - Maximum number of activities (default: 100)
   * @returns {Promise<{activities: Array, summary: Object}>} Activities and summary statistics
   */
  async getRecentActivity({ organizationId, hours = 24, limit = 100 }) {
    try {
      const since = new Date();
      since.setHours(since.getHours() - parseInt(hours));

      const result = await postgres.query(
        `SELECT
          a.*,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name
        FROM activity_feed a
        JOIN users u ON a.user_id = u.id
        WHERE a.organization_id = $1 AND a.activity_timestamp > $2
        ORDER BY a.activity_timestamp DESC
        LIMIT $3`,
        [organizationId, since, parseInt(limit)]
      );

      // Group by event type for summary
      const byType = {};
      for (const row of result.rows) {
        if (!byType[row.event_type]) {
          byType[row.event_type] = 0;
        }
        byType[row.event_type]++;
      }

      const activities = result.rows.map(row => ({
        id: row.id,
        event_type: row.event_type,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        resource_name: row.resource_name,
        display_message: getEventDisplayName(row.event_type, row.display_message),
        details: row.details,
        created_at: row.created_at,
        activity_timestamp: row.activity_timestamp,
        user: {
          id: row.user_id,
          email: row.user_email,
          first_name: row.user_first_name,
          last_name: row.user_last_name
        }
      }));

      return {
        activities,
        summary: {
          total_count: result.rows.length,
          by_type: byType,
          time_range_hours: parseInt(hours)
        }
      };
    } catch (error) {
      logError('Failed to get recent activity', { error: error.message, organizationId, hours });
      return { activities: [], summary: { total_count: 0, by_type: {}, time_range_hours: hours } };
    }
  }

  /**
   * Get activity statistics for an organization
   *
   * @param {Object} options - Query options
   * @param {string} options.organizationId - Organization ID (required)
   * @param {number} options.days - Number of days to analyze (default: 7)
   * @returns {Promise<Object>} Statistics including counts by event type, resource type, active users, and daily breakdown
   */
  async getActivityStats({ organizationId, days = 7 }) {
    try {
      const since = new Date();
      since.setDate(since.getDate() - parseInt(days));

      // Get counts by event type
      const byTypeResult = await postgres.query(
        `SELECT event_type, COUNT(*)::int as count
        FROM activity_feed
        WHERE organization_id = $1 AND activity_timestamp > $2
        GROUP BY event_type
        ORDER BY count DESC`,
        [organizationId, since]
      );

      // Get counts by resource type
      const byResourceResult = await postgres.query(
        `SELECT resource_type, COUNT(*)::int as count
        FROM activity_feed
        WHERE organization_id = $1 AND activity_timestamp > $2
        GROUP BY resource_type
        ORDER BY count DESC`,
        [organizationId, since]
      );

      // Get most active users
      const activeUsersResult = await postgres.query(
        `SELECT
          a.user_id,
          u.email,
          u.first_name,
          u.last_name,
          COUNT(*)::int as activity_count
        FROM activity_feed a
        JOIN users u ON a.user_id = u.id
        WHERE a.organization_id = $1 AND a.activity_timestamp > $2
        GROUP BY a.user_id, u.email, u.first_name, u.last_name
        ORDER BY activity_count DESC
        LIMIT 10`,
        [organizationId, since]
      );

      // Get daily breakdown
      const dailyResult = await postgres.query(
        `SELECT
          DATE(activity_timestamp) as date,
          COUNT(*)::int as count
        FROM activity_feed
        WHERE organization_id = $1 AND activity_timestamp > $2
        GROUP BY DATE(activity_timestamp)
        ORDER BY date ASC`,
        [organizationId, since]
      );

      return {
        time_range_days: parseInt(days),
        by_event_type: byTypeResult.rows,
        by_resource_type: byResourceResult.rows,
        most_active_users: activeUsersResult.rows.map(row => ({
          user_id: row.user_id,
          email: row.email,
          name: [row.first_name, row.last_name].filter(Boolean).join(' '),
          activity_count: row.activity_count
        })),
        daily_breakdown: dailyResult.rows
      };
    } catch (error) {
      logError('Failed to get activity stats', { error: error.message, organizationId, days });
      return {
        time_range_days: days,
        by_event_type: [],
        by_resource_type: [],
        most_active_users: [],
        daily_breakdown: []
      };
    }
  }

  /**
   * Get activity count with filters (used for rate limiting, dashboard stats, etc.)
   *
   * @param {Object} options - Query options
   * @param {string} options.organizationId - Organization ID (optional)
   * @param {string} options.userId - User ID (optional)
   * @param {string} options.resourceType - Resource type (optional)
   * @param {string} options.resourceId - Resource ID (optional)
   * @param {string} options.eventType - Event type (optional)
   * @param {Date} options.since - Count activities after this date (optional)
   * @returns {Promise<number>} Count of activities matching filters
   */
  async getActivityCount({
    organizationId = null,
    userId = null,
    resourceType = null,
    resourceId = null,
    eventType = null,
    since = null
  }) {
    try {
      let query = 'SELECT COUNT(*) as count FROM activity_feed WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (organizationId) {
        query += ` AND organization_id = $${paramIndex++}`;
        params.push(organizationId);
      }

      if (userId) {
        query += ` AND user_id = $${paramIndex++}`;
        params.push(userId);
      }

      if (resourceType) {
        query += ` AND resource_type = $${paramIndex++}`;
        params.push(resourceType);
      }

      if (resourceId) {
        query += ` AND resource_id = $${paramIndex++}`;
        params.push(resourceId);
      }

      if (eventType) {
        query += ` AND event_type = $${paramIndex++}`;
        params.push(eventType);
      }

      if (since) {
        query += ` AND created_at > $${paramIndex++}`;
        params.push(since);
      }

      const result = await postgres.query(query, params);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logError('Failed to get activity count', { error: error.message, filters: arguments[0] });
      return 0;
    }
  }

  /**
   * Get matter activity by internal ID (used by matters repository)
   *
   * @param {string} matterInternalId - Internal UUID of the matter
   * @param {number} limit - Maximum number of activities (default: 10)
   * @returns {Promise<Array>} Array of activity objects
   */
  async getMatterActivityByInternalId(matterInternalId, limit = 10) {
    try {
      const result = await postgres.query(
        `SELECT
          af.id,
          af.event_type,
          af.resource_name,
          af.created_at,
          af.activity_timestamp,
          CONCAT(u.first_name, ' ', u.last_name) as user_name,
          u.email as user_email
        FROM activity_feed af
        LEFT JOIN users u ON af.user_id = u.id
        WHERE af.resource_type = 'matter'
          AND af.resource_id = $1
          AND af.is_visible_in_feed = true
        ORDER BY af.activity_timestamp DESC
        LIMIT $2`,
        [matterInternalId, limit]
      );

      return result.rows;
    } catch (error) {
      logError('Failed to get matter activity by internal ID', {
        error: error.message,
        matterInternalId
      });
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Helper: Infer event category from activity type and visibility
   * @private
   */
  _inferEventCategory(activityType, isVisibleInFeed) {
    // If explicit visibility is provided, use that as a hint
    if (isVisibleInFeed === true) {
      return EVENT_CATEGORIES.NARRATIVE;
    }
    if (isVisibleInFeed === false) {
      return EVENT_CATEGORIES.PRODUCTIVITY;
    }

    // Otherwise infer from activity type
    const narrativeTypes = ['matter_create', 'matter_update', 'document_delete', 'workflow_create', 'session.started', 'session.ended'];
    const systemTypes = ['user_login', 'user_logout', 'session.heartbeat'];

    if (narrativeTypes.includes(activityType)) {
      return EVENT_CATEGORIES.NARRATIVE;
    }
    if (systemTypes.includes(activityType)) {
      return EVENT_CATEGORIES.SYSTEM;
    }

    // Default to productivity
    return EVENT_CATEGORIES.PRODUCTIVITY;
  }

  /**
   * Helper: Determine if activity should be visible in feed by default
   * @private
   */
  _shouldBeVisibleInFeed(activityType, category) {
    // Narrative events are always visible
    if (category === EVENT_CATEGORIES.NARRATIVE) {
      return true;
    }

    // System events are typically hidden
    if (category === EVENT_CATEGORIES.SYSTEM) {
      return false;
    }

    // Productivity events are typically hidden (used for heatmap, not feed)
    if (category === EVENT_CATEGORIES.PRODUCTIVITY) {
      return false;
    }

    // Default to true for backward compatibility
    return true;
  }

  /**
   * Helper: Convert Date to YYYY-MM-DD string
   * @private
   */
  _toDateString(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Helper: Get date N days ago
   * @private
   */
  _daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }
}

// Export singleton instance
module.exports = new UnifiedActivityTrackerService();
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
module.exports.EVENT_CATEGORIES = EVENT_CATEGORIES;
module.exports.UnifiedActivityTrackerService = UnifiedActivityTrackerService;
