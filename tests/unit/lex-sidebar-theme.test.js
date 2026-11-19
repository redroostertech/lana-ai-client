/**
 * lex-sidebar follows the shared theme (lex.theme.js): it carries data-lex-theme so its
 * light or dark token set applies, changes live, and shows the logo that reads on it.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const LEX = ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/layout/lex-sidebar.js'].map(read);
const THEME = read('js/lex/lex.theme.js');

function setup({ dark = false, withTheme = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><lex-sidebar logo-src="img/logo-light.png"></lex-sidebar></body></html>', {
    url: 'http://localhost/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const listeners = [];
  const media = {
    matches: dark,
    addEventListener: (type, fn) => listeners.push(fn),
    removeEventListener: () => {},
    set(value) { this.matches = value; listeners.slice().forEach((fn) => fn({ matches: value })); }
  };
  dom.window.matchMedia = () => media;
  if (withTheme) dom.window.eval(THEME);
  LEX.forEach((code) => dom.window.eval(code));
  return { window: dom.window, media };
}

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 0));

describe('lex-sidebar theme', () => {
  test('gets the light theme on a light computer, with the dark-ink logo', async () => {
    const { window } = setup({ dark: false });
    await tick(window);
    const sidebar = window.document.querySelector('lex-sidebar');
    expect(sidebar.getAttribute('data-lex-theme')).toBe('light');
    expect(sidebar.querySelector('.lex-sidebar-logo').getAttribute('src')).toBe('img/logo-dark.png');
  });

  test('gets the dark theme on a dark computer and follows a live change', async () => {
    const { window, media } = setup({ dark: true });
    await tick(window);
    const sidebar = window.document.querySelector('lex-sidebar');
    expect(sidebar.getAttribute('data-lex-theme')).toBe('dark');
    expect(sidebar.querySelector('.lex-sidebar-logo').getAttribute('src')).toBe('img/logo-light.png');
    media.set(false);
    expect(sidebar.getAttribute('data-lex-theme')).toBe('light');
    expect(sidebar.querySelector('.lex-sidebar-logo').getAttribute('src')).toBe('img/logo-dark.png');
  });

  test('the setting wins over the computer', async () => {
    const { window } = setup({ dark: true });
    window.LexTheme.setPreference('light');
    await tick(window);
    expect(window.document.querySelector('lex-sidebar').getAttribute('data-lex-theme')).toBe('light');
  });

  function block(css, selector) {
    const at = css.indexOf(selector + ' {');
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf('}', at));
    return Object.fromEntries([...body.matchAll(/(--lex-sidebar-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  }

  test('the dark set is exactly the :root default (today\'s look)', () => {
    const css = read('css/lex-tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rootTokens = Object.fromEntries([...css.slice(0, css.indexOf('lex-sidebar[data-lex-theme')).matchAll(/(--lex-sidebar-[a-z-]+):\s*([^;]+);/g)]
      .filter((m) => !/width|height|gap/.test(m[1])).map((m) => [m[1], m[2].trim()]));
    expect(block(css, 'lex-sidebar[data-lex-theme="dark"]')).toEqual(rootTokens);
    expect(Object.keys(block(css, 'lex-sidebar[data-lex-theme="light"]')).sort()).toEqual(Object.keys(rootTokens).sort());
  });

  test('light: group titles use the 700 shades, hover gray-200, active gray-300, menu hover its own gray-100', () => {
    const light = block(read('css/lex-tokens.css'), 'lex-sidebar[data-lex-theme="light"]');
    expect(light['--lex-sidebar-warning-text']).toBe('var(--lex-color-warning-700)');
    expect(light['--lex-sidebar-info-text']).toBe('var(--lex-color-info-700)');
    expect(light['--lex-sidebar-danger-text']).toBe('var(--lex-color-danger-700)');
    expect(light['--lex-sidebar-hover-bg']).toBe('var(--lex-color-gray-200)');
    expect(light['--lex-sidebar-active-bg']).toBe('var(--lex-color-gray-300)');
    expect(light['--lex-sidebar-menu-hover-bg']).toBe('var(--lex-color-gray-100)');
  });

  test('dark: the selected row stands apart from hover, from the sidebar tokens (calendar screenshots, 2026-11-18)', () => {
    const css = read('css/lex-tokens.css');
    const dark = block(css, 'lex-sidebar[data-lex-theme="dark"]');
    expect(dark['--lex-sidebar-hover-bg']).toBe('#2D2B27');
    expect(dark['--lex-sidebar-active-bg']).toBe('color-mix(in srgb, var(--lex-sidebar-text-active) 14%, var(--lex-sidebar-bg))');
    expect(block(css, 'lex-sidebar[data-lex-theme="light"]')['--lex-sidebar-active-bg']).toBe('var(--lex-color-gray-300)');
  });

  test('group titles and the app menu hover read the sidebar tokens, not the page status colors', () => {
    const code = read('js/lex/components/layout/lex-sidebar.js');
    const rule = (sel) => code.slice(code.indexOf(sel + ' {'), code.indexOf('}', code.indexOf(sel + ' {')));
    expect(rule('.lex-sidebar-workspace-group-title[data-group="pinned"]')).toContain('--lex-sidebar-warning-text');
    expect(rule('.lex-sidebar-task-group-title[data-priority="urgent"]')).toContain('--lex-sidebar-danger-text');
    expect(rule('.lex-sidebar-task-group-title[data-priority="high"]')).toContain('--lex-sidebar-warning-text');
    expect(rule('.lex-sidebar-task-group-title[data-priority="normal"]')).toContain('--lex-sidebar-info-text');
    expect(rule('.lex-sidebar-app-option[data-active="true"]')).toContain('--lex-sidebar-menu-hover-bg');
  });

  test('light and dark token sets exist for the sidebar', () => {
    const tokens = read('css/lex-tokens.css');
    expect(tokens).toMatch(/lex-sidebar\[data-lex-theme="light"\]\s*\{[^}]*--lex-sidebar-bg:/);
    expect(tokens).toMatch(/lex-sidebar\[data-lex-theme="dark"\]\s*\{[^}]*--lex-sidebar-bg:/);
  });
});
