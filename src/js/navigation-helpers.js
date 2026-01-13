/**
 * Navigation Helpers
 * Centralized path resolution and navigation utilities for LANA AI client
 */

const NavigationHelpers = {
  /**
   * Resolve path to a target file from current location
   * @param {string} targetPath - Target file path (e.g., 'chat.html', 'matters.html')
   * @returns {string} Resolved relative path
   */
  resolvePath(targetPath) {
    const currentPath = window.location.pathname;

    // For file:// protocol, extract only the relative path from app root
    // Look for known app directories: 'src', 'public_html', or assume everything after last known root
    let relativePath = currentPath;

    // Find the last occurrence of src/ or public_html/ to get relative path
    const srcIndex = currentPath.lastIndexOf('/src/');
    const publicHtmlIndex = currentPath.lastIndexOf('/public_html/');

    if (publicHtmlIndex !== -1) {
      relativePath = currentPath.substring(publicHtmlIndex + '/public_html/'.length);
    } else if (srcIndex !== -1) {
      relativePath = currentPath.substring(srcIndex + '/src/'.length);
    } else {
      // Fallback: assume everything after last slash before filename
      const segments = currentPath.split('/');
      relativePath = segments[segments.length - 1];
    }

    // Calculate directory depth from relative path
    const pathSegments = relativePath.split('/').filter(segment => segment);
    const depth = pathSegments.length - 1; // -1 because last segment is the file name

    if (depth === 0) {
      // We're at root level (e.g., /index.html or /chat.html)
      return targetPath;
    } else {
      // We're in a subdirectory (e.g., /integrations/connectors.html)
      // Need to go up 'depth' levels
      return '../'.repeat(depth) + targetPath;
    }
  },

  /**
   * Resolve path to chat.html from current location
   * @returns {string} Resolved path to chat.html
   */
  resolveChatPath() {
    return this.resolvePath('chat.html');
  },

  /**
   * Check if currently on chat page
   * @returns {boolean} True if on chat.html
   */
  isOnChatPage() {
    return window.location.pathname.endsWith('chat.html');
  },

  /**
   * Navigate to chat page with conversation
   * @param {string} threadId - Conversation thread ID
   * @param {string} matterId - Optional matter ID
   */
  navigateToConversation(threadId, matterId = '') {
    console.log('[NavigationHelpers.navigateToConversation] Called with:', { threadId, matterId });

    const params = new URLSearchParams();
    params.set('session', threadId);
    if (matterId) {
      params.set('matter', matterId);
    }

    const chatPath = this.resolveChatPath();
    const fullUrl = `${chatPath}?${params.toString()}`;

    console.log('[NavigationHelpers.navigateToConversation] Navigating to:', fullUrl);
    console.log('[NavigationHelpers.navigateToConversation] Query params:', params.toString());
    console.log('[NavigationHelpers.navigateToConversation] Current location:', window.location.href);

    window.location.href = fullUrl;
  },

  /**
   * Navigate to chat page with new project modal
   */
  navigateToNewProject() {
    const chatPath = this.resolveChatPath();
    window.location.href = `${chatPath}?openModal=newProject`;
  },

  /**
   * Navigate to chat page with matter context
   * @param {string} matterId - Matter ID
   */
  navigateToMatterChat(matterId) {
    console.log('[NavigationHelpers.navigateToMatterChat] Called with matterId:', matterId);

    const params = new URLSearchParams();
    params.set('matter', matterId);

    const chatPath = this.resolveChatPath();
    const fullUrl = `${chatPath}?${params.toString()}`;

    console.log('[NavigationHelpers.navigateToMatterChat] Navigating to:', fullUrl);
    console.log('[NavigationHelpers.navigateToMatterChat] URL params:', params.toString());

    window.location.href = fullUrl;
  },

  /**
   * Get current URL parameters
   * @returns {URLSearchParams} Current URL parameters
   */
  getParams() {
    return new URLSearchParams(window.location.search);
  },

  /**
   * Validate session ID format
   * @param {string} sessionId - Session ID to validate
   * @returns {boolean} True if valid format
   */
  validateSessionId(sessionId) {
    if (!sessionId) return false;
    // Session IDs should be alphanumeric with hyphens and underscores
    return /^[a-zA-Z0-9_-]+$/.test(sessionId);
  },

  /**
   * Validate matter ID format
   * Accepts: MATT-XXXXX (native), AS-XXXXX (ActionStep), numeric (legacy)
   *
   * TODO: In future, dynamically load prefixes from connector registry
   * When adding new connectors, update the validPatterns array below
   *
   * @param {string} matterId - Matter ID to validate
   * @returns {boolean} True if valid format
   */
  validateMatterId(matterId) {
    if (!matterId) return false;

    const matterIdString = String(matterId);

    // TODO: Replace this static list with dynamic loading from connector registry
    // Each connector should define its matter_id prefix format
    const validPatterns = [
      /^MATT-/i,      // Native LANA matters
      /^AS-/i,        // ActionStep imported matters
      /^matter_/i,    // Legacy matter_ prefix
      /^\d+$/         // Legacy numeric IDs
      // ADD NEW CONNECTOR PREFIXES HERE (e.g., /^CLIO-/i, /^MY-/i, etc.)
    ];

    return validPatterns.some(pattern => pattern.test(matterIdString));
  },

  /**
   * Update URL without page reload
   * @param {Object} params - Parameters to set
   */
  updateURL(params) {
    const urlParams = new URLSearchParams(window.location.search);

    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        urlParams.delete(key);
      } else {
        urlParams.set(key, value);
      }
    });

    const newURL = `${window.location.pathname}?${urlParams.toString()}`;
    window.history.pushState({}, '', newURL);
  }
};

// Export for use across the application
if (typeof window !== 'undefined') {
  window.NavigationHelpers = NavigationHelpers;
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NavigationHelpers;
}
