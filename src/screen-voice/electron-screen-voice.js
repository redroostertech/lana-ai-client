'use strict';

const path = require('path');
const Store = require('electron-store');
const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, systemPreferences } = require('electron');
const { VoiceSessionController } = require('./voice-session-controller');
const { createDesktopAdapter } = require('./desktop-adapter');
const { VoiceApiClient } = require('./voice-api-client');
const { DEFAULT_SETTINGS, parseAgentDecision, parseSettings } = require('./contracts');
const { fingerprintsMatch } = require('./target-fingerprint');
const { decisionRequiresConfirmation } = require('./confirmation-policy');
const { actionText, normalizeText } = require('./action-normalizer');

const MAX_AUDIO_BASE64_CHARS = 16 * 1024 * 1024;
const COMPACT_OVERLAY = Object.freeze({ width: 360, height: 58 });
const PREVIEW_OVERLAY = Object.freeze({ width: 520, height: 360 });
const ERROR_OVERLAY = Object.freeze({ width: 460, height: 220 });
const SETTINGS_OVERLAY = Object.freeze({ width: 520, height: 520 });

function publicError(error) {
  const code = error?.code || 'VOICE_ERROR';
  const messages = {
    accessibility_permission_denied: 'Allow Accessibility access in System Settings to use desktop dictation.',
    PLATFORM_UNSUPPORTED: 'Screen-aware dictation is not yet available on this operating system.',
    TARGET_CHANGED: 'The active application or text field changed. Nothing was inserted.',
    target_changed: 'The active application or text field changed. Nothing was inserted.',
    target_not_editable: 'Place the cursor in an editable text field and try again.',
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
    FEATURE_NOT_ENABLED: 'Screen Dictation is not enabled for this organization.'
  };
  return { code, message: messages[code] || error?.message || 'Voice action could not be completed.' };
}

