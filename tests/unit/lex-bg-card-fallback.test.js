/**
 * --lex-bg-card is a dark-only alias (lex-tokens-dark.test.js): in light it has no value,
 * so every use must carry its own light fallback or the surface turns transparent
 * (the report and dashboard period cards lost their white background, 2026-11-20).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');

function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

test('every var(--lex-bg-card) has a light fallback', () => {
  const missing = [];
  let uses = 0;
  for (const file of cssFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/var\(\s*--lex-bg-card\s*(,)?/g)) {
      uses += 1;
      if (!m[1]) missing.push(path.relative(SRC, file));
    }
  }
  expect(uses).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});
