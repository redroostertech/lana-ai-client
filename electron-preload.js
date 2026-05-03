/**
 * Lana AI Desktop Application - Electron Preload Script
 *
 * This script runs before the renderer process loads and provides a secure
 * bridge between the renderer process (web pages) and the main process.
 *
 * Security: This uses contextIsolation and exposes only specific APIs
 * through the contextBridge to prevent XSS and code injection attacks.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose protected methods that allow the renderer process to use
 * ipcRenderer without exposing the entire object
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Application configuration
   */
  getConfig: () => ipcRenderer.invoke('get-config'),

  /**
   * Debug logging - sends logs to main process for export
   */
  logError: (message, error) => ipcRenderer.invoke('renderer-log-error', message, error),
  logInfo: (message) => ipcRenderer.invoke('renderer-log-info', message),

  /**
   * Settings management (used by login to save resolved server info)
   */
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),

  /**
   * Platform information
   */
  platform: process.platform,
  arch: process.arch,

  /**
   * Application version
   */
  getVersion: () => ipcRenderer.invoke('get-version'),

  /**
   * Server connection (after hosted discovery resolves org)
   */
  connectToServer: (server) => ipcRenderer.invoke('connect-to-server', server),
  verifyServer: (serverUrl) => ipcRenderer.invoke('verify-server', serverUrl),

  /**
   * Server storage
   */
  getSavedServer: () => ipcRenderer.invoke('get-saved-server'),
  clearSavedServer: () => ipcRenderer.invoke('clear-saved-server'),

  /**
   * Updates
   */
  checkUpdates: (serverUrl) => ipcRenderer.invoke('check-updates', serverUrl),
  installUpdate: (serverUrl) => ipcRenderer.invoke('install-update', serverUrl),

  /**
   * VPN Management (secure key storage)
   */
  vpn: {
    generateKeyPair: () => ipcRenderer.invoke('vpn-generate-keypair'),
    saveKeys: (keys) => ipcRenderer.invoke('vpn-save-keys', keys),
    loadKeys: () => ipcRenderer.invoke('vpn-load-keys'),
    clearKeys: () => ipcRenderer.invoke('vpn-clear-keys'),
    getDeviceId: () => ipcRenderer.invoke('vpn-get-device-id')
  },

  /**
   * Session Tracking (time tracking and activity monitoring)
   */
  sessionTracking: {
    getStatus: () => ipcRenderer.invoke('session-tracker:getStatus'),
    updateMatter: (matterId) => ipcRenderer.invoke('session-tracker:updateMatter', matterId),
    start: () => ipcRenderer.invoke('session-tracker:start'),
    end: (reason) => ipcRenderer.invoke('session-tracker:end', reason)
  },

  /**
   * Generic IPC invoke (for extensibility)
   */
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  /**
   * Generic IPC send (fire-and-forget, for one-way messages to main process)
   */
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),

  /**
   * Event listeners (one-way communication from main to renderer)
   */
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, info) => callback(info));
  },

  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, info) => callback(info));
  },

  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, info) => callback(info));
  },

  onUpdateError: (callback) => {
    ipcRenderer.on('update-error', (event, info) => callback(info));
  },

  /**
   * OAuth deep link callback (main process forwards lana-ai://oauth/callback here)
   */
  onOAuthCallback: (callback) => {
    ipcRenderer.on('oauth-callback', (event, data) => callback(data));
  },

  /**
   * Generate a CSRF-safe OAuth state parameter (local, deprecated)
   */
  generateOAuthState: () => ipcRenderer.invoke('generate-oauth-state'),

  /**
   * OAuth State Management (Backend-based)
   * Creates a state token in the backend database for CSRF protection
   */
  createOAuthState: (provider, connectorId, matterId) =>
    ipcRenderer.invoke('create-oauth-state', { provider, connectorId, matterId }),

  /**
   * OAuth Code Exchange (Backend-based)
   * Exchanges authorization code for tokens via backend
   */
  exchangeOAuthCode: (code, state, provider, connectorId, redirectUri) =>
    ipcRenderer.invoke('exchange-oauth-code', { code, state, provider, connectorId, redirectUri })
});

/**
 * Expose a simple API for checking if running in Electron
 */
contextBridge.exposeInMainWorld('isElectron', true);

/**
 * Optional: Expose process information (read-only)
 */
contextBridge.exposeInMainWorld('processInfo', {
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});

/**
 * Console logging for debugging (optional - remove in production)
 */
console.log('Lana AI Client - Preload script loaded');
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);
