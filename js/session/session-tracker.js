/**
 * Session Tracker - Electron Main Process Module
 * Tracks user activity and sends heartbeats to backend
 *
 * @module session-tracker
 * @requires electron
 * @requires electron-store
 */

const { powerMonitor, ipcMain } = require('electron');
const Store = require('electron-store');
const https = require('https');
const http = require('http');

class SessionTracker {
  constructor(options = {}) {
    this.options = {
      heartbeatInterval: options.heartbeatInterval || 30000, // 30 seconds
      idleThreshold: options.idleThreshold || 60, // 1 minute in seconds
      ...options
    };

    // State
    this.currentSessionId = null;
    this.currentMatterId = null;
    this.isIdle = false;
    this.lastHeartbeatTime = 0;
    this.heartbeatTimer = null;
    this.retryCount = 0;
    this.maxRetries = 3;

    // Rate limiting
    this.rateLimitResetTime = 0;
    this.isRateLimited = false;

    // Persistent storage
    this.store = new Store({
      name: 'session-tracker',
      defaults: {
        sessionId: null,
        startedAt: null,
        matterId: null
      }
    });

    // Backend connection
    this.backendUrl = null;
    this.authToken = null;

    // Initialize
    this.setupIPC();
    this.setupIdleDetection();
  }

  /**
   * Setup IPC handlers for renderer communication
   */
  setupIPC() {
    // Get current session info
    ipcMain.handle('session-tracker:getStatus', () => {
      return {
        sessionId: this.currentSessionId,
        matterId: this.currentMatterId,
        isIdle: this.isIdle,
        isActive: !!this.currentSessionId
      };
    });

    // Update matter context
    ipcMain.handle('session-tracker:updateMatter', (event, matterId) => {
      this.currentMatterId = matterId;
      this.store.set('matterId', matterId);
      return { success: true };
    });

    // Manual session control
    ipcMain.handle('session-tracker:start', async () => {
      return await this.startSession();
    });

    ipcMain.handle('session-tracker:end', async (event, reason = 'manual') => {
      return await this.endSession(reason);
    });
  }

