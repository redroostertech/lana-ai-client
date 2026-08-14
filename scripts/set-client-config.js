#!/usr/bin/env node
/**
 * Client Config Rewriter
 *
 * Safely sets top-level keys on the `window.LanaConfig` object literal in
 * public_html/js/config.js during a build.
 *
 * Why this exists: build-client.sh used to rewrite these keys with
 *   sed "s|API_BASE_URL:.*|API_BASE_URL: '',|"
 * which is line-oriented. Once API_BASE_URL grew a multi-line IIFE value, that
 * sed replaced only the `(function () {` opener and left the body orphaned,
 * producing a config.js that does not parse — so the packaged app booted with
 * `window.LanaConfig` undefined. This rewriter replaces a key's ENTIRE value,
 * however many lines it spans.
 *
 * Usage:
 *   node scripts/set-client-config.js <config.js> KEY=<js-literal> [KEY=<js-literal> ...]
 *
 * The value is raw JavaScript, not a string to be quoted, so quote it yourself:
 *   node scripts/set-client-config.js public_html/js/config.js \
 *     "API_BASE_URL=''" "DEMO_MODE=false" "DEBUG_MODE=false"
 *   node scripts/set-client-config.js public_html/js/config.js \
 *     "API_BASE_URL='http://192.168.1.10:8080'"
 */

const fs = require('fs');

/**
 * Find the index just past the end of a string, template, or comment that
 * starts at `i`. Returns -1 when `i` is not the start of one.
 */
function skipOpaque(src, i) {
  const ch = src[i];
  const next = src[i + 1];

  // Line comment
  if (ch === '/' && next === '/') {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? src.length : nl;
  }

  // Block comment
  if (ch === '/' && next === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }

  // String / template literal
  if (ch === "'" || ch === '"' || ch === '`') {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === ch) return j + 1;
      j++;
    }
    return src.length;
  }

  return -1;
}

/**
 * Replace the value of a top-level key in the config object literal.
 *
 * The key must sit at exactly two spaces of indentation, which is what makes
 * this safe: the `API_BASE_URL:` occurrences inside the leading block comment
 * are indented with ` *    ` and are therefore never matched.
 */
function setKey(src, key, value) {
  const keyRe = new RegExp(`^  ${key}\\s*:`, 'm');
  const match = keyRe.exec(src);
  if (!match) {
    throw new Error(`key "${key}" not found at top level of the config object`);
  }

  const valueStart = match.index + match[0].length;

  // Walk the value, tracking bracket depth, until the comma (or closing brace)
  // that terminates this property at depth 0.
  let depth = 0;
  let i = valueStart;
  let valueEnd = -1;
  let sawComma = false;

  while (i < src.length) {
    const skipped = skipOpaque(src, i);
    if (skipped !== -1) { i = skipped; continue; }

    const ch = src[i];
    if (ch === '(' || ch === '[' || ch === '{') { depth++; }
    else if (ch === ')' || ch === ']') { depth--; }
    else if (ch === '}') {
      if (depth === 0) { valueEnd = i; break; }  // last property, no trailing comma
      depth--;
    }
    else if (ch === ',' && depth === 0) { valueEnd = i; sawComma = true; break; }

    i++;
  }

  if (valueEnd === -1) {
    throw new Error(`could not find the end of the value for "${key}"`);
  }

  return src.slice(0, valueStart) + ` ${value}` + (sawComma ? ',' : '') + src.slice(valueEnd + (sawComma ? 1 : 0));
}

function main() {
  const [, , file, ...assignments] = process.argv;

  if (!file || assignments.length === 0) {
    console.error('Usage: set-client-config.js <config.js> KEY=<js-literal> [KEY=<js-literal> ...]');
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Config file not found: ${file}`);
    process.exit(1);
  }

  let src = fs.readFileSync(file, 'utf8');

  for (const assignment of assignments) {
    const eq = assignment.indexOf('=');
    if (eq === -1) {
      console.error(`Invalid assignment "${assignment}" — expected KEY=<js-literal>`);
      process.exit(1);
    }
    const key = assignment.slice(0, eq).trim();
    const value = assignment.slice(eq + 1);

    try {
      src = setKey(src, key, value);
      console.log(`  set ${key} = ${value}`);
    } catch (err) {
      console.error(`Failed to set ${key}: ${err.message}`);
      process.exit(1);
    }
  }

  fs.writeFileSync(file, src);
}

main();
