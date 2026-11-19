'use strict';

/**
 * Which app pages run script that builds inline event handlers in markup
 * strings (onclick="..." inside JS). The CSP cannot allow those by hash, so
 * such a page must be on INLINE_HANDLER_DEBT_PAGES (electron-csp.js).
 *
 * A page "runs" its inline <script> bodies, its <script src> files and,
 * transitively, the ES modules those import.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../../src');
// An on*= attribute in markup a script builds: after a space, quote, backtick or
// '>' (so element.onclick = fn and data-on-click="..." are not matched).
const HANDLER_IN_SCRIPT = /(?<![\w.$-])on[a-z]+=\\?["'`]/i;

function listPages(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listPages(full, out);
    else if (entry.name.endsWith('.html')) out.push(path.relative(SRC, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const scriptCache = new Map();

function scriptHasHandlers(file, seen) {
  if (seen.has(file)) return false;
  seen.add(file);
  if (!file.startsWith(SRC) || /[\\/]vendor[\\/]/.test(file) || !fs.existsSync(file)) return false;
  if (scriptCache.has(file)) return scriptCache.get(file);
  const code = stripComments(fs.readFileSync(file, 'utf8'));
  let found = HANDLER_IN_SCRIPT.test(code);
  if (!found) {
    const imports = code.matchAll(/(?:import\s[^'"`]*?from\s*|import\s*\(\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g);
    for (const m of imports) {
      if (scriptHasHandlers(path.resolve(path.dirname(file), m[1]), seen)) { found = true; break; }
    }
  }
  scriptCache.set(file, found);
  return found;
}

/** The scripts of one page that build inline handlers ('(inline)' for its own script blocks). */
function handlerSourcesOfPage(page) {
  const file = path.join(SRC, page);
  const html = fs.readFileSync(file, 'utf8');
  const sources = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (src) {
      if (/^[a-z]+:/i.test(src[1]) || src[1].startsWith('//')) continue;
      const target = path.resolve(path.dirname(file), src[1].split(/[?#]/)[0]);
      if (scriptHasHandlers(target, new Set())) sources.push(path.relative(SRC, target).split(path.sep).join('/'));
    } else if (!/type\s*=\s*["'](importmap|application\/json|text\/template)/i.test(attrs)) {
      const body = stripComments(m[2]);
      if (HANDLER_IN_SCRIPT.test(body)) sources.push('(inline)');
      for (const im of body.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), im[1]);
        if (scriptHasHandlers(target, new Set())) sources.push(path.relative(SRC, target).split(path.sep).join('/'));
      }
    }
  }
  return Array.from(new Set(sources));
}

function pagesNeedingInlineHandlers() {
  const out = {};
  for (const page of listPages()) {
    const sources = handlerSourcesOfPage(page);
    if (sources.length) out[page] = sources;
  }
  return out;
}

const DOM_ACTIONS = path.join(SRC, 'js', 'shared', 'dom-actions.js');
const usesCache = new Map();

function scriptUsesDomActions(file, seen = new Set()) {
  if (seen.has(file) || file === DOM_ACTIONS || !fs.existsSync(file) || /[\\/]vendor[\\/]/.test(file)) return false;
  seen.add(file);
  if (usesCache.has(file)) return usesCache.get(file);
  const code = fs.readFileSync(file, 'utf8');
  let uses = /LanaDomActions/.test(code);
  if (!uses) {
    for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      if (scriptUsesDomActions(path.resolve(path.dirname(file), m[1]), seen)) { uses = true; break; }
    }
  }
  usesCache.set(file, uses);
  return uses;
}

/**
 * Pages that run script using LanaDomActions without first loading
 * js/shared/dom-actions.js: { page: first script that needs it }.
 */
function pagesMissingDomActions() {
  const out = {};
  for (const page of listPages()) {
    const file = path.join(SRC, page);
    const html = fs.readFileSync(file, 'utf8');
    let loaded = false;
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(m[1]);
      if (src && /^[a-z]+:|^\/\//i.test(src[1])) continue;
      const target = src ? path.resolve(path.dirname(file), src[1].split(/[?#]/)[0]) : null;
      if (target === DOM_ACTIONS) { loaded = true; continue; }
      const uses = target ? scriptUsesDomActions(target) : /LanaDomActions/.test(m[2]);
      if (uses && !loaded) { out[page] = target ? path.relative(SRC, target).split(path.sep).join('/') : '(inline)'; break; }
    }
  }
  return out;
}

module.exports = { SRC, listPages, handlerSourcesOfPage, pagesNeedingInlineHandlers, pagesMissingDomActions };
