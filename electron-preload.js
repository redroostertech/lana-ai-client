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
   * Brainchild MCP bridge (Phase B) — read the user's local vault.
   *
   * The renderer never spawns processes; it calls these thin wrappers which
   * route to the main-process BrainchildManager over IPC. All methods resolve
   * with a result object shaped `{ success, ... }` or `{ success: false, error }`.
   *
   *   discover()                  -> { success, installPath, vaultPath, mcpBin }
   *   link({ installPath, vaultPath }) -> { success, status } | { success:false, error }
   *   status()                    -> { success, status, reason?, vaultPath? }
   *   listNotes({ filter? })      -> { success, notes, count }
   *   search({ query, limit? })   -> { success, results }
   *   getNote({ path })           -> { success, note }
   *   openNote(path)              -> opens the note in the Brainchild app (deep link)
   */
  brainchild: {
    discover: () => ipcRenderer.invoke('brainchild:discover'),
    link: (config) => ipcRenderer.invoke('brainchild:link', config),
    status: () => ipcRenderer.invoke('brainchild:status'),
    listNotes: (options) => ipcRenderer.invoke('brainchild:listNotes', options || {}),
    search: (options) => ipcRenderer.invoke('brainchild:search', options || {}),
    getNote: (options) => ipcRenderer.invoke('brainchild:getNote', options || {}),
    // Native folder pickers (main-mediated). pickInstall() returns a vetted
    // { installPath }, pickVault() returns { vaultPath } — feed both to link().
    pickInstall: () => ipcRenderer.invoke('brainchild:pickInstall'),
    pickVault: () => ipcRenderer.invoke('brainchild:pickVault'),
    // Forget the persisted link and stop the MCP child so the user can re-link
    // to a different install/vault.
    unlink: () => ipcRenderer.invoke('brainchild:unlink'),
    // Reveal a note's vault file in the OS file manager — the always-available
    // fallback for "Open in Brainchild" when no protocol handler is registered.
    revealNote: (notePath) => ipcRenderer.invoke('brainchild:revealNote', { path: notePath }),
    // Vault-relative paths routinely contain spaces and may contain '#', '%', or
    // '?' (e.g. 'Daily/2026-05-16 notes.md'). encodeURI preserves the '/' path
    // separators while escaping those characters so the deep link is not
    // truncated at a '#' fragment or broken by raw spaces.
    openNote: (notePath) => ipcRenderer.invoke('open-external-url', 'brainchild://vault/' + encodeURI(String(notePath || '')))
  },

  /**
   * Generic IPC invoke (for extensibility)
   */
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  /**
   * Open a URL in the user's system browser via shell.openExternal.
   *
   * Used by the Apps section pages (knowledge-base.html, etc.) to launch
   * external apps' local web UIs (e.g. http://127.0.0.1:7891 for lana-brain)
   * outside the Electron app. The renderer cannot import 'electron' directly,
   * so we route through the existing 'open-external-url' main-process handler.
   */
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

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
  exchangeOAuthCode: (code, state, provider, connectorId, redirectUri, realmId) =>
    ipcRenderer.invoke('exchange-oauth-code', { code, state, provider, connectorId, redirectUri, realmId }),

  /**
   * PAC bridge (companion bridge) — in-app consent prompt
   *
   * The main process forwards bridge consent requests over the
   * `companion-bridge:request-consent` channel. The renderer (see
   * src/js/companion-bridge-consent.js) shows a Lex modal and calls
   * `respondCompanionBridgeConsent({ requestId, allow, alwaysAllow })` to
   * answer.
   *
   * `onCompanionBridgeRequestConsent(callback)` returns an unsubscribe
   * function; call it to detach the listener (the consent handler does
   * this on page unload).
   */
  onCompanionBridgeRequestConsent: (callback) => {
    const handler = (_event, payload) => {
      try { callback(payload); } catch (_) { /* swallow renderer errors */ }
    };
    ipcRenderer.on('companion-bridge:request-consent', handler);
    return () => {
      ipcRenderer.removeListener('companion-bridge:request-consent', handler);
    };
  },

  respondCompanionBridgeConsent: (payload) =>
    ipcRenderer.invoke('companion-bridge:respond-consent', payload),

  /**
   * Connected Apps — manage bridge consents granted to sibling Lana apps.
   *
   * Reads/writes the same `bridge-consents` electron-store file that the
   * companion bridge consults on every incoming request. Revocation takes
   * effect on the very next bridge request (no restart required).
   *
   * `listBridgeConsents()` resolves with the consents map keyed by app name:
   *   { 'lana-companion': { mode, granted_at, granted_user_id } }
   *
   * `revokeBridgeConsent(app)` resolves with `{ ok, removed?, message? }`.
   */
  listBridgeConsents: () => ipcRenderer.invoke('settings:list-bridge-consents'),
  revokeBridgeConsent: (app) =>
    ipcRenderer.invoke('settings:revoke-bridge-consent', { app })
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
