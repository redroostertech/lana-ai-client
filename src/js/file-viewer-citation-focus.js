/**
 * file-viewer-citation-focus.js - opening the file viewer from a chat source.
 *
 * A chat citation opens file-viewer.html?id=<doc>&page=<n>&quote=<text>
 * (&chunk=<i> when the server sends a chunk index). This module holds the
 * pure parts of that hand-off so they can be tested without the page:
 *
 *   fromParams(params)          the focus request carried in the URL
 *   findQuote(text, quote)      locate a quoted passage, tolerant of case,
 *                               whitespace, punctuation and markdown marks
 *   pdfQuoteRects(items, ...)   page-point rectangles for a passage on one
 *                               PDF page, from pdf.js text items
 *   pageProbeOrder(page, n)     which PDF pages to search, cited page first
 *   highlightInElement(el, q)   read-only <mark> highlight in plain HTML/text
 *   clearHighlights(el)         undo highlightInElement
 *
 * The highlight is presentation only. It is never saved as an annotation.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileViewerCitationFocus = api;
  if (typeof window !== 'undefined' && root === window) api.bootEmbeddedChrome(window);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var QUOTE_MAX = 1000;
  var MARK_CLASS = 'file-viewer-citation-mark';
  var WORD_CHAR = /[\p{L}\p{N}]/u;

  function positiveInt(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = parseInt(String(value), 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  function nonNegativeInt(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = parseInt(String(value), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  /**
   * @param {{ get(name: string): string|null }} params URLSearchParams-like
   * @returns {{ page: number|null, quote: string, chunkIndex: number|null }|null}
   */
  function fromParams(params) {
    if (!params || typeof params.get !== 'function') return null;
    var page = positiveInt(params.get('page'));
    var quote = String(params.get('quote') || '').replace(/\s+/g, ' ').trim();
    if (quote.length > QUOTE_MAX) quote = quote.slice(0, QUOTE_MAX);
    var chunkIndex = nonNegativeInt(params.get('chunk'));
    if (!page && !quote && chunkIndex === null) return null;
    return { page: page, quote: quote, chunkIndex: chunkIndex };
  }

  /**
   * Lower-cased words (letters and digits) joined by single spaces, with the
   * index in the original string of every kept character.
   */
  function normalize(text) {
    var source = String(text || '');
    var out = '';
    var map = [];
    var pendingSpace = false;
    for (var i = 0; i < source.length; i++) {
      var ch = source[i];
      if (WORD_CHAR.test(ch)) {
        if (pendingSpace && out.length > 0) {
          out += ' ';
          map.push(i);
        }
        pendingSpace = false;
        out += ch.toLowerCase();
        map.push(i);
      } else {
        pendingSpace = true;
      }
    }
    return { text: out, map: map };
  }

  function quoteProbes(normalizedQuote) {
    var probes = [normalizedQuote];
    var words = normalizedQuote.split(' ');
    [12, 8].forEach(function (count) {
      if (words.length > count) probes.push(words.slice(0, count).join(' '));
    });
    return probes;
  }

  /**
   * Find `quote` in `text`. Exact words first; then the quote's opening
   * words (a retrieved chunk is often cut mid-sentence by the server).
   * @returns {{ start: number, end: number, partial: boolean }|null}
   *   offsets into the original `text`
   */
  function findQuote(text, quote) {
    var needle = normalize(quote).text;
    if (needle.length < 3) return null;
    var hay = normalize(text);
    var probes = quoteProbes(needle);
    for (var p = 0; p < probes.length; p++) {
      var probe = probes[p];
      var at = hay.text.indexOf(probe);
      if (at < 0) continue;
      return {
        start: hay.map[at],
        end: hay.map[at + probe.length - 1] + 1,
        partial: p > 0
      };
    }
    return null;
  }

  /**
   * Rectangles (page points, top-left origin) covering `quote` on one PDF
   * page. `items` are pdf.js text content items ({ str, transform, width,
   * height }); `toViewportPoint(x, y)` is a scale-1 viewport's
   * convertToViewportPoint, which handles the page's view box and rotation.
   * @returns {{ rects: Array<{x:number,y:number,w:number,h:number}>, partial: boolean }|null}
   */
  function pdfQuoteRects(items, quote, toViewportPoint) {
    if (!Array.isArray(items) || typeof toViewportPoint !== 'function') return null;
    var text = '';
    var spans = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var str = item && typeof item.str === 'string' ? item.str : '';
      if (!str) continue;
      if (text) text += ' ';
      spans.push({ item: item, start: text.length, end: text.length + str.length });
      text += str;
    }
    var match = findQuote(text, quote);
    if (!match) return null;

    var rects = [];
    for (var s = 0; s < spans.length; s++) {
      var span = spans[s];
      var from = Math.max(span.start, match.start);
      var to = Math.min(span.end, match.end);
      if (to <= from) continue;
      var t = span.item.transform || [1, 0, 0, 1, 0, 0];
      var length = span.end - span.start;
      var width = Number(span.item.width) || 0;
      var height = Number(span.item.height) || Math.hypot(t[2] || 0, t[3] || 0) || 0;
      if (width <= 0 || height <= 0) continue;
      var x0 = t[4] + width * ((from - span.start) / length);
      var x1 = t[4] + width * ((to - span.start) / length);
      var baseline = t[5] - height * 0.2;
      var top = t[5] + height;
      var a = toViewportPoint(x0, baseline);
      var b = toViewportPoint(x1, top);
      var rect = {
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        w: Math.abs(b[0] - a[0]),
        h: Math.abs(b[1] - a[1])
      };
      if (rect.w > 0 && rect.h > 0) rects.push(rect);
    }
    return rects.length > 0 ? { rects: rects, partial: match.partial } : null;
  }

  /** Cited page, then its neighbours; without a page, the first 50 pages. */
  function pageProbeOrder(page, numPages) {
    var total = Math.max(0, parseInt(numPages, 10) || 0);
    var order = [];
    if (page && page >= 1) {
      [page, page - 1, page + 1].forEach(function (n) {
        if (n >= 1 && n <= total && order.indexOf(n) === -1) order.push(n);
      });
      return order;
    }
    for (var n = 1; n <= Math.min(total, 50); n++) order.push(n);
    return order;
  }

  function clearHighlights(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    var marks = rootEl.querySelectorAll('mark.' + MARK_CLASS);
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      if (typeof parent.normalize === 'function') parent.normalize();
    }
  }

  /**
   * Wrap the quoted passage in read-only <mark> elements inside a plain
   * HTML or text preview (mammoth DOCX, text <pre>).
   * @returns {HTMLElement|null} the first mark, or null when not found
   */
  function highlightInElement(rootEl, quote) {
    if (!rootEl || !rootEl.ownerDocument) return null;
    clearHighlights(rootEl);
    var doc = rootEl.ownerDocument;
    var walker = doc.createTreeWalker(rootEl, 4 /* NodeFilter.SHOW_TEXT */, null);
    var nodes = [];
    var text = '';
    var node = walker.nextNode();
    while (node) {
      var value = node.nodeValue || '';
      if (value) {
        nodes.push({ node: node, start: text.length, end: text.length + value.length });
        text += value;
      }
      node = walker.nextNode();
    }
    var match = findQuote(text, quote);
    if (!match) return null;

    var first = null;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var entry = nodes[i];
      var from = Math.max(entry.start, match.start);
      var to = Math.min(entry.end, match.end);
      if (to <= from) continue;
      var target = entry.node;
      if (to - entry.start < target.nodeValue.length) target.splitText(to - entry.start);
      if (from - entry.start > 0) target = target.splitText(from - entry.start);
      var mark = doc.createElement('mark');
      mark.className = MARK_CLASS;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      first = mark;
    }
    return first;
  }

  // -------------------------------------------------------------------------
  // Embedded chrome: the viewer hosted in a chat source modal's iframe
  // (file-viewer.html?...&chrome=embedded). The host page keeps its own
  // shell and dock, so this page hides its header, sidebar, banner and
  // breadcrumb, never mounts a LANA dock, and asks the host to close on
  // Escape (key events inside an iframe never reach the host's modal).
  // -------------------------------------------------------------------------

  function isEmbeddedChrome(params, win) {
    return Boolean(params && typeof params.get === 'function' && params.get('chrome') === 'embedded' &&
      win && win.parent && win.parent !== win);
  }

  function enterEmbeddedChrome(doc, win) {
    if (!doc || !doc.documentElement) return false;
    doc.documentElement.setAttribute('data-lex-chrome', 'embedded');
    var app = doc.querySelector('lex-app');
    if (app) app.setAttribute('chrome', 'embedded');
    doc.addEventListener('keydown', function (event) {
      if (!event || event.key !== 'Escape' || event.defaultPrevented) return;
      // An overlay inside the viewer closes first.
      if (doc.querySelector('lex-modal[open], lex-drawer[open]')) return;
      try { win.parent.postMessage({ type: 'lex-embedded-close' }, '*'); } catch (_) { /* host gone */ }
    });
    return true;
  }

  /** Run once at script load, before the shell and dock scripts mount. */
  function bootEmbeddedChrome(win) {
    if (!win || !win.document || !win.location) return false;
    var params = new URLSearchParams(win.location.search || '');
    if (!isEmbeddedChrome(params, win)) return false;
    return enterEmbeddedChrome(win.document, win);
  }

  return {
    isEmbeddedChrome: isEmbeddedChrome,
    enterEmbeddedChrome: enterEmbeddedChrome,
    bootEmbeddedChrome: bootEmbeddedChrome,
    MARK_CLASS: MARK_CLASS,
    fromParams: fromParams,
    findQuote: findQuote,
    pdfQuoteRects: pdfQuoteRects,
    pageProbeOrder: pageProbeOrder,
    highlightInElement: highlightInElement,
    clearHighlights: clearHighlights
  };
});
