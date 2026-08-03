/**
 * Lana AI Desktop Application - Electron Main Process
 *
 * This file serves as the entry point for the Electron desktop application.
 * It creates the main browser window and handles application lifecycle events.
 * 
 * This is the THIN CLIENT version - connects to a remote backend server.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, session, nativeImage, Notification, shell } = require('electron');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const Store = require('electron-store');
const { OwnedWebDesktopBrowserManager } = require('./src/owned-web/desktop-browser');

/**
 * Resolve app icon candidates for the macOS Dock override. In development the
 * process is Electron.app, whose bundle icon is the default Electron mark; use
 * the PNG master first because nativeImage loads it more reliably than ICNS.
 */
function appIconCandidates() {
  return [
    path.join(__dirname, 'build', 'icons', 'icon-1024.png'),
    path.join(__dirname, 'build', 'icons', 'icon-512.png'),
    path.join(__dirname, 'build', 'icons', 'icon.png'),
    path.join(__dirname, 'build', 'icons', 'icon.icns'),
  ];
}

// Set app version from package.json (prevents app.getVersion() returning the Electron framework version)
const packageJson = require('./package.json');
app.setName(packageJson.productName || 'Lana AI');
app.setVersion(packageJson.version);

function applyDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return false;
  let foundCandidate = false;
  try {
    const candidates = appIconCandidates();
    for (const iconPath of candidates) {
      if (!fs.existsSync(iconPath)) continue;
      foundCandidate = true;

      const img = nativeImage.createFromPath(iconPath);
      if (img.isEmpty()) {
        logError(`[lana-ai-client] dock icon candidate could not be loaded: ${iconPath}`);
        continue;
      }

      app.dock.setIcon(img);
      app.dock.show().catch(() => {});
      logInfo(`[lana-ai-client] dock icon applied: ${iconPath}`);
      return true;
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    logError(`[lana-ai-client] dock icon set failed: ${msg}`);
  }

  logError(foundCandidate
    ? '[lana-ai-client] dock icon set failed: all icon candidates were empty'
    : '[lana-ai-client] dock icon set failed: no icon assets found');
  return false;
}

// Chromium can emit noisy GPU-driver diagnostics to stderr on macOS dev runs
// (for example repeated EGL "Bad attribute" messages). Keep app logs visible
// while suppressing Chromium ERROR-level noise.
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('log-level', '3');
}

// Import thin client modules
const { refreshHostedDiscovery, verifyServer } = require('./electron-discovery');
const { getSavedServer, saveServerConnection, clearSavedServer, updateLastVerified, saveBrainchildLink, getBrainchildLink, clearBrainchildLink, setBrainchildAutoBindDisabled, isBrainchildAutoBindDisabled } = require('./electron-storage');
const { checkForUpdates, downloadAndInstallUpdate, showOptionalUpdateDialog, showForceUpdateDialog, shouldCheckForUpdates, configureAutoUpdater } = require('./electron-updater-custom');
const { logInfo, logError, exportLogs, getLogFilePath } = require('./electron-logger');
const SessionTracker = require('./js/session/session-tracker');
const companionBridge = require('./electron-bridge');
const { BrainchildManager, discover, validateLink, mcpBinForRoot, isAllowedVaultRoot } = require('./src/electron-brainchild-manager');
const { ElectronScreenVoice } = require('./src/screen-voice/electron-screen-voice');
const {
  SCREEN_DICTION_APP_ID,
  capabilityItems,
  capabilityViewModels,
  isCapabilityActive
} = require('./src/screen-voice/app-entitlement');

/**
 * Brainchild MCP bridge — reads the user's local vault over the MCP stdio
 * server (brainchild/bin/brainchild-mcp.js). Spawned lazily on first read and
 * reused; torn down on quit. The link config (install + vault path) is persisted
 * via electron-storage. See src/electron-brainchild-manager.js.
 */
const brainchildManager = new BrainchildManager({
  getLink: () => getBrainchildLink(),
  discoverFn: () => discover(),
  isAutoBindDisabled: () => isBrainchildAutoBindDisabled(),
  logInfo: (msg, error) => logInfo(msg, error),
  logError: (msg, error) => logError(msg, error)
});

// Install roots the user explicitly chose via the native folder picker in THIS
// session. A native dialog is a deliberate, main-process-mediated user action,
// so a picked root is trusted to spawn from even if it is not one of the OS
// default candidates. This is the only sanctioned way an out-of-candidate
// install path can be linked — a renderer-passed arbitrary string is not.
const brainchildPickedInstallRoots = new Set();

// Vault roots the user explicitly chose via the native folder picker in THIS
// session. Same trust model as brainchildPickedInstallRoots: the MCP server
// reads file contents from the vault and returns them to the renderer/chat, so
// a vault outside the OS-default candidate set may only be linked if the user
// deliberately picked it through the native dialog — not via a renderer-passed
// arbitrary string (which could otherwise point at ~/.ssh, ~/.aws, etc.).
const brainchildPickedVaultRoots = new Set();

/**
 * Companion Bridge — in-app consent prompts
 *
 * The bridge (electron-bridge.js) calls `requestConsentFromRenderer({ app })`
 * when it needs the user to approve a token request. We forward that to the
 * renderer over IPC, where `src/js/companion-bridge-consent.js` shows a Lex
 * modal and posts the answer back via `companion-bridge:respond-consent`.
 *
 * One pending Promise per requestId. The bridge applies its own timeout, so
 * we don't bound this map on time — but we do clean up on respond + on
 * destroyed window.
 */
const pendingCompanionConsents = new Map();

