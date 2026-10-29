'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDock() {
  const defined = {};
  const page = { inert: false };

  class LexElement {
    constructor() {
      this.attributes = {};
      this.emitted = [];
    }
    emit(name, detail) { this.emitted.push({ name, detail }); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
  }

  const rootAttrs = {};
  const context = {
    console,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
    document: {
      head: { appendChild: jest.fn() },
      documentElement: {
        style: { setProperty: jest.fn() },
        setAttribute: (name, value) => { rootAttrs[name] = String(value); }
      },
      createElement: jest.fn(() => ({ textContent: '' })),
      querySelector: jest.fn((sel) => (sel === 'lex-body' ? page : null))
    },
    Lex: {
      LexElement,
      Chat: {},
      defineLex(name, klass) { defined[name] = klass; }
    }
  };
  context.window = context;
  context.globalThis = context;

  const sourcePath = path.resolve(__dirname, '../../src/js/lex/components/layout/lex-lana-dock.js');
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });

  const dock = new defined['lex-lana-dock']();
  dock._buildPanel = jest.fn();
  dock._fullscreenBtn = { setAttribute: jest.fn(), title: '', innerHTML: '' };
  return { dock, page, rootAttrs };
}

describe('lex-lana-dock full screen', () => {
  test('does nothing while the dock is minimized', () => {
    const { dock, rootAttrs } = loadDock();
    dock._collapsed = true;

    dock.toggleFullscreen();

    expect(dock._fullscreen).toBe(false);
    expect(rootAttrs['data-lana-dock-fullscreen']).toBeUndefined();
  });

  test('toggles on and off from the open dock and covers the page', () => {
    const { dock, page, rootAttrs } = loadDock();
    dock._collapsed = false;

    dock.toggleFullscreen();
    expect(dock.attributes['data-fullscreen']).toBe('true');
    expect(rootAttrs['data-lana-dock-fullscreen']).toBe('true');
    expect(page.inert).toBe(true);
    expect(dock._fullscreenBtn.setAttribute).toHaveBeenCalledWith('aria-label', 'Exit full screen');
    expect(dock.emitted).toContainEqual({ name: 'lex-lana-dock-fullscreen', detail: { fullscreen: true } });

    dock.toggleFullscreen();
    expect(dock.attributes['data-fullscreen']).toBe('false');
    expect(page.inert).toBe(false);
    expect(dock._fullscreenBtn.setAttribute).toHaveBeenLastCalledWith('aria-pressed', 'false');
  });

  test('minimizing leaves full screen so the next open is docked', () => {
    const { dock, page, rootAttrs } = loadDock();
    dock._collapsed = false;
    dock.toggleFullscreen();

    dock.minimize();

    expect(dock._fullscreen).toBe(false);
    expect(dock.attributes['data-fullscreen']).toBe('false');
    expect(rootAttrs['data-lana-dock-fullscreen']).toBe('false');
    expect(page.inert).toBe(false);
  });

  test('navigating exits full screen', () => {
    const { dock } = loadDock();
    dock._collapsed = false;
    dock.toggleFullscreen();

    dock._boundExitFullscreen();

    expect(dock._fullscreen).toBe(false);
    expect(dock.attributes['data-fullscreen']).toBe('false');
  });
});
