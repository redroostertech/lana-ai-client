/**
 * Lana AI Desktop Application - Electron Main Process
 *
 * This file serves as the entry point for the Electron desktop application.
 * It creates the main browser window and handles application lifecycle events.
 * 
 * This is the THIN CLIENT version - connects to a remote backend server.
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, session, nativeImage, Notification, shell, safeStorage, protocol, desktopCapturer, systemPreferences, nativeTheme } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Store = require('electron-store');

/**
 * Resolve app icon candidates for the macOS Dock override. In development the
 * process is Electron.app, whose bundle icon is the default Electron mark; use
 * the PNG master first because nativeImage loads it more reliably than ICNS.
 */
// The icon folders. A packaged app carries them as app-icons/ (electron-builder
// leaves its build/ resources folder out of the app); an unpackaged run reads
// build/ in the source tree.
function iconDirs() {
  const dir = BRAND_FLAVOR === 'lana-one' ? 'icons-lana-one' : 'icons';
  return [path.join(__dirname, 'app-icons', dir), path.join(__dirname, 'build', dir)];
}

function appIconCandidates() {
  return iconDirs().flatMap((d) => [
    path.join(d, 'icon-1024.png'),
    path.join(d, 'icon-512.png'),
    path.join(d, 'icon.png'),
    path.join(d, 'icon.icns'),
  ]);
}

// Set app version from package.json (prevents app.getVersion() returning the Electron framework version)
const packageJson = require('./package.json');
app.setName(packageJson.productName || 'Lana AI');
app.setVersion(packageJson.version);

// Which product this is: the LANA client ("lana") or LANA One ("lana-one").
// Fixed at build time by package.json lanaFlavor; LANA_FLAVOR overrides it
// only in an unpackaged app (src/js/brand/lana-brand.js). Pages get it
// through the preload.
// The stamp is read from the running app's package.json on disk: packageJson
// above is inlined into the bundle at build time, so inside LANA One it is the
// client's, not LANA One's.
const { resolveFlavor, readAppPackageJson } = require('./src/js/brand/lana-brand');
const BRAND_FLAVOR = resolveFlavor({ env: process.env, packageJson: readAppPackageJson(app.getAppPath()), isPackaged: app.isPackaged });
const BRAND_ARG = '--lana-flavor=' + BRAND_FLAVOR;
const WINDOW_ICON = iconDirs().map((d) => path.join(d, 'icon-256.png')).find((p) => fs.existsSync(p))
  || path.join(iconDirs()[0], 'icon-256.png');

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
const { refreshHostedDiscovery, verifyServer, discoverByDomain, discoveryForPage, HELP_CENTER_ORIGIN } = require('./electron-discovery');
// The app's pages are served from lana-app://app (docs/plans/harden-web.md).
const { APP_SCHEME, APP_ORIGIN, STORAGE_MIGRATION_PATH, SCHEME_PRIVILEGES, appPageUrl, pageOf, createAppProtocolHandler } = require('./electron-app-protocol');
const { cspOriginsFromConfig, buildContentSecurityPolicy } = require('./electron-csp');
const { corsResponseFor } = require('./electron-cors');
const { decideNavigation, decideFrameNavigation } = require('./electron-navigation-policy');
const { migrateFileOriginStorage } = require('./electron-origin-migration');
const { createChefStorage } = require('./electron-chef-storage');
// The box Chef's certificate pin (hardware boxes): one host and port, trusted by
// the control plane's SHA-256 only; everything else keeps default checks.
const chefPin = require('./electron-chef-pin');
const { decideWindowOpen } = require('./electron-window-open-policy');
const { createAppLinkRouter, createFirmSignOut, oldSessionNotice, registerAppLinkIpc, createColdStartQueue, deepLinkFromArgv, connectLinkOrgId, createConnectOrgQueue } = require('./electron-app-links');
const { getSavedServer, saveServerConnection, clearSavedServer, updateLastVerified, saveBrainchildLink, getBrainchildLink, clearBrainchildLink, setBrainchildAutoBindDisabled, isBrainchildAutoBindDisabled, authTokenPersistence, offlineKeyPersistence, getLocalEnginePreferences, updateLocalEnginePreferences, firstLaunchPersistence, locationPersistence, appearancePersistence } = require('./electron-storage');
chefPin.configure({ getSavedServer });
const { createLocalEngineHost } = require('./electron-local-engine');
const { createTokenStore, registerTokenIpc, hasLiveSession } = require('./electron-token-store');
const { startPage, pageAfterSetup, signInPage, registerDockReopen } = require('./electron-start-page');

// The login token: OS-keychain encrypted at rest, memory only when no keychain.
const authTokenStore = createTokenStore({ safeStorage, persistence: authTokenPersistence });
// Phase 10: the offline copy key, OS-keychain encrypted; none without a keychain.
const { createOfflineKeyStore } = require('./electron-offline-key');
const offlineKeyStore = createOfflineKeyStore({ safeStorage, persistence: offlineKeyPersistence });
const { checkForUpdates, downloadAndInstallUpdate, showOptionalUpdateDialog, showForceUpdateDialog, shouldCheckForUpdates, configureAutoUpdater, getLastUpdateCheck, getLastCheckResult } = require('./electron-updater-custom');
const { registerSystemInfoIpc } = require('./electron-system-info');
const { installLocationPermissionHandlers, registerLocationIpc } = require('./electron-location');
// The app's permission policy, once the session is ready (electron-location.js); Briefs borrows it.
let appPermissions = null;
const { logInfo, logError, logWarn, exportLogs, getLogFilePath } = require('./electron-logger');

// IPC hardening (docs/plans/harden-ipc.md): every handler is registered through ipc, which answers
// only the top frame of an app page and checks each channel's arguments (electron-ipc-policy.js).
// Gestures: the person's last click or key press in each window, for the channels that need one.
const { createIpcGuard, createGestureTracker } = require('./electron-ipc-guard');
const { IPC_POLICY } = require('./electron-ipc-policy');
const ipcGestures = createGestureTracker();
app.on('web-contents-created', (_event, contents) => ipcGestures.watch(contents));
const ipc = createIpcGuard({ ipcMain, policy: IPC_POLICY, gestures: ipcGestures, warn: logWarn });
// The client preload as one bundled file, so its windows can be sandboxed (electron-preload-path.js).
const { clientPreloadPath } = require('./electron-preload-path');
const CLIENT_PRELOAD = () => clientPreloadPath({ isPackaged: app.isPackaged, rootDir: __dirname });

// Local AI engine (local-ai-engine plan, phase 6). When an engine is
// configured the client's API base is the engine's loopback address and the
// engine forwards everything it does not serve to the organization's server.
// electron-api-base.js holds the rule; getSavedServer() below stays Chef's.
const localEngine = createLocalEngineHost({
  ipcMain: ipc,
  app,
  storage: { getSavedServer, getLocalEnginePreferences, updateLocalEnginePreferences },
  getWindows: () => BrowserWindow.getAllWindows(),
  log: { info: logInfo, warn: logWarn, error: (message) => logError(message) },
  // Phase 8d: the engine runs this person's own background jobs with their own session.
  getAuthToken: () => authTokenStore.get(),
  offlineKey: offlineKeyStore
});
localEngine.registerIpc();

