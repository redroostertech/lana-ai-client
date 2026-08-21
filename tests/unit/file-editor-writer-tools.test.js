const path = require('path');

const writerTools = require(path.join(
  __dirname,
  '../../src/js/file-editor/writer-tools.js'
));

describe('file-editor writer tools', () => {
  describe('htmlToPlainText', () => {
    test('extracts readable text with block breaks and decoded entities', () => {
      const html = [
        '<h2>Mutual NDA &amp; Terms</h2>',
        '<p>Client&nbsp;must protect confidential information.</p>',
        '<ul><li>Notice period</li><li>Return materials</li></ul>'
      ].join('');

      expect(writerTools.htmlToPlainText(html)).toBe([
        'Mutual NDA & Terms',
        'Client must protect confidential information.',
        'Notice period',
        'Return materials'
      ].join('\n'));
    });

    test('ignores script, style, and comments', () => {
      const html = '<style>.x{}</style><!-- hidden --><p>Visible</p><script>alert("x")</script>';

      expect(writerTools.htmlToPlainText(html)).toBe('Visible');
    });

    test('keeps document structure from tables, deeper headings, breaks, and image alt text', () => {
      const html = [
        '<h4>Checklist&nbsp;&ndash;&nbsp;Phase 1</h4>',
        '<p>First line<br>second line <img alt="chart" src="chart.png"></p>',
        '<table><tr><th>Owner</th><th>Status</th></tr><tr><td>Legal</td><td>Ready</td></tr></table>',
        '<hr><blockquote>Quoted note</blockquote>'
      ].join('');

      expect(writerTools.htmlToPlainText(html)).toBe([
        'Checklist - Phase 1',
        'First line',
        'second line chart',
        'Owner Status',
        'Legal Ready',
        'Quoted note'
      ].join('\n'));
    });
  });

  describe('getDocumentStats', () => {
    test('counts words, characters, paragraphs, and reading time', () => {
      const stats = writerTools.getDocumentStats('<p>Alpha beta.</p><p>Gamma delta epsilon.</p>');

      expect(stats.words).toBe(5);
      expect(stats.paragraphs).toBe(2);
      expect(stats.characters).toBe('Alpha beta.\nGamma delta epsilon.'.length);
      expect(stats.charactersNoSpaces).toBe('Alphabet.\nGammadeltaepsilon.'.length);
      expect(stats.tokens).toBe(Math.ceil(stats.characters / 4));
      expect(stats.estimatedPages).toBe(1);
      expect(stats.readingMinutes).toBe(1);
      expect(stats.plainText).toBe('Alpha beta.\nGamma delta epsilon.');
    });

    test('treats contractions, hyphenated words, dashes, and decimals like document word counts', () => {
      const stats = writerTools.getDocumentStats('<p>We can&apos;t re-sign Alpha &mdash; beta; 2.0 terms.</p>');

      expect(stats.words).toBe(7);
      expect(stats.plainText).toBe("We can't re-sign Alpha - beta; 2.0 terms.");
    });

    test('returns zeroed stats for empty content', () => {
      const stats = writerTools.getDocumentStats('');

      expect(stats.words).toBe(0);
      expect(stats.paragraphs).toBe(0);
      expect(stats.characters).toBe(0);
      expect(stats.tokens).toBe(0);
      expect(stats.estimatedPages).toBe(0);
      expect(stats.readingMinutes).toBe(0);
    });
  });

  describe('buildOutline', () => {
    test('extracts heading level, title, slug id, and source index', () => {
      const outline = writerTools.buildOutline('<h1>Agreement</h1><p>Intro</p><h2>Definitions</h2>');

      expect(outline).toEqual([
        { id: 'agreement', level: 1, title: 'Agreement', sourceIndex: 0 },
        { id: 'definitions', level: 2, title: 'Definitions', sourceIndex: 30 }
      ]);
    });

    test('includes deeper heading levels in document outlines', () => {
      const outline = writerTools.buildOutline('<h4><span>Review Notes</span></h4><h6>Footnote Detail</h6>');

      expect(outline.map((item) => ({
        id: item.id,
        level: item.level,
        title: item.title
      }))).toEqual([
        { id: 'review-notes', level: 4, title: 'Review Notes' },
        { id: 'footnote-detail', level: 6, title: 'Footnote Detail' }
      ]);
    });

    test('deduplicates heading ids', () => {
      const outline = writerTools.buildOutline('<h2>Terms</h2><h3>Terms</h3><h2>Terms &amp; Conditions</h2>');

      expect(outline.map((item) => item.id)).toEqual([
        'terms',
        'terms-2',
        'terms-conditions'
      ]);
    });
  });

  describe('buildExportPayload', () => {
    test('builds a plain text export payload with stats and outline', () => {
      const payload = writerTools.buildExportPayload({
        id: 'doc-brief',
        kind: 'doc',
        title: 'Mutual NDA Draft',
        content: '<h2>Mutual NDA</h2><p>This draft is ready.</p>'
      }, { exportedAt: '2026-08-20T12:00:00Z' });

      expect(payload).toMatchObject({
        id: 'doc-brief',
        kind: 'doc',
        title: 'Mutual NDA Draft',
        filename: 'mutual-nda-draft.txt',
        mimeType: 'text/plain;charset=utf-8',
        content: 'Mutual NDA\nThis draft is ready.',
        plainText: 'Mutual NDA\nThis draft is ready.',
        exportedAt: '2026-08-20T12:00:00Z'
      });
      expect(payload.stats.words).toBe(6);
      expect(payload.outline).toEqual([
        { id: 'mutual-nda', level: 2, title: 'Mutual NDA', sourceIndex: 0 }
      ]);
    });

    test('builds an html export payload when requested', () => {
      const html = '<h2>Title</h2><p>Body</p>';
      const payload = writerTools.buildExportPayload({
        title: 'Review Copy',
        content: html
      }, { format: 'html' });

      expect(payload.filename).toBe('review-copy.html');
      expect(payload.mimeType).toBe('text/html;charset=utf-8');
      expect(payload.content).toBe(html);
      expect(payload.plainText).toBe('Title\nBody');
    });
  });
});
