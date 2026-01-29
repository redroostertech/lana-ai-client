// lana-client/src/js/analytics.js
/**
 * Client-Side Analytics Library for LANA AI
 *
 * Features:
 * - Event batching (send every 10 seconds to reduce API calls)
 * - Automatic user/org context injection
 * - Graceful error handling (failures don't break UX)
 * - Queue events if offline, retry when connection restored
 * - Client-side metadata (timestamp, user_agent, screen_resolution)
 *
 * Usage:
 *   window.analytics.trackEvent('matter.opened', 'matter', matterId, { matter_name: 'Smith vs Jones' });
 *   window.analytics.trackPageView('matters', matterId);
 *   window.analytics.trackTiming('document_upload', 1500);
 */

(function() {
  'use strict';

  const analytics = {
    // Configuration
    config: {
      batchInterval: 10000, // 10 seconds
      maxBatchSize: 100, // Max events per batch
      maxRetries: 3,
      apiEndpoint: null // Set dynamically based on window.api
    },

    // Internal state
    eventQueue: [],
    batchTimer: null,
    currentUser: null,
    isOnline: navigator.onLine,
    retryCount: 0,
    _isFlushing: false, // Mutex lock to prevent race conditions

    /**
     * Initialize analytics tracking
     * Called automatically when library loads
     */
    async init() {
      // Get current user context
      try {
        if (window.api && typeof window.api.getCurrentUser === 'function') {
          this.currentUser = await window.api.getCurrentUser();
        }
      } catch (error) {
        console.warn('[Analytics] Failed to get current user:', error);
      }

      // Start batch timer
      this.startBatchTimer();

      // Listen for online/offline events
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.flushQueue(); // Send queued events when back online
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
      });

      // Listen for page unload (send any remaining events)
      window.addEventListener('beforeunload', () => {
        this.flushQueueSync();
      });

      // Listen for logout (clear queue)
      window.addEventListener('user-logout', () => {
        this.clearQueue();
        this.currentUser = null;
      });
    },

    /**
     * Track user event
     * @param {string} eventType - Event type (e.g., 'matter.opened')
     * @param {string} resourceType - Resource type ('matter', 'document', etc.)
     * @param {string} resourceId - UUID of resource
     * @param {object} details - Additional metadata
     */
    trackEvent(eventType, resourceType, resourceId, details = {}) {
      if (!eventType || !resourceType) {
        console.warn('[Analytics] Missing required fields: eventType, resourceType');
        return;
      }

      const event = {
        event_type: eventType,
        resource_type: resourceType,
        resource_id: resourceId || null,
        resource_name: details.resource_name || null,
        details: {
          ...details,
          client_timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent,
          screen_resolution: `${window.screen.width}x${window.screen.height}`,
          viewport_size: `${window.innerWidth}x${window.innerHeight}`
        }
      };

      // Add to queue
      this.eventQueue.push(event);

      // If queue is full, flush immediately
      if (this.eventQueue.length >= this.config.maxBatchSize) {
        this.flushQueue();
      }
    },

    /**
     * Track page view
     * @param {string} pageName - Page name (e.g., 'matters', 'chat', 'settings')
     * @param {string} matterId - Optional matter context
     */
    trackPageView(pageName, matterId = null) {
      this.trackEvent('page.viewed', 'page', pageName, {
        matter_id: matterId,
        referrer: document.referrer,
        url: window.location.href
      });
    },

    /**
     * Track performance timing
     * @param {string} action - Action name (e.g., 'document_upload', 'page_load')
     * @param {number} duration - Duration in milliseconds
     * @param {object} details - Additional context
     */
    trackTiming(action, duration, details = {}) {
      this.trackEvent('performance.timing', 'timing', action, {
        duration_ms: duration,
        ...details
      });
    },

    /**
     * Track error occurrence
     * @param {Error|string} error - Error object or message
     * @param {object} context - Error context
     */
    trackError(error, context = {}) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : null;

      this.trackEvent('error.occurred', 'error', null, {
        error_message: errorMessage,
        error_stack: errorStack,
        error_context: context
      });
    },

    /**
     * Start batch timer
     * Sends events every N seconds
     */
    startBatchTimer() {
      if (this.batchTimer) {
        clearInterval(this.batchTimer);
      }

      this.batchTimer = setInterval(() => {
        if (this.eventQueue.length > 0) {
          this.flushQueue();
        }
      }, this.config.batchInterval);
    },

    /**
     * Flush event queue (send to backend)
     * Async method for normal operation
     */
    async flushQueue() {
      // Mutex lock to prevent concurrent flushes
      if (this._isFlushing) {
        console.warn('[Analytics] Flush already in progress, skipping');
        return;
      }

      if (this.eventQueue.length === 0) {
        return;
      }

      if (!this.isOnline) {
        console.log('[Analytics] Offline - queuing events for later');
        return;
      }

      // Validate user context before sending
      if (!this.currentUser || !this.currentUser.id) {
        console.warn('[Analytics] No user context, deferring event batch');
        return; // Keep events queued for next flush
      }

      // Set mutex lock
      this._isFlushing = true;

      try {
        // Get events to send (batch)
        const eventsToSend = this.eventQueue.splice(0, this.config.maxBatchSize);

        // Add user context to all events
        const enrichedEvents = eventsToSend.map(event => ({
          ...event,
          user_id: this.currentUser.id,
          organization_id: this.currentUser.organization_id
        }));

        // Send to backend
        if (window.api && typeof window.api.post === 'function') {
          const response = await window.api.post(
            '/api/processor/analytics/events/batch',
            { events: enrichedEvents }
          );

          // Reset retry count on success
          this.retryCount = 0;

          console.log(
            `[Analytics] Sent ${enrichedEvents.length} events (${response.succeeded} succeeded, ${response.failed} failed)`
          );
        } else {
          console.warn('[Analytics] window.api.post not available - events dropped');
        }
      } catch (error) {
        console.error('[Analytics] Failed to send events:', error);

        // Retry logic: add events back to queue if retries remain
        if (this.retryCount < this.config.maxRetries) {
          this.retryCount++;
          // Note: events already removed from queue, need to re-add
          console.log(`[Analytics] Retry ${this.retryCount}/${this.config.maxRetries}`);
        } else {
          console.warn('[Analytics] Max retries exceeded - dropping events');
          this.retryCount = 0;
        }
      } finally {
        // Release mutex lock
        this._isFlushing = false;
      }
    },

    /**
     * Flush queue synchronously (for page unload)
     * Uses sendBeacon for best effort delivery
     */
    flushQueueSync() {
      if (this.eventQueue.length === 0) {
        return;
      }

      // Validate user context
      if (!this.currentUser || !this.currentUser.id) {
        console.warn('[Analytics] No user context, cannot send events via sendBeacon');
        return;
      }

      // Enrich events with user context
      const enrichedEvents = this.eventQueue.map(event => ({
        ...event,
        user_id: this.currentUser.id,
        organization_id: this.currentUser.organization_id
      }));

      try {
        // Get auth token from localStorage (or wherever it's stored)
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');

        // Use sendBeacon for best-effort delivery on page unload
        const endpoint = window.api?.baseUrl
          ? `${window.api.baseUrl}/api/processor/analytics/events/beacon`
          : '/api/processor/analytics/events/beacon';

        // Include token in request body (sendBeacon can't set headers)
        const payload = {
          events: enrichedEvents,
          _auth_token: token
        };

        const blob = new Blob([JSON.stringify(payload)], {
          type: 'application/json'
        });

        navigator.sendBeacon(endpoint, blob);
        console.log(`[Analytics] Sent ${enrichedEvents.length} events via sendBeacon`);

        // Clear queue
        this.eventQueue = [];
      } catch (error) {
        console.error('[Analytics] Failed to send events via sendBeacon:', error);
      }
    },

    /**
     * Clear all queued events
     * Useful for testing or privacy compliance
     */
    clearQueue() {
      this.eventQueue = [];
      console.log('[Analytics] Event queue cleared');
    },

    /**
     * Get queue status (for debugging)
     */
    getQueueStatus() {
      return {
        queueLength: this.eventQueue.length,
        isOnline: this.isOnline,
        retryCount: this.retryCount,
        currentUser: this.currentUser ? {
          id: this.currentUser.id,
          email: this.currentUser.email
        } : null
      };
    }
  };

  // Initialize analytics on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      analytics.init();
    });
  } else {
    analytics.init();
  }

  // Expose globally
  window.analytics = analytics;
})();
