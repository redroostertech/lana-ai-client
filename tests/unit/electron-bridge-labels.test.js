jest.mock('electron-store', () => class Store {
  constructor() { this.data = {}; }
  get(key, fallback) { return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : fallback; }
  set(key, value) { this.data[key] = value; }
});

jest.mock('electron', () => ({
  app: { focus: jest.fn() },
  dialog: { showMessageBox: jest.fn() },
  BrowserWindow: { getAllWindows: jest.fn(() => []), getFocusedWindow: jest.fn(() => null) },
}));

jest.mock('../../electron-logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

const bridge = require('../../electron-bridge');
const { app } = require('electron');

describe('electron bridge requester labels', () => {
  test('maps known apps and uses a safe generic fallback', () => {
    expect(bridge._internals.appLabel('lana-extension')).toBe('LANA Chrome extension');
    expect(bridge._internals.appLabel('lana-companion')).toBe('PAC');
    expect(bridge._internals.appLabel('<img src=x onerror=alert(1)>')).toBe('this companion application');
    expect(bridge._internals.appLabel(null)).toBe('this companion application');
  });

  test('focuses the desktop window before showing consent', () => {
    const win = {
      isDestroyed: jest.fn(() => false),
      isMinimized: jest.fn(() => true),
      restore: jest.fn(),
      show: jest.fn(),
      focus: jest.fn(),
    };

    bridge._internals.focusConsentWindow(win);

    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(app.focus).toHaveBeenCalledWith({ steal: true });
    expect(win.focus).toHaveBeenCalled();
  });
});
