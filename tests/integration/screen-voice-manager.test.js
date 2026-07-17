jest.mock('electron-store', () => class Store {
  constructor(options = {}) { this.store = { ...(options.defaults || {}) }; }
  set(key, value) { this.store[key] = value; }
});

const sent = [];
jest.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: jest.fn(),
  clipboard: { writeText: jest.fn(), availableFormats: jest.fn(() => []), clear: jest.fn(), writeBuffer: jest.fn() },
  globalShortcut: { register: jest.fn(() => true), unregister: jest.fn() },
  ipcMain: { handle: jest.fn() },
  screen: { getCursorScreenPoint: jest.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: jest.fn(() => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } })) },
  shell: { openExternal: jest.fn(async () => {}) },
  systemPreferences: { getMediaAccessStatus: jest.fn(() => 'granted'), askForMediaAccess: jest.fn(async () => true) }
}));

const { ElectronScreenVoice } = require('../../src/screen-voice/electron-screen-voice');
const { globalShortcut, ipcMain, systemPreferences } = require('electron');
const macTest = process.platform === 'darwin' ? test : test.skip;

const fingerprint = { platform: 'darwin', processId: 9, bundleId: 'com.editor', processName: 'Editor',
  windowTitle: 'Doc', role: 'AXTextArea', name: 'Body', bounds: null, selectionHash: null };
const context = { platform: 'darwin', activeApplication: 'Editor', processName: 'Editor', windowTitle: 'Doc',
  browserUrlOrDomainWhenSafelyAvailable: null,
  focusedElement: { role: 'AXTextArea', name: 'Body', value: 'Draft', isEditable: true, isPassword: false, bounds: null },
  selectedText: '', surroundingText: 'Draft', accessibleDocumentText: 'Draft', spreadsheetContext: null,
  nearbyControls: [], screenshotReference: null, collectionMethod: 'accessibility',
  truncationMetadata: { truncated: false, originalCharacters: 5, retainedCharacters: 5 }, targetFingerprint: fingerprint };

function overlay() {
  let visible = false;
  return { isDestroyed: () => false, isVisible: () => visible,
    webContents: { id: 88, send: jest.fn((...args) => sent.push(args)) },
    setSize: jest.fn(), getBounds: jest.fn(() => ({ width: 500, height: 188 })), setPosition: jest.fn(),
    setFocusable: jest.fn(), show: jest.fn(() => { visible = true; }),
    showInactive: jest.fn(() => { visible = true; }), hide: jest.fn(() => { visible = false; }),
    destroy: jest.fn(() => { visible = false; }) };
}

function managerWith({ api, adapter, openClientSettings, shortcutMonitorFactory, navigateClient, openExternalUrl, notifyUser,
  microphoneHardwareStatus, settingsStore }) {
  const manager = new ElectronScreenVoice({ api, adapter, getMainWindow: () => null,
    getSavedServer: () => ({ url: 'http://local' }), openClientSettings, navigateClient, openExternalUrl, notifyUser,
    microphoneHardwareStatus: microphoneHardwareStatus || (async () => ({ available: true, deviceCount: 1 })),
    shortcutMonitorFactory: shortcutMonitorFactory || ((onEvent) => {
      onEvent({ event: 'ready' });
      return { stop: jest.fn() };
    }),
    sleep: async () => {}, settingsStore: settingsStore || { store: {}, set: jest.fn() } });
  manager.overlay = overlay();
  return manager;
}

