/**
 * lex-drawer scroll cue: while the body has content below what shows, the
 * panel carries lex-drawer-panel--more-below and the footer casts a shadow up
 * over the body, so a control cut at the footer reads as "scroll for more",
 * not as hidden behind it (calendar new-event drawer, 2026-11-18).
 */
const fs = require('fs');
const path = require('path');

const drawerPath = path.join(__dirname, '../../src/js/lex/components/foundation/lex-drawer.js');
const source = fs.readFileSync(drawerPath, 'utf8');
const { hasMoreBelow } = require(drawerPath);

test.each([
  ['content below', { scrollTop: 0, clientHeight: 672, scrollHeight: 875 }, true],
  ['scrolled to the end', { scrollTop: 203, clientHeight: 672, scrollHeight: 875 }, false],
  ['within a pixel of the end (fractional scroll)', { scrollTop: 202.4, clientHeight: 672, scrollHeight: 875 }, false],
  ['everything fits', { scrollTop: 0, clientHeight: 672, scrollHeight: 672 }, false],
  ['not laid out', { scrollTop: 0, clientHeight: 0, scrollHeight: 0 }, false]
])('hasMoreBelow: %s', (_label, metrics, expected) => {
  expect(hasMoreBelow(metrics)).toBe(expected);
});

test('the footer shadow uses the shared overlay token and only while more is below', () => {
  const at = source.indexOf('.lex-drawer-panel--more-below > .lex-drawer-footer {');
  expect(at).toBeGreaterThan(-1);
  expect(source.slice(at, source.indexOf('}', at))).toMatch(/box-shadow:[^;]*var\(--lex-modal-overlay\)/);
});
