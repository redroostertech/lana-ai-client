'use strict';

/**
 * Finds executeJavaScript and insertCSS calls whose script is not fixed text: a
 * variable, a template with ${...}, or a literal joined with anything. However the
 * call is written: `.executeJavaScript(`, `.executeJavaScript (`, `['executeJavaScript'](`.
 */

const fs = require('fs');
const path = require('path');

const SINK = /(?:\.\s*(executeJavaScript|insertCSS)|\[\s*(['"`])(executeJavaScript|insertCSS)\2\s*\])\s*\(/g;

/** The text of the first argument of the call whose '(' is at `open`, or null when unbalanced. */
function firstArgument(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    } else if (ch === ',' && depth === 1) {
      return source.slice(open + 1, i);
    }
  }
  return null;
}

/** True for one string literal and nothing else (a template only without ${). */
function isFixedText(argument) {
  const text = argument.trim();
  const match = /^(['"`])([\s\S]*)\1$/.exec(text);
  if (!match) return false;
  const [, quote, body] = match;
  // The same quote unescaped inside means two literals joined (for example 'a' + 'b').
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\') { i += 1; continue; }
    if (body[i] === quote) return false;
  }
  return !(quote === '`' && body.includes('${'));
}

/** Problems in one source file, as short descriptions. */
function scriptSinkProblems(source) {
  const problems = [];
  for (const match of source.matchAll(SINK)) {
    const name = match[1] || match[3];
    const open = match.index + match[0].length - 1;
    const argument = firstArgument(source, open);
    if (argument === null || !isFixedText(argument)) {
      const line = source.slice(0, match.index).split('\n').length;
      problems.push(`line ${line}: ${name} with ${argument === null ? 'unparsable arguments' : `"${argument.trim().slice(0, 60)}"`}`);
    }
  }
  return problems;
}

function listFiles(dir, pattern, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'test', 'tests'].includes(entry.name)) listFiles(full, pattern, out);
    } else if (pattern.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every main-process source file (relative to root, '/' separators). */
function mainProcessFiles(root) {
  const rel = (file) => path.relative(root, file).split(path.sep).join('/');
  const rootModules = fs.readdirSync(root).filter((name) => /^electron-.*\.js$/.test(name));
  const srcModules = fs.readdirSync(path.join(root, 'src')).filter((name) => /^electron-.*\.js$/.test(name)).map((name) => `src/${name}`);
  return [
    ...rootModules,
    ...srcModules,
    ...listFiles(path.join(root, 'src', 'screen-voice'), /\.js$/).filter((file) => !file.includes(`${path.sep}overlay${path.sep}`)).map(rel),
    ...listFiles(path.join(root, 'js', 'session'), /\.js$/).map(rel),
    ...listFiles(path.join(root, 'briefs', 'packages', 'host', 'src', 'main'), /\.ts$/).map(rel)
  ];
}

module.exports = { scriptSinkProblems, mainProcessFiles, isFixedText };
