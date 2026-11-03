'use strict';

// "Keep this matter offline" switch (phase 10d, O6): shows the server's
// state, saves the person's choice, puts the switch back when the server
// refuses, and is not shown without the local AI engine.

const { JSDOM } = require('jsdom');

const flush = () => new Promise((r) => setTimeout(r, 0));
let window;
let document;
let CustomEvent;

describe('keep this matter offline switch', () => {
  let keep;
  beforeEach(() => {
    jest.resetModules();
    ({ window } = new JSDOM('<!doctype html><body></body>'));
    ({ document, CustomEvent } = window);
    global.window = window;
    window.electronAPI = { engine: {} };
    window.Lex = { Toast: { success: jest.fn(), error: jest.fn() } };
    keep = require('../../src/js/offline-keep-matter');
  });
  afterEach(() => { delete global.window; });

  const client = (state, failWith = null) => ({
    get: jest.fn(async () => state),
    put: jest.fn(async () => { if (failWith) {throw failWith;} return { kept_offline: true }; }),
    delete: jest.fn(async () => ({ kept_offline: false }))
  });

  test('shows the server state and saves a change to it', async () => {
    const host = document.createElement('div');
    const c = client({ kept_offline: true });
    const toggle = keep.mount(host, 'HART-1', c);
    await flush();
    expect(c.get).toHaveBeenCalledWith('/api/v1/offline-copies/matters/HART-1/keep');
    expect(toggle.checked).toBe(true);
    expect(toggle.hidden).toBe(false);
    toggle.dispatchEvent(new CustomEvent('lex-change', { detail: { value: false } }));
    await flush();
    expect(c.delete).toHaveBeenCalledWith('/api/v1/offline-copies/matters/HART-1/keep');
  });

  test('a refused change puts the switch back and says why', async () => {
    const host = document.createElement('div');
    const c = client({ kept_offline: false }, new Error('You already keep 50 matters offline.'));
    const toggle = keep.mount(host, 'HART-1', c);
    await flush();
    toggle.checked = true;
    toggle.dispatchEvent(new CustomEvent('lex-change', { detail: { value: true } }));
    await flush();
    expect(toggle.checked).toBe(false);
    expect(window.Lex.Toast.error).toHaveBeenCalledWith('You already keep 50 matters offline.');
  });

  test('without the local AI engine there is no switch (control)', () => {
    delete window.electronAPI;
    const host = document.createElement('div');
    expect(keep.mount(host, 'HART-1', client({ kept_offline: true }))).toBeNull();
    expect(host.children).toHaveLength(0);
  });
});