function generateConsentRequestId() {
  return `cb-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

function requestCompanionConsentFromRenderer({ app }) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
      resolve({ allow: false, alwaysAllow: false });
      return;
    }

    const requestId = generateConsentRequestId();
    pendingCompanionConsents.set(requestId, resolve);

    // If the window goes away while we wait, resolve as denied so callers
    // don't hang forever (the bridge has its own timeout too).
    const cleanupOnClose = () => {
      const pending = pendingCompanionConsents.get(requestId);
      if (pending) {
        pendingCompanionConsents.delete(requestId);
        pending({ allow: false, alwaysAllow: false });
      }
    };

    try {
      mainWindow.once('closed', cleanupOnClose);
      mainWindow.webContents.send('companion-bridge:request-consent', {
        requestId,
        app,
        originHint: 'lana-companion'
      });
    } catch (error) {
      pendingCompanionConsents.delete(requestId);
      try { mainWindow.removeListener('closed', cleanupOnClose); } catch (_) { /* noop */ }
      logError('[electron-main] Failed to forward companion consent request to renderer', error);
      resolve({ allow: false, alwaysAllow: false });
    }
  });
}

ipcMain.handle('companion-bridge:respond-consent', async (_event, payload) => {
  const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId : null;
  if (!requestId) return { ok: false, reason: 'missing_request_id' };

  const resolve = pendingCompanionConsents.get(requestId);
  if (!resolve) return { ok: false, reason: 'unknown_request_id' };

  pendingCompanionConsents.delete(requestId);
  resolve({
    allow: Boolean(payload && payload.allow),
    alwaysAllow: Boolean(payload && payload.alwaysAllow)
  });
  return { ok: true };
});

function isBrokenPipeError(error) {
  return error && (error.code === 'EPIPE' || /write EPIPE/i.test(String(error.message || '')));
}

function attachBrokenPipeGuard(stream, streamName) {
  if (!stream || typeof stream.on !== 'function') return;

  stream.on('error', (error) => {
    if (isBrokenPipeError(error)) {
      try {
        logError(`[electron-main] Ignoring broken ${streamName} pipe`, error);
      } catch (_logError) {
        // The logging destination may be the closed pipe; avoid a recursive crash.
      }
      return;
    }

    throw error;
  });
}

attachBrokenPipeGuard(process.stdout, 'stdout');
attachBrokenPipeGuard(process.stderr, 'stderr');

/**
 * Get app version from centralized version system
 * @returns {string} Formatted version like "v3.0.0b1"
 */
function getAppVersion() {
  try {
    const versionModule = require('./src/version.js');
    return versionModule.displayVersion;
  } catch (e) {
    try {
      const packageJson = require('./package.json');
      return `v${packageJson.version}`;
    } catch (e2) {
      return `v${app.getVersion()}`;
    }
  }
}

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;
let screenVoice = null;
let capabilityPreferencesStore = null;
let ownedWebDesktopBrowser = null;

function getCapabilityPreferencesStore() {
  if (!capabilityPreferencesStore) {
    capabilityPreferencesStore = new Store({
      name: 'capability-preferences',
      defaults: { organizations: {} }
    });
  }
  return capabilityPreferencesStore;
}

function capabilityPreferenceScope(server) {
  const identity = server?.orgId || server?.url || 'unscoped';
  return encodeURIComponent(String(identity).slice(0, 500));
}

function getCapabilityPreferences(server = getSavedServer()) {
  if (!server) return {};
  const organizations = getCapabilityPreferencesStore().get('organizations', {});
  const preferences = organizations && organizations[capabilityPreferenceScope(server)];
  return preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? preferences : {};
}

function setCapabilityPreference(server, capabilityId, active) {
  const store = getCapabilityPreferencesStore();
  const organizations = store.get('organizations', {});
  const scope = capabilityPreferenceScope(server);
  const existing = organizations[scope] && typeof organizations[scope] === 'object'
    ? organizations[scope]
    : {};
  store.set('organizations', {
    ...organizations,
    [scope]: { ...existing, [capabilityId]: Boolean(active) }
  });
}

function currentCapabilityViewModels(server = getSavedServer()) {
  return capabilityViewModels(server, getCapabilityPreferences(server), process.platform).map((capability) => (
    capability.id === SCREEN_DICTION_APP_ID
      ? { ...capability, openAtLogin: Boolean(screenVoice?.getSettings().openAtLogin) }
      : capability
  ));
}

function syncScreenVoiceEntitlement(server = getSavedServer()) {
  const enabled = isCapabilityActive(
    server,
    SCREEN_DICTION_APP_ID,
    getCapabilityPreferences(server),
    process.platform
  );
  if (screenVoice) screenVoice.setEntitlementEnabled(enabled);
  return enabled;
}

function isScreenDictionEntitled(server = getSavedServer()) {
  return Boolean(server && capabilityItems(server).some((item) => (
    String(item.id || item.app_id || item.slug || item.key || '').trim() === SCREEN_DICTION_APP_ID
  )));
}

async function syncScreenVoiceAuthentication(window = mainWindow) {
  if (!screenVoice || !window || window.isDestroyed()) return false;
  let authenticated = false;
  try {
    // Return only a boolean across the process boundary. The bearer token is
    // never copied into main-process state or logs.
    authenticated = await window.webContents.executeJavaScript(`(() => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return false;
        if (token.indexOf('demo-token-') === 0) return true;
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return !payload.exp || payload.exp * 1000 > Date.now();
      } catch (_) { return false; }
    })()`, true);
  } catch (_) {
    authenticated = false;
  }
  if (window === mainWindow && !window.isDestroyed()) {
    screenVoice.setAuthenticated(authenticated === true);
  }
  return authenticated === true;
}

function watchScreenVoiceAuthentication(window) {
  window.webContents.on('did-finish-load', () => {
    syncScreenVoiceAuthentication(window).catch(() => {});
  });
}

// Session tracker instance
let sessionTracker = null;

/**
 * Create a file:// URL that works on all platforms (Windows, macOS, Linux)
 * Windows requires forward slashes and a leading slash before the drive letter
 * @param {string} filePath - Absolute path to the file
 * @returns {string} Properly formatted file:// URL
 */
function createFileUrl(filePath) {
  let normalizedPath = filePath;

  // On Windows, convert backslashes to forward slashes
  if (process.platform === 'win32') {
    normalizedPath = filePath.replace(/\\/g, '/');
    // Ensure path starts with / for proper file:///C:/... format
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }
  }

  return url.format({
    pathname: normalizedPath,
    protocol: 'file:',
    slashes: true
  });
}

function openScreenVoiceSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const settingsUrl = createFileUrl(path.join(__dirname, 'public_html/settings-v2.html'))
    + '?capability=screen-diction#capabilities';
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.loadURL(settingsUrl);
  return true;
}

const SCREEN_VOICE_CLIENT_ROUTES = new Set([
  'chat.html', 'matters.html', 'workspace-details.html', 'integrations/connectors.html', 'notifications.html'
]);

async function navigateScreenVoiceClient(input = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const route = String(input.route || '').trim().replace(/^\/+/, '');
  if (!SCREEN_VOICE_CLIENT_ROUTES.has(route)) throw new Error('Unsupported LANA destination');
  const target = new URL(createFileUrl(path.join(__dirname, 'public_html', route)));
  const matterId = String(input.matterId || '').trim();
  if (matterId) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(matterId)) throw new Error('Invalid matter identifier');
    if (route === 'workspace-details.html') target.searchParams.set('id', matterId);
    else target.searchParams.set('matter', matterId);
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  await mainWindow.loadURL(target.toString());
  return true;
}

async function openScreenVoiceResearchUrl(value) {
  const target = new URL(String(value || ''));
  const allowed = (target.hostname === 'www.google.com' && target.pathname === '/search')
    || (target.hostname === 'www.bing.com' && target.pathname === '/search');
  if (target.protocol !== 'https:' || !allowed || !target.searchParams.get('q')) {
    throw new Error('Only confirmed web-search URLs are supported');
  }
  await shell.openExternal(target.toString(), { activate: true });
  return true;
}

function notifyScreenVoiceInputRequired() {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title: 'LANA needs your input',
    body: 'Open the voice agent to review and respond.',
    silent: true
  });
  notification.on('click', () => {
    screenVoice?.showOverlay({ focus: true });
    screenVoice?.sendState();
  });
  notification.show();
  return true;
}

// Development mode: Bypass certificate errors for localhost
if (process.env.NODE_ENV === 'development') {
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    // Allow self-signed certificates for localhost in development
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      event.preventDefault();
      callback(true); // Trust the certificate
      logInfo(`[Development] Certificate error bypassed for: ${url}`);
    } else {
      callback(false); // Reject certificates from other domains
    }
  });
  logInfo('[Development] Certificate bypass enabled for localhost');
}

// Register protocol for deep links (lana-ai://).
//
// Behavior by platform:
//   - macOS dev (process.defaultApp + darwin):
//       SKIP registration entirely. Calling setAsDefaultProtocolClient here
//       (and especially the removeAsDefaultProtocolClient calls that precede
//       it) wipes the LanaAIDevHelper.app entry installed by install.sh,
//       handing routing back to the bare Electron.app which spawns a
//       welcome-screen window. The helper owns lana-ai:// in dev.
//   - Windows / Linux dev:
//       setAsDefaultProtocolClient(protocol, execPath, [appEntry]) writes
//       registry entries (Windows) or a .desktop record that include the
//       app entry path, so cold-start launches load electron-main.js. The
//       args parameter is honored on these platforms (unlike macOS).
//   - Packaged builds (process.defaultApp = false):
//       The protocol is declared in Info.plist (mac) / NSIS install (win) /
//       .desktop file (linux) by electron-builder. The runtime call here is
//       a defensive no-op that confirms the registration.
function registerDeepLinkProtocol() {
  const protocol = 'lana-ai';

  if (process.platform === 'darwin' && process.defaultApp) {
    logInfo(
      `[DeepLink] Skipping ${protocol}:// registration on macOS dev — ` +
        'routing is owned by LanaAIDevHelper.app (installed by install.sh)'
    );
    return;
  }

  if (process.defaultApp) {
    const appEntry = path.resolve(__dirname, 'electron-main.js');
    try {
      app.removeAsDefaultProtocolClient(protocol);
      app.removeAsDefaultProtocolClient(protocol, process.execPath, [appEntry]);
    } catch (_error) {
      // Best-effort cleanup only; registration below is the important step.
    }

    const registered = app.setAsDefaultProtocolClient(protocol, process.execPath, [appEntry]);
    logInfo(`[DeepLink] Registered ${protocol}:// for development`, {
      registered,
      execPath: process.execPath,
      appEntry
    });
    return;
  }

  const registered = app.setAsDefaultProtocolClient(protocol);
  logInfo(`[DeepLink] Registered ${protocol}://`, { registered });
}

registerDeepLinkProtocol();

// OAuth state management for CSRF protection
const pendingOAuthStates = new Map();
const OAUTH_STATE_TTL = 10 * 60 * 1000; // 10 minutes

function generateOAuthState() {
  const crypto = require('crypto');
  const state = crypto.randomBytes(32).toString('hex');
  pendingOAuthStates.set(state, Date.now());
  // Clean up expired states
  for (const [key, timestamp] of pendingOAuthStates) {
    if (Date.now() - timestamp > OAUTH_STATE_TTL) {
      pendingOAuthStates.delete(key);
    }
  }
  return state;
}

function validateOAuthState(state) {
  if (!state || !pendingOAuthStates.has(state)) {
    return false;
  }
  const timestamp = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  return (Date.now() - timestamp) < OAUTH_STATE_TTL;
}

function isBackendManagedOAuthState(state) {
  return /^[a-f0-9]{64}$/i.test(String(state || ''));
}

/**
 * Create the main application window
 * @param {string} serverUrl - Server URL to connect to
 */
