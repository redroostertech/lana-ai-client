'use strict';

/**
 * <lex-breadcrumb> reads its trail from `items` (a JSON list of
 * {label, href?}). A page that names it anything else (crumbs=) renders no
 * breadcrumb at all. Every breadcrumb in the app either declares a non-empty
 * items list or has an id its page script fills, and every link in it names
 * a page that exists (root-relative, as Lex.Nav.go reads it).
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const ALLOWED = new Set(['id', 'class', 'items', 'style']);

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const pages = walk(SRC, '.html');
const scripts = walk(path.join(SRC, 'js'), '.js').map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const breadcrumbs = pages.flatMap((file) => {
  const html = fs.readFileSync(file, 'utf8');
  return [...html.matchAll(/<lex-breadcrumb\b([^>]*)>/g)].map((m) => {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)(?:\s*=\s*(?:'([^']*)'|"([^"]*)"))?/g)) attrs[a[1]] = a[2] !== undefined ? a[2] : a[3];
    return { page: path.relative(SRC, file), attrs };
  });
});

test('pages use breadcrumbs', () => {
  expect(breadcrumbs.length).toBeGreaterThan(20);
});

test('every breadcrumb uses only attributes the component reads', () => {
  const bad = breadcrumbs.flatMap(({ page, attrs }) =>
    Object.keys(attrs).filter((name) => !ALLOWED.has(name) && !name.startsWith('aria-')).map((name) => page + ': ' + name));
  expect(bad).toEqual([]);
});

test('every breadcrumb has a trail: a non-empty items list, or an id its script fills', () => {
  const empty = breadcrumbs.filter(({ attrs }) => {
    if (attrs.items !== undefined) {
      const items = JSON.parse(decode(attrs.items));
      return !Array.isArray(items) || items.length === 0 || items.some((item) => !item || !item.label);
    }
    return !(attrs.id && scripts.includes(attrs.id) && /\.items\s*=/.test(scripts));
  }).map(({ page }) => page);
  expect(empty).toEqual([]);
});

test('every breadcrumb link opens a page that exists', () => {
  const missing = breadcrumbs.flatMap(({ page, attrs }) => (attrs.items ? JSON.parse(decode(attrs.items)) : [])
    .filter((item) => item.href && !fs.existsSync(path.join(SRC, item.href.split('?')[0])))
    .map((item) => page + ': ' + item.href));
  expect(missing).toEqual([]);
});
