const { MacDesktopAdapter, UnsupportedDesktopAdapter } = require('../../src/screen-voice/desktop-adapter');

const fingerprint = { platform: 'darwin', processId: 10, bundleId: 'com.test', processName: 'Editor',
  windowTitle: 'Doc', role: 'AXTextArea', name: 'Body', bounds: null, selectionHash: null };
const context = { platform: 'darwin', activeApplication: 'Editor', processName: 'Editor', windowTitle: 'Doc',
  browserUrlOrDomainWhenSafelyAvailable: null,
  focusedElement: { role: 'AXTextArea', name: 'Body', value: '', isEditable: true, isPassword: false, bounds: null },
  selectedText: '', surroundingText: '', accessibleDocumentText: '', spreadsheetContext: null,
  nearbyControls: [], screenshotReference: null, collectionMethod: 'accessibility',
  truncationMetadata: { truncated: false, originalCharacters: 0, retainedCharacters: 0 }, targetFingerprint: fingerprint };

describe('macOS screen voice desktop adapter', () => {
  test('preserves and restores clipboard around paste fallback', async () => {
    const clipboard = { availableFormats: jest.fn(() => ['text/plain']), readBuffer: jest.fn(() => Buffer.from('before')),
      clear: jest.fn(), writeBuffer: jest.fn(), writeText: jest.fn() };
    const runHelper = jest.fn(async (command) => {
      if (command === 'context') return { ok: true, context };
      if (command === 'insert') return { ok: false, fallback: 'clipboard_paste' };
      return { ok: true };
    });
    const adapter = new MacDesktopAdapter({ clipboard, runHelper, sleep: async () => {} });
    await adapter.insert('new text', fingerprint);
    expect(clipboard.writeText).toHaveBeenCalledWith('new text');
    expect(clipboard.clear).toHaveBeenCalled();
    expect(clipboard.writeBuffer).toHaveBeenCalledWith('text/plain', Buffer.from('before'));
  });

  test('refuses mutation when the target changed', async () => {
    const changed = { ...context, windowTitle: 'Other', targetFingerprint: { ...fingerprint, windowTitle: 'Other' } };
    const runHelper = jest.fn(async (command) => command === 'context' ? { ok: true, context: changed } : { ok: true });
    const adapter = new MacDesktopAdapter({ runHelper });
    await expect(adapter.insert('x', fingerprint)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  });

  test('other packaged platforms fail explicitly rather than typing blindly', async () => {
    await expect(new UnsupportedDesktopAdapter('linux').getContext()).rejects.toMatchObject({ code: 'PLATFORM_UNSUPPORTED' });
  });
});