function createWindow(serverUrl = null) {
  logInfo(`Creating main window with server: ${serverUrl || 'none'}`);

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, 'build/icons/icon-256.png'),
    webPreferences: {
      nodeIntegration: false, // Disable Node.js integration for security
      contextIsolation: true, // Enable context isolation for security
      preload: path.join(__dirname, 'electron-preload.js'), // Preload script for secure IPC
      sandbox: false, // Disable sandbox to allow file:// navigation
      webSecurity: false, // Disable for file:// protocol to work with absolute paths
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    },
    show: false // Don't show until ready (prevents flash of white screen)
  });
  watchScreenVoiceAuthentication(mainWindow);

  // Load the v2 dashboard as the entry point
  const startUrl = createFileUrl(path.join(__dirname, 'public_html/dashboard.html'));
  mainWindow.loadURL(startUrl);

  // Normalize DPI scaling on Windows high-DPI displays
  if (process.platform === 'win32') {
    const { screen } = require('electron');
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
    logInfo(`Windows display scale factor: ${scaleFactor}`);
    if (scaleFactor > 1) {
      mainWindow.webContents.setZoomFactor(1 / scaleFactor);
    }
    // Re-apply zoom after each page navigation (ensures it persists across redirects)
    mainWindow.webContents.on('did-finish-load', () => {
      if (scaleFactor > 1) {
        mainWindow.webContents.setZoomFactor(1 / scaleFactor);
      }
    });
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Configure auto-updater with GitHub release feed
    configureAutoUpdater();

    // Check for updates after window is shown
    setTimeout(() => {
      checkAndHandleUpdates(serverUrl);
    }, 5000); // Wait 5 seconds after launch
  });

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Create application menu
  createApplicationMenu();

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle window open requests
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow about:blank, blob:, data:, and empty URLs (for print preview and dynamic content)
    if (!url || url === '' || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:')) {
      return { action: 'allow' };
    }

    // Open external http/https links in system browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }

    // Allow all other URLs
    return { action: 'allow' };
  });
}

/**
 * Create login window
 * With hosted discovery, we go straight to login - org resolution happens there
 */
function createLoginWindow() {
  logInfo('Creating login window (hosted discovery mode)');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#f3f4f6',
    icon: path.join(__dirname, 'build/icons/icon-256.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js'),
      sandbox: false,
      webSecurity: false
    },
    show: false,
    resizable: true,
    frame: true,
    titleBarStyle: 'default'
  });
  watchScreenVoiceAuthentication(mainWindow);

  // Load login page directly
  const loginUrl = createFileUrl(path.join(__dirname, 'public_html/login.html'));
  mainWindow.loadURL(loginUrl);

  // Normalize DPI scaling on Windows high-DPI displays
  if (process.platform === 'win32') {
    const { screen } = require('electron');
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
    logInfo(`Windows login window display scale factor: ${scaleFactor}`);
    if (scaleFactor > 1) {
      mainWindow.webContents.setZoomFactor(1 / scaleFactor);
    }
    mainWindow.webContents.on('did-finish-load', () => {
      if (scaleFactor > 1) {
        mainWindow.webContents.setZoomFactor(1 / scaleFactor);
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Configure auto-updater and check for updates
    configureAutoUpdater();
    setTimeout(() => {
      logInfo('Login window: triggering update check...');
      checkAndHandleUpdates(null);
    }, 5000);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createApplicationMenu();

  // Handle window open requests
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow about:blank, blob:, data:, and empty URLs (for print preview and dynamic content)
    if (!url || url === '' || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:')) {
      return { action: 'allow' };
    }

    // Open external http/https links in system browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }

    // Allow all other URLs
    return { action: 'allow' };
  });
}

/**
 * Check for updates and handle based on policy
 * @param {string} serverUrl - Server URL
 * @param {{notifyUpToDate?: boolean}} [options] - notifyUpToDate: show a dialog
 *   when no update exists (manual checks only; startup checks stay silent)
 */
async function checkAndHandleUpdates(serverUrl, options = {}) {
  try {
    logInfo('Checking for updates...');

    // Get saved server to retrieve orgId
    const savedServer = getSavedServer();
    const orgId = savedServer?.orgId || null;

    const updateInfo = await checkForUpdates(serverUrl, null, orgId);

    // Keep the renderer informed either way — pages (admin Updates, banners)
    // listen on 'update-available' via electronAPI.onUpdateAvailable.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', updateInfo);
    }

    if (!updateInfo.updateAvailable) {
      logInfo('No updates available');
      if (options.notifyUpToDate) {
        dialog.showMessageBox(mainWindow || undefined, {
          type: 'info',
          title: 'Check for Updates',
          message: 'You’re up to date',
          detail: `Lana AI ${getAppVersion()} is the latest version available.`
        });
      }
      return;
    }

    // Handle force update
    if (updateInfo.updateRequired) {
      logInfo('Force update required');
      await showForceUpdateDialog(updateInfo, mainWindow);
      await downloadAndInstallUpdate(serverUrl, null, orgId);
      return;
    }

    // Handle optional update
    logInfo('Optional update available');
    const choice = await showOptionalUpdateDialog(updateInfo, mainWindow);

    if (choice === 'update') {
      await downloadAndInstallUpdate(serverUrl, null, orgId);
    } else if (choice === 'skip') {
      logInfo('User skipped update');
      // TODO: Store skipped version to not prompt again
    } else {
      logInfo('User chose to update later');
    }

  } catch (error) {
    logError('Failed to check/handle updates', error);
  }
}

/**
 * Create application menu
 */
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: process.platform === 'darwin' ? 'Cmd+[' : 'Alt+Left',
          click: () => {
            if (mainWindow && mainWindow.webContents.canGoBack()) {
              mainWindow.webContents.goBack();
            }
          }
        },
        {
          label: 'Forward',
          accelerator: process.platform === 'darwin' ? 'Cmd+]' : 'Alt+Right',
          click: () => {
            if (mainWindow && mainWindow.webContents.canGoForward()) {
              mainWindow.webContents.goForward();
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Lana AI',
              message: 'Lana AI Desktop Client',
              detail: `Version: ${getAppVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode: ${process.versions.node}`
            });
          }
        },
        {
          label: 'Check for Updates…',
          click: () => {
            const savedServer = getSavedServer();
            checkAndHandleUpdates(savedServer ? savedServer.url : null, { notifyUpToDate: true });
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        },
        {
          label: 'Export Debug Logs...',
          click: async () => {
            try {
              const logPath = exportLogs();
              const { shell } = require('electron');

              const result = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Debug Logs Exported',
                message: 'Debug logs have been exported',
                detail: `Log file saved to:\n${logPath}\n\nPlease share this file with support when reporting issues.`,
                buttons: ['Open Folder', 'Copy Path', 'Close'],
                defaultId: 0
              });

              if (result.response === 0) {
                // Open folder containing the log file
                shell.showItemInFolder(logPath);
              } else if (result.response === 1) {
                // Copy path to clipboard
                const { clipboard } = require('electron');
                clipboard.writeText(logPath);
              }
            } catch (error) {
              logError('Failed to export debug logs', error);
              dialog.showErrorBox('Export Failed', `Failed to export debug logs: ${error.message}`);
            }
          }
        }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * IPC Handlers - Secure communication between renderer and main process
 */

// Renderer logging - captures errors from web pages for debug export
ipcMain.handle('renderer-log-error', async (event, message, error) => {
  logError(`[Renderer] ${message}`, error ? { message: error.message, stack: error.stack } : null);
});

ipcMain.handle('renderer-log-info', async (event, message) => {
  logInfo(`[Renderer] ${message}`);
});

// Handle configuration requests
ipcMain.handle('get-config', async () => {
  return {
    appVersion: getAppVersion(),
    platform: process.platform,
    arch: process.arch,
    isDevelopment: process.env.NODE_ENV === 'development'
  };
});

// Handle secure storage operations
ipcMain.handle('save-settings', async (event, settings) => {
  const { saveServerConnection } = require('./electron-storage');
  const success = saveServerConnection(settings);
  if (success) syncScreenVoiceEntitlement(settings);
  return { success };
});

ipcMain.handle('load-settings', async () => {
  const { getSavedServer } = require('./electron-storage');
  return getSavedServer();
});

// Get app version - use centralized version system
ipcMain.handle('get-version', async () => {
  return getAppVersion();
});

// Connect to server (called after hosted discovery resolves org)
ipcMain.handle('connect-to-server', async (event, server) => {
  logInfo(`IPC: connect-to-server requested for ${server.orgName || server.orgId}`);
  try {
    // Save server connection
    saveServerConnection(server);
    syncScreenVoiceEntitlement(server);

    // Resize window for main app view
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSize(1400, 900);
      mainWindow.center();
    }

    return { success: true };
  } catch (error) {
    logError('IPC: connect-to-server failed', error);
    return { success: false, error: error.message };
  }
});

// Verify server connection
ipcMain.handle('verify-server', async (event, serverUrl) => {
  logInfo(`IPC: verify-server for ${serverUrl}`);
  try {
    const result = await verifyServer(serverUrl);
    return { success: result !== null, server: result };
  } catch (error) {
    logError('IPC: verify-server failed', error);
    return { success: false, error: error.message };
  }
});

// Get saved server
ipcMain.handle('get-saved-server', async () => {
  try {
    const server = getSavedServer();
    return { success: true, server };
  } catch (error) {
    logError('IPC: get-saved-server failed', error);
    return { success: false, error: error.message };
  }
});

// Capabilities are organization entitlements supplied by discovery. Users may
// activate/deactivate optional capabilities on this device, but cannot create
// an entitlement or disable a capability marked required by the server.
ipcMain.handle('capabilities:list', async () => {
  try {
    return { success: true, platform: process.platform, capabilities: currentCapabilityViewModels() };
  } catch (error) {
    logError('[Capabilities] Failed to list capabilities', error);
    return { success: false, error: 'Capabilities could not be loaded.' };
  }
});

