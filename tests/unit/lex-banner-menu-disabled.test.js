/**
 * A banner menu item that is turned off (for example Export PDF before a
 * report has run) must look turned off. A disabled button receives no click,
 * so if it looks normal it seems broken: Michael pressed both exports on a
 * report that had not run and nothing happened (2026-11-23).
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/js/lex/components/foundation/lex-banner.js'), 'utf8');

test('a disabled item in the banner menu is dimmed, shows it cannot be pressed, and gets no hover', () => {
  const rule = src.match(/\.lex-banner-overflow-menu button:disabled\s*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule[1]).toMatch(/opacity:\s*0?\.\d+/);
  expect(rule[1]).toMatch(/cursor:\s*not-allowed/);
  expect(src).toMatch(/\.lex-banner-overflow-menu button:hover:not\(:disabled\)/);
});
