/**
 * URL Validation Utilities
 *
 * Shared utilities for validating URLs across all pages
 * Handles edge cases in Electron apps on Windows/Mac
 */

window.URLUtils = {
  /**
   * Check if a URL is invalid for API calls
   *
   * Handles edge cases on Windows Electron where origin might be:
   * - "file://" (2 slashes)
   * - "file:///" (3 slashes)
   * - "null" (string)
   * - null/undefined
   *
   * @param {string} url - URL to check
   * @returns {boolean} true if URL is invalid for API calls
   */
  isInvalidUrl(url) {
    if (!url || url === 'null' || url === 'undefined') {
      return true;
    }
    if (url.startsWith('file:')) {
      return true;
    }
    return false;
  },

  /**
   * Get a valid base URL for API calls
   *
   * Priority:
   * 1. Provided baseUrl parameter (if valid)
   * 2. window.api.baseUrl (if available and valid)
   * 3. Electron saved server (if in Electron)
   * 4. window.location.origin (if in browser and valid)
   *
   * @param {string} baseUrl - Optional base URL to validate
   * @returns {Promise<string>} Valid base URL or throws error
   */
  async getValidBaseUrl(baseUrl = '') {
    // Check provided baseUrl
    if (baseUrl && !this.isInvalidUrl(baseUrl)) {
      return baseUrl;
    }

    // Try window.api if available
    if (window.api) {
      if (window.api._readyPromise) {
        await window.api._readyPromise;
      }
      const apiBaseUrl = window.api.baseUrl;
      if (apiBaseUrl && !this.isInvalidUrl(apiBaseUrl)) {
        return apiBaseUrl;
      }
    }

    // Try config
    const configUrl = window.LanaConfig?.API_BASE_URL || '';
    if (configUrl && !this.isInvalidUrl(configUrl)) {
      return configUrl;
    }

    // If in Electron, try to get saved server
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.getSavedServer();
        if (result && result.success && result.server && result.server.url) {
          const electronUrl = result.server.url;
          if (!this.isInvalidUrl(electronUrl)) {
            // Update window.api if available
            if (window.api) {
              window.api.baseUrl = electronUrl;
            }
            return electronUrl;
          }
        }
      } catch (error) {
        console.error('[URLUtils] Failed to get saved server:', error);
      }
    }

    // Fallback to window.location.origin in browser
    if (!window.electronAPI) {
      const origin = window.location.origin;
      if (origin && origin !== 'null' && !origin.startsWith('file:')) {
        return origin;
      }
    }

    // No valid URL found
    throw new Error('No server connection. Please connect to your Lana AI server.');
  },

  /**
   * Construct a full API URL from endpoint
   *
   * @param {string} endpoint - API endpoint path (e.g., '/api/v1/users')
   * @param {string} baseUrl - Optional base URL
   * @returns {Promise<string>} Full URL
   */
  async getApiUrl(endpoint, baseUrl = '') {
    const validBaseUrl = await this.getValidBaseUrl(baseUrl);
    return `${validBaseUrl}${endpoint}`;
  }
};
