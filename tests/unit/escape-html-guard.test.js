/**
 * Guard: no hand-rolled textContent -> innerHTML escape helpers.
 *
 * Setting el.textContent and reading el.innerHTML back escapes & < > only.
 * It leaves " and ' raw, so the result is unsafe inside a quoted attribute.
 * A second rule flags escapes that handle < but not ", which are only safe
 * in element text. Every renderer escape goes through the shared helper:
 *   - Lex.escapeHtml / LexElement#escapeHtml (src/js/lex/lex.core.js)
 *   - Lex.Utils.escapeHtml (src/js/lex/lex.utils.js)
 * This scans src/ (.js and inline <script> in .html) and fails when the
 * pattern comes back anywhere outside the allowlist.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

// The shared helpers only. Do not add feature files here: call
// Lex.escapeHtml (or this.escapeHtml in a Lex component) instead.
const ALLOWLIST = new Set([
  'src/js/lex/lex.core.js',
  'src/js/lex/lex.utils.js',
]);

const SKIP_DIRS = new Set(['node_modules', 'vendor']);
const WINDOW = 6;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.(js|mjs|cjs|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Finds `x.textContent = ...` (or innerText) followed within a few lines by a
// read of the same element's innerHTML: the escape-by-DOM shape.
function findEscapeHelpers(source) {
  const lines = source.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /([A-Za-z_$][\w$]*)\.(?:textContent|innerText)\s*=(?!=)/.exec(lines[i]);
    if (!m) continue;
    const readBack = new RegExp('\\b' + m[1].replace(/\$/g, '\\$') + '\\.innerHTML\\b(?!\\s*=[^=])');
    for (let j = i; j < Math.min(lines.length, i + WINDOW); j++) {
      const probe = j === i ? lines[j].slice(m.index + m[0].length) : lines[j];
      if (readBack.test(probe)) {
        hits.push(i + 1);
        break;
      }
    }
  }
  return hits;
}

// Rule 2: an escape that turns < into &lt; but leaves " alone is only safe
// in element text, and gets reused in attributes sooner or later. Flag any
// such replace chain, split/join chain or escape map unless &quot; is handled
// within a few lines. Entries are 'file#enclosingFunction' with a reason.
const TEXT_ONLY_ALLOWLIST = new Map([
  // JSON syntax highlighter: its token regex needs the raw " characters, and
  // the result only ever goes inside <pre><code>.
  ['src/js/lex/chat/lex-chat.format.js#syntaxHighlight', 'token regex matches raw quotes; element content only'],
]);

const LT_ESCAPE = [
  /\.replace\(\s*\/<\/g\s*,\s*['"`]&lt;['"`]\s*\)/,
  /\.split\(\s*['"`]<['"`]\s*\)\s*\.join\(\s*['"`]&lt;['"`]\s*\)/,
  /['"`]<['"`]\s*:\s*['"`]&lt;['"`]/,
];
const QUOTE_ESCAPED = /&quot;|&#34;|&#x22;/i;

function enclosingFunction(lines, index) {
  for (let i = index; i >= 0; i--) {
    const m = /function\s+([A-Za-z_$][\w$]*)\s*\(|([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:function\b|\([^)]*\)\s*=>)|^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(lines[i]);
    if (m) return m[1] || m[2] || m[3];
  }
  return '';
}

function findTextOnlyEscapes(source) {
  const lines = source.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const near = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
    // Character-class form: .replace(/[&<>]/g, ...) feeding an &lt; map.
    const cls = /\.replace\(\s*\/\[([^\]]*)\]\/g/.exec(lines[i]);
    const classEscape = cls && cls[1].includes('<') && !cls[1].includes('"') && near.includes('&lt;');
    if (!classEscape && !LT_ESCAPE.some((re) => re.test(lines[i]))) continue;
    if (!QUOTE_ESCAPED.test(near)) hits.push({ line: i + 1, fn: enclosingFunction(lines, i) });
  }
  return hits;
}

describe('escape helper guard', () => {
  test('detector flags the old pattern and ignores unrelated innerHTML use', () => {
    expect(findEscapeHelpers('function e(t){\n  const d = document.createElement("div");\n  d.textContent = t;\n  return d.innerHTML;\n}')).toEqual([3]);
    expect(findEscapeHelpers('const f = (s) => { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; };')).toEqual([1]);
    expect(findEscapeHelpers('p.textContent = t;\nwrapper.appendChild(p);\nreturn wrapper.innerHTML;')).toEqual([]);
    expect(findEscapeHelpers('el.textContent = t;\nel.innerHTML = "";')).toEqual([]);
  });

  test('no textContent/innerHTML escape helper exists outside the shared helpers', () => {
    const offenders = [];
    for (const file of walk(SRC, [])) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWLIST.has(rel) || /\.backup$/.test(rel)) continue;
      for (const line of findEscapeHelpers(fs.readFileSync(file, 'utf8'))) offenders.push(rel + ':' + line);
    }
    expect(offenders).toEqual([]);
  });

  test('allowlist entries exist', () => {
    for (const rel of ALLOWLIST) expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    for (const key of TEXT_ONLY_ALLOWLIST.keys()) {
      const [rel, fn] = key.split('#');
      const hits = findTextOnlyEscapes(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      expect(hits.map((h) => h.fn)).toContain(fn);
    }
  });

  test('text-only detector flags < without " and passes full escapes', () => {
    expect(findTextOnlyEscapes("function esc(t) {\n  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');\n}"))
      .toEqual([{ line: 2, fn: 'esc' }]);
    expect(findTextOnlyEscapes("const e = (t) => String(t)\n  .split('&').join('&amp;')\n  .split('<').join('&lt;');"))
      .toEqual([{ line: 3, fn: 'e' }]);
    expect(findTextOnlyEscapes("var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };")).toHaveLength(1);
    expect(findTextOnlyEscapes("function ok(t) {\n  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');\n}")).toEqual([]);
    expect(findTextOnlyEscapes("var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' };")).toEqual([]);
    expect(findTextOnlyEscapes("x.replace(/[<>]/g, '')")).toEqual([]);
    expect(findTextOnlyEscapes("const M = { '&': '&amp;', '<': '&lt;' };\nfunction f(t) { return t.replace(/[&<]/g, (c) => M[c]); }")).toHaveLength(2);
    expect(findTextOnlyEscapes("function g(t) { return t.replace(/[&<>\"']/g, (c) => M[c]); }\nconst M = { '<': '&lt;', '\"': '&quot;' };")).toEqual([]);
  });

  test('no escape outside the allowlist handles < but not "', () => {
    const offenders = [];
    for (const file of walk(SRC, [])) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (/\.backup$/.test(rel)) continue;
      for (const hit of findTextOnlyEscapes(fs.readFileSync(file, 'utf8'))) {
        if (!TEXT_ONLY_ALLOWLIST.has(rel + '#' + hit.fn)) offenders.push(rel + ':' + hit.line + ' (' + hit.fn + ')');
      }
    }
    expect(offenders).toEqual([]);
  });
});
