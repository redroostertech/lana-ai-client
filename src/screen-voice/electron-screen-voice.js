'use strict';

const path = require('path');
const Store = require('electron-store');
const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell, systemPreferences } = require('electron');
const { VoiceSessionController } = require('./voice-session-controller');
const { createDesktopAdapter } = require('./desktop-adapter');
const { VoiceApiClient } = require('./voice-api-client');
const { DEFAULT_SETTINGS, parseAgentDecision, parseSettings } = require('./contracts');
const { fingerprintsMatch } = require('./target-fingerprint');
const { decisionRequiresConfirmation } = require('./confirmation-policy');
const { actionText, normalizeText } = require('./action-normalizer');
const { runHelper, startShortcutMonitor } = require('./native-helper');

const MAX_AUDIO_BASE64_CHARS = 16 * 1024 * 1024;
const NON_SPEECH_TRANSCRIPT = /^[\s([{<]*(?:beep|chime|tone|silence|inaudible|no speech|music)[\s)\]}>.!-]*$/i;
const CAPTURE_STATUSES = new Set([
  'requesting_microphone', 'microphone_ready', 'start_chime', 'recording_started',
  'recording_released', 'audio_ready', 'capture_failed'
]);
const COMPACT_OVERLAY = Object.freeze({ width: 480, height: 58 });
const MODE_MENU_OVERLAY = Object.freeze({ width: 480, height: 190 });
const PREVIEW_OVERLAY = Object.freeze({ width: 520, height: 360 });
const DETAILS_OVERLAY = Object.freeze({ width: 480, height: 190 });
const EXPECTED_USER_ERRORS = new Set([
  'accessibility_permission_denied', 'MICROPHONE_DENIED', 'target_not_editable', 'secure_field', 'NO_SPEECH'
]);

function publicError(error) {
  const code = error?.code || 'VOICE_ERROR';
  const messages = {
    accessibility_permission_denied: 'Allow Accessibility access in System Settings so LANA can understand and safely update the active application.',
    PLATFORM_UNSUPPORTED: 'The desktop LANA voice agent is not yet available on this operating system.',
    TARGET_CHANGED: 'The active application or text field changed. Nothing was inserted.',
    target_changed: 'The active application or text field changed. Nothing was inserted.',
    target_not_editable: 'LANA can still answer questions here, but this application does not expose an editable target.',
    secure_field: 'Voice insertion is disabled in password and secure fields.',
    AUTH_REQUIRED: 'Sign in to LANA before using voice features.',
    NETWORK_UNAVAILABLE: 'The voice service is unavailable. Check your connection and try again.',
    REQUEST_CANCELED: 'The voice request was canceled.',
    native_helper_unavailable: 'The desktop accessibility component is unavailable. Reinstall or update LANA.',
    MICROPHONE_DENIED: 'Allow microphone access in System Settings to use voice features.',
    MICROPHONE_UNAVAILABLE: 'No usable microphone is available. Check the selected input device.',
    MICROPHONE_DISCONNECTED: 'The microphone disconnected while LANA was listening.',
    AUDIO_TOO_LARGE: 'That recording is too long. Try a shorter voice request.',
    TRANSCRIPTION_FAILED: 'LANA could not transcribe that recording. Please try again.',
    PROVIDER_ERROR: 'The voice or agent provider could not complete the request.',
    INSERTION_FAILED: 'LANA generated the text but could not safely insert it. Use Copy instead.',
    UNDO_FAILED: 'The last voice edit could not be undone in the current application.',
    NO_SPEECH: 'No speech was detected. Try again when you are ready.',
    FEATURE_NOT_ENABLED: 'The desktop LANA voice agent is not enabled for this organization.'
  };
  return { code, message: messages[code] || error?.message || 'Voice action could not be completed.' };
}

function fingerprintDifferenceLabels(expected = {}, actual = {}) {
  const labels = ['processId', 'bundleId', 'processName', 'windowTitle', 'role', 'name']
    .filter((key) => expected[key] !== actual[key]);
  if (JSON.stringify(expected.bounds || null) !== JSON.stringify(actual.bounds || null)) labels.push('bounds');
  return labels.join(',') || 'unknown';
}

