/**
 * Lex.Markdown — the ONE markdown evaluator for the app.
 *
 * Wraps the vendored `marked` parser (js/vendor/marked.min.js), which several
 * surfaces already use directly (reporting, drilldown, workspace-details, …).
 * New code — and, over time, the hand-rolled markdownToHtml copies in article.js
 * and help.js — should call this instead of re-implementing markdown.
 *
 * Safe by default: if `marked` isn't loaded on the page, it falls back to escaped
 * text with <br> line breaks, so a caller never accidentally injects raw markup.
 *
 * Usage:
 *   el.innerHTML = Lex.Markdown.toHtml(mdString);     // block content
 *   el.innerHTML = Lex.Markdown.toInline(mdString);   // single-line, no <p> wrap
 */
(function () {
  'use strict';

  window.Lex = window.Lex || {};
  if (window.Lex.Markdown) return; // idempotent

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function hasMarked(method) {
    return typeof marked !== 'undefined' && marked && typeof marked[method] === 'function';
  }

  function toHtml(markdown) {
    var src = (markdown == null) ? '' : String(markdown);
    if (!src.trim()) return '';
    if (hasMarked('parse')) {
      try { return marked.parse(src); } catch (_e) { /* fall through */ }
    }
    return escapeHtml(src).replace(/\n/g, '<br>');
  }

  function toInline(markdown) {
    var src = (markdown == null) ? '' : String(markdown);
    if (!src.trim()) return '';
    if (hasMarked('parseInline')) {
      try { return marked.parseInline(src); } catch (_e) { /* fall through */ }
    }
    return escapeHtml(src);
  }

  window.Lex.Markdown = { toHtml: toHtml, toInline: toInline };
})();
