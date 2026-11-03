/**
 * Dark chat readability (phase 10c): every light-surface colour utility the
 * answer formatter emits has a dark-theme rule in lex-chat.css, so a new one
 * cannot slip in and leave answer text dark on dark. Colours already meant
 * for a dark surface (the fenced code block's own palette) are listed apart.
 */
const fs = require('fs');
const path = require('path');

const formatter = fs.readFileSync(path.join(__dirname, '../../src/js/lex/chat/lex-chat.format.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../src/css/lex-chat.css'), 'utf8');

// The code block header and body are dark in both themes.
const DARK_SURFACE_ALREADY = new Set(['text-gray-100', 'text-gray-300', 'bg-gray-800']);

function emittedColourClasses() {
  const found = new Set();
  for (const match of formatter.matchAll(/class="([^"]*)"/g)) {
    for (const cls of match[1].split(/\s+/)) {
      if (/^(hover:)?(text|bg|border)-(gray|blue|indigo|slate)-\d+$/.test(cls)) found.add(cls);
    }
  }
  return [...found].filter((cls) => !DARK_SURFACE_ALREADY.has(cls));
}

test('each light colour utility in chat answers has a dark rule', () => {
  const classes = emittedColourClasses();
  expect(classes.length).toBeGreaterThan(5);
  const missing = classes.filter((cls) => {
    const selector = `[data-lex-theme="dark"] .lex-chat-narrative .${cls.replace(':', '\\:')}`;
    return !css.includes(selector);
  });
  expect(missing).toEqual([]);
});