class ElectronScreenVoice {
  constructor(options = {}) {
    this.getMainWindow = options.getMainWindow;
    this.getSavedServer = options.getSavedServer;
    this.openClientSettings = options.openClientSettings || (() => false);
    this.navigateClient = options.navigateClient || (async () => false);
    this.openExternalUrl = options.openExternalUrl || (async () => false);
    this.notifyUser = options.notifyUser || (() => {});
    this.ensureDockIcon = options.ensureDockIcon || (() => false);
    this.logInfo = options.logInfo || (() => {});
    this.logError = options.logError || (() => {});
    this.rootDir = options.rootDir || path.resolve(__dirname, '..', '..');
    this.controller = new VoiceSessionController();
    this.adapter = options.adapter || createDesktopAdapter({ clipboard, rootDir: this.rootDir });
    this.settingsStore = options.settingsStore || new Store({ name: 'screen-voice-settings', defaults: DEFAULT_SETTINGS });
    this.settings = parseSettings(this.settingsStore.store);
    if (this.settingsStore.store.agentShortcut !== this.settings.agentShortcut) {
      this.settingsStore.set('agentShortcut', this.settings.agentShortcut);
    }
    if (this.settingsStore.store.captureShortcut !== this.settings.captureShortcut) {
      this.settingsStore.set('captureShortcut', this.settings.captureShortcut);
    }
    this.api = options.api || new VoiceApiClient({
      getServerUrl: async () => this.getSavedServer()?.url || null,
      getToken: async () => this.getAuthToken()
    });
    this.overlay = null;
    this.ipcRegistered = false;
    this.lastContext = null;
    this.previewDecision = null;
    this.pendingMode = 'agent';
    this.conversationTurns = [];
    this.conversationMemory = '';
    this.detailsOpen = true;
    this.revealTarget = null;
    this.shortcutMonitor = null;
    this.shortcutMonitorReady = false;
    this.shortcutHeldMode = null;
    this.shortcutStartPromise = null;
    this.shortcutStartSource = null;
    this.pendingShortcutRelease = null;
    this.shortcutMonitorFactory = options.shortcutMonitorFactory || startShortcutMonitor;
    this.microphoneHardwareStatus = options.microphoneHardwareStatus || (() => (
      runHelper('microphone-status', {}, { rootDir: this.rootDir })
    ));
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.entitlementEnabled = Boolean(options.entitlementEnabled);
    this.authenticated = Boolean(options.authenticated);
    this.controller.on('state', (snapshot) => {
      const mode = snapshot.session?.mode ? ` mode=${snapshot.session.mode}` : '';
      const error = snapshot.session?.error?.code ? ` error=${snapshot.session.error.code}` : '';
      this.logInfo(`[ScreenVoice] State=${snapshot.state}${mode}${error}`);
      this.sendState(snapshot);
    });
  }

  async getAuthToken() {
    const window = this.getMainWindow();
    if (!window || window.isDestroyed()) return null;
    try {
      return await window.webContents.executeJavaScript(
        "(() => { try { return localStorage.getItem('token'); } catch (_) { return null; } })()", true
      );
    } catch (_) { return null; }
  }

