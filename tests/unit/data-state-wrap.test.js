'use strict';

/**
 * insufficient_data reasons are now longer, specific sentences. The state
 * block wraps them in full everywhere: no one-line clamp, no ellipsis, long
 * words break instead of overflowing the card.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function rulesFor(css, selector) {
  const out = [];
  let at = css.indexOf(selector);
  while (at !== -1) {
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    const head = css.slice(css.lastIndexOf('}', at) + 1, open);
    if (head.indexOf(selector) !== -1) out.push(css.slice(open + 1, close));
    at = css.indexOf(selector, close);
  }
  return out;
}

test('the shared reason text wraps and breaks long words', () => {
  const rules = rulesFor(read('css/components.css'), '.lex-data-state__reason').join(';');
  expect(rules).toContain('overflow-wrap: anywhere');
  expect(rules).toContain('white-space: normal');
});

test('no stylesheet clamps or truncates the reason', () => {
  ['css/components.css', 'css/admin/insights-dashboard.css', 'css/admin/report.css'].forEach((file) => {
    const rules = rulesFor(read(file), 'lex-data-state__reason').join(';');
    ['line-clamp', 'text-overflow: ellipsis', 'white-space: nowrap', 'max-height'].forEach((bad) => expect(rules).not.toContain(bad));
  });
});
