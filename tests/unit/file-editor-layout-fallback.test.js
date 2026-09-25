'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const html = fs.readFileSync(path.join(SRC, 'file-editor.html'), 'utf8');
const editor = fs.readFileSync(path.join(SRC, 'js/file-editor.js'), 'utf8');
const viewer = fs.readFileSync(path.join(SRC, 'js/file-viewer-page.js'), 'utf8');

// Wiring smoke for the layout gaps closed on 2026-09-25. The behaviour lives
// in rich-document-guard.js (tested directly); these pin that the page loads
// it and that the editor consults it where flattening used to happen.
describe('File Editor layout fallback wiring', () => {
  test('the editor page loads the rich document guard', () => {
    expect(html).toContain('js/services/rich-document-guard.js');
  });

  test('the fallback page is read-only for a rich document and never saves its flattened text', () => {
    expect(editor).toContain('function richSourceFallbackLockReason(file)');
    expect(editor).toContain("contenteditable=\"' + (isServerReviewFile(file) || richLockReason ? 'false' : 'true')");
    expect(editor).toContain('if (file && richSourceFallbackLocked(file)) return;');
    expect(editor).toContain('officeRichFallbackNotice');
  });

  test('the toolbar offers six heading levels and maps them to the embed styles', () => {
    expect(editor).toContain('<option value="h5">Heading 5</option><option value="h6">Heading 6</option>');
    expect(editor).toContain("h5: 'Heading5'");
    expect(editor).toContain("h6: 'Heading6'");
    expect(editor).toContain("Heading5: 'h5', Heading6: 'h6'");
  });

  test('the viewer reads table counts the renderer emits and revisions from the review state', () => {
    expect(viewer).toContain('page_breaks: counts.pageBreaks');
    expect(viewer).toContain("loadedReviewState = typeof editor.reviewState === 'function' ? editor.reviewState() : null");
    expect(viewer).not.toContain('revisions: event.counts.revisions');
  });
});
