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
const { resolveFlavor, brandFor, applyBrandToDocument } = require('./src/js/brand/lana-brand');

// Which product's look this page gets. The main process passes its build-time
// flavor as --lana-flavor (src/js/brand/lana-brand.js). In "lana-one" the page is
// rebranded as it is parsed; in "lana" nothing is touched.
const brandArg = process.argv.find((a) => a.startsWith('--lana-flavor='));
// isPackaged: true so only the main process's answer counts; it already applied LANA_FLAVOR.
const brandFlavor = resolveFlavor({ packageJson: { lanaFlavor: brandArg ? brandArg.slice('--lana-flavor='.length) : '' }, isPackaged: true });
contextBridge.exposeInMainWorld('lanaBrand', { flavor: brandFlavor, name: brandFor(brandFlavor).name });
applyBrandToDocument(document, brandFlavor);

/**
 * Login token. It lives in the main process (electron-token-store.js), OS
 * keychain encrypted at rest; this page only holds a copy in memory. The calls
 * are synchronous so the many synchronous readers keep working and a set or
 * clear is persisted before the page navigates.
 *
 * Older builds kept the token in localStorage. Hand any such token to the main
 * process once and delete it here, so it is never left in plain text.
 */
let authTokenCache = null;
try {
  const legacyToken = window.localStorage.getItem('token');
  if (legacyToken) {
    window.localStorage.removeItem('token');
    authTokenCache = ipcRenderer.sendSync('auth-token:migrate', legacyToken);
  } else {
    authTokenCache = ipcRenderer.sendSync('auth-token:get');
  }
} catch (_) {
  authTokenCache = null;
}
contextBridge.exposeInMainWorld('lanaAuthToken', {
  get: () => authTokenCache || null,
  set: (token) => {
    authTokenCache = ipcRenderer.sendSync('auth-token:set', typeof token === 'string' ? token : null) || null;
    return Boolean(authTokenCache);
  },
  clear: () => {
    authTokenCache = null;
    ipcRenderer.sendSync('auth-token:clear');
  }
});

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
   * The API base, synchronously, so a page's first request already uses it:
   * the local AI engine's loopback address when it is in use, otherwise the
   * organization's server. Null before an organization is connected.
   */
  getApiBaseSync: () => {
    try { return ipcRenderer.sendSync('engine:api-base-sync') || null; } catch (_) { return null; }
  },

  /** Local AI engine status and controls (Settings, status banner). */
  engine: {
    getStatus: () => ipcRenderer.invoke('engine:status'),
    restart: () => ipcRenderer.invoke('engine:restart'),
    setEnabled: (enabled) => ipcRenderer.invoke('engine:set-enabled', { enabled }),
    // "Run my background jobs on this computer when possible" and its status (phase 8d).
    setBackgroundJobs: (enabled) => ipcRenderer.invoke('engine:set-background-jobs', { enabled }),
    getBackgroundJobs: () => ipcRenderer.invoke('engine:background-jobs'),
    onState: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('engine:state', handler);
      return () => ipcRenderer.removeListener('engine:state', handler);
    }
  },

  /**
   * First-launch setup screen (electron-first-launch-ipc.js): the plan for this computer, the
   * chat choice, Continue, and the downloads. No file addresses reach the page.
   */
  firstLaunch: {
    getPlan: () => ipcRenderer.invoke('first-launch:plan'),
    choose: (chatId) => ipcRenderer.invoke('first-launch:choose', { chatId: typeof chatId === 'string' ? chatId : null }),
    findExisting: () => ipcRenderer.invoke('first-launch:find-existing'),
    continue: (options) => ipcRenderer.invoke('first-launch:continue', { useExisting: Boolean(options && options.useExisting) }),
    pause: () => ipcRenderer.invoke('first-launch:pause'),
    resume: () => ipcRenderer.invoke('first-launch:resume'),
    getStatus: () => ipcRenderer.invoke('first-launch:status'),
    // Settings > Capabilities: the plan with each local server's state, the states alone, and
    // switching the chat model (its files download here, then only the chat server restarts).
    getCapabilities: () => ipcRenderer.invoke('first-launch:capabilities'),
    getServers: () => ipcRenderer.invoke('first-launch:servers'),
    switchChat: (chatId) => ipcRenderer.invoke('first-launch:switch-chat', { chatId: typeof chatId === 'string' ? chatId : null }),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('first-launch:status-changed', handler);
      return () => ipcRenderer.removeListener('first-launch:status-changed', handler);
    }
  },

  /** Discovery-entitled native/background capabilities. */
  capabilities: {
    list: () => ipcRenderer.invoke('capabilities:list'),
    setActive: (id, active) => ipcRenderer.invoke('capabilities:set-active', { id, active }),
    setOpenAtLogin: (openAtLogin) => ipcRenderer.invoke('capabilities:set-open-at-login', { openAtLogin }),
    getVoiceSettings: () => ipcRenderer.invoke('capabilities:get-voice-settings'),
    setVoiceSettings: (settings) => ipcRenderer.invoke('capabilities:set-voice-settings', { settings }),
    getVoicePermissions: () => ipcRenderer.invoke('capabilities:get-voice-permissions'),
    requestVoicePermission: (type) => ipcRenderer.invoke('capabilities:request-voice-permission', { type })
  },

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
  /** Settings > General: this computer and this copy of LANA, and software updates (electron-system-info.js). */
  getSystemInfo: () => ipcRenderer.invoke('settings:system-info'),
  getAiTopology: () => ipcRenderer.invoke('settings:ai-topology'),
  getUpdateStatus: () => ipcRenderer.invoke('settings:update-status'),
  checkForClientUpdates: () => ipcRenderer.invoke('settings:check-for-updates'),
  installClientUpdate: () => ipcRenderer.invoke('settings:install-update'),

  listBridgeConsents: () => ipcRenderer.invoke('settings:list-bridge-consents'),
  revokeBridgeConsent: (app) =>
    ipcRenderer.invoke('settings:revoke-bridge-consent', { app })
});

/**
 * Expose a simple API for checking if running in Electron
 */
// LANA Briefs: the typed bridge as window.lanaBriefs (briefs/packages/host/src/preload/bridge.ts).
// Main answers only the client's own pages, and only while Briefs is on for the firm.
try {
  require('./briefs/dist/briefs-preload.cjs').exposeBriefsBridge(contextBridge, ipcRenderer);
} catch (_) {
  // Not built (npm run build:briefs): the client runs without Briefs.
}

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
