// api.js - API Client for LanaAI
// Supports configurable API_BASE_URL and Demo Mode

/**
 * Get the correct relative path from any page
 * Handles being in subdirectories like /integrations/
 *
 * @param {string} targetPage - The target HTML file (e.g., 'login.html', 'matters.html')
 * @returns {string} The correct relative path
 */
function getPagePath(targetPage) {
  const currentPath = window.location.pathname;

  // Extract just the filename from current path
  const currentFile = currentPath.split('/').pop();

  // Check if we're in a subdirectory by seeing if path contains a directory before the file
  // For file:// protocol: /Users/redroostertechnologies/Desktop/lana-client/public_html/integrations/connectors.html
  // For http:// protocol: /integrations/connectors.html

  // For file:// protocol, find the base directory (public_html or src)
  if (window.location.protocol === 'file:') {
    // Check if we're in a subdirectory within public_html or src
    if (currentPath.includes('/integrations/') ||
        currentPath.includes('/admin/') ||
        currentPath.includes('/workflows/') ||
        currentPath.includes('/insights/')) {
      return '../' + targetPage;
    }
    return targetPage;
  }

  // For http/https protocol, use the standard depth calculation
  const depth = (currentPath.match(/\//g) || []).length - 1;
  const upLevels = Math.max(0, depth - 1);
  return upLevels > 0 ? '../'.repeat(upLevels) + targetPage : targetPage;
}

/**
 * Get the correct path to login.html from any page
 */
function getLoginPath() {
  return getPagePath('login.html');
}

class ApiClient {
  constructor() {
    // Get configuration from config.js (must be loaded before this script)
    this.config = window.LanaConfig || {};

    // Initialize baseUrl - will be updated if running in Electron
    // For Electron: empty string means auto-discovery (server URL comes from electron-storage)
    // For browser: empty string means use current origin
    this.baseUrl = this.config.API_BASE_URL || '';
    this._ready = false;
    this._streamingActive = false; // Guard: prevents page navigation during SSE streaming

    // Check if running in Electron and get server URL from saved connection
    // This overrides config.js API_BASE_URL for auto-discovery mode
    if (window.electronAPI) {
      // Synchronously check localStorage first so baseUrl is available immediately
      // This prevents race conditions where async IPC hasn't resolved yet
      try {
        const savedServer = localStorage.getItem('lana_saved_server');
        if (savedServer) {
          const serverInfo = JSON.parse(savedServer);
          if (serverInfo.url) {
            this.baseUrl = serverInfo.url;
            console.log('[LanaAPI] Pre-loaded server URL from localStorage:', this.baseUrl);
          }
        }
      } catch (err) {
        console.error('[LanaAPI] Failed to pre-load server URL from localStorage:', err);
      }

      // Then async confirm/update from Electron storage (source of truth)
      this._readyPromise = window.electronAPI.getSavedServer().then(result => {
        if (result && result.success && result.server && result.server.url) {
          this.baseUrl = result.server.url;
          console.log('[LanaAPI] Confirmed server URL from Electron:', this.baseUrl);
          // Keep localStorage in sync
          try {
            localStorage.setItem('lana_saved_server', JSON.stringify(result.server));
          } catch (e) { /* ignore */ }
        } else if (!this.baseUrl) {
          console.log('[LanaAPI] No server URL yet - will redirect to login on first API call');
        }
        this._ready = true;
        return this.baseUrl;
      }).catch((err) => {
        console.error('[LanaAPI] Failed to get saved server from Electron:', err);
        // baseUrl already set from localStorage sync check above
        this._ready = true;
        return this.baseUrl;
      });
    } else {
      // Running in browser - if empty, use current origin
      // But only if we're not on a file:// protocol (which would be Electron without electronAPI)
      const origin = window.location.origin;
      if (!this.baseUrl && window.location.protocol !== 'file:' && origin && origin !== 'null') {
        this.baseUrl = origin;
      }
      this._ready = true;
      this._readyPromise = Promise.resolve(this.baseUrl);
    }

    this.demoMode = this.config.DEMO_MODE || false;
    this.debugMode = this.config.DEBUG_MODE || false;
    this.timeout = this.config.REQUEST_TIMEOUT || 30000;

    // Token refresh management
    this.refreshTimer = null;
    this.lastActivityTime = Date.now();
    this.isRefreshing = false;

    if (this.demoMode) {
      // In demo mode, set up fake authentication
      this.token = 'demo-token-' + Date.now();
      this.user = this.config.DEMO_USER || { id: 'demo', email: 'demo@lana.ai' };
      localStorage.setItem('token', this.token);
      localStorage.setItem('user', JSON.stringify(this.user));
      this.log('Demo mode enabled - using mock data');
    } else {
      // Load from localStorage, but invalidate demo tokens when not in demo mode
      const storedToken = localStorage.getItem('token');
      if (storedToken && storedToken.startsWith('demo-token-')) {
        // Clear demo credentials when switching to live mode
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.token = null;
        this.user = null;
        this.log('Cleared demo credentials - switching to live mode');
      } else {
        this.token = storedToken;
        this.user = JSON.parse(localStorage.getItem('user') || 'null');

        // Start automatic token refresh if we have a valid token
        if (this.token) {
          this.startTokenRefresh();
          this.setupActivityListener();

          // Initialize and start session tracking for auto-login (Electron only)
          if (window.electronAPI) {
            this._readyPromise.then(async () => {
              try {
                await window.electronAPI.invoke('session-tracker:initialize', this.baseUrl, this.token);
                await window.electronAPI.invoke('session-tracker:start');
                this.log('Session tracking initialized and started (auto-login)');
              } catch (error) {
                console.warn('[LanaAPI] Failed to start session tracking (auto-login):', error);
              }
            });
          }
        }
      }
    }
  }

  log(...args) {
    if (this.debugMode) {
      console.log('[LanaAPI]', ...args);
    }
  }

  /**
   * Check if a URL is invalid for API calls (file:// protocol or null)
   * Handles edge cases on Windows Electron where origin might be:
   * - "file://" (2 slashes)
   * - "file:///" (3 slashes)
   * - "null" (string)
   * - null/undefined
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
  }

  /**
   * Parse JWT token to extract payload (including expiration time)
   * @param {string} token - JWT token
   * @returns {Object|null} Decoded payload or null if invalid
   */
  parseJWT(token) {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1]));
      return payload;
    } catch (error) {
      this.log('Failed to parse JWT:', error);
      return null;
    }
  }

  /**
   * Get token expiration time in milliseconds
   * @returns {number|null} Expiration timestamp or null if no token/invalid
   */
  getTokenExpiration() {
    if (!this.token) return null;
    const payload = this.parseJWT(this.token);
    if (!payload || !payload.exp) return null;
    return payload.exp * 1000; // Convert to milliseconds
  }

  /**
   * Check if token is near expiration (within threshold)
   * @param {number} thresholdMs - Time before expiration to consider "near" (default: 1 hour)
   * @returns {boolean} True if token expires soon
   */
  isTokenNearExpiration(thresholdMs = 60 * 60 * 1000) {
    const expiration = this.getTokenExpiration();
    if (!expiration) return false;
    const now = Date.now();
    return (expiration - now) < thresholdMs;
  }

  /**
   * Check if token is expired
   * @returns {boolean} True if token is expired
   */
  isTokenExpired() {
    const expiration = this.getTokenExpiration();
    if (!expiration) return false;
    return Date.now() >= expiration;
  }

  /**
   * Start automatic token refresh mechanism
   * Refreshes token periodically before it expires
   */
  startTokenRefresh() {
    // Clear any existing timer
    this.stopTokenRefresh();

    // Calculate when to refresh (refresh 1 hour before expiration)
    const expiration = this.getTokenExpiration();
    if (!expiration) {
      this.log('Cannot start token refresh: no expiration in token');
      return;
    }

    const now = Date.now();
    const timeUntilExpiration = expiration - now;
    const refreshThreshold = 60 * 60 * 1000; // 1 hour

    // If token expires in less than 1 hour, refresh immediately
    if (timeUntilExpiration < refreshThreshold) {
      this.log('Token expires soon, refreshing immediately');
      this.performTokenRefresh();
      return;
    }

    // Schedule refresh 1 hour before expiration
    const timeUntilRefresh = timeUntilExpiration - refreshThreshold;
    this.log(`Token refresh scheduled in ${Math.round(timeUntilRefresh / 1000 / 60)} minutes`);

    this.refreshTimer = setTimeout(() => {
      this.performTokenRefresh();
    }, timeUntilRefresh);
  }

  /**
   * Stop automatic token refresh
   */
  stopTokenRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Perform token refresh and reschedule next refresh
   */
  async performTokenRefresh() {
    if (this.isRefreshing) {
      this.log('Token refresh already in progress');
      return;
    }

    if (this.demoMode) {
      this.log('Demo mode - skipping token refresh');
      return;
    }

    this.isRefreshing = true;

    try {
      this.log('Refreshing token...');
      const result = await this.refreshToken();

      if (result && result.token) {
        this.log('Token refreshed successfully');
        // Restart the refresh timer with the new token
        this.startTokenRefresh();
      } else {
        this.log('Token refresh returned no token');
      }
    } catch (error) {
      console.warn('[LanaAPI] Token refresh failed (will retry on next user action):', error.message);
      // Don't redirect to login here — let the next user-initiated API request
      // handle the 401 naturally. Redirecting during background token refresh
      // can abort in-flight SSE streaming and other active requests.
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Setup activity listener to refresh token on user activity
   * Refreshes token if user is active and token is near expiration
   */
  setupActivityListener() {
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const refreshThreshold = 60 * 60 * 1000; // 1 hour
    const activityCheckInterval = 5 * 60 * 1000; // Check every 5 minutes

    const handleActivity = () => {
      this.lastActivityTime = Date.now();
    };

    // Add event listeners for user activity
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Periodically check if we should refresh based on activity
    this.activityCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      const wasRecentlyActive = timeSinceActivity < 5 * 60 * 1000; // Active in last 5 minutes

      // If user was recently active and token is near expiration, refresh it
      if (wasRecentlyActive && this.isTokenNearExpiration(refreshThreshold)) {
        this.log('User is active and token near expiration, refreshing...');
        this.performTokenRefresh();
      }
    }, activityCheckInterval);
  }

  /**
   * Cleanup activity listener
   */
  cleanupActivityListener() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }
  }

  showSessionExpiredModal() {
    // If SSE streaming is active, defer the redirect to avoid aborting the stream.
    // The stream's own error handling will detect the expired token on next request.
    if (this._streamingActive) {
      console.warn('[LanaAPI] Session expired but streaming is active — deferring redirect');
      this._pendingSessionExpired = true;
      return;
    }

    // Check if DOM is ready
    if (!document.body) {
      console.warn('[LanaAPI] DOM not ready, redirecting immediately');
      window.location.href = getLoginPath();
      return;
    }

    // Prevent multiple modals
    if (document.getElementById('sessionExpiredModal')) return;

    // Clear local storage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.token = null;
    this.user = null;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    overlay.id = 'sessionExpiredModal';

    overlay.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl p-8 max-w-md mx-4 text-center">
        <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
          </svg>
        </div>
        <h3 class="text-xl font-semibold text-gray-900 mb-2">Session Expired</h3>
        <p class="text-gray-600 mb-4">Your session has expired. Redirecting to login...</p>
        <div class="text-3xl font-bold text-indigo-600" id="sessionCountdown">3</div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Countdown and redirect
    let countdown = 3;
    const countdownEl = document.getElementById('sessionCountdown');

    const interval = setInterval(() => {
      countdown--;
      if (countdownEl) countdownEl.textContent = countdown;

      if (countdown <= 0) {
        clearInterval(interval);
        window.location.href = getLoginPath();
      }
    }, 1000);
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request(method, endpoint, data = null, options = {}) {
    // Demo mode: return mock data instead of making real requests
    if (this.demoMode) {
      return this.getMockResponse(method, endpoint, data);
    }

    // Ensure we have a valid baseUrl
    let baseUrl = this.baseUrl;

    // If running in Electron and baseUrl is invalid, try to get saved server
    if (window.electronAPI && this.isInvalidUrl(baseUrl)) {
      try {
        const result = await window.electronAPI.getSavedServer();
        if (result && result.success && result.server && result.server.url) {
          baseUrl = result.server.url;
          this.baseUrl = baseUrl; // Cache it for future requests
          console.log('[LanaAPI] Got server URL from Electron:', baseUrl);
        } else {
          // Try localStorage as fallback
          const savedServer = localStorage.getItem('lana_saved_server');
          if (savedServer) {
            const serverInfo = JSON.parse(savedServer);
            if (serverInfo.url) {
              baseUrl = serverInfo.url;
              this.baseUrl = baseUrl;
              console.log('[LanaAPI] Got server URL from localStorage:', baseUrl);
            }
          }
        }
      } catch (error) {
        console.error('[LanaAPI] Failed to get saved server:', error);
      }
    }

    // Fallback for browser if baseUrl is still invalid
    if (this.isInvalidUrl(baseUrl)) {
      // In Electron with file:// protocol, this won't help, but in browser it will
      if (!window.electronAPI) {
        const origin = window.location.origin;
        if (origin && origin !== 'null' && !origin.startsWith('file:')) {
          baseUrl = origin;
        }
      }

      // If still no valid URL, throw error instead of redirecting.
      // Redirecting from within request() can abort in-flight SSE streams
      // and other concurrent requests. Let the caller handle the navigation.
      if (this.isInvalidUrl(baseUrl)) {
        console.error('[LanaAPI] No server URL available for request:', endpoint);
        throw new ApiError('No server connection available', 0, null);
      }
    }

    const url = `${baseUrl}${endpoint}`;
    const config = {
      method,
      headers: this.getHeaders(),
      ...options
    };

    // Handle different data types
    if (data && method !== 'GET') {
      if (data instanceof FormData) {
        // FormData: let browser set Content-Type with boundary
        config.body = data;
        // Remove Content-Type header - browser will set it with multipart boundary
        delete config.headers['Content-Type'];
      } else {
        // JSON data
        config.body = JSON.stringify(data);
      }
    }

    this.log(`${method} ${endpoint}`, data);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      config.signal = controller.signal;

      const response = await fetch(url, config);
      clearTimeout(timeoutId);

      // Read response as text first, then parse as JSON
      // This avoids "body stream already read" errors
      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (jsonError) {
        // If JSON parsing fails, we already have the text for error message
        console.error('[LanaAPI] Failed to parse JSON response:', text);
        throw new ApiError(
          `Server returned invalid response: ${text.substring(0, 100)}`,
          response.status,
          null
        );
      }

      if (!response.ok) {
        // Check for authentication/session errors - redirect to login
        const errorCode = result.error?.code;
        // Support both error formats: {error: {message: ...}} and {detail: ...}
        const errorMessage = result.error?.message || result.detail || result.message || '';

        // Don't show session expired modal for login-related requests or on the login page
        const isLoginRequest = endpoint.includes('/auth/login') || endpoint.includes('/auth/register');
        const isOnLoginPage = window.location.pathname.includes('login.html');

        if (!isLoginRequest && !isOnLoginPage && (
            response.status === 401 ||
            errorCode === 'AUTHENTICATION_ERROR' ||
            errorCode === 'TOKEN_EXPIRED' ||
            errorMessage.toLowerCase().includes('session expired') ||
            errorMessage.toLowerCase().includes('token expired') ||
            errorMessage.toLowerCase().includes('not authenticated'))) {

          // Show session expired modal and redirect
          this.showSessionExpiredModal();
          throw new ApiError(result.error?.message || result.detail || 'Session expired', response.status, result);
        }

        // Extract error message with comprehensive fallback chain
        const finalErrorMessage = result.error?.message || result.detail || result.message || 'Request failed';

        // Log the error details for debugging
        console.error('[LanaAPI] Request failed:', {
          endpoint,
          status: response.status,
          errorCode,
          errorMessage: finalErrorMessage,
          fullResponse: result
        });

        // Support both error formats: {error: {message: ...}} and {detail: ...}
        throw new ApiError(finalErrorMessage, response.status, result);
      }

      this.log(`Response:`, result);
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError('Request timeout', 408, null);
      }
      if (error instanceof ApiError) throw error;

      // For non-ApiError exceptions, provide more context
      console.error('[LanaAPI] Unexpected error:', error);
      throw new ApiError(error.message || 'Network error occurred', 0, null);
    }
  }

  // ============================================================
  // DEMO MODE: Mock Response Handler
  // ============================================================
  async getMockResponse(method, endpoint, data) {
    const mock = window.MockData || {};

    // Simulate network delay
    await (mock.delay ? mock.delay(300) : new Promise(r => setTimeout(r, 300)));

    this.log(`[DEMO] ${method} ${endpoint}`, data);

    // Parse endpoint to determine response
    const path = endpoint.split('?')[0];

    // -------------------- AUTH --------------------
    if (path === '/api/v1/auth/login' && method === 'POST') {
      return {
        token: this.token,
        user: this.user,
        message: 'Login successful (demo mode)'
      };
    }

    if (path === '/api/v1/auth/logout' && method === 'POST') {
      return { success: true };
    }

    if (path === '/api/v1/auth/me') {
      return { user: this.user };
    }

    if (path === '/api/v1/auth/refresh') {
      return { token: this.token };
    }

    if (path.includes('/api/v1/auth/request-password-reset')) {
      return { success: true, message: 'Password reset email sent (demo mode)' };
    }

    if (path.includes('/api/v1/auth/reset-password')) {
      return { success: true, message: 'Password reset successful (demo mode)' };
    }

    if (path.includes('/api/v1/auth/activate')) {
      return { success: true, message: 'Account activated (demo mode)' };
    }

    // -------------------- USERS --------------------
    if (path === '/api/v1/admin/users' && method === 'GET') {
      return { users: mock.users || [], total: (mock.users || []).length };
    }

    if (path.match(/\/api\/v1\/admin\/users\/[^/]+$/) && method === 'GET') {
      const userId = path.split('/').pop();
      const user = mock.users?.find(u => u.id === userId) || mock.users?.[0] || {};
      return { user };
    }

    if (path === '/api/v1/admin/users' && method === 'POST') {
      const newUser = { id: mock.generateId?.('u') || 'u-new', ...data, created_at: new Date().toISOString() };
      return { user: newUser, message: 'User created (demo mode)' };
    }

    if (path.match(/\/api\/v1\/admin\/users\/[^/]+$/) && method === 'PUT') {
      const userId = path.split('/').pop();
      const user = mock.users?.find(u => u.id === userId) || mock.users?.[0] || {};
      return { user: { ...user, ...data }, message: 'User updated (demo mode)' };
    }

    if (path.match(/\/api\/v1\/admin\/users\/[^/]+$/) && method === 'DELETE') {
      return { success: true, message: 'User deleted (demo mode)' };
    }

    if (path.includes('/check-email')) {
      return { available: true };
    }

    if (path.includes('/check-username')) {
      return { available: true };
    }

    if (path.includes('/roles') && path.includes('/admin/users/')) {
      const userId = path.split('/')[4];
      const user = mock.users?.find(u => u.id === userId);
      if (method === 'GET') {
        return { roles: user?.roles?.map(r => mock.roles?.find(role => role.name === r)) || [] };
      }
      return { success: true, message: 'Role updated (demo mode)' };
    }

    if (path.includes('/sessions') && path.includes('/admin/users/')) {
      if (method === 'GET') {
        return { sessions: mock.sessions?.slice(0, 2) || [] };
      }
      return { success: true, message: 'Sessions revoked (demo mode)' };
    }

    if (path.includes('/activate') || path.includes('/deactivate') ||
        path.includes('/reset-password') || path.includes('/regenerate') ||
        path.includes('/temporary-password')) {
      return { success: true, message: 'Action completed (demo mode)' };
    }

    // -------------------- ROLES --------------------
    if (path === '/api/v1/rbac/roles' && method === 'GET') {
      return { roles: mock.roles || [] };
    }

    if (path.match(/\/api\/v1\/rbac\/roles\/[^/]+$/) && method === 'GET') {
      const roleId = path.split('/').pop();
      const role = mock.roles?.find(r => r.id === roleId) || mock.roles?.[0] || {};
      return { role };
    }

    if (path === '/api/v1/rbac/roles' && method === 'POST') {
      const newRole = { id: mock.generateId?.('r') || 'r-new', ...data, created_at: new Date().toISOString() };
      return { role: newRole, message: 'Role created (demo mode)' };
    }

    if (path.match(/\/api\/v1\/rbac\/roles\/[^/]+$/) && (method === 'PUT' || method === 'DELETE')) {
      return { success: true, message: `Role ${method === 'DELETE' ? 'deleted' : 'updated'} (demo mode)` };
    }

    if (path.includes('/permissions')) {
      if (path.includes('/inherited')) {
        // Return direct and inherited permissions for role details view
        const roleId = path.split('/')[4]; // Extract role ID from path
        const role = mock.roles?.find(r => r.id === roleId) || mock.roles?.[0];
        const directPerms = role?.permissions || [];
        // Simulate some inherited permissions (subset of all permissions not in direct)
        const allPermNames = mock.permissions?.map(p => p.name) || [];
        const inheritedPerms = allPermNames.filter(p => !directPerms.includes(p)).slice(0, 3);
        return { direct_permissions: directPerms, inherited_permissions: inheritedPerms };
      }
      return { permissions: mock.permissions || [] };
    }

    // -------------------- MATTERS --------------------
    if (path === '/api/v1/matters' && method === 'GET') {
      return { matters: mock.matters || [], total: (mock.matters || []).length };
    }

    if (path.match(/\/api\/v1\/matters\/[^/]+$/) && method === 'GET') {
      const matterId = path.split('/').pop();
      const matter = mock.matters?.find(m => m.id === matterId) || mock.matters?.[0] || {};
      return { matter };
    }

    if (path === '/api/v1/matters' && method === 'POST') {
      const newMatter = {
        id: mock.generateId?.('m') || 'm-new',
        ...data,
        created_at: new Date().toISOString(),
        document_count: 0,
        status: 'active'
      };
      return { matter: newMatter, message: 'Matter created (demo mode)' };
    }

    if (path.match(/\/api\/v1\/matters\/[^/]+$/) && (method === 'PUT' || method === 'DELETE')) {
      return { success: true, message: `Matter ${method === 'DELETE' ? 'deleted' : 'updated'} (demo mode)` };
    }

    if (path.includes('/matters/') && path.includes('/permissions')) {
      return { permissions: ['read', 'write', 'delete', 'share'] };
    }

    if (path.includes('/share')) {
      return { success: true, message: 'Share updated (demo mode)' };
    }

    // -------------------- ORGANIZATIONS --------------------
    if (path === '/api/v1/admin/organizations' && method === 'GET') {
      return { organizations: mock.organizations || [], total: (mock.organizations || []).length };
    }

    if (path.match(/\/api\/v1\/organizations\/[^/]+$/) && method === 'GET') {
      const orgId = path.split('/').pop();
      const organization = mock.organizations?.find(o => o.id === orgId) || mock.organizations?.[0] || this.config.DEMO_ORGANIZATION;
      return { organization };
    }

    if (path.includes('/organizations/') && path.includes('/stats')) {
      const org = mock.organizations?.[0] || {};
      return {
        user_count: org.user_count || 10,
        matter_count: org.matter_count || 47,
        storage_used: org.storage_used || 52428800000,
        storage_limit: org.storage_limit || 107374182400
      };
    }

    // -------------------- AUDIT --------------------
    if (path === '/api/v1/audit/logs' && method === 'GET') {
      return { logs: mock.auditLogs || [], total: (mock.auditLogs || []).length };
    }

    if (path === '/api/v1/audit/query' && method === 'POST') {
      return { logs: mock.auditLogs || [], total: (mock.auditLogs || []).length };
    }

    if (path === '/api/v1/audit/event-types') {
      return { event_types: ['user.login', 'user.logout', 'document.upload', 'document.download', 'matter.create', 'matter.update', 'settings.update', 'role.assign'] };
    }

    if (path === '/api/v1/audit/statistics') {
      return {
        total_events: 1250,
        events_by_type: { 'user.login': 450, 'document.upload': 320, 'matter.create': 180 },
        events_by_day: { '2024-11-30': 85, '2024-11-29': 92, '2024-11-28': 78 }
      };
    }

    if (path === '/api/v1/audit/export') {
      return { download_url: '#demo-export', message: 'Export ready (demo mode)' };
    }

    // -------------------- SESSIONS --------------------
    if (path === '/api/v1/admin/sessions' && method === 'GET') {
      return { sessions: mock.sessions || [], total: (mock.sessions || []).length };
    }

    if (path.match(/\/api\/v1\/admin\/sessions\/[^/]+$/) && method === 'DELETE') {
      return { success: true, message: 'Session terminated (demo mode)' };
    }

    // -------------------- HEALTH --------------------
    if (path.includes('/health')) {
      return mock.health || { status: 'healthy', services: {} };
    }

    // -------------------- PLUGINS --------------------
    if (path === '/api/v1/plugins' || path === '/api/v1/plugins/installed') {
      return { plugins: mock.plugins?.installed || [] };
    }

    if (path === '/api/v1/plugins/marketplace') {
      return { plugins: mock.plugins?.marketplace || [] };
    }

    if (path.includes('/plugins/install')) {
      return { success: true, plugin: { id: 'p-new', ...data, status: 'running' } };
    }

    if (path.match(/\/api\/v1\/plugins\/[^/]+$/) && method === 'GET') {
      const pluginId = path.split('/').pop();
      const plugin = mock.plugins?.installed?.find(p => p.id === pluginId) || mock.plugins?.installed?.[0] || {};
      return { plugin };
    }

    if (path.includes('/plugins/') && (path.includes('/start') || path.includes('/stop') || path.includes('/restart'))) {
      return { success: true, message: 'Plugin action completed (demo mode)' };
    }

    if (path.match(/\/api\/v1\/plugins\/[^/]+$/) && method === 'DELETE') {
      return { success: true, message: 'Plugin uninstalled (demo mode)' };
    }

    // -------------------- INTEGRATIONS --------------------
    if (path.includes('/integrations')) {
      return mock.integrations || {};
    }

    // -------------------- REPORTING --------------------
    if (path.includes('/reporting') || path.includes('/analytics')) {
      return mock.reporting || {};
    }

    // -------------------- SETTINGS --------------------
    if (path.includes('/settings') || path.includes('/config')) {
      if (method === 'GET') {
        return mock.settings || {};
      }
      return { success: true, message: 'Settings saved (demo mode)' };
    }

    // -------------------- ONBOARDING --------------------
    if (path.includes('/onboarding')) {
      return mock.onboarding || {};
    }

    // -------------------- PROFILE --------------------
    if (path.includes('/profile')) {
      if (method === 'GET') {
        return { ...this.user, bio: 'Legal professional with 10+ years experience' };
      }
      return { success: true, message: 'Profile updated (demo mode)' };
    }

    if (path.includes('/preferences')) {
      if (method === 'GET') {
        return { theme: 'light', notifications: true, language: 'en' };
      }
      return { success: true, message: 'Preferences saved (demo mode)' };
    }

    // -------------------- MFA --------------------
    if (path.includes('/mfa')) {
      if (path.includes('/status')) {
        return { enabled: false, methods: [] };
      }
      if (path.includes('/setup')) {
        return { secret: 'DEMO-SECRET-KEY', qr_code: 'demo-qr-data' };
      }
      return { success: true, message: 'MFA action completed (demo mode)' };
    }

    // -------------------- ACTIVITY --------------------
    if (path.includes('/activity')) {
      // Transform mock data to match API format
      const rawActivities = mock.recentActivity || [];
      const activities = rawActivities.map((a, i) => ({
        id: `act-${i + 1}`,
        event_type: a.type,
        resource_type: a.type?.includes('document') ? 'document' : a.type?.includes('matter') ? 'matter' : 'other',
        resource_name: a.target,
        description: a.action ? `${a.action} ${a.target}` : null,
        matter: a.matter,
        created_at: a.timestamp,
        user: {
          id: `user-${i}`,
          first_name: a.user?.split(' ')[0] || 'User',
          last_name: a.user?.split(' ')[1] || '',
          email: `${(a.user || 'user').toLowerCase().replace(' ', '.')}@example.com`
        }
      }));
      return { activities, total: activities.length };
    }

    // -------------------- NOTIFICATIONS --------------------
    if (path === '/api/v1/notifications' && method === 'GET') {
      return { notifications: mock.notifications || [], unread_count: (mock.notifications || []).filter(n => !n.read).length };
    }

    if (path.includes('/notifications/') && path.includes('/read')) {
      return { success: true };
    }

    // Mark all notifications as read
    if (path === '/api/v1/notifications/mark-all-read' && method === 'POST') {
      return { success: true, marked_read: 0 };
    }

    if (path === '/api/v1/notifications/admin' && method === 'POST') {
      return { success: true, message: 'Admin notification created (demo mode)' };
    }

    // -------------------- GROUPS --------------------
    if (path === '/api/v1/groups' && method === 'GET') {
      return { groups: [] };
    }

    if (path === '/api/v1/groups' && method === 'POST') {
      return { group: { id: mock.generateId?.('g') || 'g-new', ...data }, message: 'Group created (demo mode)' };
    }

    // -------------------- DOCUMENTS --------------------
    if (path.includes('/documents') || path.includes('/storage') || path.includes('/files')) {
      if (method === 'GET') {
        return { documents: mock.documents || [], files: mock.documents || [], total: (mock.documents || []).length };
      }
      return { success: true, message: 'Document action completed (demo mode)' };
    }

    // -------------------- CHAT / RAG --------------------
    if (path.includes('/chat') || path.includes('/rag') || path.includes('/conversations')) {
      if (path.includes('/conversations') && method === 'GET') {
        if (path.match(/\/conversations\/[^/]+$/)) {
          const convId = path.split('/').pop();
          const conversation = mock.conversations?.find(c => c.id === convId) || mock.conversations?.[0] || {};
          return { conversation };
        }
        return { conversations: mock.conversations || [] };
      }

      if (path.includes('/query') || path.includes('/chat')) {
        const responses = mock.chatResponses || {};
        const query = data?.query?.toLowerCase() || data?.message?.toLowerCase() || '';

        let response = responses.default;
        if (query.includes('contract')) response = responses.contract;
        else if (query.includes('search') || query.includes('find')) response = responses.search;
        else if (query.includes('legal') || query.includes('law')) response = responses.legal;

        return {
          response: response,
          sources: mock.documents?.slice(0, 3) || [],
          conversation_id: mock.generateId?.('conv') || 'conv-new'
        };
      }

      return { success: true };
    }

    // -------------------- SEARCH --------------------
    if (path.includes('/search')) {
      return {
        results: mock.documents?.slice(0, 5) || [],
        total: 5,
        query: data?.query || ''
      };
    }

    // -------------------- DASHBOARD --------------------
    if (path.includes('/dashboard') || path.includes('/stats')) {
      return mock.dashboardStats || {};
    }

    // -------------------- DEFAULT --------------------
    this.log(`[DEMO] No mock handler for: ${method} ${endpoint}`);
    return { success: true, demo: true, message: 'Demo mode - no specific handler' };
  }

  // ============================================================
  // HTTP Methods
  // ============================================================
  get(endpoint) { return this.request('GET', endpoint); }
  post(endpoint, data) { return this.request('POST', endpoint, data); }
  put(endpoint, data) { return this.request('PUT', endpoint, data); }
  patch(endpoint, data) { return this.request('PATCH', endpoint, data); }
  delete(endpoint, data) { return this.request('DELETE', endpoint, data); }

  // ============================================================
  // Auth
  // ============================================================
  async login(email, password, mfaToken = null) {
    if (this.demoMode) {
      // Demo mode: accept any credentials
      this.token = 'demo-token-' + Date.now();
      this.user = this.config.DEMO_USER;
      localStorage.setItem('token', this.token);
      localStorage.setItem('user', JSON.stringify(this.user));
      return { token: this.token, user: this.user };
    }

    const data = { email, password };
    if (mfaToken) data.mfa_token = mfaToken;
    const result = await this.post('/api/v1/auth/login', data);
    this.token = result.token;
    this.user = result.user;
    localStorage.setItem('token', result.token);
    localStorage.setItem('user', JSON.stringify(result.user));

    // Start automatic token refresh and activity monitoring after login
    this.startTokenRefresh();
    this.setupActivityListener();

    // Start session tracking (Electron client only)
    if (window.electronAPI) {
      try {
        // First initialize session tracker with backend URL and token
        await window.electronAPI.invoke('session-tracker:initialize', this.baseUrl, this.token);
        // Then start the session
        await window.electronAPI.invoke('session-tracker:start');
        this.log('Session tracking initialized and started');
      } catch (error) {
        console.warn('[LanaAPI] Failed to start session tracking:', error);
      }
    }

    return result;
  }

  async logout() {
    try {
      if (!this.demoMode) {
        await this.post('/api/v1/auth/logout');
      }
    } finally {
      // Clean up token refresh timers and listeners
      this.stopTokenRefresh();
      this.cleanupActivityListener();

      this.token = null;
      this.user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }

  async refreshToken() {
    if (this.demoMode) {
      return { token: this.token };
    }
    const result = await this.get('/api/v1/auth/refresh');
    this.token = result.token;
    localStorage.setItem('token', result.token);
    return result;
  }

  async getCurrentUser() {
    if (this.demoMode) {
      return { user: this.user };
    }
    return this.get('/api/v1/auth/me');
  }

  /**
   * Load full user profile with roles and update localStorage
   * This should be called after login to ensure roles are available
   */
  async loadUserProfile() {
    if (this.demoMode) {
      return { user: this.user };
    }
    
    const result = await this.getProfile();
    const profile = result.profile || result.user || result;
    
    // Update the user object with full profile data including roles
    this.user = {
      id: profile.user_id,
      email: profile.email,
      username: profile.username,
      firstName: profile.first_name,
      lastName: profile.last_name,
      organizationId: profile.org_id,
      organization_name: profile.organization_name,
      department_id: profile.department_id,
      department_name: profile.department_name,
      role_id: profile.role_id,
      role_name: profile.role_name,
      roles: profile.roles || [], // Array of all roles from user_roles table
      status: profile.status,
      is_active: profile.is_active,
      last_login: profile.last_login,
      created_at: profile.created_at
    };
    
    // Update localStorage with full profile
    localStorage.setItem('user', JSON.stringify(this.user));
    
    return { user: this.user, profile };
  }

  async requestPasswordReset(email) {
    return this.post('/api/v1/auth/request-password-reset', { email, notify_admin: true });
  }

  async resetPassword(token, password) {
    return this.post('/api/v1/auth/reset-password', { token, password });
  }

  async activateAccount(activationCode, password) {
    return this.post('/api/v1/auth/activate', { activation_code: activationCode, password });
  }

  // ============================================================
  // Admin Users
  // ============================================================
  async getUsers(page = 1, pageSize = 20, filters = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize, ...filters });
    return this.get(`/api/v1/admin/users?${params}`);
  }

  async getUser(userId) {
    return this.get(`/api/v1/admin/users/${userId}`);
  }

  async createUser(userData) {
    return this.post('/api/v1/admin/users', userData);
  }

  async updateUser(userId, userData) {
    return this.put(`/api/v1/admin/users/${userId}`, userData);
  }

  async deleteUser(userId) {
    return this.delete(`/api/v1/admin/users/${userId}`);
  }

  async activateUser(userId) {
    return this.post(`/api/v1/admin/users/${userId}/activate`);
  }

  async deactivateUser(userId) {
    return this.post(`/api/v1/admin/users/${userId}/deactivate`);
  }

  async resetUserPassword(userId) {
    return this.post(`/api/v1/admin/users/${userId}/reset-password`);
  }

  async regenerateActivationKey(userId) {
    return this.post(`/api/v1/admin/users/${userId}/regenerate-activation-key`);
  }

  async setTemporaryPassword(userId, password) {
    return this.post(`/api/v1/admin/users/${userId}/temporary-password`, {
      password_hash: password,
      admin_user_id: this.user?.id || this.user?.user_id
    });
  }

  async checkEmail(email) {
    return this.get(`/api/v1/admin/users/check-email?email=${encodeURIComponent(email)}`);
  }

  async checkUsername(username) {
    return this.get(`/api/v1/admin/users/check-username?username=${encodeURIComponent(username)}`);
  }

  async getUserSessions(userId) {
    return this.get(`/api/v1/admin/users/${userId}/sessions`);
  }

  async revokeUserSessions(userId) {
    return this.delete(`/api/v1/admin/users/${userId}/sessions`);
  }

  // ============================================================
  // User Roles
  // ============================================================
  async getUserRoles(userId) {
    return this.get(`/api/v1/admin/users/${userId}/roles`);
  }

  async assignUserRole(userId, roleId) {
    return this.post(`/api/v1/admin/users/${userId}/roles`, { role_id: roleId });
  }

  async removeUserRole(userId, roleId) {
    return this.delete(`/api/v1/admin/users/${userId}/roles/${roleId}`);
  }

  // ============================================================
  // RBAC Roles
  // ============================================================
  async getRoles() {
    return this.get('/api/v1/rbac/roles');
  }

  async getRole(roleId) {
    return this.get(`/api/v1/rbac/roles/${roleId}`);
  }

  async createRole(roleData) {
    return this.post('/api/v1/rbac/roles', roleData);
  }

  async updateRole(roleId, roleData) {
    return this.put(`/api/v1/rbac/roles/${roleId}`, roleData);
  }

  async deleteRole(roleId) {
    return this.delete(`/api/v1/rbac/roles/${roleId}`);
  }

  async getRolePermissions(roleId) {
    return this.get(`/api/v1/rbac/roles/${roleId}/permissions`);
  }

  async getInheritedPermissions(roleId) {
    return this.get(`/api/v1/rbac/roles/${roleId}/permissions/inherited`);
  }

  async getPermissions() {
    return this.get('/api/v1/permissions/all');
  }

  // ============================================================
  // Matters
  // ============================================================
  async getMatters(page = 1, pageSize = 20, filters = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize, ...filters });
    return this.get(`/api/v1/matters?${params}`);
  }

  async getPinnedMatters(page = 1, pageSize = 100, filters = {}) {
    const params = new URLSearchParams({ page, page_size: pageSize, ...filters });
    return this.get(`/api/v1/matters/pinned?${params}`);
  }

  async searchMatters(query, page = 1, pageSize = 20) {
    const params = new URLSearchParams({ q: query, page, page_size: pageSize });
    return this.get(`/api/v1/matters?${params}`);
  }

  async getMatter(matterId, options = {}) {
    // Build query parameters
    const params = new URLSearchParams();
    if (options.bustCache) {
      params.append('_t', Date.now().toString());
    }
    // Always request full details (includes tasks, notes, contacts from shadow tables)
    params.append('full_details', 'true');

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const result = await this.get(`/api/v1/matters/${matterId}${queryString}`);

    // Track matter view
    if (result.success && window.FeatureTracker) {
      try {
        await window.FeatureTracker.trackFeature(window.Features.MATTER_VIEWED, {
          matter_id: matterId
        });
      } catch (trackError) {
        console.error('[FeatureTracker] Failed to track matter view:', trackError);
      }
    }

    return result;
  }

  async createMatter(matterData) {
    const result = await this.post('/api/v1/matters', matterData);

    // Track matter creation
    if (result.success && window.FeatureTracker) {
      try {
        await window.FeatureTracker.trackFeature(window.Features.MATTER_CREATED, {
          matter_type: matterData.matter_type || 'general'
        });
      } catch (trackError) {
        console.error('[FeatureTracker] Failed to track matter creation:', trackError);
      }
    }

    return result;
  }

  async updateMatter(matterId, matterData) {
    return this.put(`/api/v1/matters/${matterId}`, matterData);
  }

  async deleteMatter(matterId) {
    return this.delete(`/api/v1/matters/${matterId}`);
  }

  async bulkDeleteMatters(matterIds) {
    return this.post('/api/v1/matters/bulk-delete', { matter_ids: matterIds });
  }

  async pinMatter(matterId, source = 'lana') {
    return this.post(`/api/v1/matters/${matterId}/pin`, { source });
  }

  async unpinMatter(matterId, source = 'lana') {
    return this.delete(`/api/v1/matters/${matterId}/pin?source=${source}`);
  }

  async getMatterPermissions(matterId) {
    return this.get(`/api/v1/matters/${matterId}/permissions`);
  }

  async shareMatterWithUser(matterId, userId, permissions = ['read']) {
    return this.post(`/api/v1/matters/${matterId}/share/users`, { user_id: userId, permissions });
  }

  async removeMatterShare(matterId, userId) {
    return this.delete(`/api/v1/matters/${matterId}/share/users/${userId}`);
  }

  async getMatterActivity(matterId, limit = 10, offset = 0) {
    return this.get(`/api/v1/activity/matter/${matterId}?limit=${limit}&offset=${offset}`);
  }

  async getMatterConversations(matterId, limit = 5, offset = 0) {
    // Add cache-busting timestamp to ensure fresh data after conversation creation
    const timestamp = Date.now();
    return this.get(`/api/v1/chat/sessions?matter_id=${matterId}&limit=${limit}&offset=${offset}&_t=${timestamp}`);
  }

  // ============================================================
  // Document Upload
  // ============================================================
  
  /**
   * Upload a document to a matter
   * @param {File} file - The file to upload
   * @param {string} matterId - The matter ID (e.g., MATT-00001)
   * @param {Object} options - Optional settings
   * @returns {Promise<Object>} Upload result
   */
  async uploadDocument(file, matterId, options = {}) {
    await this._readyPromise;

    if (this.demoMode) {
      return {
        success: true,
        document_id: 'doc-' + Date.now(),
        job_id: 'job-' + Date.now(),
        filename: file.name,
        file_size: file.size,
        matter_id: matterId
      };
    }

    const formData = new FormData();
    formData.append('files', file);  // Changed from 'file' to 'files'
    formData.append('matter_id', matterId);

    if (options.document_type) {
      formData.append('document_type', options.document_type);
    }
    if (options.tags) {
      formData.append('tags', options.tags);
    }
    if (options.notes) {
      formData.append('notes', options.notes);
    }

    // NEW ENDPOINT
    const response = await fetch(`${this.baseUrl}/api/v1/storage/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || error.error || 'Upload failed');
    }

    const data = await response.json();

    // Return first result for single file upload
    const result = data.results[0];
    return {
      success: true,
      job_id: result.job_id,
      file_id: result.file_id,
      document_id: result.file_id,
      matter_id: result.matter_id,
      filename: result.filename,
      status: 'queued'
    };
  }

  /**
   * Upload multiple documents to a matter
   * @param {FileList|File[]} files - The files to upload
   * @param {string} matterId - The matter ID
   * @param {Function} onProgress - Progress callback (completed, total)
   * @returns {Promise<Object>} Upload result with stats and results array
   */
  async uploadDocuments(files, matterId, onProgress = null) {
    await this._readyPromise;

    const fileArray = Array.from(files);

    if (this.demoMode) {
      // Simulate batch upload in demo mode
      return {
        status: 'completed',
        batch_id: 'batch-' + Date.now(),
        stats: {
          scanned: fileArray.length,
          uploaded: fileArray.length,
          failed: 0
        },
        results: fileArray.map(file => ({
          job_id: 'job-' + Date.now() + '-' + Math.random(),
          file_id: 'doc-' + Date.now() + '-' + Math.random(),
          matter_id: matterId,
          filename: file.name,
          status: 'queued'
        }))
      };
    }

    // Use batch upload endpoint (supports up to 50 files)
    const formData = new FormData();
    fileArray.forEach(file => {
      formData.append('files', file);
    });
    formData.append('matter_id', matterId);

    const response = await fetch(`${this.baseUrl}/api/v1/storage/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Batch upload failed' }));
      throw new Error(error.detail || error.error || 'Failed to upload documents');
    }

    const result = await response.json();

    // Notify progress callback if provided
    if (onProgress && result.stats) {
      onProgress(result.stats.uploaded, result.stats.scanned);
    }

    return result;
  }

  /**
   * Get documents for a matter
   * @param {string} matterId - The matter ID
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Documents list
   */
  async getMatterDocuments(matterId, page = 1, limit = 50) {
    return this.get(`/api/v1/documents?client_matter=${matterId}&page=${page}&limit=${limit}`);
  }

  /**
   * Get documents for a matter with full details (v2 storage API)
   * @param {string} matterId - The matter ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Documents list with pagination
   */
  async getMatterFiles(matterId, options = {}) {
    const { page = 1, pageSize = 50, status, search, sortBy = 'created_at', sortOrder = 'desc' } = options;
    const params = new URLSearchParams({
      matter_id: matterId,
      page,
      page_size: pageSize,
      sort_by: sortBy,
      sort_order: sortOrder
    });
    if (status) params.append('status', status);
    if (search) params.append('search', search);
    return this.get(`/api/v1/storage/files?${params}`);
  }

  /**
   * Get orphaned files for a matter (files in MinIO but not in documents table)
   * @param {string} matterId - The matter ID
   * @returns {Promise<Object>} Orphaned files list
   */
  async getOrphanedFiles(matterId) {
    return this.get(`/api/v1/files/orphaned/${matterId}`);
  }

  /**
   * Get tasks for a matter
   * @param {string} matterId - The matter ID
   * @returns {Promise<Object>} Tasks list
   */
  async getMatterTasks(matterId) {
    return this.get(`/api/v1/matters/${matterId}/tasks`);
  }

  /**
   * Get connector data for a matter (Connected Data tab)
   * @param {string} matterId - The matter ID
   * @param {Object} options - Filter options
   * @param {string[]} options.entity_types - Filter by entity types
   * @param {number} options.min_confidence - Minimum match confidence (0-100)
   * @returns {Promise<Object>} Connector data grouped by entity type
   */
  async getMatterConnectorData(matterId, options = {}) {
    const params = new URLSearchParams();
    if (options.entity_types) {
      params.append('entity_types', Array.isArray(options.entity_types) ? options.entity_types.join(',') : options.entity_types);
    }
    if (options.min_confidence !== undefined) {
      params.append('min_confidence', options.min_confidence);
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.get(`/api/v1/matters/${matterId}/connector-data${query}`);
  }

  /**
   * Get pending connector matches requiring user review
   * @param {string} matterId - The matter ID
   * @param {Object} options - Query options (page, limit, status, entity_type, sort, order, search)
   * @returns {Promise<Object>} Pending matches with pagination
   */
  async getMatterPendingMatches(matterId, options = {}) {
    const params = new URLSearchParams();
    if (options.page) params.append('page', options.page);
    if (options.limit) params.append('limit', options.limit);
    if (options.status) params.append('status', options.status);
    if (options.entity_type) params.append('entity_type', options.entity_type);
    if (options.sort) params.append('sort', options.sort);
    if (options.order) params.append('order', options.order);
    if (options.search) params.append('search', options.search);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.get(`/api/v1/matters/${matterId}/pending-matches${query}`);
  }

  /**
   * Approve a pending connector match
   * @param {string} matterId - The matter ID
   * @param {string} matchId - The pending match ID
   * @returns {Promise<Object>} Approval result
   */
  async approvePendingMatch(matterId, matchId) {
    return this.post(`/api/v1/matters/${matterId}/pending-matches/${matchId}/approve`, {});
  }

  /**
   * Decline a pending connector match
   * @param {string} matterId - The matter ID
   * @param {string} matchId - The pending match ID
   * @param {string} reason - Optional reason for declining
   * @returns {Promise<Object>} Decline result
   */
  async declinePendingMatch(matterId, matchId, reason = null) {
    return this.post(`/api/v1/matters/${matterId}/pending-matches/${matchId}/decline`, { reason });
  }

  /**
   * Search available connector data for manual linking
   * @param {string} matterId - The matter ID
   * @param {Object} options - Search options (search, entity_type, connector_id, page, limit)
   * @returns {Promise<Object>} Search results with pagination
   */
  async searchConnectorDataForLinking(matterId, options = {}) {
    const params = new URLSearchParams();
    if (options.search) params.append('search', options.search);
    if (options.entity_type) params.append('entity_type', options.entity_type);
    if (options.connector_id) params.append('connector_id', options.connector_id);
    if (options.page) params.append('page', options.page);
    if (options.limit) params.append('limit', options.limit);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.get(`/api/v1/matters/${matterId}/search-connector-data${query}`);
  }

  /**
   * Manually link connector data to a matter
   * @param {string} matterId - The matter ID
   * @param {string} connectorDataId - The connector data ID to link
   * @returns {Promise<Object>} Link result
   */
  async linkConnectorDataToMatter(matterId, connectorDataId) {
    return this.post(`/api/v1/matters/${matterId}/link-connector-data`, {
      connector_data_id: connectorDataId
    });
  }

  /**
   * Create a LANA-native task for a matter
   * @param {string} matterId - The matter ID
   * @param {Object} taskData - Task data (title, description, notes, priority, due_date, assigned_to_user_id)
   * @returns {Promise<Object>} Created task
   */
  async createTask(matterId, taskData) {
    return this.post(`/api/v1/matters/${matterId}/tasks`, taskData);
  }

  /**
   * Update a LANA-native task
   * @param {string} taskId - The task ID
   * @param {Object} updates - Task updates (title, description, notes, status, priority, due_date, assigned_to_user_id)
   * @returns {Promise<Object>} Updated task
   */
  async updateTask(taskId, updates) {
    return this.patch(`/api/v1/matters/tasks/${taskId}`, updates);
  }

  /**
   * Quick complete a LANA-native task
   * @param {string} taskId - The task ID
   * @returns {Promise<Object>} Completed task
   */
  async completeTask(taskId) {
    return this.patch(`/api/v1/matters/tasks/${taskId}/complete`, {});
  }

  /**
   * Delete a LANA-native task (soft delete)
   * @param {string} taskId - The task ID
   * @returns {Promise<Object>} Deletion response
   */
  async deleteTask(taskId) {
    return this.delete(`/api/v1/matters/tasks/${taskId}`);
  }

  // ============================================================================
  // Matter Contacts API (Shadow Table)
  // ============================================================================

  /**
   * Create a contact for a matter
   * @param {string} matterId - The matter ID
   * @param {Object} contactData - Contact data (first_name, last_name, display_name, email, phone_mobile, phone_work, contact_type)
   * @returns {Promise<Object>} Created contact
   */
  async createContact(matterId, contactData) {
    return this.post(`/api/v1/matters/${matterId}/contacts`, contactData);
  }

  /**
   * Search contacts across the organization
   * @param {string} query - Search query (min 2 chars)
   * @param {string} excludeMatterId - Optional matter ID to exclude already-linked contacts
   * @param {number} limit - Max results (default 20)
   * @returns {Promise<Object>} { contacts: [...], total: N }
   */
  async searchContacts(query, excludeMatterId = null, limit = 20) {
    let url = `/api/v1/contacts/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    if (excludeMatterId) {
      url += `&exclude_matter_id=${encodeURIComponent(excludeMatterId)}`;
    }
    return this.get(url);
  }

  /**
   * Link an existing contact to a matter
   * @param {string} matterId - The matter ID
   * @param {string} contactId - The contact UUID to link
   * @param {string} role - Role in this matter (e.g., 'client', 'participant')
   * @returns {Promise<Object>} Link record
   */
  async linkContactToMatter(matterId, contactId, role = 'participant') {
    return this.post(`/api/v1/matters/${matterId}/contacts/link`, {
      contact_id: contactId,
      role
    });
  }

  /**
   * Unlink a contact from a matter (removes association, not the contact)
   * @param {string} matterId - The matter ID
   * @param {string} contactId - The contact UUID to unlink
   * @returns {Promise<Object>} Success response
   */
  async unlinkContactFromMatter(matterId, contactId) {
    return this.delete(`/api/v1/matters/${matterId}/contacts/${contactId}/unlink`);
  }

  /**
   * Get available contact roles
   * @returns {Promise<Object>} { roles: [...] }
   */
  async getContactRoles() {
    return this.get('/api/v1/contacts/roles');
  }

  // ============================================================================
  // Matter Comments API (Collaboration Feed)
  // ============================================================================

  /**
   * Get comments for a matter
   * @param {string} matterId - The matter ID
   * @param {Object} options - Query options (limit, offset, sort, filter)
   * @returns {Promise<Object>} Comments response
   */
  async getComments(matterId, options = {}) {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.append('limit', options.limit);
    if (options.offset !== undefined) params.append('offset', options.offset);
    if (options.sort) params.append('sort', options.sort);
    if (options.filter) params.append('filter', options.filter);

    const queryString = params.toString();
    const endpoint = `/api/v1/matters/${matterId}/comments${queryString ? '?' + queryString : ''}`;

    return this.get(endpoint);
  }

  /**
   * Get users who can be mentioned in a matter
   * @param {string} matterId - The matter ID
   * @returns {Promise<Object>} Mentionable users response
   */
  async getMentionableUsers(matterId) {
    return this.get(`/api/v1/matters/${matterId}/mentionable-users`);
  }

  /**
   * Create a comment on a matter
   * @param {string} matterId - The matter ID
   * @param {Object} data - Comment data (content, mentions, referenced_document_ids)
   * @returns {Promise<Object>} Created comment
   */
  async createComment(matterId, data) {
    return this.post(`/api/v1/matters/${matterId}/comments`, data);
  }

  /**
   * Reply to a comment
   * @param {string} commentId - The parent comment ID
   * @param {Object} data - Reply data (content, mentions)
   * @returns {Promise<Object>} Created reply
   */
  async replyToComment(commentId, data) {
    return this.post(`/api/v1/comments/${commentId}/reply`, data);
  }

  /**
   * Update a comment
   * @param {string} commentId - The comment ID
   * @param {Object} data - Updated data (content)
   * @returns {Promise<Object>} Updated comment
   */
  async updateComment(commentId, data) {
    return this.put(`/api/v1/comments/${commentId}`, data);
  }

  /**
   * Delete a comment (soft delete)
   * @param {string} commentId - The comment ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteComment(commentId) {
    return this.delete(`/api/v1/comments/${commentId}`);
  }

  /**
   * Pin a comment to the top of the matter feed
   * @param {string} commentId - The comment ID
   * @returns {Promise<Object>} Pin result
   */
  async pinComment(commentId) {
    return this.post(`/api/v1/matters/comments/${commentId}/pin`);
  }

  /**
   * Unpin a comment
   * @param {string} commentId - The comment ID
   * @returns {Promise<Object>} Unpin result
   */
  async unpinComment(commentId) {
    return this.delete(`/api/v1/matters/comments/${commentId}/pin`);
  }

  /**
   * Get notifications for the current user
   * @param {Object} options - Query options (read, limit, sort)
   * @returns {Promise<Object>} Notifications response
   */
  async getNotifications(options = {}) {
    const params = new URLSearchParams();
    if (options.read !== undefined) params.append('read', options.read);
    if (options.limit) params.append('limit', options.limit);
    if (options.sort) params.append('sort', options.sort);

    const queryString = params.toString();
    const endpoint = `/api/v1/notifications${queryString ? '?' + queryString : ''}`;

    return this.get(endpoint);
  }

  /**
   * Get unread notification count
   * @returns {Promise<Object>} Notification count
   */
  async getNotificationCount() {
    return this.get('/api/v1/notifications/count');
  }

  /**
   * Mark a notification as read
   * @param {string} notificationId - The notification ID
   * @returns {Promise<Object>} Update result
   */
  async markNotificationRead(notificationId) {
    return this.put(`/api/v1/notifications/${notificationId}/read`);
  }

  /**
   * Mark all notifications as read
   * @returns {Promise<Object>} Update result
   */
  async markAllNotificationsRead() {
    return this.put('/api/v1/notifications/read-all');
  }

  /**
   * Assign an orphaned file to a matter (create documents table entry)
   * @param {Object} fileData - File assignment data
   * @returns {Promise<Object>} Assignment result
   */
  async assignOrphanedFile(fileData) {
    return this.post('/api/v1/files/orphaned/assign', fileData);
  }

  /**
   * Get file metadata
   * @param {string} fileId - The file ID
   * @param {string} matterId - The matter ID
   * @returns {Promise<Object>} File metadata
   */
  async getFileMetadata(fileId, matterId) {
    return this.get(`/api/v1/storage/files/${fileId}?matter_id=${matterId}`);
  }

  /**
   * Delete a document (Universal endpoint - works for all sources)
   * @param {string} documentId - The document ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteDocument(documentId) {
    return this.delete(`/api/v1/storage/${documentId}`);
  }

  /**
   * Replace/update a document file (Universal endpoint - works for all sources)
   * Triggers re-vectorization automatically
   * @param {string} documentId - The document ID to replace
   * @param {File} file - The new file to upload
   * @param {Function} onProgress - Optional progress callback
   * @returns {Promise<Object>} Update result
   */
  async replaceDocument(documentId, file, onProgress = null) {
    const formData = new FormData();
    formData.append('file', file);

    return this.put(`/api/v1/storage/${documentId}`, formData, {
      onUploadProgress: onProgress ? (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percentCompleted);
      } : undefined
    });
  }

  /**
   * Get download URL for a file
   * @param {string} fileId - The file ID
   * @param {string} matterId - The matter ID
   * @returns {string} Download URL
   */
  getFileDownloadUrl(fileId, matterId) {
    return `${this.baseUrl}/api/v1/storage/files/${fileId}/download?matter_id=${matterId}`;
  }

  /**
   * Get view URL for a file (inline display in browser)
   * @param {string} fileId - The file ID
   * @param {string} matterId - The matter ID
   * @returns {string} View URL
   */
  getFileViewUrl(fileId, matterId) {
    return `${this.baseUrl}/api/v1/storage/files/${fileId}/view?matter_id=${matterId}`;
  }

  // ============================================================
  // Chat Session Files
  // ============================================================

  /**
   * Upload file(s) to a chat session
   * Files are automatically linked to both the matter and the chat session.
   * @param {string} sessionId - The chat session/thread ID
   * @param {File|File[]} files - File or array of files to upload
   * @param {Object} options - Upload options
   * @param {string} options.matterId - Matter ID (optional if session has matter)
   * @param {string} options.processingStrategy - Processing strategy (fast|quality|ocr)
   * @param {string} options.priority - Priority (high|normal|low)
   * @param {Function} options.onProgress - Progress callback
   * @returns {Promise<Object>} Upload result with file IDs
   */
  async uploadFilesToChat(sessionId, files, options = {}) {
    const fileArray = Array.isArray(files) ? files : [files];
    const formData = new FormData();

    fileArray.forEach(file => {
      formData.append('files', file);
    });

    if (options.matterId) {
      formData.append('matter_id', options.matterId);
    }
    if (options.processingStrategy) {
      formData.append('processing_strategy', options.processingStrategy);
    }
    if (options.priority) {
      formData.append('priority', options.priority);
    }
    if (options.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    const response = await fetch(`${this.baseUrl}/api/v1/chat/sessions/${sessionId}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(error.message || 'Upload failed');
    }

    return response.json();
  }

  /**
   * Get files associated with a chat session
   * @param {string} sessionId - The chat session/thread ID
   * @param {Object} options - Query options
   * @param {number} options.limit - Max files to return
   * @param {number} options.offset - Pagination offset
   * @param {string} options.status - Filter by status
   * @returns {Promise<Object>} Files list with pagination
   */
  async getChatSessionFiles(sessionId, options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', options.limit);
    if (options.offset) params.set('offset', options.offset);
    if (options.status) params.set('status', options.status);

    const queryString = params.toString();
    const url = `/api/v1/chat/sessions/${sessionId}/files${queryString ? `?${queryString}` : ''}`;
    return this.get(url);
  }

  /**
   * Attach an existing file to a chat session
   * Links a file that's already in the matter to a specific chat conversation.
   * @param {string} sessionId - The chat session/thread ID
   * @param {string} fileId - The file ID to attach
   * @returns {Promise<Object>} Attachment result
   */
  async attachFileToChat(sessionId, fileId) {
    return this.post(`/api/v1/chat/sessions/${sessionId}/files/${fileId}/attach`);
  }

  /**
   * Detach a file from a chat session
   * Removes the chat session association but keeps the file in the matter.
   * @param {string} sessionId - The chat session/thread ID
   * @param {string} fileId - The file ID to detach
   * @returns {Promise<Object>} Detachment result
   */
  async detachFileFromChat(sessionId, fileId) {
    return this.delete(`/api/v1/chat/sessions/${sessionId}/files/${fileId}`);
  }

  // ============================================================
  // Audit
  // ============================================================
  async getAuditLogs(page = 1, pageSize = 50, filters = {}) {
    const offset = (page - 1) * pageSize;
    const params = new URLSearchParams({ limit: pageSize, offset: offset, ...filters });
    return this.get(`/api/v1/audit/logs?${params}`);
  }

  async queryAuditLogs(query) {
    return this.post('/api/v1/audit/query', query);
  }

  async getAuditEventTypes() {
    return this.get('/api/v1/audit/event-types');
  }

  async getAuditStatistics(startDate, endDate) {
    const params = new URLSearchParams();
    if (startDate) params.set('date_range_start', startDate);
    if (endDate) params.set('date_range_end', endDate);
    return this.get(`/api/v1/audit/statistics?${params}`);
  }

  async exportAuditLogs(format = 'csv', filters = {}) {
    return this.post('/api/v1/audit/export', { format, ...filters });
  }

  // ============================================================
  // Health & System
  // ============================================================
  async getHealthSummary() {
    return this.get('/api/v1/admin/health/summary');
  }

  async getHealthServices() {
    return this.get('/api/v1/admin/health/services');
  }

  async getHealthMetrics() {
    return this.get('/api/v1/admin/health/metrics');
  }

  // ============================================================
  // Plugins
  // ============================================================
  async getPlugins() {
    return this.get('/api/v1/plugins');
  }

  async getInstalledPlugins() {
    return this.get('/api/v1/plugins/installed');
  }

  async getMarketplacePlugins(search = '', category = '', limit = 50) {
    const params = new URLSearchParams({ limit });
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    return this.get(`/api/v1/plugins/marketplace?${params}`);
  }

  async installPlugin(name, version, config = {}) {
    return this.post('/api/v1/plugins/install', { name, version, config });
  }

  async getPlugin(pluginId) {
    return this.get(`/api/v1/plugins/${pluginId}`);
  }

  async updatePlugin(pluginId, data) {
    return this.put(`/api/v1/plugins/${pluginId}`, data);
  }

  async startPlugin(pluginId) {
    return this.post(`/api/v1/plugins/${pluginId}/start`);
  }

  async stopPlugin(pluginId) {
    return this.post(`/api/v1/plugins/${pluginId}/stop`);
  }

  async restartPlugin(pluginId) {
    return this.post(`/api/v1/plugins/${pluginId}/restart`);
  }

  async uninstallPlugin(pluginId) {
    return this.delete(`/api/v1/plugins/${pluginId}`);
  }

  // ============================================================
  // User Profile & Preferences
  // ============================================================
  async getProfile() {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.get('/api/v1/users/me/profile');
  }

  async updateProfile(data) {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.request('PATCH', '/api/v1/users/me/profile', data);
  }

  async getPreferences() {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.get('/api/v1/users/me/preferences');
  }

  async updatePreference(key, value) {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.put(`/api/v1/users/me/preferences/${key}`, { value });
  }

  // ============================================================
  // MFA
  // ============================================================
  isMfaEnabled() {
    return this.config.MFA_ENABLED !== false;
  }

  async getMfaStatus() {
    if (!this.user?.id) throw new Error('Not logged in');
    // Return disabled status if MFA is disabled in config
    if (!this.isMfaEnabled()) {
      return { enabled: false, methods: [], mfa_disabled_by_config: true };
    }
    return this.get('/api/v1/users/me/security/mfa/status');
  }

  async setupMfa() {
    if (!this.user?.id) throw new Error('Not logged in');
    if (!this.isMfaEnabled()) {
      throw new Error('MFA is disabled for this deployment');
    }
    return this.post('/api/v1/users/me/security/mfa/setup');
  }

  async verifyMfa(token) {
    if (!this.user?.id) throw new Error('Not logged in');
    if (!this.isMfaEnabled()) {
      throw new Error('MFA is disabled for this deployment');
    }
    return this.post('/api/v1/users/me/security/mfa/verify', { token });
  }

  async disableMfa() {
    if (!this.user?.id) throw new Error('Not logged in');
    if (!this.isMfaEnabled()) {
      throw new Error('MFA is disabled for this deployment');
    }
    return this.delete('/api/v1/users/me/security/mfa');
  }

  async regenerateMfaBackupCodes() {
    if (!this.user?.id) throw new Error('Not logged in');
    if (!this.isMfaEnabled()) {
      throw new Error('MFA is disabled for this deployment');
    }
    return this.post('/api/v1/users/me/security/mfa/backup-codes/regenerate');
  }

  // ============================================================
  // Organizations
  // ============================================================
  async getOrganizations(page = 1, pageSize = 20) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    return this.get(`/api/v1/admin/organizations?${params}`);
  }

  async getOrganization(orgId) {
    return this.get(`/api/v1/organizations/${orgId}`);
  }

  async getOrganizationStats(orgId) {
    return this.get(`/api/v1/organizations/${orgId}/stats`);
  }

  // ============================================================
  // Activity
  // ============================================================
  async getMyActivity(limit = 50, offset = 0) {
    return this.get(`/api/v1/activity/my?limit=${limit}&offset=${offset}`);
  }

  async getMyProductivity() {
    return this.get(`/api/v1/activity/my/productivity`);
  }

  async getUserProductivity(userId) {
    return this.get(`/api/v1/activity/user/${userId}/productivity`);
  }

  async getOrganizationUsers() {
    return this.get(`/api/v1/activity/organization/users`);
  }

  async getOrganizationActivity(limit = 50, offset = 0) {
    return this.get(`/api/v1/activity/feed?limit=${limit}&offset=${offset}`);
  }

  // Alias for backwards compatibility - now uses user's own activity
  async getActivityFeed(limit = 50, offset = 0) {
    return this.getMyActivity(limit, offset);
  }

  // ============================================================
  // Groups
  // ============================================================
  async getGroups() {
    return this.get('/api/v1/groups');
  }

  async createGroup(groupData) {
    return this.post('/api/v1/groups', groupData);
  }

  async getGroup(groupId) {
    return this.get(`/api/v1/groups/${groupId}`);
  }

  async updateGroup(groupId, groupData) {
    return this.put(`/api/v1/groups/${groupId}`, groupData);
  }

  async deleteGroup(groupId) {
    return this.delete(`/api/v1/groups/${groupId}`);
  }

  // ============================================================
  // Notifications
  // ============================================================
  async getNotifications(unreadOnly = false, limit = 20, offset = 0) {
    const params = new URLSearchParams();
    if (unreadOnly) params.append('unread_only', 'true');
    params.append('limit', limit);
    params.append('offset', offset);
    return this.get(`/api/v1/notifications?${params.toString()}`);
  }

  async markNotificationRead(notificationId) {
    return this.put(`/api/v1/notifications/${notificationId}/read`);
  }

  async markAllNotificationsRead() {
    // Use POST to bulk mark endpoint
    return this.post('/api/v1/notifications/mark-all-read');
  }

  async createAdminNotification(type, title, body, actionUrl = null) {
    return this.post('/api/v1/notifications/admin', {
      type,
      title,
      body,
      action_url: actionUrl
    });
  }

  // ============================================================
  // Sessions (Admin)
  // ============================================================
  async getSessions(page = 1, pageSize = 20) {
    const params = new URLSearchParams({ page, page_size: pageSize });
    return this.get(`/api/v1/admin/sessions?${params}`);
  }

  async terminateSession(sessionId) {
    return this.delete(`/api/v1/admin/sessions/${sessionId}`);
  }

  // ============================================================
  // Document Processing (JIT - Just-In-Time)
  // ============================================================

  /**
   * Trigger on-demand processing for a document
   * @param {string} documentId - Document ID
   * @param {string} triggeredBy - 'view' | 'chat_reference' | 'file_drawer'
   * @returns {Promise<Object>}
   */
  async triggerDocumentProcessing(documentId, triggeredBy) {
    return this.post(`/api/v1/storage/${documentId}/trigger-processing`, {
      triggered_by: triggeredBy
    });
  }

  /**
   * Get document processing status
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>}
   */
  async getDocumentProcessingStatus(documentId) {
    return this.get(`/api/v1/storage/${documentId}/processing-status`);
  }

  /**
   * Poll for document processing completion
   * @param {string} documentId - Document ID
   * @param {number} maxAttempts - Maximum polling attempts (default: 60)
   * @param {number} intervalMs - Polling interval in ms (default: 2000)
   * @returns {Promise<Object>}
   */
  async pollDocumentProcessing(documentId, maxAttempts = 60, intervalMs = 2000) {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const status = await this.getDocumentProcessingStatus(documentId);

      if (status.stage === 'completed') {
        return status;
      }

      if (status.stage === 'failed') {
        throw new Error(`Document processing failed: ${status.status}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      attempts++;
    }

    throw new Error('Document processing timeout');
  }

  // ============================================================
  // Auth Helpers
  // ============================================================
  isAuthenticated() {
    return !!this.token;
  }

  isDemoMode() {
    return this.demoMode;
  }

  requireAuth() {
    if (this.demoMode) {
      // Always "authenticated" in demo mode
      return true;
    }
    if (!this.isAuthenticated()) {
      window.location.href = getLoginPath();
      return false;
    }
    return true;
  }

  /**
   * Mark SSE streaming as active to prevent page navigation.
   * Call this before starting an SSE fetch and setStreamingInactive() when done.
   */
  setStreamingActive() {
    this._streamingActive = true;
  }

  /**
   * Mark SSE streaming as inactive. If a session expiry was deferred
   * while streaming was active, show the modal now.
   */
  setStreamingInactive() {
    this._streamingActive = false;
    if (this._pendingSessionExpired) {
      this._pendingSessionExpired = false;
      this.showSessionExpiredModal();
    }
  }

  // ============================================================
  // Dashboard Widgets
  // ============================================================

  /**
   * Get all dashboard widgets for the current organization.
   * Supports filtering by widget_type and matter_id.
   * @param {Object} params - Query parameters (limit, offset, widget_type, matter_id)
   * @returns {Promise<Object>} Paginated widget list
   */
  async getDashboardWidgets(params = {}) {
    let url = '/api/v1/dashboard-widgets';
    const queryParts = [];
    if (params.limit) queryParts.push('limit=' + params.limit);
    if (params.offset) queryParts.push('offset=' + params.offset);
    if (params.widget_type) queryParts.push('widget_type=' + encodeURIComponent(params.widget_type));
    if (params.matter_id) queryParts.push('matter_id=' + encodeURIComponent(params.matter_id));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    return this.get(url);
  }

  /**
   * Create a new dashboard widget.
   * @param {Object} widgetData - Widget configuration (widget_type, title, config, position, refresh_interval_seconds)
   * @returns {Promise<Object>} Created widget
   */
  async createDashboardWidget(widgetData) {
    return this.post('/api/v1/dashboard-widgets', widgetData);
  }

  /**
   * Update an existing dashboard widget.
   * @param {string} widgetId - The widget UUID
   * @param {Object} widgetData - Updated widget data
   * @returns {Promise<Object>} Updated widget
   */
  async updateDashboardWidget(widgetId, widgetData) {
    return this.put('/api/v1/dashboard-widgets/' + widgetId, widgetData);
  }

  /**
   * Delete a dashboard widget.
   * @param {string} widgetId - The widget UUID to remove
   * @returns {Promise<Object>} Deletion result
   */
  async deleteDashboardWidget(widgetId) {
    return this.delete('/api/v1/dashboard-widgets/' + widgetId);
  }

  /**
   * Fetch live data for a single dashboard widget.
   * @param {string} widgetId - The widget UUID
   * @returns {Promise<Object>} Widget data payload
   */
  async getDashboardWidgetData(widgetId) {
    return this.post('/api/v1/dashboard-widgets/' + widgetId + '/data');
  }

  /**
   * Fetch live data for multiple widgets in a single request.
   * @param {string[]} widgetIds - Array of widget UUIDs
   * @returns {Promise<Object>} Map of widgetId -> data payload
   */
  async getDashboardWidgetsBatchData(widgetIds) {
    return this.post('/api/v1/dashboard-widgets/batch-data', { widget_ids: widgetIds });
  }

  /**
   * Get available widget type definitions.
   * Falls back to built-in defaults if the endpoint is unavailable.
   * @returns {Promise<Object>} Array of widget type descriptors
   */
  async getDashboardWidgetTypes() {
    return this.get('/api/v1/dashboard-widgets/types');
  }
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Global instance
const api = new ApiClient();
