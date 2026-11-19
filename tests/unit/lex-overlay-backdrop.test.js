/**
 * Lex overlay backdrops: lex-drawer and lex-modal dim the page with the shared
 * --lex-modal-overlay token (not their own literal colors), and the dark value
 * of that token dims clearly over the dark surfaces (alpha at least 0.7).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const CSS = read('css/lex-tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(source, selector) {
  const at = source.indexOf(selector + ' {');
  if (at === -1) return null;
  const start = source.indexOf('{', at) + 1;
  return source.slice(start, source.indexOf('}', start));
}

function alpha(value) {
  const m = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)/.exec(value || '');
  return m ? Number(m[1]) : NaN;
}

test.each([
  ['lex-drawer', 'js/lex/components/foundation/lex-drawer.js', '.lex-drawer-backdrop'],
  ['lex-modal', 'js/lex/components/foundation/lex-modal.js', '.lex-modal-backdrop']
])('%s backdrop uses the shared overlay token', (_name, file, selector) => {
  const body = ruleBody(read(file), selector);
  expect(body).not.toBeNull();
  expect(body).toMatch(/background:\s*var\(--lex-modal-overlay[,)]/);
});

test('the dark overlay dims clearly; the light one is unchanged', () => {
  const darkStart = CSS.search(/:root\[data-lex-theme="dark"\]\s*\{/);
  const dark = CSS.slice(darkStart, CSS.indexOf('}', darkStart));
  const darkValue = /--lex-modal-overlay:\s*([^;]+);/.exec(dark)[1];
  expect(alpha(darkValue)).toBeGreaterThanOrEqual(0.7);
  const lightValue = /--lex-modal-overlay:\s*([^;]+);/.exec(CSS)[1];
  expect(lightValue.trim()).toBe('rgba(13, 8, 7, 0.5)');
});
