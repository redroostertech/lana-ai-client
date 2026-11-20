'use strict';

/**
 * The Reports pages keep their styles in their own stylesheets
 * (src/css/admin/report.css, reports-list.css). Neither page's HTML has style
 * attributes; the report page script only sets CSS custom properties
 * (style="--bar: 42%") that a report.css class reads.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const html = fs.readFileSync(path.join(SRC, 'admin', 'report.html'), 'utf8');
const js = fs.readFileSync(path.join(SRC, 'js', 'admin', 'report.js'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'css', 'admin', 'report.css'), 'utf8');

test('report.html and reports-list.html have no style attributes', () => {
  const list = fs.readFileSync(path.join(SRC, 'admin', 'reports-list.html'), 'utf8');
  expect(html.match(/\sstyle\s*=/gi) || []).toEqual([]);
  expect(list.match(/\sstyle\s*=/gi) || []).toEqual([]);
});

test('report.js style attributes only set custom properties', () => {
  const styles = js.match(/style\s*=\s*(\\?["'])[^"']*/g) || [];
  expect(styles.length).toBeGreaterThan(0);
  const bad = styles.filter((attr) => !/^style\s*=\s*\\?["']--[a-z-]+\s*:/.test(attr));
  expect(bad).toEqual([]);
});

test('every custom property the script sets is read by report.css', () => {
  const props = new Set((js.match(/style\s*=\s*\\?["'](--[a-z-]+)/g) || []).map((attr) => attr.match(/--[a-z-]+/)[0]));
  for (const prop of props) expect(css).toContain('var(' + prop);
});