class ElectronScreenVoice {
  constructor(options = {}) {
    this.getMainWindow = options.getMainWindow;
    this.getSavedServer = options.getSavedServer;
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
    this.api = options.api || new VoiceApiClient({
      getServerUrl: async () => this.getSavedServer()?.url || null,
      getToken: async () => this.getAuthToken()
    });
    this.overlay = null;
    this.ipcRegistered = false;
    this.lastContext = null;
    this.previewDecision = null;
    this.entitlementEnabled = Boolean(options.entitlementEnabled);
    this.authenticated = Boolean(options.authenticated);
    this.controller.on('state', (snapshot) => this.sendState(snapshot));
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
      minWidth: 320, minHeight: 52, maxWidth: 560, maxHeight: 560,
      frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true,
      skipTaskbar: true, resizable: true, focusable: false, show: false, hasShadow: true,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        preload: path.join(this.rootDir, 'screen-voice-preload.js')
      }
    });
    this.overlay.setAlwaysOnTop(true, 'floating');
    this.overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const rendererRoot = app.isPackaged ? 'public_html' : 'src';
    this.overlay.loadFile(path.join(this.rootDir, rendererRoot, 'screen-voice', 'overlay', 'index.html'));
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
    if (state === 'error') return ERROR_OVERLAY;
    return COMPACT_OVERLAY;
  }

  resizeOverlay(layout = this.overlayLayout()) {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    const width = Math.max(320, Math.min(560, Number(layout.width) || COMPACT_OVERLAY.width));
    const height = Math.max(52, Math.min(560, Number(layout.height) || COMPACT_OVERLAY.height));
    this.overlay.setSize(width, height, false);
  }

  showOverlay({ focus = false, width, height } = {}) {
    const overlay = this.createOverlay();
    this.resizeOverlay(width || height ? { width, height } : this.overlayLayout());
    this.positionOverlay();
    overlay.setFocusable(Boolean(focus));
    focus ? overlay.show() : overlay.showInactive();
  }

  send(channel, payload) {
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.webContents.send(channel, payload);
  }

  sendState(snapshot = this.controller.snapshot()) {
    this.resizeOverlay(this.overlayLayout(snapshot.state));
    this.positionOverlay();
    this.send('screen-voice:state', { ...snapshot, settings: this.settings });
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
    handle('screen-voice:get-state', async () => ({ ...this.controller.snapshot(), settings: this.settings }));
    handle('screen-voice:activate', ({ mode }) => this.toggle(mode || this.settings.defaultMode, 'overlay'));
    handle('screen-voice:audio-complete', (payload) => this.handleAudio(payload));
    handle('screen-voice:capture-error', ({ code }) => this.fail(code || 'MICROPHONE_DENIED'));
    handle('screen-voice:cancel', () => this.cancel());
    handle('screen-voice:confirm', ({ sessionId }) => this.confirm(sessionId));
    handle('screen-voice:copy', ({ text }) => this.copy(text));
    handle('screen-voice:undo', () => this.undo());
    handle('screen-voice:permission', ({ type }) => this.requestPermission(type));
    handle('screen-voice:save-settings', (settings) => this.saveSettings(settings));
    handle('screen-voice:open-settings', () => { this.showOverlay({ focus: true, ...SETTINGS_OVERLAY }); return { ok: true }; });
    handle('screen-voice:close-settings', () => {
      const focus = ['previewing', 'error'].includes(this.controller.state);
      this.showOverlay({ focus, ...this.overlayLayout() });
      return { ok: true };
    });
    handle('screen-voice:dismiss', () => { this.overlay?.hide(); return { ok: true }; });
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
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
    this.overlay = null;
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
    this.unregisterShortcut(this.settings.dictationShortcut);
    this.unregisterShortcut(this.settings.agentShortcut);
    if (!this.entitlementEnabled || !this.authenticated || !this.settings.enabled) return;
    const register = (shortcut, mode) => {
      try {
        if (!globalShortcut.register(shortcut, () => this.toggle(mode, 'global_shortcut'))) {
          this.logError(`[ScreenVoice] Shortcut unavailable: ${mode}`);
          return false;
        }
        return true;
      } catch (_) {
        // A bad persisted accelerator must never prevent the other mode from
        // registering or abort discovery/settings IPC.
        this.logError(`[ScreenVoice] Shortcut could not be registered: ${mode}`);
        return false;
      }
    };
    register(this.settings.dictationShortcut, 'dictation');
    register(this.settings.agentShortcut, 'agent');
  }

  unregisterShortcut(shortcut) {
    try { globalShortcut.unregister(shortcut); }
    catch (_) { this.logError('[ScreenVoice] Invalid persisted shortcut was ignored'); }
  }

  async microphonePermission(request = false) {
    if (process.platform !== 'darwin') return { microphone: true };
    let status = systemPreferences.getMediaAccessStatus('microphone');
    if (request && status !== 'granted') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      status = granted ? 'granted' : systemPreferences.getMediaAccessStatus('microphone');
    }
    return { microphone: status === 'granted', microphoneStatus: status };
  }

  async requestPermission(type) {
    const result = type === 'microphone' ? await this.microphonePermission(true) : await this.adapter.requestPermission();
    this.send('screen-voice:permissions', result);
    return result;
  }

  async toggle(mode, source) {
    if (this.controller.state === 'listening') {
      this.send('screen-voice:stop-capture', { reason: 'activation_released' });
      return this.controller.snapshot();
    }
    return this.begin(mode, source);
  }

  async begin(mode, source) {
    try {
      if (!this.entitlementEnabled) {
        const error = new Error(); error.code = 'FEATURE_NOT_ENABLED'; throw error;
      }
      if (!this.authenticated) {
        const error = new Error(); error.code = 'AUTH_REQUIRED'; throw error;
      }
      const mic = await this.microphonePermission(false);
      if (['denied', 'restricted'].includes(mic.microphoneStatus)) {
        const error = new Error(); error.code = 'MICROPHONE_DENIED'; throw error;
      }
      const permission = await this.adapter.permissionStatus();
      if (!permission.accessibility) {
        const error = new Error(); error.code = 'accessibility_permission_denied'; throw error;
      }
      this.lastContext = await this.adapter.getTarget();
      if (this.lastContext.focusedElement.isPassword) { const error = new Error(); error.code = 'secure_field'; throw error; }
      if (mode === 'dictation' && !this.lastContext.focusedElement.isEditable) {
        const error = new Error(); error.code = 'target_not_editable'; throw error;
      }
      this.previewDecision = null;
      const snapshot = this.controller.start(mode, source);
      this.controller.session.target = this.lastContext.targetFingerprint;
      this.showOverlay();
      this.send('screen-voice:start-capture', { mode, sessionId: snapshot.session.id, maxDurationMs: 90000 });
      this.logInfo(`[ScreenVoice] Session started (${mode})`);
      return snapshot;
    } catch (error) { return this.fail(error.code || 'VOICE_START_FAILED', error); }
  }

  async handleAudio(payload) {
    if (this.controller.state !== 'listening') return { ok: false, reason: 'session_not_listening' };
    if (payload.sessionId !== this.controller.session?.id) return { ok: false, reason: 'stale_session' };
    const audioBase64 = String(payload.audioBase64 || '');
    if (!audioBase64 || audioBase64.length > MAX_AUDIO_BASE64_CHARS) return this.fail('AUDIO_TOO_LARGE');
    try {
      this.controller.transition('transcribing');
      const result = await this.api.transcribe({ audioBase64,
        mimeType: String(payload.mimeType || 'audio/webm').slice(0, 120), language: this.settings.language }, this.controller.signal);
      const transcript = normalizeText(result.text).trim();
      if (!transcript) { const error = new Error(); error.code = 'NO_SPEECH'; throw error; }
      this.controller.session.transcript = transcript;
      this.sendState();
      return await (this.controller.session.mode === 'dictation' ? this.executeLiteral(transcript) : this.runAgent(transcript));
    } catch (error) { return this.fail(error.code || 'TRANSCRIPTION_FAILED', error); }
  }

  async executeLiteral(transcript) {
    this.controller.transition('executing');
    if (!this.controller.claimExecution(`${this.controller.session.id}:dictation`)) return { ok: false, reason: 'duplicate_execution' };
    await this.adapter.insert(transcript, this.controller.session.target);
    this.controller.transition('idle', { result: { inserted: true, text: transcript, canUndo: true } });
    this.showOverlay();
    return { ok: true };
  }

  async runAgent(instruction) {
    this.controller.transition('gathering_context');
    let context = await this.adapter.getContext({ maxChars: this.settings.screenContextEnabled ? 12000 : 1000 });
    if (!fingerprintsMatch(this.controller.session.target, context.targetFingerprint)) {
      const error = new Error(); error.code = 'TARGET_CHANGED'; throw error;
    }
    if (!this.settings.screenContextEnabled) context = { ...context,
      focusedElement: { ...context.focusedElement, value: '' }, selectedText: '', surroundingText: '',
      accessibleDocumentText: '', nearbyControls: [],
      truncationMetadata: { truncated: false, originalCharacters: 0, retainedCharacters: 0 } };
    this.lastContext = context;
    this.controller.transition('thinking');
    const capabilities = { insertText: context.focusedElement.isEditable,
      replaceSelection: context.focusedElement.isEditable && Boolean(context.selectedText),
      insertTable: context.focusedElement.isEditable, copy: true, undo: true };
    const allowedActions = ['copy'];
    if (capabilities.insertText) allowedActions.push('insert_text', 'insert_table');
    if (capabilities.replaceSelection) allowedActions.push('replace_selection');
    const decision = parseAgentDecision(await this.api.decide({ instruction, interactionMode: 'agent', context,
      capabilities, allowedActions }, this.controller.signal));
    this.controller.session.decision = decision;
    this.previewDecision = decision;
    if (this.settings.voiceOutputEnabled && decision.spokenResponse) {
      this.api.synthesize(decision.spokenResponse, this.controller.signal).then((speech) => {
        if (speech.available && speech.audio?.base64) this.send('screen-voice:play-audio', speech.audio);
      }).catch(() => { /* Voice output is optional; the visible result remains authoritative. */ });
    }
    if (!decision.proposedActions.length || decisionRequiresConfirmation(decision, context, this.settings)) {
      this.controller.transition('previewing');
      this.showOverlay({ focus: true, ...PREVIEW_OVERLAY });
      return { ok: true, preview: true };
    }
    return this.executeDecision(decision);
  }

  async executeDecision(decision) {
    this.controller.transition('executing');
    for (let index = 0; index < decision.proposedActions.length; index += 1) {
      const action = decision.proposedActions[index];
      if (!this.controller.claimExecution(`${this.controller.session.id}:${index}:${action.type}`)) continue;
      const text = actionText(action);
      if (action.type === 'copy') clipboard.writeText(text);
      else if (action.type === 'replace_selection') await this.adapter.replaceSelection(text, action.targetFingerprint);
      else await this.adapter.insert(text, action.targetFingerprint);
    }
    this.controller.transition('idle', { result: { inserted: decision.proposedActions.some((a) => a.type !== 'copy'),
      canUndo: true, text: decision.displayResponse } });
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
    const details = publicError({ code, message: error?.message });
    try {
      if (this.controller.state === 'idle') this.controller.start(this.settings.defaultMode, 'error_recovery');
      this.controller.fail(details.code, details.message);
    } catch (_) { /* preserve original safe error */ }
    this.showOverlay({ focus: true, ...ERROR_OVERLAY });
    this.logError(`[ScreenVoice] ${details.code}`);
    return { ok: false, error: details };
  }

  saveSettings(value) {
    this.settings = parseSettings(value);
    Object.entries(this.settings).forEach(([key, item]) => this.settingsStore.set(key, item));
    this.registerShortcuts();
    if (!this.settings.openAtLogin && this.controller.state === 'idle') this.overlay?.hide();
    else if (this.controller.state === 'idle') this.resizeOverlay(COMPACT_OVERLAY);
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
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
  }
}

module.exports = { MAX_AUDIO_BASE64_CHARS, publicError, ElectronScreenVoice };
