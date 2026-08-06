'use strict';

/**
 * Lex.Utils.renderMarkdownSafe — the shared hardened markdown parser for
 * LLM-generated / untrusted content (artifact drafts, drilldown sections).
 *
 * Contract: markdown structure renders (headings, bold, blockquotes, lists);
 * raw HTML renders as escaped text; links are restricted to http(s)/mailto
 * and open with noopener; images render as their alt text; returns null when
 * marked is unavailable so callers fall back to plain escaping.
 *
 * The dangerous-input tests assert a CONTRAST against raw marked output, so
 * removing the renderer overrides turns them red by construction.
 */

const path = require('path');
const fs = require('fs');

const rawMarked = require(path.resolve(__dirname, '../../src/js/vendor/marked.min.js'));

function loadLexUtils(withMarked) {
  const timeSrc = fs.readFileSync(path.resolve(__dirname, '../../src/js/time-utils.js'), 'utf8');
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/js/lex/lex.utils.js'), 'utf8');
  const fakeWindow = {
    localStorage: { getItem: () => null },
    Intl,
    Date
  };
  if (withMarked) fakeWindow.marked = rawMarked;
  const fakeDocument = {
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    }
  };
  new Function('window', timeSrc)(fakeWindow);
  new Function('window', 'document', src)(fakeWindow, fakeDocument);
  return fakeWindow.Lex.Utils;
}

const Utils = loadLexUtils(true);

describe('Lex.Utils.renderMarkdownSafe', () => {
  test('renders markdown structure', () => {
    const out = Utils.renderMarkdownSafe(
      '> **Notice:** check this.\n\n# Title\n\nBody with **bold**.\n\n- item one\n- item two'
    );
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<h1>');
    expect(out).toContain('<strong>');
    expect(out).toContain('<li>');
  });

  test('raw HTML renders as escaped text (contrast with raw marked)', () => {
    const input = 'before\n\n<script>alert(1)</script>\n\nafter';
    const raw = rawMarked.parse(input);
    expect(raw).toContain('<script>'); // raw marked passes it through
    const out = Utils.renderMarkdownSafe(input);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('inline raw HTML is escaped too', () => {
    const out = Utils.renderMarkdownSafe('a <b onmouseover="x()">b</b> c', { inline: true });
    expect(out).not.toContain('<b onmouseover');
    expect(out).toContain('&lt;b onmouseover');
  });

  test('http(s)/mailto links render with noopener; javascript: links become text (contrast)', () => {
    const input = '[ok](https://example.com) and [evil](javascript:alert(1))';
    const raw = rawMarked.parse(input);
    expect(raw).toContain('javascript:'); // raw marked keeps the href
    const out = Utils.renderMarkdownSafe(input);
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('evil'); // label survives as text
  });

  test('images render as alt text, never img tags', () => {
    const out = Utils.renderMarkdownSafe('![tracking pixel](https://t.example/p.png)');
    expect(out).not.toContain('<img');
    expect(out).toContain('tracking pixel');
  });

  test('empty input returns empty string', () => {
    expect(Utils.renderMarkdownSafe('')).toBe('');
    expect(Utils.renderMarkdownSafe(null)).toBe('');
    expect(Utils.renderMarkdownSafe(undefined)).toBe('');
  });

  test('returns null when marked is not loaded (caller falls back to escaping)', () => {
    const UtilsNoMarked = loadLexUtils(false);
    expect(UtilsNoMarked.renderMarkdownSafe('# hi')).toBeNull();
  });
});
