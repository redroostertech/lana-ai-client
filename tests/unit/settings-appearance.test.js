/**
 * Settings > General > Appearance (settings-appearance.js): System / Light / Dark, default
 * System, wired to the shared theme, and moved by a change made elsewhere.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const MARKUP = read('settings-v2.html').match(/<section id="sv2-section-appearance"[\s\S]*?<\/section>/)[0];

const opened = [];
afterEach(() => { opened.splice(0).forEach((w) => w.close()); });

function setup({ dark = false, saved } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body>' + MARKUP + '</body></html>', {
    url: 'http://localhost/settings-v2.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  opened.push(w);
  const listeners = [];
  const media = { matches: dark, addEventListener: (t, fn) => listeners.push(fn), removeEventListener() {}, set(v) { this.matches = v; listeners.slice().forEach((fn) => fn({ matches: v })); } };
  w.matchMedia = () => media;
  if (saved) w.localStorage.setItem('lana:appearance.theme', saved);
  w.eval(read('js/lex/lex.theme.js'));
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/lex.forms.js', 'js/lex/components/form/lex-segmented.js', 'js/pages/settings-appearance.js'].forEach((rel) => w.eval(read(rel)));
  return { w, media, control: w.document.getElementById('sv2-appearance-theme'), note: w.document.getElementById('sv2-appearance-note') };
}

const tick = (w) => new Promise((resolve) => w.setTimeout(resolve, 0));

describe('Settings Appearance', () => {
  test('offers System, Light and Dark, with System chosen by default', async () => {
    const { w, control, note } = setup();
    await tick(w);
    expect(control.options.map((o) => o.label)).toEqual(['System', 'Light', 'Dark']);
    expect(control.value).toBe('system');
    expect(note.textContent).toBe('Follows your computer, which is set to light now.');
  });

  test('choosing Dark sets the shared theme', async () => {
    const { w, control, note } = setup();
    await tick(w);
    control.dispatchEvent(new w.CustomEvent('lex-change', { detail: { name: 'appearance_theme', value: 'dark' } }));
    expect(w.LexTheme.preference()).toBe('dark');
    expect(w.LexTheme.current()).toBe('dark');
    expect(note.textContent).toBe('Always dark, whatever your computer is set to.');
  });

  test('a change made elsewhere moves the control', async () => {
    const { w, control } = setup({ saved: 'light' });
    await tick(w);
    expect(control.value).toBe('light');
    w.LexTheme.setPreference('system');
    expect(control.value).toBe('system');
  });

  test('the section sits in General, made of Lex components', () => {
    const html = read('settings-v2.html');
    const general = html.slice(html.indexOf('id="sv2-panel-general"'), html.indexOf('id="sv2-panel-notifications"'));
    expect(general).toContain('id="sv2-section-appearance"');
    expect(MARKUP).toContain('<lex-card');
    expect(MARKUP).toContain('<lex-segmented');
    expect(MARKUP).not.toMatch(/style="/);
  });
});