  /**
   * Setup idle detection using power monitor
   */
  setupIdleDetection() {
    // Listen for idle state changes
    powerMonitor.on('lock-screen', () => {
      this.handleIdleStateChange(true);
    });

    powerMonitor.on('unlock-screen', () => {
      this.handleIdleStateChange(false);
    });

    powerMonitor.on('suspend', () => {
      this.handleIdleStateChange(true);
    });

    powerMonitor.on('resume', () => {
      this.handleIdleStateChange(false);
    });

    // Poll idle time
    setInterval(() => {
      const idleTime = powerMonitor.getSystemIdleTime();
      const wasIdle = this.isIdle;
      this.isIdle = idleTime >= this.options.idleThreshold;

      if (wasIdle !== this.isIdle) {
        this.handleIdleStateChange(this.isIdle);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Handle idle state changes
   * @param {boolean} isIdle - Is user now idle?
   */
  handleIdleStateChange(isIdle) {
    if (this.isIdle === isIdle) return;

    this.isIdle = isIdle;

    // Send immediate heartbeat to update idle status
    if (this.currentSessionId) {
      this.sendHeartbeat();
    }
  }

  /**
   * Initialize session tracker with backend URL and auth token
   * @param {string} backendUrl - Backend server URL
   * @param {string} authToken - JWT authentication token
   */
  initialize(backendUrl, authToken) {
    this.backendUrl = backendUrl;
    this.authToken = authToken;

    // Recover active session if exists
    const savedSessionId = this.store.get('sessionId');
    const savedStartedAt = this.store.get('startedAt');

    if (savedSessionId && savedStartedAt) {
      // Check if session is still valid (within last 2 hours)
      const elapsed = Date.now() - new Date(savedStartedAt).getTime();
      if (elapsed < 2 * 60 * 60 * 1000) {
        this.currentSessionId = savedSessionId;
        this.currentMatterId = this.store.get('matterId');
        this.startHeartbeatTimer();
      } else {
        // Session expired, clear it
        this.clearStoredSession();
      }
    }
  }

  /**
   * Start a new work session
   * @returns {Promise<Object>} Session start response
   */
  async startSession() {
    if (this.currentSessionId) {
      return { success: true, sessionId: this.currentSessionId };
    }

    try {
      // SECURITY FIX: Server generates session_id (no longer client-controlled)
      const response = await this.makeApiRequest('/api/v1/session-tracking/start', 'POST', {
        client_type: 'desktop',
        client_version: require('electron').app.getVersion()
      });

      if (response.status === 'success' && response.session_id) {
        // Use server-generated session_id
        this.currentSessionId = response.session_id;
        this.store.set('sessionId', response.session_id);
        this.store.set('startedAt', response.created_at || new Date().toISOString());

        // Start heartbeat timer
        this.startHeartbeatTimer();

        return { success: true, sessionId: this.currentSessionId };
      } else {
        throw new Error('Invalid response from backend');
      }
    } catch (error) {
      console.error('[SessionTracker] Failed to start session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * End current work session
   * @param {string} endReason - Reason for ending (manual, auto, logout, shutdown) - UNUSED, kept for API compatibility
   * @returns {Promise<Object>} Session end response
   */
  async endSession(endReason = 'manual') {
    if (!this.currentSessionId) {
      return { success: true, message: 'No active session' };
    }

    try {
      this.stopHeartbeatTimer();

      const response = await this.makeApiRequest('/api/v1/session-tracking/end', 'POST', {
        session_id: this.currentSessionId
      });

      this.currentSessionId = null;
      this.currentMatterId = null;
      this.clearStoredSession();

      return { success: true, data: response };
    } catch (error) {
      console.error('[SessionTracker] Failed to end session:', error);
      // Still clear local state
      this.currentSessionId = null;
      this.clearStoredSession();
      return { success: false, error: error.message };
    }
  }

  /**
   * Send heartbeat to maintain session
   */
  async sendHeartbeat() {
    if (!this.currentSessionId) return;

    // Rate limit check
    if (this.isRateLimited) {
      const now = Date.now();
      if (now < this.rateLimitResetTime) {
        // Still rate limited
        return;
      } else {
        // Rate limit expired
        this.isRateLimited = false;
        this.retryCount = 0;
      }
    }

    // Prevent duplicate heartbeats within 30 seconds
    const now = Date.now();
    if (now - this.lastHeartbeatTime < 30000) {
      return;
    }

    this.lastHeartbeatTime = now;

    try {
      const response = await this.makeApiRequest('/api/v1/session-tracking/heartbeat', 'POST', {
        session_id: this.currentSessionId
      });

      if (response.status === 'success') {
        this.retryCount = 0; // Reset retry count on success
      }
    } catch (error) {
      if (error.message?.includes('429')) {
        // Rate limited
        this.handleRateLimit();
      } else if (error.message?.includes('401')) {
        // Unauthorized - session may have expired
        console.error('[SessionTracker] Unauthorized - clearing session');
        this.currentSessionId = null;
        this.clearStoredSession();
        this.stopHeartbeatTimer();
      } else {
        // Other error
        this.retryCount++;
        if (this.retryCount >= this.maxRetries) {
          console.error('[SessionTracker] Max retries reached, ending session');
          await this.endSession('error');
        }
      }
    }
  }

  /**
   * Handle rate limit with exponential backoff
   */
  handleRateLimit() {
    this.isRateLimited = true;
    const backoffMs = Math.min(30000 * Math.pow(2, this.retryCount), 5 * 60 * 1000); // Max 5 minutes
    this.rateLimitResetTime = Date.now() + backoffMs;
    console.warn(`[SessionTracker] Rate limited, backing off for ${backoffMs}ms`);
  }

  /**
   * Start heartbeat timer
   */
  startHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    // Send initial heartbeat
    this.sendHeartbeat();

    // Set up recurring heartbeats
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.options.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Clear stored session data
   */
  clearStoredSession() {
    this.store.delete('sessionId');
    this.store.delete('startedAt');
    this.store.delete('matterId');
  }

  /**
   * Make API request to backend
   * @param {string} endpoint - API endpoint path
   * @param {string} method - HTTP method
   * @param {Object} data - Request body
   * @returns {Promise<Object>} Response data
   */
  makeApiRequest(endpoint, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      if (!this.backendUrl || !this.authToken) {
        return reject(new Error('Backend not initialized'));
      }

      const urlObj = new URL(endpoint, this.backendUrl);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        }
      };

      const req = httpModule.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            if (res.statusCode === 200 || res.statusCode === 201) {
              resolve(response);
            } else if (res.statusCode === 429) {
              reject(new Error('429 Rate Limit Exceeded'));
            } else if (res.statusCode === 401) {
              reject(new Error('401 Unauthorized'));
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${response.message || 'Request failed'}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Cleanup on app shutdown
   */
  async shutdown() {
    this.stopHeartbeatTimer();
    if (this.currentSessionId) {
      await this.endSession('shutdown');
    }
  }
}

module.exports = SessionTracker;
