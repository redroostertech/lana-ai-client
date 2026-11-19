'use strict';

/**
 * Every ${...} inside a markup template literal (one that contains '<') in a file, with the
 * classification used by tests/unit/help-center-pages.test.js: escaped (esc(...)), a number
 * (num(...), a .length), a constant (a ternary of string literals, an icon map lookup),
 * structure (a nested template or a known renderer that escapes its own parts), or unsafe.
 */

function scanTemplates(source) {
  const found = [];
  let i = 0;
  const stack = []; // template nesting
  function readTemplate(start) {
    // source[start] === '`'
    let k = start + 1;
    let text = '';
    const parts = [];
    while (k < source.length) {
      const c = source[k];
      if (c === '\\') { text += source.slice(k, k + 2); k += 2; continue; }
      if (c === '`') return { end: k, text, parts };
      if (c === '$' && source[k + 1] === '{') {
        const exprStart = k + 2;
        const exprEnd = readExpression(exprStart);
        parts.push({ expr: source.slice(exprStart, exprEnd), index: exprStart });
        text += '${}';
        k = exprEnd + 1;
        continue;
      }
      text += c;
      k += 1;
    }
    return { end: k, text, parts };
  }
  function readExpression(start) {
    let depth = 0;
    let k = start;
    while (k < source.length) {
      const c = source[k];
      if (c === '\'' || c === '"') { k = skipString(k, c); continue; }
      if (c === '`') { const t = readTemplate(k); nested.push({ start: k, t }); k = t.end + 1; continue; }
      if (c === '{') depth += 1;
      if (c === '}') { if (depth === 0) return k; depth -= 1; }
      k += 1;
    }
    return k;
  }
  function skipString(k, q) {
    k += 1;
    while (k < source.length && source[k] !== q) { if (source[k] === '\\') k += 1; k += 1; }
    return k + 1;
  }
  let nested = [];
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 2; continue; }
    if (c === '\'' || c === '"') { i = skipString(i, c); continue; }
    if (c === '`') {
      nested = [];
      const t = readTemplate(i);
      const all = [{ t }, ...nested];
      // nested templates found while reading expressions are templates too
      for (const entry of all) {
        if (!entry.t.text.includes('<')) continue;
        for (const part of entry.t.parts) found.push({ expr: part.expr.trim(), line: source.slice(0, part.index).split('\n').length });
      }
      i = t.end + 1;
      continue;
    }
    i += 1;
  }
  return found;
}

const RENDERERS = /^(renderFAQItem|formatFAQAnswer|markdownToHtml)\(/;

function classify(expr) {
  if (/^(esc|num)\(/.test(expr)) return 'safe';
  if (/^[\w.]+\.length$/.test(expr)) return 'safe';
  // A condition choosing between two string literals (no value from the data reaches markup).
  if (/^[^?`$'"]+\?\s*'[^'`$]*'\s*:\s*'[^'`$]*'$/.test(expr)) return 'safe';
  if (/^iconMap\[[^\]]+\]\s*\|\|\s*iconMap\.[\w]+$/.test(expr)) return 'safe';
  if (/^(href|tag|target)$/.test(expr)) return 'safe'; // built from esc() above in help.js quick links
  if (expr.includes('`')) return 'structure';
  if (RENDERERS.test(expr)) return 'structure';
  if (/\.map\([\s\S]*?(renderFAQItem|formatFAQAnswer)\([\s\S]*\)\.join\(''\)$/.test(expr)) return 'structure';
  return 'unsafe';
}

module.exports = { scanTemplates, classify };
