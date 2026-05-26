// electron-preload.js
var { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Application configuration
   */
  getConfig: () => ipcRenderer.invoke("get-config"),
  /**
   * Debug logging - sends logs to main process for export
   */
  logError: (message, error) => ipcRenderer.invoke("renderer-log-error", message, error),
  logInfo: (message) => ipcRenderer.invoke("renderer-log-info", message),
  /**
   * Settings management (used by login to save resolved server info)
   */
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  /**
   * Platform information
   */
  platform: process.platform,
  arch: process.arch,
  /**
   * Application version
   */
  getVersion: () => ipcRenderer.invoke("get-version"),
  /**
   * Server connection (after hosted discovery resolves org)
   */
  connectToServer: (server) => ipcRenderer.invoke("connect-to-server", server),
  verifyServer: (serverUrl) => ipcRenderer.invoke("verify-server", serverUrl),
  /**
   * Server storage
   */
  getSavedServer: () => ipcRenderer.invoke("get-saved-server"),
  clearSavedServer: () => ipcRenderer.invoke("clear-saved-server"),
  /**
   * Updates
   */
  checkUpdates: (serverUrl) => ipcRenderer.invoke("check-updates", serverUrl),
  installUpdate: (serverUrl) => ipcRenderer.invoke("install-update", serverUrl),
  /**
   * VPN Management (secure key storage)
   */
  vpn: {
    generateKeyPair: () => ipcRenderer.invoke("vpn-generate-keypair"),
    saveKeys: (keys) => ipcRenderer.invoke("vpn-save-keys", keys),
    loadKeys: () => ipcRenderer.invoke("vpn-load-keys"),
    clearKeys: () => ipcRenderer.invoke("vpn-clear-keys"),
    getDeviceId: () => ipcRenderer.invoke("vpn-get-device-id")
  },
  /**
   * Session Tracking (time tracking and activity monitoring)
   */
  sessionTracking: {
    getStatus: () => ipcRenderer.invoke("session-tracker:getStatus"),
    updateMatter: (matterId) => ipcRenderer.invoke("session-tracker:updateMatter", matterId),
    start: () => ipcRenderer.invoke("session-tracker:start"),
    end: (reason) => ipcRenderer.invoke("session-tracker:end", reason)
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
  openExternal: (url) => ipcRenderer.invoke("open-external-url", url),
  /**
   * Generic IPC send (fire-and-forget, for one-way messages to main process)
   */
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  /**
   * Event listeners (one-way communication from main to renderer)
   */
  onUpdateAvailable: (callback) => {
    ipcRenderer.on("update-available", (event, info) => callback(info));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on("update-downloaded", (event, info) => callback(info));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on("update-progress", (event, info) => callback(info));
  },
  onUpdateError: (callback) => {
    ipcRenderer.on("update-error", (event, info) => callback(info));
  },
  /**
   * OAuth deep link callback (main process forwards lana-ai://oauth/callback here)
   */
  onOAuthCallback: (callback) => {
    ipcRenderer.on("oauth-callback", (event, data) => callback(data));
  },
  /**
   * Generate a CSRF-safe OAuth state parameter (local, deprecated)
   */
  generateOAuthState: () => ipcRenderer.invoke("generate-oauth-state"),
  /**
   * OAuth State Management (Backend-based)
   * Creates a state token in the backend database for CSRF protection
   */
  createOAuthState: (provider, connectorId, matterId) => ipcRenderer.invoke("create-oauth-state", { provider, connectorId, matterId }),
  /**
   * OAuth Code Exchange (Backend-based)
   * Exchanges authorization code for tokens via backend
   */
  exchangeOAuthCode: (code, state, provider, connectorId, redirectUri, realmId) => ipcRenderer.invoke("exchange-oauth-code", { code, state, provider, connectorId, redirectUri, realmId }),
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
      try {
        callback(payload);
      } catch (_) {
      }
    };
    ipcRenderer.on("companion-bridge:request-consent", handler);
    return () => {
      ipcRenderer.removeListener("companion-bridge:request-consent", handler);
    };
  },
  respondCompanionBridgeConsent: (payload) => ipcRenderer.invoke("companion-bridge:respond-consent", payload),
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
  listBridgeConsents: () => ipcRenderer.invoke("settings:list-bridge-consents"),
  revokeBridgeConsent: (app) => ipcRenderer.invoke("settings:revoke-bridge-consent", { app })
});
contextBridge.exposeInMainWorld("isElectron", true);
contextBridge.exposeInMainWorld("processInfo", {
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});
console.log("Lana AI Client - Preload script loaded");
console.log("Platform:", process.platform);
console.log("Architecture:", process.arch);