ipcMain.handle('capabilities:set-active', async (_event, payload) => {
  try {
    const server = getSavedServer();
    const id = typeof payload?.id === 'string' ? payload.id.trim().slice(0, 120) : '';
    const active = payload?.active;
    if (!server || !id || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(id) || typeof active !== 'boolean') {
      return { success: false, error: 'Invalid capability setting.' };
    }

    const entitled = capabilityItems(server).find((item) => (
      String(item.id || item.app_id || item.slug || item.key || '').trim() === id
    ));
    if (!entitled) return { success: false, error: 'This capability is not enabled for your organization.' };
    if (entitled.route?.meta?.required === true && active === false) {
      return { success: false, error: 'This capability is required by your organization.' };
    }

    const view = currentCapabilityViewModels(server).find((item) => item.id === id);
    if (!view?.available && active) {
      return { success: false, error: 'This capability is not available on this platform.' };
    }

    setCapabilityPreference(server, id, active);
    syncScreenVoiceEntitlement(server);
    return { success: true, platform: process.platform, capabilities: currentCapabilityViewModels(server) };
  } catch (error) {
    logError('[Capabilities] Failed to update capability', error);
    return { success: false, error: 'The capability setting could not be saved.' };
  }
});

ipcMain.handle('capabilities:set-open-at-login', async (_event, payload) => {
  try {
    const server = getSavedServer();
    if (!isScreenDictionEntitled(server)) return { success: false, error: 'The LANA Voice Agent is not enabled for your organization.' };
    if (!screenVoice || typeof payload?.openAtLogin !== 'boolean') {
      return { success: false, error: 'Open at Login is not available on this platform.' };
    }
    screenVoice.setOpenAtLogin(payload.openAtLogin);
    return { success: true, platform: process.platform, capabilities: currentCapabilityViewModels(server) };
  } catch (error) {
    logError('[Capabilities] Failed to update Open at Login', error);
    return { success: false, error: 'Open at Login could not be saved.' };
  }
});

ipcMain.handle('capabilities:get-voice-settings', async () => {
  if (!isScreenDictionEntitled()) return { success: false, error: 'The LANA Voice Agent is not enabled for your organization.' };
  if (!screenVoice) return { success: false, error: 'The LANA Voice Agent is not available on this platform.' };
  return { success: true, settings: screenVoice.getSettings() };
});

ipcMain.handle('capabilities:set-voice-settings', async (_event, payload) => {
  try {
    if (!isScreenDictionEntitled()) return { success: false, error: 'The LANA Voice Agent is not enabled for your organization.' };
    if (!screenVoice || !payload?.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
      return { success: false, error: 'Invalid voice agent settings.' };
    }
    const result = screenVoice.saveSettings(payload.settings);
    return { success: true, settings: result.settings, capabilities: currentCapabilityViewModels() };
  } catch (error) {
    logError('[Capabilities] Failed to update voice agent settings', error);
    return { success: false, error: 'Voice agent settings could not be saved.' };
  }
});

ipcMain.handle('capabilities:get-voice-permissions', async () => {
  if (!isScreenDictionEntitled()) return { success: false, error: 'The LANA Voice Agent is not enabled for your organization.' };
  if (!screenVoice) return { success: false, error: 'The LANA Voice Agent is not available on this platform.' };
  try { return { success: true, permissions: await screenVoice.permissionStatus() }; }
  catch (_) { return { success: false, error: 'Permission status is temporarily unavailable.' }; }
});

ipcMain.handle('capabilities:request-voice-permission', async (_event, payload) => {
  const type = payload?.type;
  if (!isScreenDictionEntitled()) return { success: false, error: 'The LANA Voice Agent is not enabled for your organization.' };
  if (!screenVoice || !['microphone', 'accessibility'].includes(type)) {
    return { success: false, error: 'Invalid permission request.' };
  }
  try { return { success: true, permissions: await screenVoice.requestPermission(type) }; }
  catch (_) { return { success: false, error: 'The permission request could not be opened.' }; }
});

const OWNED_WEB_ENDPOINTS = Object.freeze({
  health: { method: 'GET', path: '/api/v1/web/health' },
  capabilities: { method: 'GET', path: '/api/v1/web/capabilities' },
  search: { method: 'POST', path: '/api/v1/web/search' },
  read: { method: 'POST', path: '/api/v1/web/read' },
  crawlStart: { method: 'POST', path: '/api/v1/web/crawls' },
  browserSession: { method: 'POST', path: '/api/v1/web/browser/sessions' },
  browserTask: { method: 'POST', path: '/api/v1/web/browser/tasks' },
  browserPreview: { method: 'POST', path: null },
  browserExecute: { method: 'POST', path: null }
});

async function getRendererAuthToken() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return null;
  return mainWindow.webContents.executeJavaScript(
    "(() => { try { return window.localStorage.getItem('token') || window.localStorage.getItem('lana_auth_token') || null; } catch (_) { return null; } })()",
    true
  );
}

function assertOwnedWebSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('unauthorized_sender');
  }
}

function getOwnedWebDesktopBrowser() {
  if (!ownedWebDesktopBrowser) {
    ownedWebDesktopBrowser = new OwnedWebDesktopBrowserManager({
      BrowserWindow,
      dialog,
      app,
      assertSender: assertOwnedWebSender
    });
  }
  return ownedWebDesktopBrowser;
}

function ownedWebBaseUrl() {
  const server = getSavedServer();
  const base = server && (server.url || server.serverUrl);
  if (!base) throw new Error('backend_not_configured');
  return String(base).replace(/\/+$/, '');
}

async function callOwnedWebBackend(event, endpoint, payload) {
  assertOwnedWebSender(event);
  const token = await getRendererAuthToken();
  if (!token) return { success: false, error: 'Not authenticated.' };
  const url = ownedWebBaseUrl() + endpoint.path;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Lana-Surface': 'desktop'
  };
  const response = await fetch(url, {
    method: endpoint.method,
    headers,
    body: endpoint.method === 'GET' ? undefined : JSON.stringify(payload || {})
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      success: false,
      error: body.error?.message || body.message || `HTTP ${response.status}`,
      code: body.error?.code || null
    };
  }
  return body;
}

function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
}

ipcMain.handle('owned-web:health', async (event) => {
  try { return await callOwnedWebBackend(event, OWNED_WEB_ENDPOINTS.health); }
  catch (error) { return { success: false, error: String(error.message || error) }; }
});

ipcMain.handle('owned-web:capabilities', async (event) => {
  try { return await callOwnedWebBackend(event, OWNED_WEB_ENDPOINTS.capabilities); }
  catch (error) { return { success: false, error: String(error.message || error) }; }
});