  createOverlay() {
    if (this.overlay && !this.overlay.isDestroyed()) return this.overlay;
    this.overlay = new BrowserWindow({
      width: COMPACT_OVERLAY.width, height: COMPACT_OVERLAY.height,
      minWidth: 400, minHeight: 52, maxWidth: 560, maxHeight: 560,
      frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true,
      skipTaskbar: process.platform !== 'darwin', resizable: true, focusable: false, show: false, hasShadow: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        preload: path.join(this.rootDir, 'screen-voice-preload.js')
      }
    });
    this.overlay.setAlwaysOnTop(true, 'floating');
    this.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const rendererRoot = app.isPackaged ? 'public_html' : 'src';
    this.overlay.loadFile(path.join(this.rootDir, rendererRoot, 'screen-voice', 'overlay', 'index.html'));
    this.overlay.on('focus', () => { this.sendPermissionStatus().catch(() => {}); });
    this.overlay.on('closed', () => { this.overlay = null; });
    this.positionOverlay();
    return this.overlay;
  }

  positionOverlay() {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = this.overlay.getBounds();
    this.overlay.setPosition(Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
      Math.round(display.workArea.y + 14), false);
  }

  overlayLayout(state = this.controller.state) {
    if (state === 'previewing') return PREVIEW_OVERLAY;
    if (this.detailsOpen) return DETAILS_OVERLAY;
    return COMPACT_OVERLAY;
  }

  resizeOverlay(layout = this.overlayLayout()) {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    const width = Math.max(400, Math.min(560, Number(layout.width) || COMPACT_OVERLAY.width));
    const height = Math.max(52, Math.min(560, Number(layout.height) || COMPACT_OVERLAY.height));
    this.overlay.setSize(width, height, true);
  }

  showOverlay({ focus = false, width, height } = {}) {
    const overlay = this.createOverlay();
    this.resizeOverlay(width || height ? { width, height } : this.overlayLayout());
    this.positionOverlay();
    this.ensureDockIcon();
    if (process.platform === 'darwin' && app.dock) app.dock.show().catch(() => {});
    overlay.setFocusable(Boolean(focus));
    focus ? overlay.show() : overlay.showInactive();
  }

  send(channel, payload) {
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.webContents.send(channel, payload);
  }

  sendState(snapshot = this.controller.snapshot()) {
    this.resizeOverlay(this.overlayLayout(snapshot.state));
    this.positionOverlay();
    this.send('screen-voice:state', { ...snapshot, settings: this.settings, selectedMode: this.pendingMode });
  }

  isOverlaySender(event) {
    return Boolean(this.overlay && !this.overlay.isDestroyed() && event.sender.id === this.overlay.webContents.id);
  }

  registerIpc() {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;
    const handle = (channel, fn) => ipcMain.handle(channel, async (event, payload) => {
      if (!this.isOverlaySender(event)) throw new Error('Unauthorized screen voice IPC sender');
      return fn(payload || {});
    });
    handle('screen-voice:get-state', async () => ({
      ...this.controller.snapshot(), settings: this.settings, selectedMode: this.pendingMode
    }));
    handle('screen-voice:get-permissions', () => this.permissionStatus());
    handle('screen-voice:activate', () => this.toggle('agent', 'overlay'));
    handle('screen-voice:capture-start', () => this.handleShortcutDown('agent', 'overlay_hold'));
    handle('screen-voice:capture-release', () => this.handleOverlayCaptureRelease());
    handle('screen-voice:audio-complete', (payload) => this.handleAudio(payload));
    handle('screen-voice:capture-error', ({ code }) => this.fail(code || 'MICROPHONE_DENIED'));
    handle('screen-voice:capture-status', ({ status, metadata }) => {
      if (!CAPTURE_STATUSES.has(status)) return { ok: false };
      const trackCount = Math.max(0, Math.min(8, Number(metadata?.trackCount) || 0));
      const bytes = Math.max(0, Number(metadata?.bytes) || 0);
      const detail = trackCount ? ` tracks=${trackCount}` : bytes ? ` bytes=${bytes}` : '';
      this.logInfo(`[ScreenVoice] Capture ${status}${detail}`);
      return { ok: true };
    });
    handle('screen-voice:cancel', () => this.cancel());
    handle('screen-voice:confirm', ({ sessionId }) => this.confirm(sessionId));
    handle('screen-voice:copy', ({ text }) => this.copy(text));
    handle('screen-voice:undo', () => this.undo());
    handle('screen-voice:open-settings', () => {
      const opened = this.openClientSettings();
      return { ok: Boolean(opened) };
    });
    handle('screen-voice:open-details', () => {
      this.detailsOpen = true;
      this.showOverlay({ focus: true, ...DETAILS_OVERLAY });
      return { ok: true };
    });
    handle('screen-voice:close-details', () => {
      this.detailsOpen = false;
      const focus = this.controller.state === 'previewing';
      this.showOverlay({ focus, ...this.overlayLayout() });
      return { ok: true };
    });
    handle('screen-voice:mode-menu', ({ open }) => {
      const openLayout = this.detailsOpen ? DETAILS_OVERLAY : MODE_MENU_OVERLAY;
      this.showOverlay({ focus: Boolean(open), ...(open ? openLayout : this.overlayLayout()) });
      return { ok: true };
    });
    handle('screen-voice:resize-overlay', ({ height }) => {
      const bounds = this.overlay?.getBounds();
      if (!bounds) return { ok: false };
      this.resizeOverlay({ width: bounds.width, height });
      this.positionOverlay();
      return { ok: true };
    });
    handle('screen-voice:dismiss', () => { this.detailsOpen = true; this.overlay?.hide(); return { ok: true }; });
  }

  initialize() {
    this.registerIpc();
    if (!this.entitlementEnabled) {
      this.logInfo('[ScreenVoice] Capability is not enabled for this organization');
      return;
    }
    if (!this.authenticated) {
      this.logInfo('[ScreenVoice] Waiting for an authenticated session');
      return;
    }
    this.registerShortcuts();
    if (this.settings.openAtLogin) {
      this.showOverlay();
      this.sendState();
    }
  }

  setAuthenticated(authenticated) {
    const next = Boolean(authenticated);
    if (next === this.authenticated) return { authenticated: next, changed: false };
    this.authenticated = next;

    if (next) {
      if (this.entitlementEnabled) {
        this.registerShortcuts();
        if (this.settings.openAtLogin) {
          this.showOverlay();
          this.sendState();
        }
        this.logInfo('[ScreenVoice] Authenticated session available');
      } else {
        this.logInfo('[ScreenVoice] Authenticated; capability is not enabled');
      }
    } else {
      this.deactivateHost('signed_out');
      this.logInfo('[ScreenVoice] Voice controls unavailable while signed out');
    }
    return { authenticated: next, changed: true };
  }

  deactivateHost(reason) {
    this.send('screen-voice:stop-capture', { discard: true });
    this.controller.cancel(reason);
    this.unregisterShortcut(this.settings.dictationShortcut);
    this.unregisterShortcut(this.settings.agentShortcut);
    this.stopShortcutMonitor();
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
    this.overlay = null;
    if (reason === 'signed_out' || reason === 'capability_disabled') {
      this.conversationTurns = [];
      this.conversationMemory = '';
    }
  }

  setEntitlementEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.entitlementEnabled) return { enabled: next, changed: false };
    this.entitlementEnabled = next;

    if (next) {
      if (this.authenticated) {
        this.registerShortcuts();
        if (this.settings.openAtLogin) {
          this.showOverlay();
          this.sendState();
        }
        this.logInfo('[ScreenVoice] Capability enabled by discovery');
      } else {
        this.logInfo('[ScreenVoice] Capability enabled; waiting for authentication');
      }
    } else {
      this.deactivateHost('capability_disabled');
      this.logInfo('[ScreenVoice] Capability disabled by discovery');
    }
    return { enabled: next, changed: true };
  }

  registerShortcuts() {
    this.stopShortcutMonitor();
    this.unregisterShortcut(this.settings.dictationShortcut);
    this.unregisterShortcut(this.settings.agentShortcut);
    if (!this.entitlementEnabled || !this.authenticated || !this.settings.enabled) return;
    const register = (shortcut, label, action) => {
      try {
        if (!globalShortcut.register(shortcut, action)) {
          this.logError(`[ScreenVoice] Shortcut unavailable: ${label}`);
          return false;
        }
        return true;
      } catch (_) {
        // A bad persisted accelerator must never prevent the other mode from
        // registering or abort discovery/settings IPC.
        this.logError(`[ScreenVoice] Shortcut could not be registered: ${label}`);
        return false;
      }
    };
    register(this.settings.dictationShortcut, 'open_overlay', () => {
      return this.handleOverlayShortcut().catch((error) => (
        this.logError(`[ScreenVoice] Overlay shortcut failed: ${error.code || 'unknown'}`)
      ));
    });
    if (process.platform === 'darwin') {
      try {
        this.shortcutMonitor = this.shortcutMonitorFactory((event) => this.handleShortcutMonitorEvent(event), {
          rootDir: this.rootDir
        });
      } catch (_) {
        this.logError('[ScreenVoice] Press-and-hold release monitor is unavailable; shortcuts use toggle mode');
      }
    }
  }

  async handleOverlayShortcut() {
    this.logInfo(`[ScreenVoice] Overlay shortcut; state=${this.controller.state}`);
    await this.rememberExternalTarget();
    this.pendingMode = 'agent';
    this.detailsOpen = true;
    this.showOverlay({ focus: true, ...DETAILS_OVERLAY });
    this.sendState();
    this.send('screen-voice:show-details', { mode: this.pendingMode });
    return { ...this.controller.snapshot(), shown: true };
  }

  stopShortcutMonitor() {
    this.shortcutMonitor?.stop?.();
    this.shortcutMonitor = null;
    this.shortcutMonitorReady = false;
    this.shortcutHeldMode = null;
    this.pendingShortcutRelease = null;
  }

  handleShortcutMonitorEvent(event = {}) {
    const eventMode = event.mode === 'dictation' ? 'agent' : event.mode;
    if (event.event === 'ready') {
      this.shortcutMonitorReady = true;
      this.logInfo(`[ScreenVoice] Press-and-hold shortcuts ready (${event.method || 'event_tap'})`);
    } else if (event.event === 'down') {
      if (this.shortcutHeldMode === eventMode && !this.shortcutStartPromise
          && !['listening', 'transcribing', 'gathering_context', 'thinking', 'executing'].includes(this.controller.state)) {
        this.shortcutHeldMode = null;
      }
      return this.handleShortcutDown(eventMode).catch((error) => this.logError(`[ScreenVoice] Shortcut start failed: ${error.code || 'unknown'}`));
    } else if (event.event === 'up') {
      return this.handleShortcutUp(eventMode);
    } else if (event.event === 'error') {
      this.shortcutMonitorReady = false;
      this.shortcutHeldMode = null;
      this.logError('[ScreenVoice] Press-and-hold release monitor stopped; shortcuts use toggle mode');
    }
    return null;
  }

  async rememberExternalTarget() {
    try {
      const context = await this.adapter.getTarget();
      if (context?.processId !== process.pid) this.revealTarget = { context, capturedAt: Date.now() };
      return context;
    } catch (_) { return null; }
  }

  async handleShortcutDown(mode, source = 'global_shortcut') {
    mode = 'agent';
    if (this.shortcutMonitor && this.shortcutHeldMode === mode) return this.controller.snapshot();
    this.logInfo(`[ScreenVoice] Shortcut down (${mode}); state=${this.controller.state}`);
    if (this.controller.state === 'listening') {
      if (!this.shortcutMonitorReady) this.send('screen-voice:stop-capture', { reason: 'activation_released' });
      return this.controller.snapshot();
    }
    if (this.controller.state === 'previewing') this.controller.transition('idle');
    if (this.shortcutStartPromise) return this.shortcutStartPromise;
    this.pendingMode = 'agent';
    if (this.shortcutMonitor) this.shortcutHeldMode = this.pendingMode;
    this.shortcutStartSource = source;
    this.shortcutStartPromise = (async () => {
      await this.rememberExternalTarget();
      this.detailsOpen = true;
      this.showOverlay({ focus: false, ...DETAILS_OVERLAY });
      return this.begin(this.pendingMode, source);
    })();
    try {
      const result = await this.shortcutStartPromise;
      if (this.shortcutStartSource !== 'overlay_hold'
          && this.pendingShortcutRelease === this.pendingMode
          && this.controller.state === 'listening') {
        this.send('screen-voice:stop-capture', { reason: 'activation_released' });
      }
      return result;
    } finally {
      this.shortcutStartPromise = null;
      this.shortcutStartSource = null;
      this.pendingShortcutRelease = null;
    }
  }

  handleOverlayCaptureRelease() {
    if (this.shortcutHeldMode === 'agent') this.shortcutHeldMode = null;
    if (this.pendingMode === 'agent') this.pendingShortcutRelease = null;
    if (this.shortcutStartPromise) return this.controller.snapshot();
    if (this.controller.state === 'listening') {
      this.send('screen-voice:stop-capture', { reason: 'activation_released' });
    }
    return this.controller.snapshot();
  }

  handleShortcutUp(mode) {
    this.logInfo(`[ScreenVoice] Shortcut up (${mode}); state=${this.controller.state}`);
    if (mode === this.shortcutHeldMode) this.shortcutHeldMode = null;
    if (mode !== this.pendingMode) return;
    if (this.shortcutStartPromise) {
      this.pendingShortcutRelease = mode;
    } else if (this.controller.state === 'listening') {
      this.send('screen-voice:stop-capture', { reason: 'activation_released' });
    }
  }

  unregisterShortcut(shortcut) {
    try { globalShortcut.unregister(shortcut); }
    catch (_) { this.logError('[ScreenVoice] Invalid persisted shortcut was ignored'); }
  }

  async microphonePermission(request = false) {
    if (process.platform !== 'darwin') return { microphone: true, microphoneStatus: 'granted' };
    try {
      const hardware = await this.microphoneHardwareStatus();
      if (!hardware.available) {
        return { microphone: false, microphoneStatus: 'unavailable', microphoneDeviceCount: 0 };
      }
    } catch (_) { /* Older helpers fall back to the operating-system permission status. */ }
    let status = systemPreferences.getMediaAccessStatus('microphone');
    if (request && status !== 'granted') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      status = granted ? 'granted' : systemPreferences.getMediaAccessStatus('microphone');
    }
    return { microphone: status === 'granted', microphoneStatus: status };
  }

  async permissionStatus() {
    const [microphone, accessibility] = await Promise.allSettled([
      this.microphonePermission(false), this.adapter.permissionStatus()
    ]);
    const microphoneValue = microphone.status === 'fulfilled'
      ? microphone.value : { microphone: false, microphoneStatus: 'unavailable' };
    const accessibilityValue = accessibility.status === 'fulfilled'
      ? accessibility.value : { accessibility: false, supported: false };
    return { ...microphoneValue, ...accessibilityValue };
  }

  async sendPermissionStatus() {
    const result = await this.permissionStatus();
    this.send('screen-voice:permissions', result);
    return result;
  }

  async openPermissionSettings(type) {
    if (process.platform !== 'darwin') return;
    const pane = type === 'microphone' ? 'Privacy_Microphone' : 'Privacy_Accessibility';
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`).catch(() => {});
  }

  async requestPermission(type) {
    const attempt = type === 'microphone' ? await this.microphonePermission(true) : await this.adapter.requestPermission();
    const result = { ...(await this.permissionStatus()), ...attempt };
    if ((type === 'microphone' && !result.microphone) || (type === 'accessibility' && !result.accessibility)) {
      await this.openPermissionSettings(type);
    }
    this.send('screen-voice:permissions', result);
    return result;
  }

  async toggle(mode, source) {
    if (this.controller.state === 'listening') {
      this.send('screen-voice:stop-capture', { reason: 'activation_released' });
      return this.controller.snapshot();
    }
    this.pendingMode = 'agent';
    const visible = Boolean(this.overlay && !this.overlay.isDestroyed() && this.overlay.isVisible());
    if (source === 'global_shortcut' && !visible) {
      this.detailsOpen = true;
      this.showOverlay({ focus: false, ...DETAILS_OVERLAY });
      this.sendState();
      this.send('screen-voice:show-details', { mode: this.pendingMode });
      return { ...this.controller.snapshot(), shown: true };
    }
    return this.begin(mode, source);
  }

  async begin(mode, source) {
    try {
      mode = 'agent';
      this.pendingMode = 'agent';
      if (this.controller.state === 'previewing') this.controller.transition('idle');
      if (!this.entitlementEnabled) {
        const error = new Error(); error.code = 'FEATURE_NOT_ENABLED'; throw error;
      }
      if (!this.authenticated) {
        const error = new Error(); error.code = 'AUTH_REQUIRED'; throw error;
      }
      const mic = await this.microphonePermission(true);
      if (!mic.microphone) {
        const error = new Error();
        error.code = mic.microphoneStatus === 'unavailable' ? 'MICROPHONE_UNAVAILABLE' : 'MICROPHONE_DENIED';
        throw error;
      }
      let permission = await this.adapter.permissionStatus();
      if (!permission.accessibility) permission = await this.adapter.requestPermission();
      if (!permission.accessibility) {
        const error = new Error(); error.code = 'accessibility_permission_denied'; throw error;
      }
      this.lastContext = await this.adapter.getTarget();
      const cached = this.revealTarget;
      const cachedIsFresh = cached && Date.now() - cached.capturedAt < 5 * 60 * 1000;
      if (this.lastContext?.processId === process.pid && cachedIsFresh) {
        await this.adapter.activate(cached.context.targetFingerprint);
        this.lastContext = await this.adapter.getTarget();
      }
      if (['', 'AXWebArea', 'AXGroup'].includes(this.lastContext.focusedElement?.role || '')) {
        await this.sleep(120);
        const refined = await this.adapter.getTarget();
        const sameApplication = fingerprintsMatch(this.lastContext.targetFingerprint, refined.targetFingerprint, {
          allowDynamicWindowTitle: true, boundsTolerance: Number.MAX_SAFE_INTEGER
        }) || Boolean(
          this.lastContext.processId && refined.processId && this.lastContext.processId === refined.processId
          && (!this.lastContext.bundleId || !refined.bundleId || this.lastContext.bundleId === refined.bundleId)
        );
        if (sameApplication && refined.focusedElement?.role) this.lastContext = refined;
      }
      this.logInfo(`[ScreenVoice] Target role=${this.lastContext.focusedElement?.role || 'unknown'} editable=${Boolean(this.lastContext.focusedElement?.isEditable)}`);
      if (this.lastContext.focusedElement.isPassword) { const error = new Error(); error.code = 'secure_field'; throw error; }
      this.previewDecision = null;
      const snapshot = this.controller.start(mode, source);
      this.controller.session.target = this.lastContext.targetFingerprint;
      this.showOverlay({ focus: source === 'overlay_hold' });
      this.send('screen-voice:start-capture', { mode, sessionId: snapshot.session.id, maxDurationMs: 90000 });
      this.logInfo(`[ScreenVoice] Session started (${mode})`);
      return snapshot;
    } catch (error) { return this.fail(error.code || 'VOICE_START_FAILED', error); }
  }

  async handleAudio(payload) {
    if (this.controller.state !== 'listening') return { ok: false, reason: 'session_not_listening' };
    if (payload.sessionId !== this.controller.session?.id) return { ok: false, reason: 'stale_session' };
    const audioBase64 = String(payload.audioBase64 || '');
    this.logInfo(`[ScreenVoice] Audio received bytes≈${Math.round(audioBase64.length * 0.75)}`);
    if (!audioBase64 || audioBase64.length > MAX_AUDIO_BASE64_CHARS) return this.fail('AUDIO_TOO_LARGE');
    try {
      this.controller.transition('transcribing');
      const result = await this.api.transcribe({ audioBase64,
        mimeType: String(payload.mimeType || 'audio/webm').slice(0, 120), language: this.settings.language }, this.controller.signal);
      const transcript = normalizeText(result.text).trim();
      if (!transcript || NON_SPEECH_TRANSCRIPT.test(transcript)) {
        const error = new Error(); error.code = 'NO_SPEECH'; throw error;
      }
      this.logInfo(`[ScreenVoice] Transcript captured characters=${transcript.length}`);
      this.controller.session.transcript = transcript;
      this.sendState();
      await this.sleep(500);
      this.rememberConversationTurn('user', transcript);
      return await this.runAgent(transcript);
    } catch (error) { return this.fail(error.code || 'TRANSCRIPTION_FAILED', error); }
  }

  async runAgent(instruction) {
    this.controller.transition('gathering_context');
    await this.adapter.activate(this.controller.session.target);
    let context = await this.adapter.getContext({ maxChars: this.settings.screenContextEnabled ? 12000 : 1000 });
    const expected = this.controller.session.target;
    const sameApplication = Boolean(
      (expected.processId && context.targetFingerprint.processId && expected.processId === context.targetFingerprint.processId)
      || (expected.bundleId && context.targetFingerprint.bundleId && expected.bundleId === context.targetFingerprint.bundleId)
    );
    if (!sameApplication) {
      this.logError(`[ScreenVoice] Target application changed fields=${fingerprintDifferenceLabels(expected, context.targetFingerprint)}`);
      const error = new Error(); error.code = 'TARGET_CHANGED'; throw error;
    }
    this.controller.session.target = context.targetFingerprint;
    if (!this.settings.screenContextEnabled) context = { ...context,
      focusedElement: { ...context.focusedElement, value: '' }, selectedText: '', surroundingText: '',
      accessibleDocumentText: '', nearbyControls: [],
      truncationMetadata: { truncated: false, originalCharacters: 0, retainedCharacters: 0 } };
    this.lastContext = context;
    this.controller.transition('thinking');
    const capabilities = { insertText: context.focusedElement.isEditable,
      replaceSelection: context.focusedElement.isEditable && Boolean(context.selectedText),
      insertTable: context.focusedElement.isEditable, copy: true, undo: true };
    const allowedActions = ['copy', 'open_url', 'navigate_client'];
    if (capabilities.insertText) allowedActions.push('insert_text', 'insert_table');
    if (capabilities.replaceSelection) allowedActions.push('replace_selection');
    const { processId: _processId, bundleId: _bundleId, ...agentContext } = context;
    const decision = parseAgentDecision(await this.api.decide({ instruction, interactionMode: 'agent', context: agentContext,
      capabilities, allowedActions, conversation: this.conversationTurns.slice(-25, -1),
      conversationMemory: this.conversationMemory }, this.controller.signal));
    this.controller.session.decision = decision;
    this.previewDecision = decision;
    this.rememberConversationTurn('assistant', decision.displayResponse || decision.spokenResponse);
    if (this.settings.voiceOutputEnabled && decision.spokenResponse) {
      this.api.synthesize(decision.spokenResponse, this.controller.signal).then((speech) => {
        if (speech.available && speech.audio?.base64) this.send('screen-voice:play-audio', speech.audio);
      }).catch(() => { /* Voice output is optional; the visible result remains authoritative. */ });
    }
    if (!decision.proposedActions.length || decisionRequiresConfirmation(decision, context, this.settings)) {
      this.controller.transition('previewing');
      this.showOverlay({ focus: true, ...PREVIEW_OVERLAY });
      if (decision.intent === 'clarify' || decision.proposedActions.some((action) => action.requiresConfirmation)) {
        this.notifyUser({ reason: decision.intent === 'clarify' ? 'clarification' : 'approval' });
      }
      return { ok: true, preview: true };
    }
    return this.executeDecision(decision);
  }

  rememberConversationTurn(role, value) {
    const text = normalizeText(value).trim().slice(0, 4000);
    if (!text) return;
    this.conversationTurns.push({ role, text });
    if (this.conversationTurns.length > 24) {
      const archived = this.conversationTurns.splice(0, this.conversationTurns.length - 24);
      const archiveText = archived.map((turn) => `${turn.role === 'user' ? 'User' : 'LANA'}: ${turn.text}`).join('\n');
      this.conversationMemory = `${this.conversationMemory}\n${archiveText}`.trim().slice(-8000);
    }
  }

  async executeDecision(decision) {
    this.controller.transition('executing');
    for (let index = 0; index < decision.proposedActions.length; index += 1) {
      const action = decision.proposedActions[index];
      if (!this.controller.claimExecution(`${this.controller.session.id}:${index}:${action.type}`)) continue;
      const text = actionText(action);
      if (action.type === 'open_url') await this.openExternalUrl(action.arguments.url);
      else if (action.type === 'navigate_client') await this.navigateClient(action.arguments);
      else if (action.type === 'copy') clipboard.writeText(text);
      else if (action.type === 'replace_selection') await this.adapter.replaceSelection(text, action.targetFingerprint);
      else await this.adapter.insert(text, action.targetFingerprint);
    }
    const desktopMutation = decision.proposedActions.some((action) => (
      ['insert_text', 'replace_selection', 'insert_table'].includes(action.type)
    ));
    this.controller.transition('idle', { result: { inserted: desktopMutation,
      canUndo: desktopMutation, text: decision.displayResponse } });
    this.showOverlay();
    return { ok: true };
  }

  async confirm(sessionId) {
    if (this.controller.state !== 'previewing' || sessionId !== this.controller.session?.id || !this.previewDecision) {
      return { ok: false, reason: 'stale_preview' };
    }
    try { return await this.executeDecision(this.previewDecision); }
    catch (error) { return this.fail(error.code || 'INSERTION_FAILED', error); }
  }

  copy(text) { clipboard.writeText(normalizeText(text || this.previewDecision?.displayResponse || '')); return { ok: true }; }
  async undo() {
    try { await this.adapter.undo(); this.send('screen-voice:undone', {}); return { ok: true }; }
    catch (error) { return this.fail(error.code || 'UNDO_FAILED', error); }
  }
  cancel() { this.send('screen-voice:stop-capture', { discard: true }); this.controller.cancel(); return { ok: true }; }

  fail(code, error = {}) {
    this.shortcutHeldMode = null;
    this.pendingShortcutRelease = null;
    const details = publicError({ code, message: error?.message });
    try {
      if (this.controller.state === 'idle') this.controller.start(this.settings.defaultMode, 'error_recovery');
      this.controller.fail(details.code, details.message);
    } catch (_) { /* preserve original safe error */ }
    this.showOverlay();
    const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
    const message = `[ScreenVoice] ${details.code}${status}`;
    if (EXPECTED_USER_ERRORS.has(details.code)) this.logInfo(message);
    else this.logError(message);
    return { ok: false, error: details };
  }

  saveSettings(value) {
    this.settings = parseSettings(value);
    Object.entries(this.settings).forEach(([key, item]) => this.settingsStore.set(key, item));
    this.registerShortcuts();
    if (!this.settings.openAtLogin && this.controller.state === 'idle') this.overlay?.hide();
    else if (this.controller.state === 'idle') this.resizeOverlay(this.overlayLayout());
    this.sendState();
    return { ok: true, settings: this.settings };
  }

  getSettings() {
    return { ...this.settings };
  }

  setOpenAtLogin(enabled) {
    this.settings = parseSettings({ ...this.settings, openAtLogin: Boolean(enabled) });
    this.settingsStore.set('openAtLogin', this.settings.openAtLogin);
    if (this.settings.openAtLogin && this.authenticated && this.entitlementEnabled) {
      this.showOverlay();
      this.sendState();
    } else if (!this.settings.openAtLogin && this.controller.state === 'idle') {
      this.overlay?.hide();
    }
    return { ok: true, openAtLogin: this.settings.openAtLogin };
  }

  shutdown() {
    this.controller.cancel('app_quit');
    this.unregisterShortcut(this.settings.dictationShortcut);
    this.unregisterShortcut(this.settings.agentShortcut);
    this.stopShortcutMonitor();
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
  }
}

module.exports = { MAX_AUDIO_BASE64_CHARS, publicError, ElectronScreenVoice };