// Pip on this computer (first-launch plan, phase C): runs the chat and embedding servers the
// plan picked, and hands their addresses to the local engine.
const { createPip, resolvePipBinary, engineEndpoints } = require('./electron-pip-supervisor');
const { pickLoopbackPort } = require('./electron-local-engine');
// The redactor on this computer, if there is one (electron-redactor.js). Found first: sizing
// sets its memory aside and the engine is given its address.
const { createRedactor, resolveRedactorCommand, redactorEndpoints, REDACTOR_MEMORY_BYTES } = require('./electron-redactor');
const redactorCommand = process.env.REDACTOR_URL ? null : resolveRedactorCommand({ env: process.env, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, home: app.getPath('home'), fileExists: (file) => fs.existsSync(file) });
const pipBinary = resolvePipBinary({ env: process.env, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, fileExists: (file) => fs.existsSync(file) });
const pip = createPip({
  binary: pipBinary,
  // Asked on every start, so an updated app's Pip is asked again (electron-pip-levers.js).
  accepts: require('./electron-pip-levers').readAccepts(pipBinary, require('child_process').spawnSync, { warn: logWarn }),
  readWiredLimitMb: () => {
    if (process.platform !== 'darwin') {return null;}
    try { return Number(require('child_process').execFileSync('sysctl', ['-n', 'iogpu.wired_limit_mb'], { encoding: 'utf8', timeout: 3000 }).trim()); } catch (_error) { return null; }
  },
  dir: path.join(app.getPath('userData'), 'pip'),
  spawn: require('child_process').spawn,
  fetch: (url, { timeoutMs = 3000, ...init } = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  pickPort: pickLoopbackPort,
  env: process.env,
  log: { info: logInfo, warn: logWarn, error: (message) => logError(message) },
  onProblem: (message) => localEngine.setLocalAiProblem(message),
  onAddresses: (addresses) => {
    logInfo(`[pip] addresses: chat ${addresses.chat || 'none'}, embedding ${addresses.embedding || 'none'}`);
    localServers.pip = engineEndpoints(addresses);
    pushLocalServers();
  }
});

// The redactor on this computer (first-launch plan, section 6a): turns sent to the cloud are
// redacted here first. Started at launch, before sign-in: it holds no data and needs no account.
// Skipped when the environment already names a redactor.
const redactor = createRedactor({
  command: redactorCommand,
  spawn: require('child_process').spawn,
  fetch: (url, { timeoutMs = 3000, ...init } = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  pickPort: pickLoopbackPort,
  baseEnv: process.env,
  openLog: () => {
    try {
      fs.mkdirSync(path.join(app.getPath('userData'), 'redactor'), { recursive: true });
      return fs.createWriteStream(path.join(app.getPath('userData'), 'redactor', 'redactor.log'), { flags: 'w' });
    } catch (_error) { return null; }
  },
  log: { info: logInfo, warn: logWarn, error: (message) => logError(message) },
  onAddress: (address) => {
    logInfo(`[redactor] ${address ? `ready on ${address.url}` : 'not running'}`);
    localServers.redactor = redactorEndpoints(address);
    pushLocalServers();
  }
});

// Docling on this computer, if there is one (electron-docling.js): the organization's server
// offers uploaded files to it first, and reads them itself when it is not running. Worked out
// again on every start, so the runtime first-launch setup installs (electron-docling-install.js)
// starts as soon as it is in place.
const { createDocling, shouldStartDocling, resolveDoclingCommand, doclingEndpoints, DOCLING_MEMORY_BYTES } = require('./electron-docling');
const doclingInstall = require('./electron-docling-install');
const resolveDocling = () => resolveDoclingCommand({
  env: process.env,
  userDataDir: app.getPath('userData'),
  home: app.getPath('home'),
  fileExists: (file) => fs.existsSync(file),
  installedRuntime: () => doclingInstall.installedEntry(app.getPath('userData'), doclingInstall.platformKey())
});
const doclingAtLaunch = resolveDocling();
const docling = createDocling({
  command: resolveDocling,
  spawn: require('child_process').spawn,
  fetch: (url, { timeoutMs = 3000, ...init } = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  pickPort: pickLoopbackPort,
  baseEnv: process.env,
  openLog: () => {
    try {
      fs.mkdirSync(path.join(app.getPath('userData'), 'docling'), { recursive: true });
      return fs.createWriteStream(path.join(app.getPath('userData'), 'docling', 'docling.log'), { flags: 'w' });
    } catch (_error) { return null; }
  },
  log: { info: logInfo, warn: logWarn, error: (message) => logError(message) },
  onAddress: (url) => {
    logInfo(`[docling] ${url ? `ready on ${url}` : 'not running'}`);
    localServers.docling = doclingEndpoints(url);
    pushLocalServers();
  }
});

// The LANA document editor on this computer (electron-editor-service.js): pages load the editor
// from it and it reads and renders documents here. Started at launch; it needs no account.
// Pages get its address only; its token stays here and is added to their /v1 calls below.
const { createEditorService, resolveEditorServiceScript } = require('./electron-editor-service');
const editorService = createEditorService({
  script: resolveEditorServiceScript({ env: process.env, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, appRoot: __dirname, fileExists: (file) => fs.existsSync(file) }),
  execPath: process.execPath,
  keyDir: path.join(app.getPath('userData'), 'lana-editor', 'keys'),
  spawn: require('child_process').spawn,
  fetch: (url, { timeoutMs = 3000, ...init } = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  pickPort: pickLoopbackPort,
  baseEnv: process.env,
  openLog: () => {
    try {
      fs.mkdirSync(path.join(app.getPath('userData'), 'lana-editor'), { recursive: true });
      return fs.createWriteStream(path.join(app.getPath('userData'), 'lana-editor', 'editor.log'), { flags: 'w' });
    } catch (_error) { return null; }
  },
  log: { info: logInfo, warn: logWarn, error: (message) => logError(message) }
});
ipc.on('editor-service:base-url-sync', (event) => { event.returnValue = editorService.baseUrl(); });

// What the engine is given for this computer's own servers: Pip's, the redactor's and Docling's together.
const localServers = { pip: {}, redactor: {}, docling: {} };
function pushLocalServers() {
  localEngine.setModelEndpoints({ ...localServers.pip, ...localServers.redactor, ...localServers.docling })
    .catch((error) => logError('[electron-main] Local AI engine did not restart for its local servers', error));
}

// First-launch local AI setup (first-launch plan, phases B and C): sizes this computer and
// downloads its model files after the person presses Continue on the setup screen (phase D).
// Every launch after that runs setup again (files in place are skipped) and starts Pip.
const { createFirstLaunch } = require('./electron-first-launch');
const { registerFirstLaunchIpc, broadcastFirstLaunchStatus, devHardwareReader, localServerStates } = require('./electron-first-launch-ipc');
// Development only (NODE_ENV=development, unpackaged): LANA_DEV_HARDWARE pretends the computer
// is another size, to see the first-launch screen's other states. Null otherwise.
const devReadHardware = devHardwareReader({ env: process.env, isPackaged: app.isPackaged, read: require('./electron-hardware').readHardware });
const firstLaunch = createFirstLaunch({
  userDataDir: app.getPath('userData'),
  state: firstLaunchPersistence,
  redactorMemoryBytes: redactorCommand ? REDACTOR_MEMORY_BYTES : 0,
  // A developer's running docling-serve is not on this computer's memory budget; any other is.
  doclingMemoryBytes: doclingAtLaunch && doclingAtLaunch.external ? 0 : DOCLING_MEMORY_BYTES,
  // A developer's Docling (LANA_DOCLING_URL, LANA_DOCLING_BIN, a venv) means nothing to download.
  doclingProvided: () => {
    const found = resolveDocling();
    return Boolean(found && found.source !== 'runtime');
  },
  onDoclingReady: () => {
    logInfo('[first-launch] Docling is in place; starting it');
    void docling.start().catch((error) => logError('[electron-main] Docling did not start', error));
  },
  io: devReadHardware ? { readHardware: devReadHardware } : {},
  onStatus: (status) => {
    if (status.phase === 'failed') {logWarn(`[first-launch] setup stopped: ${status.error && status.error.code}`);}
    broadcastFirstLaunchStatus(BrowserWindow.getAllWindows(), status);
  },
  onReady: (result) => {
    logInfo('[first-launch] every local model file is in place; starting Pip');
    pip.apply(result, localModelsCatalog.modelsDir(process.env, app.getPath('userData')))
      .catch((error) => logError('[electron-main] Pip did not start', error));
    // Setup is done: a Docling found on this computer may start now (electron-docling.js).
    void docling.start().catch((error) => logError('[electron-main] Docling did not start', error));
  }
});
registerFirstLaunchIpc({
  ipcMain: ipc,
  firstLaunch,
  // Settings > Capabilities: whether each server on this computer is ready, starting or not running.
  servers: () => localServerStates({ pip, redactor, docling, env: process.env, probe: (url) => pipEndpoint(url, fetch) }),
  // Settings' Try again on a server that stopped (electron-process-keeper.js limits).
  retryServer: (id) => (id === 'docling' ? docling.retry() : null),
  log: (error) => logError('[first-launch] the setup screen call failed', error)
});

// Settings > General > Appearance: the one Light / Dark / System setting. Applied before
// any window opens, so nativeTheme (and prefers-color-scheme in every page) agrees from
// the first frame; Briefs is kept in step below.
const { createAppearance, registerAppearanceIpc } = require('./electron-appearance');
const appearance = createAppearance({
  nativeTheme,
  persistence: appearancePersistence,
  getWindows: () => BrowserWindow.getAllWindows(),
  log: (error) => logError('[appearance] the appearance setting failed', error)
});
appearance.start();
registerAppearanceIpc({ ipcMain: ipc, appearance });

// LANA Briefs (Briefs integration plan): runs only while discovery lists lana-notes and
// someone is signed in. Its model work goes to the local AI engine's runtime route.
const { createBriefs, registerBriefsSchemes } = require('./electron-briefs');
const { isEngineInUse, withoutFirmSecrets, keepStoredFirmSecrets } = require('./electron-api-base');
const BRIEFS_DIST = path.join(__dirname, 'briefs', 'dist');
// Loaded only when Briefs starts. A computed path keeps the client's bundler from
// inlining it: the host ships as its own file in briefs/dist.
const BRIEFS_HOST_FILE = path.join(BRIEFS_DIST, 'briefs-host.cjs');
const loadBriefsHost = () => require(BRIEFS_HOST_FILE);
registerBriefsSchemes(protocol, [{ scheme: APP_SCHEME, privileges: SCHEME_PRIVILEGES }]);
const briefs = createBriefs({
  electron: { app, session, protocol, desktopCapturer, systemPreferences, shell, dialog, safeStorage, nativeTheme, BrowserWindow },
  loadHost: loadBriefsHost,
  distDir: BRIEFS_DIST,
  appearance,
  engineBase: () => {
    const state = localEngine.supervisor.getState();
    return isEngineInUse(state) ? state.url : null;
  },
  ipcMain: ipc,
  // Briefs' own channels answer only the app's pages (electron-ipc-guard.js).
  isAppUrl: ipc.isAppUrl,
  // The permission check handler gets the origin only; other permissions follow the app's
  // one policy (electron-location.js), put back when Briefs stops.
  isTrustedOrigin: (origin) => origin === APP_ORIGIN,
  permissions: {
    decide: (contents, permission, details) => Boolean(appPermissions && appPermissions.decide(contents, permission, details)),
    restore: () => { if (appPermissions) appPermissions.restore(); }
  },
  apiBase: () => localEngine.apiBase(),
  getServer: () => getSavedServer(),
  getToken: () => authTokenStore.get(),
  getWindows: () => BrowserWindow.getAllWindows(),
  // The speech and voice models first launch decided fit this computer.
  speechModels: () => firstLaunch.speechModels(),
  // Records while a Briefs recording is live; never shown.
  createCaptureWindow: () => {
    const capture = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: CLIENT_PRELOAD(),
        additionalArguments: [BRAND_ARG],
        webSecurity: true,
        sandbox: true,
        // Audio capture keeps running while the window is hidden.
        backgroundThrottling: false
      }
    });
    capture.loadURL(appPageUrl('briefs/capture.html'));
    return capture;
  },
  showWindow: () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  },
  log: { info: logInfo, warn: logWarn, error: (message) => logError(message) }
});
function syncBriefs(server = getSavedServer()) {
  briefs.sync(server).catch(() => {});
}
const { createOsSignals } = require('./electron-os-signals');
const SessionTracker = require('./js/session/session-tracker');
const companionBridge = require('./electron-bridge');
const { redactUrlForLog } = require('./electron-log-redaction');
const { BrainchildManager, discover, validateLink, mcpBinForRoot, isAllowedVaultRoot } = require('./src/electron-brainchild-manager');
const { ElectronScreenVoice } = require('./src/screen-voice/electron-screen-voice');
const { isAllowedExternalUrl, sanitizeExternalUrl } = require('./src/electron-external-url');
// Main-process confirmation dialogs and the one gate for opening links in the browser
// (electron-confirm.js, electron-external-open.js; docs/plans/harden-ipc.md).
const { confirmAction, trackedMessageBox, cancelAllPrompts } = require('./electron-confirm');
// SIGTERM (a system shutdown, a process manager): close any open question and quit normally,
// so the engine and the other local servers stop cleanly.
process.on('SIGTERM', () => {
  cancelAllPrompts();
  app.quit();
});
const { createExternalOpener } = require('./electron-external-open');
const confirmFor = (kind, details, contents) => confirmAction(dialog, (contents && BrowserWindow.fromWebContents(contents)) || null, kind, details);
const externalOpener = createExternalOpener({ shell, isAllowed: isAllowedExternalUrl, sanitize: sanitizeExternalUrl, gestures: ipcGestures, confirm: confirmFor, log: logWarn });
const { registerAiTopologyIpc, pipEndpoint } = require('./electron-ai-topology');
const localModelsCatalog = require('./electron-local-models');
const {
  SCREEN_DICTION_ID,
  screenDictionAvailable,
  isScreenDictionActive,
  screenDictionViews
} = require('./src/screen-voice/feature');

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
    pendingCompanionConsents.set(requestId, { resolve, app, contentsId: mainWindow.webContents.id });

    // If the window goes away while we wait, resolve as denied so callers
    // don't hang forever (the bridge has its own timeout too).
    const cleanupOnClose = () => {
      const pending = pendingCompanionConsents.get(requestId);
      if (pending) {
        pendingCompanionConsents.delete(requestId);
        pending.resolve({ allow: false, alwaysAllow: false });
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

ipc.handle('companion-bridge:respond-consent', async (event, payload) => {
  const requestId = payload && typeof payload.requestId === 'string' ? payload.requestId : null;
  if (!requestId) return { ok: false, reason: 'missing_request_id' };

  const pending = pendingCompanionConsents.get(requestId);
  if (!pending) return { ok: false, reason: 'unknown_request_id' };
  // Only the window that was asked may answer, and allowing needs the person's own click.
  if (!event.sender || event.sender.id !== pending.contentsId) return { ok: false, reason: 'wrong_window' };
  const allow = Boolean(payload && payload.allow);
  if (allow && !ipcGestures.recent(event.sender)) return { ok: false, reason: 'needs_user_action' };
  // "Always allow" stops future prompts: the app asks again in its own dialog.
  const alwaysAllow = allow && Boolean(payload && payload.alwaysAllow);
  if (alwaysAllow && !(await confirmFor('alwaysAllowCompanion', { app: pending.app }, event.sender))) {
    return { ok: false, reason: 'not_confirmed' };
  }

  pendingCompanionConsents.delete(requestId);
  pending.resolve({ allow, alwaysAllow });
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
// True once startup has opened its first window; dock reopen waits for it (registerDockReopen).
let startupDone = false;
let screenVoice = null;
let capabilityPreferencesStore = null;

function isLanaOneEdition() {
  const raw = process.env.LANA_ONE_EDITION || process.env.LANA_ONE || '';
  return raw === '1' || raw.toLowerCase() === 'true';
}

// Screen diction is a core client feature (src/screen-voice/feature.js): this
// computer's on/off choice lives here, not with the organization's server.
function getCapabilityPreferencesStore() {
  if (!capabilityPreferencesStore) {
    capabilityPreferencesStore = new Store({
      name: 'screen-diction',
      defaults: { enabled: false }
    });
  }
  return capabilityPreferencesStore;
}

function screenDictionPreference() {
  return getCapabilityPreferencesStore().get('enabled', false) === true;
}

function currentCapabilityViewModels() {
  return screenDictionViews(screenDictionPreference(), process.platform).map((capability) => (
    { ...capability, openAtLogin: Boolean(screenVoice?.getSettings().openAtLogin) }
  ));
}

function syncScreenVoiceEntitlement() {
  const enabled = isScreenDictionActive(screenDictionPreference(), process.platform);
  if (screenVoice) screenVoice.setEntitlementEnabled(enabled);
  return enabled;
}

function isScreenDictionEntitled() {
  return screenDictionAvailable(process.platform);
}

async function syncScreenVoiceAuthentication(window = mainWindow) {
  if (!screenVoice || !window || window.isDestroyed()) return false;
  let authenticated = false;
  try {
    authenticated = hasLiveSession(authTokenStore.get(), Date.now());
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

function openScreenVoiceSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const settingsUrl = appPageUrl('settings-v2.html?capability=screen-diction#screen-diction');
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.loadURL(settingsUrl);
  return true;
}

const SCREEN_VOICE_CLIENT_ROUTES = new Set([
  'dashboard.html', 'workspaces.html', 'workspace-details.html', 'file-viewer.html', 'approval-detail.html', 'integrations/connectors.html', 'notifications.html'
]);

async function navigateScreenVoiceClient(input = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const asked = String(input.route || '').trim().replace(/^\/+/, '');
  const matterId = String(input.matterId || '').trim();
  // matters.html is retired: the matters list is workspaces.html, and one matter opens its own page.
  const route = asked === 'matters.html' ? (matterId ? 'workspace-details.html' : 'workspaces.html') : asked;
  if (!SCREEN_VOICE_CLIENT_ROUTES.has(route)) throw new Error('Unsupported LANA destination');
  const target = new URL(appPageUrl(route));
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

const DEEP_LINK_CLIENT_ROUTES = Object.freeze({
  'action-queue.html': ['action_type', 'severity'],
  'admin/alerts.html': ['id', 'status', 'severity'],
  'admin/analytics.html': ['tab'],
  'admin/audit.html': ['id', 'actor', 'event_type'],
  'admin/billable-hours.html': ['matter_id', 'user_id', 'status'],
  'admin/block-billing-rules.html': ['id', 'matter_id'],
  'admin/communications.html': ['id', 'type'],
  'admin/console.html': ['tab'],
  'admin/dashboard-builder.html': ['id'],
  'admin/dashboard-detail.html': ['id'],
  'admin/dashboard-library.html': ['id'],
  'admin/data-visualization.html': ['id', 'metric_id'],
  'admin/health.html': ['service'],
  'admin/index.html': ['tab'],
  'admin/integrations.html': ['connector', 'source'],
  'admin/metric-catalog.html': ['id', 'q'],
  'admin/metric_detail.html': ['id'],
  'admin/onboarding_management.html': ['id'],
  'admin/organizations.html': ['id', 'q'],
  'admin/plugins.html': ['id', 'plugin'],
  'admin/relevance-labeling.html': ['id'],
  'admin/reporting.html': ['id', 'report'],
  'admin/roles.html': ['id'],
  'admin/roles_manager.html': ['id'],
  'admin/search-analytics.html': ['q'],
  'admin/session-details.html': ['sessionId'],
  'admin/sessions.html': ['sessionId', 'userId'],
  'admin/settings.html': ['section'],
  'admin/task-plans.html': ['id'],
  'admin/traces.html': ['id', 'trace_id'],
  'admin/updates.html': ['id'],
  'admin/user-details.html': ['userId'],
  'admin/users.html': ['userId', 'q'],
  'admin/workspace-analytics.html': ['matter_id', 'id'],
  'agents/index.html': [],
  'alerts.html': ['id', 'severity', 'status'],
  'approval-detail.html': ['id'],
  'approvals.html': ['status', 'priority', 'source', 'q'],
  'article.html': ['section', 'id'],
  'automation/index.html': ['automationId'],
  'brainchild/index.html': ['vault', 'path'],
  'dashboard.html': [],
  'data-connectors.html': ['connector', 'source', 'matter_id'],
  'deck-studio/index.html': ['id', 'deck_id', 'matter_id', 'matter_name', 'view'],
  'doc-studio/index.html': ['id', 'view', 'editor', 'file_id', 'file_name', 'matter_id', 'matter_name'],
  'docs/api-documentation.html': ['section'],
  'document-library-templates.html': ['matter_id', 'template_id', 'kind', 'tab'],
  'drive.html': ['matter_id', 'matter_name', 'folder_id', 'tab'],
  'faq.html': ['section'],
  'file-editor.html': ['id', 'matter_id'],
  'file-viewer.html': ['id', 'matter_id', 'page'],
  'folder.html': ['matter_id', 'matter_name', 'folder_id', 'tab'],
  'help.html': ['section'],
  'integrations/actionstep.html': ['matter_id', 'source'],
  'integrations/connector-case.html': ['connectorId', 'sourceId', 'matter_id'],
  'integrations/connector-communications.html': ['connectorId', 'sourceId', 'matter_id'],
  'integrations/connector-crm.html': ['connectorId', 'sourceId', 'matter_id'],
  'integrations/connector-documents.html': ['connectorId', 'sourceId', 'matter_id'],
  'integrations/connector-financial.html': ['connectorId', 'sourceId', 'matter_id'],
  'integrations/connector-viewer.html': ['ui', 'name', 'tab', 'connectorId', 'connectorType', 'sourceId', 'connectorScope'],
  'integrations/connectors.html': ['connector', 'source', 'matter_id'],
  'integrations/data_connectors.html': ['connector', 'source', 'matter_id'],
  'integrations/integration-config.html': ['connectorId', 'sourceId'],
  'integrations/leadly.html': ['matter_id', 'source'],
  'integrations/sync-status.html': ['connectorId', 'sourceId', 'status'],
  'matters/timeline.html': ['id'],
  'my-tasks.html': ['task', 'task_id', 'status', 'assignee', 'matter_id'],
  'notifications.html': ['id', 'filter', 'type'],
  'document-library.html': [],
  'recording-detail.html': ['id'],
  'recordings.html': ['id', 'q'],
  'search-conversations.html': ['q', 'conversation_id'],
  'search-results.html': ['q'],
  'settings-v2.html': ['capability', 'section'],
  'workflows/active.html': ['id', 'status'],
  'workflows/builder.html': ['id', 'template'],
  'workflows/dashboard.html': ['id'],
  'workflows/execution-logs.html': ['id', 'execution_id'],
  'workflows/follow-up-cadences.html': ['id'],
  'workflows/retargeting.html': ['id'],
  'workflows/templates.html': ['id', 'template'],
  'workspace-data.html': ['id', 'matter_id', 'tab'],
  'workspace-details.html': ['id', 'matter', 'tab', 'task', 'task_id', 'upload', 'open_file', 'artifact', 'artifact_id', 'activity'],
  'workspaces.html': ['action', 'search', 'status', 'sort_by', 'sort_order']
});

const DEEP_LINK_AGENT_HASH_VIEWS = Object.freeze(new Set([
  'catalog',
  'activity',
  'create',
  'tools/browse',
  'tools'
]));

const DEEP_LINK_AUTOMATION_HASH_VIEWS = Object.freeze(new Set([
  'home',
  'library',
  'library-detail',
  'builder',
  'runs',
  'approvals',
  'connectors',
  'connector-detail'
]));

const DEEP_LINK_SETTINGS_SECTIONS = Object.freeze(new Set([
  'account',
  'profile',
  'organization',
  'billing',
  'security',
  'capabilities',
  'screen-diction',
  'notifications',
  'integrations'
]));

const DEEP_LINK_ALIASES = Object.freeze({
  approval: { route: 'approval-detail.html', idParam: 'id' },
  approvals: { route: 'approvals.html' },
  document: { route: 'file-viewer.html', idParam: 'id' },
  file: { route: 'file-viewer.html', idParam: 'id' },
  matter: { route: 'workspace-details.html', idParam: 'id' },
  notification: { route: 'notifications.html', idParam: 'id' },
  notifications: { route: 'notifications.html' },
  task: { route: 'my-tasks.html', idParam: 'task' },
  workspace: { route: 'workspace-details.html', idParam: 'id' }
});

function stripLeadingSlashes(value) {
  let result = String(value || '');
  while (result.charAt(0) === '/') {
    result = result.slice(1);
  }
  return result;
}

function firstDeepLinkSegment(urlObj) {
  return decodeURIComponent(stripLeadingSlashes(urlObj.pathname || '')).trim();
}

function rejectUnsafeFragment(value, label = 'hash') {
  const fragment = String(value || '').trim();
  if (!fragment) return '';
  if (fragment.length > 300 || fragment.includes('\n') || fragment.includes('\r')) {
    throw new Error(`Invalid ${label} parameter`);
  }
  return fragment.charAt(0) === '#' ? fragment.slice(1) : fragment;
}

function setSafeHash(target, fragment) {
  const safe = rejectUnsafeFragment(fragment);
  if (safe) target.hash = safe;
}

function prefixedHash(prefix, value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (id.length > 200 || id.includes('\n') || id.includes('\r')) {
    throw new Error('Invalid deep-link identifier');
  }
  return prefix + id;
}

// Retired pages: an old link to one opens the page that replaced it.
const RETIRED_CLIENT_ROUTES = Object.freeze({
  'admin/dashboard.html': 'admin/index.html',
  'admin/management-boards.html': 'admin/dashboard-library.html',
  'insights/dashboard.html': 'admin/analytics.html',
  'insights/module-execution.html': 'admin/reporting.html',
  'insights/predictions.html': 'admin/analytics.html',
  'matter-skills.html': 'automation/index.html',
  'matters.html': 'workspaces.html',
  'skills-marketplace.html': 'automation/index.html',
  'skills.html': 'automation/index.html'
});

// What a retired page's link keeps (as Lex.Nav.redirectFor): the old Reports
// page's ?module= opens that report (?report=); the other old Insights (Dashboard, Predictions),
// Management Boards and Skills pages' params named their own records, so the
// replacement opens on its home or list. Other routes keep their params.
function retiredPageParams(route, params) {
  const asked = stripLeadingSlashes(route).trim();
  if (asked === 'matters.html' || asked === 'admin/dashboard.html') return params;
  if (!Object.prototype.hasOwnProperty.call(RETIRED_CLIENT_ROUTES, asked)) return params;
  const kept = new URLSearchParams();
  if (asked === 'insights/module-execution.html' && params.get('module')) kept.set('report', params.get('module'));
  return kept;
}

// The old Matters page's link to one matter (?matter_id= or ?open=) opens that
// matter's page; the matter id moves to ?id= and ?tab= comes along.
function retiredMatterRoute(route, params) {
  if (stripLeadingSlashes(route).trim() !== 'matters.html') return route;
  const matterId = params.get('matter_id') || params.get('open');
  if (!matterId) return route;
  params.set('id', matterId);
  return 'workspace-details.html';
}

// Pages that are only a fragment of the app shell (as Lex.Nav's
// _shellFragmentPages): a link opens them inside app.html (?page=), which starts
// the router on them, instead of loading the bare fragment.
const SHELL_FRAGMENT_ROUTES = Object.freeze(['model-pricing.html', 'open-source-licenses.html']);

function shellFragmentUrl(route) {
  const asked = stripLeadingSlashes(route).trim();
  if (!SHELL_FRAGMENT_ROUTES.includes(asked)) return null;
  const target = new URL(appPageUrl('app.html'));
  target.searchParams.set('page', asked);
  return target.toString();
}

function sanitizeClientRoute(route) {
  const asked = stripLeadingSlashes(route).trim();
  const value = Object.prototype.hasOwnProperty.call(RETIRED_CLIENT_ROUTES, asked) ? RETIRED_CLIENT_ROUTES[asked] : asked;
  if (!Object.prototype.hasOwnProperty.call(DEEP_LINK_CLIENT_ROUTES, value)) {
    throw new Error('Unsupported LANA destination');
  }
  return value;
}

function addSafeDeepLinkParams(target, sourceParams, allowedKeys) {
  for (const key of allowedKeys) {
    const value = sourceParams.get(key);
    if (value === null || value === '') continue;
    if (String(value).length > 500) throw new Error(`Invalid ${key} parameter`);
    target.searchParams.set(key, value);
  }
}

async function navigateClientDeepLink(urlObj) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  let route = urlObj.searchParams.get('route');
  const params = new URLSearchParams(urlObj.searchParams);
  const host = String(urlObj.hostname || '').trim();
  const firstSegment = firstDeepLinkSegment(urlObj);
  let hash = urlObj.searchParams.get('hash') || urlObj.hash || '';

  if (!route && DEEP_LINK_ALIASES[host]) {
    const alias = DEEP_LINK_ALIASES[host];
    route = alias.route;
    if (alias.idParam && firstSegment) params.set(alias.idParam, firstSegment);
  }

  if (!route && host === 'agent') {
    route = 'agents/index.html';
    if (firstSegment) hash = prefixedHash('#agent/', firstSegment);
  }

  if (!route && host === 'agent-run') {
    route = 'agents/index.html';
    if (firstSegment) hash = prefixedHash('#run/', firstSegment);
  }

  if (!route && host === 'agent-activity') {
    route = 'agents/index.html';
    if (firstSegment) hash = prefixedHash('#activity/', firstSegment);
  }

  if (!route && host === 'agents') {
    route = 'agents/index.html';
    const view = firstSegment || urlObj.searchParams.get('view') || 'catalog';
    if (!DEEP_LINK_AGENT_HASH_VIEWS.has(view)) throw new Error('Unsupported agents destination');
    hash = '#' + view;
  }

  if (!route && host === 'automation') {
    route = 'automation/index.html';
    if (firstSegment) hash = '#automation/' + encodeURIComponent(firstSegment);
  }

  if (!route && host === 'automations') {
    route = 'automation/index.html';
    const view = firstSegment || urlObj.searchParams.get('view') || 'library';
    if (!DEEP_LINK_AUTOMATION_HASH_VIEWS.has(view)) throw new Error('Unsupported automation destination');
    hash = '#' + view;
  }

  if (!route && host === 'doc-studio') {
    route = 'doc-studio/index.html';
    if (firstSegment) params.set('id', firstSegment);
  }

  if (!route && host === 'deck') {
    route = 'deck-studio/index.html';
    if (firstSegment) params.set('id', firstSegment);
  }

  if (!route && host === 'settings') {
    route = 'settings-v2.html';
    const section = firstSegment || urlObj.searchParams.get('section') || '';
    if (section) {
      if (!DEEP_LINK_SETTINGS_SECTIONS.has(section)) throw new Error('Unsupported settings destination');
      hash = '#' + section;
    }
  }

  if (!route && host === 'insights') {
    const view = firstSegment || 'dashboard';
    if (view === 'dashboard') route = 'insights/dashboard.html';
    else if (view === 'predictions') route = 'insights/predictions.html';
    else if (view === 'module-execution') route = 'insights/module-execution.html';
    else throw new Error('Unsupported insights destination');
  }

  if (!route && host === 'connector') {
    route = 'integrations/connector-viewer.html';
    if (firstSegment) params.set('connectorId', firstSegment);
  }

  const linkParams = retiredPageParams(route, params);
  const fragmentUrl = shellFragmentUrl(route);
  let target;
  if (fragmentUrl) {
    target = new URL(fragmentUrl);
  } else {
    route = sanitizeClientRoute(retiredMatterRoute(route, linkParams));
    target = new URL(appPageUrl(route));
    addSafeDeepLinkParams(target, linkParams, DEEP_LINK_CLIENT_ROUTES[route]);
    setSafeHash(target, hash);
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
      logInfo(`[Development] Certificate error bypassed for: ${redactUrlForLog(url)}`);
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
//       it) can replace the deterministic LanaAIDevHelper.app entry installed
//       by install.sh. The helper owns lana-ai:// in dev and launches this
//       checkout's Electron entry with the URL, which lets the single-instance
//       handler deliver it to the running dev app.
//   - Windows / Linux dev:
//       setAsDefaultProtocolClient(protocol, execPath, [appEntry]) writes
//       registry entries (Windows) or a .desktop record that include the
//       app entry path, so cold-start launches load electron-main.js. The
//       args parameter is honored on these platforms (unlike macOS).
//   - Packaged builds (process.defaultApp = false):
//       The protocol is declared in Info.plist (mac) / NSIS install (win) /
//       .desktop file (linux) by electron-builder. The runtime call here is
//       a defensive confirmation that production builds own lana-ai:// directly.
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

// OAuth state management for CSRF protection (electron-oauth-state.js).
const { createOAuthStates } = require('./electron-oauth-state');
const oauthStates = createOAuthStates();
function generateOAuthState() {
  return oauthStates.generate();
}

/**
 * The origins the app's pages may talk to, from live configuration: the saved
 * server (Chef, Forge, burst, embedded apps), the local AI engine, the local
 * editor service and the control plane (electron-csp.js). Read per page load
 * and per response, so a newly connected firm or a restarted engine counts.
 */
function currentCspOrigins() {
  let engineUrl = null;
  try {
    const state = localEngine.supervisor.getState();
    engineUrl = state && state.mode !== 'off' ? state.url : null;
  } catch (_) { engineUrl = null; }
  let editorUrl = null;
  try { editorUrl = editorService.baseUrl() || null; } catch (_) { editorUrl = null; }
  let savedServer = null;
  try { savedServer = getSavedServer(); } catch (_) { savedServer = null; }
  return cspOriginsFromConfig({ savedServer, engineUrl, editorUrl, helpOrigins: [HELP_CENTER_ORIGIN], storageOrigins: chefStorage.origins() });
}

// Where the saved firm's presigned storage links point: Chef serves it to
// signed-in callers only (client-config), asked with this session's token
// (electron-chef-storage.js). Pages loaded after the answer allow it.
const chefStorage = createChefStorage({
  getServer: () => getSavedServer(),
  getToken: () => authTokenStore.get(),
  fetch: (target, init) => fetch(target, chefPin.fetchInit(target, { ...init, signal: AbortSignal.timeout(5000) }))
});

/** An empty file:// page (the origin builds before the app protocol used), for the storage move. */
function storageMigrationFileUrl() {
  const file = path.join(app.getPath('userData'), 'storage-migration.html');
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '<!doctype html><title></title>');
  } catch (_) { /* the migration reports the load failure */ }
  return require('url').pathToFileURL(file).href;
}

/**
 * Create the main application window
 * @param {string} serverUrl - Server URL to connect to
 */
function createWindow(serverUrl = null, startPage = 'dashboard.html') {
  logInfo(`Creating main window with server: ${serverUrl || 'none'}`);

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#1a1a1a',
    icon: WINDOW_ICON,
    webPreferences: {
      nodeIntegration: false, // Disable Node.js integration for security
      contextIsolation: true, // Enable context isolation for security
      preload: CLIENT_PRELOAD(), // electron-preload.js, bundled (electron-preload-path.js)
      additionalArguments: [BRAND_ARG], // read by the preload: which product's look
      sandbox: true,
      // The app is served from lana-app://app (electron-app-protocol.js), so
      // nothing needs web security off.
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // Chromium's built-in PDF viewer: the file viewer's fallback PDF iframe
      // (editor service unavailable, opened at #page=N) renders blank without it.
      plugins: true
    },
    show: false // Don't show until ready (prevents flash of white screen)
  });
  watchScreenVoiceAuthentication(mainWindow);

  // Load the v2 dashboard as the entry point (or the page an app link opens)
  const startUrl = publicPageUrl(startPage);
  mainWindow.loadURL(startUrl);
  // Links that launched the app wait for the first window (electron-app-links.js).
  mainWindow.webContents.once('did-finish-load', () => deepLinkQueue.markReady());

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

  // Window opens: the handler every webContents gets (web-contents-created).
}

// The first-launch setup screen comes before sign-in until the person has pressed Continue
// once (first-launch plan, phase D); it then moves on by itself, into the app when next is
// 'app' (a saved, signed-in server), else to the login page (electron-start-page.js).
function signInPageName(next = 'login') {
  return signInPage({ acceptedAt: firstLaunchPersistence.read().acceptedAt, next });
}

/** App URL of a page under public_html; relativeUrl may carry a ?query. */
function publicPageUrl(relativeUrl) {
  return appPageUrl(String(relativeUrl || ''));
}

/**
 * Create login window
 * With hosted discovery, we go straight to login - org resolution happens there
 */
function createLoginWindow(next = 'login') {
  logInfo('Creating login window (hosted discovery mode)');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#f3f4f6',
    icon: WINDOW_ICON,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: CLIENT_PRELOAD(),
      additionalArguments: [BRAND_ARG],
      sandbox: true,
      webSecurity: true,
      // The login page navigates this same window into the app, file viewer
      // included, so it needs the built-in PDF viewer too (see createWindow).
      plugins: true
    },
    show: false,
    resizable: true,
    frame: true,
    titleBarStyle: 'default'
  });
  watchScreenVoiceAuthentication(mainWindow);

  const loginUrl = publicPageUrl(signInPageName(next));
  mainWindow.loadURL(loginUrl);
  mainWindow.webContents.once('did-finish-load', () => deepLinkQueue.markReady());

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

  // Window opens: the handler every webContents gets (web-contents-created).
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
        // Tracked so quitting closes it (electron-confirm.js).
        trackedMessageBox(dialog, mainWindow || undefined, {
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
            trackedMessageBox(dialog, undefined, {
              type: 'info',
              title: BRAND_FLAVOR === 'lana-one' ? 'About LANA One' : 'About Lana AI',
              message: BRAND_FLAVOR === 'lana-one' ? 'LANA One' : 'Lana AI Desktop Client',
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

              const result = await trackedMessageBox(dialog, mainWindow, {
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
ipc.handle('renderer-log-error', async (event, message, error) => {
  logError(`[Renderer] ${message}`, error ? { message: error.message, stack: error.stack } : null);
});

ipc.handle('renderer-log-info', async (event, message) => {
  logInfo(`[Renderer] ${message}`);
});

// Handle configuration requests
ipc.handle('get-config', async () => {
  return {
    appVersion: getAppVersion(),
    platform: process.platform,
    arch: process.arch,
    isDevelopment: process.env.NODE_ENV === 'development',
    isLanaOne: isLanaOneEdition()
  };
});

// Handle secure storage operations
// Save the firm this app connects to (the sign-in page, and app links that
// found their firm through discovery).
async function applyServerConnection(settings) {
  // The page never sets the firm's service keys: they come from main's own discovery request
  // for this firm (discovery:resolve), or the stored ones stay for the same firm.
  const keysFrom = discoveredFirmSecrets && settings && discoveredFirmSecrets.orgId === settings.orgId
    ? discoveredFirmSecrets
    : getSavedServer();
  const stored = localEngine.toStored(keepStoredFirmSecrets(settings, keysFrom));
  const success = saveServerConnection(stored);
  if (success) {
    chefPin.settle();
    syncScreenVoiceEntitlement();
    syncBriefs(stored);
    await localEngine.sync().catch((error) => logError('[electron-main] Local AI engine did not start', error));
  }
  return success;
}

ipc.handle('save-settings', async (event, settings) => {
  const success = await applyServerConnection(settings);
  return { success };
});

// Hosted discovery for the sign-in and activation pages (js/shared/org-discovery.js). Main asks,
// keeps the firm's service keys from the answer, and returns the answer without them.
let discoveredFirmSecrets = null;
ipc.handle('discovery:resolve', (event, request) => discoveryForPage(request, {
  remember: (secrets) => { discoveredFirmSecrets = secrets; }
}));

// Get app version - use centralized version system
ipc.handle('get-version', async () => {
  return getAppVersion();
});

// Verify server connection
// The sign-in page found a firm through the control plane: pin its Chef (or
// nothing, for a cloud firm) before the page probes it. The pin covers that
// host and port only, and becomes the saved one when the firm is saved.
ipc.handle('chef-pin:prepare', async (event, server) => {
  const pinned = chefPin.prepare({ url: server && server.url, chefCertSha256: server && server.chefCertSha256 });
  return { success: true, pinned };
});

// Why the renderer could not trust that server's certificate, for the sign-in
// page's message: 'mismatch' | 'untrusted' | null.
ipc.handle('chef-pin:refusal', async (event, url) => ({ success: true, reason: chefPin.refusalForUrl(url) }));

// Login token get/set/clear/migrate for the preload (synchronous channels).
registerTokenIpc(ipc, authTokenStore, () => {
  syncScreenVoiceAuthentication().catch(() => {});
  // Sign-in, sign-out or a user switch: the engine follows this app's session.
  localEngine.sessionChanged();
  // Briefs follows it too: it stops on sign-out and starts on sign-in when enabled.
  syncBriefs();
  // Sign-out: a connect link's org id still waiting is dropped.
  if (!authTokenStore.get()) connectOrgQueue.clear();
});

// Get saved server
ipc.handle('get-saved-server', async () => {
  try {
    // url is the API base (the local engine when in use); chefUrl is the
    // organization's server.
    // Never the firm's service keys (burstApiKey, forgeApiKey): main keeps those.
    const server = withoutFirmSecrets(localEngine.present(getSavedServer()));
    return { success: true, server };
  } catch (error) {
    logError('IPC: get-saved-server failed', error);
    return { success: false, error: error.message };
  }
});

// Settings > Screen diction. Empty until the feature ships (SCREEN_DICTION_READY).
ipc.handle('capabilities:list', async () => {
  try {
    return { success: true, platform: process.platform, capabilities: currentCapabilityViewModels() };
  } catch (error) {
    logError('[Capabilities] Failed to list capabilities', error);
    return { success: false, error: 'Capabilities could not be loaded.' };
  }
});

ipc.handle('capabilities:set-active', async (_event, payload) => {
  try {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const active = payload?.active;
    if (id !== SCREEN_DICTION_ID || typeof active !== 'boolean') {
      return { success: false, error: 'Invalid setting.' };
    }
    if (!isScreenDictionEntitled()) return { success: false, error: 'Screen diction is not available yet.' };
    getCapabilityPreferencesStore().set('enabled', active);
    syncScreenVoiceEntitlement();
    return { success: true, platform: process.platform, capabilities: currentCapabilityViewModels() };
  } catch (error) {
    logError('[Screen diction] Failed to update the setting', error);
    return { success: false, error: 'The setting could not be saved.' };
  }
});

ipc.handle('capabilities:set-open-at-login', async (_event, payload) => {
  try {
    if (!isScreenDictionEntitled()) return { success: false, error: 'Screen diction is not available yet.' };
    if (!screenVoice || typeof payload?.openAtLogin !== 'boolean') {
      return { success: false, error: 'Open at Login is not available on this platform.' };
    }
    screenVoice.setOpenAtLogin(payload.openAtLogin);
    return { success: true, platform: process.platform, capabilities: currentCapabilityViewModels() };
  } catch (error) {
    logError('[Capabilities] Failed to update Open at Login', error);
    return { success: false, error: 'Open at Login could not be saved.' };
  }
});

ipc.handle('capabilities:get-voice-settings', async () => {
  if (!isScreenDictionEntitled()) return { success: false, error: 'Screen diction is not available yet.' };
  if (!screenVoice) return { success: false, error: 'The LANA Voice Agent is not available on this platform.' };
  return { success: true, settings: screenVoice.getSettings() };
});

ipc.handle('capabilities:set-voice-settings', async (_event, payload) => {
  try {
    if (!isScreenDictionEntitled()) return { success: false, error: 'Screen diction is not available yet.' };
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

ipc.handle('capabilities:get-voice-permissions', async () => {
  if (!isScreenDictionEntitled()) return { success: false, error: 'Screen diction is not available yet.' };
  if (!screenVoice) return { success: false, error: 'The LANA Voice Agent is not available on this platform.' };
  try { return { success: true, permissions: await screenVoice.permissionStatus() }; }
  catch (_) { return { success: false, error: 'Permission status is temporarily unavailable.' }; }
});

ipc.handle('capabilities:request-voice-permission', async (_event, payload) => {
  const type = payload?.type;
  if (!isScreenDictionEntitled()) return { success: false, error: 'Screen diction is not available yet.' };
  if (!screenVoice || !['microphone', 'accessibility'].includes(type)) {
    return { success: false, error: 'Invalid permission request.' };
  }
  try { return { success: true, permissions: await screenVoice.requestPermission(type) }; }
  catch (_) { return { success: false, error: 'The permission request could not be opened.' }; }
});


// Session Tracking IPC Handlers
// Initialize the session tracker with this app's API base and login token. Both come from the
// main process: the page names neither, so it cannot send the token to another address.
ipc.handle('session-tracker:initialize', async () => {
  try {
    const backendUrl = localEngine.apiBase();
    const authToken = authTokenStore.get();
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
ipc.handle('open-external-url', async (event, url) => externalOpener.open(url, { contents: event.sender }));

// ───────────────────────────────────────────────────────────────────────────
// Brainchild MCP bridge — renderer-facing read API (thin; spawn/IPC only here)
// ───────────────────────────────────────────────────────────────────────────

// Auto-discover an install + vault from OS defaults. Pure-helper backed.
ipc.handle('brainchild:discover', async () => {
  try {
    return { success: true, ...discover() };
  } catch (error) {
    logError('[electron-main] brainchild:discover failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

// Establish + persist the link, then validate. Communicate via MCP only AFTER
// the link is persisted and verified.
ipc.handle('brainchild:link', async (_event, payload) => {
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

ipc.handle('brainchild:status', async () => {
  try {
    return { success: true, ...brainchildManager.getStatus() };
  } catch (error) {
    logError('[electron-main] brainchild:status failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

ipc.handle('brainchild:listNotes', async (_event, payload) => {
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

ipc.handle('brainchild:search', async (_event, payload) => {
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

ipc.handle('brainchild:getNote', async (_event, payload) => {
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
ipc.handle('brainchild:pickInstall', async (event) => {
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
    // The person answered our folder dialog: the vault picker that follows counts it as their gesture.
    ipcGestures.mark(event.sender);
    return { success: true, installPath, mcpBin };
  } catch (error) {
    logError('[electron-main] brainchild:pickInstall failed', error);
    return { success: false, error: String(error && error.message || error) };
  }
});

// Native folder picker for the Brainchild VAULT directory. Returns the chosen
// path for the renderer to pass to brainchild:link as vaultPath.
ipc.handle('brainchild:pickVault', async () => {
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
ipc.handle('brainchild:unlink', async () => {
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
ipc.handle('brainchild:revealNote', async (event, payload) => {
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
    // The app asks before showing a file from the vault (electron-confirm.js).
    if (!(await confirmFor('revealNote', { file: resolved }, event.sender))) return { success: false, cancelled: true };
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

ipc.handle('generate-oauth-state', async () => {
  return generateOAuthState();
});

ipc.handle('check-updates', async (event, serverUrl) => {
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
ipc.handle('install-update', async (event, serverUrl) => {
  // The app asks, not the page: it quits and restarts (electron-confirm.js).
  if (!(await confirmFor('installUpdate', { version: (getLastCheckResult() || {}).version }, event.sender))) return { success: false, cancelled: true };
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
// Settings > Capabilities > AI: local model servers, the server, Forge (electron-ai-topology.js).
registerAiTopologyIpc(ipc, {
  env: process.env,
  savedServer: () => getSavedServer(),
  fetchImpl: chefPin.pinnedFetch(),
  catalog: localModelsCatalog.CATALOG,
  speechCatalog: localModelsCatalog.SPEECH_CATALOG,
  modelsDir: () => localModelsCatalog.modelsDir(process.env, app.getPath('userData')),
  logError
});

// Settings > General: About, Software update, Language & region (electron-system-info.js).
registerSystemInfoIpc(ipc, {
  app,
  displayVersion: getAppVersion,
  checkForUpdates,
  lastChecked: getLastUpdateCheck,
  lastResult: getLastCheckResult,
  savedServer: () => getSavedServer(),
  installUpdate: (serverUrl) => checkAndHandleUpdates(serverUrl, { notifyUpToDate: true }),
  logError
});

// Settings > General > Location: whether the person turned it on (electron-location.js).
registerLocationIpc(ipc, { persistence: locationPersistence, shell, platform: process.platform, isPackaged: app.isPackaged });

const bridgeConsentsStore = new Store({
  name: 'bridge-consents',
  defaults: { consents: {} }
});

ipc.handle('settings:list-bridge-consents', async () => {
  try {
    const consents = bridgeConsentsStore.get('consents', {}) || {};
    return consents;
  } catch (error) {
    logError('[settings] Failed to list bridge consents', error);
    return {};
  }
});

ipc.handle('settings:revoke-bridge-consent', async (_event, payload) => {
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
 *   lana-ai://open?route=<client-route>&... — Open an allowlisted client page
 *   lana-ai://file/<file-id>                — Open file viewer
 *   lana-ai://workspace/<matter-id>         — Open workspace detail
 *   lana-ai://approval/<approval-id>        — Open approval detail
 *   lana-ai://agent-run/<run-id>            — Open agent run
 *   lana-ai://automation/<automation-id>    — Open automation detail
 *   lana-ai://reset-password|accept-invite|activate|sign|shared?...
 *                                           Links from Chef's emails (electron-app-links.js)
 */
const handleDeepLink = async (deepLinkUrl) => {
  logInfo(`Deep link received: ${redactUrlForLog(deepLinkUrl)}`);

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
      case 'open':
      case 'file':
      case 'workspace':
        await navigateClientDeepLink(urlObj);
        break;
      case 'reset-password':
      case 'accept-invite':
      case 'activate':
      case 'sign':
      case 'shared':
        await appLinkRouter.handleUrl(deepLinkUrl);
        break;
      default:
        logInfo(`Unknown deep link route: ${route}`);
        break;
    }
  } catch (error) {
    // Logged only: a modal here (inside open-url / second-instance) froze the main process.
    logError('Failed to handle deep link', error);
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
  // A callback without a state, or with one this app did not issue, is refused: any website can open this link.
  if (!oauthStates.acceptsCallback(state)) {
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
  // Any website can open this link: only an id matching the org id pattern is used, and it
  // reaches the sign-in page as data over IPC (login.html onConnectLink / takeConnectLink), never as script.
  // An invalid link is reported on the sign-in page, never in a modal: a sync dialog here
  // (inside open-url / second-instance) froze the main process until it was killed.
  const orgId = connectLinkOrgId(urlObj);
  if (!orgId) logError('No valid org ID in connect deep link');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    // An open sign-in page fills it in (or shows the error); on any other page the link is not used.
    if (pageOf(mainWindow.webContents.getURL()) === 'login.html') {
      if (orgId) mainWindow.webContents.send('connect-link:org', { orgId });
      else mainWindow.webContents.send('connect-link:org', { error: 'invalid_link' });
    } else {
      logInfo('[DeepLink] Connect link ignored: the sign-in page is not showing');
    }
  } else {
    // The sign-in window opened for this link takes it once its page is ready
    // (connect-link:take); no other window or later sign-in page gets it.
    createLoginWindow();
    const contentsId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : undefined;
    if (orgId) connectOrgQueue.offer(orgId, contentsId);
    else connectOrgQueue.offerError(contentsId);
  }
};
const connectOrgQueue = createConnectOrgQueue();
ipc.handle('connect-link:take', (event) => connectOrgQueue.take(event.sender.id) || { orgId: null, error: null });

// App links from Chef's emails (electron-app-links.js). The router decides the
// firm and sign-in; these are the window, dialog and storage pieces it uses.
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

async function openAppLinkPage(relativeUrl) {
  if (!showMainWindow()) {
    const saved = getSavedServer();
    createWindow(saved ? saved.url : null, relativeUrl);
    return;
  }
  await mainWindow.loadURL(publicPageUrl(relativeUrl));
}

async function openAppLinkSignIn() {
  if (!showMainWindow()) {
    createLoginWindow();
    return;
  }
  await mainWindow.loadURL(publicPageUrl(signInPageName()));
}

async function appLinkMessage(options) {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  // Tracked so quitting closes it (electron-confirm.js).
  return trackedMessageBox(dialog, parent, { type: 'info', noLink: true, ...options });
}

// Switching firms from a link ends the session on the old firm's Chef too,
// then clears this computer; an unreachable firm never blocks the switch.
const signOutOfFirm = createFirmSignOut({
  getSavedServer: () => getSavedServer(),
  getToken: () => authTokenStore.get(),
  fetch: (url, init) => fetch(url, chefPin.fetchInit(url, { ...init, signal: AbortSignal.timeout(5000) })),
  clearLocal: async () => {
    authTokenStore.clear();
    clearSavedServer();
    syncScreenVoiceEntitlement();
    syncBriefs(null);
    await localEngine.sync().catch((error) => logError('[electron-main] Local AI engine did not stop', error));
  },
  log: (message) => logInfo(`[AppLinks] ${message}`)
});

const appLinkRouter = createAppLinkRouter({
  getSavedServer: () => getSavedServer(),
  isSignedIn: () => hasLiveSession(authTokenStore.get(), Date.now()),
  discover: (domain, orgIdHint) => discoverByDomain(domain, orgIdHint),
  connect: (server) => applyServerConnection(server),
  signOut: signOutOfFirm,
  tellOldSessionOpen: (info) => appLinkMessage({ ...oldSessionNotice(info), buttons: ['OK'] }),
  askSwitch: async ({ domain, firmName }) => {
    const { response } = await appLinkMessage({
      title: 'This link is for another firm',
      message: `This link is for ${domain}.`,
      detail: `This app is connected to ${firmName}. To open the link, LANA signs you out of ${firmName} and connects to the firm in the link.`,
      buttons: [`Stay with ${firmName}`, 'Switch firm'],
      defaultId: 0,
      cancelId: 0
    });
    return response === 1 ? 'switch' : 'stay';
  },
  askNotFound: async ({ domain, firmName }) => {
    const { response } = await appLinkMessage({
      type: 'warning',
      title: 'Firm not found',
      message: `LANA could not find the firm for ${domain}.`,
      detail: `You can stay with ${firmName}, or sign out and connect to the firm yourself on the sign-in screen.`,
      buttons: [`Stay with ${firmName}`, 'Connect on sign in'],
      defaultId: 0,
      cancelId: 0
    });
    return response === 1 ? 'sign-in' : 'stay';
  },
  tellInvalid: () => appLinkMessage({
    type: 'warning',
    title: 'Link not recognized',
    message: 'This link could not be opened.',
    detail: 'It may be incomplete. Open it again from the email, or ask for a new one.',
    buttons: ['OK']
  }),
  openPage: openAppLinkPage,
  openSignIn: openAppLinkSignIn,
  log: (message) => logInfo(`[AppLinks] ${message}`)
});
registerAppLinkIpc(ipc, appLinkRouter);

// Deep links that arrive before the first window has loaded (the app was
// launched by the link) wait for it; every route goes through this.
const deepLinkQueue = createColdStartQueue((url) => handleDeepLink(url));
const launchDeepLink = deepLinkFromArgv(process.argv);
if (launchDeepLink) deepLinkQueue.receive(launchDeepLink);

// Handle deep links on macOS (cold start included: open-url can fire before the window exists)
app.on('open-url', (event, url) => {
  event.preventDefault();
  deepLinkQueue.receive(url);
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
    const url = deepLinkFromArgv(commandLine);
    if (url) {
      deepLinkQueue.receive(url);
    }
  });
}

/**
 * Application lifecycle events
 */

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  // OS power, sleep, lid and network signals for the local engine (phase 8d).
  try {
    const { powerMonitor, net } = require('electron');
    const { execFile } = require('child_process');
    const run = (command, args) => new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 3000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
    });
    const readFile = (file) => require('fs').promises.readFile(file, 'utf8');
    localEngine.attachOsSignals((onChange) => createOsSignals({ powerMonitor, net, run, readFile, onChange })).start();
  } catch (error) {
    logError('[electron-main] OS signals for the local AI engine are not available', error);
  }

  logInfo('App ready, starting thin client initialization...');

  // Model downloads cut off last time pick up again in the background.
  void redactor.start().catch((error) => logError('[electron-main] The redactor did not start', error));
  // Docling waits for first-launch setup unless it is set up another way (electron-docling.js).
  if (shouldStartDocling(resolveDocling(), { setupDone: Boolean(firstLaunchPersistence.read().completedAt) })) {
    void docling.start().catch((error) => logError('[electron-main] Docling did not start', error));
  }
  void editorService.start().catch((error) => logError('[electron-main] The LANA document editor did not start', error));
  void firstLaunch.resume();

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

  // The box Chef's certificate check for the renderer, before any window (and
  // so before the sign-in page's /api/health/discovery probe) exists.
  chefPin.installCertificateVerifyProc(session.defaultSession, logInfo);

  // Geolocation only for the app's own pages, and only after the person turned Location on
  // in Settings. Every other permission keeps Electron's default.
  appPermissions = installLocationPermissionHandlers(session.defaultSession, {
    appRoot: path.join(__dirname, 'public_html'),
    isAllowed: () => locationPersistence.read().allowed
  });

  // The app's own pages, from lana-app://app/public_html/ with their CSP
  // (electron-app-protocol.js, electron-csp.js; docs/plans/harden-web.md).
  const appRoot = path.join(__dirname, 'public_html');
  protocol.handle(APP_SCHEME, createAppProtocolHandler({
    appRoot,
    fetchFile: (fileUrl, init) => require('electron').net.fetch(fileUrl, init),
    buildPolicy: ({ page, nonce, handlerHashes }) => buildContentSecurityPolicy({
      page,
      nonce,
      handlerHashes,
      origins: currentCspOrigins()
    })
  }));

  // Builds before the app protocol kept renderer localStorage on file://: copy it once.
  await migrateFileOriginStorage({
    store: migrationStore,
    // A WebContentsView, not a BrowserWindow: closing it must not count as the
    // last window closing (window-all-closed quits on Windows and Linux).
    createPage: () => {
      const { WebContentsView } = require('electron');
      const view = new WebContentsView({
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
      });
      return {
        loadURL: (target) => view.webContents.loadURL(target),
        webContents: view.webContents,
        destroy: () => view.webContents.close()
      };
    },
    fileOriginUrl: storageMigrationFileUrl(),
    appOriginUrl: `${APP_ORIGIN}${STORAGE_MIGRATION_PATH}`,
    log: logInfo
  });

  // The app's own pages calling the local editor's /v1 API get its token added here.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let pageUrl = '';
    try {
      pageUrl = (details.frame && details.frame.url) || (details.webContents && details.webContents.getURL()) || '';
    } catch (_error) { pageUrl = ''; }
    callback({ requestHeaders: editorService.requestHeaders({ url: details.url, pageUrl, resourceType: details.resourceType, headers: details.requestHeaders }) });
  });

  // CORS for the app origin, answered here for the configured origins only
  // (electron-cors.js); every other site's headers pass through untouched.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback(corsResponseFor(details, { appOrigin: APP_ORIGIN, allowedOrigins: currentCspOrigins().api }));
  });

  // Initialize session tracker
  sessionTracker = new SessionTracker({
    ipcMain: ipc,
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
        brandFlavor: BRAND_FLAVOR,
        getMainWindow: () => mainWindow,
        getAuthToken: () => authTokenStore.get(),
        getSavedServer: () => localEngine.present(getSavedServer()),
        openClientSettings: openScreenVoiceSettings,
        navigateClient: navigateScreenVoiceClient,
        openExternalUrl: openScreenVoiceResearchUrl,
        notifyUser: notifyScreenVoiceInputRequired,
        ensureDockIcon: applyDockIcon,
        entitlementEnabled: isScreenDictionActive(screenDictionPreference(), process.platform),
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
  // consents. The bridge asks the token store for the bearer token and reads
  // the user id from the renderer on demand; it never caches or logs the token.
  try {
    companionBridge.start({
      // The token comes from the main-process token store, never renderer storage.
      getToken: async () => authTokenStore.get() || null,
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

  // On macOS, re-create a window when the dock icon is clicked and none is open. Registered here,
  // before the saved-server start returns, so it works on every startup path.
  registerDockReopen(app, {
    windowOpen: () => Boolean(mainWindow && !mainWindow.isDestroyed()),
    startupDone: () => startupDone,
    getSavedServer,
    acceptedAt: () => firstLaunchPersistence.read().acceptedAt,
    createWindow,
    createLoginWindow
  });

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
      syncScreenVoiceEntitlement();
      syncBriefs(refreshedServer);
    }

    // The setup screen is the one consent step for local AI, so an install that never pressed
    // Continue sees it first even with a saved, signed-in server; it then goes into the app.
    const startFacts = {
      savedServer: effectiveServer,
      reachable: isReachable,
      liveSession: hasLiveSession(authTokenStore.get(), Date.now()),
      offlineReady: localEngine.canOpenOffline()
    };
    const firstPage = startPage({ ...startFacts, acceptedAt: firstLaunchPersistence.read().acceptedAt });
    if (pageAfterSetup(startFacts) === 'app') {
      if (isReachable) {
        logInfo('[electron-main] Saved server is reachable, loading main app...');
        updateLastVerified();
      } else {
        // Phase 10: offline. Keep the saved server and open with the local
        // engine, which answers the person's own chats and documents from the
        // offline copy until the server is back.
        logInfo('[electron-main] Saved server is not reachable; opening with the local engine and its offline copy');
      }
      await localEngine.sync().catch((error) => logError('[electron-main] Local AI engine did not start', error));
      await localEngine.untilReady();
      if (firstPage === 'first-launch') {
        logInfo('[electron-main] Local AI setup was never accepted; showing the setup screen before the app');
        startupDone = true;
        createLoginWindow('app');
      } else {
        startupDone = true;
        createWindow(effectiveServer.url);
      }
      syncBriefs(effectiveServer);
      return;
    } else {
      logInfo('[electron-main] Saved server is not reachable, clearing saved server and showing login...');
      clearSavedServer();
      syncScreenVoiceEntitlement();
      syncBriefs(null);
    }
  } else {
    logInfo('[electron-main] No saved server found, showing login...');
  }

  // No saved server or unreachable - show login page
  startupDone = true;
  createLoginWindow();

});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle application quit. The local servers stop once (electron-quit-gate.js); a second Cmd-Q
// or SIGTERM during the engine's job handoff waits for that same shutdown.
const { createQuitGate } = require('./electron-quit-gate');
const quitGate = createQuitGate({
  // Briefs first drains its calls and closes its store, then the local AI engine hands its
  // running background jobs off to the organization's cloud (up to 12 s) and stops.
  cleanup: () => briefs.stop()
    .catch((error) => logError('[electron-main] Failed to stop LANA Briefs', error))
    .then(() => localEngine.prepareQuit())
    .catch((error) => logError('[electron-main] Failed to stop the local AI engine', error))
    // Pip last: the engine may still be handing a job off through it.
    .then(() => firstLaunch.pause())
    .then(() => Promise.all([pip.stop(), redactor.stop(), docling.stop(), editorService.stop()]))
    .catch((error) => logError('[electron-main] Failed to stop Pip', error)),
  quit: () => app.quit(),
  log: (message, error) => logError(message, error)
});
app.on('before-quit', async (event) => {
  // A question still open (electron-confirm.js) is answered as Cancel, so it never holds the quit.
  cancelAllPrompts();
  if (!quitGate.beforeQuit(event)) return;

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

  // End session tracking
  if (sessionTracker) {
    await sessionTracker.shutdown();
    logInfo('[electron-main] Session tracker shut down');
  }
});

// Every webContents (app windows, popups, the update dialog, the Briefs capture
// window): main-frame navigation, window opens and webviews are guarded here.
app.on('web-contents-created', (event, contents) => {
  const appRoot = path.join(__dirname, 'public_html');

  // App pages load; root-relative app paths and old file:// links to app pages
  // are rewritten; http(s) and mailto open in the system browser
  // (src/electron-external-url.js); anything else is refused
  // (electron-navigation-policy.js).
  contents.on('will-navigate', (navigationEvent, navigationUrl) => {
    const decision = decideNavigation(navigationUrl, { appRoot });
    if (decision.action === 'allow') return;
    navigationEvent.preventDefault();
    if (decision.action === 'redirect') {
      contents.loadURL(decision.url);
    } else if (decision.action === 'external') {
      externalOpener.open(decision.url, { contents }).catch(() => {});
    } else {
      logInfo(`[electron-main] [Navigation] Refused: ${redactUrlForLog(String(navigationUrl))}`);
    }
  });

  // Frames inside a page: a custom scheme (foo://, ms-settings:) is never handed to the
  // operating system from a frame; mail and vault links go through the app's opener
  // (electron-navigation-policy.js decideFrameNavigation, electron-external-open.js).
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    const decision = decideFrameNavigation(details.url);
    if (decision.action === 'allow') return;
    details.preventDefault();
    // Judged by the frame that started it; with no initiator known, it is refused.
    if (decision.action === 'external' && details.initiator) {
      externalOpener.open(decision.url, { contents, fromFrame: details.initiator }).catch(() => {});
    } else {
      logInfo(`[electron-main] [Navigation] Refused a frame navigation: ${redactUrlForLog(String(details.url))}`);
    }
  });

  // A redirect may only land on an app page (the app protocol never redirects).
  contents.on('will-redirect', (navigationEvent, navigationUrl, isInPlace, isMainFrame) => {
    if (isMainFrame === false) return;
    if (decideNavigation(navigationUrl, { appRoot }).action !== 'allow') navigationEvent.preventDefault();
  });

  // http(s) goes to the system browser; app pages, about:blank and blob:
  // open isolated (no preload, web security on); javascript:, data:, file:
  // and other schemes are denied (electron-window-open-policy.js).
  contents.setWindowOpenHandler(({ url: openUrl, referrer }) => {
    const decision = decideWindowOpen(openUrl, { appRoot });
    if (decision.external) {
      // Any frame can call window.open: the link opens only for the app's own frames,
      // after a click or a yes in the app's dialog, within a rate limit (electron-external-open.js).
      externalOpener.open(decision.external, { contents, fromWindowOpen: true, openerUrl: (referrer && referrer.url) || '' }).catch(() => {});
      return { action: 'deny' };
    }
    return decision.response;
  });

  // The app uses no <webview>.
  contents.on('will-attach-webview', (attachEvent) => attachEvent.preventDefault());

  // Development: CSP violations from any page show in the main log too.
  if (process.env.NODE_ENV === 'development') {
    contents.on('console-message', (consoleEvent, level, message) => {
      const text = (consoleEvent && typeof consoleEvent.message === 'string') ? consoleEvent.message : String(message || '');
      if (text.includes('Content Security Policy')) {
        logWarn(`[csp] ${redactUrlForLog(contents.getURL())}: ${text}`);
      }
    });
  }
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
