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
const { JSDOM } = require('jsdom');

const SRC = path.resolve(__dirname, '../../src');
const rawMarked = require(path.join(SRC, 'js/vendor/marked.min.js'));

// The one markdown sanitizer now lives in js/shared/safe-html.js
// (LanaSafeHtml.renderMarkdown); Lex.Utils.renderMarkdownSafe was merged
// into it and every caller points there.
function loadSafeHtml(withMarked) {
  const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  window.eval(fs.readFileSync(path.join(SRC, 'js/shared/safe-url.js'), 'utf8'));
  if (withMarked) window.eval(fs.readFileSync(path.join(SRC, 'js/vendor/marked.min.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(SRC, 'js/shared/safe-html.js'), 'utf8'));
  return window.LanaSafeHtml;
}

const SafeHtml = loadSafeHtml(true);
const Utils = { renderMarkdownSafe: (text, options) => SafeHtml.renderMarkdown(text, options) };

describe('LanaSafeHtml.renderMarkdown (merged from Lex.Utils.renderMarkdownSafe)', () => {
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
    expect(out).toContain('href="https://example.com/"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener"');
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

  test('without marked it returns escaped text, never raw HTML', () => {
    const noMarked = loadSafeHtml(false);
    expect(noMarked.renderMarkdown('# hi <b>x</b>')).toBe('# hi &lt;b&gt;x&lt;/b&gt;');
  });

  test('angle-bracket placeholders such as <Client Name> stay visible', () => {
    const out = Utils.renderMarkdownSafe('Dear <Client Name>, please sign <Date>.');
    expect(out).toContain('&lt;Client Name&gt;');
    expect(out).toContain('&lt;Date&gt;');
  });

  test('images become alt text in block and inline rendering, never a remote fetch', () => {
    ['![Logo](https://t.example/p.png)', 'see ![Logo](https://t.example/p.png "t")'].forEach((md) => {
      [false, true].forEach((inline) => {
        const out = Utils.renderMarkdownSafe(md, { inline });
        expect(out).not.toContain('<img');
        expect(out).not.toContain('t.example');
        expect(out).toContain('Logo');
      });
    });
  });

  test('a raw <img> tag is escaped text, not an image', () => {
    const out = Utils.renderMarkdownSafe('x <img src="https://t.example/p.png"> y');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  test('Lex.Utils no longer carries a second markdown sanitizer', () => {
    const utils = fs.readFileSync(path.join(SRC, 'js/lex/lex.utils.js'), 'utf8');
    expect(utils).not.toMatch(/renderMarkdownSafe|new markedLib\.Marked/);
  });
});
