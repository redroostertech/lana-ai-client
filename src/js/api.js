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
        currentPath.includes('/insights/') ||
        currentPath.includes('/automation/') ||
        currentPath.includes('/voice/')) {
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

    // Override baseUrl with the user's saved server from localStorage. This
    // runs unconditionally (not gated on window.electronAPI) because iframes
    // in this app don't get the preload-exposed electronAPI but DO share
    // localStorage with the parent. Without this override an iframe's
    // api.js stays on the config default (e.g. http://localhost:8080) while
    // the parent uses the real backend, and every iframe request 401s with
    // a token signed by a different server.
    try {
      const savedServer = localStorage.getItem('lana_saved_server');
      if (savedServer) {
        const serverInfo = JSON.parse(savedServer);
        if (serverInfo && serverInfo.url) {
          this.baseUrl = serverInfo.url;
          console.log('[LanaAPI] Pre-loaded server URL from localStorage:', this.baseUrl);
        }
      }
    } catch (err) {
      console.error('[LanaAPI] Failed to pre-load server URL from localStorage:', err);
    }

    if (window.electronAPI) {
      // Async confirm/update from Electron storage (source of truth in the parent)
      this._readyPromise = window.electronAPI.getSavedServer().then(result => {
        if (result && result.success && result.server && result.server.url) {
          this.baseUrl = result.server.url;
          console.log('[LanaAPI] Confirmed server URL from Electron:', this.baseUrl);
          // Keep localStorage in sync so iframes (which lack electronAPI) can read it
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
        // baseUrl already set from localStorage check above
        this._ready = true;
        return this.baseUrl;
      });
    } else {
      // No electronAPI: either we're in a plain browser, or we're an iframe in
      // Electron (preload-exposed APIs aren't propagated to subframes by default).
      // For browsers, fall back to current origin when no other URL is set.
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
    // A 401 inside an iframe must not tear down the parent's session.
    // The parent owns auth state; iframes share localStorage but are guests.
    // Without this guard, iframe-side polling 401s would clear the parent's
    // token and redirect the whole window to login.
    if (typeof window !== 'undefined' && window.top && window !== window.top) {
      console.warn('[LanaAPI] 401 inside iframe — not clearing parent session');
      return;
    }

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

    const requestOptions = { ...options };
    const suppressErrorLog = requestOptions.suppressErrorLog === true;
    delete requestOptions.suppressErrorLog;

    const url = `${baseUrl}${endpoint}`;
    const config = {
      method,
      headers: this.getHeaders(),
      ...requestOptions
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
      // Honor a caller-supplied AbortSignal (e.g. a per-request timeout) in
      // addition to the internal request timeout: abort the fetch if either
      // fires. Without this, a caller's signal passed via options would be
      // silently overwritten by config.signal below.
      if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
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

        // Log the error details for debugging unless this is an expected
        // rollout probe handled by the caller.
        if (!suppressErrorLog) {
          console.error('[LanaAPI] Request failed:', {
            endpoint,
            status: response.status,
            errorCode,
            errorMessage: finalErrorMessage,
            fullResponse: result
          });
        }

        // Support both error formats: {error: {message: ...}} and {detail: ...}
        const apiError = new ApiError(finalErrorMessage, response.status, result);
        const retryAfter = response.headers && response.headers.get
          ? response.headers.get('Retry-After')
          : null;
        if (retryAfter) {
          const retryAfterSeconds = Number(retryAfter);
          if (Number.isFinite(retryAfterSeconds)) {
            apiError.retryAfterSeconds = retryAfterSeconds;
          }
        }
        throw apiError;
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
    const mockLoader = window.MockData || {};
    const mock = typeof mockLoader.load === 'function'
      ? await mockLoader.load()
      : mockLoader;
    const queryParams = new URLSearchParams(endpoint.split('?')[1] || '');
    const users = Array.isArray(mock.users) ? mock.users : [];
    const matters = Array.isArray(mock.matters) ? mock.matters : [];
    const documents = Array.isArray(mock.documents) ? mock.documents : [];
    const folders = Array.isArray(mock.folders) ? mock.folders : [];
    const approvals = Array.isArray(mock.approvals) ? mock.approvals : [];
    const actionQueue = Array.isArray(mock.actionQueue) ? mock.actionQueue : [];
    const agenticTasks = Array.isArray(mock.agenticTasks) ? mock.agenticTasks : [];
    const page = Number(queryParams.get('page') || 1);
    const pageSize = Number(queryParams.get('page_size') || queryParams.get('limit') || 100);
    const offset = Number(queryParams.get('offset') || 0);
    const currentUser = this.user || this.config.DEMO_USER || users[0] || {};

    const paginate = (items) => {
      const collection = Array.isArray(items) ? items : [];
      const startIndex = offset || Math.max(0, (page - 1) * pageSize);
      const pagedItems = collection.slice(startIndex, startIndex + pageSize);
      return {
        items: pagedItems,
        pagination: {
          page,
          page_size: pageSize,
          total: collection.length,
          total_pages: Math.max(1, Math.ceil(collection.length / pageSize))
        }
      };
    };

    const findMatter = (matterId) => matters.find(m => m.id === matterId || m.matter_id === matterId || m.matter_number === matterId);
    const findDocument = (documentId) => documents.find(doc => doc.id === documentId);

    // Simulate network delay
    await (mockLoader.delay ? mockLoader.delay(300) : new Promise(r => setTimeout(r, 300)));

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
    if (path === '/api/v1/users' && method === 'GET') {
      return { users, total: users.length };
    }

    if (path === '/api/v1/admin/users' && method === 'GET') {
      return { users, total: users.length };
    }

    if (path.match(/\/api\/v1\/admin\/users\/[^/]+$/) && method === 'GET') {
      const userId = path.split('/').pop();
      const user = users.find(u => u.id === userId) || users[0] || {};
      return { user };
    }

    if (path === '/api/v1/admin/users' && method === 'POST') {
      const newUser = { id: mockLoader.generateId?.('u') || 'u-new', ...data, created_at: new Date().toISOString() };
      return { user: newUser, message: 'User created (demo mode)' };
    }

    if (path.match(/\/api\/v1\/admin\/users\/[^/]+$/) && method === 'PUT') {
      const userId = path.split('/').pop();
      const user = users.find(u => u.id === userId) || users[0] || {};
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
      const user = users.find(u => u.id === userId);
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
      let filteredMatters = matters.slice();
      const search = (queryParams.get('q') || queryParams.get('search') || '').toLowerCase();
      const status = (queryParams.get('status') || '').toLowerCase();
      if (search) {
        filteredMatters = filteredMatters.filter(m =>
          (m.name || '').toLowerCase().includes(search) ||
          (m.description || '').toLowerCase().includes(search) ||
          (m.client_name || '').toLowerCase().includes(search)
        );
      }
      if (status) {
        filteredMatters = filteredMatters.filter(m => (m.status || '').toLowerCase() === status);
      }
      const result = paginate(filteredMatters);
      return { matters: result.items, total: filteredMatters.length, pagination: result.pagination };
    }

    if (path.match(/\/api\/v1\/matters\/[^/]+$/) && method === 'GET') {
      const matterId = path.split('/').pop();
      const matter = findMatter(matterId) || matters[0] || {};
      return { matter };
    }

    if (path === '/api/v1/matters' && method === 'POST') {
      const newMatter = {
        id: mockLoader.generateId?.('m') || 'm-new',
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

    // -------------------- TASK PLANS --------------------
    if (path === '/api/v1/task-plans' && method === 'GET') {
      const plans = mock.taskPlans || [
        {
          id: 'tp-demo-1',
          title: 'Client Intake Checklist',
          description: 'Draft shell for onboarding a new client and creating native tasks at publish time.',
          status: 'draft',
          source_type: 'manual',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          items: [
            { title: 'Confirm client identity and contact details' },
            { title: 'Open matter workspace' },
            { title: 'Prepare engagement letter' }
          ]
        }
      ];
      return { task_plans: plans, total: plans.length };
    }

    if (path.match(/\/api\/v1\/task-plans\/[^/]+$/) && method === 'GET') {
      const planId = path.split('/').pop();
      const plans = mock.taskPlans || [];
      const plan = plans.find(p => p.id === planId) || {
        id: planId,
        title: 'Task Plan',
        description: 'Demo task plan detail.',
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: []
      };
      return { task_plan: plan };
    }

    if (path === '/api/v1/task-plans' && method === 'POST') {
      const newPlan = {
        id: mock.generateId?.('tp') || 'tp-new',
        ...data,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: []
      };
      return { task_plan: newPlan, message: 'Task plan created (demo mode)' };
    }

    if (path.match(/\/api\/v1\/task-plans\/[^/]+$/) && method === 'PATCH') {
      const planId = path.split('/').pop();
      return {
        task_plan: {
          id: planId,
          title: data?.title || 'Updated Task Plan',
          description: data?.description || 'Updated demo task plan.',
          status: data?.status || 'draft',
          source_type: data?.source_type || 'manual',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          items: data?.items || []
        },
        message: 'Task plan updated (demo mode)'
      };
    }

    if (path === '/api/v1/task-plans/generate-draft' && method === 'POST') {
      const newPlan = {
        id: mock.generateId?.('tp') || 'tp-lana-draft',
        title: data?.title || 'Lana Draft Plan',
        description: data?.description || 'Generated demo task plan draft.',
        status: 'draft',
        source_type: 'lana_draft',
        metadata: {
          ...(data?.metadata || {}),
          draft_instructions: data?.draft_instructions || null
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: [
          { title: 'Review draft recommendations', priority: 'medium' },
          { title: 'Confirm matter and assignee details', priority: 'medium' }
        ]
      };
      return { task_plan: newPlan, message: 'Lana draft generated (demo mode)' };
    }

    if (path.match(/\/api\/v1\/task-plans\/[^/]+\/publish$/) && method === 'POST') {
      const planId = path.split('/')[4];
      return {
        task_plan: {
          id: planId,
          title: data?.title || 'Published Task Plan',
          description: 'Published demo task plan.',
          status: 'published',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          items: []
        },
        message: 'Task plan published (demo mode)'
      };
    }

    if (path.match(/\/api\/v1\/task-plans\/[^/]+$/) && method === 'DELETE') {
      const planId = path.split('/').pop();
      return { id: planId, deleted: true, message: 'Task plan deleted (demo mode)' };
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
    if (path === '/api/v1/admin/health/storage') {
      const storage = mock.dashboardStats?.storage || {};
      const usedBytes = Math.round((storage.used_gb || 0) * 1024 * 1024 * 1024);
      const limitBytes = Math.round((storage.limit_gb || 100) * 1024 * 1024 * 1024);
      return {
        storage: {
          used_bytes: usedBytes,
          total_bytes: limitBytes,
          usage_percent: storage.percentage || Math.round((usedBytes / limitBytes) * 100)
        }
      };
    }

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
    if (path === '/api/v1/integrations/connectors' && method === 'GET') {
      return { connectors: mock.connectors || [] };
    }

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
    if (path === '/api/v1/users/me/profile' && method === 'GET') {
      return {
        profile: {
          user_id: currentUser.id,
          email: currentUser.email,
          username: currentUser.username,
          first_name: currentUser.first_name || currentUser.firstName || 'Demo',
          last_name: currentUser.last_name || currentUser.lastName || 'User',
          org_id: currentUser.organization_id || currentUser.organizationId || this.config.DEMO_ORGANIZATION?.id,
          organization_name: currentUser.organization_name || this.config.DEMO_ORGANIZATION?.name,
          roles: currentUser.roles || [],
          status: currentUser.is_active === false ? 'inactive' : 'active',
          is_active: currentUser.is_active !== false,
          last_login: currentUser.last_login || new Date().toISOString(),
          created_at: currentUser.created_at || new Date().toISOString(),
          bio: mock.profile?.bio || 'Demo workspace profile'
        }
      };
    }

    if (path.includes('/profile')) {
      if (method === 'GET') {
        return { ...currentUser, bio: mock.profile?.bio || 'Demo workspace profile' };
      }
      return { success: true, message: 'Profile updated (demo mode)' };
    }

    if (path.includes('/preferences')) {
      if (method === 'GET') {
        return mock.preferences || { theme: 'light', notifications: true, language: 'en' };
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
      if (path === '/api/v1/activity/stats') {
        return {
          total_events: (mock.recentActivity || []).length,
          active_users: users.length,
          documents_viewed: documents.length
        };
      }

      if (path.includes('/productivity')) {
        return {
          user_id: currentUser.id,
          documents_processed: documents.length,
          matters_updated: matters.length,
          ai_queries: mock.dashboardStats?.ai_queries?.today || 0
        };
      }

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
    if (path === '/api/v1/notifications/count' || path === '/api/v1/notifications/unread-count') {
      return { unread_count: (mock.notifications || []).filter(n => !n.read).length };
    }

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
      return { group: { id: mockLoader.generateId?.('g') || 'g-new', ...data }, message: 'Group created (demo mode)' };
    }

    // -------------------- APPROVALS --------------------
    if (path === '/api/v1/approvals/stats' && method === 'GET') {
      const byStatus = approvals.reduce((acc, approval) => {
        const status = approval.status || 'pending';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      return { data: { total: approvals.length, by_status: byStatus } };
    }

    if (path === '/api/v1/approvals/inbox/count' && method === 'GET') {
      const pending = approvals.filter(approval => approval.status === 'pending').length;
      return { count: pending, pending };
    }

    if ((path === '/api/v1/approvals' || path === '/api/v1/approvals/inbox') && method === 'GET') {
      let filteredApprovals = approvals.slice();
      const status = queryParams.get('status');
      const priority = queryParams.get('priority');
      const sourceType = queryParams.get('source_type');
      const search = (queryParams.get('search') || '').toLowerCase();

      if (status) filteredApprovals = filteredApprovals.filter(item => item.status === status);
      if (priority) filteredApprovals = filteredApprovals.filter(item => item.priority === priority);
      if (sourceType) filteredApprovals = filteredApprovals.filter(item => item.source_type === sourceType);
      if (search) filteredApprovals = filteredApprovals.filter(item => (item.title || '').toLowerCase().includes(search));

      const result = paginate(filteredApprovals);
      return { data: result.items, approvals: result.items, pagination: result.pagination };
    }

    if (path.match(/\/api\/v1\/approvals\/[^/]+\/history$/) && method === 'GET') {
      return { data: [] };
    }

    if (path.match(/\/api\/v1\/approvals\/[^/]+$/) && method === 'GET') {
      const approvalId = path.split('/').pop();
      const approval = approvals.find(item => item.id === approvalId) || approvals[0] || {};
      return { data: approval, approval };
    }

    if (path.includes('/api/v1/approvals/') && (path.endsWith('/approve') || path.endsWith('/reject') || path.endsWith('/cancel') || path.endsWith('/reassign'))) {
      return { success: true, message: 'Approval updated (demo mode)' };
    }

    // -------------------- ACTION QUEUE / AGENTIC TASKS --------------------
    if (path === '/api/v1/action-queue' && method === 'GET') {
      const result = paginate(actionQueue);
      return { items: result.items, actions: result.items, pagination: result.pagination };
    }

    if (path === '/api/v1/agentic-tasks' && method === 'GET') {
      const result = paginate(agenticTasks);
      return { data: result.items, pagination: result.pagination };
    }

    if (path.match(/\/api\/v1\/agentic-tasks\/[^/]+$/) && method === 'GET') {
      const taskId = path.split('/').pop();
      const task = agenticTasks.find(item => item.id === taskId) || agenticTasks[0] || {};
      return { data: task, task };
    }

    // -------------------- STORAGE --------------------
    if (path === '/api/v1/storage/root' && method === 'GET') {
      const result = paginate(matters);
      return { success: true, matters: result.items, pagination: result.pagination };
    }

    if (path === '/api/v1/storage/folders' && method === 'GET') {
      const matterId = queryParams.get('matter_id');
      const matter = matterId ? findMatter(matterId) : null;
      const aliases = [matterId, matter?.id, matter?.matter_id, matter?.matter_number].filter(Boolean);
      const items = matterId
        ? folders.filter(folder => aliases.includes(folder.matter_id))
        : folders;
      return { status: 'success', folders: items, data: { folders: items } };
    }

    if (path === '/api/v1/storage/recent' && method === 'GET') {
      const result = paginate(documents.slice().sort((a, b) => new Date(b.last_accessed_at || b.updated_at || 0) - new Date(a.last_accessed_at || a.updated_at || 0)));
      return { files: result.items, pagination: result.pagination };
    }

    if (path === '/api/v1/storage/stats' && method === 'GET') {
      return {
        total_files: documents.length,
        processing_files: documents.filter(doc => doc.status === 'processing').length,
        processed_files: documents.filter(doc => doc.status === 'processed').length
      };
    }

    if (path === '/api/v1/storage/files' && method === 'GET') {
      let files = documents.slice();
      const matterId = queryParams.get('matter_id');
      const folderId = queryParams.get('folder_id');
      const search = (queryParams.get('search') || '').toLowerCase();
      if (matterId) {
        files = files.filter(file => file.matter_id === matterId || file.client_matter === matterId);
      }
      if (folderId) {
        files = files.filter(file => file.folder_id === folderId);
      }
      if (search) {
        files = files.filter(file => (file.filename || '').toLowerCase().includes(search));
      }
      return { files, total: files.length, data: { files } };
    }

    if (path.match(/\/api\/v1\/storage\/files\/[^/]+$/) && method === 'GET') {
      const fileId = path.split('/').pop();
      const file = findDocument(fileId) || documents[0] || {};
      return file;
    }

    // -------------------- DOCUMENTS --------------------
    if (path.includes('/documents') || path.includes('/storage') || path.includes('/files')) {
      if (method === 'GET') {
        return { documents, files: documents, total: documents.length };
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
          sources: documents.slice(0, 3) || [],
          conversation_id: mockLoader.generateId?.('conv') || 'conv-new'
        };
      }

      return { success: true };
    }

    // -------------------- SEARCH --------------------
    if (path.includes('/search')) {
      return {
        results: documents.slice(0, 5) || [],
        total: Math.min(5, documents.length),
        query: data?.query || ''
      };
    }

    // -------------------- BILLABLE HOURS --------------------
    if (path === '/api/v1/billable-hours/current' && method === 'GET') {
      return {
        data: {
          billable_hours: 6.4,
          matters: [
            { matter_id: 'MAT-2026-001', hours: 2.1 },
            { matter_id: 'MAT-2026-002', hours: 1.8 },
            { matter_id: 'MAT-2026-004', hours: 2.5 }
          ]
        }
      };
    }

    if (path === '/api/v1/billable-hours/drafts' && method === 'GET') {
      return {
        data: [
          {
            id: 'bhd-001',
            matter_id: 'm-001',
            matter_number: 'MAT-2026-001',
            duration_minutes: 72,
            description: 'Reviewed revised indemnity language and updated risk notes.'
          },
          {
            id: 'bhd-002',
            matter_id: 'm-002',
            matter_number: 'MAT-2026-002',
            duration_minutes: 48,
            description: 'Prepared diligence summary for client review.'
          }
        ],
        pagination: { total: 2 }
      };
    }

    // -------------------- DASHBOARD WIDGETS --------------------
    if (path === '/api/v1/dashboard-widgets' && method === 'GET') {
      return { data: mock.dashboardWidgets || [] };
    }

    if (path === '/api/v1/dashboard-widgets/types' && method === 'GET') {
      return { data: mock.dashboardWidgetTypes || [] };
    }

    if (path.includes('/api/v1/dashboard-widgets/') && path.endsWith('/data') && method === 'POST') {
      return { data: mock.dashboardStats || {} };
    }

    // -------------------- COMMAND CENTER --------------------
    if (path === '/api/v1/command-center/summary' && method === 'GET') {
      return {
        matter_pulse: {
          total: matters.length,
          active: matters.filter(m => m.status === 'active').length,
          stale: matters.filter(m => m.status === 'on_hold').length
        },
        today_activity: {
          documents: documents.filter(doc => (doc.updated_at || '').startsWith(new Date().toISOString().slice(0, 10))).length,
          conversations: (mock.conversations || []).length
        },
        focus_items: actionQueue.slice(0, 4),
        connector_health: {
          connected: (mock.connectors || []).filter(item => item.status === 'connected').length,
          total: (mock.connectors || []).length
        }
      };
    }

    if (path === '/api/v1/command-center/critical-items' && method === 'GET') {
      return { items: actionQueue.slice(0, 5), total: actionQueue.length };
    }

    if (path === '/api/v1/command-center/will-design-meetings' && method === 'GET') {
      var now = new Date();
      var start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      var end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      return {
        section: {
          id: 'estate-planning-will-design-meetings',
          title: 'Estate Planning - Will Design Meetings',
          subtitle: 'Counts, comparisons, attorney breakdown, and record-level lineage from canonical calendar events.'
        },
        filter_context: {
          period: 'this_month',
          period_start: start,
          period_end: end,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          attorney_keys: [],
          attorney_scope_locked: false
        },
        card_definition: {
          id: 'question:will-design-meetings',
          type: 'metric_family',
          module_key: 'service-delivery-operations'
        },
        card_instances: [
          { id: 'command-center:will-design-meetings', context: 'command_center', definition_id: 'question:will-design-meetings' },
          { id: 'dashboard:estate-planning:will-design-meetings', context: 'estate_planning_dashboard', definition_id: 'question:will-design-meetings' }
        ],
        period: {
          key: 'this_month',
          label: 'This month',
          start: start,
          end: end,
          comparison: { label: 'Last month' }
        },
        summary: [
          {
            id: 'upcoming',
            title: 'Upcoming',
            metric_key: 'legal_firm.estate_planning.upcoming_will_design_meetings',
            value: 0,
            drilldown: { module_key: 'service-delivery-operations', metric_key: 'upcoming_will_design_meetings', period_start: start, period_end: end, filters: {}, available: true }
          },
          {
            id: 'completed',
            title: 'Completed',
            metric_key: 'legal_firm.estate_planning.completed_will_design_meetings',
            value: 0,
            drilldown: { module_key: 'service-delivery-operations', metric_key: 'completed_will_design_meetings', period_start: start, period_end: end, filters: {}, available: true }
          },
          {
            id: 'cancelled',
            title: 'Cancelled',
            metric_key: 'legal_firm.estate_planning.cancelled_will_design_meetings',
            value: 0,
            drilldown: { module_key: 'service-delivery-operations', metric_key: 'cancelled_will_design_meetings', period_start: start, period_end: end, filters: {}, available: true }
          },
          {
            id: 'no_show',
            title: 'No-show',
            metric_key: 'legal_firm.estate_planning.no_show_will_design_meetings',
            value: 0,
            drilldown: { module_key: 'service-delivery-operations', metric_key: 'no_show_will_design_meetings', period_start: start, period_end: end, filters: {}, available: true }
          }
        ],
        comparison: {
          title: 'Completed meetings',
          current_period: { label: 'This month', value: 0, start: start, end: end },
          comparison_period: { label: 'Last month', value: 0 },
          change: { current: 0, prior: 0, delta: 0, percent: null, direction: 'flat' }
        },
        ytd_trend: [],
        attorney_breakdown: [],
        source: {
          system: 'canonical_calendar_events',
          state: 'configuration_required',
          last_successful_sync: null,
          warnings: ['Demo mode does not include canonical Will Design Meeting records.']
        },
        certification: {
          state: 'mapped',
          label: 'Mapped - waiting on event data',
          certified: false
        },
        capabilities: {
          can_view_all_attorneys: true,
          can_change_attorney_filter: true,
          can_drilldown: true
        }
      };
    }

    if (path === '/api/v1/command-center/pipeline-metrics' && method === 'GET') {
      return {
        active_matters: matters.filter(m => m.status === 'active').length,
        total_documents: documents.length,
        team_members: users.length
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
  get(endpoint, options) { return this.request('GET', endpoint, null, options); }
  post(endpoint, data, options) { return this.request('POST', endpoint, data, options); }
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
      organization_timezone: profile.organization_timezone,
      department_id: profile.department_id,
      department_name: profile.department_name,
      role_id: profile.role_id,
      role_name: profile.role_name,
      roles: profile.roles || [], // Array of all roles from user_roles table
      status: profile.status,
      is_active: profile.is_active,
      last_login: profile.last_login,
      created_at: profile.created_at,
      preferences: profile.preferences
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

  /**
   * Change the current (authenticated) user's own password.
   * Used by the forced password-change flow: while `mustChangePassword` is set
   * the server 403s every data endpoint except this one, /auth/logout, and
   * /auth/me. A successful call clears the flag server-side.
   *
   * @param {string} currentPassword - The user's current (temp) password
   * @param {string} newPassword - The new password to set
   * @returns {Promise<Object>} Server response
   */
  async changePasswordSelf(currentPassword, newPassword) {
    return this.patch('/api/v1/users/me/security/password', {
      current_password: currentPassword,
      new_password: newPassword
    });
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
  // Task Plans
  // ============================================================
  async getTaskPlans(filters = {}) {
    const params = new URLSearchParams(filters);
    const query = params.toString();
    return this.get(`/api/v1/task-plans${query ? `?${query}` : ''}`);
  }

  async getTaskPlan(planId) {
    return this.get(`/api/v1/task-plans/${planId}`);
  }

  async createTaskPlan(planData) {
    return this.post('/api/v1/task-plans', planData);
  }

  async generateTaskPlanDraft(planData) {
    return this.post('/api/v1/task-plans/generate-draft', planData);
  }

  async updateTaskPlan(planId, planData) {
    return this.patch(`/api/v1/task-plans/${planId}`, planData);
  }

  async publishTaskPlan(planId, options = {}) {
    return this.post(`/api/v1/task-plans/${planId}/publish`, options);
  }

  async deleteTaskPlan(planId) {
    return this.delete(`/api/v1/task-plans/${planId}`);
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

  // Archive / Unarchive — soft-hide a matter from default lists without
  // deleting it. Backend sets archived_at + status='archived'.
  async archiveMatter(matterId) {
    return this.post(`/api/v1/matters/${matterId}/archive`, {});
  }

  async unarchiveMatter(matterId) {
    return this.post(`/api/v1/matters/${matterId}/unarchive`, {});
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

  async getMatterConversations(matterId, limit = 5, offset = 0, opts = {}) {
    const params = new URLSearchParams({
      matter_id: matterId,
      limit: String(limit),
      offset: String(offset),
      _t: String(Date.now())
    });
    if (opts.excludePinned) params.set('exclude_pinned', 'true');
    return this.get(`/api/v1/chat/sessions?${params.toString()}`);
  }

  // Pinned chat sessions — mirrors /matters/pinned. When matterId is supplied
  // results are scoped to that matter (matches the matter detail tab).
  async getPinnedChatSessions(opts = {}) {
    const params = new URLSearchParams({
      limit: String(opts.limit != null ? opts.limit : 100),
      offset: String(opts.offset != null ? opts.offset : 0),
      _t: String(Date.now())
    });
    if (opts.matterId) params.set('matter_id', opts.matterId);
    if (opts.pageScope) params.set('page_scope', opts.pageScope);
    return this.get(`/api/v1/chat/sessions/pinned?${params.toString()}`);
  }

  // Pinned conversation threads — mirrors /matters/pinned for the
  // /conversation-threads endpoint used by the insights sidebar scope.
  async getPinnedConversationThreads(opts = {}) {
    const params = new URLSearchParams({
      limit: String(opts.limit != null ? opts.limit : 100),
      offset: String(opts.offset != null ? opts.offset : 0)
    });
    if (opts.pageScope) params.set('page_scope', opts.pageScope);
    if (opts.matterId) params.set('matter_id', opts.matterId);
    return this.get(`/api/v1/conversation-threads/pinned?${params.toString()}`);
  }

  // Conversation thread pinning + permanent delete (separate from soft archive
  // which is the existing DELETE /:id route).
  async pinThread(threadId) {
    return this.post(`/api/v1/conversation-threads/${threadId}/pin`, {});
  }

  async unpinThread(threadId) {
    return this.post(`/api/v1/conversation-threads/${threadId}/unpin`, {});
  }

  async hardDeleteThread(threadId) {
    return this.delete(`/api/v1/conversation-threads/${threadId}/permanent`);
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

  async getMyTasks(filters = {}, options = {}) {
    const params = new URLSearchParams(filters);
    const query = params.toString();
    return this.get(`/api/v1/tasks/my${query ? `?${query}` : ''}`, options);
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
   * Unlink connector data from a matter
   * @param {string} matterId - The matter ID
   * @param {string} connectorDataId - The connector data ID to unlink
   * @returns {Promise<Object>} Unlink result
   */
  async unlinkConnectorDataFromMatter(matterId, connectorDataId) {
    return this.delete(`/api/v1/matters/${matterId}/link-connector-data/${connectorDataId}`);
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
    if (options.unread_only !== undefined) params.append('unread_only', options.unread_only);
    if (options.limit) params.append('limit', options.limit);
    if (options.offset) params.append('offset', options.offset);
    if (options.sort) params.append('sort', options.sort);
    if (options.type) params.append('type', options.type);

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
    return this.post(`/api/v1/notifications/${notificationId}/read`);
  }

  async getNotificationTypes() {
    return this.get('/api/v1/notifications/types');
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
  async deleteDocument(documentId, options) {
    const hard = !!(options && options.hard);
    const path = `/api/v1/storage/${documentId}` + (hard ? '?hard=true' : '');
    return this.delete(path);
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
  // Traces
  // ============================================================
  async getTraceById(traceId) {
    return this.get(`/api/v1/traces/${traceId}`);
  }

  async getTraces(options = {}) {
    const params = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, value);
      }
    });
    const query = params.toString();
    return this.get(`/api/v1/traces${query ? '?' + query : ''}`);
  }

  async getConversationTraces(conversationId, limit = 50, offset = 0) {
    const params = new URLSearchParams({ limit, offset });
    return this.get(`/api/v1/conversations/${conversationId}/traces?${params}`);
  }

  async getMessageTrace(messageId) {
    return this.get(`/api/v1/messages/${messageId}/trace`);
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

  async getPersonalization() {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.get('/api/v1/users/me/personalization');
  }

  async updatePersonalization(updates) {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.request('PATCH', '/api/v1/users/me/personalization', updates);
  }

  async getPreferences() {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.get('/api/v1/users/me/preferences');
  }

  async updatePreference(key, value) {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.put(`/api/v1/users/me/preferences/${key}`, { value });
  }

  async updatePreferences(updates) {
    if (!this.user?.id) throw new Error('Not logged in');
    return this.request('PATCH', '/api/v1/users/me/preferences', updates);
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

  async getMyProductivity(period) {
    const query = period ? `?period=${encodeURIComponent(period)}` : '';
    return this.get(`/api/v1/activity/my/productivity${query}`);
  }

  async getMyConversationUsageSummary() {
    const params = new URLSearchParams({
      page: '1',
      limit: '1',
      sort: 'updated_at',
      order: 'desc'
    });
    return this.get(`/api/v1/chat/sessions?${params.toString()}`);
  }

  async getStorageUsage() {
    return this.get('/api/v1/storage/usage');
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
  async getNotifications(unreadOnly = false, limit = 20, offset = 0, type = '') {
    const params = new URLSearchParams();
    if (unreadOnly) params.append('unread_only', 'true');
    if (type) params.append('type', type);
    params.append('limit', limit);
    params.append('offset', offset);
    return this.get(`/api/v1/notifications?${params.toString()}`);
  }

  async markNotificationRead(notificationId) {
    return this.post(`/api/v1/notifications/${notificationId}/read`);
  }

  async getNotificationTypes() {
    return this.get('/api/v1/notifications/types');
  }

  async markAllNotificationsRead() {
    // Use POST to bulk mark endpoint
    return this.post('/api/v1/notifications/mark-all-read');
  }

  async getUnreadNotificationCount() {
    return this.get('/api/v1/notifications/unread-count');
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
   * Poll for document processing completion.
   * Accepts an optional AbortSignal so callers can cancel the loop
   * (e.g., on page navigation).
   *
   * @param {string}      documentId
   * @param {number}      [maxAttempts=60]
   * @param {number}      [intervalMs=2000]
   * @param {AbortSignal} [signal]  — pass to cancel the loop early.
   * @returns {Promise<Object>}
   */
  async pollDocumentProcessing(documentId, maxAttempts = 60, intervalMs = 2000, signal) {
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (signal && signal.aborted) {
        throw new DOMException('Poll aborted', 'AbortError');
      }

      const status = await this.getDocumentProcessingStatus(documentId);

      if (status.stage === 'completed') {
        return status;
      }

      if (status.stage === 'failed') {
        throw new Error(`Document processing failed: ${status.status}`);
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        if (signal) {
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Poll aborted', 'AbortError')); }, { once: true });
        }
      });
      attempts++;
    }

    throw new Error('Document processing timeout');
  }

  // ============================================================
  // MCP External Servers (Phase 3)
  // ============================================================
  //
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
   * Mark SSE streaming as active to prevent page navigation. Mirrors the
   * write to `Lex.state.isStreaming` (when available) so the LexRouter
   * navigation guard sees a consistent value regardless of which side
   * initiates the streaming. The Lex.state setter no-ops on identical
   * writes so the back-mirror it performs into this method is a safe
   * fixed point — no infinite loop. (Codex review: half-duplex mirror.)
   */
  setStreamingActive() {
    this._streamingActive = true;
    if (typeof window !== 'undefined' && window.Lex && window.Lex.state
        && window.Lex.state.isStreaming !== true) {
      window.Lex.state.isStreaming = true;
    }
  }

  /**
   * Mark SSE streaming as inactive. If a session expiry was deferred
   * while streaming was active, show the modal now. Mirrors to
   * `Lex.state.isStreaming` for the same reason as setStreamingActive.
   */
  setStreamingInactive() {
    this._streamingActive = false;
    if (typeof window !== 'undefined' && window.Lex && window.Lex.state
        && window.Lex.state.isStreaming !== false) {
      window.Lex.state.isStreaming = false;
    }
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

  /**
   * Get reusable metric catalog definitions for report/dashboard composition.
   * @param {Object} params - Query parameters (namespace, domain, status, executable, limit, offset)
   * @returns {Promise<Object>} Metric catalog payload
   */
  async getMetricCatalog(params = {}) {
    let url = '/api/v1/modules/metric-catalog';
    const queryParts = [];
    if (params.namespace) queryParts.push('namespace=' + encodeURIComponent(params.namespace));
    if (params.domain) queryParts.push('domain=' + encodeURIComponent(params.domain));
    if (params.status) queryParts.push('status=' + encodeURIComponent(params.status));
    if (params.executable !== undefined) queryParts.push('executable=' + encodeURIComponent(String(params.executable)));
    if (params.primaryAudience) queryParts.push('primaryAudience=' + encodeURIComponent(params.primaryAudience));
    if (params.primary_audience) queryParts.push('primary_audience=' + encodeURIComponent(params.primary_audience));
    if (params.entity) queryParts.push('entity=' + encodeURIComponent(params.entity));
    if (params.criteria) queryParts.push('criteria=' + encodeURIComponent(params.criteria));
    if (params.limit) queryParts.push('limit=' + encodeURIComponent(String(params.limit)));
    if (params.offset) queryParts.push('offset=' + encodeURIComponent(String(params.offset)));
    if (params.q) queryParts.push('q=' + encodeURIComponent(params.q));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    return this.get(url);
  }

  /**
   * Get computed dashboard metric card data for a dashboard view.
   * @param {Object} params - Query parameters (type, limit)
   * @returns {Promise<Object>} Dashboard metric card payload
   */
  async getDashboardMetricCards(params = {}, options = {}) {
    let url = '/api/v1/modules/dashboard-metric-cards';
    const queryParts = [];
    if (params.type) queryParts.push('type=' + encodeURIComponent(params.type));
    if (params.limit) queryParts.push('limit=' + encodeURIComponent(String(params.limit)));
    if (params.periodStart) queryParts.push('periodStart=' + encodeURIComponent(params.periodStart));
    if (params.periodEnd) queryParts.push('periodEnd=' + encodeURIComponent(params.periodEnd));
    if (params.compareBy) queryParts.push('compareBy=' + encodeURIComponent(params.compareBy));
    if (params.compareToPrevious !== undefined) queryParts.push('compareToPrevious=' + encodeURIComponent(String(params.compareToPrevious)));
    if (params.compareMode) queryParts.push('compareMode=' + encodeURIComponent(params.compareMode));
    if (params.periodType) queryParts.push('periodType=' + encodeURIComponent(params.periodType));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    return this.get(url, options);
  }

  async getTopMovingMetrics(params = {}) {
    let url = '/api/v1/modules/top-moving-metrics';
    const queryParts = [];
    if (params.window) queryParts.push('window=' + encodeURIComponent(params.window));
    if (params.limit) queryParts.push('limit=' + encodeURIComponent(String(params.limit)));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    return this.get(url);
  }

  async captureMetricSnapshots(data = {}) {
    return this.post('/api/v1/modules/metric-snapshots/capture', data);
  }

  async getMetricDetail(metricKey, params = {}, options = {}) {
    let url = '/api/v1/modules/metric-detail/' + encodeURIComponent(metricKey);
    const queryParts = [];
    if (params.periodStart) queryParts.push('periodStart=' + encodeURIComponent(params.periodStart));
    if (params.periodEnd) queryParts.push('periodEnd=' + encodeURIComponent(params.periodEnd));
    if (params.periodType) queryParts.push('periodType=' + encodeURIComponent(params.periodType));
    if (params.compareBy) queryParts.push('compareBy=' + encodeURIComponent(params.compareBy));
    if (params.compareToPrevious !== undefined) queryParts.push('compareToPrevious=' + encodeURIComponent(String(params.compareToPrevious)));
    if (params.compareMode) queryParts.push('compareMode=' + encodeURIComponent(params.compareMode));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    // options may carry { signal } so callers (e.g. the Metric Catalog "Run All"
    // batch runner) can cancel the in-flight request on a per-metric timeout.
    return this.request('GET', url, null, options);
  }

  /**
   * Get the full catalog definition for a single metric (calculation,
   * businessLogic, format, entities, dimensions, inverse, accumulation,
   * target, ...). Drives the Playground Rules panel.
   * @param {string} metricKey - Registry metric key
   * @returns {Promise<Object>} { data: { calculation, businessLogic, format, entities, ... } }
   */
  async getMetricCatalogEntry(metricKey) {
    return this.get('/api/v1/modules/metric-catalog/' + encodeURIComponent(metricKey));
  }

  /**
   * Lineage for a metric: which dashboards, boards, and modules/reports
   * reference it. Read-only, org-scoped.
   * @param {string} metricKey - Registry metric key
   * @returns {Promise<Object>} { data: { defined_in, dashboards, boards, modules, reports, summary } }
   */
  async getMetricUsage(metricKey) {
    return this.get('/api/v1/modules/metric-catalog/' + encodeURIComponent(metricKey) + '/usage');
  }

  /**
   * List configured metric goals (module targets) for the organization.
   * Read is allowed for all org members; the catalog uses this to surface a
   * goal indicator per metric. See LANA-AI/docs/METRIC_GOALS_DESIGN.md.
   * @returns {Promise<Object>} { goals: [ { metric_key, target_value, ... } ] }
   */
  async getMetricGoals() {
    return this.get('/api/v1/modules/metric-goals');
  }

  /**
   * Create or update the goal for a metric. Admin-only on the backend.
   * @param {string} metricKey - Registry metric key
   * @param {Object} body - { target_value (required; window N for rolling_average), target_type, target_period, green_threshold?, red_threshold?, notes? }
   * @returns {Promise<Object>} { target_id, metric_key, target_period }
   */
  async upsertMetricGoal(metricKey, body) {
    return this.put('/api/v1/modules/metric-catalog/' + encodeURIComponent(metricKey) + '/goal', body);
  }

  /**
   * Remove the goal for a metric and period. Admin-only on the backend.
   * @param {string} metricKey - Registry metric key
   * @param {string} targetPeriod - 'weekly' | 'monthly'
   * @returns {Promise<Object>} { deleted, metric_key, target_period }
   */
  async deleteMetricGoal(metricKey, targetPeriod) {
    return this.delete('/api/v1/modules/metric-catalog/' + encodeURIComponent(metricKey) + '/goal', { target_period: targetPeriod });
  }

  /**
   * Recommended goal value for a metric and period, used to seed the goal
   * editor's Target value (static type only). Sourced from the org's own
   * history when available, else the metric template default.
   * @param {string} metricKey - Registry metric key
   * @param {string} periodType - 'weekly' | 'monthly'
   * @returns {Promise<Object>} { metric_key, period_type, recommended_value, source, basis, sample_size }
   */
  async getGoalRecommendation(metricKey, periodType) {
    let url = '/api/v1/modules/metric-catalog/' + encodeURIComponent(metricKey) + '/goal-recommendation';
    if (periodType) url += '?periodType=' + encodeURIComponent(periodType);
    return this.get(url);
  }

  async listBIDashboards(params = {}) {
    let url = '/api/v1/business-intelligence/dashboards';
    const queryParts = [];
    if (params.search) queryParts.push('search=' + encodeURIComponent(params.search));
    if (params.limit) queryParts.push('limit=' + encodeURIComponent(String(params.limit)));
    if (params.offset !== undefined) queryParts.push('offset=' + encodeURIComponent(String(params.offset)));
    if (params.sort) queryParts.push('sort=' + encodeURIComponent(params.sort));
    if (params.order) queryParts.push('order=' + encodeURIComponent(params.order));
    if (params.sharedWithMe !== undefined) queryParts.push('sharedWithMe=' + encodeURIComponent(String(params.sharedWithMe)));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    return this.get(url);
  }

  async getBIDashboard(id) {
    return this.get('/api/v1/business-intelligence/dashboards/' + encodeURIComponent(id));
  }

  async createBIDashboard(data) {
    return this.post('/api/v1/business-intelligence/dashboards', data);
  }

  async updateBIDashboard(id, data) {
    return this.put('/api/v1/business-intelligence/dashboards/' + encodeURIComponent(id), data);
  }

  async deleteBIDashboard(id) {
    return this.delete('/api/v1/business-intelligence/dashboards/' + encodeURIComponent(id));
  }

  // Dashboard pinning — mirrors pinMatter/unpinMatter/getPinnedMatters.
  // User-specific pins stored server-side in bi_dashboard_pins.
  async listPinnedBIDashboards() {
    return this.get('/api/v1/business-intelligence/dashboards/pinned');
  }

  async pinBIDashboard(id) {
    return this.post('/api/v1/business-intelligence/dashboards/' + encodeURIComponent(id) + '/pin', {});
  }

  async unpinBIDashboard(id) {
    return this.delete('/api/v1/business-intelligence/dashboards/' + encodeURIComponent(id) + '/pin');
  }

  async listResourceShares(resourceType, resourceId, params = {}) {
    let url = '/api/v1/sharing/resources/' + encodeURIComponent(resourceType) + '/' + encodeURIComponent(resourceId);
    const queryParts = [];
    if (params.search) queryParts.push('search=' + encodeURIComponent(params.search));
    if (params.limit) queryParts.push('limit=' + encodeURIComponent(String(params.limit)));
    if (params.page) queryParts.push('page=' + encodeURIComponent(String(params.page)));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    return this.get(url);
  }

  async grantResourceShare(data) {
    return this.post('/api/v1/sharing/grant', data);
  }

  async revokeResourceShare(data) {
    return this.post('/api/v1/sharing/revoke', data);
  }

  async searchMentions(params = {}) {
    let url = '/api/v1/mentions/search';
    const queryParts = [];
    if (params.q) queryParts.push('q=' + encodeURIComponent(params.q));
    if (params.limit) queryParts.push('limit=' + encodeURIComponent(String(params.limit)));
    if (params.matter_id) queryParts.push('matter_id=' + encodeURIComponent(params.matter_id));
    if (queryParts.length > 0) url += '?' + queryParts.join('&');
    return this.get(url);
  }

  // ---------------------------------------------------------------------------
  // Command Center — Morning Briefing aggregated dashboard
  // ---------------------------------------------------------------------------

  /**
   * Fetch the full Command Center summary (aggregated, 60-second server-side cache).
   *
   * Zones returned:
   *   matter_pulse     — total / active / stale matter counts
   *   today_activity   — documents and conversations started today
   *   focus_items      — top 4 critical/high alerts by focus_score
   *   connector_health — connector status summary
   *
   * @param {Object} [params] - Optional query parameters
   * @param {string} [params.matter_id] - UUID to narrow all zones to a single matter
   * @returns {Promise<Object>}
   */
  async getCommandCenterSummary(params, options = {}) {
    var queryStr = '';
    if (params && params.matter_id) {
      queryStr = '?matter_id=' + encodeURIComponent(params.matter_id);
    }
    return this.get('/api/v1/command-center/summary' + queryStr, options);
  }

  /**
   * Fetch Zone B critical items with pagination and filtering.
   * Returns fresh data on every call (no server-side cache).
   *
   * @param {Object} [params] - Query parameters
   * @param {number} [params.limit=4]       - Max items (1-20)
   * @param {number} [params.offset=0]      - Page offset
   * @param {string} [params.severity]      - critical|high|medium|low
   * @param {string} [params.search]        - Free-text search on title
   * @param {string} [params.sort_by]       - focus_score|created_at|severity|title
   * @param {string} [params.sort_order]    - asc|desc
   * @param {string} [params.status]        - active|acknowledged|resolved
   * @returns {Promise<Object>}
   */
  async getCommandCenterCriticalItems(params, options = {}) {
    var p = params || {};
    var parts = [];
    if (p.limit !== undefined)      parts.push('limit='      + encodeURIComponent(p.limit));
    if (p.offset !== undefined)     parts.push('offset='     + encodeURIComponent(p.offset));
    if (p.severity !== undefined)   parts.push('severity='   + encodeURIComponent(p.severity));
    if (p.search !== undefined)     parts.push('search='     + encodeURIComponent(p.search));
    if (p.sort_by !== undefined)    parts.push('sort_by='    + encodeURIComponent(p.sort_by));
    if (p.sort_order !== undefined) parts.push('sort_order=' + encodeURIComponent(p.sort_order));
    if (p.status !== undefined)     parts.push('status='     + encodeURIComponent(p.status));
    var queryStr = parts.length > 0 ? '?' + parts.join('&') : '';
    return this.get('/api/v1/command-center/critical-items' + queryStr, options);
  }

  /**
   * Fetch Zone E pipeline metrics (matter pulse + today's activity).
   * Response is cached for 60 seconds server-side.
   *
   * @param {Object} [params] - Optional query parameters
   * @param {string} [params.matter_id] - UUID to narrow counts to a single matter
   * @returns {Promise<Object>}
   */
  async getCommandCenterPipelineMetrics(params, options = {}) {
    var queryStr = '';
    if (params && params.matter_id) {
      queryStr = '?matter_id=' + encodeURIComponent(params.matter_id);
    }
    return this.get('/api/v1/command-center/pipeline-metrics' + queryStr, options);
  }

  /**
   * Fetch the trusted Will Design Meetings analytical lane.
   *
   * @param {Object} [params] - Query parameters
   * @param {string} [params.period] - this_month|last_month|current_quarter|previous_quarter|ytd|custom
   * @param {string} [params.date_start] - ISO start for custom ranges
   * @param {string} [params.date_end] - ISO end for custom ranges
   * @param {string|string[]} [params.attorney_id] - Attorney scope; backend locks this for attorney views
   * @param {string|string[]} [params.attorney_ids] - Multi-attorney scope for owner/operator views
   * @param {string} [params.view] - owner|operator|attorney
   * @param {string} [params.instance] - command_center|dashboard|attorney
   * @returns {Promise<Object>}
   */
  async getCommandCenterWillDesignMeetings(params, options = {}) {
    var p = params || {};
    var parts = [];
    var add = function (key, value) {
      if (value === undefined || value === null || value === '') return;
      if (Array.isArray(value)) {
        if (value.length) parts.push(key + '=' + encodeURIComponent(value.join(',')));
        return;
      }
      parts.push(key + '=' + encodeURIComponent(value));
    };

    add('period', p.period);
    add('date_start', p.date_start);
    add('date_end', p.date_end);
    add('attorney_id', p.attorney_id);
    add('attorney_ids', p.attorney_ids);
    add('view', p.view);
    add('instance', p.instance);

    var queryStr = parts.length > 0 ? '?' + parts.join('&') : '';
    try {
      return await this.get('/api/v1/command-center/will-design-meetings' + queryStr, {
        ...options,
        suppressErrorLog: true
      });
    } catch (error) {
      if (error && error.status === 404) {
        return this.getCommandCenterWillDesignMeetingsUnavailable(p);
      }
      throw error;
    }
  }

  async getCommandCenterWillDesignMeetingsMapping(options = {}) {
    return this.get('/api/v1/command-center/will-design-meetings/mapping', options);
  }

  async reconcileCommandCenterWillDesignMeetings(body = {}, options = {}) {
    return this.post('/api/v1/command-center/will-design-meetings/reconcile', body, options);
  }

  getCommandCenterWillDesignMeetingsUnavailable(params) {
    var p = params || {};
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    var end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    var period = p.period || 'this_month';
    var summary = [
      ['upcoming', 'Upcoming', 'legal_firm.estate_planning.upcoming_will_design_meetings', 'upcoming_will_design_meetings'],
      ['completed', 'Completed', 'legal_firm.estate_planning.completed_will_design_meetings', 'completed_will_design_meetings'],
      ['cancelled', 'Cancelled', 'legal_firm.estate_planning.cancelled_will_design_meetings', 'cancelled_will_design_meetings'],
      ['no_show', 'No-show', 'legal_firm.estate_planning.no_show_will_design_meetings', 'no_show_will_design_meetings']
    ].map(function (item) {
      return {
        id: item[0],
        title: item[1],
        metric_key: item[2],
        module_metric_key: item[3],
        value: 0,
        period: period,
        drilldown: {
          module_key: 'service-delivery-operations',
          metric_key: item[3],
          period_start: start,
          period_end: end,
          filters: {},
          available: false
        }
      };
    });

    return {
      section: {
        id: 'estate-planning-will-design-meetings',
        title: 'Estate Planning - Will Design Meetings',
        subtitle: 'Counts, comparisons, attorney breakdown, and record-level lineage from canonical calendar events.'
      },
      generated_at: now.toISOString(),
      filter_context: {
        period: period,
        period_start: start,
        period_end: end,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        attorney_keys: [],
        attorney_scope_locked: false,
        service_offering: 'will_based',
        meeting_type: 'will_design'
      },
      card_definition: {
        id: 'question:will-design-meetings',
        type: 'metric_family',
        module_key: 'service-delivery-operations',
        metric_family: 'legal_firm.estate_planning.will_design_meetings',
        metric_definition_version: null,
        default_visualization: 'metric_grid',
        available_dimensions: ['meeting_status', 'attorney', 'month'],
        available_filters: ['date_period', 'meeting_status', 'attorney']
      },
      card_instances: [
        {
          id: 'command-center:will-design-meetings',
          context: 'command_center',
          definition_id: 'question:will-design-meetings',
          inherits_page_filters: true,
          locked_filters: []
        },
        {
          id: 'dashboard:estate-planning:will-design-meetings',
          context: 'estate_planning_dashboard',
          definition_id: 'question:will-design-meetings',
          inherits_page_filters: true,
          local_visualization: 'detail_lane'
        },
        {
          id: 'attorney:will-design-meetings',
          context: 'attorney_dashboard',
          definition_id: 'question:will-design-meetings',
          inherits_page_filters: true,
          locked_filters: { attorney: 'authenticated_user' },
          local_visualization: 'attorney_detail'
        }
      ],
      period: {
        key: period,
        label: period.replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); }),
        start: start,
        end: end,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        comparison: {
          key: 'previous_period',
          label: 'Previous equivalent period',
          start: start,
          end: start
        }
      },
      summary: summary,
      comparison: {
        title: 'Completed meetings',
        current_period: { label: 'Current period', start: start, end: end, value: 0 },
        comparison_period: { label: 'Previous period', start: start, end: start, value: 0 },
        change: { current: 0, prior: 0, delta: 0, percent: null, direction: 'flat' }
      },
      ytd_trend: [],
      attorney_breakdown: [],
      source: {
        system: 'canonical_calendar_events',
        state: 'backend_route_unavailable',
        last_successful_sync: null,
        data_health_state: 'unknown',
        warnings: ['The Will Design Meetings backend route is not available on the connected server yet.']
      },
      certification: {
        definition: {
          state: 'unavailable',
          version: null,
          certified: false,
          label: 'Unavailable'
        },
        organization: {
          state: 'configuration_required',
          label: 'Backend route unavailable',
          certified: false
        },
        data_health: 'unknown',
        state: 'unavailable',
        label: 'Unavailable - backend route not deployed',
        certified: false,
        reason: 'The connected backend does not expose the Will Design Meetings command-center facade.'
      },
      capabilities: {
        can_view_all_attorneys: false,
        can_change_attorney_filter: false,
        can_drilldown: false,
        can_export: false
      }
    };
  }
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
    // Surface the server's error code so callers/guards can detect specific
    // conditions (e.g. PASSWORD_CHANGE_REQUIRED). The API returns the code
    // either at the top level ({ code: ... }) or nested ({ error: { code } }).
    this.code = (data && (data.code || (data.error && data.error.code))) || null;
  }
}

// Global instance — also exposed on window so IIFEs (Lex components) can access it
const api = new ApiClient();
window.api = api;
