/**
 * lex.theme.js: the one light or dark resolver every page shares. The person's setting
 * (Light, Dark or System) wins; System, and no setting at all, follows the computer. It is
 * never dark by default, and it changes live when the computer or the setting changes.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE = path.join(__dirname, '../../src/js/lex/lex.theme.js');
const theme = require(SOURCE);

function fakeMedia(dark) {
  const listeners = [];
  return {
    matches: dark,
    addEventListener: (type, fn) => { if (type === 'change') listeners.push(fn); },
    removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    set(value) { this.matches = value; listeners.slice().forEach((fn) => fn({ matches: value })); }
  };
}

function fakeStorage(initial) {
  const values = Object.assign({}, initial);
  return {
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => { values[key] = String(value); },
    removeItem: (key) => { delete values[key]; }
  };
}

describe('resolveTheme', () => {
  test('the setting wins over the computer', () => {
    expect(theme.resolveTheme('light', true)).toBe('light');
    expect(theme.resolveTheme('dark', false)).toBe('dark');
  });

  test('System follows the computer', () => {
    expect(theme.resolveTheme('system', true)).toBe('dark');
    expect(theme.resolveTheme('system', false)).toBe('light');
  });

  test('no setting, or a value it does not know, follows the computer and is not dark on a light computer', () => {
    expect(theme.resolveTheme(undefined, false)).toBe('light');
    expect(theme.resolveTheme(null, false)).toBe('light');
    expect(theme.resolveTheme('purple', false)).toBe('light');
    expect(theme.resolveTheme(undefined, true)).toBe('dark');
  });

  test('normalizePreference keeps the three choices and makes everything else System', () => {
    expect(theme.normalizePreference('Dark')).toBe('dark');
    expect(theme.normalizePreference(' light ')).toBe('light');
    expect(theme.normalizePreference('')).toBe('system');
    expect(theme.normalizePreference(42)).toBe('system');
  });

  test('the setting lives under one key', () => {
    expect(theme.SETTING_KEY).toBe('lana:appearance.theme');
  });
});

describe('createThemeController', () => {
  test('with no setting it follows the computer and changes live', () => {
    const media = fakeMedia(false);
    const controller = theme.createThemeController({ media, storage: fakeStorage() });
    const seen = [];
    controller.subscribe((value) => seen.push(value));
    expect(controller.preference()).toBe('system');
    expect(controller.current()).toBe('light');
    media.set(true);
    expect(controller.current()).toBe('dark');
    media.set(false);
    expect(seen).toEqual(['dark', 'light']);
  });

  test('a saved Light ignores the computer going dark', () => {
    const media = fakeMedia(false);
    const controller = theme.createThemeController({ media, storage: fakeStorage({ 'lana:appearance.theme': 'light' }) });
    const seen = [];
    controller.subscribe((value) => seen.push(value));
    media.set(true);
    expect(controller.current()).toBe('light');
    expect(seen).toEqual([]);
  });

  test('changing the setting saves it, tells listeners, and System goes back to the computer', () => {
    const media = fakeMedia(true);
    const storage = fakeStorage();
    const controller = theme.createThemeController({ media, storage });
    const seen = [];
    const stop = controller.subscribe((value, preference) => seen.push(value + ':' + preference));
    controller.setPreference('light');
    expect(storage.getItem('lana:appearance.theme')).toBe('light');
    expect(controller.current()).toBe('light');
    controller.setPreference('system');
    expect(controller.current()).toBe('dark');
    stop();
    controller.setPreference('light');
    expect(seen).toEqual(['light:light', 'dark:system']);
  });

  test('a setting saved by another window is picked up on refresh', () => {
    const storage = fakeStorage();
    const controller = theme.createThemeController({ media: fakeMedia(false), storage });
    storage.setItem('lana:appearance.theme', 'dark');
    controller.refresh();
    expect(controller.current()).toBe('dark');
  });

  test('a preference-only change (System to Light on a light computer) is heard too', () => {
    const controller = theme.createThemeController({ media: fakeMedia(false), storage: fakeStorage() });
    const seen = [];
    controller.subscribe((value, preference) => seen.push(value + ':' + preference));
    controller.setPreference('light');
    expect(seen).toEqual(['light:light']);
  });

  test('when storage cannot be written, the choice still applies on this page', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    const controller = theme.createThemeController({ media: fakeMedia(false), storage });
    controller.setPreference('dark');
    expect(controller.current()).toBe('dark');
    expect(controller.preference()).toBe('dark');
  });

  test('in the app the main process owns the setting: set goes there, its answer and its changes come back', async () => {
    let pushed = null;
    const sent = [];
    const remote = {
      get: () => Promise.resolve({ preference: 'dark', theme: 'dark' }),
      set: (value) => { sent.push(value); return Promise.resolve({ preference: value, theme: value === 'dark' ? 'dark' : 'light' }); },
      onChange: (fn) => { pushed = fn; }
    };
    const storage = fakeStorage({ 'lana:appearance.theme': 'light' });
    const controller = theme.createThemeController({ media: fakeMedia(false), storage, remote });
    expect(controller.current()).toBe('light'); // the first-paint copy until main answers
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.preference()).toBe('dark');
    expect(storage.getItem('lana:appearance.theme')).toBe('dark'); // main keeps the copy in step
    controller.setPreference('system');
    expect(sent).toEqual(['system']);
    expect(controller.current()).toBe('light');
    pushed({ preference: 'light', theme: 'light' }); // changed in another window or in Briefs
    expect(controller.preference()).toBe('light');
  });

  test('works without storage or matchMedia, and is light then', () => {
    const controller = theme.createThemeController({});
    expect(controller.current()).toBe('light');
  });
});

describe('in the page', () => {
  function load(html, { dark = false, saved, blocked = false } = {}) {
    const dom = new JSDOM(html, { url: 'http://localhost/dashboard.html', runScripts: 'outside-only' });
    const media = fakeMedia(dark);
    dom.window.matchMedia = () => media;
    if (saved) dom.window.localStorage.setItem('lana:appearance.theme', saved);
    if (blocked) Object.defineProperty(dom.window, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    dom.window.eval(fs.readFileSync(SOURCE, 'utf8'));
    return { window: dom.window, media };
  }

  const AUTO = '<!doctype html><html data-lex-theme="auto"><head></head><body></body></html>';

  test('a setting saved in another window (storage event) is followed live', () => {
    const { window } = load(AUTO);
    const root = window.document.documentElement;
    expect(root.getAttribute('data-lex-theme')).toBe('light');
    window.localStorage.setItem('lana:appearance.theme', 'dark');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'lana:appearance.theme', newValue: 'dark' }));
    expect(root.getAttribute('data-lex-theme')).toBe('dark');
    expect(window.LexTheme.preference()).toBe('dark');
  });

  test('with localStorage blocked it still follows the computer and a choice made here', () => {
    const { window, media } = load(AUTO, { blocked: true });
    const root = window.document.documentElement;
    expect(root.getAttribute('data-lex-theme')).toBe('light');
    media.set(true);
    expect(root.getAttribute('data-lex-theme')).toBe('dark');
    window.LexTheme.setPreference('light');
    expect(root.getAttribute('data-lex-theme')).toBe('light');
  });

  test('loaded twice, the first LexTheme stays (no second set of listeners)', () => {
    const { window } = load(AUTO);
    const first = window.LexTheme;
    window.eval(fs.readFileSync(SOURCE, 'utf8'));
    expect(window.LexTheme).toBe(first);
    let heard = 0;
    window.document.addEventListener('lex-theme-change', () => { heard += 1; });
    first.setPreference('dark');
    expect(heard).toBe(1);
  });

  test('a page that asks for it (data-lex-theme="auto") gets the theme on <html> at once, and live', () => {
    const { window, media } = load('<!doctype html><html data-lex-theme="auto"><head></head><body></body></html>');
    const root = window.document.documentElement;
    expect(root.getAttribute('data-lex-theme')).toBe('light');
    const events = [];
    window.document.addEventListener('lex-theme-change', (e) => events.push(e.detail.theme));
    media.set(true);
    expect(root.getAttribute('data-lex-theme')).toBe('dark');
    window.LexTheme.setPreference('light');
    expect(root.getAttribute('data-lex-theme')).toBe('light');
    expect(events).toEqual(['dark', 'light']);
  });

  test('a page that has not asked keeps <html> as it is, but LexTheme still answers', () => {
    const { window } = load('<!doctype html><html><head></head><body></body></html>', { dark: true });
    expect(window.document.documentElement.hasAttribute('data-lex-theme')).toBe(false);
    expect(window.LexTheme.current()).toBe('dark');
  });

  test('a saved setting from an earlier visit is used before paint', () => {
    const { window } = load('<!doctype html><html data-lex-theme="auto"><head></head><body></body></html>', { dark: false, saved: 'dark' });
    expect(window.document.documentElement.getAttribute('data-lex-theme')).toBe('dark');
  });
});
