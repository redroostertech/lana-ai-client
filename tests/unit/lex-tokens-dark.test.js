/**
 * lex-tokens.css dark theme: every color token has a dark value (or is an alias of
 * tokens that do), the names pages used without a definition are defined in both
 * themes, printing stays light, and the surfaces that must not change (sidebar's own
 * set, paper, QR, always-dark banners) are left out of the dark set.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '../../src/css/lex-tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(body) {
  return Object.fromEntries([...body.matchAll(/(--lex-[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function blockAfter(selectorRegex) {
  const m = selectorRegex.exec(CSS);
  if (!m) return null;
  const start = CSS.indexOf('{', m.index) + 1;
  return CSS.slice(start, CSS.indexOf('}', start));
}

const rootTokens = {};
for (const m of CSS.matchAll(/(^|\n):root\s*\{([^}]*)\}/g)) Object.assign(rootTokens, declarations(m[2]));
const darkBody = blockAfter(/@media screen\s*\{\s*:root\[data-lex-theme="dark"\]\s*\{/);
const dark = declarations(darkBody || '');

const SRC = path.join(__dirname, '../../src');
// Names used in src with no definition anywhere before the theme work (theme audit, 2026-11-16).
const ALIASES = ['--lex-text-muted', '--lex-accent', '--lex-bg-muted', '--lex-bg-card', '--lex-color-blue-600', '--lex-bg-hover',
  '--lex-status-warning-border', '--lex-color-text-muted', '--lex-surface-primary', '--lex-color-primary-600', '--lex-color-blue-700',
  '--lex-border-primary', '--lex-accent-strong', '--lex-color-success-200', '--lex-text-inverse', '--lex-color-text-primary',
  '--lex-color-primary-500', '--lex-color-amber-50', '--lex-status-danger-border', '--lex-color-primary', '--lex-color-green-600',
  '--lex-color-amber-700', '--lex-color-red-700', '--lex-color-green-700', '--lex-color-green-50', '--lex-color-danger-200',
  '--lex-color-danger', '--lex-color-amber-200', '--lex-color-accent-strong', '--lex-border', '--lex-bg-inverse', '--lex-bg-input',
  '--lex-bg-accent-subtle', '--lex-surface-secondary', '--lex-surface-muted', '--lex-status-success-border', '--lex-primary',
  '--lex-danger', '--lex-color-red-50', '--lex-color-red-200', '--lex-color-border', '--lex-color-blue-50', '--lex-color-amber-600',
  '--lex-color-accent-subtle', '--lex-text-strong', '--lex-success-text', '--lex-success-border', '--lex-status-info-border',
  '--lex-status-error-text', '--lex-color-warning-300', '--lex-color-surface-muted', '--lex-color-success-subtle', '--lex-color-success-800',
  '--lex-color-red-600', '--lex-color-purple-700', '--lex-color-purple-50', '--lex-color-primary-400', '--lex-color-green-200',
  '--lex-color-blue-300', '--lex-color-bg-subtle', '--lex-color-accent-border', '--lex-bg-action', '--lex-action-bg-hover', '--lex-action-bg',
  '--lex-warning-border', '--lex-warning-bg', '--lex-text-warning', '--lex-text-info', '--lex-text', '--lex-surface-subtle', '--lex-surface',
  '--lex-success-bg', '--lex-status-error-bg', '--lex-ring-focus', '--lex-primary-soft', '--lex-empty-icon-color', '--lex-danger-bg',
  '--lex-color-yellow-700', '--lex-color-yellow-100', '--lex-color-warning-200', '--lex-color-text', '--lex-color-surface',
  '--lex-color-success-strong', '--lex-color-red-100', '--lex-color-primary-700', '--lex-color-info-200', '--lex-color-green-100',
  '--lex-color-danger-bg', '--lex-color-blue-200', '--lex-color-bg-hover', '--lex-color-bg-card', '--lex-color-amber-800',
  '--lex-chat-success-text', '--lex-chat-success-soft', '--lex-chat-bg-subtle', '--lex-border-warning', '--lex-bg-warning-subtle',
  '--lex-bg-subtle', '--lex-bg-info-subtle', '--lex-action-text', '--lex-accent-primary', '--lex-accent-hover'];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : sourceFiles(full);
    return /\.(css|js|html)$/.test(entry.name) && !/\.min\./.test(entry.name) && entry.name !== 'tailwind-output.css' ? [full] : [];
  });
}

const COLORISH = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
function isColor(name, seen = new Set()) {
  const value = rootTokens[name];
  if (!value || seen.has(name)) return false;
  seen.add(name);
  if (/^(--lex-sidebar-|--lex-paper-|--lex-qr-|--lex-hero-|--lex-tooltip-|--lex-fill-|--lex-hud-)/.test(name)) return false; // fixed on purpose
  if (COLORISH.test(value)) return true;
  return [...value.matchAll(/var\((--lex-[a-zA-Z0-9-]+)/g)].some((m) => isColor(m[1], seen));
}
const colorTokens = Object.keys(rootTokens).filter((name) => isColor(name));

/** Covered when dark sets it, or every token it reads is covered (it follows them). */
function covered(name, seen = new Set()) {
  if (name in dark) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const refs = [...(rootTokens[name] || '').matchAll(/var\((--lex-[a-zA-Z0-9-]+)/g)].map((m) => m[1]);
  if (!refs.length) return false;
  return refs.every((ref) => !isColor(ref) || covered(ref, seen));
}

describe('dark token set', () => {
  test('lives on <html data-lex-theme="dark"> inside @media screen, so print is always light', () => {
    expect(darkBody).not.toBeNull();
    expect(darkBody).toMatch(/color-scheme:\s*dark/);
    expect(CSS).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/);
    expect(CSS).not.toMatch(/(^|[\s,}])\[data-lex-theme="dark"\]\s*\{[^}]*--lex-color-gray-50/);
  });

  test('every color token (the 130 and more defined in light) has a dark value or follows tokens that do', () => {
    expect(colorTokens.length).toBeGreaterThan(130);
    expect(colorTokens.filter((name) => !covered(name))).toEqual([]);
  });

  test('primitives and semantic tokens are set directly, not left to follow', () => {
    ['--lex-color-gray-50', '--lex-color-gray-900', '--lex-color-brand-900', '--lex-color-success-50', '--lex-color-info-700',
      '--lex-bg-primary', '--lex-bg-secondary', '--lex-text-primary', '--lex-text-secondary', '--lex-border-default',
      '--lex-status-danger-text', '--lex-shadow-lg', '--lex-modal-overlay', '--lex-chart-color-7'].forEach((name) => expect(dark).toHaveProperty([name]));
  });

  test('the alias names pages used without a definition are defined in dark only, never in light', () => {
    ALIASES.forEach((name) => {
      expect(rootTokens).not.toHaveProperty([name]);
      expect(dark).toHaveProperty([name]);
    });
  });

  test('so in light every use of an alias keeps its own fallback or inherits, as before: no light scope anywhere in src defines one', () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of text.matchAll(/(--lex-[a-zA-Z0-9-]+)\s*:\s*[^;{}]+;/g)) {
        if (!ALIASES.includes(m[1])) continue;
        // Allowed only inside the dark block of lex-tokens.css.
        const inDark = file.endsWith(path.join('css', 'lex-tokens.css')) && m.index > text.indexOf(':root[data-lex-theme="dark"]');
        if (!inDark) offenders.push(path.relative(SRC, file) + ' ' + m[1]);
      }
    }
    expect(offenders).toEqual([]);
    // And the uses are really there: the scan is not vacuous.
    const uses = sourceFiles(SRC).reduce((n, file) => n + (fs.readFileSync(file, 'utf8').match(/var\(--lex-(text-muted|accent|bg-muted|color-blue-600|color-primary-600|bg-hover)\b/g) || []).length, 0);
    expect(uses).toBeGreaterThan(150);
  });

  test('sidebar, paper, QR and always-dark banner tokens are not in the dark set', () => {
    Object.keys(dark).forEach((name) => expect(name).not.toMatch(/^--lex-(sidebar|paper|qr|hero)-/));
    expect(rootTokens['--lex-paper-bg']).toBe('#FFFFFF');
    expect(rootTokens['--lex-qr-bg']).toBe('#FFFFFF');
    expect(rootTokens['--lex-hero-bg']).toBe('#0D0807');
    expect(rootTokens['--lex-sidebar-bg']).toMatch(/^#/); // literal, so the inverted ramp cannot turn it light
  });

  test('the page body reads a token instead of a literal white', () => {
    expect(CSS).toMatch(/body\s*\{[^}]*background:\s*var\(--lex-body-bg/);
    expect(rootTokens['--lex-body-bg']).toBe('var(--lex-bg-primary)');
  });
});