describe('Electron screen voice orchestration', () => {
  beforeEach(() => { sent.length = 0; jest.clearAllMocks(); });

  test('every transcript is handled by the conversational agent', async () => {
    const api = { transcribe: jest.fn(async () => ({ text: 'Please send the revised contract Friday.' })),
      decide: jest.fn(async () => ({ intent: 'answer', spokenResponse: 'I can help with that.',
        displayResponse: 'I can help with that.', proposedActions: [], confidence: 0.9,
        contextUsed: [] })) };
    const adapter = { activate: jest.fn(async () => {}), getContext: jest.fn(async () => context), insert: jest.fn() };
    const manager = managerWith({ api, adapter });
    manager.controller.start('agent');
    manager.controller.session.target = fingerprint;
    await manager.handleAudio({ sessionId: manager.controller.session.id, audioBase64: 'AAAA', mimeType: 'audio/webm' });
    expect(api.decide).toHaveBeenCalledWith(expect.objectContaining({ interactionMode: 'agent' }), expect.anything());
    expect(adapter.insert).not.toHaveBeenCalled();
    expect(manager.controller.state).toBe('previewing');
  });

  test('sound-effect-only transcription is never inserted', async () => {
    const api = { transcribe: jest.fn(async () => ({ text: '(beep)' })) };
    const adapter = { insert: jest.fn() };
    const manager = managerWith({ api, adapter });
    manager.controller.start('agent');
    manager.controller.session.target = fingerprint;

    await manager.handleAudio({ sessionId: manager.controller.session.id, audioBase64: 'AAAA', mimeType: 'audio/webm' });

    expect(adapter.insert).not.toHaveBeenCalled();
    expect(manager.controller.state).toBe('error');
    expect(manager.controller.session.error.code).toBe('NO_SPEECH');
  });

  test('selected rewrite is previewed, then revalidated replacement executes on confirmation', async () => {
    const selectedContext = { ...context, processId: 9, bundleId: 'com.editor', selectedText: 'rough draft',
      targetFingerprint: { ...fingerprint, selectionHash: 'selection' } };
    const api = { transcribe: jest.fn(async () => ({ text: 'Make this professional' })),
      decide: jest.fn(async () => ({ intent: 'rewrite', spokenResponse: '', displayResponse: 'Professional draft.',
        proposedActions: [{ type: 'replace_selection', arguments: { text: 'Professional draft.' },
          targetFingerprint: selectedContext.targetFingerprint, requiresConfirmation: true }],
        confidence: 0.95, contextUsed: ['selected_text'] })) };
    const adapter = { activate: jest.fn(async () => {}), getContext: jest.fn(async () => selectedContext),
      replaceSelection: jest.fn(async () => ({ ok: true })) };
    const manager = managerWith({ api, adapter });
    manager.controller.start('agent'); manager.controller.session.target = fingerprint;
    const sessionId = manager.controller.session.id;
    await manager.handleAudio({ sessionId, audioBase64: 'AAAA', mimeType: 'audio/webm' });
    expect(manager.controller.state).toBe('previewing');
    expect(manager.overlay.setSize).toHaveBeenLastCalledWith(520, 360, true);
    expect(adapter.replaceSelection).not.toHaveBeenCalled();
    expect(api.decide.mock.calls[0][0].context).not.toHaveProperty('processId');
    expect(api.decide.mock.calls[0][0].context).not.toHaveProperty('bundleId');
    await manager.confirm(sessionId);
    expect(adapter.replaceSelection).toHaveBeenCalledWith('Professional draft.', selectedContext.targetFingerprint);
  });

  test('changed application never reaches the model or mutates the target', async () => {
    const api = { transcribe: jest.fn(async () => ({ text: 'Summarize this' })),
      decide: jest.fn(async () => ({ arbitrary: 'output' })) };
    const adapter = { activate: jest.fn(async () => {}), getContext: jest.fn(async () => ({ ...context,
      processId: 20, bundleId: 'com.other', windowTitle: 'Other',
      targetFingerprint: { ...fingerprint, processId: 20, bundleId: 'com.other', windowTitle: 'Other' } })),
    insert: jest.fn(), replaceSelection: jest.fn() };
    const manager = managerWith({ api, adapter });
    manager.controller.start('agent'); manager.controller.session.target = fingerprint;
    await manager.handleAudio({ sessionId: manager.controller.session.id, audioBase64: 'AAAA', mimeType: 'audio/webm' });
    expect(manager.controller.state).toBe('error');
    expect(api.decide).not.toHaveBeenCalled();
    expect(adapter.insert).not.toHaveBeenCalled();
  });

  test('agent context tolerates bounded browser title and layout updates', async () => {
    const initial = { ...fingerprint, processId: 9, bundleId: 'com.browser',
      bounds: { x: 10, y: 10, width: 400, height: 80 } };
    const refreshed = { ...initial, windowTitle: 'Document — Updated',
      bounds: { x: 14, y: 12, width: 400, height: 80 } };
    const api = { transcribe: jest.fn(async () => ({ text: 'Summarize this' })),
      decide: jest.fn(async () => ({ intent: 'summarize', spokenResponse: '', displayResponse: 'Summary',
        proposedActions: [], confidence: 0.9, contextUsed: ['active_application'] })) };
    const adapter = { activate: jest.fn(async () => {}), getContext: jest.fn(async () => ({ ...context,
      processId: 9, bundleId: 'com.browser', windowTitle: 'Document — Updated', targetFingerprint: refreshed })) };
    const manager = managerWith({ api, adapter });
    manager.controller.start('agent');
    manager.controller.session.target = initial;

    await manager.handleAudio({ sessionId: manager.controller.session.id, audioBase64: 'AAAA', mimeType: 'audio/webm' });

    expect(adapter.activate).toHaveBeenCalledWith(initial);
    expect(api.decide).toHaveBeenCalled();
    expect(manager.controller.state).toBe('previewing');
  });

  test('provider failures become safe error state', async () => {
    const error = Object.assign(new Error('offline'), { code: 'NETWORK_UNAVAILABLE' });
    const manager = managerWith({ api: { transcribe: jest.fn(async () => { throw error; }) }, adapter: {} });
    manager.controller.start('agent'); manager.controller.session.target = fingerprint;
    const result = await manager.handleAudio({ sessionId: manager.controller.session.id, audioBase64: 'AAAA' });
    expect(result.error.code).toBe('NETWORK_UNAVAILABLE');
    expect(manager.controller.state).toBe('error');
  });

  test('voice remains unavailable until authenticated and Open at Login is opt-in', () => {
    const manager = managerWith({ api: {}, adapter: {} });
    const testOverlay = manager.overlay;
    manager.initialize();
    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(testOverlay.showInactive).not.toHaveBeenCalled();

    manager.setEntitlementEnabled(true);
    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(testOverlay.showInactive).not.toHaveBeenCalled();

    manager.setAuthenticated(true);
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
    expect(testOverlay.showInactive).not.toHaveBeenCalled();

    manager.setOpenAtLogin(true);
    expect(testOverlay.showInactive).toHaveBeenCalled();

    manager.setAuthenticated(false);
    expect(globalShortcut.unregister).toHaveBeenCalled();
    expect(testOverlay.destroy).toHaveBeenCalled();
  });

  test('an invalid open accelerator cannot prevent initialization', () => {
    globalShortcut.register.mockImplementation((shortcut) => {
      if (shortcut === 'CommandOrControl+Shift+Space') throw new TypeError('conversion failure');
      return true;
    });
    const manager = managerWith({ api: {}, adapter: {} });
    manager.setAuthenticated(true);
    expect(() => manager.setEntitlementEnabled(true)).not.toThrow();
    expect(globalShortcut.register).toHaveBeenCalledWith(
      'CommandOrControl+Shift+Space', expect.any(Function)
    );
  });

  test('opening client settings keeps the voice overlay visible', async () => {
    const openClientSettings = jest.fn(() => true);
    const manager = managerWith({ api: {}, adapter: {}, openClientSettings });
    manager.registerIpc();
    const registration = ipcMain.handle.mock.calls.find((call) => call[0] === 'screen-voice:open-settings');

    await registration[1]({ sender: { id: manager.overlay.webContents.id } }, {});

    expect(openClientSettings).toHaveBeenCalled();
    expect(manager.overlay.hide).not.toHaveBeenCalled();
  });

  test('open shortcut reveals overlay and hold monitor controls capture', async () => {
    const manager = managerWith({ api: {}, adapter: {
      permissionStatus: jest.fn(async () => ({ accessibility: true })),
      getTarget: jest.fn(async () => context)
    } });
    const testOverlay = manager.overlay;
    manager.setAuthenticated(true);
    manager.setEntitlementEnabled(true);
    expect(testOverlay.showInactive).not.toHaveBeenCalled();

    const registration = globalShortcut.register.mock.calls.find((call) => (
      call[0] === 'CommandOrControl+Shift+Space'
    ));
    await registration[1]();
    expect(manager.controller.state).toBe('idle');
    expect(testOverlay.show).toHaveBeenCalled();

    await manager.handleShortcutDown('agent', 'overlay_hold');
    expect(manager.controller.state).toBe('listening');
    expect(testOverlay.showInactive).toHaveBeenCalled();
    expect(testOverlay.setSize).toHaveBeenLastCalledWith(480, 190, true);

    manager.handleOverlayCaptureRelease();
    expect(manager.shortcutHeldMode).toBeNull();
    expect(sent).toContainEqual(['screen-voice:stop-capture', { reason: 'activation_released' }]);
  });

  test('visible overlay still accepts native capture retry after an error', async () => {
    const manager = managerWith({ api: {}, adapter: {
      permissionStatus: jest.fn(async () => ({ accessibility: true })),
      getTarget: jest.fn(async () => context)
    } });
    manager.authenticated = true;
    manager.entitlementEnabled = true;
    manager.shortcutMonitor = { stop: jest.fn() };
    manager.shortcutMonitorReady = true;
    manager.overlay.show();
    manager.fail('NO_SPEECH');

    await manager.handleShortcutMonitorEvent({ event: 'down', mode: 'agent' });

    expect(manager.controller.state).toBe('listening');
    expect(manager.shortcutHeldMode).toBe('agent');
    manager.handleShortcutMonitorEvent({ event: 'up', mode: 'agent' });
    expect(manager.shortcutHeldMode).toBeNull();
    expect(sent).toContainEqual(['screen-voice:stop-capture', { reason: 'activation_released' }]);
  });

  test('key repeat during one hold does not create overlapping sessions on a non-editable screen', async () => {
    const manager = managerWith({ api: {}, adapter: {
      permissionStatus: jest.fn(async () => ({ accessibility: true })),
      getTarget: jest.fn(async () => ({ ...context,
        focusedElement: { ...context.focusedElement, role: 'AXWebArea', isEditable: false } }))
    } });
    manager.authenticated = true;
    manager.entitlementEnabled = true;
    manager.shortcutMonitor = { stop: jest.fn() };
    manager.shortcutMonitorReady = true;
    const start = jest.spyOn(manager.controller, 'start');

    await manager.handleShortcutDown('dictation');
    await manager.handleShortcutDown('dictation');
    await manager.handleShortcutDown('dictation');

    expect(start).toHaveBeenCalledTimes(1);
    expect(manager.controller.state).toBe('listening');
    manager.handleShortcutUp('agent');
    expect(sent).toContainEqual(['screen-voice:stop-capture', { reason: 'activation_released' }]);
  });

  test('restores the editor target when overlay interaction owns focus', async () => {
    const initiallyIncompleteContext = { ...context, processId: 9, bundleId: 'com.editor',
      focusedElement: { ...context.focusedElement, role: 'AXWebArea', isEditable: false } };
    const externalContext = { ...context, processId: 9, bundleId: 'com.editor' };
    const overlayContext = { ...context, processId: process.pid, bundleId: 'com.lana',
      focusedElement: { ...context.focusedElement, role: 'AXGroup', isEditable: false },
      targetFingerprint: { ...fingerprint, processId: process.pid, bundleId: 'com.lana', role: 'AXGroup' } };
    const adapter = {
      permissionStatus: jest.fn(async () => ({ accessibility: true })),
      getTarget: jest.fn()
        .mockResolvedValueOnce(initiallyIncompleteContext)
        .mockResolvedValueOnce(overlayContext)
        .mockResolvedValueOnce(externalContext),
      activate: jest.fn(async () => {})
    };
    const manager = managerWith({ api: {}, adapter });
    manager.authenticated = true;
    manager.entitlementEnabled = true;

    await manager.handleShortcutDown('dictation');

    expect(adapter.activate).toHaveBeenCalledWith(initiallyIncompleteContext.targetFingerprint);
    expect(manager.controller.state).toBe('listening');
  });

  test('first activation requests missing permissions before capture', async () => {
    const adapter = {
      permissionStatus: jest.fn(async () => ({ accessibility: false, supported: true })),
      requestPermission: jest.fn(async () => ({ accessibility: true, supported: true })),
      getTarget: jest.fn(async () => context)
    };
    const manager = managerWith({ api: {}, adapter });
    manager.authenticated = true;
    manager.entitlementEnabled = true;
    if (process.platform === 'darwin') systemPreferences.getMediaAccessStatus.mockReturnValueOnce('not-determined');

    await manager.begin('agent', 'test');

    if (process.platform === 'darwin') expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    expect(adapter.requestPermission).toHaveBeenCalled();
    expect(manager.controller.state).toBe('listening');
  });

  macTest('a machine without an audio input is reported unavailable before capture starts', async () => {
    const adapter = { permissionStatus: jest.fn(async () => ({ accessibility: true })), getTarget: jest.fn() };
    const manager = managerWith({ api: {}, adapter,
      microphoneHardwareStatus: async () => ({ available: false, deviceCount: 0 }) });
    manager.authenticated = true;
    manager.entitlementEnabled = true;

    const permissions = await manager.permissionStatus();
    const result = await manager.begin('agent', 'test');

    expect(permissions).toEqual(expect.objectContaining({ microphone: false, microphoneStatus: 'unavailable' }));
    expect(result.error.code).toBe('MICROPHONE_UNAVAILABLE');
    expect(adapter.getTarget).not.toHaveBeenCalled();
  });

  test('voice follow-up uses prior turns and approved browser navigation is allowlisted by the host', async () => {
    const openExternalUrl = jest.fn(async () => true);
    const api = { transcribe: jest.fn(async () => ({ text: 'Yes, research that on the web.' })),
      decide: jest.fn(async () => ({ intent: 'answer', spokenResponse: 'I can open that search.',
        displayResponse: 'Open a web search for the contract issue?',
        proposedActions: [{ type: 'open_url', arguments: { url: 'https://www.google.com/search?q=contract+issue' },
          targetFingerprint: null, requiresConfirmation: true }], confidence: 0.95, contextUsed: [] })) };
    const adapter = { activate: jest.fn(async () => {}), getContext: jest.fn(async () => context) };
    const manager = managerWith({ api, adapter, openExternalUrl });
    manager.conversationMemory = 'The user asked about a contract issue.';
    manager.conversationTurns = [{ role: 'user', text: 'Should we research the contract issue?' },
      { role: 'assistant', text: 'Would you like me to research it on the web?' }];
    manager.controller.start('agent');
    manager.controller.session.target = fingerprint;
    const sessionId = manager.controller.session.id;

    await manager.handleAudio({ sessionId, audioBase64: 'AAAA', mimeType: 'audio/webm' });

    expect(api.decide.mock.calls[0][0]).toEqual(expect.objectContaining({
      conversationMemory: expect.stringContaining('contract issue'),
      conversation: expect.arrayContaining([expect.objectContaining({ role: 'assistant' })])
    }));
    expect(openExternalUrl).not.toHaveBeenCalled();
    await manager.confirm(sessionId);
    expect(openExternalUrl).toHaveBeenCalledWith('https://www.google.com/search?q=contract+issue');
  });

  test('older spoken turns roll into bounded conversation memory without screen content', () => {
    const manager = managerWith({ api: {}, adapter: {} });
    for (let index = 0; index < 30; index += 1) {
      manager.rememberConversationTurn(index % 2 ? 'assistant' : 'user', `spoken turn ${index}`);
    }
    expect(manager.conversationTurns).toHaveLength(24);
    expect(manager.conversationMemory).toContain('spoken turn 0');
    expect(manager.conversationMemory).toContain('spoken turn 5');
    expect(manager.conversationMemory).not.toContain('screen text');
  });

  test('a realtime proposal is confirmation gated and executes only once', async () => {
    const adapter = { replaceSelection: jest.fn(async () => ({ ok: true })) };
    const manager = managerWith({ api: {}, adapter, notifyUser: jest.fn() });
    manager.controller.start('agent');
    manager.realtimeActive = true;
    const ids = Array.from({ length: 6 }, (_, index) => `10000000-0000-4000-8000-00000000000${index + 1}`);
    const proposalId = ids[0];
    await manager.handleRealtimeEvent({
      protocol_version: 'desktop-voice.v1', event_id: ids[1], event_type: 'desktop.action.proposed',
      sequence: 1, timestamp: new Date().toISOString(), conversation_id: ids[2],
      voice_session_id: ids[3], turn_id: ids[4], run_id: ids[5],
      payload: {
        proposal_id: proposalId, action_type: 'replace_selection', payload: { text: 'Rewritten text' },
        summary: 'Replace the selected paragraph', target_fingerprint: fingerprint, context_snapshot_id: null,
        created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(),
        confirmation_class: 'always', idempotency_key: 'replace-once', conversation_id: ids[2],
        voice_session_id: ids[3], turn_id: ids[4], run_id: ids[5]
      }
    });
    expect(manager.controller.state).toBe('previewing');
    const sessionId = manager.controller.session.id;
    await manager.confirm(sessionId);
    await manager.confirm(sessionId);
    expect(adapter.replaceSelection).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual(['screen-voice:realtime-send', expect.objectContaining({
      type: 'desktop.action.result',
      result: expect.objectContaining({ proposal_id: proposalId, status: 'succeeded' })
    })]);
  });

  test('a proposal already executed before restart cannot mutate the desktop again', async () => {
    const persisted = {};
    const settingsStore = {
      store: persisted,
      get: jest.fn((key, fallback) => persisted[key] ?? fallback),
      set: jest.fn((key, value) => { persisted[key] = value; })
    };
    const adapter = { replaceSelection: jest.fn(async () => ({ ok: true })) };
    const ids = Array.from({ length: 6 }, (_, index) => `20000000-0000-4000-8000-00000000000${index + 1}`);
    const proposal = {
      proposal_id: ids[0], action_type: 'replace_selection', payload: { text: 'Once only' },
      summary: 'Replace the selection once', target_fingerprint: fingerprint, context_snapshot_id: null,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString(),
      confirmation_class: 'always', idempotency_key: 'persistent-once', conversation_id: ids[2],
      voice_session_id: ids[3], turn_id: ids[4], run_id: ids[5]
    };
    const event = {
      protocol_version: 'desktop-voice.v1', event_id: ids[1], event_type: 'desktop.action.proposed',
      sequence: 1, timestamp: new Date().toISOString(), conversation_id: ids[2],
      voice_session_id: ids[3], turn_id: ids[4], run_id: ids[5], payload: proposal
    };
    const first = managerWith({ api: {}, adapter, settingsStore });
    first.controller.start('agent');
    first.realtimeActive = true;
    await first.handleRealtimeEvent(event);
    await first.confirm(first.controller.session.id);

    const restarted = managerWith({ api: {}, adapter, settingsStore });
    restarted.controller.start('agent');
    restarted.realtimeActive = true;
    await restarted.handleRealtimeEvent({ ...event, event_id: randomEventId(), sequence: 2 });

    expect(adapter.replaceSelection).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual(['screen-voice:realtime-send', expect.objectContaining({
      result: expect.objectContaining({ proposal_id: ids[0], status: 'succeeded', result: { executed: false, duplicate: true } })
    })]);
  });
});

function randomEventId() {
  return '30000000-0000-4000-8000-000000000001';
}
