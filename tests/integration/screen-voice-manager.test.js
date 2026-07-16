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
  systemPreferences: { getMediaAccessStatus: jest.fn(() => 'granted'), askForMediaAccess: jest.fn(async () => true) }
}));

const { ElectronScreenVoice } = require('../../src/screen-voice/electron-screen-voice');
const { globalShortcut } = require('electron');

const fingerprint = { platform: 'darwin', processId: 9, bundleId: 'com.editor', processName: 'Editor',
  windowTitle: 'Doc', role: 'AXTextArea', name: 'Body', bounds: null, selectionHash: null };
const context = { platform: 'darwin', activeApplication: 'Editor', processName: 'Editor', windowTitle: 'Doc',
  browserUrlOrDomainWhenSafelyAvailable: null,
  focusedElement: { role: 'AXTextArea', name: 'Body', value: 'Draft', isEditable: true, isPassword: false, bounds: null },
  selectedText: '', surroundingText: 'Draft', accessibleDocumentText: 'Draft', spreadsheetContext: null,
  nearbyControls: [], screenshotReference: null, collectionMethod: 'accessibility',
  truncationMetadata: { truncated: false, originalCharacters: 5, retainedCharacters: 5 }, targetFingerprint: fingerprint };

function overlay() {
  return { isDestroyed: () => false, webContents: { id: 88, send: jest.fn((...args) => sent.push(args)) },
    setSize: jest.fn(), getBounds: jest.fn(() => ({ width: 500, height: 188 })), setPosition: jest.fn(),
    setFocusable: jest.fn(), show: jest.fn(), showInactive: jest.fn(), hide: jest.fn(), destroy: jest.fn() };
}

function managerWith({ api, adapter }) {
  const manager = new ElectronScreenVoice({ api, adapter, getMainWindow: () => null,
    getSavedServer: () => ({ url: 'http://local' }), settingsStore: { store: {}, set: jest.fn() } });
  manager.overlay = overlay();
  return manager;
}

describe('Electron screen voice orchestration', () => {
  beforeEach(() => { sent.length = 0; jest.clearAllMocks(); });

  test('audio transcript reaches literal insertion without an agent request', async () => {
    const api = { transcribe: jest.fn(async () => ({ text: 'Literal text' })), decide: jest.fn() };
    const adapter = { insert: jest.fn(async () => ({ ok: true })) };
    const manager = managerWith({ api, adapter });
    manager.controller.start('dictation');
    manager.controller.session.target = fingerprint;
    await manager.handleAudio({ sessionId: manager.controller.session.id, audioBase64: 'AAAA', mimeType: 'audio/webm' });
    expect(adapter.insert).toHaveBeenCalledWith('Literal text', fingerprint);
    expect(api.decide).not.toHaveBeenCalled();
    expect(manager.controller.state).toBe('idle');
  });

  test('selected rewrite is previewed, then revalidated replacement executes on confirmation', async () => {
    const selectedContext = { ...context, selectedText: 'rough draft',
      targetFingerprint: { ...fingerprint, selectionHash: 'selection' } };
    const api = { transcribe: jest.fn(async () => ({ text: 'Make this professional' })),
      decide: jest.fn(async () => ({ intent: 'rewrite', spokenResponse: '', displayResponse: 'Professional draft.',
        proposedActions: [{ type: 'replace_selection', arguments: { text: 'Professional draft.' },
          targetFingerprint: selectedContext.targetFingerprint, requiresConfirmation: true }],
        confidence: 0.95, contextUsed: ['selected_text'] })) };
    const adapter = { getContext: jest.fn(async () => selectedContext), replaceSelection: jest.fn(async () => ({ ok: true })) };
    const manager = managerWith({ api, adapter });
    manager.controller.start('agent'); manager.controller.session.target = fingerprint;
    const sessionId = manager.controller.session.id;
    await manager.handleAudio({ sessionId, audioBase64: 'AAAA', mimeType: 'audio/webm' });
    expect(manager.controller.state).toBe('previewing');
    expect(adapter.replaceSelection).not.toHaveBeenCalled();
    await manager.confirm(sessionId);
    expect(adapter.replaceSelection).toHaveBeenCalledWith('Professional draft.', selectedContext.targetFingerprint);
  });

  test('changed focus or malformed model output never mutates the target', async () => {
    const api = { transcribe: jest.fn(async () => ({ text: 'Summarize this' })),
      decide: jest.fn(async () => ({ arbitrary: 'output' })) };
    const adapter = { getContext: jest.fn(async () => ({ ...context, windowTitle: 'Other',
      targetFingerprint: { ...fingerprint, windowTitle: 'Other' } })), insert: jest.fn(), replaceSelection: jest.fn() };
    const manager = managerWith({ api, adapter });
    manager.controller.start('agent'); manager.controller.session.target = fingerprint;
    await manager.handleAudio({ sessionId: manager.controller.session.id, audioBase64: 'AAAA', mimeType: 'audio/webm' });
    expect(manager.controller.state).toBe('error');
    expect(api.decide).not.toHaveBeenCalled();
    expect(adapter.insert).not.toHaveBeenCalled();
  });

  test('provider failures become safe error state', async () => {
    const error = Object.assign(new Error('offline'), { code: 'NETWORK_UNAVAILABLE' });
    const manager = managerWith({ api: { transcribe: jest.fn(async () => { throw error; }) }, adapter: {} });
    manager.controller.start('dictation'); manager.controller.session.target = fingerprint;
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
    expect(globalShortcut.register).toHaveBeenCalledTimes(2);
    expect(testOverlay.showInactive).not.toHaveBeenCalled();

    manager.setOpenAtLogin(true);
    expect(testOverlay.showInactive).toHaveBeenCalled();

    manager.setAuthenticated(false);
    expect(globalShortcut.unregister).toHaveBeenCalled();
    expect(testOverlay.destroy).toHaveBeenCalled();
  });

  test('one invalid accelerator cannot prevent the other shortcut or overlay', () => {
    globalShortcut.register.mockImplementation((shortcut) => {
      if (shortcut === 'CommandOrControl+Shift+A') throw new TypeError('conversion failure');
      return true;
    });
    const manager = managerWith({ api: {}, adapter: {} });
    manager.setAuthenticated(true);
    expect(() => manager.setEntitlementEnabled(true)).not.toThrow();
    expect(globalShortcut.register).toHaveBeenCalledWith(
      'CommandOrControl+Shift+Space', expect.any(Function)
    );
  });

  test('with Open at Login off, the authenticated dictation shortcut opens listening', async () => {
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
    expect(manager.controller.state).toBe('listening');
    expect(testOverlay.showInactive).toHaveBeenCalled();
  });
});
