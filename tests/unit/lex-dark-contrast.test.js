/**
 * In the dark theme the gray and brand ramps invert, so a "dark chip with white text"
 * built from primitives turned into white on light. The shared pieces now read tokens that
 * stay readable: fixed dark chips (tooltips, status fill hovers, the voice overlay, the
 * slide canvas) or pairs that flip together (strong buttons, accent buttons, avatars).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const CSS = read('css/lex-tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
const decl = (body) => Object.fromEntries([...body.matchAll(/(--lex-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const root = {};
for (const m of CSS.matchAll(/(^|\n):root\s*\{([^}]*)\}/g)) Object.assign(root, decl(m[2]));
const darkStart = CSS.indexOf(':root[data-lex-theme="dark"]');
const dark = Object.assign({}, root, decl(CSS.slice(darkStart, CSS.indexOf('}', darkStart))));

function hex(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) throw new Error('not a literal color: ' + value);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
}
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(hex(a)), luminance(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const WHITE = '#FFFFFF';

describe('dark theme: chips and filled buttons stay readable (4.5:1)', () => {
  test.each([
    ['tooltip', '--lex-tooltip-bg', '--lex-tooltip-fg'],
    ['strong button', '--lex-btn-strong-bg', '--lex-btn-strong-fg'],
    ['strong button hover', '--lex-btn-strong-bg-hover', '--lex-btn-strong-fg'],
    ['primary button', '--lex-bg-accent', '--lex-text-on-accent'],
    ['primary button hover', '--lex-bg-accent-hover', '--lex-text-on-accent'],
    ['avatar (text-primary fill, bg-primary text)', '--lex-text-primary', '--lex-bg-primary']
  ])('%s', (_name, bg, fg) => {
    expect(contrast(dark[bg], dark[fg])).toBeGreaterThanOrEqual(4.5);
  });

  test.each(['--lex-fill-danger-hover', '--lex-fill-success-hover', '--lex-fill-warning-hover', '--lex-fill-info-hover', '--lex-hud-bg', '--lex-hero-surface-raised'])('%s under white text', (bg) => {
    // Fixed: the same value as light, so dark is exactly as readable as light. (The light
    // success and warning hovers are 3.9 and 3.5:1, unchanged; at least 3:1 for a button.)
    expect(dark[bg]).toBe(root[bg]);
    expect(contrast(dark[bg], WHITE)).toBeGreaterThanOrEqual(3);
  });
});

describe('the shared pieces read those tokens', () => {
  test('tooltip, comment submit, documents button, voice overlay, agent avatar, slide canvas', () => {
    expect(read('js/lex/lex.forms.js')).toMatch(/\.lex-field-tooltip \{[^}]*var\(--lex-tooltip-bg[^}]*var\(--lex-tooltip-fg/);
    expect(read('js/lex/components/form/lex-document-comment-composer.js')).toMatch(/composer-submit \{[^}]*var\(--lex-btn-strong-bg[^}]*var\(--lex-btn-strong-fg/);
    expect(read('css/components/matter-documents-view.css')).toMatch(/\.mdv-doc-studio-btn \{[^}]*color: var\(--lex-text-on-accent/);
    expect(read('screen-voice/overlay/styles.css')).not.toContain('var(--lex-color-gray-900)');
    expect(read('css/agent-detail.css')).toMatch(/color: var\(--lex-bg-primary[^;]*;\s*background: var\(--lex-text-primary\)/);
    expect(read('css/file-editor.css')).toMatch(/\.office-slide-stage \{[^}]*var\(--lex-hero-surface-raised\)/);
  });

  test('button and modal hover fills under white text use the fixed fill hovers', () => {
    const btn = read('js/lex/components/foundation/lex-btn.js');
    const modal = read('js/lex/components/foundation/lex-modal.js');
    ['danger', 'success', 'warning', 'info'].forEach((k) => expect(btn).toContain(`var(--lex-fill-${k}-hover`));
    ['danger', 'success', 'info'].forEach((k) => expect(modal).toMatch(new RegExp(`lex-modal-btn--${k}:hover \\{[^}]*var\\(--lex-fill-${k}-hover`)));
  });
});
