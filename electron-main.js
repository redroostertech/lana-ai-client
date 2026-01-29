/**
 * Lana AI Desktop Application - Electron Main Process
 *
 * This file serves as the entry point for the Electron desktop application.
 * It creates the main browser window and handles application lifecycle events.
 * 
 * This is the THIN CLIENT version - connects to a remote backend server.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const Store = require('electron-store');

// Import thin client modules
const { verifyServer } = require('./electron-discovery');
const { getSavedServer, saveServerConnection, clearSavedServer, updateLastVerified } = require('./electron-storage');
const { checkForUpdates, downloadAndInstallUpdate, showOptionalUpdateDialog, showForceUpdateDialog, shouldCheckForUpdates } = require('./electron-updater-custom');
const { logInfo, logError, exportLogs, getLogFilePath } = require('./electron-logger');
const SessionTracker = require('./js/session/session-tracker');

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

// Register protocol for deep links (lana://)
// This must be called before app.whenReady()
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('lana', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('lana');
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
    icon: path.join(__dirname, 'build/icons/256x256.png'),
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

  // Load the index.html from public_html directory
  const startUrl = createFileUrl(path.join(__dirname, 'public_html/index.html'));
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

    // Check for updates after window is shown (if server URL is available)
    if (serverUrl && shouldCheckForUpdates()) {
      setTimeout(() => {
        checkAndHandleUpdates(serverUrl);
      }, 5000); // Wait 5 seconds after launch
    }
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
    icon: path.join(__dirname, 'build/icons/256x256.png'),
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
 */
async function checkAndHandleUpdates(serverUrl) {
  try {
    logInfo('Checking for updates...');
    
    // Get saved server to retrieve orgId
    const savedServer = getSavedServer();
    const orgId = savedServer?.orgId || null;
    
    const updateInfo = await checkForUpdates(serverUrl, null, orgId);

    if (!updateInfo.updateAvailable) {
      logInfo('No updates available');
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
  return { success: saveServerConnection(settings) };
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

// Clear saved server (logout)
ipcMain.handle('clear-saved-server', async () => {
  try {
    clearSavedServer();
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
 * Handle deep links (lana://connect/...)
 * With hosted discovery, deep links are simplified - just pass org ID
 */
const handleDeepLink = async (deepLinkUrl) => {
  logInfo(`Deep link received: ${deepLinkUrl}`);

  try {
    // Parse deep link: lana://connect/org-id
    const urlObj = new URL(deepLinkUrl);
    const orgId = urlObj.pathname.replace(/^\/+/, '');

    if (!orgId) {
      logError('No org ID in deep link');
      dialog.showErrorBox('Connection Error', 'Invalid connection link.');
      return;
    }

    // Focus or create main window and navigate to login with org pre-filled
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      // Could send org ID to renderer to pre-fill the form
      mainWindow.webContents.executeJavaScript(`
        if (document.getElementById('orgId')) {
          document.getElementById('orgId').value = '${orgId}';
        }
      `);
    } else {
      createLoginWindow();
    }

  } catch (error) {
    logError('Failed to handle deep link', error);
    dialog.showErrorBox('Connection Error', 'Failed to process the connection link.');
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
    const url = commandLine.find(arg => arg.startsWith('lana://'));
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

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
        'Access-Control-Allow-Headers': ['Content-Type, Authorization']
      }
    });
  });

  // Initialize session tracker
  sessionTracker = new SessionTracker({
    heartbeatInterval: 30000, // 30 seconds
    idleThreshold: 60 // 1 minute
  });
  logInfo('Session tracker initialized');

  // HOSTED DISCOVERY INITIALIZATION FLOW
  // With hosted discovery, we always start at login page
  // The login page handles org resolution via lanaai.io endpoint

  // Check for saved server
  const savedServer = getSavedServer();

  if (savedServer) {
    logInfo(`Found saved server: ${savedServer.orgName || savedServer.orgId}`);

    // Verify server is still reachable
    const isReachable = await verifyServer(savedServer.url);

    if (isReachable) {
      logInfo('Saved server is reachable, loading main app...');
      updateLastVerified();
      createWindow(savedServer.url);
      return;
    } else {
      logInfo('Saved server is not reachable, clearing saved server and showing login...');
      clearSavedServer();
    }
  } else {
    logInfo('No saved server found, showing login...');
  }

  // No saved server or unreachable - show login page
  createLoginWindow();

  // On macOS, re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
  console.log('Application is quitting...');

  // End session tracking
  if (sessionTracker) {
    await sessionTracker.shutdown();
    logInfo('Session tracker shut down');
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

      logInfo(`[Navigation] Original URL: ${navigationUrl}`);
      logInfo(`[Navigation] Decoded pathname: ${pathname}`);

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
            logInfo(`[Navigation] Extracted page from malformed path: ${pagePath}`);
          }
        } else {
          // On Windows, file:// URLs resolve root-relative paths like /matters.html to /C:/matters.html
          // We need to strip the drive letter to get just the page path
          // Handle formats: /C:/path, C:/path, /C%3A/path (URL encoded)
          const windowsDriveMatch = pathname.match(/^\/?[A-Za-z]:(\/[^?#]*)/);
          if (windowsDriveMatch) {
            pagePath = windowsDriveMatch[1];
            logInfo(`[Navigation] Windows drive letter stripped: ${pathname} -> ${pagePath}`);
          }
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
        logInfo(`[Navigation] parsedUrl.search: ${parsedUrl.search}`);
        logInfo(`[Navigation] parsedUrl.hash: ${parsedUrl.hash}`);

        if (parsedUrl.search) {
          correctPath += parsedUrl.search;
          logInfo(`[Navigation] Added search: ${correctPath}`);
        }
        if (parsedUrl.hash) {
          correctPath += parsedUrl.hash;
          logInfo(`[Navigation] Added hash: ${correctPath}`);
        }

        logInfo(`[Navigation] Final path: ${navigationUrl} -> ${correctPath}`);
        navigationEvent.preventDefault();
        contents.loadURL(correctPath);
        return;
      }

      // Allow local file navigation - this is how the app navigates between pages
      logInfo(`[Navigation] Path OK, allowing: ${pathname}`);
      return;
    }

    // Block navigation to external URLs (security measure)
    // API calls use fetch(), not navigation, so they're not affected
    navigationEvent.preventDefault();
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Application Error', error.message);
});

