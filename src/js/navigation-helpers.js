/**
 * Navigation Helpers
 * Path resolution and navigation utilities for LANA AI client.
 * Chat navigation opens the global LANA dock when mounted, falling back to
 * dashboard.html with a queued dock action for pages that do not host the dock.
 *
 * Rules:
 *   - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
 */

const NavigationHelpers = {
  /**
   * Resolve path to a target file from current location.
   * Handles file:// protocol depth calculation.
   * @param {string} targetPath - Target file path (e.g., 'dashboard.html', 'matters.html')
   * @returns {string} Resolved relative path
   */
  resolvePath(targetPath) {
    const currentPath = window.location.pathname;

    // For file:// protocol, extract only the relative path from app root
    let relativePath = currentPath;

    const srcIndex = currentPath.lastIndexOf('/src/');
    const publicHtmlIndex = currentPath.lastIndexOf('/public_html/');

    if (publicHtmlIndex !== -1) {
      relativePath = currentPath.substring(publicHtmlIndex + '/public_html/'.length);
    } else if (srcIndex !== -1) {
      relativePath = currentPath.substring(srcIndex + '/src/'.length);
    } else {
      const segments = currentPath.split('/');
      relativePath = segments[segments.length - 1];
    }

    const pathSegments = relativePath.split('/').filter(segment => segment);
    const depth = pathSegments.length - 1;

    if (depth === 0) {
      return targetPath;
    } else {
      return '../'.repeat(depth) + targetPath;
    }
  },

  /**
   * Resolve the dock host path from current location.
   * @returns {string} Resolved path to dashboard.html
   */
  resolveChatPath() {
    return this.resolvePath('dashboard.html');
  },

  /**
   * Store a one-shot dock action for the dashboard-hosted LANA dock.
   * @param {Object} action - Dock action payload.
   */
  queueLanaDockAction(action) {
    if (!action || !window.sessionStorage) return;
    try {
      const payload = Object.assign({ createdAt: Date.now() }, action);
      window.sessionStorage.setItem('lana_dock_pending_action', JSON.stringify(payload));
    } catch (e) { /* ignore unavailable storage */ }
  },

  /**
   * Navigate to the dashboard, which owns the global LANA dock.
   */
  navigateToDockHost() {
    if (window.Lex && window.Lex.Nav) {
      window.Lex.Nav.go('dashboard.html');
      return;
    }
    window.location.href = this.resolveChatPath();
  },

  /**
   * Return the global LANA dock element/singleton when mounted.
   * @returns {HTMLElement|null} Dock element or compatible singleton.
   */
  getLanaDock() {
    if (window.Lex && window.Lex.LanaDock) {
      if (typeof window.Lex.LanaDock.get === 'function') {
        var dock = window.Lex.LanaDock.get();
        if (dock) return dock;
      }
      return window.Lex.LanaDock;
    }
    if (window.document && typeof window.document.querySelector === 'function') {
      return window.document.querySelector('lex-lana-dock');
    }
    return null;
  },

  /**
   * Check if currently on the dock host.
   * @returns {boolean} True if on dashboard.html
   */
  isOnChatPage() {
    return window.location.pathname.endsWith('dashboard.html');
  },

  /**
   * Open an existing conversation in the LANA dock.
   * @param {string} threadId - Conversation thread ID
   * @param {string} matterId - Optional matter ID
   */
  navigateToConversation(threadId, matterId) {
    matterId = matterId || '';
    var dock = this.getLanaDock();
    if (dock && typeof dock.openConversation === 'function') {
      dock.openConversation(threadId, matterId || null);
      return;
    }

    this.queueLanaDockAction({
      type: 'conversation',
      threadId: threadId,
      matterId: matterId || null
    });
    this.navigateToDockHost();
  },

  /**
   * Open a new dock chat.
   */
  navigateToNewProject() {
    var dock = this.getLanaDock();
    if (dock && typeof dock.newChat === 'function') {
      dock.newChat();
      return;
    }

    this.queueLanaDockAction({ type: 'new_chat' });
    this.navigateToDockHost();
  },

  /**
   * Open a new dock chat with matter context.
   * @param {string} matterId - Matter ID
   */
  navigateToMatterChat(matterId) {
    var initialPrompt = null;
    try {
      initialPrompt = window.sessionStorage && window.sessionStorage.getItem('lana_chat_prompt');
    } catch (e) { /* ignore unavailable storage */ }

    var dock = this.getLanaDock();
    if (dock && typeof dock.openWith === 'function') {
      try {
        if (initialPrompt && window.sessionStorage) window.sessionStorage.removeItem('lana_chat_prompt');
      } catch (e) { /* ignore unavailable storage */ }
      if (typeof dock.newChat === 'function') dock.newChat();
      dock.openWith({ matterId: matterId, contextType: 'full_chat', initialPrompt: initialPrompt });
      return;
    }

    this.queueLanaDockAction({
      type: 'matter_chat',
      matterId: matterId,
      initialPrompt: initialPrompt || null
    });
    try {
      if (initialPrompt && window.sessionStorage) window.sessionStorage.removeItem('lana_chat_prompt');
    } catch (e) { /* ignore unavailable storage */ }
    this.navigateToDockHost();
  },

  /**
   * Get current URL parameters.
   * Delegates to Lex.Nav.getParams() when available.
   * @returns {URLSearchParams} Current URL parameters
   */
  getParams() {
    if (window.Lex && window.Lex.Nav) {
      return window.Lex.Nav.getParams();
    }
    return new URLSearchParams(window.location.search);
  },

  /**
   * Validate session ID format.
   * Session IDs should be alphanumeric with hyphens and underscores.
   * Uses string character checking — no regex.
   * @param {string} sessionId - Session ID to validate
   * @returns {boolean} True if valid format
   */
  validateSessionId(sessionId) {
    if (!sessionId) return false;
    var s = String(sessionId);
    if (s.length === 0) return false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var code = s.charCodeAt(i);
      // a-z, A-Z, 0-9, _, -
      var isAlpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      var isDigit = (code >= 48 && code <= 57);
      if (!isAlpha && !isDigit && c !== '_' && c !== '-') return false;
    }
    return true;
  },

  /**
   * Validate matter ID format.
   * Accepts: MATT-XXXXX (native), AS-XXXXX (ActionStep), numeric (legacy), matter_ prefix.
   * Uses string methods — no regex.
   *
   * TODO: In future, dynamically load prefixes from connector registry.
   *
   * @param {string} matterId - Matter ID to validate
   * @returns {boolean} True if valid format
   */
  validateMatterId(matterId) {
    if (!matterId) return false;
    var s = String(matterId);
    if (s.length === 0) return false;

    // Known prefixes (case-insensitive)
    var lower = s.toLowerCase();
    if (lower.indexOf('matt-') === 0) return true;
    if (lower.indexOf('as-') === 0) return true;
    if (lower.indexOf('matter_') === 0) return true;

    // Legacy numeric IDs — check all digits
    var allDigits = true;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (code < 48 || code > 57) { allDigits = false; break; }
    }
    return allDigits;
  },

  /**
   * Update URL without page reload.
   * Delegates to Lex.Nav.updateParams() when available.
   * @param {Object} params - Parameters to set (null values remove keys)
   */
  updateURL(params) {
    if (window.Lex && window.Lex.Nav) {
      window.Lex.Nav.updateParams(params);
      return;
    }

    // Fallback
    var urlParams = new URLSearchParams(window.location.search);
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = params[key];
      if (val === null || val === undefined) {
        urlParams.delete(key);
      } else {
        urlParams.set(key, val);
      }
    }
    var newURL = window.location.pathname + '?' + urlParams.toString();
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
