'use strict';

/**
 * Size limits for the channels registered outside the guard (docs/plans/harden-ipc.md):
 * the screen voice overlay, the update window and the Briefs bridge and frames. One table
 * (electron-ipc-policy.js RAW_IPC_LIMITS) and one measure (electron-ipc-guard.js payloadBytes).
 */

const { payloadBytes } = require('../../electron-ipc-guard');
const { RAW_IPC_LIMITS, IPC_POLICY } = require('../../electron-ipc-policy');

describe('payloadBytes', () => {
  test('counts strings, numbers, binary data and nested objects', () => {
    expect(payloadBytes('abc')).toBe(3);
    expect(payloadBytes(42)).toBe(8);
    expect(payloadBytes(new Float32Array(10))).toBe(40);
    expect(payloadBytes(new ArrayBuffer(16))).toBe(16);
    expect(payloadBytes({ a: 'xy', b: [1, 2] })).toBe(1 + 2 + 1 + 16);
    expect(payloadBytes(null)).toBe(0);
    expect(payloadBytes(undefined)).toBe(0);
  });

  test('stops early on huge or deeply nested values', () => {
    expect(payloadBytes('x'.repeat(5000), 100)).toBeGreaterThan(100);
    let deep = {};
    const root = deep;
    for (let i = 0; i < 200; i += 1) { deep.next = {}; deep = deep.next; }
    expect(payloadBytes(root)).toBe(Infinity);
  });
});

describe('the limits table', () => {
  test('covers every raw channel', () => {
    expect(RAW_IPC_LIMITS.screenVoice.default).toBeGreaterThan(0);
    expect(RAW_IPC_LIMITS.screenVoice['screen-voice:audio-complete']).toBeGreaterThan(16 * 1024 * 1024);
    for (const key of ['bridgeCall', 'recordingFrame', 'recordingLevels', 'talkFrame']) expect(RAW_IPC_LIMITS.briefs[key]).toBeGreaterThan(0);
    expect(IPC_POLICY['update-dialog-response'].args).toHaveLength(1);
  });
});

describe('the screen voice overlay refuses oversized payloads', () => {
  jest.resetModules();
  jest.doMock('electron-store', () => class Store { constructor() { this.data = {}; } get(k, d) { return k in this.data ? this.data[k] : d; } set(k, v) { this.data[k] = v; } });
  const handle = jest.fn();
  jest.doMock('electron', () => ({
    app: { isPackaged: false, getPath: () => '/tmp', dock: null }, BrowserWindow: jest.fn(), clipboard: {}, globalShortcut: { register: jest.fn(), unregister: jest.fn() },
    ipcMain: { handle }, screen: {}, shell: {}, systemPreferences: {}
  }));
  const { ElectronScreenVoice } = require('../../src/screen-voice/electron-screen-voice');

  test('a payload over its channel\'s limit is refused before the handler runs', async () => {
    const manager = new ElectronScreenVoice({ rootDir: '/tmp', getMainWindow: () => null, adapter: {}, api: {}, settingsStore: { store: {}, set: jest.fn() }, sleep: async () => {} });
    manager.overlay = { isDestroyed: () => false, webContents: { id: 5 } };
    manager.registerIpc();
    const [, statusHandler] = handle.mock.calls.find(([channel]) => channel === 'screen-voice:capture-status');
    const event = { sender: { id: 5 }, senderFrame: { parent: null, url: 'lana-app://app/public_html/screen-voice/overlay/index.html' } };
    await expect(statusHandler(event, { status: 'x', metadata: { label: 'y'.repeat(RAW_IPC_LIMITS.screenVoice.default + 1) } })).rejects.toThrow('too_large');
    await expect(statusHandler(event, { status: 'started', metadata: {} })).resolves.toBeTruthy();
  });
});
