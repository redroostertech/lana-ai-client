'use strict';

// The file viewer opened from a chat source: read page/quote/chunk from the
// URL, find the quoted passage (loosely: case, whitespace, punctuation and
// markdown marks differ between parsed chunks and the rendered document),
// and highlight it read-only.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Focus = require('../../src/js/file-viewer-citation-focus.js');

const SRC = path.resolve(__dirname, '../../src');

describe('fromParams', () => {
  test('reads page, quote and chunk index', () => {
    const params = new URLSearchParams({ id: 'doc-1', page: '12', quote: '  The  sum of $250,000 ', chunk: '0' });
    expect(Focus.fromParams(params)).toEqual({ page: 12, quote: 'The sum of $250,000', chunkIndex: 0 });
  });

  test('ignores invalid values and returns null when nothing is cited', () => {
    expect(Focus.fromParams(new URLSearchParams({ id: 'doc-1' }))).toBeNull();
    expect(Focus.fromParams(new URLSearchParams({ page: '0', chunk: '-1', quote: ' ' }))).toBeNull();
    expect(Focus.fromParams(new URLSearchParams({ page: 'abc', quote: 'x y z' }))).toEqual({ page: null, quote: 'x y z', chunkIndex: null });
    expect(Focus.fromParams(new URLSearchParams({ quote: 'a'.repeat(5000) })).quote).toHaveLength(1000);
  });
});

describe('findQuote', () => {
  const page = 'Section 4.\nPayment.  The Settling   Defendant shall PAY the sum of $250,000 within thirty (30) days.';

  test('matches across case, whitespace and punctuation differences', () => {
    const match = Focus.findQuote(page, 'the settling defendant shall pay the sum of 250,000');
    expect(match.partial).toBe(false);
    expect(page.slice(match.start, match.end)).toBe('The Settling   Defendant shall PAY the sum of $250,000');
  });

  test('matches a markdown-formatted chunk against the rendered text', () => {
    const match = Focus.findQuote(page, '**Payment.** The Settling Defendant');
    expect(page.slice(match.start, match.end)).toBe('Payment.  The Settling   Defendant');
  });

  test('falls back to the opening words of a quote cut off by the server', () => {
    const quote = 'The Settling Defendant shall pay the sum of $250,000 within thirty (30) days of the Effective Da';
    const match = Focus.findQuote(page, quote);
    expect(match.partial).toBe(true);
    expect(page.slice(match.start)).toMatch(/^The Settling/);
  });

  test('returns null when the passage is not there', () => {
    expect(Focus.findQuote(page, 'an entirely different clause about indemnity')).toBeNull();
    expect(Focus.findQuote(page, '')).toBeNull();
  });
});

describe('pdfQuoteRects', () => {
  // A 600x800 point page; scale-1 viewport flips y (PDF origin is bottom-left).
  const toViewportPoint = (x, y) => [x, 800 - y];
  const item = (str, x, y, width, height = 10) => ({ str, transform: [height, 0, 0, height, x, y], width, height });

  test('returns page-point rectangles for the items the quote covers', () => {
    const items = [
      item('Recitals', 50, 700, 80),
      item('The Settling Defendant shall', 50, 500, 280),
      item('pay the sum of $250,000.', 50, 485, 240)
    ];
    const found = Focus.pdfQuoteRects(items, 'Defendant shall pay the sum', toViewportPoint);
    expect(found.partial).toBe(false);
    expect(found.rects).toHaveLength(2);
    const [first, second] = found.rects;
    // "Defendant shall" starts at character 13 of 28 in the first line.
    expect(first.x).toBeCloseTo(50 + 280 * (13 / 28));
    expect(first.x + first.w).toBeCloseTo(330);
    expect(first.y).toBeCloseTo(800 - 510);
    expect(first.h).toBeCloseTo(12);
    expect(second.x).toBeCloseTo(50);
    expect(second.y).toBeCloseTo(800 - 495);
  });

  test('returns null when the quote is not on the page', () => {
    expect(Focus.pdfQuoteRects([item('Recitals', 50, 700, 80)], 'indemnity clause', toViewportPoint)).toBeNull();
  });
});

test('pageProbeOrder searches the cited page first, then its neighbours', () => {
  expect(Focus.pageProbeOrder(5, 10)).toEqual([5, 4, 6]);
  expect(Focus.pageProbeOrder(1, 1)).toEqual([1]);
  expect(Focus.pageProbeOrder(null, 3)).toEqual([1, 2, 3]);
});

describe('highlightInElement', () => {
  test('wraps the passage across element boundaries in read-only marks', () => {
    const dom = new JSDOM('<div id="root"><h1>1. Recitals</h1><p>The Settling <strong>Defendant</strong> shall pay the sum.</p></div>');
    const root = dom.window.document.getElementById('root');
    const first = Focus.highlightInElement(root, 'Settling Defendant shall pay');
    const marks = root.querySelectorAll('mark.' + Focus.MARK_CLASS);
    expect(first).toBe(marks[0]);
    expect([...marks].map((m) => m.textContent).join('')).toBe('Settling Defendant shall pay');
    expect(root.textContent).toBe('1. RecitalsThe Settling Defendant shall pay the sum.');

    Focus.clearHighlights(root);
    expect(root.querySelector('mark')).toBeNull();
    expect(root.textContent).toBe('1. RecitalsThe Settling Defendant shall pay the sum.');
  });

  test('returns null and changes nothing when the passage is missing', () => {
    const dom = new JSDOM('<pre id="root">plain text body</pre>');
    const root = dom.window.document.getElementById('root');
    expect(Focus.highlightInElement(root, 'not present anywhere')).toBeNull();
    expect(root.innerHTML).toBe('plain text body');
  });
});

describe('file viewer page wiring', () => {
  const pageJs = fs.readFileSync(path.join(SRC, 'js/file-viewer-page.js'), 'utf8');
  const html = fs.readFileSync(path.join(SRC, 'file-viewer.html'), 'utf8');

  test('the page loads the focus module before its controller', () => {
    const helper = html.indexOf('<script src="js/file-viewer-citation-focus.js"></script>');
    const controller = html.indexOf('<script src="js/file-viewer-page.js"></script>');
    expect(helper).toBeGreaterThan(-1);
    expect(controller).toBeGreaterThan(helper);
  });

  test('reads the citation focus from the URL and applies it after the content loads', () => {
    expect(pageJs).toContain('window.FileViewerCitationFocus.fromParams(params)');
    const load = pageJs.indexOf('await loadFileContent(response);');
    const apply = pageJs.indexOf('applyCitationFocus()', load);
    expect(load).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(load);
  });

  test('the cited-passage highlight joins the overlay without being saved', () => {
    const sync = pageJs.slice(pageJs.indexOf('function syncViewerAnnotations()'));
    expect(sync.slice(0, 600)).toContain('annotations.concat([state.citationAnnotation])');
    expect(pageJs).toContain("{ id: CITATION_ANNOTATION_ID, kind: 'highlight', anchor: anchor }");
    expect(pageJs).not.toContain('commitViewerAnnotation(state.citationAnnotation');
  });

  test('a missing passage opens at the page with a non-blocking note', () => {
    expect(pageJs).toContain("'Opened at page ' + focus.page + '. The quoted passage could not be located in this view.'");
    expect(pageJs).toContain("notify(citationNotFoundNote(focus), 'info')");
    expect(pageJs).toContain("iframe.src = citedPage ? objectUrl + '#page=' + citedPage : objectUrl;");
  });
});
