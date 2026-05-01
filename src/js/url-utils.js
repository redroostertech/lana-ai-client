/**
 * URL Validation Utilities
 *
 * Shared client-side helpers for resolving the active LANA API base URL.
 * The canonical source is `window.api.baseUrl` (set by `js/api.js` from
 * `localStorage.lana_saved_server` or, in Electron, `electronAPI.getSavedServer()`).
 */

window.URLUtils = {
  /**
   * Check if a URL is invalid for API calls.
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
    if (String(url).startsWith('file:')) {
      return true;
    }
    return false;
  },

  normalizeBaseUrl(url) {
    if (this.isInvalidUrl(url)) {
      return '';
    }

    try {
      const parsed = new URL(String(url).trim());
      if (!/^https?:$/i.test(parsed.protocol)) {
        return '';
      }
      return `${parsed.protocol}//${parsed.host}`;
    } catch (_error) {
      return '';
    }
  },

  /**
   * Resolve the preferred API base synchronously.
   *
   * Priority:
   * 1. Provided baseUrl parameter
   * 2. window.api.baseUrl
   * 3. window.LanaConfig.API_BASE_URL
   * 4. browser same-origin fallback (non-Electron only)
   *
   * @param {string} baseUrl
   * @returns {string}
   */
  getPreferredBaseUrlSync(baseUrl = '') {
    const provided = this.normalizeBaseUrl(baseUrl);
    if (provided) return provided;

    const windowApiBase = this.normalizeBaseUrl(window.api && window.api.baseUrl);
    if (windowApiBase) return windowApiBase;

    const configBase = this.normalizeBaseUrl(window.LanaConfig?.API_BASE_URL || '');
    if (configBase) return configBase;

    if (typeof window !== 'undefined' && !window.electronAPI) {
      return this.normalizeBaseUrl(window.location && window.location.origin);
    }

    return '';
  },

  /**
   * Get a valid base URL for API calls.
   *
   * Priority:
   * 1. Sync resolver chain above
   * 2. Electron saved server
   *
   * @param {string} baseUrl - Optional base URL to validate
   * @returns {Promise<string>} Valid base URL or throws error
   */
  async getValidBaseUrl(baseUrl = '') {
    const resolvedSyncUrl = this.getPreferredBaseUrlSync(baseUrl);
    if (resolvedSyncUrl) {
      if (window.api && !window.api.baseUrl) {
        window.api.baseUrl = resolvedSyncUrl;
      }
      return resolvedSyncUrl;
    }

    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.getSavedServer();
        if (result && result.success && result.server && result.server.url) {
          const electronUrl = this.normalizeBaseUrl(result.server.url);
          if (electronUrl) {
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

    throw new Error('No server connection. Please connect to your Lana AI server.');
  },

  /**
   * Construct a full API URL from endpoint.
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
