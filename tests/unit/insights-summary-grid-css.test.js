'use strict';

/**
 * The Metric Detail five-stat grid shows five columns on wide screens and
 * collapses with every other summary grid on narrow ones. The modifier is a
 * lone class declared before the narrow-width rules, so those rules win.
 */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../src/css/admin/insights-dashboard.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function mediaBlock(query) {
  const start = css.indexOf('@media (' + query + ')');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && (depth -= 1) === 0) return { start, body: css.slice(start, i + 1) };
  }
  throw new Error('unclosed ' + query);
}

test('five columns is a lone-class rule that comes before the narrow-width summary grid rules', () => {
  const five = css.search(/(^|\n)\.dash-summary-grid--five\s*\{[^}]*repeat\(5,/);
  expect(five).toBeGreaterThan(-1);
  ['max-width: 1024px', 'max-width: 640px'].forEach((query) => {
    const block = mediaBlock(query);
    expect(block.body).toMatch(/\.dash-summary-grid\s*[,{]/);
    expect(block.body).not.toContain('dash-summary-grid--five');
    expect(block.start).toBeGreaterThan(five);
  });
});
