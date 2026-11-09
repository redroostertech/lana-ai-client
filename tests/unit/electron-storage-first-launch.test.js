/**
 * The first-launch state in electron-storage.js (firstLaunchPersistence): the chat choice and when
 * setup was accepted and finished. electron and electron-store are faked, as in
 * electron-storage-brainchild.test.js.
 */

const path = require('path');

jest.mock('electron-store', () => class MockStore {
  constructor() { this._data = {}; }
  get(key, def) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : def; }
  set(key, value) { this._data[key] = value; }
  delete(key) { delete this._data[key]; }
  clear() { this._data = {}; }
  get store() { return this._data; }
});
jest.mock('electron', () => ({ app: { getPath: () => '/tmp/lana-test-userdata' } }), { virtual: true });

const { firstLaunchPersistence: state } = require(path.join(__dirname, '../../electron-storage.js'));

test('starts empty: no choice, not accepted, not finished', () => {
  expect(state.read()).toEqual({ chatId: null, acceptedAt: null, completedAt: null });
});

test('keeps only what it is given and leaves the rest', () => {
  state.write({ chatId: 'qwen3.5-4b-q4' });
  state.write({ acceptedAt: '2026-11-09T12:00:00.000Z' });
  expect(state.read()).toEqual({ chatId: 'qwen3.5-4b-q4', acceptedAt: '2026-11-09T12:00:00.000Z', completedAt: null });
  state.write({ completedAt: '2026-11-09T12:30:00.000Z' });
  expect(state.read().chatId).toBe('qwen3.5-4b-q4');
});

test('a chat id that is not a plain model id is not kept', () => {
  state.write({ chatId: '../../etc/passwd' });
  expect(state.read().chatId).toBeNull();
  state.write({ chatId: 42 });
  expect(state.read().chatId).toBeNull();
});
