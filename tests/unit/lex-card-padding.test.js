/**
 * lex-card's inner padding and corners come from Lex tokens, not Tailwind utilities, so a
 * card is padded even when tailwind-output.css (built at app build time) has not loaded.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function render(attrs) {
  const dom = new JSDOM(`<!doctype html><html><head><style>:root{--lex-card-padding:1.5rem;--lex-space-lg:16px;--lex-card-radius:0.75rem}</style></head><body><lex-card heading="Appearance" ${attrs}><p>Body</p></lex-card></body></html>`, {
    url: 'http://localhost/settings-v2.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/foundation/lex-card.js'].forEach((rel) => dom.window.eval(read(rel)));
  return dom;
}

const RULES = {
  normal: /lex-card > \.lex-card-box\[data-pad="normal"\] \{ padding: var\(--lex-card-padding/,
  compact: /lex-card > \.lex-card-box\[data-pad="compact"\] \{ padding: var\(--lex-space-lg/
};

describe('lex-card padding', () => {
  test.each([['', 'normal'], ['padding="compact"', 'compact'], ['padding="none"', 'none']])('%s pads the card box from a token rule (%s), with no Tailwind padding class', (attrs, pad) => {
    const dom = render(attrs);
    const doc = dom.window.document;
    const box = doc.querySelector('lex-card > .lex-card-box');
    expect(box).not.toBeNull();
    expect(box.className).not.toMatch(/\bp-\d/);
    expect(box.getAttribute('data-pad')).toBe(pad);
    const css = doc.getElementById('lex-card-styles').textContent;
    if (RULES[pad]) expect(css).toMatch(RULES[pad]);
    dom.window.close();
  });
});
