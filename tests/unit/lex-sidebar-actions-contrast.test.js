/**
 * Sidebar action buttons ("+ New Automation", "Build an agent", "New Dashboard", "New
 * meeting"): readable on the sidebar in light and dark. The sidebar is light on a light
 * computer since the theme work, so an app stylesheet that paints them white makes them
 * vanish. Each rule must use the sidebar tokens, which resolve per theme.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const TOKENS = read('css/lex-tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');

const decl = (body) => Object.fromEntries([...body.matchAll(/(--lex-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const block = (css, selector) => {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return null;
  const start = css.indexOf('{', at) + 1;
  return css.slice(start, css.indexOf('}', start));
};
const root = {};
for (const m of TOKENS.matchAll(/(^|\n):root\s*\{([^}]*)\}/g)) Object.assign(root, decl(m[2]));
const THEMES = {
  light: Object.assign({}, root, decl(block(TOKENS, 'lex-sidebar[data-lex-theme="light"]'))),
  dark: Object.assign({}, root, decl(block(TOKENS, 'lex-sidebar[data-lex-theme="dark"]')))
};

function resolve(value, vars, depth = 0) {
  const v = String(value).trim();
  const m = /^var\((--[a-zA-Z0-9-]+)(?:\s*,\s*(.+))?\)$/.exec(v);
  if (!m) return v;
  if (depth > 10) throw new Error('loop at ' + v);
  return resolve(vars[m[1]] !== undefined ? vars[m[1]] : m[2], vars, depth + 1);
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (hex) => {
  if (/^#fff$/i.test(hex)) hex = '#ffffff';
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const RULES = [
  ['automation/styles.css', '.lex-sidebar-root .lex-sidebar-nav-item[data-id="create"]'],
  ['css/agents.css', '.lex-sidebar-root .lex-sidebar-nav-item[data-id="create"]']
];

describe('sidebar action buttons stay readable in both themes', () => {
  test.each(RULES.flatMap(([file, sel]) => ['light', 'dark'].map((theme) => [file, theme, sel])))('%s (%s)', (file, theme, sel) => {
    const rule = block(read(file).replace(/\/\*[\s\S]*?\*\//g, ''), sel);
    expect(rule).not.toBeNull();
    const color = /(?:^|;|\n)\s*color:\s*([^;]+);/.exec(rule)[1];
    const vars = THEMES[theme];
    const text = resolve(color, vars);
    const bg = resolve('var(--lex-sidebar-bg)', vars);
    expect(text).toMatch(/^#[0-9a-f]{3,6}$/i);
    expect(contrast(text, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('the shared create variants in lex-sidebar read sidebar tokens too (control)', () => {
    const code = read('js/lex/components/layout/lex-sidebar.js');
    const rule = code.slice(code.indexOf('.lex-sidebar-nav-item[data-variant="create-chat"] {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('color: var(--_sb-text-active)');
  });
});
