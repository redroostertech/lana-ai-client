/**
 * The light sidebar is the color of the window's title bar (macOS default title bar,
 * measured #FFFFFF on 2026-11-16), so it reads as its own panel above the off-white
 * content, with a hairline divider on its right edge. Every state stays readable on it.
 * Dark is unchanged.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const CSS = read('css/lex-tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
const decl = (body) => Object.fromEntries([...body.matchAll(/(--lex-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const block = (sel) => { const at = CSS.indexOf(sel + ' {'); const s = CSS.indexOf('{', at) + 1; return CSS.slice(s, CSS.indexOf('}', s)); };
const root = {};
for (const m of CSS.matchAll(/(^|\n):root\s*\{([^}]*)\}/g)) Object.assign(root, decl(m[2]));
const light = Object.assign({}, root, decl(block('lex-sidebar[data-lex-theme="light"]')));
const dark = decl(block('lex-sidebar[data-lex-theme="dark"]'));

function resolve(v, d = 0) {
  const m = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(String(v).trim());
  return m && d < 10 ? resolve(light[m[1]], d + 1) : String(v).trim();
}
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(resolve(a)), lum(resolve(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const T = (name) => light['--lex-sidebar-' + name];

describe('light sidebar surface', () => {
  test('is the title bar white, and a divider sets it apart from the content', () => {
    expect(resolve(T('bg'))).toBe('#FFFFFF');
    expect(resolve(T('edge'))).toMatch(/^#/);
    expect(contrast(T('edge'), T('bg'))).toBeGreaterThan(1.15);
    const code = read('js/lex/components/layout/lex-sidebar.js');
    // Drawn above the children (footer, scroll fades), full height, not as an inset shadow they paint over.
    const after = code.slice(code.indexOf('.lex-sidebar-root::after {'));
    const rule = after.slice(0, after.indexOf('}'));
    expect(rule).toMatch(/position: absolute/);
    expect(rule).toMatch(/top: 0/);
    expect(rule).toMatch(/right: 0/);
    expect(rule).toMatch(/bottom: 0/);
    expect(rule).toMatch(/width: 1px/);
    expect(rule).toMatch(/background: var\(--_sb-edge\)/);
    expect(rule).toMatch(/pointer-events: none/);
    expect(rule).toMatch(/z-index: \d+/);
    expect(code).not.toMatch(/box-shadow: inset -1px 0 0 var\(--_sb-edge\)/);
  });

  test.each([
    ['text', 'text', 'bg', 4.5],
    ['muted text', 'text-muted', 'bg', 4.5],
    ['group titles', 'section-text', 'bg', 4.5],
    ['pinned / high', 'warning-text', 'bg', 4.5],
    ['normal priority', 'info-text', 'bg', 4.5],
    ['urgent / sign out', 'danger-text', 'bg', 4.5],
    ['create button and active item text', 'text-active', 'bg', 4.5],
    ['hover', 'text-active', 'hover-bg', 4.5],
    ['active', 'text-active', 'active-bg', 4.5],
    ['badge and avatar', 'avatar-text', 'avatar-bg', 4.5],
    ['switcher menu', 'text-active', 'menu-bg', 4.5],
    ['switcher menu hover', 'text-active', 'menu-hover-bg', 4.5]
  ])('%s is readable', (_n, fg, bg, min) => {
    expect(contrast(T(fg), T(bg))).toBeGreaterThanOrEqual(min);
  });

  test('the user menu hover is visible on the white menu (not the sidebar white)', () => {
    const code = read('js/lex/components/layout/lex-sidebar.js');
    const rule = code.slice(code.indexOf('.lex-sidebar-user-panel-item:hover {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('var(--lex-sidebar-menu-hover-bg');
    expect(contrast(T('menu-hover-bg'), T('menu-bg'))).toBeGreaterThan(1.04);
  });

  test('hover and active are still visible on white', () => {
    expect(contrast(T('hover-bg'), T('bg'))).toBeGreaterThan(1.15);
    expect(contrast(T('active-bg'), T('bg'))).toBeGreaterThan(1.3);
  });

  test('dark is unchanged: no divider, the same dark surface', () => {
    expect(dark['--lex-sidebar-bg']).toBe('#1D1B18');
    expect(dark['--lex-sidebar-edge']).toBe('transparent');
  });
});