ipcMain.handle('owned-web:search', async (event, payload) => {
  try {
    const body = {
      query: String(payload?.query || '').slice(0, 500),
      limit: payload?.limit ? Number(payload.limit) : undefined,
      matterId: payload?.matterId ? String(payload.matterId).slice(0, 128) : undefined
    };
    return await callOwnedWebBackend(event, OWNED_WEB_ENDPOINTS.search, body);
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:read', async (event, payload) => {
  try {
    return await callOwnedWebBackend(event, OWNED_WEB_ENDPOINTS.read, {
      url: String(payload?.url || '').slice(0, 4096),
      matterId: payload?.matterId ? String(payload.matterId).slice(0, 128) : undefined
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:crawl:start', async (event, payload) => {
  try {
    const seedUrls = Array.isArray(payload?.seedUrls) ? payload.seedUrls.slice(0, 25).map((entry) => String(entry).slice(0, 4096)) : [];
    return await callOwnedWebBackend(event, OWNED_WEB_ENDPOINTS.crawlStart, {
      seedUrls,
      maxDepth: payload?.maxDepth == null ? undefined : Number(payload.maxDepth),
      maxPages: payload?.maxPages == null ? undefined : Number(payload.maxPages),
      matterId: payload?.matterId ? String(payload.matterId).slice(0, 128) : undefined
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:crawl:status', async (event, payload) => {
  try {
    if (!validId(payload?.crawlId)) return { success: false, error: 'Invalid crawl id.' };
    return await callOwnedWebBackend(event, { method: 'GET', path: `/api/v1/web/crawls/${encodeURIComponent(payload.crawlId)}` });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:crawl:cancel', async (event, payload) => {
  try {
    if (!validId(payload?.crawlId)) return { success: false, error: 'Invalid crawl id.' };
    return await callOwnedWebBackend(event, { method: 'POST', path: `/api/v1/web/crawls/${encodeURIComponent(payload.crawlId)}/cancel` }, {});
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:crawl:results', async (event, payload) => {
  try {
    if (!validId(payload?.crawlId)) return { success: false, error: 'Invalid crawl id.' };
    const params = new URLSearchParams();
    if (payload?.limit != null) params.set('limit', String(Math.min(Number(payload.limit) || 100, 500)));
    if (payload?.offset != null) params.set('offset', String(Math.max(Number(payload.offset) || 0, 0)));
    if (payload?.includeFailures != null) params.set('includeFailures', payload.includeFailures ? 'true' : 'false');
    const query = params.toString();
    return await callOwnedWebBackend(event, {
      method: 'GET',
      path: `/api/v1/web/crawls/${encodeURIComponent(payload.crawlId)}/results${query ? `?${query}` : ''}`
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:document:ingest', async (event, payload) => {
  try {
    if (!validId(payload?.documentId)) return { success: false, error: 'Invalid document id.' };
    return await callOwnedWebBackend(event, {
      method: 'POST',
      path: `/api/v1/web/documents/${encodeURIComponent(payload.documentId)}/ingest`
    }, {
      matterId: payload?.matterId ? String(payload.matterId).slice(0, 128) : undefined,
      classification: payload?.classification ? String(payload.classification).slice(0, 128) : undefined
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:browser:session:open', async (event, payload) => {
  try {
    if (payload?.executionTarget === 'desktop_local') {
      const session = await getOwnedWebDesktopBrowser().openSession(event, payload || {});
      return { success: true, data: session };
    }
    return await callOwnedWebBackend(event, OWNED_WEB_ENDPOINTS.browserSession, {
      executionTarget: payload?.executionTarget || 'server_isolated',
      allowedOrigins: Array.isArray(payload?.allowedOrigins) ? payload.allowedOrigins.slice(0, 25) : undefined,
      matterId: payload?.matterId ? String(payload.matterId).slice(0, 128) : undefined,
      persistAuthenticationState: Boolean(payload?.persistAuthenticationState),
      idempotencyKey: payload?.idempotencyKey ? String(payload.idempotencyKey).slice(0, 256) : undefined
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:browser:snapshot', async (event, payload) => {
  try {
    if (!validId(payload?.sessionId)) return { success: false, error: 'Invalid browser session id.' };
    if (getOwnedWebDesktopBrowser().hasSession(payload.sessionId)) {
      return await getOwnedWebDesktopBrowser().snapshot(event, payload.sessionId);
    }
    return await callOwnedWebBackend(event, {
      method: 'POST',
      path: `/api/v1/web/browser/sessions/${encodeURIComponent(payload.sessionId)}/snapshot`
    }, {});
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:browser:preview', async (event, payload) => {
  try {
    if (!validId(payload?.sessionId)) return { success: false, error: 'Invalid browser session id.' };
    if (getOwnedWebDesktopBrowser().hasSession(payload.sessionId)) {
      return await getOwnedWebDesktopBrowser().previewAction(event, payload.sessionId, payload?.action || {});
    }
    return await callOwnedWebBackend(event, {
      method: 'POST',
      path: `/api/v1/web/browser/sessions/${encodeURIComponent(payload.sessionId)}/actions/preview`
    }, { action: payload?.action || {} });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:browser:execute', async (event, payload) => {
  try {
    if (!validId(payload?.sessionId)) return { success: false, error: 'Invalid browser session id.' };
    if (getOwnedWebDesktopBrowser().hasSession(payload.sessionId)) {
      return await getOwnedWebDesktopBrowser().executeAction(event, payload.sessionId, payload?.action || {});
    }
    return await callOwnedWebBackend(event, {
      method: 'POST',
      path: `/api/v1/web/browser/sessions/${encodeURIComponent(payload.sessionId)}/actions`
    }, { action: payload?.action || {} });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:approval:decide', async (event, payload) => {
  try {
    if (!validId(payload?.approvalId)) return { success: false, error: 'Invalid approval id.' };
    if (String(payload.approvalId).startsWith('desktop_approval_')) {
      return await getOwnedWebDesktopBrowser().decideApproval(event, payload.approvalId, payload?.decision);
    }
    return await callOwnedWebBackend(event, {
      method: 'POST',
      path: `/api/v1/web/approvals/${encodeURIComponent(payload.approvalId)}/decision`
    }, {
      decision: payload?.decision === 'denied' ? 'denied' : 'approved'
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:browser:task', async (event, payload) => {
  try {
    return await callOwnedWebBackend(event, OWNED_WEB_ENDPOINTS.browserTask, {
      goal: String(payload?.goal || '').slice(0, 4000),
      startUrl: payload?.startUrl ? String(payload.startUrl).slice(0, 4096) : undefined,
      allowedOrigins: Array.isArray(payload?.allowedOrigins) ? payload.allowedOrigins.slice(0, 25) : undefined,
      sessionId: payload?.sessionId ? String(payload.sessionId).slice(0, 128) : undefined,
      maxSteps: payload?.maxSteps == null ? undefined : Number(payload.maxSteps),
      matterId: payload?.matterId ? String(payload.matterId).slice(0, 128) : undefined,
      idempotencyKey: payload?.idempotencyKey ? String(payload.idempotencyKey).slice(0, 256) : undefined
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

ipcMain.handle('owned-web:upload:choose', async (event, payload) => {
  try { return await getOwnedWebDesktopBrowser().chooseUploadFiles(event, payload || {}); }
  catch (error) { return { success: false, error: String(error.message || error) }; }
});

ipcMain.handle('owned-web:browser:close', async (event, payload) => {
  try {
    if (!validId(payload?.sessionId)) return { success: false, error: 'Invalid browser session id.' };
    if (getOwnedWebDesktopBrowser().hasSession(payload.sessionId)) {
      return await getOwnedWebDesktopBrowser().closeSession(event, payload.sessionId);
    }
    return await callOwnedWebBackend(event, {
      method: 'DELETE',
      path: `/api/v1/web/browser/sessions/${encodeURIComponent(payload.sessionId)}`
    });
  } catch (error) {
    return { success: false, error: String(error.message || error) };
  }
});

// Clear saved server (logout)
ipcMain.handle('clear-saved-server', async () => {
  try {
    clearSavedServer();
    syncScreenVoiceEntitlement(null);
    return { success: true };
  } catch (error) {
    logError('IPC: clear-saved-server failed', error);
    return { success: false, error: error.message };
  }
});


// Session Tracking IPC Handlers
// Initialize session tracker with backend URL and auth token
ipcMain.handle('session-tracker:initialize', async (event, backendUrl, authToken) => {
  try {
    if (sessionTracker && backendUrl && authToken) {
      sessionTracker.initialize(backendUrl, authToken);
      logInfo('[SessionTracker] Initialized with backend URL');
      return { success: true };
    } else {
      return { success: false, error: 'Missing backend URL or auth token' };
    }
  } catch (error) {
    logError('[SessionTracker] Failed to initialize:', error);
    return { success: false, error: error.message };
  }
});


// Check for updates
// Open URL in system browser (used by update dialog for manual download)
ipcMain.handle('open-external-url', async (event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
  return true;
});

// ───────────────────────────────────────────────────────────────────────────
// Brainchild MCP bridge — renderer-facing read API (thin; spawn/IPC only here)
// ───────────────────────────────────────────────────────────────────────────

// Auto-discover an install + vault from OS defaults. Pure-helper backed.
ipcMain.handle('brainchild:discover', async () => {
  try {
    return { success: true, ...discover() };
  } catch (error) {
    logError('[electron-main] brainchild:discover failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

// Establish + persist the link, then validate. Communicate via MCP only AFTER
// the link is persisted and verified.
ipcMain.handle('brainchild:link', async (_event, payload) => {
  try {
    const link = {
      installPath: (payload && payload.installPath) || '',
      vaultPath: (payload && payload.vaultPath) || ''
    };
    const checks = validateLink(link);
    // Honor either an OS-default candidate root (checks.installAllowed) or a root
    // the user explicitly chose via the native picker this session. A bare
    // renderer-passed string outside both sets is rejected before any spawn.
    const picked = link.installPath &&
      brainchildPickedInstallRoots.has(require('path').resolve(link.installPath));
    if (!checks.installAllowed && !picked) {
      return { success: false, error: 'install_not_allowed' };
    }
    // installValid folds the allowlist in; for a picked root, fall back to a
    // direct existence check of bin/brainchild-mcp.js.
    const fs = require('fs');
    const installExists = checks.installValid ||
      (picked && checks.mcpBin && fs.existsSync(checks.mcpBin));
    if (!installExists) {
      return { success: false, error: 'install_not_found' };
    }
    // Mirror the install-root trust model for the vault: honor either an
    // OS-default vault candidate OR a vault the user explicitly chose via the
    // native picker this session. A bare renderer-passed string outside both
    // sets is rejected before any spawn / file read.
    const vaultPicked = link.vaultPath &&
      brainchildPickedVaultRoots.has(require('path').resolve(link.vaultPath));
    if (!isAllowedVaultRoot(link.vaultPath) && !vaultPicked) {
      return { success: false, error: 'vault_not_allowed' };
    }
    if (!checks.vaultValid) {
      return { success: false, error: 'vault_not_found' };
    }
    saveBrainchildLink({ installPath: link.installPath, vaultPath: link.vaultPath, verified: true });
    // An explicit Connect clears any prior auto-bind suppression so discovery is
    // allowed to bind again after a future unlink/re-link.
    setBrainchildAutoBindDisabled(false);
    return { success: true, status: brainchildManager.getStatus() };
  } catch (error) {
    logError('[electron-main] brainchild:link failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

ipcMain.handle('brainchild:status', async () => {
  try {
    return { success: true, ...brainchildManager.getStatus() };
  } catch (error) {
    logError('[electron-main] brainchild:status failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

ipcMain.handle('brainchild:listNotes', async (_event, payload) => {
  try {
    const args = {};
    if (payload && payload.filter) args.filter = String(payload.filter);
    const out = await brainchildManager.call('list_notes', args);
    return { success: true, notes: Array.isArray(out.notes) ? out.notes : [], count: out.count || 0 };
  } catch (error) {
    logError('[electron-main] brainchild:listNotes failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

ipcMain.handle('brainchild:search', async (_event, payload) => {
  try {
    const args = { query: (payload && payload.query) || '' };
    if (payload && payload.limit) args.limit = Number(payload.limit);
    const out = await brainchildManager.call('search', args);
    return { success: true, results: Array.isArray(out.results) ? out.results : [] };
  } catch (error) {
    logError('[electron-main] brainchild:search failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

ipcMain.handle('brainchild:getNote', async (_event, payload) => {
  try {
    const notePath = (payload && payload.path) || '';
    if (!notePath) return { success: false, error: 'missing_path' };
    const note = await brainchildManager.call('get_note', { path: notePath });
    return { success: true, note };
  } catch (error) {
    logError('[electron-main] brainchild:getNote failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

// Native folder picker for the Brainchild INSTALL root. The chosen directory
// must contain bin/brainchild-mcp.js (the install we will spawn Node against).
// Path entry stays main-chosen (dialog) rather than renderer-passed, so the
// renderer never supplies an arbitrary install path. Returns the resolved
// install root for the renderer to pass back to brainchild:link.
ipcMain.handle('brainchild:pickInstall', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Choose your Brainchild install folder',
      properties: ['openDirectory'],
      message: 'Select the Brainchild app folder (contains bin/brainchild-mcp.js).'
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return { success: false, canceled: true };
    }
    const installPath = result.filePaths[0];
    const fs = require('fs');
    const mcpBin = mcpBinForRoot(installPath);
    if (!fs.existsSync(mcpBin)) {
      return { success: false, error: 'install_not_found', installPath };
    }
    // Trust this user-picked root for subsequent brainchild:link in this session.
    brainchildPickedInstallRoots.add(require('path').resolve(installPath));
    return { success: true, installPath, mcpBin };
  } catch (error) {
    logError('[electron-main] brainchild:pickInstall failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

// Native folder picker for the Brainchild VAULT directory. Returns the chosen
// path for the renderer to pass to brainchild:link as vaultPath.
ipcMain.handle('brainchild:pickVault', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Choose your Brainchild vault folder',
      properties: ['openDirectory'],
      message: 'Select the folder that holds your Brainchild notes.'
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return { success: false, canceled: true };
    }
    // Trust this user-picked vault for subsequent brainchild:link in this session.
    brainchildPickedVaultRoots.add(require('path').resolve(result.filePaths[0]));
    return { success: true, vaultPath: result.filePaths[0] };
  } catch (error) {
    logError('[electron-main] brainchild:pickVault failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

// Unlink: stop the MCP child, forget the persisted link, and suppress auto-bind
// so discovery does not instantly re-bind the handshake vault. Backed by
// clearBrainchildLink() + setBrainchildAutoBindDisabled() in electron-storage.
ipcMain.handle('brainchild:unlink', async () => {
  try {
    brainchildManager.stop();
    clearBrainchildLink();
    // Persist suppression so auto-bind does not immediately re-bind the
    // handshake-discovered vault. Explicit Connect clears this flag.
    setBrainchildAutoBindDisabled(true);
    return { success: true, status: brainchildManager.getStatus() };
  } catch (error) {
    logError('[electron-main] brainchild:unlink failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

// Reveal a vault note in the OS file manager. The always-available fallback for
// "Open in Brainchild": resolve the vault-relative note path against the linked
// vault root and show it in Finder/Explorer. The note path is constrained to the
// linked vault (no traversal outside it) before revealing.
ipcMain.handle('brainchild:revealNote', async (_event, payload) => {
  try {
    const link = getBrainchildLink();
    if (!link || !link.vaultPath) return { success: false, error: 'not_linked' };
    const notePath = (payload && payload.path) || '';
    if (!notePath) return { success: false, error: 'missing_path' };
    const path = require('path');
    const fs = require('fs');
    const vaultRoot = path.resolve(link.vaultPath);
    const resolved = path.resolve(vaultRoot, notePath);
    // Containment check: the resolved file must stay inside the vault root.
    if (resolved !== vaultRoot && !resolved.startsWith(vaultRoot + path.sep)) {
      return { success: false, error: 'path_outside_vault' };
    }
    const { shell } = require('electron');
    if (fs.existsSync(resolved)) {
      shell.showItemInFolder(resolved);
      return { success: true, revealed: resolved };
    }
    // File not on disk — fall back to opening the vault root.
    await shell.openPath(vaultRoot);
    return { success: true, revealed: vaultRoot };
  } catch (error) {
    logError('[electron-main] brainchild:revealNote failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

ipcMain.handle('generate-oauth-state', async () => {
  return generateOAuthState();
});

/**
 * OAuth State Management - Backend-based
 * Creates state token in backend database for CSRF protection
 */
ipcMain.handle('create-oauth-state', async (event, { provider, connectorId, matterId }) => {
  try {
    const savedServer = getSavedServer();
    if (!savedServer || !savedServer.serverUrl) {
      throw new Error('No server connection found');
    }

    const baseUrl = savedServer.serverUrl;
    const authToken = savedServer.authToken;

    if (!authToken) {
      throw new Error('No authentication token found');
    }

    // Call backend to create state token
    const response = await fetch(`${baseUrl}/api/v1/integrations/oauth/states`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        provider,
        connector_id: connectorId,
        matter_id: matterId
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    logInfo(`OAuth state created for provider: ${provider}, state: ${data.state.substring(0, 8)}...`);

    return { success: true, state: data.state };
  } catch (error) {
    logError('Failed to create OAuth state', error);
    return { success: false, error: error.message };
  }
});

/**
 * OAuth Code Exchange - Backend-based
 * Exchanges authorization code for tokens via backend
 */
ipcMain.handle('exchange-oauth-code', async (event, { code, state, provider, connectorId, redirectUri, realmId }) => {
  try {
    const savedServer = getSavedServer();
    if (!savedServer || !savedServer.serverUrl) {
      throw new Error('No server connection found');
    }

    const baseUrl = savedServer.serverUrl;
    const authToken = savedServer.authToken;

    if (!authToken) {
      throw new Error('No authentication token found');
    }

    // Call backend to exchange code for tokens
    const response = await fetch(`${baseUrl}/api/v1/integrations/oauth/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        code,
        state,
        provider,
        connectorId: connectorId || provider,
        redirectUri: redirectUri || `${baseUrl}/api/v1/integrations/oauth/callback`,
        realmId: realmId || null
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    logInfo(`OAuth code exchanged successfully for provider: ${provider}`);

    return { success: true, data };
  } catch (error) {
    logError('Failed to exchange OAuth code', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-updates', async (event, serverUrl) => {
  try {
    // Get saved server to retrieve orgId
    const savedServer = getSavedServer();
    const orgId = savedServer?.orgId || null;

    const updateInfo = await checkForUpdates(serverUrl, null, orgId);
    return { success: true, updateInfo };
  } catch (error) {
    logError('IPC: check-updates failed', error);
    return { success: false, error: error.message };
  }
});

// Download and install update
ipcMain.handle('install-update', async (event, serverUrl) => {
  try {
    // Get saved server to retrieve orgId
    const savedServer = getSavedServer();
    const orgId = savedServer?.orgId || null;

    const result = await downloadAndInstallUpdate(serverUrl, null, orgId);
    return { success: result };
  } catch (error) {
    logError('IPC: install-update failed', error);
    return { success: false, error: error.message };
  }
});

/**
 * VPN Key Management IPC Handlers
 * Uses electron-store for secure local storage of VPN keys
 */
const vpnStore = new Store({ name: 'vpn-keys', encryptionKey: 'lana-vpn-secure-store' });

// Generate WireGuard keypair using X25519
ipcMain.handle('vpn-generate-keypair', async () => {
  try {
    // Generate X25519 keypair using Node.js crypto
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });

    // Extract raw keys (X25519 keys are 32 bytes)
    // SPKI format: 12 bytes header + 32 bytes key
    // PKCS8 format: 16 bytes header + 32 bytes key
    const rawPublicKey = publicKey.slice(-32);
    const rawPrivateKey = privateKey.slice(-32);

    return {
      publicKey: rawPublicKey.toString('base64'),
      privateKey: rawPrivateKey.toString('base64')
    };
  } catch (error) {
    logError('VPN keypair generation failed', error);
    throw error;
  }
});

// Save VPN keys to secure storage
ipcMain.handle('vpn-save-keys', async (event, keys) => {
  try {
    vpnStore.set('keys', keys);
    logInfo('VPN keys saved to secure storage');
    return { success: true };
  } catch (error) {
    logError('Failed to save VPN keys', error);
    return { success: false, error: error.message };
  }
});

// Load VPN keys from secure storage
ipcMain.handle('vpn-load-keys', async () => {
  try {
    const keys = vpnStore.get('keys');
    return keys || null;
  } catch (error) {
    logError('Failed to load VPN keys', error);
    return null;
  }
});

// Clear VPN keys from secure storage
ipcMain.handle('vpn-clear-keys', async () => {
  try {
    vpnStore.delete('keys');
    vpnStore.delete('deviceId');
    logInfo('VPN keys cleared from secure storage');
    return { success: true };
  } catch (error) {
    logError('Failed to clear VPN keys', error);
    return { success: false, error: error.message };
  }
});

// Get or create device ID
ipcMain.handle('vpn-get-device-id', async () => {
  try {
    let deviceId = vpnStore.get('deviceId');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      vpnStore.set('deviceId', deviceId);
    }
    return deviceId;
  } catch (error) {
    logError('Failed to get device ID', error);
    return crypto.randomUUID(); // Fallback to random UUID
  }
});

/**
 * Connected Apps (Companion Bridge consents) IPC Handlers
 *
 * These read/write the same `bridge-consents` electron-store file that
 * `electron-bridge.js` consults on every incoming token request. Revocation
 * here takes effect on the very next bridge request — the bridge re-reads
 * the file each time and does not keep an in-memory cache.
 *
 * Shape stored under the top-level `consents` key:
 *   { '<app-name>': { mode, granted_at, granted_user_id } }
 *
 * Note: granted_user_id is treated as semi-sensitive — never log it.
 */
const bridgeConsentsStore = new Store({
  name: 'bridge-consents',
  defaults: { consents: {} }
});

ipcMain.handle('settings:list-bridge-consents', async () => {
  try {
    const consents = bridgeConsentsStore.get('consents', {}) || {};
    return consents;
  } catch (error) {
    logError('[settings] Failed to list bridge consents', error);
    return {};
  }
});

ipcMain.handle('settings:revoke-bridge-consent', async (_event, payload) => {
  const app = payload && typeof payload.app === 'string' ? payload.app.trim() : '';
  if (!app) {
    return { ok: false, message: 'app name is required' };
  }
  try {
    const all = bridgeConsentsStore.get('consents', {}) || {};
    const removed = Object.prototype.hasOwnProperty.call(all, app);
    if (removed) {
      delete all[app];
      bridgeConsentsStore.set('consents', all);
      logInfo(`[settings] Revoked bridge consent for ${app}`);
    }
    return { ok: true, removed };
  } catch (error) {
    logError('[settings] Failed to revoke bridge consent', error);
    return { ok: false, message: error.message || 'Failed to revoke consent' };
  }
});

/**
 * Handle deep links (lana-ai://...)
 * Routes incoming URLs to the appropriate handler based on path.
 *
 * Supported routes:
 *   lana-ai://connect/<org-id>           — Pre-fill org on login
 *   lana-ai://oauth/callback?provider=X  — OAuth redirect callback
 */
const handleDeepLink = async (deepLinkUrl) => {
  logInfo(`Deep link received: ${deepLinkUrl}`);

  try {
    const urlObj = new URL(deepLinkUrl);
    // urlObj.hostname gives the first path segment for custom schemes
    // e.g. lana-ai://oauth/callback -> hostname='oauth', pathname='/callback'
    const route = urlObj.hostname;

    switch (route) {
      case 'oauth':
        handleOAuthCallback(urlObj);
        break;
      case 'connect':
        handleConnectLink(urlObj);
        break;
      default:
        logInfo(`Unknown deep link route: ${route}`);
        break;
    }
  } catch (error) {
    logError('Failed to handle deep link', error);
    dialog.showErrorBox('Error', 'Failed to process the link.');
  }
};

/**
 * Handle OAuth callback deep links
 * lana-ai://oauth/callback?provider=quickbooks&code=ABC&state=XYZ
 */
const handleOAuthCallback = (urlObj) => {
  const params = urlObj.searchParams;
  const provider = params.get('provider');
  const code = params.get('code');
  const state = params.get('state');
  const connectorId = params.get('connector_id') || params.get('connectorId');
  const realmId = params.get('realmId') || params.get('realm_id');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  logInfo(`OAuth callback: provider=${provider}, hasCode=${!!code}, hasError=${!!error}`);

  // Validate state for CSRF protection
  if (state && !validateOAuthState(state) && !isBackendManagedOAuthState(state)) {
    logError('OAuth state validation failed — possible CSRF');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oauth-callback', {
        provider,
        connector_id: connectorId,
        error: 'state_mismatch',
        error_description: 'OAuth state validation failed. Please try again.'
      });
    }
    return;
  }

  // Focus the app window
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('oauth-callback', {
      provider,
      connector_id: connectorId,
      code,
      state,
      realmId,
      error,
      error_description: errorDescription
    });
  } else {
    logError('OAuth callback received but no main window available');
  }
};

/**
 * Handle connect deep links
 * lana-ai://connect/<org-id>
 */
const handleConnectLink = (urlObj) => {
  const orgId = urlObj.pathname.replace(/^\/+/, '');

  if (!orgId) {
    logError('No org ID in connect deep link');
    dialog.showErrorBox('Connection Error', 'Invalid connection link.');
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.executeJavaScript(`
      if (document.getElementById('orgId')) {
        document.getElementById('orgId').value = '${orgId}';
      }
    `);
  } else {
    createLoginWindow();
  }
};

// Handle deep links on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Handle deep links on Windows/Linux (when app is launched)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    
    // Check for deep link in command line
    const url = commandLine.find(arg => arg.startsWith('lana-ai://'));
    if (url) {
      handleDeepLink(url);
    }
  });
}

/**
 * Application lifecycle events
 */

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  logInfo('App ready, starting thin client initialization...');

  // macOS dock icon. On packaged builds Electron reads from the .app bundle's
  // Contents/Resources/electron.icns; in dev that path is Electron's default
  // (the lava lamp), so we override at runtime. BrowserWindow.icon is
  // ignored on macOS so this is the only path that works for dev runs.
  applyDockIcon();

  // Version migration: Clear server config to ensure fresh discovery with correct static_ip
  // This fixes issues where old versions saved incorrect IPs (e.g., link-local addresses)
  const { getAllData, clearSavedServer: clearServerConfig } = require('./electron-storage');
  const Store = require('electron-store');
  const migrationStore = new Store({ name: 'migration-state' });

  // Get semantic version for comparison (e.g., "3.0.0" without "v" or release type)
  let currentVersion;
  try {
    const versionModule = require('./src/version.js');
    currentVersion = versionModule.version; // Use semantic version for comparisons
  } catch (e) {
    currentVersion = app.getVersion();
  }
  const lastVersion = migrationStore.get('lastVersion', '0.0.0');

  // Migration: Version 1.0.1+ uses static_ip from TXT record for discovery
  // Clear server config when upgrading from older versions that may have saved incorrect IPs
  const discoveryVersion = migrationStore.get('discoveryVersion', '0');
  const CURRENT_DISCOVERY_VERSION = '3'; // Increment when discovery logic changes (3 = two-step login flow)

  if (discoveryVersion !== CURRENT_DISCOVERY_VERSION) {
    logInfo(`Discovery logic updated (${discoveryVersion} -> ${CURRENT_DISCOVERY_VERSION}), clearing saved server config...`);
    const { clearAllData } = require('./electron-storage');
    clearAllData();
    migrationStore.set('discoveryVersion', CURRENT_DISCOVERY_VERSION);
  }

  // Track version for future migrations
  if (lastVersion !== currentVersion) {
    logInfo(`Version updated: ${lastVersion} -> ${currentVersion}`);
    migrationStore.set('lastVersion', currentVersion);
  }

  // Configure session to handle CORS for API requests
  // This allows the file:// app to make requests to http:// backend
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: details.requestHeaders });
  });

  const { addMissingCorsHeaders } = require('./electron-cors');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: addMissingCorsHeaders(details.responseHeaders)
    });
  });

  // Initialize session tracker
  sessionTracker = new SessionTracker({
    heartbeatInterval: 30000, // 30 seconds
    idleThreshold: 60 // 1 minute
  });
  logInfo('Session tracker initialized');

  // Screen-aware dictation is owned by the Electron host so the renderer and
  // model never receive general desktop-control authority. The overlay starts
  // inert and requests microphone/accessibility only when the user activates it.
  if (process.platform === 'darwin') {
    try {
      screenVoice = new ElectronScreenVoice({
        rootDir: __dirname,
        getMainWindow: () => mainWindow,
        getSavedServer: () => getSavedServer(),
        openClientSettings: openScreenVoiceSettings,
        navigateClient: navigateScreenVoiceClient,
        openExternalUrl: openScreenVoiceResearchUrl,
        notifyUser: notifyScreenVoiceInputRequired,
        ensureDockIcon: applyDockIcon,
        entitlementEnabled: isCapabilityActive(
          getSavedServer(),
          SCREEN_DICTION_APP_ID,
          getCapabilityPreferences(getSavedServer()),
          process.platform
        ),
        logInfo,
        logError
      });
      screenVoice.initialize();
    } catch (error) {
      logError('[electron-main] Failed to initialize screen-aware voice', error);
    }
  }

  // Start the PAC bridge (loopback HTTP server on 127.0.0.1:7890). Wire
  // identifier is still `lana-companion` for compat with already-granted
  // consents. The bridge reads the renderer's localStorage for the bearer
  // token and user id on demand — it never caches the token and never logs it.
  try {
    companionBridge.start({
      getToken: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return null;
        try {
          // executeJavaScript returns a Promise resolving to the evaluated value.
          const value = await mainWindow.webContents.executeJavaScript(
            "(() => { try { return window.localStorage.getItem('token'); } catch (_) { return null; } })()",
            true
          );
          return value || null;
        } catch (_err) {
          return null;
        }
      },
      getCurrentUserId: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return null;
        try {
          const value = await mainWindow.webContents.executeJavaScript(
            "(() => { try { const raw = window.localStorage.getItem('user'); if (!raw) return null; const u = JSON.parse(raw); return (u && (u.id || u.userId || u.user_id)) || null; } catch (_) { return null; } })()",
            true
          );
          return value || null;
        } catch (_err) {
          return null;
        }
      },
      getSavedServer: () => getSavedServer(),
      // Renderer-driven Lex modal. The bridge calls this first; if there's
      // no window or the renderer fails, the bridge falls back to the
      // native dialog.showMessageBox flow inside electron-bridge.js.
      requestConsentFromRenderer: requestCompanionConsentFromRenderer
    });
  } catch (error) {
    logError('[electron-main] Failed to start companion bridge', error);
  }

  // HOSTED DISCOVERY INITIALIZATION FLOW
  // With hosted discovery, we always start at login page
  // The login page handles org resolution via lanaai.io endpoint

  // Check for saved server
  const savedServer = getSavedServer();

  if (savedServer) {
    logInfo(`Found saved server: ${savedServer.orgName || savedServer.orgId}`);

    // Refresh hosted discovery on every launch so enabled_apps, capability
    // entitlements, tier, and service metadata do not remain stale for users
    // whose authenticated session bypasses login.html. Run this beside health
    // verification to avoid adding another serial startup delay.
    const [isReachable, refreshedServer] = await Promise.all([
      verifyServer(savedServer.url),
      refreshHostedDiscovery(savedServer)
    ]);

    const effectiveServer = refreshedServer || savedServer;
    if (refreshedServer) {
      saveServerConnection(refreshedServer);
      syncScreenVoiceEntitlement(refreshedServer);
    }

    if (isReachable) {
      logInfo('[electron-main] Saved server is reachable, loading main app...');
      updateLastVerified();
      createWindow(effectiveServer.url);
      return;
    } else {
      logInfo('[electron-main] Saved server is not reachable, clearing saved server and showing login...');
      clearSavedServer();
      syncScreenVoiceEntitlement(null);
    }
  } else {
    logInfo('[electron-main] No saved server found, showing login...');
  }

  // No saved server or unreachable - show login page
  createLoginWindow();

  // On macOS, re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      const savedServer = getSavedServer();
      if (savedServer) {
        createWindow(savedServer.url);
      } else {
        createLoginWindow();
      }
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle application quit
app.on('before-quit', async () => {
  // Cleanup operations before quitting
  console.log('[electron-main] Application is quitting...');

  // Stop the PAC bridge HTTP server
  try {
    companionBridge.stop();
  } catch (error) {
    logError('[electron-main] Failed to stop companion bridge', error);
  }

  // Tear down the brainchild MCP child process (if spawned).
  try {
    brainchildManager.stop();
  } catch (error) {
    logError('[electron-main] Failed to stop brainchild manager', error);
  }

  try {
    screenVoice?.shutdown();
  } catch (error) {
    logError('[electron-main] Failed to stop screen-aware voice', error);
  }

  try {
    ownedWebDesktopBrowser?.shutdown();
  } catch (error) {
    logError('[electron-main] Failed to stop owned-web desktop browser sessions', error);
  }

  // End session tracking
  if (sessionTracker) {
    await sessionTracker.shutdown();
    logInfo('[electron-main] Session tracker shut down');
  }
});

// Security: Prevent navigation to external URLs (allow local file navigation)
// Also fix absolute paths (e.g., /index.html -> file:///path/to/app/public_html/index.html)
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (navigationEvent, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Allow file:// protocol navigation (local HTML files)
    // Block external http/https navigation (but not our API calls which use fetch)
    if (parsedUrl.protocol === 'file:') {
      // Decode the pathname (handles %3A for : etc.)
      let pathname = decodeURIComponent(parsedUrl.pathname);

      logInfo(`[electron-main] [Navigation] Original URL: ${navigationUrl}`);
      logInfo(`[electron-main] [Navigation] Decoded pathname: ${pathname}`);

      // Check if this path needs to be fixed to point to public_html
      // A path is "correct" if it already includes public_html AND doesn't have a drive letter after it
      const hasPublicHtml = pathname.includes('public_html');
      const hasDriveLetterAfterPublicHtml = /public_html\/[A-Za-z]:/.test(pathname);
      const isAlreadyCorrect = hasPublicHtml && !hasDriveLetterAfterPublicHtml;

      if (!isAlreadyCorrect) {
        // Extract just the page path from the URL
        // On macOS/Linux: /matters.html or /admin/users.html
        // On Windows: /C:/matters.html or C:/matters.html -> need to extract just /matters.html
        let pagePath = pathname;

        // If path has public_html but also a drive letter, extract just the page name
        if (hasDriveLetterAfterPublicHtml) {
          const driveMatch = pathname.match(/public_html\/[A-Za-z]:(\/[^?#]*)/);
          if (driveMatch) {
            pagePath = driveMatch[1];
            logInfo(`[electron-main] [Navigation] Extracted page from malformed path: ${pagePath}`);
          }
        } else {
          // On Windows, file:// URLs resolve root-relative paths like /matters.html to /C:/matters.html
          // We need to strip the drive letter to get just the page path
          // Handle formats: /C:/path, C:/path, /C%3A/path (URL encoded)
          const windowsDriveMatch = pathname.match(/^\/?[A-Za-z]:(\/[^?#]*)/);
          if (windowsDriveMatch) {
            pagePath = windowsDriveMatch[1];
            logInfo(`[electron-main] [Navigation] Windows drive letter stripped: ${pathname} -> ${pagePath}`);
          }
        }

        // If a file:// navigation resolved to the project root instead of
        // public_html (for example /Users/.../lana-ai-client/admin/analytics.html),
        // strip the project root before joining with public_html. Without this,
        // the handler produces public_html/Users/.../lana-ai-client/... paths.
        const projectRoot = path.resolve(__dirname);
        const normalizedPathname = path.resolve(pathname);
        if (normalizedPathname === projectRoot || normalizedPathname.startsWith(projectRoot + path.sep)) {
          pagePath = normalizedPathname.substring(projectRoot.length);
          if (pagePath.startsWith(path.sep + 'public_html' + path.sep)) {
            pagePath = pagePath.substring(('/public_html').length);
          } else if (pagePath.startsWith(path.sep + 'src' + path.sep)) {
            pagePath = pagePath.substring(('/src').length);
          }
          if (!pagePath.startsWith(path.sep)) {
            pagePath = path.sep + pagePath;
          }
          logInfo(`[electron-main] [Navigation] Project-root path stripped: ${pathname} -> ${pagePath}`);
        }

        // Ensure pagePath starts with / for proper path.join behavior
        if (!pagePath.startsWith('/')) {
          pagePath = '/' + pagePath;
        }

        // Remove any remaining drive letters that might have slipped through
        pagePath = pagePath.replace(/^\/[A-Za-z]:/, '');
        if (!pagePath.startsWith('/')) {
          pagePath = '/' + pagePath;
        }

        // Build the correct path to public_html using the cross-platform helper
        const publicHtmlPath = path.join(__dirname, 'public_html');
        const fullPath = path.join(publicHtmlPath, pagePath);
        let correctPath = createFileUrl(fullPath);

        // Preserve query string and hash from original URL
        logInfo(`[electron-main] [Navigation] parsedUrl.search: ${parsedUrl.search}`);
        logInfo(`[electron-main] [Navigation] parsedUrl.hash: ${parsedUrl.hash}`);

        if (parsedUrl.search) {
          correctPath += parsedUrl.search;
          logInfo(`[electron-main] [Navigation] Added search: ${correctPath}`);
        }
        if (parsedUrl.hash) {
          correctPath += parsedUrl.hash;
          logInfo(`[electron-main] [Navigation] Added hash: ${correctPath}`);
        }

        logInfo(`[electron-main] [Navigation] Final path: ${navigationUrl} -> ${correctPath}`);
        navigationEvent.preventDefault();
        contents.loadURL(correctPath);
        return;
      }

      // Allow local file navigation - this is how the app navigates between pages
      logInfo(`[electron-main] [Navigation] Path OK, allowing: ${pathname}`);
      return;
    }

    // Block navigation to external URLs (security measure)
    // API calls use fetch(), not navigation, so they're not affected
    navigationEvent.preventDefault();
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  if (isBrokenPipeError(error)) {
    try {
      logError('[electron-main] Ignoring broken process pipe', error);
    } catch (_logError) {
      // Avoid surfacing a dev pipe shutdown as a user-facing application error.
    }
    return;
  }

  console.error('[electron-main] Uncaught exception:', error);
  dialog.showErrorBox('Application Error', error.message);
});
