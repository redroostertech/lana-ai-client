/**
 * Event Type Display Names (Frontend)
 *
 * Provides human-readable display names for all activity event types.
 * Used as fallback when display_message is null/empty.
 *
 * This is a client-side safety net - the backend should already provide
 * display messages, but this ensures we never show raw event types to users.
 */

const EventDisplayNames = (() => {
  /**
   * Default display messages for activity event types
   */
  const EVENT_DISPLAY_NAMES = {
    // Chat & Communication
    'chat_message': 'Sent a chat message',
    'chat_stream': 'Had a conversation',

    // Document Management
    'document_upload': 'Uploaded a document',
    'document_view': 'Viewed a document',
    'document_delete': 'Deleted a document',

    // Search
    'search_query': 'Performed a search',

    // Workflow
    'workflow_run': 'Ran a workflow',
    'workflow_create': 'Created a workflow',
    'workflow_execute': 'Executed a workflow',

    // Matter Management
    'matter_access': 'Accessed a matter',
    'matter_create': 'Created a matter',
    'matter_update': 'Updated a matter',

    // Session Tracking
    'session.started': 'Started a session',
    'session.heartbeat': 'Session active',
    'session.ended': 'Ended a session',

    // User Management
    'user_login': 'Logged in',
    'user_logout': 'Logged out',

    // Reports & Analytics
    'report_generated': 'Generated a report',

    // Task Management
    'task_created': 'Created a task',
    'task_updated': 'Updated a task',
    'task_deleted': 'Deleted a task',
    'task_started': 'Started a task',
    'task_completed': 'Completed a task',
    'task_cancelled': 'Cancelled a task',
    'task_status_changed': 'Changed task status',

    // Generic fallback
    'default': 'Performed an action'
  };

  /**
   * Get human-readable display name for an event type
   *
   * @param {string} eventType - The event type (e.g., 'chat_message', 'session.heartbeat')
   * @param {string|null} displayMessage - Optional existing display message
   * @returns {string} Human-readable display name
   */
  function getEventDisplayName(eventType, displayMessage = null) {
    // If we have a display message, use it
    if (displayMessage && typeof displayMessage === 'string' && displayMessage.trim()) {
      return displayMessage.trim();
    }

    // Otherwise, look up the default message for this event type
    if (EVENT_DISPLAY_NAMES[eventType]) {
      return EVENT_DISPLAY_NAMES[eventType];
    }

    // Fallback: convert event_type to readable format
    // e.g., "document_upload" → "Document Upload"
    // e.g., "session.heartbeat" → "Session Heartbeat"
    const readable = eventType
      .replace(/[._]/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());

    return readable;
  }

  // Public API
  return {
    getEventDisplayName,
    EVENT_DISPLAY_NAMES
  };
})();

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.EventDisplayNames = EventDisplayNames;
}
