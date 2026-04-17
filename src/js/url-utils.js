/**
 * URL Validation Utilities
 *
 * Shared utilities for validating URLs across all pages.
 * This is the client-side source of truth for resolving the active LANA API
 * base after discovery/login inside the automation shell and embedded views.
 */

window.URLUtils = {
  getAutomationDiscoveryStorageKey() {
    return 'lana_automation_discovery_server_url';
  },

  getTrustedAutomationApiBaseCookieName() {
    return 'lana_automation_api_base_url';
  },

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

  getCookieValue(name) {
    if (typeof document === 'undefined' || !name) return '';
    const cookieString = document.cookie || '';
    if (!cookieString) return '';
    const prefix = `${name}=`;
    const match = cookieString
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix));
    if (!match) return '';
    return decodeURIComponent(match.slice(prefix.length));
  },

  getStoredAutomationApiBaseUrl() {
    try {
      if (typeof localStorage === 'undefined') return '';
      return this.normalizeBaseUrl(
        localStorage.getItem(this.getAutomationDiscoveryStorageKey()) || ''
      );
    } catch (_error) {
      return '';
    }
  },

  getTrustedAutomationApiBaseFromCookie() {
    return this.normalizeBaseUrl(
      this.getCookieValue(this.getTrustedAutomationApiBaseCookieName())
    );
  },

  /**
   * Resolve the preferred API base synchronously from the same sources the
   * automation app uses after discovery/login.
   *
   * Priority:
   * 1. Provided baseUrl parameter
   * 2. window.api.baseUrl
   * 3. window.LanaConfig.API_BASE_URL
   * 4. automation discovery localStorage
   * 5. trusted automation cookie
   * 6. browser same-origin fallback
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

    const discoveredBase = this.getStoredAutomationApiBaseUrl();
    if (discoveredBase) return discoveredBase;

    const cookieBase = this.getTrustedAutomationApiBaseFromCookie();
    if (cookieBase) return cookieBase;

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
