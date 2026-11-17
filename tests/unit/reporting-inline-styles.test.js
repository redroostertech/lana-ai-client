'use strict';

/**
 * The Reports page keeps its styles in src/css/admin/reporting.css. The page
 * HTML has no style attributes; the page script only sets CSS custom
 * properties (style="--bar: 42%") that a reporting.css class reads.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const html = fs.readFileSync(path.join(SRC, 'admin', 'reporting.html'), 'utf8');
const js = fs.readFileSync(path.join(SRC, 'js', 'admin', 'reporting.js'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'css', 'admin', 'reporting.css'), 'utf8');

test('reporting.html has no style attributes', () => {
  expect(html.match(/\sstyle\s*=/gi) || []).toEqual([]);
});

test('reporting.js style attributes only set custom properties', () => {
  const styles = js.match(/style\s*=\s*(\\?["'])[^"']*/g) || [];
  expect(styles.length).toBeGreaterThan(0);
  const bad = styles.filter((attr) => !/^style\s*=\s*\\?["']--[a-z-]+\s*:/.test(attr));
  expect(bad).toEqual([]);
});

test('every custom property the script sets is read by reporting.css', () => {
  const props = new Set((js.match(/style\s*=\s*\\?["'](--[a-z-]+)/g) || []).map((attr) => attr.match(/--[a-z-]+/)[0]));
  for (const prop of props) expect(css).toContain('var(' + prop);
});
