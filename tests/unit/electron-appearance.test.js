/**
 * electron-appearance.js: the one Light / Dark / System setting, owned by the main process.
 */
const { createAppearance, registerAppearanceIpc, normalizePreference, CHANNELS } = require('../../electron-appearance');

function fakeNativeTheme(dark = false) {
  const listeners = {};
  return {
    themeSource: 'system',
    shouldUseDarkColors: dark,
    on: (event, fn) => { listeners[event] = fn; },
    emit: (event) => listeners[event] && listeners[event]()
  };
}

function fakeWindow() {
  const sent = [];
  return { sent, isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel, value) => sent.push([channel, value]) } };
}

describe('appearance', () => {
  test('defaults to System, applied to nativeTheme at start', () => {
    const nativeTheme = fakeNativeTheme(false);
    const appearance = createAppearance({ nativeTheme, persistence: { read: () => null, write() {} } });
    expect(appearance.start()).toEqual({ preference: 'system', theme: 'light' });
    expect(nativeTheme.themeSource).toBe('system');
  });

  test('knows whether a choice is saved yet; set saves even the default value once', () => {
    const saved = [];
    const appearance = createAppearance({ nativeTheme: fakeNativeTheme(false), persistence: { read: () => null, write: (v) => saved.push(v) } });
    appearance.start();
    expect(appearance.hasSaved()).toBe(false);
    appearance.set('system');
    expect(appearance.hasSaved()).toBe(true);
    expect(saved).toEqual(['system']);
  });

  test('a saved preference is applied at start', () => {
    const nativeTheme = fakeNativeTheme(false);
    createAppearance({ nativeTheme, persistence: { read: () => 'dark', write() {} } }).start();
    expect(nativeTheme.themeSource).toBe('dark');
  });

  test('set saves, applies, tells every window and the subscribers; the same value again does nothing', () => {
    const nativeTheme = fakeNativeTheme(false);
    const saved = [];
    const win = fakeWindow();
    const appearance = createAppearance({ nativeTheme, persistence: { read: () => null, write: (v) => saved.push(v) }, getWindows: () => [win] });
    appearance.start();
    const heard = [];
    appearance.subscribe((value) => heard.push(value));
    nativeTheme.shouldUseDarkColors = true; // Electron flips it when themeSource becomes dark
    expect(appearance.set('Dark')).toEqual({ preference: 'dark', theme: 'dark' });
    appearance.set('dark');
    expect(saved).toEqual(['dark']);
    expect(nativeTheme.themeSource).toBe('dark');
    expect(heard).toEqual(['dark']);
    expect(win.sent).toEqual([[CHANNELS.changed, { preference: 'dark', theme: 'dark' }]]);
  });

  test('the computer switching while on System reaches every window', () => {
    const nativeTheme = fakeNativeTheme(false);
    const win = fakeWindow();
    createAppearance({ nativeTheme, persistence: { read: () => null, write() {} }, getWindows: () => [win] }).start();
    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');
    expect(win.sent).toEqual([[CHANNELS.changed, { preference: 'system', theme: 'dark' }]]);
  });

  test('unknown values become System; a broken store does not stop the change', () => {
    expect(normalizePreference('purple')).toBe('system');
    const nativeTheme = fakeNativeTheme(false);
    const appearance = createAppearance({ nativeTheme, persistence: { read: () => { throw new Error('locked'); }, write: () => { throw new Error('locked'); } } });
    appearance.start();
    appearance.set('light');
    expect(nativeTheme.themeSource).toBe('light');
  });

  test('IPC answers get and set', async () => {
    const handlers = {};
    const appearance = createAppearance({ nativeTheme: fakeNativeTheme(false), persistence: { read: () => null, write() {} } });
    appearance.start();
    registerAppearanceIpc({ ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } }, appearance });
    expect(await handlers[CHANNELS.get]()).toEqual({ preference: 'system', theme: 'light' });
    expect((await handlers[CHANNELS.set]({}, 'light')).preference).toBe('light');
  });
});
