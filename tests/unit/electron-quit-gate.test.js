'use strict';

// Quitting runs the local servers' shutdown once (electron-quit-gate.js): a second Cmd-Q or
// SIGTERM during it waits for the same shutdown instead of skipping it or starting another.

const { createQuitGate } = require('../../electron-quit-gate');

test('one shutdown, however many quit requests arrive during it; then the quit goes through', async () => {
  let finish;
  const cleanup = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const quit = jest.fn();
  const gate = createQuitGate({ cleanup, quit });
  const first = { preventDefault: jest.fn() };
  const second = { preventDefault: jest.fn() };
  expect(gate.beforeQuit(first)).toBe(false);
  expect(gate.beforeQuit(second)).toBe(false);
  expect(first.preventDefault).toHaveBeenCalled();
  expect(second.preventDefault).toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(quit).not.toHaveBeenCalled();
  finish();
  await gate.done();
  expect(quit).toHaveBeenCalledTimes(1);
  const final = { preventDefault: jest.fn() };
  expect(gate.beforeQuit(final)).toBe(true);
  expect(final.preventDefault).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('a failed shutdown still lets the app quit', async () => {
  const quit = jest.fn();
  const gate = createQuitGate({ cleanup: () => Promise.reject(new Error('engine')), quit, log: () => {} });
  expect(gate.beforeQuit({ preventDefault() {} })).toBe(false);
  await gate.done();
  expect(quit).toHaveBeenCalledTimes(1);
  expect(gate.beforeQuit({ preventDefault() {} })).toBe(true);
});

test('electron-main.js uses the gate in before-quit', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
  const handler = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf('\n});', main.indexOf("app.on('before-quit'")));
  expect(handler).toMatch(/if \(!quitGate\.beforeQuit\(event\)\) return;/);
  expect(main).not.toMatch(/localEngineQuitPrepared/);
});
