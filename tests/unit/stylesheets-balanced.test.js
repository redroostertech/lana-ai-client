'use strict';

const fs = require('fs');
const path = require('path');

// A stylesheet with one brace missing does not fail to load: under Chromium's
// CSS nesting every rule after the gap becomes a descendant of the unclosed
// selector and silently never applies. A merge of two branches that both
// appended rules to file-viewer.css dropped exactly one brace (2026-09-25),
// and the source-contract tests that checked for the class names still passed.
// This test reads every stylesheet the app ships and checks the braces pair
// up, ignoring comments and quoted strings.

const CSS_ROOT = path.join(__dirname, '..', '..', 'src', 'css');

function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

/** Net brace depth after the whole text, and the first line where depth goes negative. */
function braceBalance(text) {
  let depth = 0;
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const skipped = text.slice(i, end === -1 ? text.length : end + 2);
      line += (skipped.match(/\n/g) || []).length;
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) { if (text[j] === '\\') j += 1; j += 1; }
      i = j + 1;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth < 0) return { depth, line };
    }
    i += 1;
  }
  return { depth, line: null };
}

describe('shipped stylesheets', () => {
  const files = cssFiles(CSS_ROOT);

  test('there are stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test.each(files.map((file) => [path.relative(CSS_ROOT, file), file]))('%s has balanced braces', (_name, file) => {
    const { depth, line } = braceBalance(fs.readFileSync(file, 'utf8'));
    expect({ unclosed: depth, closedTooEarlyAtLine: line }).toEqual({ unclosed: 0, closedTooEarlyAtLine: null });
  });

  test('the check itself sees an unclosed rule and an early close', () => {
    expect(braceBalance('.a { color: red;\n.b { }').depth).toBe(1);
    expect(braceBalance('.a { }\n}\n').line).toBe(2);
    expect(braceBalance('/* { */ .a { content: "}"; }').depth).toBe(0);
  });
});
