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
  }
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
